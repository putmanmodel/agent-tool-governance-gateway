import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

// Local evaluator walkthrough holds all three roles deliberately. A real agent
// receives only its own token, never this credential file or admin/reviewer keys.
const filename = process.argv[2];
if (!filename) throw Error('Usage: evaluation:client runtime.json [--continuity]');
const config = JSON.parse(fs.readFileSync(filename, 'utf8'));
const principals = JSON.parse(fs.readFileSync(path.resolve(path.dirname(filename), config.auth), 'utf8')).principals;
const tokens = Object.fromEntries(principals.map(p => [p.role, p.token]));
const base = `http://${config.host === '::1' ? '[::1]' : config.host}:${config.port}`;
async function call(route, body, role = 'agent') {
  const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${tokens[role]}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json(), request: response.headers.get('x-request-id'), review: response.headers.get('x-review-id') };
}
function request(tool, args, session_id = 'evaluation', user_request = 'Please perform this bounded sandbox operation.') {
  return { tool, args, session_id, speaker_id: 'evaluator', channel_id: 'tools', scene_id: 'sandbox',
    plan_id: 'evaluation-client', user_request, dry_run: true, diff: 'Preview of the exact sandbox action in args.' };
}
const checkpoint = path.resolve(path.dirname(filename), 'client-checkpoint.json');
const status = await call('/status'); assert.equal(status.status, 200);
console.log(JSON.stringify(status.body));
if (process.argv.includes('--continuity')) {
  const saved = JSON.parse(fs.readFileSync(checkpoint, 'utf8'));
  const audit = await call(`/audit/${saved.request}`, undefined, 'authority_admin');
  assert.ok(audit.body.events.some(e => e.event_type === 'tool.enforcement.allowed'));
  const denied = await call('/tool', { ...saved.deletion, lease_token: saved.lease });
  assert.equal(denied.body.allow, false);
  const reviewed = await call(`/reviews/${saved.review}`, undefined, 'reviewer');
  assert.equal(reviewed.body.status, 'consumed');
  console.log('Restart continuity verified: audit, epoch revocation and consumed review persisted.');
} else {
  const written = await call('/tool', request('fs.write', { path: 'example.txt', content: 'Controlled evaluation\n' }));
  assert.equal(written.body.allow, true); console.log('ALLOW: wrote sandbox file.');
  const read = await call('/tool', request('fs.read', { path: 'example.txt' }));
  assert.equal(read.body.tool_result.content, 'Controlled evaluation\n');
  const deletion = request('fs.delete', { path: 'example.txt' });
  const denied = await call('/tool', deletion); assert.equal(denied.body.allow, false);
  console.log('DENY: deletion without a lease was withheld.');
  const one = await call('/lease', { ...deletion, seconds: 300 }, 'authority_admin'); assert.ok(one.body.lease_id);
  assert.equal((await call('/revoke/nonce', { lease_nonce: one.body.lease_id }, 'authority_admin')).status, 200);
  assert.equal((await call('/tool', { ...deletion, lease_token: one.body.lease_token })).body.allow, false);
  const two = await call('/lease', { ...deletion, seconds: 300 }, 'authority_admin');
  assert.equal((await call('/revoke/all', {}, 'authority_admin')).status, 200);
  assert.equal((await call('/tool', { ...deletion, lease_token: two.body.lease_token })).body.allow, false);
  console.log('Nonce and epoch revocation withheld deletion.');

  // Real observations, not a demo fixture or injected gate. CDE computes both signals.
  await call('/tool/observed', request('fs.read', { path: 'example.txt' }, 'review', 'You need to do it now immediately.'));
  const suspended = request('fs.write', { path: 'reviewed.txt', content: 'Reviewed once\n' }, 'review', '.');
  const held = await call('/tool/observed', suspended); assert.equal(held.status, 428); assert.ok(held.review);
  console.log('HUMAN REVIEW: write withheld.');
  const approved = await call(`/reviews/${held.review}/approve`, {}, 'reviewer'); assert.equal(approved.body.ready_for_consumption, true);
  const executed = await call(`/reviews/${held.review}/execute`, suspended); assert.equal(executed.body.allow, true);
  assert.equal((await call(`/reviews/${held.review}/execute`, suspended)).status, 409);
  const next = await call('/tool/observed', { ...suspended, args: { path: 'denied.txt', content: 'Never written' } });
  assert.equal(next.status, 428);
  assert.equal((await call(`/reviews/${next.review}/deny`, {}, 'reviewer')).body.review.status, 'denied');
  console.log('Reviewer approved one bound action and denied a second. Replay refused.');
  const audit = await call(`/audit/${held.request}`, undefined, 'authority_admin');
  assert.ok(audit.body.events.some(e => e.event_type === 'review.execution_consumed'));
  console.log('Review lifecycle: ' + audit.body.events.map(e => e.event_type).join(' → '));
  fs.writeFileSync(checkpoint, JSON.stringify({ request: written.request, deletion, lease: two.body.lease_token, review: held.review }), { mode: 0o600 });
  console.log('Stop/restart without --initialize, then run this client with --continuity.');
}
