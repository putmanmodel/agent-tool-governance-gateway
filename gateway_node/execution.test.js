import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync, fork } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { KingpinAuthority, MemoryStateStore, loadPolicy } from '../kingpin/index.js';
import { SQLiteStateStore } from '../kingpin/state/sqlite.js';
import { ExecutionRuntime } from '../execution/runtime.js';
import { createSandboxAdapter } from '../evaluation/sandbox.js';
import { startCde } from '../evaluation/cde.js';
import { pythonExecutable } from '../conformance/runtime.mjs';
import { createGatewayApp } from './server.js';
import { buildIdentity } from '../evaluation/config.js';
import { request, signal } from '../tests/fixtures/authority_cases.mjs';
import { authentication, headers, dispatch, tokens } from '../tests/fixtures/auth.mjs';
const reviewer = authentication.authenticate(headers('reviewer').authorization);
const admin = authentication.authenticate(headers('admin').authorization);
const agent = authentication.authenticate(headers().authorization);
const worker = new URL('../tests/fixtures/execution_process.mjs', import.meta.url);
const write = { ...request, tool: 'fs.write', args: { path: 'file.txt', content: 'intended content' },
  plan_id: 'execution', user_request: 'Please write this file.', dry_run: true, diff: 'preview' };
function fixture(t, kind = 'sqlite') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'execution-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sandbox = path.join(root, 'sandbox'); fs.mkdirSync(sandbox, { mode: 0o700 });
  const filename = path.join(root, 'state.sqlite');
  const store = kind === 'memory' ? new MemoryStateStore() : new SQLiteStateStore({ filename, create: true });
  t.after(() => store.close());
  const authority = new KingpinAuthority({ store }), adapter = createSandboxAdapter(sandbox);
  return { root, sandbox, filename, store, authority, adapter, runtime: new ExecutionRuntime({ store, adapter }) };
}
function authorized(f, req = write) {
  const audit = { request_id: crypto.randomUUID(), decision_id: crypto.randomUUID(), principal_id: agent.principal_id, redact: authentication.redact };
  const decision = f.authority.decide(signal(0), req, crypto.randomUUID(), audit);
  assert.equal(decision.outcome, 'allow');
  f.authority.recordEnforcement(req, audit, { outcome: 'allow', evaluation_id: decision.evaluation_id });
  return { audit, decision, grant: f.runtime.capture(req, decision, audit) };
}
const records = f => f.store.transaction(tx => tx.executions.list());
function faulty(f, type) {
  return { bindPolicy: (...args) => f.store.bindPolicy(...args), close() {}, contextCount: () => f.store.contextCount(),
    transaction: work => f.store.transaction(tx => { const append = tx.audit.append;
      tx.audit.append = event => { append(event); if (type(event)) throw Error('simulated durable-write failure'); }; return work(tx); }) };
}
for (const kind of ['memory','sqlite']) {
  test(`${kind}: durable start precedes adapter and terminal events retain exact authorization correlation`, t => {
    const f = fixture(t, kind); let invocations = 0, committed;
    const observingStore = { transaction: work => f.store.transaction(tx => {
      committed = tx.executions.list(); return work(tx);
    }) };
    f.runtime = new ExecutionRuntime({ store: observingStore, adapter: { ...f.adapter, execute(req) {
      assert.equal(committed.length, 1); assert.equal(committed[0].status, 'started');
      if (kind === 'sqlite') {
        const reader = new DatabaseSync(f.filename);
        assert.equal(reader.prepare('SELECT status FROM executions').get().status, 'started'); reader.close();
      }
      invocations++; return f.adapter.execute(req);
    } } });
    const { grant, audit, decision } = authorized(f), result = f.runtime.run(grant, write);
    assert.equal(result.execution_status, 'succeeded'); assert.equal(invocations, 1);
    assert.equal(fs.readFileSync(path.join(f.sandbox, 'file.txt'), 'utf8'), write.args.content);
    const events = f.authority.getEventsForRequest(audit.request_id);
    assert.deepEqual(events.filter(e => ['authority.decision','tool.enforcement.allowed','tool.execution.started','tool.execution.succeeded'].includes(e.event_type)).map(e => e.event_type),
      ['authority.decision','tool.enforcement.allowed','tool.execution.started','tool.execution.succeeded']);
    for (const e of events.filter(e => e.event_type.startsWith('tool.execution.'))) {
      assert.equal(e.request_id, audit.request_id); assert.equal(e.decision_id, audit.decision_id);
      assert.equal(e.evaluation_id, decision.evaluation_id); assert.equal(e.execution_id, result.execution_id);
      assert.equal(e.principal_id, agent.principal_id); assert.equal(e.agent_id, 'actor');
      assert.deepEqual(e.context, decision.context); assert.equal(e.tool_id, write.tool); assert.equal(e.review_id, null);
    }
    assert.throws(() => f.runtime.run(grant, write), /binding mismatch/);
    assert.throws(() => f.runtime.run(f.runtime.capture(write, decision, audit), write), /already recorded/);
    assert.equal(invocations, 1);
  });
  test(`${kind}: known adapter rejection is failed, changed authorization binding fails before invocation`, t => {
    const f = fixture(t, kind), bad = { ...write, args: { path: '../escape', content: 'no' } };
    const a = authorized(f, bad), result = f.runtime.run(a.grant, bad);
    assert.equal(result.execution_status, 'failed'); assert.equal(records(f)[0].failure_code, 'ADAPTER_REJECTED');
    const b = authorized(f);
    assert.throws(() => f.runtime.run(b.grant, { ...write, args: {} }), /binding mismatch/);
    assert.equal(records(f).length, 1); assert.deepEqual(fs.readdirSync(f.sandbox), []);
  });
  test(`${kind}: start persistence failure prevents side effects and terminal persistence failure never retries`, t => {
    const f = fixture(t, kind); let calls = 0;
    const adapter = { ...f.adapter, execute(req) { calls++; return f.adapter.execute(req); } };
    const failedStart = new ExecutionRuntime({ store: faulty(f, e => e.event_type === 'tool.execution.started'), adapter });
    let a = authorized(f);
    assert.throws(() => failedStart.run(failedStart.capture(write, a.decision, a.audit), write), /durable-write/);
    assert.equal(calls, 0); assert.equal(records(f).length, 0); assert.deepEqual(fs.readdirSync(f.sandbox), []);
    const failedTerminal = new ExecutionRuntime({ store: faulty(f, e => ['tool.execution.succeeded','tool.execution.unknown'].includes(e.event_type)), adapter });
    const result = failedTerminal.run(failedTerminal.capture(write, a.decision, a.audit), write);
    assert.equal(result.execution_status, 'unknown'); assert.equal(calls, 1); assert.equal(records(f)[0].status, 'started');
    f.runtime.recover(); assert.equal(records(f)[0].status, 'reconciled_succeeded');
    assert.ok(f.authority.getEventsForRequest(a.audit.request_id).some(e => e.event_type === 'tool.execution.unknown'));
    f.runtime.recover(); assert.equal(calls, 1);
  });
  test(`${kind}: unsupported reconciliation is distinct, permission scoped, and requires explicit reviewer disposition`, t => {
    const f = fixture(t, kind), noReceipt = { execute() { throw Error('uncertain external error'); } };
    f.runtime = new ExecutionRuntime({ store: f.store, adapter: noReceipt });
    const a = authorized(f), result = f.runtime.run(a.grant, write);
    assert.equal(result.execution_status, 'unknown');
    const fresh = authorized(f);
    assert.throws(() => f.runtime.run(fresh.grant, write), /reconciliation/);
    assert.equal(f.runtime.reconcile(result.execution_id, admin).status, 'reconciliation_required');
    assert.equal(f.runtime.list(reviewer).length, 1);
    for (const principal of [agent, admin]) assert.throws(() => f.runtime.resolve(result.execution_id, 'failed', principal), /forbidden/);
    const foreign = { ...reviewer, allowed_contexts: [{ session_id: 'other', channel_id: 'channel', scene_id: 'scene', task_id: null }] };
    assert.throws(() => f.runtime.get(result.execution_id, foreign), /forbidden/);
    const resolved = f.runtime.resolve(result.execution_id, 'failed', reviewer);
    assert.equal(resolved.status, 'reconciled_failed'); assert.equal(resolved.reconciliation.method, 'operator');
    assert.throws(() => f.runtime.resolve(result.execution_id, 'succeeded', reviewer), /disposition/);
  });
  test(`${kind}: reads have no uncertain persistent execution and untrusted result content never enters receipts`, t => {
    const f = fixture(t, kind);
    f.adapter.execute(write);
    const read = { ...write, tool: 'fs.read', args: { path: 'file.txt' } }, a = authorized(f, read);
    assert.equal(f.runtime.run(a.grant, read).tool_result.content, write.args.content); assert.equal(records(f).length, 0);
    const adapter = { ...f.adapter, execute(req) { f.adapter.execute(req); return { secret: tokens.agent, huge: 'x'.repeat(100000) }; } };
    const runtime = new ExecutionRuntime({ store: f.store, adapter }); const b = authorized(f);
    const result = runtime.run(runtime.capture(write, b.decision, b.audit), write);
    assert.equal(result.execution_status, 'succeeded');
    const serialized = JSON.stringify([records(f), f.authority.getEventsForRequest(b.audit.request_id)]);
    assert.ok(!serialized.includes(tokens.agent)); assert.ok(!serialized.includes('x'.repeat(100)));
  });
}

