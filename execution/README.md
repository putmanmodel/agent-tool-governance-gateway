# Durable execution receipts and reconciliation

Kingpin authorizes actions. The execution layer separately records whether an
authorized action started and whether its result is known. It does not classify
tool risk, decide authority, mint leases, restore envelopes or satisfy review.

This is a v0.4 execution addition. CDE, policy, lease/revocation, original HUMAN
REVIEW, frozen v1 boundary schemas and Paper 9 behavior are unchanged.

## Record and lifecycle

`model.js` validates internal record version 1.0. `runtime.js` consumes a trusted
Kingpin allow projection and the exact request captured by the gateway. It checks
that correlated authority/review-consumption and enforcement-allowed events
actually exist before creating a start record. An in-process opaque handle binds
the captured authorization to the canonical request; HTTP callers cannot supply
handles or final decisions. Reusing the same decision or consumed review cannot
start a second execution, including across processes.

Records contain:

- execution/request/decision/evaluation IDs, original principal/agent/context;
- trusted tool identity, canonical arguments and full request binding hashes;
- source (`decision` or `review`), optional original review ID and exact scope;
- resource hash and bounded adapter reconciliation evidence;
- status, started/completed timestamps, safe result metadata, failure code;
- reconciliation method/outcome/time and authenticated operator ID, if applicable.

Hashes use the existing canonical JSON/SHA-256 mechanisms. The full request hash
covers the same relevant identity, context, action/target, args, evidence, lease
identity and observation inputs as review binding. Raw contents, lease tokens,
bearer tokens and arbitrary adapter output are not stored in receipts. Sandbox
reconciliation retains a relative filename and content hash; gateway redaction
checks reject reflected configured credentials before persistence.

| Status | Meaning |
| --- | --- |
| `started` | Durable execution-start intent, committed before adapter invocation |
| `succeeded` | Adapter returned and its success receipt committed |
| `failed` | Adapter preparation/refusal establishes no side effect occurred |
| `unknown` | No trustworthy durable terminal result exists |
| `reconciled_succeeded` | Adapter postcondition check or explicit reviewer disposition supports success |
| `reconciled_failed` | Adapter postcondition check or explicit reviewer disposition supports failure |
| `reconciliation_required` | Adapter cannot establish the result; reviewer/operator attention needed |

A start intent is not proof the adapter was called: the process can die between
commit and invocation. `result_metadata: {adapter_reported: true}` records a live
adapter return without copying its arbitrary output. The separate `tool_result`
HTTP field retains the adapter response. Known pre-effect refusals use
`ADAPTER_REJECTED`; uncertain exceptions use `ADAPTER_OUTCOME_UNKNOWN`, missing
receipt commits use `RECEIPT_UNAVAILABLE`, abandoned starts use
`RUNTIME_DISAPPEARED`. Reconciliation retains the original uncertainty cause.

## Persistence and concurrency

Memory and SQLite expose `tx.executions.get/list/insert/save`. SQLite migration
`005_executions.sql` moves **4 → 5**, preserving all existing records; old stores
still migrate through prior versions. No historical executions are fabricated
from old allow events. Records are permanent with immutable identity/binding,
unique decision/review IDs and guarded state transitions. A partial unique index
prevents two unresolved operations on the same adapter resource. Memory implements
the same constraints. Required execution events and state transitions commit in
the same transaction.

The start is committed **before** side effects. A second transaction checks the
record is still started, holds the writer lock during the synchronous adapter,
and commits the terminal receipt. Recovery/reconciliation cannot overtake a live
adapter. If the external action happened but the terminal transaction rolls back,
the prior start remains; an unknown transition is attempted, otherwise restart
will detect it. Filesystem changes are **not** rolled back with SQLite.

The small synchronous adapter may hold SQLite's writer lock while doing bounded
local I/O. Async adapters and long-running external operations are outside this
interface. A store/lock/persistence error fails the response closed, never retries
an action. Normal requests still require a fresh CDE/Kingpin decision; packaging
does not turn reusable leases into one-use leases.

