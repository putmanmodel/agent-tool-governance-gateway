# Constraint Deviation Engine (CDE) — Gateway Demo

Runnable reference implementation of **Constraint Deviation Engine (CDE)** as governance middleware for tool-using agents.

This repo includes:
- **Python CDE core**: computes deviation events from constraint-accessible turn packets (layered extractors, stratified baselines, EMA persistence + hysteresis, auditable rationale artifacts).
- **Warm CDE service (FastAPI)**: stateful `/turn` endpoint with per-`session_id` engine instances.
- **Node/Express gateway**: enforces hard outcomes for simulated tool calls using explicit gate math:
  - **Gate 0** — pass-through
  - **Gate 1** — evidence required (dry-run + diff)
  - **Gate 2** — destructive blocked unless a time-limited capability lease is provided

## Quickstart

Run the full gateway demo (starts FastAPI + Node, prints a transcript, then shuts both down):

```bash
cd gateway_node
npm install
npm run demo
```

Demo details and transcript:
- `gateway_node/README.md`

## Python core (optional)

Run the standalone Python engine demo:

```bash
python3 -m venv .venv && source .venv/bin/activate
python3 -m pip install -r requirements.txt
python3 run_demo.py
```

Outputs:
- `logs/cde_audit.jsonl`
- `logs/last_run_summary.json`

## Key files

- `src/engine.py` — CDE core engine
- `manifests/*.json` — baselines + thresholds
- `cde_service.py` — warm FastAPI CDE service (session-aware)
- `gateway_node/server.js` — gateway enforcement (floors, leases, evidence gates)
- `gateway_node/demo.js` — scripted transcript runner

## License

CC BY-NC 4.0 — see `LICENSE`.

## Contact

Stephen A. Putman — putmanmodel@pm.me
