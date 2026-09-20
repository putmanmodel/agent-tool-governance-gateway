# Kingpin operational governance state

This is a persistence boundary for authority state, not PUTMAN Memory
Stratification, associative memory or canonical semantic memory. Storage records
facts selected by Kingpin; it neither evaluates CDE signals nor decides authority.
CDE and the gateway do not access governance tables.

Nonce and epoch revocation are new v0.4 semantics; see the
[lease revocation guide](../LEASE_REVOCATION.md) for APIs and security boundaries.
The frozen v0.3 contract does not claim these features existed previously.

## Configure

Memory remains the default, with no SQLite module loaded during the existing
memory-only demo. An explicitly injected `MemoryStateStore` can also be shared
between runtime instances in one process.

SQLite is opt-in through server-side construction. Tested with Node **24.14.1**
and its built-in `node:sqlite` (which emits an experimental warning on this
version). No npm database dependencies are added.

```js
import { KingpinAuthority } from './kingpin/index.js';
import { SQLiteStateStore } from './kingpin/state/sqlite.js';

// First initialization only: explicit exclusive creation, fails if file exists.
const store = new SQLiteStateStore({ filename: '/absolute/path/kingpin.sqlite', create: true });
const authority = new KingpinAuthority({ store });
// Use authority.decide / issue / revoke / hasValidLease as before.
// Inject authority into the gateway's existing createGatewayApp({ authority }).
store.close();
```

On subsequent starts, omit `create`:

```js
const store = new SQLiteStateStore({ filename: '/absolute/path/kingpin.sqlite' });
const authority = new KingpinAuthority({ store });
```

The host chooses the filename and owns the store lifecycle. The parent directory
must exist. Initialization creates the file exclusively with mode 0600. Reopening
requires an existing file; it never creates empty state on a miss. Neither path
nor creation mode comes from tool request data. A package consumer may use the
optional `kingpin-runtime/state/sqlite` export. No environment-dependent automatic
switch or new HTTP endpoint was introduced.

## Interfaces and state inventory

`interfaces.js` documents the synchronous store contract. `transaction(work)`
provides six narrow repositories, valid only during the callback:

| Repository | Operations | Facts moved from the runtime |
| --- | --- | --- |
| contexts | get, create, save | envelope level, consecutive-clean counter, revision |
| evaluations | consume | context-local set of consumed CDE event IDs |
| revocations | list, add | persistent context-local revoked tool IDs |
| leases | get, getByNonce, insert, revoke, revokeContext | opaque token, nonce, issuance epoch, context key, tool, canonical args, expiry, legacy revocation reason |
| leaseEpoch | current, advance | store-wide monotonic lease epoch (v0.4) |
| nonceRevocations | has, add | permanent individually revoked lease identities (v0.4) |

`bindPolicy(fingerprint, toolIds)` binds the store to the exact trusted policy
configuration and checks persisted tool identities against that catalog.
`contextCount()` supports the legacy `authority.states.size` diagnostic, now a
read-only count rather than an exposed mutable Map. Direct mutation of old
internal `states`/`leases` maps is no longer supported. `close()` releases the
store. Kingpin owns initial state and every state transition; repositories do not
provide a default envelope for missing records. A new context is created only
by Kingpin processing a validated CDE signal and a server-supplied evaluation ID.

The runtime still owns contraction/restoration, effective gates, envelope
intersection, evidence checks, lease validity, HUMAN REVIEW precedence and final
decisions. Existing request, signal, lease and decision wire schemas are unchanged.

## SQLite schema and transactions

`schema.sql` retains the original version-1 bootstrap. New stores apply it and
`migrations/002_lease_revocation.sql` in one transaction to reach version **2**:

- `store_metadata`: singleton policy fingerprint and current lease epoch.
- `contexts`: canonical composite context key, level, clean count, revision.
- `consumed_evaluations`: `(context_key, evaluation_id)` primary key.
- `capability_revocations`: `(context_key, tool)` primary key.
- `leases`: token primary key, context foreign key, tool, canonical args, expiry,
  nullable legacy revocation reason, immutable nonce and issuance epoch.
