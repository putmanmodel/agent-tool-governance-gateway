# Constraint Deviation Engine (CDE) — Gateway Demo

Runnable reference implementation of **Constraint Deviation Engine (CDE)** as governance middleware for tool-using agents.

This repo includes:
- **Python CDE core**: computes deviation events from constraint-accessible turn packets (layered extractors, stratified baselines, EMA persistence + hysteresis, auditable rationale artifacts).
- **Warm CDE service (FastAPI)**: stateful `/turn` endpoint with per-`session_id` engine instances.
- **Kingpin authority layer**: contracts capability envelopes, decides allow/constrain/deny/quarantine/human review, and owns leases, revocation and deterministic restoration.
- **Node/Express gateway**: enforces Kingpin decisions for simulated tools. CDE semantics remain:
  - **Gate 0** — PASS
  - **Gate 1** — EVIDENCE REQUIRED (dry-run + diff)
  - **Gate 2** — LEASE REQUIRED (including gates triggered by CDE deviation)

CDE emits a versioned governance signal and never grants authority. Kingpin consumes that signal and
returns a separate authority decision. The demo shows **Deviation ↑ → authority surface ↓**.
See [architecture and signal contract](ARCHITECTURE.md) for the component map and compatibility details.

## Quickstart

Run the full gateway demo (starts FastAPI + Node, prints a transcript, then shuts both down):

```bash
cd gateway_node
npm install
# Install requirements.txt and requirements_gateway.txt in your Python environment first.
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
- `gateway_node/server.js` — HTTP orchestration and audit
- `gateway_node/enforcement.js` — mechanical enforcement of Kingpin decisions
- `gateway_node/kingpin/authority.js` — capability envelope, leases, revocation and recovery
- `gateway_node/demo.js` — scripted transcript runner

## License

CC BY-NC 4.0 — see `LICENSE`.

## Contact

Stephen A. Putman — putmanmodel@pm.me
