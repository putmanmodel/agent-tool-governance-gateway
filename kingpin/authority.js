import crypto from "node:crypto";
import { loadPolicy } from "./policy/loader.js";
import { validatePolicy } from "./policy/validator.js";

const LABELS = ["PASS", "EVIDENCE REQUIRED", "LEASE REQUIRED"];
const LEVELS = ["full", "non_destructive", "read_only", "quarantined"];
const REASONS = {
  DEVIATION_INACTIVE: 0, LOW_CONFIDENCE: 1, REVIEW_THRESHOLD_REACHED: 1,
  DEVIATION_PERSISTING: 1, LEASE_THRESHOLD_REACHED: 2, QUARANTINE_THRESHOLD_REACHED: 2,
};
const text = value => typeof value === "string" && value.trim().length > 0;
const unit = value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
const own = (object, key) => Object.hasOwn(object, key);

// Canonical JSON binds leases to the exact simulated operation, independent of key order.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
}

function contextFor(request) {
  const { speaker_id, channel_id } = request;
  const session_id = request.session_id ?? "default";
  if (![session_id, speaker_id, channel_id].every(text)) throw new Error("Kingpin requires session, actor and channel");
  for (const name of ["scene_id", "task_id"]) {
    if (request[name] != null && !text(request[name])) throw new Error(`Invalid ${name}`);
  }
  const scope_key = request.scene_id ? `scene:${request.scene_id}`
    : request.task_id ? `task:${request.task_id}` : `agent:${speaker_id}`;
  return { session_id, speaker_id, channel_id, scope_key };
}

function validateSignal(signal, context) {
  const d = signal?.deviation;
  if (!signal || signal.schema_version !== "1.0" || ![0, 1, 2].includes(signal.gate)
      || signal.scope_key !== context.scope_key || signal.gate_label !== LABELS[signal.gate]
      || canonical(signal.evidence_requirements) !== canonical(signal.gate === 1 ? ["dry_run", "diff"] : [])
      || signal.authority?.requirement !== (signal.gate === 2 ? "lease" : "none")
      || signal.authority?.recommendation !== (signal.gate === 2 ? "request_external_lease" : "none")
      || !Array.isArray(signal.reason_codes) || signal.reason_codes.length !== 1
      || !own(REASONS, signal.reason_codes[0]) || REASONS[signal.reason_codes[0]] !== signal.gate
      || !d || ![d.severity, d.ema_severity, d.confidence].every(unit)
      || ![d.active, d.enter, d.exit].every(v => typeof v === "boolean")
      || d.active !== (signal.gate !== 0) || (d.enter && !d.active) || (d.exit && d.active)
      || !d.vector || Array.isArray(d.vector) || typeof d.vector !== "object"
      || !Object.values(d.vector).every(v => typeof v === "number" && Number.isFinite(v) && v >= 0)) {
    throw new Error("Missing, inconsistent or unsupported CDE governance signal");
  }
}

export class KingpinAuthority {
  #policy;
  #tools;

  constructor({ clock = Date.now, policy = loadPolicy() } = {}) {
    this.#policy = validatePolicy(policy);
    this.#tools = new Map(this.#policy.tools.map(tool => [tool.id, this.#policy.classes[tool.class]]));
    this.clock = clock;
    this.states = new Map();
    this.leases = new Map();
  }

