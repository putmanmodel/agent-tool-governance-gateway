# v0.4 lease revocation additions

Nonce revocation and a store-wide lease epoch are **new v0.4 authority semantics**.
They were not part of the frozen v0.3 behavior contract. They do not change CDE,
policy configuration, capability floors or authority recovery. Memory is still
the default; SQLite remains opt-in. The v0.3 fixtures continue to run unchanged.

## Three distinct mechanisms

| Mechanism | API | Effect and persistence |
| --- | --- | --- |
| Existing context/capability revocation | `revoke({ ...context, tool })` | Removes one tool from that context's envelope, revokes its leases and increments the context revision. Recovery never restores the capability. |
| New nonce/individual-lease revocation | `revokeLeaseNonce(lease.lease_id)` | Adds a permanent, idempotent record for one issued lease identity. Does not alter other leases, capabilities or context revisions. |
| New global/epoch lease revocation | `revokeAllLeases()` | Atomically increments the store-wide epoch. All older leases in every context in that store become invalid. Does not modify envelopes, tool revocations or old lease rows. |

The existing `revoke({ ...context, lease_token })` operation is also preserved:
it writes the legacy `EXPLICIT_REVOCATION` reason and increments the context
revision, exactly as before. It is not silently reinterpreted as the new API.
Contraction continues to write `ENVELOPE_CONTRACTED`. These legacy reasons,
nonce records and epoch invalidation are stored separately.

```js
const leaseA = authority.issue({ ...evaluatedRequest, seconds: 60 });
const leaseB = authority.issue({ ...evaluatedRequest, seconds: 60 });
authority.revokeLeaseNonce(leaseA.lease_id);
authority.validateLease({ ...evaluatedRequest, lease_token: leaseA.lease_token });
// { valid: false, reason: 'nonce_revoked' }
// B remains valid if its existing context, binding and expiry checks pass.
authority.revokeAllLeases(); // { revoked: true, lease_epoch: 1 }
// Both A and B now have an older issuance epoch.
```

These remain trusted in-process control-plane operations. The subsequent
authentication step exposes them through admin-only `/revoke/nonce` and
`/revoke/all` routes; see the [auth guide](auth/README.md). Unknown nonces throw without creating revocation state. Repeating
nonce revocation succeeds with the same result. Each revoke-all call advances
the epoch once; it is deliberately not idempotent.

## Identity and issuance

Kingpin generates `lease_token` with `crypto.randomUUID()` on every issuance.
The persisted nonce is its SHA-256 hex digest, equal to the already returned
`lease_id`. It is derived from fresh secure randomness, not from context or args.
Two identical operations therefore receive different identities. Unique storage
constraints reject token/nonce collisions rather than reuse a prior identity.
There is no lease deletion/reuse API.

Issuance reads the current epoch and inserts token, nonce, issuance epoch,
context, tool, canonical args and expiry inside one transaction. Request-supplied
`nonce`, `lease_id`, `issuance_epoch`, `lease_epoch`, `revoked` or `valid` values
are never used to populate these facts. Neither epoch reset nor revocation clear
is exposed. Immutable record fields and permanent revocation records cannot be
updated through the repositories; SQLite also enforces identity immutability
and monotonic epoch updates with triggers.

## Validation

`validateLease(request)` returns `{ valid, reason }` from a consistent store
transaction. Reason precedence is deterministic when multiple failures apply:

1. `missing`: missing or unrecognized opaque token.
2. `out_of_scope`: context, tool or exact canonical arguments do not match.
3. `expired`: expiry boundary reached (exclusive validity).
4. `epoch_revoked`: issuance epoch differs from the current epoch.
5. `nonce_revoked`: the identity has an individual revocation record.
6. `explicit_revoked`, `capability_revoked`, `envelope_contracted`: retained
   distinctions from legacy lease state.
7. `outside_capability_envelope`: the context does not currently permit the tool.
8. `ok`: all checks pass.

Malformed request context and corrupt/unavailable storage still throw rather
than returning `ok` or a fresh permissive default. There is no `bad_signature`
result because this runtime does not implement signed leases. The hash used as
an identity is not a signature.

The compatibility method `hasValidLease` projects `validateLease().valid`.
Kingpin uses the detailed validator internally; existing authority decisions
retain their v1 wire reasons (`gate_2_requires_valid_lease` or
`gate_2_lease_valid`). No fields were added to the public lease response and
no files in `schemas/v1` were edited. New nonce/epoch fields remain internal;
no new public wire schema was necessary.

## Persistence, migration and concurrency

SQLite schema **2** adds `lease_epoch` to `store_metadata`, `nonce` and
`issuance_epoch` to `leases`, a unique nonce index, and the
`lease_nonce_revocations` table referencing issued identities. Epochs are
nonnegative safe integers, starting at zero; overflow throws instead of wrapping.
Memory implements the same repositories and transactional behavior.

Opening a recognized version-1 database validates its exact schema and records,
then applies `state/migrations/002_lease_revocation.sql` in the same
`BEGIN IMMEDIATE` transaction. Existing leases receive the deterministic digest
of their original token and issuance epoch zero; the store epoch starts at zero.
No token, expiry, args, envelope, recovery counter, consumed ID or legacy
revocation is discarded. Migration cannot reactivate a legacy revoked lease.
All new columns, backfill, indexes, triggers and `user_version = 2` commit
together or roll back together. Reopening version 2 does not migrate again.
Unknown/corrupt/incompatible schemas fail explicitly without rebuilding state.

Validation, issuance, nonce revocation and epoch advancement all use the store's
transaction lock. Concurrent processes cannot lose epoch increments or commit
an acceptance based on a snapshot taken after a completed revocation while
ignoring it. A validation serialized *before* revocation may return `ok`; this
is not an execution lock and does not cancel an already-authorized in-flight
operation. Validation never writes lease validity or reactivates anything.
The existing gateway serialization remains intact.

SQLite persists both nonce and epoch revocation across process restart. Recovery
cannot remove nonce records, decrease the epoch or rewrite issuance epochs.
Restarted memory-only processes intentionally start fresh, as before.

## Remaining security boundaries

The gateway now authenticates scoped agent, admin and reviewer principals.
Signed lease integrity, protection against token theft and protection against
direct database tampering or restoring an old valid backup are not implemented. Anyone with trusted runtime/admin or file access is inside
the current trust boundary. The `/lease` and `/revoke` routes now require admin authentication, as do the
new nonce and epoch routes. Secure transport remains a deployment requirement.
Acting-agent fields cannot forge stored state, but a valid stolen bearer token
with matching request context is not distinguished from its holder.

This is operational governance state, not PUTMAN Memory Stratification. No CDE
persistence, lease renewal, new recovery algorithm or signing was added by the
revocation step; the later authentication boundary does not change these semantics.

## Validation recorded for this step

- Complete Node suite: **67 passed**, zero failures/skips; **20 new v0.4 tests**.
- Complete Python/schema suite: **7 passed**, including the frozen 32-event baseline.
- Existing frozen v0.3 authority oracle: unchanged for both memory and SQLite.
- Merged HTTP demo: all assertions passed; standalone CDE demo: passed.
- Actual child-process nonce/epoch restart tests: passed.
- SQLite v1 migration, repeat-open, corrupt-input and mid-backfill rollback tests: passed.
- `git diff --check`: passed.

The existing state corruption test now restores schema version 2 before injecting
its corrupt envelope; no frozen v0.3 fixture or public schema was changed.
