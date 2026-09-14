# Verified CDE + Kingpin demo transcript

The merged demo runs entirely in this repository. CDE emits its existing v1.0 signal;
Kingpin decides authority; the gateway enforces that decision. All tools are simulated.

Run from the repository root:

```bash
CDE_PYTHON="$PWD/.venv-task/bin/python" node gateway_node/demo.js
```

The captured run passed every assertion:

```text
GATE 0 ✅ PASS
GATE 1 ⚠️ EVIDENCE REQUIRED
gate math: cde=0 floor=1 effective=1
GATE 1 ✅ PASS
gate math: cde=0 floor=1 effective=1
GATE 2 ⛔ BLOCKED (delete /project)
gate math: cde=0 floor=2 effective=2
GATE 2 ⛔ BLOCKED (delete /project/tmp/* without lease)
gate math: cde=0 floor=2 effective=2
GATE 2 ✅ LEASED ALLOW (delete /project/tmp/* with lease)
gate math: cde=0 floor=2 effective=2 (lease ok)
BASELINE: CDE=0 Kingpin=allow envelope=full tools=7
DEVIATION RISES: CDE=1 Kingpin=constrain envelope=non_destructive tools=4
DEVIATION RISES AGAIN: CDE=2 Kingpin=deny envelope=read_only tools=2
SCOPED READ LEASE: CDE=2 Kingpin=allow envelope=read_only tools=2
LEASE REVOKED: CDE=2 Kingpin=deny envelope=read_only tools=2
SEVERE DEVIATION: CDE=2 Kingpin=quarantine envelope=quarantined tools=0
LEASE ISSUANCE WHILE QUARANTINED: rejected
RECOVERY 1: CDE=1 Kingpin=quarantine envelope=quarantined tools=0
RECOVERY 2: CDE=0 Kingpin=quarantine envelope=quarantined tools=0
RECOVERY 3: CDE=0 Kingpin=allow envelope=read_only tools=2
RECOVERY 4: CDE=0 Kingpin=allow envelope=read_only tools=2
RECOVERY 5: CDE=0 Kingpin=allow envelope=non_destructive tools=4
RECOVERY 6: CDE=0 Kingpin=allow envelope=non_destructive tools=4
RECOVERY 7: CDE=0 Kingpin=allow envelope=full tools=7
OLD LEASE STAYS REVOKED: CDE=0 Kingpin=deny envelope=full tools=7
FRESH AUTHORITY AFTER RESTORATION: CDE=0 Kingpin=allow envelope=full tools=7
HUMAN REVIEW (isolated low-confidence fixture, HTTP 428): CDE=1 Kingpin=human_review envelope=non_destructive tools=4
All merged demo assertions passed: Deviation ↑ → authority surface ↓
```

The original six baseline outcomes and the capability sequence
**7 → 4 → 2 → 0 → 2 → 4 → 7** remain intact. Revoked leases stay revoked after
restoration.

The HUMAN REVIEW example runs afterward in `review-session`, with its own actor
and scene. A normal moderate-deviation `/tool` request activates CDE hysteresis.
The next `/tool` request selects the fixed `low_confidence` demo observation (`.`):
CDE computes confidence **0.3105**, EMA **0.32908690500841153**, and active Gate 1
with reason `LOW_CONFIDENCE`. Kingpin returns its existing `human_review` outcome;
the gateway blocks with HTTP 428, even though dry-run and diff evidence are present.

`demo.js` opts its gateway child into `CDE_DEMO_FIXTURES=1`. The fixture is rejected
when that switch is absent, accepts no arbitrary evaluation text or fabricated
signal, and is identified in the response/audit `evaluation_input` field. Normal
requests retain the original tool wrapper. CDE and Kingpin semantics are unchanged.
