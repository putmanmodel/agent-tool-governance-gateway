// Gateway-local policy floors do not change CDE's deviation evaluation.
const reversibleTools = new Set(["fs.write", "git.commit"]);
const destructiveTools = new Set(["fs.delete", "shell.rm", "git.reset_hard"]);
const labels = ["PASS", "EVIDENCE REQUIRED", "LEASE REQUIRED"];

export function enforceGovernance(signal, request, authority) {
  if (!signal || signal.schema_version !== "1.0" || ![0, 1, 2].includes(signal.gate)
      || signal.gate_label !== labels[signal.gate]
      || JSON.stringify(signal.evidence_requirements) !== JSON.stringify(signal.gate === 1 ? ["dry_run", "diff"] : [])
      || signal.authority?.requirement !== (signal.gate === 2 ? "lease" : "none")) {
    throw new Error("Missing or unsupported CDE governance signal");
  }
  const cdeGate = signal.gate;
  const floor = destructiveTools.has(request.tool) ? 2 : reversibleTools.has(request.tool) ? 1 : 0;
  const gate = Math.max(cdeGate, floor);
  const evidence = gate === 1 ? ["dry_run", "diff"] : [];
  let status = 200;
  let reason = "allowed";
  let missing = [];
  if (gate === 1) {
    if (request.dry_run !== true) missing.push("dry_run");
    if (request.diff === undefined || request.diff === null || !String(request.diff).trim()) missing.push("diff");
    if (missing.length) {
      status = 409;
      reason = "gate_1_requires_dry_run_and_diff";
    }
  }
  if (gate === 2) {
    const scope = request.scene_id ?? request.task_id ?? request.channel_id;
    if (authority.hasValidLease(request.lease_token, request.tool, scope)) {
      reason = "gate_2_lease_valid";
    } else {
      status = 403;
      reason = destructiveTools.has(request.tool)
        ? "gate_2_destructive_tool_requires_valid_lease" : "gate_2_requires_valid_lease";
    }
  }
  return {
    status,
    response: {
      allow: status === 200,
      blocked: status !== 200,
      reason,
      policy_gate_level: gate,
      cde_gate: cdeGate,
      tool_floor_gate: floor,
      effective_gate: gate,
      effective_gate_label: labels[gate],
      // Keep the original field's blocking-only behavior for existing clients.
      required_evidence: missing.length ? evidence : [],
      evidence_requirements: evidence,
      missing_evidence: missing,
      authority_requirement: gate === 2 ? "lease" : "none",
    },
  };
}
