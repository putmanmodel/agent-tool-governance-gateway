# Thin Node Gateway (tomorrow) — contract notes

The Node gateway should:
1) accept tool-call events or agent turn packets over HTTP
2) call the Python CDE engine for:
   - severity + event status (enter/active/exit)
   - rationale artifact (evidence + provenance)
3) enforce outcomes in the gateway layer (tomorrow):
   - block / slow / quarantine / require human approval / capability lease

For tonight's Python engine:
- Run `python run_demo.py` to generate `logs/cde_audit.jsonl`.
- The gateway can either:
  A) import the Python package directly (spawn python process)
  B) wrap `CDEEngine` behind a small FastAPI endpoint (next step after MVP)
