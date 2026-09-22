# Local policy configuration, version 1

The trusted server loads a local JSON configuration before creating Kingpin.
The runtime constructor loads the bundled `default/policy.json` if no policy is
injected. Read, parse and validation failures throw; they never select a fallback.
No request can choose a policy path, replace the configuration, or declare an
authoritative tool class.

```js
import { KingpinAuthority, loadPolicy } from './kingpin/index.js';

const authority = new KingpinAuthority({
  policy: loadPolicy('/absolute/path/to/evaluator-policy.json'),
});
const decision = authority.decide(cdeSignal, request, cdeEventId);
// Available to the host's audit integration without changing wire payloads:
const policyContext = authority.policyContext;
```

Copy `default/policy.json`, change `policy_version` to identify the configuration,
and add or replace entries in `tools`, for example:

```json
{ "id": "records.update", "class": "write" }
```

The tool ID is the existing action identity used for envelope membership, exact
lease binding and capability revocation; there is no separate alias/action
resolver. The tools array preserves observable tool order. An empty tool list is
valid and denies every tool. Existing tools can be reclassified only by trusted
server configuration, never by request fields. Each runtime owns an immutable
copy; changing the caller's input afterward has no effect. There is no hot reload.

## Files and fields

- `loader.js`: reads local JSON and invokes validation.
- `validator.js`: checks the version and exact supported structure, then copies
  and recursively freezes it.
- `default/policy.json`: the seven original tool IDs and their classes, class
  floors and allowed envelopes, and effective-gate evidence/lease requirements.

`schema_version: "1.0"` identifies the configuration format. `policy_version`
is a required nonempty configuration identifier exposed through the read-only
`authority.policyContext` audit context. The existing decision schema requires
`policy_version: "demo_v1"`; that field remains the unchanged authority-decision
semantics identifier. A custom configuration version is therefore not substituted
into that wire field or added to existing HTTP/audit payloads. Hosts can record
`policyContext` in their own audit integration. This avoids changing any frozen
schema or default wire payload.

The supported criticality classes describe the existing three categories:

| Class | Minimum gate | Eligible envelope levels |
| --- | --- | --- |
| read_only | 0 | full, non_destructive, read_only |
| write | 1 | full, non_destructive |
| destructive | 2 | full |

Evidence and lease requirements are selected by the effective gate, not blindly
unioned with the tool's floor: gate 0 has neither requirement; gate 1 requires
`dry_run` and `diff`; gate 2 requires a lease and no evidence fields. This preserves
the existing behavior when CDE raises the gate above the tool's floor.

## Validation and authority boundary

Version 1 accepts exactly the existing class/floor/envelope combinations and gate
requirements. It rejects missing/extra fields, unsupported format versions,
unknown classes, duplicate/blank IDs, incorrect types, altered evidence lists,
weakened lease requirements and inconsistent envelope restrictions. Custom tools
are supported by assigning these existing classes; arbitrary new requirements
or rule expressions are outside this format. No JavaScript is loaded or executed
from policy files.

Kingpin retains signal validation, gate computation, evidence presence/coercion
checks, contraction/restoration, envelope intersection, lease validation and
expiry, consumed evaluation IDs, context-scoped revocation, HUMAN REVIEW
precedence, and the final decision. CDE's signal requirements are independently
validated against the unchanged CDE contract; policy cannot redefine that contract.
The gateway still only orchestrates and mechanically enforces Kingpin decisions.

Unknown IDs are absent from every eligible envelope and deterministically return
`deny / outside_capability_envelope`, or the existing higher-precedence
`quarantine` outcome. They cannot acquire leases or be treated as configured
capabilities by revocation. The legacy `tool_floor_gate: 0` projection remains
for payload compatibility; it never makes an unknown tool eligible. Unknown-tool
evaluations still consume IDs and update context state as before.

## Compatibility limits and validation results

The static product catalog and existing requirement tables have been externalized.
Changing gate requirements, class semantics, recovery thresholds, lease-duration
limits, or decision precedence would change behavior, so those are not general
configuration knobs. The validator deliberately preserves the supported semantic
combinations, and the runtime retains the CDE protocol's gate checks.

All frozen fixtures, boundary schemas and existing tests were kept unchanged.
Eight new tests in `gateway_node/policy.test.js` cover the default-policy oracle,
new tools from local JSON, request spoofing, malformed policy, file/parse failures,
unknown tools, immutable configuration and audit version provenance.

Validation: **35 Node tests passed**, **7 Python tests passed** (including the
boundary-schema tests and unchanged 32-event baseline), **all merged HTTP demo
assertions passed**, **standalone demo passed**, and **git diff --check passed**.
