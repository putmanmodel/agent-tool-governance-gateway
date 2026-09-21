import { requestBinding, reviewRequest, reviewerMayAccess, validateReview } from './review/model.js';
import { event, reviewEvent, correlation, bindingHash } from './audit/events.js';
import crypto from "node:crypto";
import { loadPolicy } from "./policy/loader.js";
import { validatePolicy } from "./policy/validator.js";
import { MemoryStateStore } from "./state/memory.js";
import { assertStore } from "./state/interfaces.js";

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
  #store;
  #auditClock;
  #policyFingerprint;
  #reviewIds = new WeakMap();

  constructor({ clock = Date.now, auditClock = Date.now, policy = loadPolicy(), store = new MemoryStateStore() } = {}) {
    this.#policy = validatePolicy(policy);
    this.#tools = new Map(this.#policy.tools.map(tool => [tool.id, this.#policy.classes[tool.class]]));
    this.clock = clock;
    this.#auditClock = auditClock;
    assertStore(store);
    this.#policyFingerprint = crypto.createHash("sha256").update(canonical(this.#policy)).digest("hex");
    store.bindPolicy(this.#policyFingerprint, [...this.#tools.keys()]);
    this.#store = store;
  }

  // Configuration provenance for server-side audit; the v1 decision contract
  // retains demo_v1 as its authority-algorithm version.
  get policyContext() {
    return Object.freeze({ schema_version: this.#policy.schema_version, policy_version: this.#policy.policy_version });
  }

  // Compatibility diagnostic used by the original regression suite; no mutable
  // governance map is exposed to callers.
  get states() { return Object.freeze({ size: this.#store.contextCount() }); }

  _lookup(tx, request, create = false) {
    const context = contextFor(request);
    const key = canonical(context);
    let state = tx.contexts.get(key);
    if (!state && create) {
      state = { level: 0, clean: 0, revision: 0 };
      tx.contexts.create(key, state);
    }
    if (state) {
      state.revoked = tx.revocations.list(key);
      if ([...state.revoked].some(tool => !this.#tools.has(tool))) throw new Error("Invalid governance state: unknown revoked capability");
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

  _audit(tx, type, audit, request = {}, fields = {}) {
    const tool = this.#policy.tools.find(tool => tool.id === request.tool);
    tx.audit.append(event(type, audit, {
      policy_version: this.#policy.policy_version,
      agent_id: request.speaker_id ?? null,
      context: request.speaker_id && request.channel_id ? contextFor(request) : null,
      tool_id: request.tool ?? null, tool_class: tool?.class ?? null,
      arguments_hash: request.args === undefined ? null : bindingHash(request.args),
      ...fields,
    }, this.#auditClock));
  }

  recordAuthenticationRejection(auditContext, reason) {
    if (!['AUTHENTICATION_REQUIRED', 'FORBIDDEN'].includes(reason)) throw new Error('Unsupported authentication rejection');
    this.#store.transaction(tx => this._audit(tx, 'authentication.rejected', correlation(auditContext), {},
      { outcome: 'rejected', reason_codes: [reason] }));
  }

  getEventsForRequest(requestId) { return this.#store.getEventsForRequest(requestId); }

  // Enforcement is a separate fact supplied by the transport, never authority policy.
  recordEnforcement(request, auditContext, { outcome, evaluation_id = null, reason_codes = [] }) {
    const types = { allow: 'allowed', human_review: 'review', deny: 'denied',
      constrain: 'denied', quarantine: 'denied', failed: 'failed' };
    if (!types[outcome]) throw new Error('Unknown enforcement outcome');
    const audit = correlation(auditContext);
    this.#store.transaction(tx => this._audit(tx, `tool.enforcement.${types[outcome]}`, audit,
      request, { outcome, evaluation_id, reason_codes }));
  }

  // Only the server supplies evaluation_id (the selected CDE event ID).
  decide(signal, request, evaluation_id, auditContext) {
    const audit = correlation(auditContext);
    audit.decision_id ??= crypto.randomUUID();
    let reviewId;
    const result = this.#store.transaction(tx => {
      const previous = this._lookup(tx, request).state;
      this._audit(tx, 'cde.signal.created', audit, request, { evaluation_id,
        gate: signal.gate, signal: { gate: signal.gate, reason_codes: signal.reason_codes,
          deviation: Object.fromEntries(['severity', 'ema_severity', 'confidence', 'active', 'enter', 'exit', 'vector']
            .map(key => [key, signal.deviation?.[key]])) } });
      this._audit(tx, 'authority.requested', audit, request, { evaluation_id });
      let lease_check = null;
      const decision = this._decide(tx, signal, request, evaluation_id, result => { lease_check = result.reason; });
      const fields = { evaluation_id,
        requirements: { evidence: decision.evidence_requirements, missing_evidence: decision.missing_evidence,
          authority: decision.authority_requirement, tool_floor_gate: decision.tool_floor_gate },
        outcome: decision.outcome, reason_codes: decision.reason_codes,
        envelope: decision.capability_envelope, gate: decision.effective_gate, lease_check,
        lease_id: tx.leases.get(request.lease_token)?.nonce ?? null };
      for (const [reason, type] of [['ENVELOPE_CONTRACTED', 'authority.contracted'],
        ['ENVELOPE_RESTORED_ONE_STEP', 'authority.restored']]) {
        if (decision.reason_codes.includes(reason)) this._audit(tx, type, audit, request, fields);
      }
      if ((previous?.clean ?? 0) !== decision.capability_envelope.clean_evaluations
          || decision.reason_codes.includes('ENVELOPE_RESTORED_ONE_STEP')) {
        this._audit(tx, 'recovery.stage_changed', audit, request, fields);
      }
      if (lease_check && lease_check !== 'ok') this._audit(tx, 'lease.rejected', audit, request, fields);
      this._audit(tx, 'authority.decision', audit, request, fields);
      if (decision.outcome === 'human_review') {
        const binding = requestBinding(request, audit.principal_id);
        const review = { schema_version: '1.0', review_id: crypto.randomUUID(),
          request_id: audit.request_id, evaluation_id, decision_id: audit.decision_id,
          principal_id: audit.principal_id, agent_id: request.speaker_id, context: decision.context,
          tool_id: request.tool, binding, binding_hash: bindingHash(binding), policy_version: this.#policy.policy_version,
          policy_fingerprint: this.#policyFingerprint, original_outcome: decision.outcome,
          original_envelope: decision.capability_envelope, original_reason_codes: decision.reason_codes,
          cde_gate: signal.gate, signal_reason_codes: signal.reason_codes, created_at: new Date(this.#auditClock()).toISOString(),
          status: 'pending', resolved_at: null, reviewer_principal_id: null, resolution: null,
          resolution_reason: null, consumed_at: null, execution: null };
        // Never persist reflected authentication secrets as identity metadata.
        if (audit.redact && canonical(audit.redact(review)) !== canonical(review)) throw new Error('Unsafe review metadata');
        tx.reviews.insert(validateReview(review));
        this._reviewAudit(tx, 'review.requested', review, fields);
        reviewId = review.review_id;
      }
      return decision;
    });
    if (reviewId) this.#reviewIds.set(result, reviewId);
    return result;
  }

  _decide(tx, signal, request, evaluation_id, leaseObserved = () => {}) {
    const context = contextFor(request);
    validateSignal(signal, context);
    if (!text(evaluation_id) || !text(request.tool)) throw new Error("Missing evaluation ID or tool");
    const { key, state } = this._lookup(tx, request, true);
    const reasons = [];
    if (!tx.evaluations.consume(key, evaluation_id)) throw new Error("CDE evaluation already consumed");
    {
      const target = signal.reason_codes.includes("QUARANTINE_THRESHOLD_REACHED") ? 3 : signal.gate;
      if (target > state.level) {
        state.level = target;
        state.clean = 0;
        state.revision++;
        tx.leases.revokeContext(key, "ENVELOPE_CONTRACTED");
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

    tx.contexts.save(key, state);
    return this._determine(tx, signal, request, evaluation_id, context, state, reasons, leaseObserved);
  }

  _determine(tx, signal, request, evaluation_id, context, state, reasons, leaseObserved = () => {},
    reviewSatisfied = false, boundLeaseValidation = null) {
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
    } else if (!reviewSatisfied && signal.reason_codes.includes("LOW_CONFIDENCE")) {
      outcome = "human_review"; reason = "low_confidence_requires_human_review";
    } else if (missing.length) {
      outcome = "constrain"; reason = "gate_1_requires_dry_run_and_diff";
    } else if (leaseRequired) {
      const leaseValidation = boundLeaseValidation ?? this._validateLease(tx, request);
      leaseObserved(leaseValidation);
      if (!leaseValidation.valid) {
        // Keep the v1 wire reason; detailed reasons are available through validateLease.
        outcome = "deny"; reason = "gate_2_requires_valid_lease";
      } else reason = "gate_2_lease_valid";
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

  reviewIdForDecision(decision) { return this.#reviewIds.get(decision) ?? null; }

  _reviewAudit(tx, type, review, fields = {}) {
    const tool = this.#policy.tools.find(tool => tool.id === review.tool_id);
    tx.audit.append(reviewEvent(type, { request_id: review.request_id, principal_id: review.principal_id,
      decision_id: review.decision_id }, { evaluation_id: review.evaluation_id, review_id: review.review_id,
      reviewer_principal_id: review.reviewer_principal_id, agent_id: review.agent_id,
      context: review.context, tool_id: review.tool_id, tool_class: tool?.class ?? null,
      arguments_hash: review.binding.arguments_hash, policy_version: review.policy_version,
      outcome: review.status, reason_codes: review.execution ? [review.execution.reason] : review.original_reason_codes,
      envelope: review.original_envelope, gate: review.cde_gate, ...fields }, this.#auditClock));
  }

  _reviewAccess(principal, review, resolve = false) {
    if (!review || !reviewerMayAccess(principal, review)
        || (resolve && (!principal.permissions.includes('review.resolve') || principal.principal_id === review.principal_id))) {
      throw new Error('Review unavailable or forbidden');
    }
  }

  listReviews(principal) {
    if (!principal?.permissions?.includes('review.access')) throw new Error('Review access forbidden');
    return this.#store.transaction(tx => tx.reviews.list().filter(r => r.status === 'pending' && reviewerMayAccess(principal, r)));
  }

  getReview(reviewId, principal) {
    return this.#store.transaction(tx => {
      const review = tx.reviews.get(reviewId); this._reviewAccess(principal, review); return review;
    });
  }

  _revalidateReview(tx, review) {
    const rejected = reason => ({ eligible: false, reason, decision: null, lease_check: null });
    if (!review.principal_id) return rejected('UNBOUND_REQUEST_PRINCIPAL');
    if (review.policy_fingerprint !== this.#policyFingerprint || review.policy_version !== this.#policy.policy_version) return rejected('POLICY_CHANGED');
    const request = reviewRequest(review);
    const { key, state } = this._lookup(tx, request);
    if (!state) return rejected('AUTHORITY_STATE_MISSING');
    if (state.level > LEVELS.indexOf(review.original_envelope.level)) return rejected('AUTHORITY_CONTRACTED');
    let leaseValidation = { valid: false, reason: 'missing' };
    if (review.binding.lease_present) {
      const lease = tx.leases.getByNonce(review.binding.lease_nonce);
      leaseValidation = this._validateLeaseRecord(tx, lease, key, state, review.tool_id,
        lease && crypto.createHash('sha256').update(lease.args).digest('hex') === review.binding.arguments_hash);
      if (!leaseValidation.valid) return { ...rejected(leaseValidation.reason.toUpperCase()), lease_check: leaseValidation.reason };
    }
    const decision = this._determine(tx, { gate: review.cde_gate, reason_codes: review.signal_reason_codes },
      request, review.evaluation_id, review.context, state, [], () => {}, true, leaseValidation);
    return { eligible: decision.outcome === 'allow', reason: decision.reason.toUpperCase(), decision,
      lease_check: review.binding.lease_present || decision.authority_requirement === 'lease' ? leaseValidation.reason : null };
  }

  resolveReview(reviewId, resolution, principal, auditContext = {}) {
    if (!['approve','deny'].includes(resolution)) throw new Error('Invalid review resolution');
    return this.#store.transaction(tx => {
      const review = tx.reviews.get(reviewId); this._reviewAccess(principal, review, true);
      if (review.status !== 'pending') throw new Error('Review already resolved');
      review.resolved_at = new Date(this.#auditClock()).toISOString();
      review.reviewer_principal_id = principal.principal_id; review.resolution = resolution;
      review.resolution_reason = resolution === 'approve' ? 'REVIEWER_APPROVED' : 'REVIEWER_DENIED';
      const result = resolution === 'approve' ? this._revalidateReview(tx, review)
        : { eligible: false, reason: 'REVIEWER_DENIED', lease_check: null };
      review.status = resolution === 'deny' ? 'denied' : result.eligible ? 'approved' : 'invalidated';
      review.execution = { eligible: result.eligible, reason: result.reason, checked_at: review.resolved_at };
      if (auditContext.redact && canonical(auditContext.redact(review)) !== canonical(review)) throw new Error('Unsafe review metadata');
      tx.reviews.save(review);
      this._reviewAudit(tx, resolution === 'approve' ? 'review.approved' : 'review.denied', review,
        { reason_codes: [review.resolution_reason], lease_check: result.lease_check });
      if (review.status === 'invalidated') this._reviewAudit(tx, 'review.invalidated', review, { lease_check: result.lease_check });
      return { review, ready_for_consumption: result.eligible, execution_authorized: false };
    });
  }

  consumeReview(reviewId, request, principal) {
    if (!principal?.permissions?.includes('runtime.evaluate')) throw new Error('Review consumption forbidden');
    return this.#store.transaction(tx => {
      const review = tx.reviews.get(reviewId);
      if (!review || review.principal_id !== principal.principal_id || review.agent_id !== principal.agent_id
          || request.speaker_id !== principal.agent_id
          || !principal.allowed_contexts?.some(scope => ['session_id','channel_id','scene_id','task_id']
            .every(key => scope[key] === (request[key] ?? (key === 'session_id' ? 'default' : null))))
          || canonical(contextFor(request)) !== canonical(review.context)) throw new Error('Review binding forbidden');
      if (review.status !== 'approved') throw new Error('Review not approved or already consumed');
      const binding = requestBinding(request, principal.principal_id);
      const result = bindingHash(binding) === review.binding_hash ? this._revalidateReview(tx, review)
        : { eligible: false, reason: 'REQUEST_BINDING_CHANGED', decision: null, lease_check: null };
      const now = new Date(this.#auditClock()).toISOString();
      review.execution = { eligible: result.eligible, reason: result.reason, checked_at: now };
      review.status = result.eligible ? 'consumed' : 'invalidated';
      review.consumed_at = result.eligible ? now : null;
      tx.reviews.save(review);
      if (result.eligible) {
        this._reviewAudit(tx, 'review.execution_authorized', review, { lease_check: result.lease_check, envelope: result.decision.capability_envelope });
        this._reviewAudit(tx, 'review.execution_consumed', review, { lease_check: result.lease_check, envelope: result.decision.capability_envelope });
      } else this._reviewAudit(tx, 'review.invalidated', review, { lease_check: result.lease_check });
      return { review_id: review.review_id, correlation: { request_id: review.request_id, decision_id: review.decision_id }, execution_authorized: result.eligible,
        reason: result.reason, authority_decision: result.decision };
    });
  }

  issue(request, auditContext) {
    const audit = correlation(auditContext);
    return this.#store.transaction(tx => {
      const lease = this._issue(tx, request);
      this._audit(tx, 'lease.issued', audit, request, { lease_id: lease.lease_id,
        lease_epoch: tx.leaseEpoch.current(), expires_at_utc: lease.expires_at, outcome: 'issued' });
      return lease;
    });
  }

  _issue(tx, request) {
    const { context, key, state } = this._lookup(tx, request);
    const seconds = Number(request.seconds);
    if (!state || !this._tools(state).includes(request.tool)) throw new Error("Lease requires an evaluated context and capability in current envelope");
    if (!Number.isFinite(seconds) || seconds < .001 || seconds > 300) throw new Error("Lease duration must be 0.001–300 seconds");
    if (!request.args || typeof request.args !== "object" || Array.isArray(request.args)) throw new Error("Lease requires exact args object");
    const token = crypto.randomUUID();
    const nonce = crypto.createHash("sha256").update(token).digest("hex");
    const issuance_epoch = tx.leaseEpoch.current();
    const expires_at_ms = this.clock() + Math.floor(seconds * 1000);
    tx.leases.insert(token, { key, tool: request.tool, args: canonical(request.args), expires_at_ms, revoked: null, nonce, issuance_epoch });
    return { lease_token: token, lease_id: nonce,
      context, expires_at: new Date(expires_at_ms).toISOString(), issuer: "kingpin" };
  }

  // v0.4 detailed internal validation; public v1 decision projections stay unchanged.
  validateLease(request) {
    return this.#store.transaction(tx => this._validateLease(tx, request));
  }

  hasValidLease(request) {
    return this.validateLease(request).valid;
  }

  _validateLease(tx, request) {
    const { key, state } = this._lookup(tx, request);
    const lease = tx.leases.get(request.lease_token);
    return this._validateLeaseRecord(tx, lease, key, state, request.tool, lease?.args === canonical(request.args ?? {}));
  }

  _validateLeaseRecord(tx, lease, key, state, tool, argsMatch) {
    const result = reason => ({ valid: reason === "ok", reason });
    if (!lease) return result("missing");
    if (!state || lease.key !== key || lease.tool !== tool || !argsMatch) return result("out_of_scope");
    if (!(lease.expires_at_ms > this.clock())) return result("expired");
    if (lease.issuance_epoch !== tx.leaseEpoch.current()) return result("epoch_revoked");
    if (tx.nonceRevocations.has(lease.nonce)) return result("nonce_revoked");
    if (lease.revoked) return result({ EXPLICIT_REVOCATION: "explicit_revoked",
      CAPABILITY_REVOKED: "capability_revoked", ENVELOPE_CONTRACTED: "envelope_contracted" }[lease.revoked]);
    if (!this._tools(state).includes(tool)) return result("outside_capability_envelope");
    return result("ok");
  }

  // Trusted control-plane APIs only: no new gateway routes or request-selected epochs.
  revokeLeaseNonce(nonce, auditContext) {
    const audit = correlation(auditContext);
    return this.#store.transaction(tx => {
      if (!text(nonce) || !tx.leases.getByNonce(nonce)) throw new Error("Unknown lease nonce");
      tx.nonceRevocations.add(nonce);
      const lease = tx.leases.getByNonce(nonce);
      const context = JSON.parse(lease.key);
      this._audit(tx, 'lease.revoked', audit, { tool: lease.tool }, { lease_id: nonce,
        context, agent_id: context.speaker_id, lease_epoch: lease.issuance_epoch,
        reason_codes: ['NONCE_REVOKED'] });
      return { revoked: true, lease_nonce: nonce };
    });
  }

  revokeAllLeases(auditContext) {
    const audit = correlation(auditContext);
    return this.#store.transaction(tx => {
      const lease_epoch = tx.leaseEpoch.advance();
      this._audit(tx, 'lease.epoch_advanced', audit, {}, { lease_epoch, reason_codes: ['EPOCH_ADVANCED'] });
      return { revoked: true, lease_epoch };
    });
  }

  revoke(request, auditContext) {
    const audit = correlation(auditContext);
    return this.#store.transaction(tx => {
      const result = this._revoke(tx, request);
      this._audit(tx, request.lease_token ? 'lease.revoked' : 'capability.revoked', audit, request,
        { lease_id: result.target.lease_id ?? null, envelope: result.capability_envelope,
          reason_codes: [request.lease_token ? 'EXPLICIT_REVOCATION' : 'CAPABILITY_REVOKED'] });
      return result;
    });
  }

  _revoke(tx, request) {
    const { context, key, state } = this._lookup(tx, request);
    if (!state) throw new Error("Unknown authority context");
    if (request.lease_token) {
      const lease = tx.leases.get(request.lease_token);
      if (!lease || lease.key !== key) throw new Error("Unknown lease in context");
      tx.leases.revoke(request.lease_token, "EXPLICIT_REVOCATION");
    } else if (this.#tools.has(request.tool)) {
      state.revoked.add(request.tool);
      tx.revocations.add(key, request.tool);
      tx.leases.revokeContext(key, "CAPABILITY_REVOKED", request.tool);
    } else throw new Error("Specify lease_token or known tool");
    state.revision++;
    tx.contexts.save(key, state);
    return { revoked: true, context, target: request.lease_token
      ? { lease_id: crypto.createHash("sha256").update(request.lease_token).digest("hex") }
      : { tool: request.tool }, capability_envelope: this._envelope(state) };
  }
}
