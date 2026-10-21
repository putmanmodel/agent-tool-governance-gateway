# Candidate B bounded live result

**PASS**, October 20, 2026 America/New_York (evidence timestamps October 21 UTC).
Runtime: **OpenShell 0.1.5-dev.68+g0bfa1e8b0**. Installed v0.1.2 was not used.
Baseline: `a5bbe8cb58e4059738d1c289876dfe6f8112cd1d`. Candidate A, core CDE,
Kingpin, OpenShell source, representation/digests and authentication are unchanged.

## Claim supported

A Kingpin HUMAN REVIEW outcome remains distinguishable and durably inspectable
when OpenShell blocks the request. Reviewer approval does not release that
rejected request or silently transfer authority to a new OpenShell attempt.

OpenShell still enforces a binary decision. Rich state persists in Kingpin;
the reason survives the actual OpenShell rejection response. This does not claim
that OpenShell stores a pending approval, suspends the HTTP operation, or supports
resumption. No approval-to-retry continuation was implemented.

## Observed results

| Probe / control action | Observed result | Receiver effects |
|---|---|---|
| Actual middleware request, real CDE LOW_CONFIDENCE | Persistent HUMAN REVIEW; HTTP 403 `kingpin_review_required` | 0 |
| Invalid token / requesting agent / wrong-scope reviewer approves | Rejected; review still pending | 0 |
| Separately authenticated scoped reviewer approves | Approved, `execution_authorized:false`, `consumed_at:null` | 0 |
| Separate-process inspection after approval | Approved and unconsumed persists | 0 |
| Fresh request, fake old correlation/review/identity/approval headers | Fresh authenticated request ID, separate HUMAN REVIEW; HTTP 403 `kingpin_review_required` | 0 |
| Reviewer tries consumption | Rejected (no runtime.evaluate permission); original stays approved | 0 |
| Original agent consumes old approval using fresh actual captured request | `execution_authorized:false`, `REQUEST_BINDING_CHANGED` | 0 |
| Inspect after failed consumption | Original invalidated; approval resolution retained; consumed_at null | 0 |
| Repeated consumption | Rejected | 0 |
| Reviewer denies fresh request's separate review | Review denied, no execution authority | 0 |
| Ordinary unknown-tool deny | HTTP 403 `kingpin_denied`; no review | 0 |
| Missing fixture write evidence | Constrain; HTTP 403 `kingpin_constrained`; no review | 0 |

Total independent receiver effects: **0**. The unchanged receiver was listening
throughout the probes; its journal contains no received application operations.
Listener evidence was captured before cleanup. This is a bounded observation
window, not a distributed exactly-once or indefinitely delayed-effects proof.

Original request `48cf4916-b89a-4fbd-9783-8d0eada6c662` created review
`d27aeda1-f423-452e-83a7-ee52689ee508`. Fresh request
`855881ca-7f47-4e88-9a5b-7b9b774ba4ef` created a separate review
`31ef97b3-c595-481e-8d66-a78fbc2493bb`.
Both were authenticated to sandbox `010dc369-f24a-437c-b194-15b7a9d4e012`
and mapped to principal binding-agent. Their application-operation digests were
identical and their identity-bound digests differed. Core arguments hashes were
respectively `778542b171dd54e1f300ac416cc8a6464e513b16cf7a3ccc6c68920dfb9de68b`
and `185287ed2b239af6cff41365d8cb0366e60284c6f714fbdc03cba9c4b2b2ce08`.
The request ID changed through OpenShell's actual authenticated context, never
through fixture rewriting. Spoofed workload claims could neither select the old
review nor become reviewer authority.

## Four distinct evidence sources

- **CDE:** real history plus an empty operator narrative produced LOW_CONFIDENCE.
  CDE is not claimed to classify HTTP semantics. No fabricated governance signal.
- **Kingpin:** actual decide/getReview/resolveReview/consumeReview APIs persisted
  review, resolution and failed binding consumption in separate SQLite state.
- **OpenShell:** authenticated Supervisor Middleware returned DENY with a distinct
  reason; the sandbox client actually received HTTP 403 and that reason.
- **Receiver:** unchanged independent receiver logs operations/effects without
  enforcing Kingpin decisions. It received none during this run.

Reviewer control is a separately authenticated local process using unchanged
Kingpin APIs and scoped bearer credentials, not a new production HTTP endpoint.
Approval alone remained approved-but-unconsumed; the later intentional mismatch
invalidated it under existing semantics. No dispatcher was attached to review
control, and no request was released or replayed.

## Validation and evidence

- Candidate B: 1 comprehensive test passed (real CDE, scoped authentication,
  reason distinctions, SQLite close/reopen, approval and fresh-binding rejection).
- Existing Candidate A: **35/35** passed.
- Core Node: **231/231** passed.
- Core Python: **28/28** passed.
- Live: four sandbox requests plus authenticated control assertions passed.

Durable local evidence:
`/Users/stephenaputmanjr/.local/state/kingpin-binding/candidate-b-20261020/`
contains events.jsonl, control.jsonl, results.json, governance.sqlite, exact
policy/gateway configuration, listeners.txt, all four test logs, and manifest.json
with evidence and qualified runtime binary SHA256 hashes. Credentials/private
keys are excluded. The original run state remains in
`/private/tmp/kingpin-candidate-b/`; the durable copy is independent of that path.
Temporary Candidate B services and sandbox were stopped after the run; the
unrelated installed gateway was not stopped.

## Bounds and stopping rules

PASS means reason visibility, persistent review distinction, scoped resolution,
zero observed effects and non-transferability of an old approval to a fresh
binding in this declared HTTP-only configuration. A missing reason in the client,
any receiver effect, spoofed authority, or successful fresh-binding consumption
would fail/stop the experiment. No alternate requester notification channel was
needed. There is no claim of HTTPS support, cancellation, rollback, leases,
concurrent multi-tenant operation, or approval-to-retry execution. Supporting a
positive continuation would require a separately scoped design and is outside
this experiment.