for (const phase of ['before-effect','after-effect']) {
  test(`SQLite real SIGKILL ${phase}: restart records unknown and inspects without repeating write`, t => {
    const f = fixture(t); f.store.close();
    const input = { filename: f.filename, sandbox: f.sandbox, action: 'crash', phase, request: write };
    const crashed = spawnSync(process.execPath, [worker.pathname, JSON.stringify(input)], { encoding: 'utf8' });
    assert.equal(crashed.signal, 'SIGKILL');
    const raw = new DatabaseSync(f.filename), row = JSON.parse(raw.prepare('SELECT record FROM executions').get().record); raw.close();
    assert.equal(row.status, 'started');
    const recovered = JSON.parse(execFileSync(process.execPath, [worker.pathname, JSON.stringify({ ...input, action: 'recover' })], { encoding: 'utf8' }));
    assert.equal(recovered[0].status, phase === 'after-effect' ? 'reconciled_succeeded' : 'reconciled_failed');
    assert.equal(fs.existsSync(path.join(f.sandbox, 'file.txt')), phase === 'after-effect');
    const store = new SQLiteStateStore({ filename: f.filename }); t.after(() => store.close());
    assert.ok(store.getEventsForRequest('crash-request').some(e => e.event_type === 'tool.execution.unknown'));
  });
}

