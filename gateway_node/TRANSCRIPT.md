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
All merged demo assertions passed: Deviation ↑ → authority surface ↓
```

The original six baseline outcomes remain. Moderate Gate 2 deviation permits only
read capabilities with a scoped lease; severe deviation leaves no eligible tools.
Restoration needs two inactive Gate 0 evaluations per step. Revoked leases stay
revoked even after the full envelope returns. Human-review handling is covered by
the authority tests; the tool-wrapper text in this HTTP script does not produce
CDE's low-confidence branch.
