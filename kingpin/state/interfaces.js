/**
 * Synchronous GovernanceStateStore contract (operational governance, not memory stratification).
 * bindPolicy(fingerprint, toolIds): bind once; refuse a different policy on subsequent use.
 * transaction(work): atomically commit all repositories below or throw/rollback.
 * getEventsForRequest(requestId): detached ordered audit records; query failure does not block writes.
 * contextCount(): diagnostic count only. close(): release resources.
 *
 * work receives:
 * audit.append(event): validate and append an immutable event in the same transaction.
 * Stored/query records add a monotonically increasing sequence; no update/delete API.
 * executions.get/list/insert/save: immutable authorized binding, unique decision/review/resource and guarded receipt transitions
 * audit.forRequest(requestId): transaction-local correlated event facts for execution binding checks
 * reviews.get(reviewId) / list() -> detached review records
 * reviews.insert(pendingReview); reviews.save(nextReview) -> validated immutable binding/history and legal transition
 * contexts.get(key) -> {level, clean, revision} | undefined
 * contexts.create(key, state); contexts.save(key, state)
 * evaluations.consume(key, evaluationId) -> boolean (atomic insert-if-absent)
 * revocations.list(key) -> Set<tool>; revocations.add(key, tool)
 * leases.get(token) / getByNonce(nonce) -> {key, tool, args, expires_at_ms, revoked, nonce, issuance_epoch} | undefined
 * leases.insert(token, lease); leases.revoke(token, reason)
 * leases.revokeContext(key, reason, optionalTool)
 * leaseEpoch.current() -> nonnegative safe integer; leaseEpoch.advance() -> next epoch
 * nonceRevocations.has(nonce) -> boolean; nonceRevocations.add(nonce) (idempotent)
 * v0.4 nonce/epoch state is independent of legacy context/capability revocation.
 *
 * Repositories persist supplied facts; only Kingpin selects transitions and reasons.
 * Callbacks must be synchronous and repositories cannot escape their transaction.
 */
export function assertStore(store) {
  for (const method of ['bindPolicy', 'transaction', 'contextCount', 'close']) {
    if (typeof store?.[method] !== 'function') throw new Error(`Invalid governance store: missing ${method}`);
  }
}
export function check(condition, message) {
  if (!condition) throw new Error(`Invalid governance state: ${message}`);
}
export function validContext(key, state) {
  let context;
  try { context = JSON.parse(key); } catch { check(false, 'invalid context key'); }
  check(context && typeof context === 'object' && Object.keys(context).sort().join(',') === 'channel_id,scope_key,session_id,speaker_id'
    && Object.values(context).every(value => typeof value === 'string' && value.trim()), 'invalid context identity');
  check(key === JSON.stringify(Object.fromEntries(Object.entries(context).sort(([a], [b]) => a.localeCompare(b))))
    && /^(scene|task|agent):.+/.test(context.scope_key), 'noncanonical context identity');
  check(Number.isInteger(state.level) && state.level >= 0 && state.level <= 3
    && [0, 1].includes(state.clean) && (state.level !== 0 || state.clean === 0)
    && Number.isSafeInteger(state.revision) && state.revision >= 0, 'invalid envelope/recovery record');
}
export function validEpoch(epoch) {
  check(Number.isSafeInteger(epoch) && epoch >= 0, 'invalid lease epoch');
}
export function validLease(lease, { legacy = false } = {}) {
  if (!legacy) {
    check(typeof lease.nonce === 'string' && /^[a-f0-9]{64}$/.test(lease.nonce), 'invalid lease nonce');
    validEpoch(lease.issuance_epoch);
  }
  check(typeof lease.tool === 'string' && lease.tool.trim()
    && typeof lease.args === 'string' && lease.args.startsWith('{') && lease.args.endsWith('}')
    && Number.isFinite(lease.expires_at_ms)
    && [null, 'EXPLICIT_REVOCATION', 'CAPABILITY_REVOKED', 'ENVELOPE_CONTRACTED'].includes(lease.revoked), 'invalid lease record');
  // Canonical JS args may contain "undefined" for programmatic callers; preserve
  // the exact existing string rather than reparsing/normalizing lease arguments.
}