test('sandbox reconciliation conservatively checks write/delete postconditions and replacement identity', t => {
  const f = fixture(t), file = path.join(f.sandbox, 'file.txt');
  const absent = f.adapter.prepare(write).evidence;
  assert.equal(f.adapter.reconcile(absent), 'failed');
  f.adapter.execute(write); assert.equal(f.adapter.reconcile(absent), 'succeeded');
  const next = { ...write, args: { ...write.args, content: 'different' } }, expected = f.adapter.prepare(next).evidence;
  assert.equal(f.adapter.reconcile(expected), 'failed');
  fs.writeFileSync(file, 'unexpected'); assert.equal(f.adapter.reconcile(expected), 'inconclusive');
  const deletion = { tool: 'fs.delete', args: { path: 'file.txt' } }, prior = f.adapter.prepare(deletion).evidence;
  assert.equal(f.adapter.reconcile(prior), 'failed');
  f.adapter.execute(deletion); assert.equal(f.adapter.reconcile(prior), 'succeeded');
  f.adapter.execute(write); assert.equal(f.adapter.reconcile(prior), 'inconclusive');
  fs.unlinkSync(file); fs.symlinkSync(f.filename, file);
  assert.throws(() => f.adapter.reconcile(prior));
});

async function concurrent(t, input, actions) {
  const children = actions.map(() => fork(worker, [], { stdio: ['ignore','ignore','ignore','ipc'] }));
  t.after(() => children.forEach(c => c.kill()));
  await Promise.all(children.map(c => new Promise((resolve, reject) => { c.once('message', resolve); c.once('error', reject); })));
  return Promise.all(children.map((c,i) => new Promise((resolve, reject) => { c.once('message', resolve); c.once('error', reject); c.send({ ...input, ...actions[i] }); })));
}
test('separate-process duplicate execution and reconciliation each commit one terminal winner', async t => {
  const f = fixture(t), a = authorized(f);
  const { redact, ...audit } = a.audit;
  const input = { filename: f.filename, sandbox: f.sandbox, request: write, audit, decision: a.decision };
  const results = await concurrent(t, input, [{ action: 'execute' }, { action: 'execute' }]);
  assert.equal(results.filter(r => r.result?.execution_status === 'succeeded').length, 1);
  assert.equal(results.filter(r => r.error).length, 1);
  const other = { ...write, args: { path: 'other.txt', content: 'content' } }, b = authorized(f, other);
  const uncertain = new ExecutionRuntime({ store: f.store, adapter: { ...f.adapter, execute(req) { f.adapter.execute(req); throw Error('lost acknowledgement'); } } });
  const result = uncertain.run(uncertain.capture(other, b.decision, b.audit), other);
  const reconciled = await concurrent(t, input, [{ action: 'reconcile', id: result.execution_id }, { action: 'reconcile', id: result.execution_id }]);
  assert.equal(reconciled.filter(r => r.result?.status === 'reconciled_succeeded').length, 1);
  assert.equal(reconciled.filter(r => r.error).length, 1);
});

