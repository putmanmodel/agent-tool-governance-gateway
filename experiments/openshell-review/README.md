# Candidate B: persistent human review across OpenShell denial

Bounded result: **PASS**. See [RESULT.md](RESULT.md) for observations and limits.
Candidate A and all core semantics are unchanged. This directory imports Candidate
A's authenticated bridge, HTTP-only `kingpin.openshell-operation.v1` representation,
governance adapter, fixture policy, protobuf and independent receiver. No new
packages are required; it uses Candidate A's existing dependencies.

## Flow

1. OpenShell authenticates its Supervisor Middleware RPC. Candidate A validates the
   gateway JWT and sandbox scope; request ID comes from that authenticated RPC
   context, not a separately signed JWT claim or workload header.
2. Actual request fields become the unchanged operation/binding. Real CDE produces
   LOW_CONFIDENCE from operator-owned session history and an empty turn. Unchanged
   Kingpin creates HUMAN REVIEW and persists it in SQLite.
3. `review.mjs` journals the decision and review ID, returning mechanical DENY with
   `kingpin_review_required`. OpenShell returns HTTP 403 and that reason to the
   workload. The rejected request is finished, not suspended.
4. A separate host process authenticates a scoped reviewer with existing Kingpin
   bearer authentication and calls `getReview` / `resolveReview`. Approval records
   a resolution but neither dispatches traffic nor consumes authority.
5. A fresh workload attempt receives a fresh authenticated request ID and separate
   decision. The host negative-test control passes its actual captured request to
   unchanged `consumeReview` as the authenticated original agent. The old approval
   is invalidated with REQUEST_BINDING_CHANGED. There is no execution dispatcher.

`control.mjs` is a local authenticated test control plane, not a new network API
or production reviewer UI. Operator selection of a review comes from the trusted
journal; workload claims cannot select it. `consume-fresh` requires a distinct
captured request and matching persisted authority audit before calling core APIs.
No request IDs or bindings are replaced with those from an earlier request.

## Files and local test

- `review.mjs`: reason projection and authenticated control calls.
- `server.mjs`: real CDE, persistent Kingpin, authenticated TLS gRPC, unchanged receiver.
- `control.mjs`: separate-process scoped review inspection/resolution/negative consume.
- `live.py`: serialized sandbox probes and assertions, preserving partial results.
- `review.test.mjs`: real CDE/SQLite test, including close/reopen persistence.

From the repository root, run `node --test experiments/openshell-review/review.test.mjs`.
Prerequisites are Candidate A's existing Node dependencies and `.venv/bin/python`.

## Live fixture configuration

Use only the qualified OpenShell runtime `0.1.5-dev.68+g0bfa1e8b0` or a separately
qualified compatible build. Do not substitute installed v0.1.2. This run reused
Candidate A's isolated gateway and `kp-requal` microVM; no scheme requalification
was repeated and no OpenShell code was changed.

`REVIEW_STATE` points to a new private directory, separate from all Candidate A
state. It contains middleware `tls.key`/`tls.crt`, `gateway-public.pem`,
`gateway-kid`, `operator.json`, and `auth.json`. The public key/kid must come from
the selected gateway; TLS cert must be trusted by that gateway. Never put tokens
or private keys in the repository or evidence bundle.

`operator.json` has `scenario` (review/deny/constrain) and `sandboxPrincipals`, mapping
only the authenticated sandbox UUID to `binding-agent`. `auth.json` uses the
existing schema_version 1.0 authentication configuration. Configure distinct
random bearer tokens for agent `binding-agent`, reviewer `reviewer-b`, and negative
reviewer `reviewer-other`. The agent has agent_id binding-agent. Agent/reviewer-b
allowed_contexts are session_id openshell-review, channel_id openshell,
scene_id/task_id null; reviewer-other uses session_id other.

Start `REVIEW_STATE=... node experiments/openshell-review/server.mjs --initialize`
once for a new database (omit initialize for existing state). The gRPC listener
is localhost:18443; independent HTTP receiver is port 18089. The isolated gateway
registration is name kingpin-binding, audience urn:kingpin:binding, TLS endpoint
https://localhost:18443, max payload 262144, timeout 1500ms. Its sandbox policy has
one final binding order 100/on_error fail_closed; REST/enforce/full endpoint
host.openshell.internal:18089 and binaries /sandbox/node and /usr/bin/bash.
There are no providers or later mutating stages. Archived policy.yaml and
gateway.toml record the exact run configuration (certificate path is run-local).

With the qualified gateway and sandbox running, run
`REVIEW_STATE=... REVIEW_RUNTIME=... python3 experiments/openshell-review/live.py`.
REVIEW_RUNTIME contains the qualified openshell binary and its isolated config/
directory. The runner expects sandbox kp-requal and its existing /sandbox/node.
It writes operator scenarios and private results in REVIEW_STATE, and stops if
review reason visibility fails. Use a fresh state/evidence journal for a fresh
run. Stop the sandbox and temporary services when done.

This is a bounded serialized fixture, not a concurrent, multi-tenant service.
It does not implement a continuation or authorize execution after approval.

## Licensing

This experiment is licensed under the repository root license.
