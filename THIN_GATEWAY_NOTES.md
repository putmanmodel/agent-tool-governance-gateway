# Gateway boundary

`tool request → CDE → governance signal → Kingpin → authority decision → gateway enforcement`

CDE owns deterministic deviation evaluation and Gate 0/1/2 assignment. Its v1.0
signal retains PASS / EVIDENCE REQUIRED / LEASE REQUIRED semantics.

Kingpin owns the capability envelope, evidence policy, scoped leases, revocation,
contraction and deterministic restoration. The gateway mechanically enforces its
allow / constrain / deny / quarantine / human_review decision and records both
layers in the audit log. CDE can require authority but cannot grant it.

See [ARCHITECTURE.md](ARCHITECTURE.md) for contracts and local-demo limitations.
