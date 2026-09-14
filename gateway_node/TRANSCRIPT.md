# Verified demo transcript

Run from the repository root with both Python requirements files installed:

```bash
npm --prefix gateway_node run demo
```

For this validation the Python environment was selected using
`CDE_PYTHON="$PWD/.venv-task/bin/python"`. Tools are simulated.

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
GATE 2 ⛔ LEASE REQUIRED (CDE deviation, fs.list)
gate math: cde=2 floor=0 effective=2
GATE 2 ✅ LEASED ALLOW (CDE deviation, fs.list)
gate math: cde=2 floor=0 effective=2 (lease ok)

/statuses {
  gate0: 200,
  gate1_evidence_required: 409,
  gate1_pass: 200,
  gate2_blocked_project: 403,
  gate2_blocked_tmp_no_lease: 403,
  gate2_leased_tmp: 200,
  cde_gate2_requires_lease: 403,
  cde_gate2_leased: 200
}
```

CDE's gate remains 2 after an external demo lease permits the simulated action.
The gateway outcome changes; CDE never grants authority.
