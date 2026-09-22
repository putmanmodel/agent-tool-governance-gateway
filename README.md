# CDE + Kingpin — Runtime Governance Demo

`tool request → CDE evaluates deviation → gate assignment → Kingpin evaluates authority → gateway enforces`

**Deviation ↑ → authority surface ↓**

The demo contracts and restores eligible tool capabilities:

**7 → 4 → 2 → 0 → 2 → 4 → 7**

Full → non-destructive → read-only → quarantined → read-only → non-destructive → full.
Restoration requires two consecutive inactive Gate 0 evaluations per step; revoked
leases stay revoked and must be issued afresh where required.

## Responsibilities

| Layer | Owns |
| --- | --- |
| **CDE** | Deterministic deviation evaluation, confidence, EMA/hysteresis, and Gate 0/1/2 assignment. Emits a versioned governance signal with evidence/lease requirements and audit provenance. |
| **Kingpin** | Capability envelope, scoped leases, revocation, allow/constrain/deny/quarantine/human review, and deterministic restoration. Consumes CDE's signal and returns an authority decision. |
| **Gateway** | Enforcement only: applies Kingpin's decision to the simulated tool request. Handles HTTP orchestration and audit logging, without substantive authority policy. |

- **Gate 0 — PASS**
- **Gate 1 — EVIDENCE REQUIRED** (dry-run + diff)
- **Gate 2 — LEASE REQUIRED**

**CDE can require authority but cannot grant it.**

Kingpin also applies a minimum authority floor based on tool criticality:
write/commit operations require evidence, and destructive tools require a scoped
lease even at CDE Gate 0. Non-deviant behavior does not automatically authorize
destructive tools; a lease cannot expand a contracted capability envelope.

## Run the merged demo

From the repository root:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt -r requirements_gateway.txt
npm --prefix gateway_node install
npm --prefix gateway_node run demo
```

The script starts the warm FastAPI CDE service and Node gateway, asserts the
outcomes, prints the transcript, and stops both. It includes scoped authority,
revocation, quarantine, staged recovery, and an isolated **HUMAN REVIEW (HTTP 428)**
fixture. All tools are simulated; the demo uses in-memory state and temporary
agent/admin credentials. Set `CDE_PYTHON` to select another Python environment.

See the [verified transcript](gateway_node/TRANSCRIPT.md),
[demo details](gateway_node/README.md), and
[architecture and contracts](ARCHITECTURE.md).

## Standalone CDE history

This repository began as the standalone Python CDE runtime-governance demo.
**`cde-pre-kingpin-v0.2` is the pre-integration checkpoint.** The merged demo retains
CDE's gate semantics, deviation behavior, and 32-event regression baseline.
Kingpin is a separate local authority module; this implementation does not draw
from CDE Lite or other CDE runtimes.

The standalone engine remains runnable with `python run_demo.py`, producing
`logs/cde_audit.jsonl` and `logs/last_run_summary.json`.

## Key files

- `src/engine.py` and `manifests/` — CDE evaluation and baseline configuration
- `cde_service.py` — warm, session-aware CDE service
- `kingpin/authority.js` — authority policy and state
- `gateway_node/enforcement.js` — mechanical enforcement
- `gateway_node/server.js` and `gateway_node/demo.js` — HTTP flow and asserted demo

## License

CC BY-NC 4.0 — see [LICENSE](LICENSE).

## Contact

Stephen A. Putman — putmanmodel@pm.me

## v0.3 compatibility baseline

See the [behavior contract and versioned boundary fields](docs/v0.3-behavior-contract.md)
for regression coverage, schema scope, and current representation limits.
The four [v1 boundary schemas](schemas/v1/) are descriptive and test-validated;
they do not change runtime validation or authority policy.

## Authenticated evaluator gateway

Gateway calls now require bearer credentials from a server-controlled
`KINGPIN_AUTH_FILE`. Agent identities and contexts are explicitly scoped;
authority administration and reviewer access have separate permissions.
See [authentication setup and usage](kingpin/auth/README.md). The merged demo
creates temporary credentials automatically. Kingpin authority semantics and
frozen v1 payloads remain unchanged.

Paper 9 proof/break evaluation is available separately via
`npm --prefix gateway_node run conformance`. See the
[conformance harness](conformance/README.md) for its registry, coverage limits and
canonical JSONL artifact. Runtime operational logs retain their existing format.

Persistent [HUMAN REVIEW resolution](kingpin/review/README.md) now supports
authenticated reviewers, durable bounded approval/denial, current-state
revalidation and atomic one-use authorization. It does not expand authority.

For an outside developer, begin with the [controlled evaluator quickstart](evaluation/README.md).
It provides explicit configuration, persistent SQLite startup, local credentials,
a real sandbox adapter, a readable client and restart verification. See the
[evaluation notice](evaluation/NOTICE.md) and [security boundaries](evaluation/SECURITY.md).


[Execution receipts and restart reconciliation](execution/README.md) now track
side-effect outcomes separately from Kingpin authorization. Unknown completion
never causes automatic retry; inconclusive inspection requires reviewer action.
