# Persistent HUMAN REVIEW (v0.4)

HUMAN REVIEW is a bounded condition in the authority decision. A reviewer can
satisfy or reject that condition, but cannot expand the authority envelope or
override current lease, revocation, policy, or request-binding constraints.

This is an intentional v0.4 workflow addition beyond the frozen v0.3 behavior
contract. CDE still reports a signal; Kingpin decides authority; the gateway
mechanically enforces it. Initial HUMAN REVIEW still returns HTTP 428 with
`allow: false`. Normal decision precedence, policy, recovery, leases, frozen
`schemas/v1` payloads and the Paper 9 ten-key conformance envelope are unchanged.
The conformance REVIEW case still demonstrates execution withheld before review.

## State and binding

`model.js` defines strict version `1.0` review records and transition validation.
Kingpin creates a random UUID review ID, bound to server request/decision IDs,
CDE evaluation ID, authenticated requester principal, agent, session/channel/scope,
trusted tool identity, policy version and full policy fingerprint. It retains the
original human_review outcome, envelope/recovery revision, signal/review reasons,
creation time and immutable reviewer resolution history.

The request binding uses SHA-256 over the existing sorted-key canonical JSON.
Separate hashes cover arguments, action/tool_action, target/tool_target,
plan/user-request and diff. Context and requesting identity are included;
dry-run/diff presence and the hash of an attached opaque lease token are retained.
Object key order does not change the binding; array order does. The tool ID is
this implementation's action identity. The reviewer can inspect the tool, original
envelope/reasons, evidence presence, attached lease identity and binding hashes.
Full arguments, target content, user text, diffs, lease tokens and bearer tokens
are not copied into review storage. Payload-supplied reviewer/principal IDs do not
set the resolver identity. Hashes are bindings, not protection against guessing
low-entropy contents. Arbitrary annotations/unknown request fields are not policy
inputs; the binding covers all currently meaningful execution/evaluation inputs.

| State | Meaning |
| --- | --- |
| pending | Execution withheld, no reviewer resolution |
| approved | Reviewer approved; current checks passed at resolution; not yet executable |
| denied | Reviewer rejected this suspended request; terminal |
| invalidated | Reviewer approved historically but a binding/governance check failed; terminal |
| consumed | One execution authorization issued and consumed atomically; terminal |

`resolution`, `resolution_reason`, `resolved_at` and `reviewer_principal_id` are
immutable after the first resolution. Invalidating an approval never changes that
history into a reviewer denial. Denial changes no unrelated capability or lease.
Pending cannot execute. Approved does not mean permanent permission.

## Narrow authenticated API

| Route | Permission / behavior |
| --- | --- |
| `GET /reviews` | reviewer `review.access`; pending records within configured scope |
| `GET /reviews/:review_id` | reviewer `review.access`; inspect record/history within scope |
| `POST /reviews/:review_id/approve` | reviewer `review.resolve`; approve condition, revalidate, persist |
| `POST /reviews/:review_id/deny` | reviewer `review.resolve`; persist denial |
| `POST /reviews/:review_id/execute` | original agent `runtime.evaluate`; exact original request body, revalidate and consume |
| `GET /review/access` | existing reviewer marker now reports `resolution_supported: true` |

`/tool` exposes the ID in the new `X-Review-ID` response header. Its frozen v1
body stays unchanged. Resolve bodies cannot specify a reviewer or grant scope;
identity comes exclusively from existing server authentication. Approval returns
`ready_for_consumption` and always `execution_authorized: false`. Successful
execution consumption returns the gateway's mechanical allow projection with
`review_id`, `execution_authorized: true`, `authorization_consumed: true`.
A failed current check returns 403; missing/already-used/conflicting reviews fail
closed with 409. Authentication/role failures retain existing 401/403 behavior.
Inspection/list failures do not reveal foreign review contents.

Agent and authority_admin roles do not acquire reviewer permissions. Reviewer
configuration may specify `allowed_contexts` using the same exact
session/channel/scene/task tuples as agents. An existing reviewer entry without
that field is a globally scoped reviewer; administrators must configure scopes
when narrower review access is wanted. Neither reviewer nor admin can consume an
agent's approval. A wrong agent/context cannot mutate the victim's review. The
original agent changing a bound tool/action/target/argument invalidates the
approval; it must obtain a fresh evaluation/review.

