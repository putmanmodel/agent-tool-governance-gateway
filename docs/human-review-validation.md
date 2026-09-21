# Persistent HUMAN REVIEW completion report

Implemented on `v0.4-product`. This is a v0.4 workflow addition; initial HUMAN
REVIEW and all frozen normal decisions remain unchanged. See the
[workflow contract](../kingpin/review/README.md) for API, state and limitations.

## Implementation

- Strict review record version 1.0: pending, approved, denied, invalidated,
  consumed. Immutable request and historical reviewer resolution; execution
  eligibility/status is separate from the reviewer decision.
- Existing memory/SQLite governance transactions now expose a reviews repository.
  Explicit SQLite schema migration 3 → 4 adds review history without rebuilding
  evaluator databases; v1/v2 migration chains continue to work.
- Server-generated review/request/decision IDs correlate the original CDE
  evaluation. SHA-256 canonical binding covers original principal, agent/context,
  tool, action, target, arguments, evaluation inputs, evidence and attached lease
  identity. Sensitive full payloads and tokens are not stored in reviews.
- Scoped reviewer list/inspect and approve/deny routes; original-agent execute
  route. Reviewer permission is not inherited by agents or authority admins.
  Existing reviewers without configured scopes remain global reviewers.
- Approval and consumption recheck current policy fingerprint/version, envelope,
  trusted tool floor, evidence, attached/required lease scope, expiry and all
  existing nonce/epoch/context revocation checks. Only the original human-review
  condition is satisfied. No CDE signal replay or recovery advancement occurs.
- First durable resolution wins. Approved-to-consumed transition and its audit
  events are atomic, preventing concurrent double authorization. Approval/revoke
  races serialize; consumption rechecks current state even after valid approval.
- Separate review audit schema 2.0 adds review/reviewer correlation to actual
  requested/approved/denied/invalidated/execution-authorized/execution-consumed
  events. Existing audit v1 and frozen product boundary schemas remain unchanged.

Routes added: `GET /reviews`, `GET /reviews/:review_id`,
`POST /reviews/:review_id/approve`, `POST /reviews/:review_id/deny`,
`POST /reviews/:review_id/execute`. Existing `/review/access` now reports support.
Initial `/tool` bodies are unchanged; a new `X-Review-ID` header identifies holds.

## Files added

- `kingpin/review/model.js` — record/binding validation and immutable transitions.
- `kingpin/review/README.md` — workflow, permission, race and deployment contract.
- `kingpin/state/migrations/004_human_review.sql` — version-4 review persistence.
- `schemas/audit/v2/GovernanceReviewEvent.schema.json` — separate review event schema.
- `gateway_node/review.test.js` — 45 focused workflow regression tests.
- `tests/fixtures/review_process.mjs` — actual separate-process restart/race worker.
- `tests/fixtures/review_audit_stream.mjs` — real lifecycle for schema validation.
- `docs/human-review-validation.md` — this report.

## Files modified

- `kingpin/authority.js` — durable hold, scoped review APIs, revalidation and atomic
  consumption; shared existing decision/lease projection without changed normal rules.
- `kingpin/state/{interfaces,memory,sqlite}.js` — review repository and migration.
- `kingpin/auth/access.js` — reviewer resolve permission and optional exact scopes.
- `kingpin/audit/events.js` — review v2 producer/validation alongside existing v1.
- `gateway_node/server.js` — authenticated transport and mechanical enforcement.
- `gateway_node/{audit,auth,lease_revocation,state}.test.js` — current schema version
  and reviewer marker expectations; existing frozen assertions preserved.
- `tests/fixtures/auth.mjs` — dynamic route matching for gateway tests.
- `tests/test_audit_schema.py` — validate real complete review lifecycle against v2
  and reject missing/extra fields, while retaining v1 checks.
- `README.md`, `gateway_node/README.md`, `kingpin/README.md`,
  `kingpin/{audit,auth,state}/README.md` — current workflow/schema cross-references
  and removal of obsolete “no resolution implemented” claims.

## Regression results

| Validation | Result |
| --- | --- |
| `npm --prefix gateway_node test` | 168 passed; 0 failed, skipped or cancelled |
| `.venv-task/bin/python -m unittest discover -s tests -v` | 17 passed |
| `npm --prefix gateway_node run conformance` | 11/11 passed |
| Frozen 32-event CDE baseline | Passed in complete Python suite |
| Frozen authority oracle, default policy and memory/SQLite projections | Passed in complete Node suite |
| Authenticated merged HTTP demo | Passed all assertions, including isolated HTTP 428 hold |
| Standalone Python demo | Passed |
| SQLite v3 → v4 migration and injected migration failure/retry | Passed |
| Separate-process pending/approved/denied/consumed restart history | Passed |
| Two reviewers, concurrent consumption, approval/nonce and approval/epoch races | Passed |
| `git diff --check` | Passed |

The focused tests additionally cover agent/admin refusal, scoped reviewer access,
immutable first resolution, evidence rechecks, changed args/tool/action/target/diff/
lease binding, original agent/context ownership, expired/nonce/epoch/capability
revoked leases, authority contraction/recovery, incompatible policy, original CDE
ID remaining consumed, secret omission, audit/state rollback, corruption refusal,
real CDE-to-gateway hold/release and enforcement audit failure after consumption.
The added Python test validates all six real lifecycle event types. No Paper 9
normative IDs or conformance cases were invented for this workflow.

## Remaining limitations

The gateway simulates enforcement; consumption is at-most-once authorization,
not guaranteed tool execution. A lost response or enforcement audit failure after
consumption leaves it consumed and cannot be retried for another permission.
Revocation cannot cancel an authorization already durably consumed or an external
side effect already running. No side-effect executor/cancellation was added.

Under unchanged default policy, destructive/lease-required tools cannot reach the
Gate-1 HUMAN REVIEW path because envelope rejection has precedence. Lease tests
therefore attach real optional read-only leases; approval still checks them.

Direct runtime/store/configuration and database owners remain trusted. No signing,
anti-rollback integrity, identity-provider integration or transport hardening was
introduced. Inspection deliberately exposes hashes and trusted summaries rather
than full sensitive payloads. Historical pre-migration review events have no
invented pending records. Large-scale indexing/pagination is outside this small
workflow implementation.
