# Future directions

Kingpin v0.4 is a controlled runtime-governance evaluator, not the endpoint of the
architecture. The directions below identify ways its trust boundary could be
extended while preserving separation between behavioral deviation, runtime
authority, enforcement, provenance and infrastructure trust.

These are possible extensions, not implemented features, delivery commitments or
scheduled work. Current capabilities and security claims remain exactly as
documented in the [evaluator quickstart](evaluation/README.md) and
[security boundaries](evaluation/SECURITY.md). Nothing here strengthens those claims.

## Environment trust and attestation

An optional integration could let Kingpin consume a fresh, cryptographically
verifiable attestation result from an external trusted verifier:

```text
TPM / measured boot / attestation infrastructure
→ external verifier
→ signed, fresh attestation result
→ Kingpin authority precondition
→ authority decision
```

Measured boot, TPMs, confidential-computing mechanisms and other attestation
infrastructure would remain external. Kingpin would not implement measured boot
or prove host integrity itself. An integration would need explicit verifier trust,
signature validation, freshness and binding to the relevant execution environment;
a valid signature alone would not establish that a result applies to this request.
The result would be evidence about the environment, not a CDE deviation signal.

An organization could choose to permit read-only authority without attestation,
require current attestation for write/commit authority, and require it alongside
ordinary evidence, lease and review requirements for destructive/high-impact
actions. These are hypothetical policy choices, not supported configuration today.
Attestation would be an additional precondition: it would never replace policy,
tool floors, evidence, leases, reviews, revocation or authority contraction. Where
required, absent, stale or unverifiable results would have to withhold that authority.

## Provenance and indirect influence

Future provenance integrations could track retrieved documents, tool outputs and
memory origins, preserve multi-hop influence lineage, and record how content was
transformed. Evaluations could then identify where an instruction or influence
originated and which authority boundary it attempted to cross.

This provenance and indirect prompt-injection coverage does not exist in the
current evaluator. Kingpin could remain source-agnostic at the authority boundary
while upstream provenance/detection systems supply better evidence about origin
and transformation. Origin labels would not themselves confer authority or prove
that content is safe; influenced requests would still face ordinary governance.

## Tamper evidence and state integrity

Possible extensions include signed policy/configuration artifacts, build/artifact
integrity verification, tamper-evident or hash-chained audit history, external
append-only audit sinks, rollback detection/protection, and stronger integrity
checks around persisted governance state.

Each would need a defined trust anchor, verification boundary and failure response.
For example, a locally stored hash chain alone would not prevent an owner from
replacing or rolling back the entire history. These directions do not imply
compromised-host resistance today; current structural validation and durable state
remain subject to the documented host/operator trust assumptions.

## Credential and deployment hardening

Deployments could extend the current local credential boundary with expiring and
rotatable credentials, TLS/mTLS, external identity providers, stronger process
isolation, hardware-backed keys where appropriate, and deployment-specific secret
management. Such integrations would need to preserve agent/admin/reviewer
separation and explicit principal/context binding. Transport or identity assurance
would not substitute for Kingpin's authority decision.

## Execution and distributed environments

Richer postcondition/reconciliation adapters could improve the evidence available
for uncertain outcomes. External idempotency or transaction identifiers and
integration with systems supporting transactional execution could help bound
retries and establish outcomes under those systems' actual guarantees.

### Governed in-flight interruption

RC2 revocation withdraws future authority but does not cancel an execution that
has already started. A post-RC2 direction is to support stronger execution-lifecycle
governance when an agent or tool integration exposes the necessary capabilities.

Possible adapter capabilities could include:

- `checkpoint_supported` — execution can stop before the next bounded unit of work.
- `cancel_supported` — an already-started execution can receive a cancellation request.
- `rollback_supported` — a completed or partially completed reversible effect can be
  rolled back.
- `non_interruptible` — once started, the effect runs to completion.

Kingpin would govern whether interruption, continuation or rollback is authorized.
The adapter or tool would remain responsible for the physical execution mechanism
and for truthfully reporting whether cancellation or rollback actually succeeded.

Baseline integrations would retain the current guarantee: Kingpin can revoke future
authority. Stronger integrations could additionally support mid-execution
interruption through cancellable or checkpointed execution boundaries.

This capability should be designed against concrete long-running integrations
rather than assuming that every effect is meaningfully cancellable. A short or
effectively atomic action may have completed before revocation can be enforced,
while a long-running job, deployment, browser task or similar operation may expose
useful cancellation or checkpoint boundaries.

The Agent Governance Test Harness could distinguish unsupported interruption from
successful interruption and from a claimed interruption capability that fails to
behave as advertised.

Deployments requiring multiple nodes could explore coordination and fencing;
long-running external actions would need explicit handling of progress,
cancellation limits and outcome uncertainty. None of these directions establishes
exactly-once execution. **UNKNOWN must never mean automatic retry.** Reconciliation
must remain distinct from permission to perform a new action, and a fresh action
must still pass current governance.

## Evaluator and conformance expansion

Additional adversarial fixtures, contributed evaluator scenarios and reproducible
attack cases could broaden coverage. Indirect-injection and provenance stress
tests would require explicit models for those currently unmodeled inputs. External
evaluation reports and findings could become bounded regression cases with stated
assumptions and observable expected outcomes.

Broader conformance coverage should identify the contract each case tests and
preserve the distinction between product audit evidence and the fixed Paper 9
canonical conformance envelope. More passing cases would demonstrate their stated
coverage, not comprehensive security or detection of every attack.

## Architectural constraints

Future additions should extend the evidence available to Kingpin without
collapsing responsibilities. Behavioral deviation remains CDE's concern.
Environment integrity remains the responsibility of the attestation/infrastructure
layer. Provenance systems describe origin and transformation. Kingpin consumes
governed inputs and decides runtime authority. The gateway enforces that decision.

Reflex/attention cannot authorize. The gateway must remain enforcement, not a
second policy engine. Leases cannot expand the authority envelope. Future features
must not silently weaken fail-closed behavior or reinterpret existing security
nonclaims as guarantees.