The evaluator obtains an OS advisory lock before database open/recovery/listen.
Its private Python child holds the stable `<database>.runtime.lock` inode; normal
shutdown waits for release. Pipe EOF/process exit releases it after a parent
crash. Database paths are canonicalized and hard links rejected. Do not delete
lock files while a runtime is active. Loss of the child closes the listener.
The execution writer-lock/status guard also fences recovery against in-flight
work or an old start handle. Trusted direct runtime/store integrations must
provide equivalent exclusive startup and synchronous execution discipline.

## Startup and no retry

Startup changes dangling `started` records to `unknown` with an event, then asks
the configured adapter to inspect them. Existing `unknown` records also receive
an inspection; `reconciliation_required` records stay visible for explicit
operator action. No `execute()` call occurs in recovery or reconciliation.

Unknown completion must never silently become permission to repeat a side effect.
The ledger refuses a new execution on an unresolved resource until reconciliation
or reviewer disposition completes. For the filesystem adapter the resource is
root identity plus **filesystem-equivalent filename**, shared by write/delete
regardless of agent or context. The stored spelling hash is an exact-name fast
check, not the complete namespace identity. Under the same writer transaction,
`adapter.resourcesConflict(preparation, priorRecord)` also compares unresolved
resources using [the centralized sandbox namespace comparison](../evaluation/resource_identity.js).
Existing targets use filesystem device/inode lookup. If both names are absent,
a private temporary child directory asks the host filesystem whether the names
resolve to the same entry; JavaScript case folding or Unicode normalization is
not used. The child namespace inherits the sandbox filesystem's naming semantics
(including directory casefold settings on supporting filesystems).

The absent-name check creates only zero-content probe metadata inside a private
`.kingpin-identity-*` directory, never either requested sandbox target. Normal
completion removes the directory. A process crash may leave an inert probe
directory; it does not grant authority or replace persisted holds. A trusted
operator may remove leftover probe directories while the evaluator is stopped.
This comparison is synchronous inside the writer lock. Reads and the adapter's
reconciliation still perform no writes; the namespace probe is conflict checking,
not tool execution or a retry.

SQLite remains schema 5: RC1 `sandbox.v1` root/path reconciliation metadata is
sufficient to interpret its existing unresolved records. No spelling hashes or
historical records are rewritten. Missing, incompatible or unreadable namespace
metadata cannot prove separation and conservatively conflicts until the existing
reconciliation/disposition workflow releases that hold. The SQL spelling-key
index remains an additional exact-name guard; adapter equivalence is checked by
the runtime before insertion. No migration or new public schema is needed.

Generic adapters without a resource key conservatively key identical
tool/arguments. This is execution uncertainty handling, not a change to Kingpin's
authority decision. A resulting HTTP 409 identifies the prior execution.

After reconciliation, any desired retry must use a **fresh governed request**.
Old decision IDs and consumed reviews remain unusable. Reviewer disposition
records the claimed historical result only; it never invokes a tool, grants
permission or unconsumes an original review.

## Adapter interface

In addition to synchronous `execute(request)`, a trusted adapter may implement:

```js
isSideEffecting(tool) // false only for operations known to be read-only
prepare(request)     // read-only; {resource_hash, evidence}, or null
reconcile(evidence)  // read-only; 'succeeded' | 'failed' | 'inconclusive' | 'unsupported'
```

Unknown operations/adapters default to side-effecting. Reads declared by the
adapter execute after existing gateway authorization without uncertain execution
rows. `prepare` never writes; a preparation exception creates a known failed
attempt without invoking execute. `evidence` must be JSON, bounded to 4 KiB and
contain only safe facts needed for reconciliation. Raw adapter output never
becomes result metadata. A trusted synchronous adapter exception may set
`knownNoEffect: true` only when it can establish no external effect occurred;
unclassified exceptions are unknown, not a fabricated failure.

