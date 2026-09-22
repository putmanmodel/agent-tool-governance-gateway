# CDE + Kingpin governed tool demo

**Deviation ↑ → authority surface ↓**

The warm Python service emits an unchanged CDE v1.0 governance signal. Kingpin
consumes it and owns authority decisions. The gateway enforces those decisions.

```text
tool request → CDE → governance signal → Kingpin → authority decision → enforcement
```

## Run

Install both root Python requirements files and this folder's Node dependencies:

```bash
python -m pip install -r requirements.txt -r requirements_gateway.txt
npm --prefix gateway_node install
npm --prefix gateway_node run demo
```

Set `CDE_PYTHON` to your Python executable if the root `.venv` is unavailable.
The demo starts FastAPI on `127.0.0.1:8008` and Node on `127.0.0.1:8787`, asserts
the outcomes, prints a transcript, then stops both. It generates separate
ephemeral credentials for runtime and admin calls and deletes them afterward. All tool actions are simulated.

## Authority boundary

- CDE: Gate 0 PASS, Gate 1 EVIDENCE REQUIRED, Gate 2 LEASE REQUIRED.
- `../kingpin/authority.js`: full → non-destructive → read-only → quarantined envelope;
  evidence policy; context/operation-bound leases; revocation; staged recovery.
- `enforcement.js`: mechanically maps Kingpin's five outcomes to HTTP statuses.
- `/lease`, `/revoke`, `/revoke/nonce`, `/revoke/all`: authenticated admin routes
  delegated to Kingpin. `/turn` and `/tool` require a scoped agent principal.
- `/review/access`: reviewer-only marker reporting resolution support.

The original six baseline outcomes remain. The expanded demo shows 7 → 4 → 2 → 0
eligible tools, revoked leases, then restoration after consecutive inactive CDE
evaluations. Old authority stays revoked; restored capabilities need fresh leases
where required. CDE grants no authority.

A final isolated-session example visibly returns **HUMAN REVIEW (HTTP 428)**.
The demo enables `CDE_DEMO_FIXTURES=1` for its gateway child and selects the fixed
`low_confidence` observation (`.`) after warming CDE hysteresis. The real engine
computes `LOW_CONFIDENCE`; Kingpin and enforcement run unchanged. The fixture is
rejected by default and recorded in the response/audit `evaluation_input` field.

See [ARCHITECTURE.md](../ARCHITECTURE.md) for the full contract, request shapes,
status mapping and authority contract, [authentication](../kingpin/auth/README.md)
for credential setup and deployment limits, and
[TRANSCRIPT.md](TRANSCRIPT.md) for the verified merged run.

## Validation and audit

```bash
python -m unittest discover -s tests -v
npm --prefix gateway_node test
```

In demo mode, operational gateway records append to `logs/gateway_decisions.jsonl` and include both
`governance_signal` and `authority_decision`, plus original evidence/provenance and
compatibility fields. The demo gateway requires the warm service and has no
stateless fallback. Evaluation uses private CDE stdio and SQLite product audit;
operational payload logging is disabled. CDE's 32-event regression baseline remains unchanged.

Governed HTTP requests now return an `X-Request-ID` header for the separate
[governance event stream](../kingpin/audit/README.md). Query it through the trusted
Kingpin runtime API or evaluator admin-only `GET /audit/:request_id`. Enforcement
events describe permission; separate execution receipt events describe outcomes.
See the [read-only trace command](../evaluation/README.md#read-a-request-trace).

See [persistent HUMAN REVIEW](../kingpin/review/README.md) for the narrow
`/reviews` list/inspect/approve/deny routes and original-agent `/execute` path.
Initial `/tool` holds include `X-Review-ID`; existing decision bodies stay unchanged.

The [evaluator package](../evaluation/README.md) adds explicit evaluation startup,
SQLite, a private CDE process, sandboxed read/write/delete, authenticated status
and admin-only audit reads. `npm run demo` retains demo mode and frozen behavior.
`/tool/observed` is an evaluation-only actual-observation ingress; `/tool` retains
its existing wrapper. Only authorized evaluation requests reach the adapter.
