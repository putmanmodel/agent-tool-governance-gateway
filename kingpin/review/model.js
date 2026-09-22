import { bindingHash, canonical } from '../audit/events.js';
import { check, validContext } from '../state/interfaces.js';
import crypto from 'node:crypto';

const hashToken = token => typeof token === 'string' ? crypto.createHash('sha256').update(token).digest('hex') : bindingHash(token);
export function requestBinding(request, principalId) {
  return { principal_id: principalId, agent_id: request.agent_id ?? request.speaker_id,
    speaker_id: request.speaker_id, session_id: request.session_id ?? 'default', channel_id: request.channel_id,
    scene_id: request.scene_id ?? null, task_id: request.task_id ?? null, tool_id: request.tool,
    arguments_hash: bindingHash(request.args ?? {}),
    action_hash: bindingHash([request.action ?? null, request.tool_action ?? null]),
    target_hash: bindingHash([request.target ?? null, request.tool_target ?? null]),
    observation_hash: bindingHash([request.plan_id ?? null, request.user_request ?? null]),
    dry_run: request.dry_run === true, diff_present: request.diff != null && Boolean(String(request.diff).trim()),
    diff_hash: bindingHash(request.diff ?? null),
    lease_present: Boolean(request.lease_token), lease_nonce: request.lease_token ? hashToken(request.lease_token) : null };
}
export function reviewRequest(review) {
  const b = review.binding;
  return { tool: b.tool_id, speaker_id: b.speaker_id, session_id: b.session_id, channel_id: b.channel_id,
    scene_id: b.scene_id, task_id: b.task_id, dry_run: b.dry_run, diff: b.diff_present ? 'present' : null };
}
export function reviewerMayAccess(principal, review) {
  if (!principal?.permissions?.includes('review.access')) return false;
  return !principal.allowed_contexts || principal.allowed_contexts.some(scope =>
    ['session_id','channel_id','scene_id','task_id'].every(key => scope[key] === review.binding[key]));
}
const mutable = ['status', 'resolved_at', 'reviewer_principal_id', 'resolution', 'resolution_reason', 'consumed_at', 'execution'];
const keys = ['schema_version','review_id','request_id','evaluation_id','decision_id','principal_id','agent_id','context',
  'tool_id','binding','binding_hash','policy_version','policy_fingerprint','original_outcome','original_envelope',
  'original_reason_codes','cde_gate','signal_reason_codes','created_at',...mutable];
const bindingKeys = ['principal_id','agent_id','speaker_id','session_id','channel_id','scene_id','task_id','tool_id',
  'arguments_hash','action_hash','target_hash','observation_hash','dry_run','diff_present','diff_hash','lease_present','lease_nonce'];
const text = value => typeof value === 'string' && value.length > 0;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const date = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
export function validateReview(r) {
  check(r && Object.keys(r).sort().join() === [...keys].sort().join(), 'invalid review fields');
  check(r.schema_version === '1.0' && /^[a-f0-9-]{36}$/.test(r.review_id), 'invalid review identity');
  check(['request_id','evaluation_id','decision_id','agent_id','tool_id','policy_version'].every(key => text(r[key]))
    && (r.principal_id === null || text(r.principal_id)), 'invalid review provenance');
  check(hash(r.policy_fingerprint) && hash(r.binding_hash) && date(r.created_at), 'invalid review binding/time');
  const b = r.binding;
  check(b && Object.keys(b).sort().join() === [...bindingKeys].sort().join()
    && ['agent_id','speaker_id','session_id','channel_id','tool_id'].every(key => text(b[key]))
    && ['scene_id','task_id'].every(key => b[key] === null || text(b[key]))
    && ['arguments_hash','action_hash','target_hash','observation_hash','diff_hash'].every(key => hash(b[key]))
    && ['dry_run','diff_present','lease_present'].every(key => typeof b[key] === 'boolean')
    && (b.lease_present ? hash(b.lease_nonce) : b.lease_nonce === null), 'invalid review request summary');
  check(bindingHash(b) === r.binding_hash && b.principal_id === r.principal_id && b.agent_id === r.agent_id
    && b.agent_id === b.speaker_id && b.tool_id === r.tool_id, 'review binding mismatch');
  const context = { session_id:b.session_id, speaker_id:b.speaker_id, channel_id:b.channel_id,
    scope_key: b.scene_id ? `scene:${b.scene_id}` : b.task_id ? `task:${b.task_id}` : `agent:${b.speaker_id}` };
  check(canonical(context) === canonical(r.context), 'review context mismatch');
  const e = r.original_envelope;
  check(e && Object.keys(e).sort().join() === 'clean_evaluations,level,restoration_step_after,revision,revoked_tools,tools'
    && ['full','non_destructive','read_only','quarantined'].includes(e.level)
    && Array.isArray(e.tools) && e.tools.includes(r.tool_id) && Array.isArray(e.revoked_tools)
    && e.tools.every(text) && e.revoked_tools.every(text) && e.restoration_step_after === 2, 'invalid original review envelope');
  validContext(canonical(r.context), { level:['full','non_destructive','read_only','quarantined'].indexOf(e.level), clean:e.clean_evaluations, revision:e.revision });
  check(r.original_outcome === 'human_review' && r.cde_gate === 1
    && canonical(r.signal_reason_codes) === '["LOW_CONFIDENCE"]'
    && Array.isArray(r.original_reason_codes) && r.original_reason_codes.every(text)
    && r.original_reason_codes.includes('LOW_CONFIDENCE_REQUIRES_HUMAN_REVIEW'), 'invalid review trigger');
  check(['pending','approved','denied','invalidated','consumed'].includes(r.status), 'invalid review status');
  if (r.status === 'pending') {
    check(mutable.filter(key => key !== 'status').every(key => r[key] === null), 'pending review has resolution');
  } else {
    check(date(r.resolved_at) && text(r.reviewer_principal_id)
      && r.reviewer_principal_id !== r.principal_id, 'invalid reviewer resolution');
    check(r.resolution === (r.status === 'denied' ? 'deny' : 'approve')
      && r.resolution_reason === (r.resolution === 'deny' ? 'REVIEWER_DENIED' : 'REVIEWER_APPROVED'), 'invalid historical resolution');
    check(r.status === 'consumed' ? date(r.consumed_at) : r.consumed_at === null, 'invalid review consumption');
    check(r.execution && Object.keys(r.execution).sort().join() === 'checked_at,eligible,reason'
      && typeof r.execution.eligible === 'boolean' && text(r.execution.reason) && date(r.execution.checked_at)
      && r.execution.eligible === ['approved','consumed'].includes(r.status), 'invalid review execution state');
  }
  return r;
}
export function validateReviewTransition(previous, next) {
  validateReview(previous); validateReview(next);
  check(Object.keys(previous).filter(key => !mutable.includes(key)).every(key => canonical(previous[key]) === canonical(next[key])), 'immutable review request');
  check((previous.status === 'pending' && ['approved','denied','invalidated'].includes(next.status))
    || (previous.status === 'approved' && ['consumed','invalidated'].includes(next.status)), 'review transition not permitted');
  if (previous.status !== 'pending') {
    check(['resolved_at','reviewer_principal_id','resolution','resolution_reason'].every(key => previous[key] === next[key]), 'immutable reviewer resolution');
  }
}
