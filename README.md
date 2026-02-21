# CDE MVP (Python-first) — Paper-faithful event formation + audit artifacts

This is a minimal, runnable reference implementation to start the **CDE Gateway hybrid**:
- **Tonight (this repo):** Python core engine that turns constraint-accessible turn packets into deviation **events** using:
  - layered extractors (lexical + pragmatic)
  - stratified baselines (global / per-agent / per-task / per-scene)
  - weighted aggregate severity + confidence
  - **EMA persistence** + **hysteresis** (enter/exit thresholds)
  - deterministic rationale artifacts + audit JSONL
- **Tomorrow:** a thin Node gateway can wrap this as a service / middleware between a planner and tools.

## Quickstart

```bash
cd cde_mvp_python
python3 -m venv .venv && source .venv/bin/activate
python3 -m pip install -r requirements.txt
python3 run_demo.py
```

Outputs:
- `logs/cde_audit.jsonl` (append-only)
- `logs/last_run_summary.json`

## What to edit first
- `manifests/global.json` (thresholds, EMA beta, weights)
- `demo/ramp_test.jsonl` (scripted escalation)
- `src/extractors/*.py` (add/adjust layers)

## Contract (inputs/outputs)
- Input: JSONL of TurnPacket objects (see `src/types/turn_packet.py`)
- Output: DeviationEvent objects, logged to JSONL (see `src/types/deviation_event.py`)


# CDE Gateway Demo (Python + FastAPI + Node)

This repo is a runnable reference implementation of **Constraint Deviation Engine (CDE)** as governance middleware for tool-using agents.

It includes:
- A **Python CDE core** that converts constraint-accessible turn packets into deviation **events** (EMA persistence + hysteresis + audit artifacts).
- A warm **FastAPI CDE service** (`cde_service.py`) that keeps state per `session_id`.
- A thin **Node/Express gateway** (`gateway_node/`) that enforces hard outcomes for simulated tool calls:
  - **Gate 0**: pass-through
  - **Gate 1**: evidence required (dry-run + diff)
  - **Gate 2**: destructive blocked unless a time-limited capability lease is provided

## Quickstart (recommended)

Run the full gateway demo (starts FastAPI + Node, prints the transcript, shuts both down):

```bash
cd gateway_node
npm install
npm run demo
```

See demo details and the expected transcript here:
- `gateway_node/README.md`

## Python core quickstart (optional)

If you want to run the standalone Python CDE engine demo:

```bash
python3 -m venv .venv && source .venv/bin/activate
python3 -m pip install -r requirements.txt
python3 run_demo.py
```

Outputs:
- `logs/cde_audit.jsonl` (append-only)
- `logs/last_run_summary.json`

## Key files

- `src/engine.py` — CDE core engine
- `manifests/*.json` — baseline + thresholds
- `cde_service.py` — warm FastAPI CDE service (session-aware)
- `gateway_node/server.js` — gateway enforcement (floors, leases, evidence gates)
- `gateway_node/demo.js` — scripted transcript runner

## License

CC BY-NC 4.0 — see `LICENSE`.

## Contact

Stephen A. Putman — putmanmodel@pm.me