Adapters cannot consult or mutate authority through this interface. Unsupported
reconciliation returns a reconciliation-required condition. Invalid reconciliation
results or exceptions are treated as inconclusive. Adapters must not return
promises or schedule delayed side effects.

## Filesystem postconditions

Preparation stores the private root identity, bounded relative target filename,
write's expected content SHA-256, and pre-operation target existence, inode/device,
size, timestamps and content hash. Large pre-existing files retain metadata with
null prior hash rather than unbounded reads. No original or desired file contents
are persisted. Inspection uses the existing flat/no-follow/singly-linked regular
file rules; ambiguity, inaccessible paths, changed roots and links are not guessed.

- **Write:** exact desired hash at a compatible target identity supports success.
  A target identical to its pre-operation state, including continued absence for
  a new file, supports failure. Unexpected content, disappearance of a prior
  file, replacement of an existing inode or other ambiguity is inconclusive.
- **Delete:** a formerly present bound target now absent supports success under
  the exclusive-sandbox assumption. An unchanged original target supports
  failure. Replacement/recreation is inconclusive.
- **Read:** no side-effect crash reconciliation row is needed.

These establish current postconditions, not proof of causal history. Another
same-user/privileged process can invalidate the assumptions, timestamps/inodes
can be reused, and a write that already matched desired contents cannot prove a
new write took place. Reconciliation never rewrites or deletes anything. Do not
allow external writers or mount/root changes in this controlled sandbox.

## Authenticated APIs

| Route | Permission and result |
| --- | --- |
| `GET /executions` | `execution.read`; unresolved records within allowed scope |
| `GET /executions/:id` | `execution.read`; one receipt and evidence |
| `POST /executions/:id/reconcile` | `execution.reconcile`; inspect current postconditions, no retry |
| `POST /executions/:id/resolve` | `execution.resolve`; body `{ "outcome": "succeeded" }` or `"failed"`, only when reconciliation_required |

Authority admins can inspect/reconcile globally. Reviewers can inspect/reconcile
and explicitly dispose within their configured reviewer scope. Admins do not
inherit reviewer disposition permission. Agents have none of these permissions
and cannot mark their own operation successful. Request-supplied operator identity
is ignored; the authenticated principal supplies it.

This queue is distinct from `/reviews`: original review is a **pre-execution
condition**; reconciliation is a **post-execution uncertainty**. Both retain their
own IDs and meanings. HTTP success for a side effect adds `execution_id` and
`execution_status: succeeded`. Known failure returns 422; uncertain outcome or
unavailable terminal receipt returns 503 with the execution ID when known. Start
persistence failure invokes no adapter; original review consumption may already
be durable and is never undone.

## Audit and limits

Execution events use new `schemas/audit/v3/GovernanceExecutionEvent.schema.json`:
`tool.execution.started`, `.succeeded`, `.failed`, `.unknown`,
`.reconciled_succeeded`, `.reconciled_failed`, `.reconciliation_required`.
They preserve original request/evaluation/decision/principal/agent/context/tool/
argument hash, add execution ID/full request hash and optional original review ID,
and record bounded result/reconciliation metadata. Existing audit v1/v2 records
and event meanings are unchanged. Known adapter failures now retain their known
evaluation ID in the existing enforcement-failed event as well.

`tool.enforcement.allowed` means permission. `tool.execution.succeeded` means a
live adapter reported completion and that receipt committed. A reconciliation
receipt instead identifies adapter inspection or explicit operator disposition.
The terminal event does not retroactively reinterpret the authority decision.

There is no exactly-once external execution guarantee. Review consumption remains
at-most-once authorization; execution intent/results are durably tracked; crash
uncertainty becomes explicit; unknown work is not automatically retried. No
external distributed transaction, durable queue, retry engine, signing, remote
attestation, MCP or production deployment machinery is added. Database/process
owners remain trusted and there is no backup rollback protection.
