import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { formatTrace, requestTrace } from '../evaluation/trace.mjs';
import { config, tokens } from '../tests/fixtures/auth.mjs';

const executionEvents = JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL('../tests/fixtures/execution_audit_stream.mjs', import.meta.url))], { encoding: 'utf8' }));
test('trace projects real execution audit without mutating or inventing evidence', () => {
  const before = JSON.stringify(executionEvents);
  const output = formatTrace('execution-schema', executionEvents);
  for (const label of ['STARTED','SUCCEEDED','FAILED','UNKNOWN','RECONCILED_SUCCEEDED','RECONCILED_FAILED','HUMAN DISPOSITION REQUIRED', 'adapter inspection', 'operator disposition']) assert.ok(output.includes(label), label);
  for (const event of executionEvents) for (const key of ['evaluation_id','decision_id','execution_id','principal_id']) if (event[key]) assert.ok(output.includes(event[key]));
  assert.equal(JSON.stringify(executionEvents), before);
  assert.ok(!output.includes('Process ended') && !output.includes('revalidated'));
});
test('trace shows real review history including correlation and one-use consumption', () => {
  const events = JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL('../tests/fixtures/review_audit_stream.mjs', import.meta.url))], { encoding: 'utf8' }));
  const output = [...new Set(events.map(e => e.request_id))].map(id => formatTrace(id, events.filter(e => e.request_id === id))).join('');
  for (const label of ['Review requested','Reviewer approved','Reviewer denied','Review invalidated','One-use review authorization consumed']) assert.ok(output.includes(label));
  for (const event of events) if (event.review_id) assert.ok(output.includes(event.review_id));
});
test('trace omits arbitrary payloads and escapes terminal controls', () => {
  const output = formatTrace('r', [{ request_id: 'r', event_type: 'authority.decision', outcome: 'allow', principal_id: 'actor\x1b[31m\nspoof', args: 'SECRET_PAYLOAD', reason_codes: ['SECRET_REASON'], result_metadata: 'SECRET_RESULT' }]);
  assert.ok(output.includes('allow'));
  for (const outcome of ['allow','deny','human_review','constrain','quarantine']) assert.ok(formatTrace('r', [{ request_id:'r', event_type:'authority.decision', outcome }]).includes(`Outcome: ${JSON.stringify(outcome)}`));
  assert.ok(!output.includes('\x1b') && !output.includes('\nspoof') && !output.includes('SECRET'));
  assert.match(formatTrace('r', []), /No audit events found/);
  assert.throws(() => formatTrace('r', [{ request_id: 'other' }]), /correlation/);
});
function local(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir,'auth.json'), JSON.stringify(config));
  const filename = path.join(dir, 'runtime.json');
  fs.writeFileSync(filename, JSON.stringify({ mode: 'evaluation', host: '127.0.0.1', port: 8788, auth: 'auth.json' }));
  return filename;
}
test('trace uses only authenticated GET, prevents redirect and redacts credentials', async t => {
  const filename = local(t), before = fs.readFileSync(filename, 'utf8');
  let calls = 0;
  const output = await requestTrace(filename, 'r/1', async (url, options) => {
    calls++;
    assert.equal(url, 'http://127.0.0.1:8788/audit/r%2F1');
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.authorization, `Bearer ${tokens.admin}`); assert.equal(options.body, undefined);
    return { ok: true, json: async () => ({ events: [{ request_id:'r/1', event_type:'authority.requested', principal_id: tokens.agent }] }) };
  });
  assert.equal(calls, 1); assert.ok(output.includes('[REDACTED]'));
  for (const token of Object.values(tokens)) assert.ok(!output.includes(token));
  assert.equal(fs.readFileSync(filename, 'utf8'), before);
});
test('trace cleanly handles unknown IDs, failed reads, missing IDs and unsafe configuration', async t => {
  const filename = local(t);
  assert.match(await requestTrace(filename, 'unknown', async () => ({ ok: true, json: async () => ({ events: [] }) })), /No audit events found/);
  for (const fetcher of [async () => ({ ok: false }), async () => { throw Error(tokens.admin); }, async () => ({ ok: true, json: async () => ({ events: [{ request_id: 'other' }] }) })]) {
    await assert.rejects(requestTrace(filename,'r',fetcher), { message: 'Audit read failed; check the running evaluator and admin credential' });
  }
  const noFetch = () => { assert.fail('must not fetch'); };
  await assert.rejects(requestTrace(filename,'',noFetch), /nonempty/);
  fs.writeFileSync(filename, JSON.stringify({ mode:'evaluation',host:'remote.example',port:8788,auth:'auth.json' }));
  await assert.rejects(requestTrace(filename,'r',noFetch), /configuration/);
});
