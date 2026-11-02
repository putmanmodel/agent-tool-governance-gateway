# Current limited standalone SDK contract

This contract describes the current limited prerelease, including the qualified
SQLite active-close repair. Historical baseline fixtures and private artifacts
remain unchanged in the source project's qualification directories; historical
defect descriptions do not define the current package.

## Supported scope and environment

The initial limited SDK release supports the built-in MemoryStateStore and SQLiteStateStore. Custom store injection remains available as an advanced trusted-host extension mechanism. Independently implemented stores have not been qualified and are outside this release’s support and compatibility guarantee. Constructor acceptance does not establish store conformance.

Supported interfaces comprise the installed package's documented authority,
policy/authentication, leases/revocation, HUMAN REVIEW, execution-accounting
storage/transitions, and synchronous built-in-store lifecycle. Documented built-in
transaction repositories are supported advanced trusted-host operations, not an
independent-store conformance promise. Execution records are accounting facts,
not effect proof. Lease validation is point-in-time authorization evidence, not
irrevocable permission.

Qualified environment: Node.js 24.14.1, macOS / Darwin arm64, MemoryStateStore and
SQLiteStateStore using Node's built-in `node:sqlite` `DatabaseSync`. The RC runtime
reports SQLite 3.51.2; the qualification manifest records the measured version.
Qualification installed local tarballs into unrelated consumer directories. Public
distribution is through npm; see [README.md](README.md) for the exact current install command. The
`engines: >=24` admission range does not qualify every Node >=24 environment.
SQLite uses local files, packaged schema/migrations and an existing parent directory.

Linux, Windows, x64, other Node versions, network filesystems, and broader
crash/power-loss recovery are unverified. No guarantee covers hosted-model behavior,
production deployment security, distributed exactly-once execution, cancellation,
external-effect rollback, hostile same-user process isolation, a general error-code
taxonomy, or arbitrary future upgrade/downgrade compatibility.

## Install and run

In an unrelated Node project, install the exact prerelease version shown in
[README.md](README.md). Use an exact version for reproducibility rather than relying on a moving
dist-tag.

Use `.mjs` or a project with `"type":"module"`. No running CDE, Python, gateway,
network service or executor is needed. The shipped [SDK_EXAMPLE.mjs](SDK_EXAMPLE.mjs)
is a complete public-import example for memory, SQLite, review, revocation and
reopen. Copy it into your project and run `node SDK_EXAMPLE.mjs`; it creates
`example.sqlite` exclusively in the current directory, so use a fresh directory.
Signals in that example are explicitly synthetic compatible inputs, not live CDE.

All APIs below are synchronous. No authority API returns a Promise. Exceptions
propagate to the host; do not convert an exception into permission.

## Export boundary and support tiers

| Import | Named exports |
| --- | --- |
| `kingpin-runtime` | `KingpinAuthority`, `MemoryStateStore`, `loadPolicy`, `validatePolicy` |
| `kingpin-runtime/state/sqlite` | `SQLiteStateStore` |
| `kingpin-runtime/auth` | `AccessError`, `createAuthentication`, `loadAuthentication` |

There are no default exports. Other package subpaths, including `package.json`,
are not exported. Consumers must not use filesystem deep imports. SQL, default
policy and implementation modules are private runtime resources. Their presence
is not an API. Resources resolve relative to the installed package.

Authority methods below are supported trusted host operations. Store transactions
are an advanced trusted extension boundary: they persist caller-supplied facts,
not an authentication or policy boundary. Diagnostic members are identified below.
The public writable `authority.clock` is recorded legacy host behavior; it is not
an untrusted control. Underscore methods are unsupported implementation details:
`_lookup`, `_tools`, `_envelope`, `_audit`, `_decide`, `_determine`, `_reviewAudit`,
`_reviewAccess`, `_revalidateReview`, `_issue`, `_validateLease`,
`_validateLeaseRecord`, `_revoke`. They remain unchanged, not removed or hidden.