test('gateway review execution has lifecycle, no replay, authenticated inspection and correlated known failures', async t => {
  const f = fixture(t); let n = 0;
  const app = createGatewayApp({ mode: 'evaluation', authority: f.authority, authentication,
    adapter: f.adapter, execution: f.runtime, build: buildIdentity(loadPolicy()), logDecision() {},
    evaluateTurn: async () => ({ governance_signal: signal(1, 'LOW_CONFIDENCE'), top_event: { event_id: `review-${++n}` } }) });
  const held = await dispatch(app, '/tool', write), reviewId = held.headers['X-Review-ID'];
  assert.equal(held.statusCode, 428); assert.equal(records(f).length, 0);
  await dispatch(app, `/reviews/${reviewId}/approve`, {}, headers('reviewer'));
  const done = await dispatch(app, `/reviews/${reviewId}/execute`, write);
  assert.equal(done.body.execution_status, 'succeeded'); assert.equal(records(f)[0].review_id, reviewId);
  const responses = await Promise.all([dispatch(app, `/reviews/${reviewId}/execute`, write), dispatch(app, `/reviews/${reviewId}/execute`, write)]);
  assert.ok(responses.every(r => r.statusCode === 409)); assert.equal(records(f).length, 1);
  assert.equal((await dispatch(app, `/executions/${done.body.execution_id}`, {}, headers())).statusCode, 403);
  assert.equal((await dispatch(app, `/executions/${done.body.execution_id}`, {}, headers('reviewer'))).body.status, 'succeeded');
  assert.equal((await dispatch(app, `/executions/${done.body.execution_id}/resolve`, { outcome: 'succeeded' }, headers())).statusCode, 403);
  const plain = createGatewayApp({ mode: 'evaluation', authority: f.authority, authentication,
    adapter: f.adapter, execution: f.runtime, build: buildIdentity(loadPolicy()), logDecision() {},
    evaluateTurn: async () => ({ governance_signal: signal(0), top_event: { event_id: `plain-${++n}` } }) });
  const bad = await dispatch(plain, '/tool', { ...write, args: { path: '../bad', content: 'x' } });
  assert.equal(bad.statusCode, 422);
  const events = f.authority.getEventsForRequest(bad.headers['X-Request-ID']);
  const decided = events.find(e => e.event_type === 'authority.decision');
  assert.ok(events.some(e => e.event_type === 'tool.enforcement.failed'));
  for (const e of events.filter(e => ['tool.execution.failed','tool.enforcement.failed'].includes(e.event_type))) {
    assert.equal(e.evaluation_id, decided.evaluation_id); assert.equal(e.decision_id, decided.decision_id);
  }
  assert.ok(events.some(e => e.event_type === 'tool.execution.failed'));
});