  // Configuration provenance for server-side audit; the v1 decision contract
  // retains demo_v1 as its authority-algorithm version.
  get policyContext() {
    return Object.freeze({ schema_version: this.#policy.schema_version, policy_version: this.#policy.policy_version });
  }

  _lookup(request, create = false) {
    const context = contextFor(request);
    const key = canonical(context);
    let state = this.states.get(key);
    if (!state && create) {
      state = { level: 0, clean: 0, revision: 0, revoked: new Set(), seen: new Set() };
      this.states.set(key, state);
    }
    return { context, key, state };
  }

  _tools(state) {
    return [...this.#tools.keys()].filter(tool => !state.revoked.has(tool)
      && this.#tools.get(tool).allowed_envelopes.includes(LEVELS[state.level]));
  }

  _envelope(state) {
    return { level: LEVELS[state.level], tools: this._tools(state), revision: state.revision,
      clean_evaluations: state.clean, restoration_step_after: 2, revoked_tools: [...state.revoked].sort() };
  }

  _revokeLeases(key, reason, tool) {
    for (const lease of this.leases.values()) {
      if (lease.key === key && (!tool || lease.tool === tool)) lease.revoked = reason;
    }
  }

  // Only the server supplies evaluation_id (the selected CDE event ID).
  decide(signal, request, evaluation_id) {
    const context = contextFor(request);
    validateSignal(signal, context);
    if (!text(evaluation_id) || !text(request.tool)) throw new Error("Missing evaluation ID or tool");
    const { key, state } = this._lookup(request, true);
    const reasons = [];
    if (state.seen.has(evaluation_id)) throw new Error("CDE evaluation already consumed");
    {
      state.seen.add(evaluation_id);
      const target = signal.reason_codes.includes("QUARANTINE_THRESHOLD_REACHED") ? 3 : signal.gate;
      if (target > state.level) {
        state.level = target;
        state.clean = 0;
        state.revision++;
        this._revokeLeases(key, "ENVELOPE_CONTRACTED");
        reasons.push("ENVELOPE_CONTRACTED");
      } else if (signal.gate === 0 && !signal.deviation.active && state.level > 0) {
        state.clean++;
        if (state.clean === 2) {
          state.level--;
          state.clean = 0;
          state.revision++;
          reasons.push("ENVELOPE_RESTORED_ONE_STEP");
        } else reasons.push("REENTRY_PENDING");
      } else {
        state.clean = 0;
      }
    }

    // Unknown tools retain the legacy floor projection but never enter the
    // envelope. Request-supplied classification/requirements are not consulted.
    const floor = this.#tools.get(request.tool)?.minimum_authority_floor ?? 0;
    const effective = Math.max(signal.gate, floor);
    const requirements = this.#policy.gate_requirements[effective];
    const evidence = [...requirements.evidence];
    const missing = evidence.filter(item => item === "dry_run" ? request.dry_run !== true
      : request.diff == null || !String(request.diff).trim());
    const leaseRequired = requirements.lease;
    let outcome = "allow";
    let reason = "allowed";
    if (state.level === 3) {
      outcome = "quarantine"; reason = "kingpin_quarantined";
    } else if (!this._tools(state).includes(request.tool)) {
      outcome = "deny"; reason = state.revoked.has(request.tool) ? "capability_revoked" : "outside_capability_envelope";
    } else if (signal.reason_codes.includes("LOW_CONFIDENCE")) {
      outcome = "human_review"; reason = "low_confidence_requires_human_review";
    } else if (missing.length) {
      outcome = "constrain"; reason = "gate_1_requires_dry_run_and_diff";
    } else if (leaseRequired && !this.hasValidLease(request)) {
      outcome = "deny"; reason = "gate_2_requires_valid_lease";
    } else if (leaseRequired) {
      reason = "gate_2_lease_valid";
    }
    reasons.push(reason.toUpperCase());
    return {
      schema_version: "1.0", issuer: "kingpin", policy_version: "demo_v1",
      evaluation_id, context, outcome, reason, reason_codes: reasons,
      capability_envelope: this._envelope(state),
      cde_gate: signal.gate, tool_floor_gate: floor, effective_gate: effective,
      effective_gate_label: LABELS[effective], evidence_requirements: evidence,
      missing_evidence: missing, authority_requirement: leaseRequired ? "lease" : "none",
    };
  }

  issue(request) {
    const { context, key, state } = this._lookup(request);
    const seconds = Number(request.seconds);
    if (!state || !this._tools(state).includes(request.tool)) throw new Error("Lease requires an evaluated context and capability in current envelope");
    if (!Number.isFinite(seconds) || seconds < .001 || seconds > 300) throw new Error("Lease duration must be 0.001–300 seconds");
    if (!request.args || typeof request.args !== "object" || Array.isArray(request.args)) throw new Error("Lease requires exact args object");
    const token = crypto.randomUUID();
    const expires_at_ms = this.clock() + Math.floor(seconds * 1000);
    this.leases.set(token, { key, tool: request.tool, args: canonical(request.args), expires_at_ms, revoked: null });
    return { lease_token: token, lease_id: crypto.createHash("sha256").update(token).digest("hex"),
      context, expires_at: new Date(expires_at_ms).toISOString(), issuer: "kingpin" };
  }

  hasValidLease(request) {
    const { key, state } = this._lookup(request);
    const lease = this.leases.get(request.lease_token);
    return Boolean(state && lease && !lease.revoked && lease.expires_at_ms > this.clock()
      && lease.key === key && lease.tool === request.tool && lease.args === canonical(request.args ?? {})
      && this._tools(state).includes(request.tool));
  }

  revoke(request) {
    const { context, key, state } = this._lookup(request);
    if (!state) throw new Error("Unknown authority context");
    if (request.lease_token) {
      const lease = this.leases.get(request.lease_token);
      if (!lease || lease.key !== key) throw new Error("Unknown lease in context");
      lease.revoked = "EXPLICIT_REVOCATION";
    } else if (this.#tools.has(request.tool)) {
      state.revoked.add(request.tool);
      this._revokeLeases(key, "CAPABILITY_REVOKED", request.tool);
    } else throw new Error("Specify lease_token or known tool");
    state.revision++;
    return { revoked: true, context, target: request.lease_token
      ? { lease_id: crypto.createHash("sha256").update(request.lease_token).digest("hex") }
      : { tool: request.tool }, capability_envelope: this._envelope(state) };
  }
}
