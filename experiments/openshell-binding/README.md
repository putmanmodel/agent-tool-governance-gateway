# Bounded operation binding — Candidate A

Candidate A now invokes actual CDE and Kingpin through the authenticated bridge.
See [GOVERNANCE-RESULT.md](GOVERNANCE-RESULT.md) for the live result, current configuration,
evidence, and limits. [LIVE-RESULT.md](LIVE-RESULT.md) preserves the earlier v0.1.2
failure; it is historical, not a current deployment instruction.

Use only qualified OpenShell **0.1.5-dev.68+g0bfa1e8b0** (contains b58e24c), or a
separately qualified later build. Installed v0.1.2 is unqualified. `operation.mjs`,
`receiver.mjs`, `auth.mjs`, and `bridge.mjs` remain unchanged. The new files are
`governance.mjs`, `governance.test.mjs`, and `governed-server.mjs`. The latter is an
experiment-only launcher requiring private BINDING_STATE configuration; it never
selects governance settings from workload input.

Run local tests from the repository root:

```sh
npm --prefix experiments/openshell-binding ci
npm --prefix experiments/openshell-binding test
```

The optional independent receiver launcher is:

```sh
node experiments/openshell-binding/serve-receiver.mjs
```

It binds loopback port 18089 (`RECEIVER_PORT` overrides), emits JSONL observations
to stdout, and records a synthetic effect counter. It accepts without a Kingpin
decision, including requests outside the representable subset. Protocol/parser
errors, incomplete requests, and bodies over 256 KiB do not count as effects.
State is in memory, resets on restart, and is intended for bounded test runs only.
Raw headers may contain secrets: use synthetic data only; no credentials in this
phase. This fixture is not a production service or durable execution ledger.

## Exact representation

Version: `kingpin.openshell-operation.v1`. The full authority-side representation:

```json
{
  "representation_version": "kingpin.openshell-operation.v1",
  "destination": {"scheme": "http", "host": "host.openshell.internal", "port": 18089},
  "method": "POST",
  "canonical_path": "/resource/A",
  "raw_query": "item=1&item=2",
  "application_headers": [["content-type", "application/octet-stream"], ["x-operation-mode", "set"]],
  "body_sha256": "<lowercase SHA-256 of exact entity-body bytes>",
  "sandbox_id": "<authenticated OpenShell context sandbox_id>",
  "request_id": "<OpenShell context request_id>"
}
```

`bindOperation(input, authenticatedContext)` requires trusted caller provenance;
the function cannot authenticate its argument. The later bridge must authenticate
OpenShell's extension transport and use `context.sandbox_id`, never the display
name, PID, or agent-supplied headers. The mapping to Kingpin principal/context is
operator-owned. IDs are bounded ASCII identifiers of 1–128 characters.

The operation digest is SHA-256 of UTF-8 JSON for the fixed tuple:

```
[version, scheme, host, port, method, canonical_path, raw_query,
 application_headers, body_sha256]
```

The identity-bound digest is SHA-256 of UTF-8 JSON for:

```
[version, sandbox_id, request_id, operation_sha256]
```

JSON has no additional whitespace. Tuple ordering is normative; object-property
ordering is irrelevant. These hashes bind data; they are not signatures or proof
of execution. Request IDs distinguish attempts, not reusable authority.

## Representation rules

- HTTP only, lowercase ASCII destination host, explicit integer port; no aliases
  are merged. Receiver observes Host and verifies its port against its listener.
  Host is a claim about the virtual destination, not evidence of DNS or peer identity.
- Methods are exact uppercase GET/POST/PUT/DELETE, with no case conversion.
- Path is an already-canonical ASCII subset: `/` or slash-separated nonempty
  components made of letters, digits, underscore, and hyphen. Percent encoding,
  dot segments, backslashes, repeated slashes, Unicode, and trailing slash are
  rejected. **No URL parser or second canonicalizer repairs these inputs.**
  OpenShell may canonicalize incoming paths before the future bridge; only the
  resulting path and actual receiver path are compared. No claim binds the
  original pre-canonicalization client spelling.
- Query is the exact printable ASCII suffix after the first `?`, without that
  delimiter. Duplicate values, order, empty values, percent encoding and `+`
  remain distinct. Missing query and a bare trailing `?` both map to empty string,
  matching the middleware API's information limit. Fragments are unsupported.
