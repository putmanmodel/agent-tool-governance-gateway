import crypto from 'node:crypto';

export const EVENT_TYPES = Object.freeze([
  'authentication.rejected', 'cde.signal.created', 'authority.requested', 'authority.decision',
  'authority.contracted', 'authority.restored', 'recovery.stage_changed',
  'lease.issued', 'lease.rejected', 'lease.revoked', 'capability.revoked',
  'lease.epoch_advanced', 'review.requested', 'tool.enforcement.allowed',
  'tool.enforcement.denied', 'tool.enforcement.review', 'tool.enforcement.failed',
]);
export const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
    : JSON.stringify(value);
export const bindingHash = value => crypto.createHash('sha256').update(canonical(value ?? {})).digest('hex');
export function correlation(context = {}) {
  return { request_id: context.request_id ?? crypto.randomUUID(), principal_id: context.principal_id ?? null,
    decision_id: context.decision_id ?? null, redact: context.redact };
}
const nullable = ['evaluation_id', 'decision_id', 'principal_id', 'agent_id', 'tool_id', 'tool_class',
  'arguments_hash', 'lease_id', 'lease_check', 'outcome', 'expires_at_utc'];
export function event(type, context, fields, clock) {
  const record = { schema_version: '1.0', event_id: crypto.randomUUID(), event_type: type,
    timestamp_utc: new Date(clock()).toISOString(), request_id: context.request_id,
    ...Object.fromEntries(nullable.map(key => [key, null])), principal_id: context.principal_id,
    decision_id: context.decision_id, policy_version: null, context: null, reason_codes: [],
    requirements: null, envelope: null, gate: null, signal: null, lease_epoch: null, ...fields };
  const safe = context.redact ? context.redact(record) : record;
  validateEvent(safe);
  return safe;
}
const keys = ['schema_version', 'event_id', 'event_type', 'timestamp_utc', 'request_id', ...nullable,
  'policy_version', 'context', 'reason_codes', 'requirements', 'envelope', 'gate', 'signal', 'lease_epoch'];
export const REVIEW_EVENT_TYPES = Object.freeze(['review.requested', 'review.approved', 'review.denied',
  'review.invalidated', 'review.execution_authorized', 'review.execution_consumed']);
