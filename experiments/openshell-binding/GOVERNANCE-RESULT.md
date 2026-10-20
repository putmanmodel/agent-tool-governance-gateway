# Candidate A: bounded live operation binding

The bounded experiment passed on **OpenShell 0.1.5-dev.68+g0bfa1e8b0**. It did not
repeat scheme requalification. Installed 0.1.2 remains unqualified and was not used.
No CDE, Kingpin, OpenShell source, authority semantics, authentication code, operation
representation, digest rules, or Agent Governance Test Harness changes were made.

## Actual path and claim

Authenticated Supervisor Middleware -> unchanged v1 representation -> fresh real
CDE evaluation -> actual `KingpinAuthority.decide` with persistent SQLite state ->
sole/final fail-closed OpenShell request stage -> independent receiver.

`governance.mjs` maps only the operator-declared operation digest to the experiment
write-class tool `openshell.fixture.post`; other representable shapes map to an
unknown tool, which Kingpin denies. It uses the existing policy validator and
unchanged class floors/evidence requirements. A pure synthetic fixture preview
supplies dry_run/diff evidence for the permitted operation (+1 observation/effect);
it is not a remote dry-run receipt. Missing that evidence produces constrain.

CDE evaluates an operator-owned turn narrative in a stable session, with the
mapped authenticated principal as speaker. CDE is not an HTTP semantic classifier.
Its signal is consumed once by Kingpin using the actual CDE event ID. The review
case uses a separately logged real CDE history followed by an empty turn to elicit
LOW_CONFIDENCE, not a fabricated governance signal. No review is approved/consumed.

The full v1 operation, authenticated sandbox/request context, mapped principal,
operation digest and identity-bound digest are Kingpin arguments. Kingpin's
existing canonical arguments_hash and decision_id persist in its authority audit.
An fsynced experiment journal links these to the middleware request before ALLOW.
This does not change Kingpin's own hash algorithm. Authenticated request_id comes
from the authenticated RPC context; it is not a separately signed JWT claim.

Four facts remain separate:
- CDE emits a governance signal.
- Kingpin emits an authority decision and persists its argument binding.
- OpenShell enforces the returned decision; the client response is recorded.
- The receiver observes the actual operation and increments a synthetic counter,
  without consulting Kingpin, digests, or a decision token.

## Live results

The final live run used the qualified packaged gateway/VM/supervisor, one REST
endpoint (`host.openshell.internal:18089`), enforcement=enforce, one final request
middleware (order 100, fail_closed), no providers, and no later mutating stage.
Workload: existing isolated `kp-requal` microVM, `/sandbox/node` packaged client.
Only HTTP was admitted; TLS protects the middleware RPC, not fixture traffic.

| Case | Kingpin outcome | OpenShell/client | Receiver effects |
|---|---|---|---|
| Exact allowed operation | allow | 200 | 1 |
| Same operation with fake identity/action and a prior request-ID claim | allow, fresh authenticated identity | 200 | 1 |
| Method, path, query, covered-header, body mutations (5) | deny, unknown tool | 403 | 0 each |
| Missing write evidence | constrain | 403 | 0 |
| Real CDE LOW_CONFIDENCE | human_review | 403 | 0 |
| Malformed governance response | no authority decision | 403 | 0 |
| Governance deadline | no authority decision | 403 | 0 |
| CDE process unavailable | no authority decision | 403 | 0 |
| Middleware stopped, receiver still running | no invocation | 403 | 0 |

Both allowed receiver operation digests exactly matched Kingpin-bound digests.
Total run effects: **2**, one per allow. Duplicate raw queries and ordered duplicate
meaningful headers remained equal; exact body SHA256 also matched.

Evidence joins use serialized, one-request-at-a-time observation windows and the
independent operation digest. Workload correlation headers are untrusted claims,
never lookup keys for authority or proof of identity. The spoof case carried the
previous authorized OpenShell request ID but received a new authenticated ID and
new Kingpin decision/argument hash. The receiver cannot authenticate sandbox IDs.

## Mutation scope and limits

Live changed-request tests occur after an initial authorization and attempt to
reuse its claimed correlation ID. Every changed method/path/query/covered header/
body gets a new decision and is denied. Within the callback, deep-frozen operation
and identity objects reject post-decision mutation; successful responses contain
only DECISION_ALLOW, no body or header mutations. Offline independent-observation
tests flag all five post-decision operation mutations as discrepancies.

There was **no live injection of an arbitrary mutator between the final stage and
receiver**. The guarantee depends on the verified no-later-mutator/no-provider
configuration. A changed operation received downstream would fail the evidence
assertion and stop the experiment, not be undone by the receiver. This is not a
cryptographic final-wire receipt, generic TOCTOU prevention, replay prevention,
exactly-once protocol, rollback, or remote execution reconciliation. One observed
effect per allowed probe is not a general exactly-once guarantee.

The adapter has a 500ms governance deadline before the bridge's 1000ms callback
limit and OpenShell's 1500ms timeout. A late result cannot proceed to Kingpin. No
cancellation/lifecycle semantics were added. Malformed and stalled evaluator
results are operator-local fault injections; unavailable uses the real CDE child
shutdown. These controls are test-only, not workload-accessible.

## Verification and artifacts

- Experiment: 35 tests passed, including actual CDE/Kingpin invocation, binding,
  real review, failures, mutation/observation checks, and late-result suppression.
- Core Node/Kingpin: 231 tests passed.
- Python/CDE: 28 tests passed.
- Live: 13 cases passed; no new boundary discrepancy observed.

Evidence: `~/.local/state/kingpin-binding/candidate-a-20261020/` contains the
append-only governance/receiver journal, persisted Kingpin database, probe runner,
results, effective policy, and test logs. It contains synthetic payloads only.

The temporary VM, gateway, middleware and receiver were stopped after the run.
Installed 0.1.2 and its gateway configuration remain unchanged. Use only the
qualified runtime (or a separately qualified later build) for continuation.

The result supports: **For this declared operation contract and qualified
configuration, the received application operation matches the operation Kingpin
authorized.** It does not establish broader deployment readiness or new authority
semantics.
