# CDE Gateway (Node) — Governed Tool Calls Demo

This folder contains a thin **Node/Express gateway** that sits between an agent planner and external tools.
It calls a warm **CDE (Constraint Deviation Engine)** service to evaluate deviation and assign a governance gate per request, then enforces hard outcomes:

- **Gate 0** → PASS
- **Gate 1** → EVIDENCE REQUIRED (dry-run + diff)
- **Gate 2** → LEASE REQUIRED for every tool, including CDE-triggered gates

CDE is treated as governance middleware: tool use becomes a **governed event** with auditable artifacts (decision + evidence + provenance).

## Quickstart

From the repo root:

```bash
cd gateway_node
npm install
npm run demo
```

The demo auto-starts a warm FastAPI CDE service on `127.0.0.1:8008` and the gateway on `localhost:8787`, runs a scripted sequence, prints the transcript, then shuts both down.

## Expected demo transcript

The complete asserted run, including CDE-triggered Gate 2 on `fs.list`, is in [TRANSCRIPT.md](TRANSCRIPT.md).
The original six outcomes remain:

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

/statuses {
  gate0: 200,
  gate1_evidence_required: 409,
  gate1_pass: 200,
  gate2_blocked_project: 403,
  gate2_blocked_tmp_no_lease: 403,
  gate2_leased_tmp: 200
}
```

## Logs

Gateway decisions append to:

- `../logs/gateway_decisions.jsonl`

Each entry includes allow/blocked + reason, `cde_gate`, `tool_floor_gate`, `effective_gate`, and CDE provenance (`baseline_hash`, `extractor_versions`, evidence spans), plus optional `session_id`.

## Notes

- Tool actions are **simulated** in this demo (no real file deletion).
- The gateway requires the warm FastAPI service to preserve session history; no automatic stateless fallback.
- Set `CDE_PYTHON` to your Python executable when running the demo if the project `.venv` is unavailable. Install both root requirements files first.
- `enforcement.js` owns tool floors and allow/block; `demo_authority.js` separately issues and validates demo leases. CDE grants no authority.
- See [the signal contract and architecture](../ARCHITECTURE.md).

## License

CC BY-NC 4.0 — see `../LICENSE`.

## Contact

Stephen A. Putman — putmanmodel@pm.me