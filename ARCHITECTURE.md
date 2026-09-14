# Standalone CDE runtime governance

This repository is the canonical implementation for this demo. No CDE Lite or
other CDE implementation is used. Kingpin is a local, separate authority-decision
module implemented in this repository; it does not import an external Kingpin system.

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
Kingpin consumes the versioned signal rather than deriving authority from
these compatibility fields. The gateway consumes Kingpin’s authority decision.

## Kingpin integration boundary

The integration leaves the Python engine, governance schema, manifests, transport
projection and `tests/legacy_events.json` unchanged. The smallest boundary is an
in-process module call, not another service:

```text
tool request → CDE → governance_signal v1.0
             → KingpinAuthority.decide(signal, request, CDE event ID)
             → authority_decision v1.0 → gateway enforcement
```

`gateway_node/kingpin/authority.js` owns the capability envelope, tool policy,
evidence decisions, scoped leases, revocation and recovery state.
`gateway_node/enforcement.js` only maps the returned outcome to HTTP status and
execution eligibility. `server.js` supplies the selected CDE event ID, calls both
layers, and logs their outputs. Clients cannot submit an authority decision to
bypass evaluation. CDE can require authority but cannot grant it.

This replaces the former gateway tool-policy logic and `demo_authority.js` lease
fixture. No substantive authority policy remains in gateway enforcement.

### Capability contraction and restoration

Envelope state is keyed by session, actor (`speaker_id`), channel and typed scope
(`scene:…`, otherwise `task:…`, otherwise `agent:…`). Kingpin validates that the
signal scope matches this request context. The selected CDE signal retains the
existing scope precedence; this integration does not aggregate or rerank scopes.

| Governed deviation | Kingpin envelope | Eligible tools |
| --- | --- | --- |
| Gate 0, initially | full | 7 registered tools |
| Gate 1 | non_destructive | `fs.list`, `fs.read`, `fs.write`, `git.commit` |
| Gate 2 | read_only | `fs.list`, `fs.read` |
| `QUARANTINE_THRESHOLD_REACHED` | quarantined | None |

These are eligibility sets, not unconditional grants. Unknown tools are denied.
The full set adds `fs.delete`, `shell.rm`, and `git.reset_hard`. Explicit capability
revocations are subtracted at every level. Thus increasing governed deviation
contracts the authority surface **7 → 4 → 2 → 0**.

Contraction is immediate. It invalidates all existing leases in that context,
including leases for tools that remain eligible. A lease never expands an
envelope. Kingpin retains the original tool floors: write/commit require evidence;
destructive tools require a lease. The compatibility `effective_gate` is Kingpin's
`max(cde_gate, tool_floor_gate)`, not a new CDE assignment. Gate 2 still requires a
lease on every eligible tool. Evidence/lease requirements remain noncumulative.

Restoration requires **two consecutive distinct inactive Gate 0 evaluations per
step**: quarantined → read_only → non_destructive → full. A nonzero gate resets
the clean counter; a lower nonzero gate does not restore authority. CDE's own
hysteresis must therefore release before recovery progresses. Duplicate event IDs
are rejected before state transitions. State updates use no random values or wall
clock, so the same ordered evaluation stream produces the same recovery states.
An envelope may stay narrower than the current CDE gate while recovery is pending.

Restoration never revives revoked/expired leases or explicitly revoked capabilities.
A newly eligible leased operation needs fresh issuance. There is no automatic
operator-revocation reset. Lease expiry alone uses the injected clock.

### Authority decision contract

Kingpin returns `schema_version: "1.0"`, `issuer: "kingpin"`, and
`policy_version: "demo_v1"`. Its decision contains:

- `evaluation_id` and `context`, binding the decision to the selected CDE event
  and authority context;
- `outcome`, `reason`, `reason_codes`;
- `capability_envelope`: level, eligible tools, revision, clean-evaluation count,
  restoration step length, explicitly revoked tools;
- `cde_gate`, `tool_floor_gate`, `effective_gate`, `effective_gate_label`;
- evidence requirements, missing evidence, and authority requirement.

| Kingpin outcome | Gateway HTTP | Enforced behavior |
| --- | --- | --- |
| allow | 200 | Permit the simulated operation |
| constrain | 409 | Block pending dry-run/diff evidence |
| deny | 403 | Block: outside envelope, revoked capability, or absent/invalid lease |
| quarantine | 423 | Block all operations in the quarantined context |
| human_review | 428 | Block the current request for human review |

Decision priority is quarantine, envelope/revocation denial, low-confidence human
review, missing evidence, invalid lease, then allow. Human review is signaled by
CDE's `LOW_CONFIDENCE` reason and cannot be bypassed with evidence or a lease.
This demo emits the review requirement; it has no human-approval UI or override
endpoint. A subsequent independently evaluated request is reconsidered under the
same envelope and confidence policy.

### Leases and revocation

`POST /lease` delegates to Kingpin. It requires an already evaluated context,
a tool still in the current envelope, the exact `args` object, and a duration of
0.001–300 seconds. Include the same session, actor, channel and scene/task fields
as the tool request. Example:

```json
{
  "session_id": "demo-session",
  "speaker_id": "demo-user",
  "channel_id": "demo-channel",
  "scene_id": "demo-scene",
  "tool": "fs.list",
  "args": {"path": "/project"},
  "seconds": 60
}
```

Leases bind session, actor, channel, typed scope, tool, exact canonical JSON args
and expiry. Object key ordering is irrelevant; path/argument changes are not.
Leases remain reusable until expiry or revocation. `/revoke` accepts the same
context plus either a `lease_token` or a registered `tool`; tool revocation also
invalidates that tool's leases. The old unbound `{tool, scope, seconds}` issuance
shape is intentionally replaced. Issuance and revocation are Kingpin control-plane
operations, separate from tool evaluation.

All tools are simulated. The local demo control plane is unauthenticated and
identity fields are caller-provided. It demonstrates authority state and contract
boundaries, not production identity verification or remote authorization. A real
deployment must establish trusted identity and protect the control plane.

## State, audit, and validation

The warm service retains session/scope EMA and hysteresis in memory. Restarting
the service resets that state; disk logs do not restore it. The CLI remains useful
for standalone, single-turn evaluation. The gateway requires the warm service
and returns an error on service failure rather than falling back to a fresh CLI.
Use one service worker for this demo; distributed/session state is not added.
Kingpin envelopes, consumed evaluation IDs, leases and revocations are also in
memory and reset on gateway restart. Gateway requests are serialized so evaluation,
authority transitions and enforcement stay ordered and control-plane mutations do
not interleave. The `/turn` route remains evaluation-only; it does not grant or
restore Kingpin authority. Direct concurrent access to the Python service outside
the gateway is outside this demo's ordering boundary.

Python demo events still append to `logs/cde_audit.jsonl`; summaries remain in
`logs/last_run_summary.json`. Gateway decisions still append to
`logs/gateway_decisions.jsonl`, now with the signal and separate enforcement
outcome. Lease and revocation control actions are also logged without bearer tokens. UUIDs and timestamps are metadata; deterministic evaluation is tested
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
exercise all five authority outcomes, contraction, scoped/expired/revoked leases,
unknown tools, malformed signals, deterministic restoration and replay rejection.
The HTTP demo preserves the original six outcomes, then demonstrates contraction,
read-only scoped authority, revocation, quarantine, hysteresis release, staged
restoration and fresh lease issuance. The former severe-deviation leased-read
example now quarantines because Kingpin applies CDE's quarantine recommendation;
this is an authority-policy change, not a CDE gate change.