## Trust and ordering

The host authenticates principals, chooses policy/store paths, constructs the
actual tool operation and selects signals and evaluation IDs. Workload fields
cannot establish principal identity, tool class, authority, epochs or validity.
Compatible signal validation does not prove CDE provenance. The host must keep
runtime/store objects, clocks, redactors and transaction callbacks trusted.

An authority decision is permission, not execution. Approval is not authorization.
The host enforces the native result and independently observes effects. A fresh
operation/retry needs fresh evaluation; do not replay an old decision or transfer
an approval between agents. Review resume instead uses its exact bound one-use
protocol below. Calls are synchronous through commit, but the host must preserve
ordering across asynchronous signal evaluation, authorization and enforcement.
A valid lease or committed authorization does not lock external resources or
cancel an operation after later revocation.

No executor, cancellation, checkpoint, external rollback, exactly-once delivery,
distributed ordering, cryptographic lease signature, database tamper detection,
backup rollback protection, or live CDE integration is supplied.

## Shared inputs

### Request and context

Authority requests require nonblank string `speaker_id`, `channel_id`, and for
`decide`, nonblank `tool`. `session_id` omitted/null defaults to `"default"`.
`scene_id` and `task_id` omitted/null are accepted; otherwise they must be nonblank
strings. Strings are not generally trimmed. Scope precedence is scene, then task,
then agent: `scene:<scene_id>`, `task:<task_id>`, `agent:<speaker_id>`.
The resulting context is `{session_id,speaker_id,channel_id,scope_key}`.

`args` is not universally required by `decide`. `dry_run` satisfies evidence only
when exactly `true`; a non-nullish `diff` satisfies it if `String(diff).trim()` is
nonempty. Consequently `0`, `false`, and ordinary objects can satisfy diff
presence, while an empty array does not. Unknown extra request fields are usually
ignored; meaningful review binding fields are listed below. Unknown tools are
successful denials (or higher-precedence quarantine), consume IDs and update state.
Request-selected gate/class/requirements/grants are not policy inputs.

### Compatible governance signal

Required checked fields:

| Field | Value |
| --- | --- |
| `schema_version` | `"1.0"` |
| `scope_key` | Exactly the computed context scope |
| `gate` | Numeric 0, 1, or 2 |
| `gate_label` | Respectively `PASS`, `EVIDENCE REQUIRED`, `LEASE REQUIRED` |
| `evidence_requirements` | Gate 1: exactly `["dry_run","diff"]`; otherwise `[]` |
| `authority.requirement` | Gate 2: `lease`; otherwise `none` |
| `authority.recommendation` | Gate 2: `request_external_lease`; otherwise `none` |
| `reason_codes` | Exactly one gate-compatible reason below |
| `deviation.severity`, `ema_severity`, `confidence` | Finite numbers in [0,1] |
| `deviation.active`, `enter`, `exit` | Booleans |
| `deviation.vector` | Non-array object, finite nonnegative numeric values; empty accepted |

Gate 0 reason: `DEVIATION_INACTIVE`. Gate 1 reasons: `LOW_CONFIDENCE`,
`REVIEW_THRESHOLD_REACHED`, `DEVIATION_PERSISTING`. Gate 2 reasons:
`LEASE_THRESHOLD_REACHED`, `QUARANTINE_THRESHOLD_REACHED`.
`active === (gate !== 0)`, enter implies active, exit implies inactive.
Extra fields are not globally rejected. This is runtime acceptance, not a claim
that an external descriptive JSON schema enforces identical acceptance.

### Audit context

Optional `{request_id,principal_id,decision_id,redact}`. Nullish request ID generates
UUID; principal/decision ID default null; `decide` generates a nullish decision ID.
IDs are trusted host assertions, not authentication. `redact` is an optional
synchronous trusted function. Invalid event metadata or callback failure can
reject the whole operation. `resolveReview` uses only its optional redactor;
review correlation stays bound to the original request.

