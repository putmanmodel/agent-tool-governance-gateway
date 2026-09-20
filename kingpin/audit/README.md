# Governance events (v0.4)

Canonical conformance output proves compatibility with the fixed PUTMAN interface
contract. The governance audit stream provides richer runtime traceability for
operators and evaluators. These are separate outputs: this versioned product
stream adds no fields to CDE JSONL, legacy gateway decision JSONL, frozen fixtures,
or `schemas/v1` boundary payloads.

Repository scope: this checkout has `src/audit/logger.py`, the 32-event
`tests/legacy_events.json` fixture, and the frozen authority oracle. It contains no
separately identified Paper 9 canonical envelope/schema. Compatibility tests lock
the available legacy records and writer; they cannot certify a separate Paper 9
artifact that is absent. No inferred conformance format or adapter was invented.

## Schema and correlation

`schemas/audit/v1/GovernanceEvent.schema.json` describes product version `1.0`.
All declared fields are present; unavailable/not-applicable facts are `null` and
reason codes use an empty array. `sequence` is added by storage, not producers.
Unknown fields/types/versions are rejected; later incompatible event formats need
a new version and explicit reader/migration support.

Every event has a random UUID `event_id`, `event_type`, `schema_version`, UTC
`timestamp_utc`, and `request_id`. The store sequence orders commits even when
wall clocks tie or move backwards. Audit uses a separate clock from lease expiry;
recording events does not consume or advance the injected authority clock.

HTTP assigns a server-generated request UUID and returns it in `X-Request-ID`.
Agent-provided IDs/principals are ignored. The resolved authentication principal
supplies `principal_id`. Authentication failures have null principal; authorization
failures retain the authenticated principal, with no rejected body/context copied.
For `/tool`, a server-generated `decision_id` and CDE's selected `evaluation_id`
connect the observed signal, request, decision and enforcement. Existing response
bodies stay unchanged. A null decision ID on a control-plane event means no
request decision was made. Trusted in-process callers can pass an optional audit
context with `request_id` and `principal_id`; without it the runtime generates a
request ID and records null principal (it must not invent authentication).

Other facts: `agent_id`, composite `context`, trusted `policy_version`, `tool_id`
(the existing action identity), trusted `tool_class`, canonical `arguments_hash`,
`outcome`, `reason_codes`, `lease_id`, detailed `lease_check`, `lease_epoch`,
`expires_at_utc`, `envelope`, effective `gate`, observed CDE `signal`, and
`requirements` (evidence, missing evidence, authority requirement, tool floor).
Envelope includes clean-evaluation recovery stage and revision. Decisions copy
Kingpin's actual result; the audit layer does not evaluate policy. A null
`lease_check` means Kingpin did not reach lease validation, including when review
or another higher-precedence condition decided the result.

Full arguments, text, diffs, bearer headers, lease tokens and credentials are never
copied into product events. Argument binding uses SHA-256 of the same canonical
representation as leases. HTTP additionally redacts configured authentication
secrets if accidentally reflected in selected fields. This is not universal DLP:
trusted callers and configured identifiers must not put unrelated secrets in
identity fields. Hashes of low-entropy arguments are not secrecy guarantees.

## Vocabulary

| Event | Actual fact recorded |
| --- | --- |
| `authentication.rejected` | Authentication/ownership/permission refused; no authority evaluation |
| `cde.signal.created` | Kingpin received the selected CDE signal; event timestamp is observation time |
| `authority.requested` | Request submitted to Kingpin with its evaluation binding |
| `authority.decision` | Actual result, effective envelope/gate, requirements and lease check |
| `authority.contracted` | Existing envelope contraction occurred |
| `authority.restored` | Existing one-step restoration occurred |
| `recovery.stage_changed` | Clean stage changed or restoration completed |
| `lease.issued` | Lease identity, epoch, scope/binding and expiry committed |
| `lease.rejected` | Decision's actual lease validation failed; detailed reason retained |
| `lease.revoked` | `NONCE_REVOKED` or legacy token `EXPLICIT_REVOCATION`, distinguished by reason |
| `capability.revoked` | Existing context/tool revocation, with resulting envelope |
| `lease.epoch_advanced` | Revoke-all advanced epoch; old lease rows were not rewritten |
| `review.requested` | Actual HUMAN REVIEW decision; no resolution implementation |
| `tool.enforcement.allowed` | Gateway permitted the operation |
| `tool.enforcement.denied` | Gateway refused deny/constrain/quarantine outcome |
| `tool.enforcement.review` | Gateway held for HUMAN REVIEW |
| `tool.enforcement.failed` | Invalid input, CDE/runtime/authority/state failure |

