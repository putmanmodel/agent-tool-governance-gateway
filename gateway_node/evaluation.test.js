import { ExecutionRuntime } from '../execution/runtime.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openEvaluation, buildIdentity } from '../evaluation/config.js';
import { createSandboxAdapter } from '../evaluation/sandbox.js';
import { startCde } from '../evaluation/cde.js';
import { pythonExecutable } from '../conformance/runtime.mjs';
import { authentication, config as authConfig, headers, dispatch, tokens } from '../tests/fixtures/auth.mjs';
import { request, signal } from '../tests/fixtures/authority_cases.mjs';
import { createGatewayApp } from './server.js';
import { KingpinAuthority } from '../kingpin/index.js';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kingpin-evaluation-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const config = { schema_version: '1.0', mode: 'evaluation', database: 'governance.sqlite', auth: 'auth.json',
    policy: 'policy.json', sandbox: 'sandbox', host: '127.0.0.1', port: 18788, python: pythonExecutable() };
  fs.mkdirSync(path.join(root, 'sandbox'), { mode: 0o700 });
  fs.writeFileSync(path.join(root, 'auth.json'), JSON.stringify(authConfig), { mode: 0o600 });
  fs.copyFileSync(new URL('../kingpin/policy/default/policy.json', import.meta.url), path.join(root, 'policy.json'));
  const file = path.join(root, 'runtime.json'); fs.writeFileSync(file, JSON.stringify(config));
  return { root, config, file, sandbox: path.join(root, 'sandbox') };
}
const body = (tool, args) => ({ ...request, tool, args, plan_id: 'evaluate', user_request: 'Please perform this bounded operation.', dry_run: true, diff: 'Exact preview' });
function appFor(runtime, evaluateTurn) {
  return createGatewayApp({ mode: 'evaluation', authority: runtime.authority, authentication: runtime.authentication,
    adapter: runtime.adapter, execution: runtime.execution, build: buildIdentity(runtime.policy), evaluateTurn, logDecision() {} });
}
function synthetic() { let id = 0; return async () => ({ governance_signal: signal(0), top_event: { event_id: `eval-${++id}` } }); }

test('evaluation config validates, explicit create/reopen persists governance and reports safe identity', async t => {
  const f = fixture(t), first = openEvaluation(f.file, { initialize: true });
  const app = appFor(first, synthetic());
  const made = await dispatch(app, '/tool', body('fs.write', { path: 'state.txt', content: 'saved' }));
  assert.equal(made.body.allow, true);
  first.authority.revokeAllLeases(); first.store.close();
  const next = openEvaluation(f.file); t.after(() => next.store.close());
  assert.ok(next.authority.getEventsForRequest(made.headers['X-Request-ID']).length);
  assert.equal(next.authority.revokeAllLeases().lease_epoch, 2);
  assert.throws(() => openEvaluation(f.file, { initialize: true }), /exist/i);
  const status = await dispatch(appFor(next, synthetic()), '/status', {}, headers());
  assert.equal(status.body.storage_schema_version, 5); assert.equal(status.body.runtime_mode, 'evaluation');
  const serialized = JSON.stringify(status.body);
  for (const secret of [...Object.values(tokens), f.root]) assert.ok(!serialized.includes(secret));
  assert.equal((await dispatch(appFor(next, synthetic()), '/status', {}, {})).statusCode, 401);
});
for (const failure of ['auth','policy','database','missing','mode','demo-env']) {
  test(`evaluation startup refuses ${failure} without fallback`, t => {
    const f = fixture(t);
    if (failure === 'auth') fs.unlinkSync(path.join(f.root, 'auth.json'));
    if (failure === 'policy') fs.writeFileSync(path.join(f.root, 'policy.json'), '{}');
    if (failure === 'database') { const db = new DatabaseSync(path.join(f.root, 'governance.sqlite')); db.exec('PRAGMA user_version=999'); db.close(); }
    if (failure === 'missing') { delete f.config.auth; fs.writeFileSync(f.file, JSON.stringify(f.config)); }
    if (failure === 'mode') { f.config.mode = 'production'; fs.writeFileSync(f.file, JSON.stringify(f.config)); }
    if (failure === 'demo-env') {
      const old = process.env.CDE_DEMO_FIXTURES; process.env.CDE_DEMO_FIXTURES = '1';
      t.after(() => { if (old === undefined) delete process.env.CDE_DEMO_FIXTURES; else process.env.CDE_DEMO_FIXTURES = old; });
    }
    assert.throws(() => openEvaluation(f.file, { initialize: failure !== 'database' }));
  });
}

