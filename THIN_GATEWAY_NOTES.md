# Gateway boundary

CDE owns deterministic deviation evaluation and Gate 0/1/2 assignment. It emits
`governance_signal` with PASS / EVIDENCE REQUIRED / LEASE REQUIRED semantics.

The warm FastAPI service preserves per-session evaluation state. The Node gateway
consumes its signal, applies separate tool-policy floors, and enforces evidence
and external lease requirements. Demo lease issuance and validation live in
`gateway_node/demo_authority.js`; CDE never grants authority.

The CLI is a standalone single-turn evaluator, not an automatic gateway fallback.
Kingpin is not integrated. See [ARCHITECTURE.md](ARCHITECTURE.md).
