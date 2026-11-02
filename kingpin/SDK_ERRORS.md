# Current SDK error reference

These observed exceptions are retained from the installed-artifact baseline on Node 24.14.1, with the qualified SQLite active-close repair applied. This is an observed fixture catalog, not a new taxonomy or an exhaustive list of native platform failures. Ordinary transactional failures roll back; returned denials and review invalidations are not exceptions. See [SDK_CONTRACT.md](SDK_CONTRACT.md) for retry and state effects. Native messages are runtime-specific.

| Name | Message | Code | Status | First captured case |
| --- | --- | --- | --- | --- |
| Error | Authentication required | — | 401 | package-policy-auth: auth failure |
| Error | CDE evaluation already consumed | — | — | memory:decisions: duplicate |
| Error | Forbidden | — | 403 | package-policy-auth: forged principal |
| Error | Invalid Kingpin policy: policy must be a plain object | — | — | package-policy-auth: null |
| Error | Invalid Kingpin policy: policy must contain exactly schema_version, policy_version, classes, gate_requirements, tools | — | — | package-policy-auth: extra |
| Error | Invalid Kingpin policy: unsupported schema_version | — | — | package-policy-auth: version |
| Error | Invalid authentication configuration | — | — | package-policy-auth: bad config |
| Error | Invalid governance audit event | — | — | memory:malformed-and-coercions: wrong gate |
| Error | Invalid governance state: SQLite filename required | — | — | sqlite:reopen-and-opaque-databases: memory filename forbidden |
| Error | Invalid governance state: async transaction not supported | — | — | memory:audit-store-lifecycle: async |
| Error | Invalid governance state: duplicate execution | — | — | memory: duplicate execution |
| Error | Invalid governance state: execution transition not permitted | — | — | memory: terminal execution transition |
| Error | Invalid governance state: incompatible SQLite schema | — | — | sqlite:reopen-and-opaque-databases: open extra |
| Error | Invalid governance state: invalid execution fields | — | — | memory:audit-store-lifecycle: invalid execution |
| Error | Invalid governance state: invalid review fields | — | — | memory:audit-store-lifecycle: invalid review |
| Error | Invalid governance state: policy mismatch | — | — | memory:audit-store-lifecycle: policy mismatch |
| Error | Invalid governance state: store closed | — | — | memory:audit-store-lifecycle: closed count |
| Error | Invalid governance state: store closed or transaction active | — | — | sqlite:audit-store-lifecycle: nested |
| Error | Invalid governance state: store unavailable or unbound | — | — | memory:audit-store-lifecycle: nested |
| Error | Invalid governance state: store unbound | — | — | sqlite: unbound transaction |
| Error | Invalid governance state: transaction active | — | — | memory/sqlite: close inside transaction |
| Error | Invalid governance state: transaction ended | — | — | memory:audit-store-lifecycle: escaped |
| Error | Invalid governance state: unsupported SQLite schema version | — | — | sqlite:reopen-and-opaque-databases: open future |
| Error | Invalid governance store: missing bindPolicy | — | — | memory:malformed-and-coercions: bad constructor store |
| Error | Invalid review resolution | — | — | memory:review-trust: invalid resolution |
| Error | Invalid scene_id | — | — | memory:malformed-and-coercions: bad scene |
| Error | KINGPIN_AUTH_FILE is required | — | — | package-policy-auth: missing auth filename |
| Error | Kingpin requires session, actor and channel | — | — | memory:malformed-and-coercions: missing actor |
| Error | Lease duration must be 0.001–300 seconds | — | — | memory:lease-revocation: duration 0 |
| Error | Lease requires an evaluated context and capability in current envelope | — | — | memory:lease-revocation: unevaluated issuance |
| Error | Lease requires exact args object | — | — | memory:lease-revocation: array args |
| Error | Missing evaluation ID or tool | — | — | memory:malformed-and-coercions: missing tool |
| Error | Missing, inconsistent or unsupported CDE governance signal | — | — | memory:malformed-and-coercions: bad version |
| Error | Review access forbidden | — | — | memory:review-trust: agent cannot list |
| Error | Review already resolved | — | — | memory:review-trust: approval replay |
| Error | Review binding forbidden | — | — | memory:review-trust: wrong agent |
| Error | Review not approved or already consumed | — | — | memory:review-trust: pending consumption |
| Error | Review unavailable or forbidden | — | — | memory:review-trust: missing review |
| Error | UNIQUE constraint failed: executions.resource_hash | ERR_SQLITE_ERROR | — | sqlite: duplicate execution |
| Error | Unable to load authentication configuration | — | — | package-policy-auth: bad auth file |
| Error | Unknown authority context | — | — | memory:lease-revocation: unknown context revoke |
| Error | Unknown enforcement outcome | — | — | memory:audit-store-lifecycle: bad enforcement |
| Error | Unknown lease nonce | — | — | memory:lease-revocation: unknown nonce |
| Error | Unsupported authentication rejection | — | — | memory:audit-store-lifecycle: bad rejection |
| Error | file is not a database | ERR_SQLITE_ERROR | — | sqlite:reopen-and-opaque-databases: open corrupt |
| Error | sentinel | — | — | memory:audit-store-lifecycle: rollback |
| SyntaxError | Expected property name or '}' in JSON at position 1 (line 1 column 2) | — | — | package-policy-auth: bad json |
| TypeError | Cannot destructure property 'speaker_id' of 'request' as it is null. | — | — | memory:malformed-and-coercions: null request |
| TypeError | Cannot read properties of null (reading 'gate') | — | — | memory:malformed-and-coercions: null signal |
| TypeError | this.clock is not a function | — | — | memory:malformed-and-coercions: bad clock |

Additional implementation validation uses `Invalid governance state: <detail>` for record fields, immutable bindings, transitions, policy and integrity checks; `Invalid Kingpin policy: <detail>` for exact policy constraints. Filesystem/SQLite constraints, JSON/clone/serialization/date errors and arbitrary trusted callback errors propagate. AccessError has no code and inherits Error.name. Invalid input is not guaranteed to select one particular validator first.
