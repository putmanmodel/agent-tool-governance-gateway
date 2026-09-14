# Standalone CDE runtime governance

This repository is the canonical implementation for this demo. No CDE Lite or
other CDE implementation is used. Kingpin is not integrated.

## Inspection before refactoring

| Component | Existing responsibility |
| --- | --- |
| `src/extractors/{lexical,pragmatic}.py` | Deterministic feature scores, confidence, attributed evidence spans |
| `src/baseline/retrieve.py` | Scope manifest lookup and SHA-256 provenance |
| `src/compute/deviation.py` | Baseline distances, weighted severity and confidence |
| `src/event/ema_hysteresis.py` | In-memory per-scope EMA, enter/active/exit hysteresis |
| `src/engine.py` | Orchestrates evaluation and constructs per-scope audit events |
| `src/routing/route.py` | Already assigns CDE gates; formerly described as normal/dampen/freeze_updates |
| `cde_service.py` | Warm per-session engines; top-event selection, no lease enforcement |
| `cde_cli.py` | Fresh engine per invocation; same scope selection, no authority enforcement |
| `src/arbitrate/scopes.py` | Unused ranking helper; severity/confidence-first, unlike service/CLI scope-first selection |
| `gateway_node/server.js` | Tool floors, effective gate, evidence checks, lease issuance/validation, allow/block, JSONL audit |
| `run_demo.py`, `src/audit/logger.py` | Append Python events and write summary; no tool enforcement |

The service and CLI select scene > task > agent > global, breaking ties by
severity. This behavior is preserved in `src/response.py`; the unused alternative
ranking helper has not been adopted.

Global and scene manifests currently have identical parameters. Agent/task scopes
fall back to global when no corresponding manifest exists. The short-script
profile is an example, not automatically loaded. The routing confidence threshold
is `routing.min_confidence_for_action`; the separate top-level `min_confidence`
field was not consulted by routing and remains unchanged. Manifest bytes are
unchanged to preserve their audit hashes.

Previously the gateway used `max(cde_gate, tool_floor_gate)`, but Gate 2 only
required leases for tools classified as destructive. It therefore allowed
CDE-triggered Gate 2 for other tools without a lease (and skipped Gate 1 evidence).
The automatic CLI fallback also silently lost session history. Both behaviors
are explicitly corrected by this refactor.

## Evaluation contract

Each event includes `governance_signal`; CLI/service responses also expose the
selected event's signal at the top level. Its `schema_version` is `1.0`:

```json
{
  "schema_version": "1.0",
  "scope_key": "scene:demo-scene",
  "deviation": {
    "severity": 0.8,
    "ema_severity": 0.7,
    "confidence": 0.9,
    "active": true,
    "enter": false,
    "exit": false,
    "vector": {"lexical": 1.2, "pragmatic": 0.7}
  },
  "gate": 2,
  "gate_label": "LEASE REQUIRED",
  "evidence_requirements": [],
  "reason_codes": ["LEASE_THRESHOLD_REACHED"],
  "authority": {
    "requirement": "lease",
    "recommendation": "request_external_lease"
  }
}
```

The numbers above are illustrative. The typed schema is in
`src/types/governance_signal.py`. Provenance, references and attributed evidence
remain on the enclosing event. Extracted evidence spans explain deviation;
`evidence_requirements` describes artifacts the caller must supply.

| Gate | Meaning | Evidence requirements | Authority requirement |
| --- | --- | --- | --- |
| 0 | PASS | None | None |
| 1 | EVIDENCE REQUIRED | `dry_run`, `diff` | None |
| 2 | LEASE REQUIRED | None | External lease |

Requirements are not cumulative: Gate 2 retains the existing lease-only path.
PASS describes CDE evaluation; it does not confer permission to execute a tool.
CDE neither issues leases nor accepts lease tokens nor returns an authority grant.

The deterministic branch order remains:

1. Inactive → Gate 0, `DEVIATION_INACTIVE`.
2. Active, confidence below routing minimum → Gate 1, `LOW_CONFIDENCE`.
3. Severity at/above `quarantine_at` → Gate 2, `QUARANTINE_THRESHOLD_REACHED`.
4. Severity at/above legacy `freeze_updates_at` → Gate 2, `LEASE_THRESHOLD_REACHED`.
5. Severity at/above `review_at` → Gate 1, `REVIEW_THRESHOLD_REACHED`.
6. Otherwise while active → Gate 1, `DEVIATION_PERSISTING`.

Legacy `decision.policy_gate_level`, `quarantine`, `review_band`, and the
low-confidence note remain for audit compatibility. Flags express evaluation
recommendations; they do not quarantine anything or freeze updates themselves.
The gateway consumes the versioned signal rather than deriving authority from
these compatibility fields.

## Enforcement boundary

`gateway_node/enforcement.js` consumes the signal and request, applies local tool
policy, and asks an injected authority provider to validate a lease when needed.
It never recalculates deviation or changes the CDE signal. Gateway policy floors
remain 1 for `fs.write`/`git.commit`, 2 for `fs.delete`/`shell.rm`/`git.reset_hard`,
and 0 otherwise. `effective_gate = max(cde_gate, tool_floor_gate)` is explicitly a
gateway enforcement policy, separate from CDE's gate assignment.

Gate 1 requires `dry_run === true` and a nonempty diff. Gate 2 requires a valid
lease for every tool, including CDE-triggered Gate 2 on `fs.list` or `fs.write`.
The gateway retains HTTP 200/409/403 and existing audit fields; new fields expose
the unchanged CDE signal, effective label, evidence requirements, missing
artifacts, and authority requirement. Unsupported/missing signals fail closed.

`gateway_node/demo_authority.js` owns issuance and in-memory validation through
`issue()` and `hasValidLease()`. The `/lease` endpoint delegates to this demo
provider; it is not a CDE endpoint. Leases bind tool, scope and expiry; scope is
scene, otherwise task, otherwise channel. They do not bind file paths or sessions
and are reusable until expiry. This is an unauthenticated simulated authority
fixture, not a production authorization system. A later integration can replace
this provider independently of CDE evaluation. No Kingpin code is present.

## State, audit, and validation

The warm service retains session/scope EMA and hysteresis in memory. Restarting
the service resets that state; disk logs do not restore it. The CLI remains useful
for standalone, single-turn evaluation. The gateway requires the warm service
and returns an error on service failure rather than falling back to a fresh CLI.
Use one service worker for this demo; distributed/session state is not added.

Python demo events still append to `logs/cde_audit.jsonl`; summaries remain in
`logs/last_run_summary.json`. Gateway decisions still append to
`logs/gateway_decisions.jsonl`, now with the signal and separate enforcement
outcome. UUIDs and timestamps are metadata; deterministic evaluation is tested
independently of generated IDs.

```bash
python -m unittest discover -s tests -v
npm --prefix gateway_node test
npm --prefix gateway_node run demo
```

`tests/legacy_events.json` captures 32 pre-refactor events from ramp then scope
fixtures, omitting only generated event IDs. Regression tests compare all original
fields exactly. Boundary tests cover confidence precedence and threshold equality;
session/CLI tests cover state isolation and shared response shape. Node tests
exercise gate/floor combinations, evidence, invalid signals and scoped/expired
leases. The HTTP demo asserts its original six outcomes and two additional
CDE-triggered Gate 2 outcomes.
