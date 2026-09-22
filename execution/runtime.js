import crypto from 'node:crypto';
import { bindingHash, canonical, executionEvent } from '../kingpin/audit/events.js';
import { requestBinding } from '../kingpin/review/model.js';
import { UNRESOLVED, validateExecution } from './model.js';

// Records facts after Kingpin authorization. Never evaluates authority policy.
export class ExecutionRuntime {
  #store; #adapter; #clock; #grants = new WeakMap();
  constructor({ store, adapter, clock = Date.now }) { this.#store = store; this.#adapter = adapter; this.#clock = clock; }
  capture(request, decision, audit, reviewId = null) {
    if (decision?.outcome !== 'allow' || decision.issuer !== 'kingpin' || !audit?.principal_id) throw Error('Execution requires authorization');
    const grant = Object.freeze({});
    this.#grants.set(grant, { decision: structuredClone(decision), requestHash: bindingHash(requestBinding(request, audit.principal_id)), audit: { ...audit }, reviewId });
    return grant;
  }
  #time() { return new Date(this.#clock()).toISOString(); }
  #save(tx, r) { validateExecution(r); tx.executions.save(r); tx.audit.append(executionEvent(r, this.#clock)); return r; }
  run(grant, request) {
    const authorization = this.#grants.get(grant);
    if (!authorization || authorization.requestHash !== bindingHash(requestBinding(request, authorization.audit.principal_id))) throw Error('Execution authorization binding mismatch');
    this.#grants.delete(grant);
    const { decision, audit, reviewId } = authorization;
    // Explicit adapter declaration; unknown adapters/tools default to side-effecting.
    if (this.#adapter.isSideEffecting?.(request.tool) === false) return { tool_result: this.#adapter.execute(request) };
    let preparation = null, preparationFailed = false;
    try { preparation = this.#adapter.prepare?.(request) ?? null; } catch { preparationFailed = true; }
    const binding = requestBinding(request, audit.principal_id);
    const r = { schema_version: '1.0', execution_id: crypto.randomUUID(), request_id: audit.request_id,
      decision_id: audit.decision_id, evaluation_id: decision.evaluation_id, principal_id: audit.principal_id,
      agent_id: request.speaker_id, context: decision.context, tool_id: request.tool,
      arguments_hash: bindingHash(request.args ?? {}), request_hash: authorization.requestHash,
      authorization_source: reviewId ? 'review' : 'decision', review_id: reviewId,
      scope: Object.fromEntries(['session_id','channel_id','scene_id','task_id'].map(k => [k, binding[k]])),
      resource_hash: preparation?.resource_hash ?? bindingHash([request.tool, request.args ?? {}]),
      reconciliation_data: preparation?.evidence ?? null, status: 'started', started_at: this.#time(), completed_at: null,
      result_metadata: null, failure_code: null, reconciliation: null };
    if (audit.redact && canonical(audit.redact(r)) !== canonical(r)) throw Error('Unsafe execution metadata');
    this.#store.transaction(tx => {
      const events = tx.audit.forRequest(r.request_id);
      const matches = e => e.decision_id === r.decision_id && e.evaluation_id === r.evaluation_id
        && e.principal_id === r.principal_id && e.tool_id === r.tool_id && e.arguments_hash === r.arguments_hash
        && canonical(e.context) === canonical(r.context);
      if (!events.some(e => matches(e) && e.event_type === 'tool.enforcement.allowed')
        || !events.some(e => matches(e) && (reviewId ? e.event_type === 'review.execution_consumed' && e.review_id === reviewId
          : e.event_type === 'authority.decision' && e.outcome === 'allow'))) throw Error('Missing durable authorization');
      if (reviewId && tx.reviews.get(reviewId)?.binding_hash !== r.request_hash) throw Error('Review execution binding mismatch');
      const prior = tx.executions.list().find(e => e.decision_id === r.decision_id || (r.review_id && e.review_id === r.review_id)
        || (e.resource_hash === r.resource_hash && UNRESOLVED.includes(e.status)));
      if (prior) throw Object.assign(Error('Execution already recorded or resource requires reconciliation'), { code: 'EXECUTION_CONFLICT', execution_id: prior.execution_id });
      tx.executions.insert(validateExecution(r)); tx.audit.append(executionEvent(r, this.#clock));
    });
    // Hold the store's writer lock while a synchronous adapter is running. The
    // start was committed in the prior transaction. Recovery cannot overtake a
    // live result; a crash/rollback still leaves the durable start as uncertain.
    try {
      return this.#store.transaction(tx => {
        const current = tx.executions.get(r.execution_id);
        if (current?.status !== 'started') throw Error('Execution superseded by recovery');
        let result;
        try {
          if (preparationFailed) throw Object.assign(Error('Adapter rejected preparation'), { knownNoEffect: true });
          result = this.#adapter.execute(request);
          if (result?.then) throw Error('Asynchronous adapter unsupported');
        } catch (error) {
          current.status = error.knownNoEffect === true ? 'failed' : 'unknown';
          current.failure_code = current.status === 'failed' ? 'ADAPTER_REJECTED' : 'ADAPTER_OUTCOME_UNKNOWN';
          current.completed_at = current.status === 'failed' ? this.#time() : null;
          this.#save(tx, current);
          return { execution_id: r.execution_id, execution_status: current.status, error: 'Adapter execution did not produce a successful receipt' };
        }
        current.status = 'succeeded'; current.completed_at = this.#time(); current.result_metadata = { adapter_reported: true };
        this.#save(tx, current);
        return { execution_id: r.execution_id, execution_status: 'succeeded', tool_result: result };
      });
    } catch {
      this.#unknownBestEffort(r.execution_id);
      return { execution_id: r.execution_id, execution_status: 'unknown', error: 'Execution receipt unavailable; do not retry' };
    }
  }
  #finish(id, status, code) {
    return this.#store.transaction(tx => {
      const r = tx.executions.get(id); if (r?.status !== 'started') throw Error('Execution already transitioned');
      r.status = status; r.failure_code = code; r.completed_at = status === 'unknown' ? null : this.#time();
      r.result_metadata = status === 'succeeded' ? { adapter_reported: true } : null;
      return this.#save(tx, r);
    });
  }
  #unknownBestEffort(id) { try { this.#finish(id, 'unknown', 'RECEIPT_UNAVAILABLE'); } catch {} }
  recover() {
    // Evaluator holds its exclusive process lock before recovery. Never execute here.
    const pending = this.#store.transaction(tx => {
      const records = tx.executions.list();
      for (const r of records.filter(r => r.status === 'started')) {
        r.status = 'unknown'; r.failure_code = 'RUNTIME_DISAPPEARED'; this.#save(tx, r);
      }
      return records.filter(r => ['started','unknown'].includes(r.status)).map(r => r.execution_id);
    });
    for (const id of pending) this.#reconcile(id);
    return pending.length;
  }
  #access(principal, record, permission) {
    if (!principal?.permissions?.includes(permission) || !record || (principal.allowed_contexts
      && !principal.allowed_contexts.some(scope => canonical(scope) === canonical(record.scope)))) throw Error('Execution unavailable or forbidden');
  }
  list(principal) {
    if (!principal?.permissions?.includes('execution.read')) throw Error('Execution access forbidden');
    return this.#store.transaction(tx => tx.executions.list().filter(r => UNRESOLVED.includes(r.status)
      && (!principal.allowed_contexts || principal.allowed_contexts.some(scope => canonical(scope) === canonical(r.scope)))));
  }
  get(id, principal) { return this.#store.transaction(tx => { const r = tx.executions.get(id); this.#access(principal, r, 'execution.read'); return r; }); }
  reconcile(id, principal) { this.#access(principal, this.get(id, principal), 'execution.reconcile'); return this.#reconcile(id); }
  #reconcile(id) {
    return this.#store.transaction(tx => {
      const r = tx.executions.get(id);
      if (!r || !['unknown','reconciliation_required'].includes(r.status)) throw Error('Execution is not reconcilable');
      let outcome = 'unsupported';
      try { if (this.#adapter.reconcile) outcome = this.#adapter.reconcile(structuredClone(r.reconciliation_data)); }
      catch { outcome = 'inconclusive'; }
      if (!['succeeded','failed','inconclusive','unsupported'].includes(outcome)) outcome = 'inconclusive';
      r.status = ['succeeded','failed'].includes(outcome) ? `reconciled_${outcome}` : 'reconciliation_required';
      r.completed_at = r.status === 'reconciliation_required' ? null : this.#time();
      r.reconciliation = { method: 'adapter', outcome, principal_id: null, at: this.#time() };
      return this.#save(tx, r);
    });
  }
  resolve(id, outcome, principal, auditContext = {}) {
    if (!['succeeded','failed'].includes(outcome)) throw Error('Explicit outcome required');
    return this.#store.transaction(tx => {
      const r = tx.executions.get(id); this.#access(principal, r, 'execution.resolve');
      if (r.status !== 'reconciliation_required') throw Error('Execution does not require disposition');
      r.status = `reconciled_${outcome}`; r.completed_at = this.#time();
      r.reconciliation = { method: 'operator', outcome, principal_id: principal.principal_id, at: this.#time() };
      if (auditContext.redact && canonical(auditContext.redact(r)) !== canonical(r)) throw Error('Unsafe execution metadata');
      return this.#save(tx, r);
    });
  }
}
