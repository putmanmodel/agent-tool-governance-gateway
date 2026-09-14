// Mechanical enforcement only. All substantive policy lives in Kingpin.
const STATUS = Object.freeze({ allow: 200, constrain: 409, deny: 403, quarantine: 423, human_review: 428 });

export function enforceAuthorityDecision(decision) {
  if (!decision || decision.schema_version !== "1.0" || decision.issuer !== "kingpin"
      || !Object.hasOwn(STATUS, decision.outcome)) throw new Error("Missing or unsupported Kingpin authority decision");
  return {
    status: STATUS[decision.outcome],
    response: {
      allow: decision.outcome === "allow", blocked: decision.outcome !== "allow",
      reason: decision.reason, authority_decision: decision,
      // Compatibility fields are Kingpin's projections, never gateway policy.
      policy_gate_level: decision.effective_gate, cde_gate: decision.cde_gate,
      tool_floor_gate: decision.tool_floor_gate, effective_gate: decision.effective_gate,
      effective_gate_label: decision.effective_gate_label,
      required_evidence: decision.missing_evidence.length ? decision.evidence_requirements : [],
      evidence_requirements: decision.evidence_requirements,
      missing_evidence: decision.missing_evidence,
      authority_requirement: decision.authority_requirement,
    },
  };
}