- Meaningful application headers are exactly `content-type` and
  `x-operation-mode`. Names lowercase, outer whitespace trimmed; every repeated
  occurrence and relative order retained. Values restricted to printable ASCII
  plus tab. Internal whitespace is preserved. This fixture has no tenant,
  credential, cookie, compression, or other header-dependent behavior.
- Body hash covers exact bytes after HTTP transfer framing is removed, with no
  JSON parsing, Unicode normalization, decompression, or semantic canonicalization.
  Maximum body: 262144 bytes; maximum input header count: 128.
- Every change to this semantic contract requires a representation version bump.

## Independent receiver and identity limitation

`receiver.mjs` does not import the binding module. It observes Node HTTP
`rawHeaders`, raw request target, method, entity-body bytes and local port, then
independently constructs the operation tuple and digest. Tests compare both
implementations. Raw target, raw headers, body digest/length, and effect count
remain available even when a request is outside the representation subset.

The receiver **cannot independently observe authenticated sandbox identity or
OpenShell request identity**. It therefore does not fabricate a full identity-bound
digest. Optional `x-kp-request-id` values are recorded as untrusted claims, with
`identity_authenticated: false`, outside the operation digest. Later correlation
must join authenticated middleware evidence to observations; a matching supplied
header is not authentication. Duplicate correlation claims must be rejected by
the later evidence join, not used to authorize at this receiver.

The effect is one in-memory count increment per complete bounded HTTP request.
It is deliberately not conditional on hashes, leases, decisions, or headers.
An unsupported operation still receives 200 and increments the counter, exposing
an upstream admission failure rather than concealing it.

## Pinned interface and later configuration

Rechecked OpenShell **v0.1.2**:

- [protobuf](https://github.com/NVIDIA/OpenShell/blob/v0.1.2/proto/supervisor_middleware.proto):
  `HttpRequestEvaluation` supplies target, ordered headers, body and context.
  `HttpRequestTarget.query` is raw; headers omit protected values. `HttpRequestResult`
  permits allow/deny, body replacement and header mutations, not a final-wire receipt.
- [input construction](https://github.com/NVIDIA/OpenShell/blob/v0.1.2/crates/openshell-supervisor-network/src/l7/middleware.rs):
  repeated visible headers are retained in wire order; credential, routing,
  framing and hop-by-hop headers are filtered out.

For live work, use the qualified packaged 0.1.5-dev.68+g0bfa1e8b0 microVM gateway, a default
Ubuntu ARM64 workload and a loopback receiver. Qualification established
`host.openshell.internal` reachability; Bash can generate HTTP without installing
curl. The alternate curl image failed manifest preparation, so do not depend on it.

Later configuration requirements (not a deployable configuration yet):

| Setting | Required value/behavior |
|---|---|
| Middleware binding | HTTP_REQUEST / PRE_CREDENTIALS |
| Stage position | Final request stage, no later mutations |
| Failure mode | fail_closed; persist decision before returning allow |
| Payload limit | 262144 bytes |
| Endpoint | host.openshell.internal:18089, REST, explicit enforcement: enforce |
| Operation | POST /resource/A; deny all other operation shapes explicitly |
| Providers | None; no body/query credential substitution |
| Headers | No cookies/credentials/content encoding or Connection-nominated meaningful headers |
| Transport identity | Authenticated extension calls, trusted sandbox-ID mapping |
| Correlation | Bridge overwrites/removes workload correlation claims; joins remain evidence only |

Do not infer deny-by-default L7 behavior from an allow rule alone: the qualification
required explicit enforcement and denial. Validate the effective deployed policy.
Do not apply this document as policy or enable the existing live gateway here.

## Historical Phase 2A plan (superseded by GOVERNANCE-RESULT.md)

Describe/ValidateConfig/EvaluateHttpRequest and protocol negotiation now have
local implementations. Implement live transport authentication; map the representation into experiment-local
Kingpin tool arguments and fresh CDE evaluation. Record authenticated decision
evidence, install the final stage, and perform independent receiver comparisons.
The bridge must reject unsupported shapes and hidden-semantic configurations;
this representation utility alone cannot detect filtered credential headers.

Success requires matching operation digests for admitted requests, no receiver
effect for denied/mutated unauthorized requests, fail-closed outages, and the
planned persisted-revocation differential against OpenShell-only admission.
Test encoded client paths through OpenShell rather than assuming its canonicalizer
matches this subset. Any hidden account/resource change, unbound post-stage
mutation, or reliance on agent-asserted identity fails the experiment. No final-wire,
exactly-once, remote-effect reconciliation, or cancellation claim is made.

## Phase 2A bridge contract (unchanged module interface)

`bridge.mjs` loads the unmodified v0.1.2 protobuf files vendored in `proto/`, with
their upstream license. The exact service is
`openshell.middleware.v1.SupervisorMiddleware`; the unary evaluation RPC is
`EvaluateHttpRequest(HttpRequestEvaluation) -> HttpRequestResult`.
Only HTTP_REQUEST/PRE_CREDENTIALS is advertised. WebSocket and response bindings
are not implemented. Protocol major 1 and the
`openshell.supervisor-middleware.contract` capability are required; unsupported
required capabilities are rejected. Configuration is intentionally empty and the
registration name must match (default `kingpin-binding`).

Vendored SHA-256 checksums:

```
bee96ac940303d8a7530e6e2283a98077bb428a05ef610b51d018ea18377bebd  supervisor_middleware.proto
60f28ee9dc846d41152f4db7e82a439c78d024786efaceb464900d1d1ad129ad  extension.proto
```

`createBridgeServer(options)` creates an unbound server. There is no live launcher,
registration, global configuration mutation, or default permissive callback.
Required options:

```js
{
  audience: 'expected-extension-audience',
  sandboxPrincipals: { 'trusted-sandbox-id': 'kingpin-principal-id' },
  authenticate: async call => ({
    principal_id: 'verified-supervisor-peer',
    sandbox_ids: ['trusted-sandbox-id']
  }),
  authorize: async (operation, identityContext) => 'allow' // or 'deny'
}
```

`authenticate` is a trusted integration dependency, not implemented JWT validation.
It must verify the transport/token issuer, signature, audience, expiry and scope,
then return the permitted sandbox IDs. Application headers and unverified token
claims must never supply this result. It is called for every RPC; no successful
Describe call creates ambient trust for later requests. The test uses a fixed
mock bearer credential on ephemeral loopback plaintext, **not live authentication**.

After authentication, the bridge uses only `context.sandbox_id` and
`context.request_id` from the protobuf context. The sandbox must be in both the
verified peer scope and the operator-owned mapping. `context.sandbox`, workspace
display names and process IDs are not authority identity. Header claims cannot
override any of these fields or supply the semantic action. `target.method`,
`target.path`, destination, query, visible headers and body supply the operation.

The callback receives the frozen full v1 representation and a frozen context with
`sandbox_id`, `request_id`, mapped `principal_id`, authenticated `middleware_peer`,
`operation_sha256` and `binding_sha256`. Only the exact result string `allow`
permits the request. Denial, errors, invalid inputs, invalid callback results, or
timeouts return DECISION_DENY with a stable non-sensitive reason code. The default
callback timeout is 200 ms per callback, and receive messages are limited to
512 KiB. Async callback deadlines do not cancel callbacks; callbacks must be
decision-only, bounded, and free of delayed effects. Synchronous callbacks cannot
be preempted by a JavaScript timer. This is not an execution/cancellation runtime.

The bridge emits no body/header mutations, correlation-header injection, or
execution claims. It validates the v1 shape, not the future experiment's full
endpoint/operation allowlist; the eventual authorization callback and deployment
policy must restrict POST /resource/A. No full CDE/Kingpin invocation occurs here.

### Protocol fidelity limits

Proto3 scalar defaults make absent body indistinguishable from empty bytes, and
absent query indistinguishable from empty string. Both are legal defaults. Empty
headers are legal too. Missing/nonempty-required identity, destination, method or
path fails closed. A malformed wire type is handled by the gRPC decoder; direct
handler tests also reject non-Buffer body inputs.

OpenShell supplies a canonicalized path and filtered/normalized application
headers, not the original wire request. The pre-credential body is exact at this
stage, not necessarily after downstream credential substitution. The receiver
still cannot authenticate sandbox identity. These limits preserve the Phase 1
design and require evidence joining and constrained live configuration.

Local tests exercise all three unary RPCs through actual serialization on a
loopback gRPC server, protocol mismatch, missing authentication, default fields,
duplicate queries/headers, identity mapping, fake workload identity/action labels,
malformed operations, and callback failure/timeout. They do not contact OpenShell.

## Licensing

Except for the vendored OpenShell protocol files under `proto/`, which retain their upstream license as provided in `proto/LICENSE`, this experiment is licensed under the repository root license.
