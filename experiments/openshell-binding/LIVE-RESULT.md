# Candidate A live attempt: stopped at the representation boundary

Runtime: packaged OpenShell CLI/gateway/supervisor/VM driver 0.1.2 on ARM64 macOS.
No OpenShell source changes, core Kingpin/CDE changes, or Harness changes.

## Authentication and registration passed

The service on https://localhost:18443 used a local TLS certificate whose public
certificate was installed as the registration's trust root. No insecure-transport
override was enabled. Gateway and supervisor calls carried Ed25519 JWTs checked
against the operator-provisioned gateway public key and key ID. Verification
requires typ openshell-ext+jwt, alg EdDSA, issuer openshell-gateway:openshell,
audience urn:kingpin:binding, valid issuance/expiry with lifetime <= 3600 seconds,
and consistent caller-kind/subject/sandbox claims. Tokens and private gateway keys
are not logged or copied into the project. Key rotation requires reprovisioning.

For evaluations, the signed sandbox_id must equal the protobuf context sandbox_id;
the operator map then resolves that UUID to binding-agent. request_id is received
on the authenticated RPC, not independently signed into the JWT. Bearer replay
within the token lifetime remains an upstream limitation. Workload headers cannot
set this identity. Real authenticated gateway discovery and supervisor discovery
and evaluation calls passed. The bridge is registered as kingpin-binding, attached
by policy-local key binding, order 100: the sole/final request stage.

## Blocking observation

A raw plaintext request from Bash inside the VM:

```
POST /resource/A HTTP/1.1
Host: host.openshell.internal:18089
Content-Length: 0
Connection: close
```

produced this authenticated middleware target:

```json
{"scheme":"https","host":"host.openshell.internal","port":18089,"method":"POST","path":"/resource/A","query":""}
```

The v1 operation representation accepts HTTP only. It rejected the target and
OpenShell returned 403 middleware_denied / kingpin_invalid_or_unavailable. The
receiver recorded no effects. This is not a Kingpin authority denial: the
representation rejected it before the deny-only probe callback ran.

Pinned source confirms the narrow cause:

- [middleware.rs lines 510–532](https://github.com/NVIDIA/OpenShell/blob/v0.1.2/crates/openshell-supervisor-network/src/l7/middleware.rs#L510):
  apply_middleware_chain_with_request_id delegates with the literal scheme https.
- [relay.rs around line 1864](https://github.com/NVIDIA/OpenShell/blob/v0.1.2/crates/openshell-supervisor-network/src/l7/relay.rs#L1864):
  the REST relay calls that helper.

A bounded probe of the guest-local explicit proxy address 127.0.0.1:3128 was
connection-refused. This does not establish that every alternative routing mode
is impossible. No proxy exposure, different runtime, or source patch was attempted.

Changing the reported scheme to http in the bridge would hide the discrepancy.
Changing the receiver/representation to HTTPS would require an explicit contract
revision and TLS workload setup, not merely an authentication fix. The live work
therefore stopped before adding CDE/Kingpin or asserting operation equality.

## Independent fail-closed checks passed

Operator-owned fault controls (not workload fields) exercised:

| Fault | Observed result | Receiver effects |
|---|---|---|
| Invalid DECISION_UNSPECIFIED result | 403 middleware_failed | 0 |
| Response delayed 3 seconds beyond 1500 ms registration timeout | 403 middleware_failed | 0 |
| Bridge process stopped | 403 middleware_failed | 0 |

No authenticated operation allow, real Kingpin deny, OpenShell-only differential,
mutation matrix, or authorized-versus-receiver digest equality was established.
The credential transformation negative case was not attempted. Candidate A has
not passed. No evidence here establishes added authority-policy value.

## State and reproducibility

Operator state/evidence remains outside Git in
`~/.local/state/kingpin-binding/`: TLS key/certificate, public gateway key and kid,
operator.json mapping/fault settings, original gateway config, middleware.jsonl,
receiver.jsonl (empty), fault-results.json, and supervisor.log.

`live-server.mjs` is intentionally still a deny-only authenticated probe. It reads
that directory from BINDING_STATE, accepts only local operator fault injection,
and records authenticated RPC identity and bounded fixture input metadata. Do not
use it with real secrets. `live-policy.yaml` allows the fixture endpoint broadly
at OpenShell L7 so future differential denials must come from Kingpin; the only
permitted binary is /usr/bin/bash. No providers were attached.

Registration used operator-owned TOML:

```toml
[[openshell.supervisor.middleware]]
name = "kingpin-binding"
grpc_endpoint = "https://localhost:18443"
tls_ca_cert_path = "<operator-state>/tls.crt"
audience = "urn:kingpin:binding"
max_payload_bytes = 262144
timeout = "1500ms"
```

The temporary registration was removed by restoring the saved prior gateway
configuration. The packaged gateway was restarted and remains available.
kp-binding-live is stopped; bridge and receiver are stopped. Do not restart that
sandbox until its registration/configuration has been deliberately restored.

Next decision: review this exact scheme discrepancy upstream or explicitly design
a separate HTTPS representation/receiver experiment. Do not expand into Candidate
B/C or silently weaken destination binding to bypass the blocker.