- `lease_nonce_revocations`: permanent nonce primary key referencing `leases`.

Context child tables have context foreign keys; nonce revocations reference the
unique lease nonce index. New integrity triggers protect nonce identity,
issuance epoch and revocation permanence, and enforce epoch increments. Expiry is stored as a number, preserving even fractional injected clocks;
lease arguments retain their exact canonical string instead of being reparsed.

Each `decide` is one `BEGIN IMMEDIATE` transaction containing context creation (if
needed), atomic ID consumption, envelope/recovery updates, contraction-triggered
lease revocation and decision construction. The result is returned only after
commit. Consumption uses `INSERT ... ON CONFLICT(context_key, evaluation_id) DO
NOTHING`, not a separate check-then-write. A duplicate throws the existing error.

`issue` atomically reads the context/envelope and inserts the lease. `revoke`
atomically updates token or capability revocation, affected leases and revision.
`validateLease` reads one consistent transaction; `hasValidLease` retains the
boolean compatibility projection. `revokeLeaseNonce` atomically inserts an
idempotent nonce record. `revokeAllLeases` advances only the epoch row; it does
not rewrite old leases. Internal lease checks during
`decide` use the same transaction. Memory transactions use isolated copies and
publish them only on success. All callbacks are synchronous; nested/async
transactions are rejected.

SQLite uses its local write lock, a five-second busy timeout, foreign keys and
FULL synchronous writes. Lock, read, write or commit errors propagate without an
authority decision. The gateway's existing error handling returns a failed
request, never an allow fallback. This is for a single-node evaluator; it does
not change the gateway's existing serialized evaluation-to-enforcement ordering
or create distributed enforcement guarantees.

## Startup, integrity and compatibility

Creation and migration are transactional. Existing files must have version 1 or
2 and the exact corresponding expected schema. Valid version-1 files migrate to
version 2 with epoch zero and nonce = SHA-256(existing token), preserving prior
revocations and all other governance facts. Future/unknown versions, extra schema objects, malformed or
missing metadata, corrupt envelopes/leases and foreign-key violations are
rejected, never deleted or migrated by guessing. The explicit version-1-to-2
migration rolls back on any failure; no destructive reset path exists. A failed initialization may leave a file that
requires explicit operator inspection rather than automatic recreation.

Schema/integrity checks run at startup and inside transactions. Unknown persisted
tool IDs are rejected when binding the trusted policy and during later access.
A changed policy fingerprint fails startup, even if its label alone changed:
reopening with a different tool catalog must not silently expand prior authority.
Policy migration is deferred.

These checks detect structural corruption; they do not authenticate database
contents or detect a deliberate replacement with an older valid database. They
also cannot distinguish externally deleted, otherwise consistent records from
legitimate absence. Protect the local database and use the same configured file
on restart. Authentication, tamper evidence and backup rollback protection are
outside this step.

When the new v0.4 revocation operations are unused, no successful v0.3 authority
behavior changes. Failed operations now
roll back as required by the persistence contract instead of potentially leaving
partial process-local mutations. Invalid/corrupt stored state raises an error
rather than becoming a fresh envelope. Restart durability applies to Kingpin;
CDE's EMA/hysteresis remains the existing separate, process-local service state.

## Regression coverage

`gateway_node/state.test.js` and `tests/fixtures/sqlite_process.mjs` cover the full
frozen oracle with both stores, actual child-process restart, consumed IDs,
context isolation, token/capability revocation, lease expiry, quarantine and every
restoration step, concurrent consumption by two processes, transaction rollback,
closed/corrupt/incompatible stores, request-field spoofing and gateway failure
handling. Tests use temporary files and close/remove them afterward.

Validation recorded for the original persistence step: **47 Node tests passed** (including 12 new
state tests), **7 Python tests passed** (including boundary schemas and the
unchanged 32-event baseline), **all merged HTTP demo assertions passed**,
**standalone demo passed**, and **git diff --check passed**. The existing gateway,
CDE, frozen decision fixtures and public schemas were not modified.
