# Kingpin runtime

A transport-independent Node ES module with memory-default and opt-in SQLite state. It uses only Node built-ins, not Express, the gateway, Python, or CDE implementation code.

```js
import { KingpinAuthority } from './kingpin/index.js';

const kingpin = new KingpinAuthority();
const decision = kingpin.decide(governanceSignal, authorityRequest, evaluationId);
```

`decide(signal, request, evaluation_id)` is the primary evaluation entry point.
Its existing argument order and `AuthorityDecision` output are unchanged.
The trusted caller supplies the selected CDE event ID separately from the
request. CDE supplies requirements, not grants. Keep one runtime instance for
related requests. Envelopes, leases, revocations and consumed IDs live behind the
injected state store. The default is a fresh memory store; an explicitly reopened
SQLite store retains governance state across processes. `clock` may be
injected in the constructor for deterministic expiry tests.

Existing control-plane operations remain `issue(request)`, `revoke(request)`
and `hasValidLease(request)`. Lease issuance returns the existing opaque handle;
v0.4 adds `revokeLeaseNonce`, `revokeAllLeases` and detailed `validateLease`
results. These new persistent semantics are documented in the
[lease revocation guide](LEASE_REVOCATION.md); no signing changes are included.
Calls are synchronous; the gateway still serializes CDE evaluation through
enforcement, together with issuance and revocation, to preserve ordering.

- `index.js`: public export.
- `auth/`: authenticated gateway principals and permissions; see the [auth guide](auth/README.md).
- `authority.js`: authority decisions and signal validation through state interfaces.
- `state/`: memory and optional SQLite stores; see the [state guide](state/README.md).
- `policy/`: validated local JSON tool configuration; see the [policy guide](policy/README.md).
- `package.json`: explicit ES module boundary, no external dependencies.
- `../gateway_node/kingpin/authority.js`: compatibility re-export only.

The [v0.3 contract](../docs/v0.3-behavior-contract.md) and
[v1 schemas](../schemas/v1/) define the preserved behavior and payload shapes.
Schemas remain descriptive/test-validated; installing stricter runtime schema
validation here would change existing acceptance/coercion behavior.

## Extraction verification

`tests/fixtures/pre_extraction_authority.json` was captured by
`tests/fixtures/authority_cases.mjs` from the original gateway-local implementation
at commit `a7dda4aeac0f3501daa395ca1b0a6d6a9657a7a2`, before moving its source.
The regression test compares complete decisions and error messages against
that frozen oracle. It covers Gate 0/1/2, tool floors, evidence, HUMAN REVIEW,
contraction/recovery, leased allow, scoped revocation and evaluation-ID reuse.
Random lease tokens are used inside the scenarios but never included in the
oracle; the clock and evaluation IDs are deterministic. Do not regenerate the
oracle merely to accept a changed policy.

Gateway delegation tests exercise its registered Express handlers with injected
collaborators. They verify that the original request, CDE signal and selected
CDE event ID reach Kingpin, and that all five returned outcomes are mechanically
projected even when a test decision disagrees with local tool/CDE inputs.
The existing merged demo covers actual HTTP transport.

Validation for this extraction: all **27 Node tests** and **7 Python tests**
passed, including the boundary-schema tests and unchanged 32-event baseline.
The merged HTTP demo and standalone demo passed; `git diff --check` passed.
At extraction, the moved `authority.js` was also verified byte-for-byte against
its original source. The subsequent policy step externalizes static configuration
while retaining the frozen decision oracle. No substantive authority logic was left behind or required a behavioral
change. Gateway HTTP validation, CDE orchestration, request serialization, audit
logging and mechanical enforcement remain transport responsibilities.

The additional [v0.4 governance event stream](audit/README.md) records correlated
requests, decisions, transitions and gateway enforcement. It uses SQLite schema 5
when that store is selected; frozen boundary payloads and legacy JSONL are unchanged.

[Persistent HUMAN REVIEW](review/README.md) adds bounded reviewer resolution and
one-use agent consumption. Kingpin owns revalidation and the final decision;
the gateway only authenticates, transports and mechanically enforces the result.