## Authority API

`new KingpinAuthority({clock=Date.now,auditClock=Date.now,policy=loadPolicy(),store=new MemoryStateStore()}={})`
validates/copies policy and binds the store fingerprint/catalog. It does not
validate clock callability up front. The host owns injected stores; authority has
no `close` or store accessor. `clock` remains publicly writable. `policyContext`
returns frozen `{schema_version,policy_version}`; `states` returns frozen `{size}`
for diagnostics, not a mutable authority map.

| Method | Inputs / output / effects |
| --- | --- |
| `decide(signal,request,evaluation_id,auditContext?)` | Trusted nonblank evaluation ID; returns decision below after atomic context, replay, recovery, revocation, review and audit work |
| `issue(request,auditContext?)` | Evaluated context, eligible tool, object args and seconds; creates lease and audit; returns lease below |
| `validateLease(request)` | Transactional point-in-time `{valid,reason}`; no audit; malformed context/store errors throw |
| `hasValidLease(request)` | Boolean projection; same exceptions |
| `revoke(request,auditContext?)` | Existing context, truthy token or known tool; returns `{revoked:true,context,target,capability_envelope}`; increments revision, writes audit |
| `revokeLeaseNonce(nonce,auditContext?)` | Known lease ID; returns `{revoked:true,lease_nonce}`; permanent idempotent nonce state, repeated calls still append audit |
| `revokeAllLeases(auditContext?)` | Returns `{revoked:true,lease_epoch}`; increments global epoch on every call |
| `reviewIdForDecision(decision)` | Exact returned object → review UUID or null; clone/other authority/restart loses WeakMap association |
| `listReviews(principal)` | Detached pending records within trusted reviewer scope; no pagination |
| `getReview(reviewId,principal)` | Detached full record; missing/forbidden throws |
| `resolveReview(reviewId,resolution,principal,auditContext={})` | `approve` or `deny`; returns `{review,ready_for_consumption,execution_authorized:false}` |
| `consumeReview(reviewId,request,principal)` | Returns `{review_id,correlation:{request_id,decision_id},execution_authorized,reason,authority_decision}`; consumes or invalidates approval |
| `recordAuthenticationRejection(auditContext,reason)` | Only `AUTHENTICATION_REQUIRED` / `FORBIDDEN`; returns undefined, appends event |
| `recordEnforcement(request,auditContext,{outcome,evaluation_id=null,reason_codes=[]})` | allow/human_review/deny/constrain/quarantine/failed; returns undefined, records separate host enforcement fact |
| `getEventsForRequest(requestId)` | Detached ordered events with sequence; diagnostic only |

### Decision shape and semantics

Exact fields: `schema_version,issuer,policy_version,evaluation_id,context,outcome,
reason,reason_codes,capability_envelope,cde_gate,tool_floor_gate,effective_gate,
effective_gate_label,evidence_requirements,missing_evidence,authority_requirement`.
Schema is `1.0`, issuer `kingpin`, decision policy version stays `demo_v1` even with
custom policy configuration. Actual configuration version is in policyContext/audit.
No request ID, decision ID, review ID or execution receipt is added to the decision.

Envelope is `{level,tools,revision,clean_evaluations,restoration_step_after:2,
revoked_tools}`. Levels: full, non_destructive, read_only, quarantined. Tool order
follows policy; revoked tools are sorted. Effective gate is max(signal gate, tool
floor). Gate 0 needs neither evidence nor lease; Gate 1 needs dry_run/diff; Gate 2
needs lease and does not union Gate 1 evidence requirements.

Precedence and native reasons:

1. `quarantine / kingpin_quarantined`.
2. `deny / capability_revoked` or `outside_capability_envelope`.
3. `human_review / low_confidence_requires_human_review`.
4. `constrain / gate_1_requires_dry_run_and_diff`.
5. `deny / gate_2_requires_valid_lease` or `allow / gate_2_lease_valid`.
6. `allow / allowed`.

