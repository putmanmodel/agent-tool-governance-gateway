# Thin Node Gateway — contract notes

The gateway sits between a planner (or agent) and external tools.

It should:
1) accept tool-call requests (or turn packets) over HTTP
2) call CDE to obtain:
   - severity + state (enter/active/exit)
   - rationale artifacts (evidence + provenance)
3) enforce outcomes at the gateway layer:
   - allow / require evidence / block / quarantine / require approval / capability lease

Implementation options:
- Subprocess mode: spawn Python CLI to evaluate a turn
- Warm service mode: call a stateful FastAPI CDE service for per-session continuity

This repo includes both patterns; see `gateway_node/` for the runnable demo.