test('evaluation rejects demo/control inputs while demo retains opt-in low-confidence fixture', async t => {
  const f = fixture(t), runtime = openEvaluation(f.file, { initialize: true }); t.after(() => runtime.store.close());
  let calls = 0;
  const evaluate = async () => { calls++; return { governance_signal: signal(0), top_event: { event_id: String(calls) } }; };
  const app = appFor(runtime, evaluate);
  for (const key of ['demo_fixture','force_gate','force_recovery','evaluation_id','governance_signal']) {
    assert.equal((await dispatch(app, '/tool', { ...body('fs.write', { path: 'x', content: 'x' }), [key]: 'low_confidence' })).statusCode, 400);
  }
  assert.equal(calls, 0); assert.deepEqual(fs.readdirSync(f.sandbox), []);
  const original = process.env.CDE_DEMO_FIXTURES; process.env.CDE_DEMO_FIXTURES = '1';
  try {
    const demo = createGatewayApp({ authentication, authority: new KingpinAuthority(), evaluateTurn: evaluate, logDecision() {} });
    assert.equal((await dispatch(demo, '/tool', { ...body('fs.read', {}), demo_fixture: 'low_confidence' })).body.evaluation_input.source, 'demo_fixture');
  } finally { if (original === undefined) delete process.env.CDE_DEMO_FIXTURES; else process.env.CDE_DEMO_FIXTURES = original; }
});

test('real CDE, persistent Kingpin and sandbox perform allow/deny/review with exact one-use side effects', async t => {
  const f = fixture(t), runtime = openEvaluation(f.file, { initialize: true }); t.after(() => runtime.store.close());
  const cde = await startCde(runtime.python); t.after(() => cde.close());
  const app = appFor(runtime, cde.evaluate);
  const write = body('fs.write', { path: 'example.txt', content: 'hello' });
  const allowed = await dispatch(app, '/tool', write); assert.equal(allowed.body.allow, true);
  assert.equal(fs.readFileSync(path.join(f.sandbox, 'example.txt'), 'utf8'), 'hello');
  const deletion = body('fs.delete', { path: 'example.txt' });
  assert.equal((await dispatch(app, '/tool', deletion)).body.allow, false);
  for (const operation of ['nonce','epoch']) {
    const issued = await dispatch(app, '/lease', { ...deletion, seconds: 300 }, headers('admin'));
    assert.ok(issued.body.lease_token);
    await dispatch(app, operation === 'nonce' ? '/revoke/nonce' : '/revoke/all', { lease_nonce: issued.body.lease_id }, headers('admin'));
    assert.equal((await dispatch(app, '/tool', { ...deletion, lease_token: issued.body.lease_token })).body.allow, false);
    assert.ok(fs.existsSync(path.join(f.sandbox, 'example.txt')));
  }
  const fresh = await dispatch(app, '/lease', { ...deletion, seconds: 300 }, headers('admin'));
  assert.equal((await dispatch(app, '/tool', { ...deletion, lease_token: fresh.body.lease_token })).body.allow, true);
  assert.ok(!fs.existsSync(path.join(f.sandbox, 'example.txt')));
  await dispatch(app, '/tool/observed', { ...write, user_request: 'You need to do it now immediately.' });
  const suspended = { ...write, user_request: '.', args: { path: 'review.txt', content: 'once' } };
  const held = await dispatch(app, '/tool/observed', suspended);
  assert.equal(held.statusCode, 428); assert.ok(!fs.existsSync(path.join(f.sandbox, 'review.txt')));
  const id = held.headers['X-Review-ID'];
  await dispatch(app, `/reviews/${id}/approve`, {}, headers('reviewer'));
  assert.ok(!fs.existsSync(path.join(f.sandbox, 'review.txt')));
  assert.equal((await dispatch(app, `/reviews/${id}/execute`, suspended)).body.allow, true);
  assert.equal(fs.readFileSync(path.join(f.sandbox, 'review.txt'), 'utf8'), 'once');
  fs.writeFileSync(path.join(f.sandbox, 'review.txt'), 'sentinel');
  assert.equal((await dispatch(app, `/reviews/${id}/execute`, suspended)).statusCode, 409);
  assert.equal(fs.readFileSync(path.join(f.sandbox, 'review.txt'), 'utf8'), 'sentinel');
  const held2 = await dispatch(app, '/tool/observed', suspended), id2 = held2.headers['X-Review-ID'];
  await dispatch(app, `/reviews/${id2}/approve`, {}, headers('reviewer'));
  assert.equal((await dispatch(app, `/reviews/${id2}/execute`, { ...suspended, args: { path: 'changed.txt', content: 'no' } })).statusCode, 403);
  assert.ok(!fs.existsSync(path.join(f.sandbox, 'changed.txt')));
  const audit = await dispatch(app, `/audit/${held.headers['X-Request-ID']}`, {}, headers('admin'));
  assert.ok(audit.body.events.some(e => e.event_type === 'review.execution_consumed'));
  assert.equal((await dispatch(app, `/audit/${held.headers['X-Request-ID']}`, {}, headers())).statusCode, 403);
});