Reason codes include uppercase final reason plus applicable `ENVELOPE_CONTRACTED`,
`REENTRY_PENDING`, `ENVELOPE_RESTORED_ONE_STEP`. Contraction is immediate; two clean
evaluations restore one step. Recovery does not clear revocations/replay history.
Every returned outcome commits its evaluation, including denial and review.

### Leases and revocation

Issuance uses `Number(request.seconds)` in inclusive 0.001–300 range; numeric
strings and true can pass. Expiry is `clock()+floor(seconds*1000)`. Args must be a
truthy non-array object, not necessarily plain JSON. Sorted object keys and ordered
arrays define binding. Programmatic undefined representations remain accepted in
some cases; cycles/BigInt can throw. No stricter JSON normalization is introduced.
Validation compares against `request.args ?? {}`.

Output: `{lease_token,lease_id,context,expires_at,issuer:"kingpin"}`. Token is random
UUID, lease_id is SHA-256(token), not a signature. Expiry is UTC ISO text.
Validation reason precedence: missing, out_of_scope, expired, epoch_revoked,
nonce_revoked, explicit_revoked/capability_revoked/envelope_contracted,
outside_capability_envelope, ok. Expiry equality is expired. A missing/unknown
non-string token generally returns missing; malformed context still throws.

Legacy revoke target is `{lease_id}` for token, otherwise `{tool}`. Token revoke
writes EXPLICIT_REVOCATION; tool revoke removes that capability permanently and
revokes associated leases. Both increment revision even on repeat. Nonce revoke
does not change envelope/revision. Epoch revoke invalidates older leases across
this store without rewriting rows or changing envelopes. Never clear revocation
or recreate state as retry recovery.

### Review records, permissions and resume

Review records require all these fields (nullable history fields are present):
`schema_version,review_id,request_id,evaluation_id,decision_id,principal_id,agent_id,
context,tool_id,binding,binding_hash,policy_version,policy_fingerprint,
original_outcome,original_envelope,original_reason_codes,cde_gate,
signal_reason_codes,created_at,status,resolved_at,reviewer_principal_id,resolution,
resolution_reason,consumed_at,execution`.

Binding fields: `principal_id,agent_id,speaker_id,session_id,channel_id,scene_id,
task_id,tool_id,arguments_hash,action_hash,target_hash,observation_hash,dry_run,
diff_present,diff_hash,lease_present,lease_nonce`. Hash inputs are args (nullish {}),
[action,tool_action], [target,tool_target], [plan_id,user_request], and diff.
Nullish pair components become null. Hashes bind values; they do not conceal
low-entropy data. Full argument/diff/token content is not stored in review records.

States: pending → approved/denied/invalidated; approved → consumed/invalidated.
Resolution history is immutable. `execution` here is null or
`{eligible,reason,checked_at}`: eligibility, not a side-effect receipt.

Review access requires review.access and optional exact allowed_contexts; resolve
also requires review.resolve and a reviewer different from requester. Consumption
requires runtime.evaluate, original principal/agent, matching request speaker and
allowed context, then exact bound request. These direct APIs trust host-created
principal objects; they do NOT invoke authentication resolver identity checks.

Approval rechecks current policy fingerprint/version, envelope, evidence and
attached lease (even optional leases). It never authorizes execution. Consumption
rechecks again. Wrong identity/context throws without changing the victim review;
changed binding returns REQUEST_BINDING_CHANGED and permanently invalidates.
Missing principal yields UNBOUND_REQUEST_PRINCIPAL. Other results include
POLICY_CHANGED, AUTHORITY_STATE_MISSING, AUTHORITY_CONTRACTED, uppercase lease
reasons and native authority reasons. Review revalidation uses the stored original
signal without replaying its evaluation or advancing recovery.

Persist the returned review ID yourself. Review lookup from a decision is object-
identity-local. Losing a successful consumption response does not unconsume it.
No automatic retry/acknowledgement protocol is provided.

