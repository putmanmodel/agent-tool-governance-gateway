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

