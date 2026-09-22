// Read-only projection of the existing authenticated product audit endpoint.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAuthentication } from '../kingpin/auth/access.js';

const labels = {
  'authentication.rejected': 'Authentication/permission rejected',
  'cde.signal.created': 'CDE signal created', 'authority.requested': 'Authority requested',
  'authority.decision': 'Kingpin decision', 'authority.contracted': 'Authority contracted',
  'authority.restored': 'Authority restored', 'recovery.stage_changed': 'Recovery stage changed',
  'lease.issued': 'Lease issued', 'lease.rejected': 'Lease rejected', 'lease.revoked': 'Lease revoked',
  'capability.revoked': 'Context capability revoked', 'lease.epoch_advanced': 'Lease epoch advanced',
  'review.requested': 'Review requested', 'review.approved': 'Reviewer approved (not execution)',
  'review.denied': 'Reviewer denied', 'review.invalidated': 'Review invalidated',
  'review.execution_authorized': 'Review execution authorized',
  'review.execution_consumed': 'One-use review authorization consumed',
  'tool.enforcement.allowed': 'Gateway enforcement allowed (permission only)',
  'tool.enforcement.denied': 'Gateway enforcement denied', 'tool.enforcement.review': 'Gateway withheld for review',
  'tool.enforcement.failed': 'Gateway enforcement failed',
  'tool.execution.started': 'Execution STARTED', 'tool.execution.succeeded': 'Execution SUCCEEDED (adapter receipt)',
  'tool.execution.failed': 'Execution FAILED', 'tool.execution.unknown': 'Execution UNKNOWN (outcome uncertain)',
  'tool.execution.reconciled_succeeded': 'Execution RECONCILED_SUCCEEDED',
  'tool.execution.reconciled_failed': 'Execution RECONCILED_FAILED',
  'tool.execution.reconciliation_required': 'Execution HUMAN DISPOSITION REQUIRED',
};
// Escape terminal controls; never render arbitrary payloads, reasons or results.
const display = value => JSON.stringify(String(value).slice(0, 256)).replace(/[\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,
  c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
export function formatTrace(requestId, events) {
  const lines = [`Request: ${display(requestId)}`];
  if (!events.length) return `${lines[0]}\nNo audit events found.\n`;
  for (const event of events) {
    if (event.request_id !== requestId) throw Error('Audit correlation mismatch');
    lines.push(`→ ${Object.hasOwn(labels, event.event_type) ? labels[event.event_type] : 'Unrecognized event (details omitted)'}`);
    if (!Object.hasOwn(labels, event.event_type)) continue;
    const fields = ['principal_id', 'agent_id', 'evaluation_id', 'decision_id', 'execution_id', 'review_id', 'reviewer_principal_id', 'tool_id'];
    const identity = fields.filter(k => typeof event[k] === 'string').map(k => `${k}=${display(event[k])}`);
    if (identity.length) lines.push(`  ${identity.join(' ')}`);
    if (event.context) lines.push('  Context: ' + ['session_id','speaker_id','channel_id','scope_key']
      .filter(k => typeof event.context[k] === 'string').map(k => `${k}=${display(event.context[k])}`).join(' '));
    if (event.event_type === 'authority.decision' && ['allow','deny','human_review','constrain','quarantine'].includes(event.outcome))
      lines.push(`  Outcome: ${display(event.outcome)}`);
    if (['ok','missing','expired','epoch_revoked','nonce_revoked','out_of_scope','explicit_revoked','capability_revoked','envelope_contracted','outside_capability_envelope'].includes(event.lease_check))
      lines.push(`  Lease: ${event.lease_check}`);
    if (['adapter', 'operator'].includes(event.reconciliation?.method)) {
      lines.push(`  Reconciliation source: ${event.reconciliation.method === 'adapter' ? 'adapter inspection' : 'operator disposition (human assertion)'}`);
    }
  }
  return lines.join('\n') + '\n';
}

export async function requestTrace(filename, requestId, fetcher = fetch) {
  if (typeof requestId !== 'string' || !requestId.trim() || requestId.length > 256 || /[\x00-\x20\x7f]/.test(requestId))
    throw Error('Provide one nonempty request ID (at most 256 characters)');
  let config, credentials, authentication;
  try {
    config = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (config.mode !== 'evaluation' || !['127.0.0.1','::1'].includes(config.host)
        || !Number.isInteger(config.port) || config.port < 1024 || config.port > 65535 || typeof config.auth !== 'string') throw Error();
    credentials = JSON.parse(fs.readFileSync(path.resolve(path.dirname(filename), config.auth), 'utf8'));
    authentication = createAuthentication(credentials);
  } catch { throw Error('Unable to load valid local evaluator/auth configuration'); }
  const admins = credentials.principals.filter(p => p.role === 'authority_admin');
  if (admins.length !== 1) throw Error('Trace requires exactly one authority_admin in the local credential file');
  let events;
  try {
    const response = await fetcher(`http://${config.host === '::1' ? '[::1]' : config.host}:${config.port}/audit/${encodeURIComponent(requestId)}`, {
      method: 'GET', headers: { authorization: `Bearer ${admins[0].token}` }, redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw Error();
    events = (await response.json()).events;
    if (!Array.isArray(events) || events.some(e => !e || e.request_id !== requestId)) throw Error();
  } catch { throw Error('Audit read failed; check the running evaluator and admin credential'); }
  // Reuse credential redaction before any selected identity fields reach the terminal.
  const safe = authentication.redact({ requestId, events });
  return formatTrace(safe.requestId, safe.events);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 4) throw Error('Usage: evaluation:trace runtime.json <request-id>');
    process.stdout.write(await requestTrace(process.argv[2], process.argv[3]));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
