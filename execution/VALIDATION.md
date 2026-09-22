# Execution tracking completion report

Implemented on `v0.4-product`. The execution layer is separate from Kingpin's
unchanged authority decisions. CDE source, trusted policy, Kingpin authority
implementation, lease/review logic, frozen `schemas/v1` and Paper 9 harness were
not modified. Existing non-execution baselines remain unchanged.

## State and storage

Internal record version 1.0 has seven statuses: started, succeeded, failed,
unknown, reconciled_succeeded, reconciled_failed, reconciliation_required. It binds
the original request/decision/evaluation/principal/agent/context/tool, arguments
and full request hashes, optional review ID, adapter resource/evidence,
start/completion times and bounded result/failure/reconciliation metadata.

Memory and SQLite expose the same executions repository behind the existing
transaction boundary. Migration `005_executions.sql` explicitly advances SQLite
**4 → 5**, with permanent records, unique decision/review identities, guarded
transitions and a partial unique index for unresolved adapter resources. Migration
preserves existing rows and rolls back on failure; no database reset is supplied.

The gateway passes a captured actual allow projection and original correlation.
Execution validates exact binding and durable authority/review-consumption plus
enforcement evidence. Start state/event commit before any side effect. A second
transaction holds the writer lock while the synchronous adapter runs and its
terminal receipt is stored. Crash/terminal rollback cannot undo the filesystem,
so the prior start remains and recovery makes uncertainty explicit.

## Events and adapters

New audit v3 schema: `schemas/audit/v3/GovernanceExecutionEvent.schema.json`.
Actual transitions emit `tool.execution.started`, `.succeeded`, `.failed`,
`.unknown`, `.reconciled_succeeded`, `.reconciled_failed`,
`.reconciliation_required`. All preserve original correlation, including optional
review ID; known adapter failure enforcement events now retain evaluation ID.
Existing audit v1/v2 and enforcement/authority meanings are unchanged.

Optional synchronous adapter methods are `isSideEffecting(tool)`, read-only
`prepare(request)` and read-only `reconcile(evidence)`. Reconciliation returns
succeeded/failed/inconclusive/unsupported. Missing support or ambiguous evidence
requires operator attention; it never calls execute. Reads skip uncertain
side-effect records. Raw result contents are not persisted.

Sandbox preparation records root/target identity, prior file metadata/hash and
expected write hash. Exact compatible write postconditions or disappearance of a
known delete target support success under exclusive sandbox assumptions.
Unchanged original state supports failure; unexpected content/replacement/root
changes/link ambiguity require reconciliation. No automatic rewrite/delete is
performed. Large pre-existing files use bounded metadata, preserving their
existing overwrite/delete support without unbounded snapshot reads.

## Startup, APIs and permissions

Evaluator startup acquires an exclusive OS lock, opens/migrates the store, marks
dangling starts unknown and invokes only adapter inspection before listening.
Unknown is persisted as a real event even when inspection immediately resolves
it. A lost private child closes the listener. Execution/recovery writer locking
and a started-state check prevent a late execution/result from overtaking
reconciliation. Unsupported/inconclusive records remain visible until disposition.

Added routes:

- `GET /executions`: unresolved records within permitted scope.
- `GET /executions/:id`: inspect one execution.
- `POST /executions/:id/reconcile`: read-only adapter inspection.
- `POST /executions/:id/resolve`: reviewer outcome succeeded/failed, only for a
  reconciliation-required record; no tool invocation or authority grant.

Admins have execution.read/reconcile. Reviewers have read/reconcile/resolve within
existing reviewer scope. Agents have none; admins do not inherit reviewer
disposition. Original pre-execution reviews remain distinct and consumed forever.
Unresolved resources block another side effect; after reconciliation/disposition,
a retry requires a fresh governed request, never reuse of a prior decision/review.

## Tests and crash mechanism

`gateway_node/execution.test.js` adds **18 tests** across memory/SQLite covering
start-before-invocation, success/known failure, exact correlation, binding failure,
one-use execution, start/terminal audit failures, unknown/no retry, unsupported
reconciliation, role/scope separation, safe bounded receipts, read bypass,
filesystem postconditions/replacement, real process restart, concurrent duplicate
execution/reconciliation, reviewed execution, schema migration/rollback/corruption,
exclusive evaluator locking and live terminal-result versus recovery races.
Existing evaluator tests continue proving revoked nonce/epoch requests cannot
cause side effects and that initial HUMAN REVIEW withholds mutation.