for (const operation of ['fs.read','fs.write','fs.delete']) {
  test(`sandbox ${operation}: rejects absolute paths, traversal, links and unsupported nested paths`, t => {
    const f = fixture(t), adapter = createSandboxAdapter(f.sandbox);
    const outside = path.join(f.root, 'outside.txt'); fs.writeFileSync(outside, 'untouched');
    fs.symlinkSync(outside, path.join(f.sandbox, 'symlink'));
    fs.linkSync(outside, path.join(f.sandbox, 'hardlink'));
    fs.symlinkSync(f.root, path.join(f.sandbox, 'directory'));
    for (const name of [outside, '../outside.txt', 'a/../../outside.txt', 'directory/outside.txt', 'a/b', 'symlink', 'hardlink', '..', '.', 'a\\b']) {
      assert.throws(() => adapter.execute({ tool: operation, args: { path: name, ...(operation === 'fs.write' ? { content: 'attack' } : {}) } }));
      assert.equal(fs.readFileSync(outside, 'utf8'), 'untouched');
    }
    assert.throws(() => adapter.execute({ tool: 'shell.rm', args: { path: 'x' } }));
  });
}

test('evaluation rejects misplaced control files and placeholders, without creating permissive state', t => {
  const f = fixture(t);
  f.config.database = 'sandbox/state.sqlite'; fs.writeFileSync(f.file, JSON.stringify(f.config));
  assert.throws(() => openEvaluation(f.file, { initialize: true }), /outside the sandbox/);
  assert.ok(!fs.existsSync(path.join(f.sandbox, 'state.sqlite')));
  fs.copyFileSync(new URL('../config/evaluation.example/auth.json', import.meta.url), path.join(f.root, 'auth.json'));
  assert.throws(() => openEvaluation(f.file, { initialize: true }), /authentication/);
});

test('gateway adapter receives only permitted actions and cannot replace trusted policy', async t => {
  const f = fixture(t), runtime = openEvaluation(f.file, { initialize: true }); t.after(() => runtime.store.close());
  let count = 0;
  const adapter = { execute(req) { count++; return runtime.adapter.execute(req); } };
  const app = createGatewayApp({ mode: 'evaluation', authentication, authority: runtime.authority,
    adapter, execution: new ExecutionRuntime({ store: runtime.store, adapter }), build: buildIdentity(runtime.policy), evaluateTurn: synthetic(), logDecision() {} });
  const denied = await dispatch(app, '/tool', { ...body('fs.delete', { path: 'x' }), tool_class: 'read_only', minimum_authority_floor: 0 });
  assert.equal(denied.body.allow, false); assert.equal(count, 0);
  assert.equal((await dispatch(app, '/tool', body('fs.write', { path: '../escape', content: 'no' }))).statusCode, 422);
  assert.ok(!fs.existsSync(path.join(f.root, 'escape')));
  assert.equal((await dispatch(app, '/tool', body('fs.write', { path: 'safe', content: 'yes' }))).body.allow, true);
  assert.equal(count, 2);
});
