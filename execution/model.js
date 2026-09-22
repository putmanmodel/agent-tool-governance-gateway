import { canonical } from '../kingpin/audit/events.js';
import { check } from '../kingpin/state/interfaces.js';
export const STATUSES = ['started','succeeded','failed','unknown','reconciled_succeeded','reconciled_failed','reconciliation_required'];
export const UNRESOLVED = ['started','unknown','reconciliation_required'];
const mutable = ['status','completed_at','result_metadata','failure_code','reconciliation'];
const keys = ['schema_version','execution_id','request_id','decision_id','evaluation_id','principal_id','agent_id','context',
  'tool_id','arguments_hash','request_hash','authorization_source','review_id','scope','resource_hash','reconciliation_data','started_at',...mutable];
const hash = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const text = x => typeof x === 'string' && x.length > 0 && x.length <= 1024;
const date = x => typeof x === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x) && Number.isFinite(Date.parse(x));
export function validateExecution(r) {
  check(r && Object.keys(r).sort().join() === [...keys].sort().join(), 'invalid execution fields');
  check(r.schema_version === '1.0' && /^[a-f0-9-]{36}$/.test(r.execution_id)
    && ['request_id','decision_id','evaluation_id','principal_id','agent_id','tool_id'].every(k => text(r[k])), 'invalid execution identity');
  check(['arguments_hash','request_hash','resource_hash'].every(k => hash(r[k])), 'invalid execution binding');
  check(r.context && Object.keys(r.context).sort().join() === 'channel_id,scope_key,session_id,speaker_id'
    && Object.values(r.context).every(text) && r.context.speaker_id === r.agent_id, 'invalid execution context');
  check(r.scope && Object.keys(r.scope).sort().join() === 'channel_id,scene_id,session_id,task_id'
    && text(r.scope.session_id) && text(r.scope.channel_id)
    && ['scene_id','task_id'].every(k => r.scope[k] === null || text(r.scope[k]))
    && r.scope.session_id === r.context.session_id && r.scope.channel_id === r.context.channel_id
    && r.context.scope_key === (r.scope.scene_id ? `scene:${r.scope.scene_id}` : r.scope.task_id ? `task:${r.scope.task_id}` : `agent:${r.agent_id}`), 'invalid execution scope');
  check(['decision','review'].includes(r.authorization_source)
    && (r.authorization_source === 'review' ? typeof r.review_id === 'string' && /^[a-f0-9-]{36}$/.test(r.review_id) : r.review_id === null), 'invalid execution source');
  check(STATUSES.includes(r.status) && date(r.started_at)
    && (['started','unknown','reconciliation_required'].includes(r.status) ? r.completed_at === null : date(r.completed_at)), 'invalid execution status/time');
  check(r.result_metadata === null || canonical(r.result_metadata) === '{"adapter_reported":true}', 'invalid execution result');
  check(r.failure_code === null || ['ADAPTER_REJECTED','ADAPTER_OUTCOME_UNKNOWN','RECEIPT_UNAVAILABLE','RUNTIME_DISAPPEARED'].includes(r.failure_code), 'invalid execution failure');
  check(r.reconciliation_data === null || (typeof r.reconciliation_data === 'object' && !Array.isArray(r.reconciliation_data)
    && Buffer.byteLength(JSON.stringify(r.reconciliation_data)) <= 4096), 'invalid reconciliation evidence');
  if (r.reconciliation !== null) {
    const c = r.reconciliation;
    check(Object.keys(c).sort().join() === 'at,method,outcome,principal_id'
      && ['adapter','operator'].includes(c.method) && ['succeeded','failed','inconclusive','unsupported'].includes(c.outcome)
      && date(c.at) && (c.method === 'operator' ? text(c.principal_id) : c.principal_id === null), 'invalid reconciliation receipt');
  }
  if (r.status === 'started' || r.status === 'succeeded') check(r.failure_code === null && r.reconciliation === null, 'unexpected execution failure/disposition');
  if (r.status === 'failed') check(r.failure_code === 'ADAPTER_REJECTED' && r.reconciliation === null, 'missing known failure');
  if (['unknown','reconciliation_required','reconciled_succeeded','reconciled_failed'].includes(r.status)) {
    check(['ADAPTER_OUTCOME_UNKNOWN','RECEIPT_UNAVAILABLE','RUNTIME_DISAPPEARED'].includes(r.failure_code), 'missing uncertainty cause');
    if (r.status === 'unknown') check(r.reconciliation === null, 'unknown execution already reconciled');
  }
  check((r.status === 'succeeded') === (r.result_metadata !== null), 'inconsistent execution result');
  check(!r.status.startsWith('reconciled_') || r.reconciliation?.outcome === r.status.slice(11), 'inconsistent reconciliation');
  check(r.status !== 'reconciliation_required' || ['inconclusive','unsupported'].includes(r.reconciliation?.outcome), 'missing reconciliation disposition');
  return r;
}
export function validateExecutionTransition(previous, next) {
  validateExecution(previous); validateExecution(next);
  check(keys.filter(k => !mutable.includes(k)).every(k => canonical(previous[k]) === canonical(next[k])), 'immutable execution binding');
  const allowed = { started: ['succeeded','failed','unknown'], unknown: ['reconciled_succeeded','reconciled_failed','reconciliation_required'], reconciliation_required: ['reconciled_succeeded','reconciled_failed','reconciliation_required'] };
  check(allowed[previous.status]?.includes(next.status), 'execution transition not permitted');
}