The gateway simulates enforcement. No event claims successful tool execution.
Direct `validateLease()` remains a read-only diagnostic; decision-time failed
validation produces `lease.rejected`. Repeated idempotent revocation calls each
append evidence of the successful operation, without reviving or further changing
the lease.

## Storage and failure boundaries

Both governance stores expose `tx.audit.append(event)` and detached ordered
`getEventsForRequest(request_id)`. There is no update/delete audit API. Memory
commits a cloned event array with cloned state. SQLite schema **3** adds a separate
`governance_events` table, unique event IDs, request index, AUTOINCREMENT sequence,
and update/delete rejection triggers. Migration `003_governance_events.sql`
preserves all version-2 state and begins an empty audit history; it does not invent
historical events. Version 1 still migrates through 2, then 3. Migration runs in
one transaction after verifying the exact prior schema. Incompatible/corrupt
stores fail explicitly without reset. Fault-injected migration tests prove rollback.

Kingpin decision, consumed ID, envelope/recovery transitions and their events are
one transaction. Lease issuance, nonce revocation, legacy/context revocation and
epoch advancement likewise commit with their required events. Append failures
roll back the entire operation. SQLite uses existing BEGIN IMMEDIATE, busy timeout
and synchronous FULL settings, serializing concurrent writers. Rolled-back
sequences may be reused; committed events remain ordered.

Enforcement is a separate transaction after a decision and the unchanged legacy
logger. The gateway must persist enforcement evidence before responding with the
normal result; failure returns an error, never allow. A crash/failure between the
decision and enforcement can leave a decision without an enforcement event. That
is an incomplete lifecycle, not evidence of execution. A transport failure can
also occur after commit; retries are not exactly-once issuance.

Rejection logging is best effort when the request is already being refused:
authentication/input/runtime errors still refuse if auditing is unavailable.
No new authority transition occurs on those error paths. If audit persistence
itself is broken, a failure event cannot be guaranteed. Query failures do not
participate in writes or decisions. Structural corruption of required persisted
audit evidence does fail governance writes closed. Startup/transaction integrity
checks currently scan stored events; this remains a small evaluator store, not a
high-volume analytics service.

## Reconstructing a request

Use the trusted in-process API; no public audit endpoint is added:

```js
const events = authority.getEventsForRequest(requestId);
for (const event of events) console.log(JSON.stringify(event));
```

A standalone trusted reader can reopen an existing database without running an
authority operation:

```js
import { SQLiteStateStore } from './kingpin/state/sqlite.js';
const store = new SQLiteStateStore({ filename: '/absolute/path/evaluator.sqlite' });
try { console.log(store.getEventsForRequest(requestId)); }
finally { store.close(); }
```

Default gateway storage remains process-local memory. An evaluator requiring
restart history injects `KingpinAuthority({store: new SQLiteStateStore(...)})`
through the existing application factory. `/turn` is evaluation-only and does not
produce a governed tool lifecycle; CDE persistence remains outside scope.

No signing, cryptographic chaining, trusted clock, backup rollback protection,
retention service or HUMAN REVIEW resolution is supplied. SQL triggers protect
normal writes, not a hostile database owner who can alter schema/files. Existing
process/filesystem trust boundaries remain necessary.
