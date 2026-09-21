# Controlled evaluation security boundaries

This is a single-node evaluator under a trusted local host/operator, not a
production security boundary against that operator.

## Implemented guarantees

- HTTP authentication precedes governance operations. Agent, authority admin and
  reviewer permissions remain separated; audit reading is admin-only.
- Trusted server policy determines tool identity/class, floors and requirements.
  Request-supplied classes do not downgrade requirements.
- SQLite persists authority, consumed CDE IDs, leases, nonce/epoch/context
  revocation, review state and required application audit events.
- Reviews bind to the original principal/context/request. Approval does not expand
  authority and revalidation precedes atomic one-use authorization consumption.
- Nonce revocation targets an issued lease; epoch advancement invalidates older
  leases without rewriting them. Existing capability/context revocation remains
  distinct and recovery does not undo revocation.
- Application audit is append-only through supported APIs and commits atomically
  with required governance changes. Adapter execution follows a committed
  enforcement authorization event; it does not create a new claim of external
  side-effect completion.
- Missing/incompatible/corrupt required state fails closed. Initialization is
  explicit; no reset/clear/recovery override is exposed over HTTP.
- Evaluation startup rejects demo fixtures. `/tool` rejects demo/control fields;
  no force-gate, reset-ID, recovery-stage or raw authority mutation route exists.
  The observation route accepts text, not a supplied governance signal. CDE,
  Kingpin policy/envelope/floors/leases still determine the result.
- The POSIX adapter is a flat, private directory boundary. Absolute paths,
  traversal, nested paths and symlinks are rejected; file opens use O_NOFOLLOW,
  and fstat rejects non-regular or multiply-linked files before read/write/delete.
  Files are accessed through opened descriptors; write validation precedes
  truncation. The root identity is checked before each operation. The agent has
  no directory, link, rename, arbitrary shell or direct-host filesystem API.
- Configuration, credentials, database and Python executable cannot be placed
  inside the tool sandbox. Status does not disclose paths, secrets or principals.

## Non-guarantees and operating assumptions

- No TLS termination is supplied. Listener configuration is restricted to
  loopback. Bearer-token theft remains possible on a compromised host/transport.
  Tokens are not scoped by expiry and there is no remote identity provider.
- No cryptographic lease signing/integrity, audit chaining or database
  tamper/rollback protection exists. Privileged host code, SQLite owners and
  backup operators remain trusted.
- The sandbox and its ancestors must remain exclusively under the trusted host
  operator's control; no concurrent local process may rename roots, introduce
  links or tamper with files. Mode 0700 and ownership are required on the root.
  This is not an OS isolation boundary against a malicious same-user process,
  privileged process or hostile mount/filesystem implementation.
- Revocation cannot cancel an operation already authorized and executing.
  At-most-once post-review authorization does not guarantee external side-effect
  completion. A crash, lost response or adapter failure after consumption can
  leave a consumed review and an absent or partial side effect. No distributed
  transaction spans SQLite and filesystem writes. Normal non-review operations
  retain existing retry/lease semantics and are not made one-use by packaging.
- Audit describes governance and gateway permission; an `allowed` enforcement
  event is not proof that the adapter completed. The synchronous response's
  `tool_result` reports completion in that running process. An adapter failure
  can occur after an authorization event. No new success-event semantics were
  invented in this packaging step.
- CDE is internal/trusted and must not be exposed directly. Evaluation uses
  private stdio instead of the demo's unauthenticated loopback CDE service.
  CDE session history remains in memory and resets on process restart; Kingpin
  persisted governance is not reset. A failed child is not silently replaced.
- `user_request` on the observation route is agent-provided text, not attested
  provenance or proof of intent. CDE is not an adversarial content classifier;
  hard tool floors, envelope and lease checks remain Kingpin's responsibility.
- State/audit checks scan stored history and review/audit queries are unpaginated.
  There is no multi-node coordination, external execution cancellation, general
  plugin loader, uploaded policy script, SDK framework or production hardening.

Keep generated configuration/checkpoints private. The example client intentionally
holds all roles for a local operator walkthrough; an actual agent must not receive
the auth file, reviewer/admin credentials, runtime object or database handle.