export function reviewEvent(type, context, fields, clock) {
  const { review_id, reviewer_principal_id, ...baseFields } = fields;
  const base = event('review.requested', context, baseFields, clock);
  return validateEvent({ ...base, schema_version: '2.0', event_type: type, review_id, reviewer_principal_id });
}
export const EXECUTION_EVENT_TYPES = Object.freeze(['started','succeeded','failed','unknown','reconciled_succeeded','reconciled_failed','reconciliation_required'].map(s => `tool.execution.${s}`));
export function executionEvent(record, clock) {
  const base = event('tool.enforcement.allowed', { request_id: record.request_id, principal_id: record.principal_id, decision_id: record.decision_id }, {
    evaluation_id: record.evaluation_id, agent_id: record.agent_id, context: record.context, tool_id: record.tool_id,
    arguments_hash: record.arguments_hash, outcome: record.status, reason_codes: record.failure_code ? [record.failure_code] : [],
  }, clock);
  return validateEvent({ ...base, schema_version: '3.0', event_type: `tool.execution.${record.status}`,
    execution_id: record.execution_id, review_id: record.review_id, request_hash: record.request_hash,
    result_metadata: record.result_metadata, reconciliation: record.reconciliation });
}
export function validateEvent(record) {
  if (record?.schema_version === '3.0') {
    const { execution_id, review_id, request_hash, result_metadata, reconciliation, ...base } = record;
    if (!EXECUTION_EVENT_TYPES.includes(record.event_type) || !/^[a-f0-9-]{36}$/.test(execution_id)
        || !(review_id === null || /^[a-f0-9-]{36}$/.test(review_id)) || !/^[a-f0-9]{64}$/.test(request_hash)
        || !(result_metadata === null || canonical(result_metadata) === '{"adapter_reported":true}')
        || !(reconciliation === null || (Object.keys(reconciliation).sort().join() === 'at,method,outcome,principal_id'
          && ['adapter','operator'].includes(reconciliation.method) && ['succeeded','failed','inconclusive','unsupported'].includes(reconciliation.outcome)
          && typeof reconciliation.at === 'string' && Number.isFinite(Date.parse(reconciliation.at))
          && (reconciliation.principal_id === null || typeof reconciliation.principal_id === 'string')))) throw Error('Invalid execution audit event');
    validateEvent({ ...base, schema_version: '1.0', event_type: 'tool.enforcement.allowed' });
    return record;
  }
  if (record?.schema_version === '2.0') {
    const { review_id, reviewer_principal_id, ...base } = record;
    if (!REVIEW_EVENT_TYPES.includes(record.event_type) || typeof review_id !== 'string'
        || !/^[a-f0-9-]{36}$/.test(review_id)
        || !(reviewer_principal_id === null || (typeof reviewer_principal_id === 'string' && reviewer_principal_id.length))) {
      throw new Error('Invalid governance review event');
    }
    validateEvent({ ...base, schema_version: '1.0', event_type: 'review.requested' });
    return record;
  }
  const fail = () => { throw new Error('Invalid governance audit event'); };
  if (!record || Object.keys(record).sort().join() !== [...keys].sort().join()
      || record.schema_version !== '1.0' || !EVENT_TYPES.includes(record.event_type)
      || !/^[0-9a-f-]{36}$/.test(record.event_id)
      || typeof record.request_id !== 'string' || !record.request_id.length
      || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(record.timestamp_utc)
      || !Number.isFinite(Date.parse(record.timestamp_utc))) fail();
  for (const key of [...nullable, 'policy_version']) if (record[key] !== null && typeof record[key] !== 'string') fail();
  if (!Array.isArray(record.reason_codes) || !record.reason_codes.every(v => typeof v === 'string')) fail();
  if (record.lease_epoch !== null && (!Number.isSafeInteger(record.lease_epoch) || record.lease_epoch < 0)) fail();
  if (record.gate !== null && ![0, 1, 2].includes(record.gate)) fail();
  for (const key of ['context', 'envelope', 'signal']) if (record[key] !== null
      && (typeof record[key] !== 'object' || Array.isArray(record[key]))) fail();
  const shape = (value, fields) => value && Object.keys(value).sort().join() === fields.sort().join();
  const strings = value => Array.isArray(value) && value.every(v => typeof v === 'string');
  if (record.context !== null && (!shape(record.context, ['session_id', 'speaker_id', 'channel_id', 'scope_key'])
      || !Object.values(record.context).every(v => typeof v === 'string' && v.length))) fail();
  if (record.envelope !== null) {
    const e = record.envelope;
    if (!shape(e, ['level', 'tools', 'revision', 'clean_evaluations', 'restoration_step_after', 'revoked_tools'])
        || !['full', 'non_destructive', 'read_only', 'quarantined'].includes(e.level)
        || !strings(e.tools) || !strings(e.revoked_tools) || !Number.isSafeInteger(e.revision) || e.revision < 0
        || ![0, 1].includes(e.clean_evaluations) || e.restoration_step_after !== 2) fail();
  }
  if (record.requirements !== null) {
    const r = record.requirements;
    if (!shape(r, ['evidence', 'missing_evidence', 'authority', 'tool_floor_gate'])
        || !strings(r.evidence) || !strings(r.missing_evidence) || !['none', 'lease'].includes(r.authority)
        || ![0, 1, 2].includes(r.tool_floor_gate)) fail();
  }
  if (record.signal !== null) {
    const s = record.signal, d = s.deviation;
    if (!shape(s, ['gate', 'reason_codes', 'deviation']) || ![0, 1, 2].includes(s.gate) || !strings(s.reason_codes)
        || !shape(d, ['severity', 'ema_severity', 'confidence', 'active', 'enter', 'exit', 'vector'])
        || ![d.severity, d.ema_severity, d.confidence].every(v => Number.isFinite(v) && v >= 0 && v <= 1)
        || ![d.active, d.enter, d.exit].every(v => typeof v === 'boolean')
        || !d.vector || typeof d.vector !== 'object' || Array.isArray(d.vector)
        || !Object.values(d.vector).every(v => Number.isFinite(v) && v >= 0)) fail();
  }
  if (record.lease_check !== null && !['ok', 'missing', 'expired', 'epoch_revoked', 'nonce_revoked',
      'out_of_scope', 'explicit_revoked', 'capability_revoked', 'envelope_contracted',
      'outside_capability_envelope'].includes(record.lease_check)) fail();
  for (const key of ['arguments_hash', 'lease_id']) if (record[key] !== null && !/^[a-f0-9]{64}$/.test(record[key])) fail();
  if (record.expires_at_utc !== null && !Number.isFinite(Date.parse(record.expires_at_utc))) fail();
  return record;
}