## Policy and authentication

`loadPolicy(path=bundledURL)` synchronously reads JSON and validates; filesystem and
parse errors propagate without fallback. `validatePolicy(policy)` returns an owned,
deep-frozen structured clone. Exact plain-object root fields: schema_version (1.0),
nonblank policy_version, classes, gate_requirements, tools. Classes read_only/write/
destructive have floors 0/1/2 and envelope lists [full,non_destructive,read_only],
[full,non_destructive], [full]. Gate requirements are exactly those above. Tools
are unique trimmed nonblank `{id,class}` entries; empty tools is valid. No hot reload.

`createAuthentication(config)` requires exact `{schema_version:"1.0",principals}`
with nonempty array. Each principal has unique nonblank principal_id, role, token
(32–256 `[A-Za-z0-9_-]`). Agent also requires agent_id and nonempty allowed_contexts;
reviewer optionally allows contexts (omission is global); admin has neither.
Context keys are exactly session_id/channel_id/scene_id/task_id; first two nonblank,
last two null or nonblank. Different agent principals cannot share a session.
Unexpected config fields, roles, permissions, duplicate IDs/tokens are rejected.

Returned frozen resolver:
- `authenticate(header)` accepts case-insensitive Bearer scheme with exact token
  syntax and returns frozen principal; failure throws AccessError(401).
- `authorize(principal,permission,request?)` accepts only that resolver's original
  principal objects and required permission; runtime permissions bind speaker,
  optional agent_id and normalized exact context. Returns principal or throws 403.
- `redact(record)` returns original if no configured secret occurs in JSON encoding,
  otherwise a redacted JSON copy. Serialization errors propagate; not universal DLP.

`loadAuthentication(filename=process.env.KINGPIN_AUTH_FILE)` loads once; a nonblank
string filename is required. It masks file/parse errors as Unable to load
 authentication configuration. No hot reload or credential persistence.
`new AccessError(status)` sets status and message Authentication required only for
401, otherwise Forbidden. Status is not validated; name remains Error; no code.

Actual permissions:
- agent: runtime.evaluate, runtime.use_lease.
- authority_admin: authority.issue_lease, authority.revoke_lease,
  authority.revoke_all, audit.read, execution.read, execution.reconcile.
- reviewer: review.access, review.resolve, execution.read, execution.reconcile,
  execution.resolve.

These permissions do not provide execution endpoints in this package. Credentials,
configuration and principal establishment remain host-owned.

## Store lifecycle and extension contract

`new MemoryStateStore()` creates unbound isolated memory. An explicitly shared
store shares state between authorities with identical policy. No persistence.
`new SQLiteStateStore({filename,create=false}={})` requires nonempty string other
than :memory:. Relative paths use cwd. Truthy create uses exclusive mode-0600 file
creation; parent must exist. Default reopen requires existing file, never reset.
Host chooses paths; no request-controlled path or automatic backend switch.

Both expose bindPolicy(fingerprint,toolIds), transaction(work),
getEventsForRequest(requestId), contextCount(), close(). Binding returns undefined;
memory ignores toolIds, SQLite requires array of strings. Authority binds for you.
The custom-store constructor check only checks bindPolicy/transaction/contextCount/
close; missing other repositories/query operations can fail later.

Transaction callbacks are synchronous, non-nested and return their result after
commit; thenables reject. Repositories expire at callback end. Memory clones and
publishes on success; SQLite uses BEGIN IMMEDIATE, foreign keys, busy_timeout 5000,
synchronous FULL, schema/integrity checks. Public query returns detached records.
SQLite serializes local writers, not whole external workflows or distributed use.