Trusted direct APIs are `listReviews`, `getReview`, `resolveReview`,
`consumeReview`, and `reviewIdForDecision`. These are host control-plane methods,
not an alternative authentication channel. Do not expose runtime/store objects
to acting agents. Unauthenticated direct decisions (including the conformance
harness) can record a hold, but cannot resolve it into executable permission:
revalidation refuses an unbound requester principal.

## Revalidation and one-time authorization

Both approval and consumption run inside the existing governance transaction:

1. Validate review state, requester/reviewer permissions and scope. Consumption
   checks the authenticated original agent/context and exact request hash.
2. Require the same policy version and full fingerprint. Opening a bound store
   under incompatible policy already fails closed; there is no policy hot swap.
3. Read current context/envelope. Any stricter envelope than the suspended request
   invalidates it. No stored signal is replayed to advance recovery.
4. If a lease was attached, resolve its stored identity and check scope/argument
   binding, expiry, issuance epoch, nonce revocation, legacy token/context
   revocation and current envelope. Even an optional attached lease must remain
   valid. All detailed existing validation reasons remain distinguishable.
5. Run the same Kingpin decision projection for current envelope membership,
   trusted tool floor, evidence and required lease, satisfying only the original
   LOW_CONFIDENCE human-review branch. Only `allow` is eligible.
6. Persist resolution or atomically transition approved to consumed with required
   events. The original CDE ID stays consumed; no new CDE evaluation occurs here.

Default policy LOW_CONFIDENCE is Gate 1. Destructive tools are already outside
that envelope, so a lease-required destructive request cannot reach this review
path. Tests use valid attached read-only leases to exercise expiry/revocation;
this feature does not widen the policy to manufacture a reachable case.

## Persistence, audit and races

Both stores expose `tx.reviews.get/list/insert/save`; there is no delete/reset API.
Memory commits cloned state and events together. SQLite migration
`004_human_review.sql` advances schema **3 → 4**, adding `reviews`, unique
context/evaluation and decision bindings, consumed-evaluation foreign key,
permanent-history/identity/transition guards. It preserves all previous records;
pre-migration HUMAN REVIEW events remain historical events without fabricated
review records. Versions 1 and 2 migrate through the existing steps. Exact schema,
record and integrity verification fails closed; failed migrations roll back.
Pending, approved, denied, invalidated and consumed states survive restart.

`BEGIN IMMEDIATE` serializes resolution, consumption and nonce/epoch/context
revocation with durable FULL synchronization. First committed resolution wins.
Concurrent consumption yields at most one successful authorization. If revocation
wins before resolution/consumption, checks reject; if approval wins first,
consumption still rechecks. If consumption commits first, it has authorized one
operation at that point; later revocation cannot cancel already-authorized side
effects. Recovery never resets review history or revocation state.

Review events use the new, separate
`schemas/audit/v2/GovernanceReviewEvent.schema.json` (`schema_version: 2.0`),
adding `review_id` and `reviewer_principal_id` to existing audit correlation:
`review.requested`, `review.approved`, `review.denied`, `review.invalidated`,
`review.execution_authorized`, `review.execution_consumed`. They preserve original
request/evaluation/decision IDs and requester principal throughout. Existing
non-review events and persisted version-1 events remain valid. No canonical
conformance or operational JSONL fields are added.

Required review events commit atomically with review transitions. An audit or
state failure rolls the operation back and never returns authorization. Gateway
enforcement evidence is a subsequent existing audit transaction: failure after
consumption refuses the response and leaves the review consumed, preventing
replay. A lost response similarly requires a fresh request; consumption is
at-most-once authorization, not guaranteed execution or exactly-once delivery.

## Limits

Demo tools remain simulated; evaluation mode supplies real sandbox effects and
execution receipts as described below. No automatic retry protocol, cancellation,
dashboard, workflow engine or cryptographic signing is supplied. Database/process owners remain trusted. Triggers/validation catch
structural corruption, not a hostile owner who rewrites valid records/history or
rolls back the entire database. Existing bearer-token transport/deployment limits
still apply. Review inspection deliberately supplies hashes and trusted summaries,
not a full sensitive payload browser. Storage checks scan history and pending
listing is unpaginated, consistent with this small evaluator runtime.

The subsequent [controlled evaluator package](../../evaluation/README.md) supplies
an optional real filesystem adapter after gateway permission and consumption.
The default demo still simulates enforcement. Review semantics and at-most-once
limitations described above are unchanged; no success event claims atomicity
between governance storage and external execution.

The [execution ledger](../../execution/README.md) now separately tracks post-review
side-effect starts, terminal receipts and uncertainty. Reconciliation never
unconsumes or reinterprets the original pre-execution review.
