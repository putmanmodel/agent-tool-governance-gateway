import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { KingpinAuthority, MemoryStateStore } from '../kingpin/index.js';
import { SQLiteStateStore } from '../kingpin/state/sqlite.js';
import { ExecutionRuntime } from '../execution/runtime.js';
import { createSandboxAdapter } from '../evaluation/sandbox.js';
import { request, signal } from '../tests/fixtures/authority_cases.mjs';
import { authentication, headers } from '../tests/fixtures/auth.mjs';
const admin = authentication.authenticate(headers('admin').authorization);
const reviewer = authentication.authenticate(headers('reviewer').authorization);

for (const kind of ['memory', 'sqlite']) for (const [name, alias] of [['Example.txt','example.txt'], ['caf\u00e9.txt','cafe\u0301.txt']]) {
  test(`${kind}: filesystem aliases ${name}/${alias}, RC1 hold, restart, write/delete and disposition`, t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resource-alias-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const sandbox = path.join(root, 'sandbox'); fs.mkdirSync(sandbox, { mode: 0o700 });
    const filename = path.join(root, 'state.sqlite');
    let store = kind === 'sqlite' ? new SQLiteStateStore({ filename, create: true }) : new MemoryStateStore();
    t.after(() => store.close());
    let authority = new KingpinAuthority({ store }), adapter = createSandboxAdapter(sandbox), runtime;
    fs.writeFileSync(path.join(sandbox, name), 'before');
    const equivalent = fs.existsSync(path.join(sandbox, alias))
      && fs.statSync(path.join(sandbox, name)).ino === fs.statSync(path.join(sandbox, alias)).ino;
    t.diagnostic(`Host treats names as ${equivalent ? 'equivalent' : 'distinct'}`);
    let calls = 0;
    function run(target, tool = 'fs.write') {
      const req = { ...request, tool, args: { path: target, ...(tool === 'fs.write' ? { content: 'intended' } : {}) }, dry_run: true, diff: 'preview' };
      if (tool === 'fs.delete') req.lease_token = authority.issue({ ...req, seconds: 60 }).lease_token;
      const audit = { request_id: crypto.randomUUID(), decision_id: crypto.randomUUID(), principal_id: 'agent-principal' };
      const decision = authority.decide(signal(0), req, crypto.randomUUID(), audit);
      assert.equal(decision.outcome, 'allow');
      authority.recordEnforcement(req, audit, { outcome: 'allow', evaluation_id: decision.evaluation_id });
      return runtime.run(runtime.capture(req, decision, audit), req);
    }
    // Emit an RC1-format record: original spelling hash and sandbox.v1 evidence,
    // no new conflict callback or additional persisted metadata.
    const { resourcesConflict, ...legacy } = adapter;
    runtime = new ExecutionRuntime({ store, adapter: { ...legacy, execute(req) {
      calls++; adapter.execute({ ...req, args: { ...req.args, content: 'partial' } }); throw Error('lost receipt');
    } } });
    const initial = run(name); assert.equal(initial.execution_status, 'unknown');
    if (kind === 'sqlite') {
      store.close(); store = new SQLiteStateStore({ filename }); authority = new KingpinAuthority({ store });
      adapter = createSandboxAdapter(sandbox);
    }
    runtime = new ExecutionRuntime({ store, adapter: { ...adapter, execute(req) { calls++; return adapter.execute(req); } } });
    runtime.recover();
    assert.equal(runtime.get(initial.execution_id, admin).status, 'reconciliation_required');
    const beforeRetries = calls;
    assert.throws(() => run(name), { code: 'EXECUTION_CONFLICT' });
    if (equivalent) {
      assert.throws(() => run(alias), { code: 'EXECUTION_CONFLICT' });
      assert.throws(() => run(alias, 'fs.delete'), { code: 'EXECUTION_CONFLICT' });
      assert.equal(calls, beforeRetries, 'neither conflicting retry invokes adapter');
      t.diagnostic('initial → unresolved; same spelling → EXECUTION_CONFLICT; alias → EXECUTION_CONFLICT; retry adapter calls → 0');
    } else assert.equal(run(alias).execution_status, 'succeeded');
    assert.equal(run('distinct.txt').execution_status, 'succeeded');
    assert.equal(runtime.reconcile(initial.execution_id, admin).status, 'reconciliation_required');
    runtime.resolve(initial.execution_id, 'failed', reviewer);
    assert.equal(run(name).execution_status, 'succeeded');
    assert.equal(run(name, 'fs.delete').execution_status, 'succeeded');
    assert.ok(!fs.readdirSync(sandbox).some(n => n.startsWith('.kingpin-identity-')));
  });
}
for (const [name, alias] of [['Absent.txt','absent.txt'], ['\u00e9.txt','e\u0301.txt']]) {
  test(`absent namespace aliases ${name}/${alias} use host lookup, not spelling`, t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'absent-alias-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const adapter = createSandboxAdapter(root);
    fs.writeFileSync(path.join(root, name), 'probe');
    const equivalent = fs.existsSync(path.join(root, alias));
    fs.unlinkSync(path.join(root, name));
    const prepare = target => adapter.prepare({ tool: 'fs.write', args: { path: target, content: 'x' } });
    const previous = { reconciliation_data: prepare(name).evidence };
    assert.equal(adapter.resourcesConflict(prepare(alias), previous), equivalent);
    assert.equal(adapter.resourcesConflict(prepare('distinct.txt'), previous), false);
    assert.deepEqual(fs.readdirSync(root), [], 'lookup leaves no target or probe files');
    assert.equal(adapter.resourcesConflict(prepare(alias), { reconciliation_data: null }), true);
    assert.equal(adapter.resourcesConflict(prepare(alias), { reconciliation_data: { ...previous.reconciliation_data, root_ino: -1 } }), true);
  });
}