Close is repeatable and terminal for that instance. Reopen SQLite using new store
and authority. Authority metadata/WeakMap lookup can still work after close;
store-dependent methods fail. Both built-in stores reject public close during an
active transaction with `Invalid governance state: transaction active`. SQLite
leaves its connection open: uncaught rejection causes ordinary rollback; caught
rejection permits normal continuation and commit. Successful close is terminal;
reopen requires a new SQLiteStateStore. See [lifecycle details](SDK_LIFECYCLE_REPAIR.md).
Async callback rejection cannot cancel its external
side effects. Callback/getter/redactor/clock external effects cannot roll back.

SQLite accepts exact recognized schema versions 1–5; migrates 1→2→3→4→5
transactionally. Version 1 leases get nonce SHA-256(token) and epoch zero; later
migrations add audit/reviews/execution tables without invented historical records.
Unknown versions, extra schema objects, invalid metadata/records/integrity reject.
Failure can leave a file requiring operator inspection. Migration may commit in
store construction before later authority policy binding fails. Changed policy
fingerprint (even label-only) rejects; no policy migration/reset exists. Rollback
failure attempts close; native cleanup errors may surface. Do not assume every
failed operation leaves an instance reusable.

### Transaction repositories

All mutation inputs are trusted host facts. Repository calls do not grant authority.
No delete/reset API exists. Missing get results are undefined. Reads are detached.

| Repository | Methods / shape |
| --- | --- |
| contexts | get(key), create(key,state), save(key,state); state {level:0..3,clean:0|1,revision:safe nonnegative integer}; level 0 requires clean 0 |
| evaluations | consume(key,id) → boolean insert-if-absent |
| revocations | list(key) → Set; add(key,tool) |
| leases | get(token), getByNonce(nonce), insert(token,lease), revoke(token,reason), revokeContext(key,reason,optionalTool) |
| leaseEpoch | current(), advance() → nonnegative safe integer; overflow rejects |
| nonceRevocations | has(nonce) → boolean; add(nonce) idempotent, requires known lease |
| audit | append(event), forRequest(requestId) → correlated array |
| reviews | get(id), list(), insert(record), save(record); pending insertion, guarded immutable transitions |
| executions | get(id), list(), insert(record), save(record); started insertion, guarded immutable transitions |

Context key is sorted-key canonical JSON of exactly channel_id,scope_key,session_id,
speaker_id, all nonblank strings. Lease fields: key,tool,args (canonical string),
expires_at_ms (finite),revoked (null/EXPLICIT_REVOCATION/CAPABILITY_REVOKED/
ENVELOPE_CONTRACTED),nonce (64 hex),issuance_epoch (safe nonnegative integer).

Do not assume equal mutation returns: memory often returns undefined; SQLite some
methods return native `{lastInsertRowid,changes}`. Memory transaction-local audit
forRequest includes sequence; SQLite's does not. Public getEventsForRequest does
include sequence in both. Some low-level constraints differ; baseline fixtures
record this rather than changing either store. These return differences are
compatibility-sensitive observations, not portable statement-result promises.

Execution record required fields: schema_version,execution_id,request_id,decision_id,
evaluation_id,principal_id,agent_id,context,tool_id,arguments_hash,request_hash,
authorization_source,review_id,scope,resource_hash,reconciliation_data,started_at,
status,completed_at,result_metadata,failure_code,reconciliation. Schema 1.0;
execution_id UUID-shaped; hashes 64 hex; identity strings 1–1024 chars. scope has
session_id/channel_id and nullable scene_id/task_id matching context. Source is
decision/review; review source requires review UUID. Timestamps are millisecond UTC.
reconciliation_data null or object JSON <=4096 bytes. started/succeeded have no
failure/reconciliation. succeeded alone has result_metadata {adapter_reported:true}.
failed has ADAPTER_REJECTED. Uncertain states use ADAPTER_OUTCOME_UNKNOWN,
RECEIPT_UNAVAILABLE or RUNTIME_DISAPPEARED. started→succeeded/failed/unknown;
unknown or reconciliation_required→reconciled_succeeded/reconciled_failed/
reconciliation_required. Unresolved states have null completed_at; terminal ones
a timestamp. Reconciliation is null or {at,method:adapter|operator,
outcome:succeeded|failed|inconclusive|unsupported,principal_id}; operator requires
principal, adapter null. Reconciled status must match outcome; required status
requires inconclusive/unsupported. Decision/review execution identities are unique;
started/unknown/reconciliation_required block duplicate resource hashes. No effect
is performed or proven merely by inserting these trusted records.