test('SQLite v4 migration preserves records, rollback is atomic and corrupt execution binding fails closed', t => {
  const f = fixture(t);
  f.authority.decide(signal(1, 'LOW_CONFIDENCE'), write, 'old-review', { principal_id: agent.principal_id });
  f.store.close();
  const db = new DatabaseSync(f.filename); db.exec('DROP TABLE executions; PRAGMA user_version=4');
  const snapshot = db.prepare('SELECT * FROM reviews').all();
  const originalExec = DatabaseSync.prototype.exec;
  const mock = t.mock.method(DatabaseSync.prototype, 'exec', function(sql) {
    const result = originalExec.call(this, sql); if (sql.includes('CREATE TABLE executions')) throw Error('migration interrupted'); return result;
  });
  assert.throws(() => new SQLiteStateStore({ filename: f.filename }), /migration interrupted/); mock.mock.restore();
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 4);
  assert.deepEqual(db.prepare('SELECT * FROM reviews').all(), snapshot);
  const store = new SQLiteStateStore({ filename: f.filename });
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 5);
  assert.deepEqual(db.prepare('SELECT * FROM reviews').all(), snapshot);
  const authority = new KingpinAuthority({ store }), runtime = new ExecutionRuntime({ store, adapter: f.adapter });
  const g = { ...f, store, authority, runtime }, a = authorized(g); runtime.run(a.grant, write); store.close();
  const trigger = db.prepare("SELECT sql FROM sqlite_schema WHERE name='guarded_execution_transition'").get().sql;
  db.exec('DROP TRIGGER guarded_execution_transition');
  db.exec("UPDATE executions SET record=json_set(record, '$.decision_id', 'corrupt')"); db.exec(trigger); db.close();
  assert.throws(() => new SQLiteStateStore({ filename: f.filename }), /persisted execution/);
});

test('exclusive evaluator lock prevents live-owner restart reconciliation', async t => {
  const f = fixture(t), lock = f.filename + '.runtime.lock';
  const one = await startCde(pythonExecutable(), lock); t.after(() => one.close());
  await assert.rejects(startCde(pythonExecutable(), lock), /unavailable/);
  await one.close();
  const next = await startCde(pythonExecutable(), lock); await next.close();
});

test('live terminal result and recovery serialize; recovery cannot overtake an in-flight synchronous adapter', async t => {
  const f = fixture(t), a = authorized(f), release = path.join(f.root, 'release');
  const { redact, ...audit } = a.audit;
  const input = { filename: f.filename, sandbox: f.sandbox, request: write, audit, decision: a.decision };
  const children = [0,1].map(() => fork(worker, [], { stdio: ['ignore','ignore','ignore','ipc'] }));
  t.after(() => children.forEach(c => c.kill()));
  await Promise.all(children.map(c => new Promise(resolve => c.once('message', resolve))));
  const [executing, recovering] = children;
  const started = new Promise(resolve => executing.once('message', resolve));
  executing.send({ ...input, action: 'hold', release }); assert.equal((await started).adapter_started, true);
  const finished = new Promise(resolve => executing.once('message', resolve));
  const announced = new Promise(resolve => recovering.once('message', resolve));
  recovering.send({ ...input, action: 'recover', announce: true }); assert.equal((await announced).recovering, true);
  const recovered = new Promise(resolve => recovering.once('message', resolve));
  fs.writeFileSync(release, 'release');
  assert.equal((await finished).result.execution_status, 'succeeded');
  assert.equal((await recovered).result[0].status, 'succeeded');
  assert.ok(!f.authority.getEventsForRequest(a.audit.request_id).some(e => e.event_type === 'tool.execution.unknown'));
});