The test-only `tests/fixtures/execution_process.mjs` wraps the adapter and sends
SIGKILL to itself after the durable start, either before the side effect or after
it but before terminal persistence. The production runtime has no failpoint
parameter, environment switch or public control route. A separate fixture
`execution_http_smoke.mjs` reopens the actual evaluator after both crash windows,
queries its authenticated receipt/audit APIs and verifies that file state/mtime
was not changed by recovery. It uses only temporary configuration/databases.

`tests/fixtures/execution_audit_stream.mjs` produces real transitions for the new
Python schema test, including all seven event types and rejection of missing or
extra fields. Prior schema tests remain intact.

## Full validation

| Check | Result |
| --- | --- |
| Complete Node suite | **200 passed**, 0 failed/skipped/cancelled |
| Complete Python/schema suite | **18 passed** |
| Paper 9 conformance | **11/11 passed** |
| Frozen 32-event CDE baseline | Passed in Python suite |
| Frozen authority/policy/store baselines | Passed in Node suite |
| Authenticated frozen HTTP demo | Passed all assertions |
| Standalone Python demo | Passed |
| Authenticated evaluator/client/restart and HUMAN REVIEW flow | Passed |
| SQLite v4 → v5 migration, rollback and historical migration/restart tests | Passed |
| SIGKILL before/after side effect and real evaluator startup recovery | Passed |
| Sandbox write/delete reconciliation, ambiguous replacement and unsupported adapter | Passed |
| Cross-process duplicate execution/reconciliation and live-result recovery race | Passed |
| `git diff --check` | Passed |

Commands: `npm --prefix gateway_node test`, Python unittest discovery,
`npm --prefix gateway_node run conformance`, authenticated demo and
`evaluation:smoke`, standalone `run_demo.py`, and
`CDE_PYTHON=<absolute-python> node tests/fixtures/execution_http_smoke.mjs`.
The real HTTP tests use local loopback listeners and generated temporary secrets.

## Files

Added:
- `execution/model.js`, `execution/runtime.js`, `execution/README.md`, this report.
- `kingpin/state/migrations/005_executions.sql`.
- `schemas/audit/v3/GovernanceExecutionEvent.schema.json`.
- `gateway_node/execution.test.js`.
- `tests/fixtures/execution_process.mjs`, `execution_audit_stream.mjs`,
  `execution_http_smoke.mjs`.

Modified:
- Gateway execution/API integration in `gateway_node/server.js`.
- Execution repository/migration contract in `kingpin/state/{interfaces,memory,sqlite}.js`.
- Audit v3 support in `kingpin/audit/events.js`; scoped execution permissions in
  `kingpin/auth/access.js`.
- Evaluator composition/startup/locking in `evaluation/{config,start,cde}.js`
  (startup file is `start.mjs`) and `evaluation/cde_worker.py`;
  filesystem evidence/inspection in `evaluation/sandbox.js`.
- Current storage-version/composition expectations in gateway audit, state,
  lease-revocation and evaluation tests; Python execution schema coverage in
  `tests/test_audit_schema.py`.
- Root/evaluator/security and Kingpin state/auth/audit/review documentation.

## Remaining limits

No exactly-once external execution is claimed. Durable authorization/one-use
review consumption does not guarantee a completed side effect. SQLite rollback
cannot undo a file write/delete, and receipts can be lost in a crash window.
Reconciliation observes postconditions under trusted exclusive-sandbox assumptions;
it cannot prove causality against external writers, inode reuse, hostile owners
or backup rollback. Reviewer disposition is an explicit human claim, not a new
adapter verification or retroactive authority grant.

Only synchronous adapters are supported, and bounded local I/O holds the writer
lock. Custom adapters must supply truthful no-effect failure classification and
safe read-only reconciliation. The OS lock is single-node/advisory; trusted direct
integrations must honor lifecycle ownership. Read operations retain existing
semantics without uncertain side-effect rows. No distributed transactions, retry
engine, queues, MCP, cryptographic receipts or production deployment work was added.