### Audit records

Base schema 1.0 required fields: schema_version,event_id,event_type,timestamp_utc,
request_id,evaluation_id,decision_id,principal_id,agent_id,tool_id,tool_class,
arguments_hash,lease_id,lease_check,outcome,expires_at_utc,policy_version,context,
reason_codes,requirements,envelope,gate,signal,lease_epoch. Unavailable values are
null; reason_codes is an array. Requirements: evidence,missing_evidence,authority,
tool_floor_gate. Signal summary: gate,reason_codes,deviation. UUID event IDs,
nonempty request IDs, UTC timestamps, hash/lease reason/shape validation apply.

Base types: authentication.rejected, cde.signal.created, authority.requested,
authority.decision, authority.contracted, authority.restored, recovery.stage_changed,
lease.issued, lease.rejected, lease.revoked, capability.revoked, lease.epoch_advanced,
review.requested, tool.enforcement.allowed/denied/review/failed.
Review schema 2.0 adds review_id/reviewer_principal_id; types review.requested,
approved,denied,invalidated,execution_authorized,execution_consumed (review prefix).
Execution schema 3.0 adds execution_id,review_id,request_hash,result_metadata,
reconciliation; types tool.execution.<execution status>. These are storage facts,
not an executor. sequence is added by public store queries. Committed sequences
order audit; rolled-back sequence numbers may be reused. Events are append-only.

## Errors, retries and compatibility limits

See [SDK_ERRORS.md](SDK_ERRORS.md) for captured actual exceptions. There is no
Kingpin-wide code taxonomy. Most exceptions are ordinary Error with message only;
AccessError adds status. Native Node/filesystem/SQLite/callback failures propagate,
and native message wording is tied to the qualified runtime, not promised across
Node releases. No new wrapper or error normalization is introduced.

Malformed values may throw TypeError before named validation; audit validation
can precede signal validation. Failed ordinary transactions roll back their state
and required events; unsuccessful inputs may tentatively mutate copies first.
Successful denied decisions consume IDs. Returned invalid review consumption
commits invalidation. Unknown lease validation normally returns false rather than
throwing. A new evaluation is needed after a committed decision. Nonce revocation
repeats append audit; legacy revoke increments revision; global revoke increments
epoch. Never blindly retry a lost consumption response.

## Compatibility policy

Prerelease candidates are immutable. Supported public imports and documented
semantics define the compatibility surface. Within the 0.1.x limited SDK line,
patch releases preserve that surface. Intentional incompatible changes during
0.x require a new minor line and explicit migration information; provide advance
deprecation notice where practical. Any urgent incompatible correction must be
identified explicitly. Unsupported internals and independently implemented store
extensions have no compatibility guarantee.

Breaking changes include supported exports/signatures, accepted inputs/coercions,
defaults, error-versus-result distinctions, decision/reason meanings and ordering,
canonical bindings, review/replay/revocation, synchronous lifecycle, persisted-data
meaning/readability, and removal of a supported environment. Native error wording
is scoped to the qualified runtime. This is not a new normalized error taxonomy.

npm package versions are distinct from decision/payload schemas, policy versions
(such as demo_v1) and fingerprints, audit schema versions, review/execution record
schemas, and SQLite schema version (currently 5). These domains do not advance
together. Supported migrations are only those explicitly described and qualified;
no arbitrary future upgrade compatibility is promised. Successors must qualify
against retained evidence. Never regenerate historical fixtures to accept an
unreviewed semantic change.
