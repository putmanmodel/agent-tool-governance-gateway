import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { KingpinAuthority, MemoryStateStore, loadPolicy } from '../kingpin/index.js';
import { SQLiteStateStore } from '../kingpin/state/sqlite.js';
import { captureDecisions, request, signal } from '../tests/fixtures/authority_cases.mjs';

const baseline = JSON.parse(fs.readFileSync(new URL('../tests/fixtures/pre_extraction_authority.json', import.meta.url)));
const workerFile = fileURLToPath(new URL('../tests/fixtures/sqlite_process.mjs', import.meta.url));
function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kingpin-state-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'state.sqlite');
}
function open(t, filename, create = false) {
  const store = new SQLiteStateStore({ filename, create });
  t.after(() => store.close());
  return store;
}

test('explicit memory and SQLite stores reproduce the complete frozen decision oracle', t => {
  const filename = temporary(t); let count = 0;
  class StoredAuthority extends KingpinAuthority {
    constructor(options) { super({ ...options, store: open(t, `${filename}-${++count}`, true) }); }
  }
  class MemoryAuthority extends KingpinAuthority {
    constructor(options) { super({ ...options, store: new MemoryStateStore() }); }
  }
  assert.deepEqual(captureDecisions(MemoryAuthority), baseline);
  assert.deepEqual(captureDecisions(StoredAuthority), baseline);
});

test('real process restart retains consumed IDs, contraction, clean stage, revocation and valid leases', t => {
  const filename = temporary(t);
  const run = command => JSON.parse(execFileSync(process.execPath, [workerFile, JSON.stringify({ filename, ...command })], { encoding: 'utf8' }));
  const before = run({ action: 'initialize' });
  assert.equal(before.pending.capability_envelope.level, 'read_only');
  assert.equal(before.pending.capability_envelope.clean_evaluations, 1);
  const after = run({ action: 'resume', token: before.lease.lease_token });
  assert.equal(after.duplicate, 'CDE evaluation already consumed');
  assert.equal(after.validLease, true);
  assert.equal(after.next.capability_envelope.level, 'non_destructive');
  assert.equal(after.next.capability_envelope.clean_evaluations, 0);
  assert.equal(after.next.capability_envelope.revision, before.pending.capability_envelope.revision + 1);
  assert.equal(after.denied.reason, 'capability_revoked');
});

test('restart never revives revoked leases; scoped revocation stays isolated and expiry stays exclusive', t => {
  const filename = temporary(t); let now = 1000;
  let store = open(t, filename, true);
  let a = new KingpinAuthority({ store, clock: () => now });
  a.decide(signal(0), request, 'first');
  const first = a.issue({ ...request, seconds: 1 });
  const second = a.issue({ ...request, seconds: 1 });
  a.revoke({ ...request, lease_token: first.lease_token });
  a.revoke({ ...request, tool: 'fs.write' });
  store.close();
  store = open(t, filename); a = new KingpinAuthority({ store, clock: () => now });
  assert.equal(a.hasValidLease({ ...request, lease_token: first.lease_token }), false);
  assert.equal(a.hasValidLease({ ...request, lease_token: second.lease_token }), true);
  assert.equal(a.decide(signal(0), { ...request, tool: 'fs.write' }, 'revoked').reason, 'capability_revoked');
  assert.equal(a.decide(signal(0), { ...request, session_id: 'other', tool: 'fs.write', dry_run: true, diff: 'diff' }, 'other').outcome, 'allow');
  now = 2000;
  assert.equal(a.hasValidLease({ ...request, lease_token: second.lease_token }), false);
});

test('quarantine and all recovery steps survive reopening; contracted leases remain revoked', t => {
  const filename = temporary(t);
  let store = open(t, filename, true), a = new KingpinAuthority({ store });
  a.decide(signal(0), request, 'initial');
  const lease = a.issue({ ...request, seconds: 60 });
  a.decide(signal(2, 'QUARANTINE_THRESHOLD_REACHED'), request, 'quarantine');
  for (const [index, level] of ['quarantined', 'read_only', 'read_only', 'non_destructive', 'non_destructive', 'full'].entries()) {
    store.close(); store = open(t, filename); a = new KingpinAuthority({ store });
    assert.equal(a.decide(signal(0), request, `recovery-${index}`).capability_envelope.level, level);
  }
  assert.equal(a.hasValidLease({ ...request, lease_token: lease.lease_token }), false);
  assert.equal(a.hasValidLease({ ...request, lease_token: a.issue({ ...request, seconds: 60 }).lease_token }), true);
});

test('two concurrent processes can consume an evaluation ID only once', { timeout: 10000 }, async t => {
  const filename = temporary(t);
  const store = open(t, filename, true); new KingpinAuthority({ store }); store.close();
  const children = [fork(workerFile, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }), fork(workerFile, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })];
  t.after(() => children.forEach(child => child.kill()));
  await Promise.all(children.map(child => new Promise((resolve, reject) => { child.once('message', resolve); child.once('error', reject); })));
  const results = await Promise.all(children.map(child => new Promise((resolve, reject) => {
    child.once('message', resolve); child.once('error', reject);
    child.send({ filename, action: 'consume' });
  })));
  assert.equal(results.filter(row => row.result).length, 1);
  assert.deepEqual(results.filter(row => row.error).map(row => row.error), ['CDE evaluation already consumed']);
});

test('failed writes roll back consumption, contraction and lease revocation together', t => {
  for (const store of [new MemoryStateStore(), open(t, temporary(t), true)]) {
    const a = new KingpinAuthority({ store });
    a.decide(signal(0), request, 'initial');
    const lease = a.issue({ ...request, seconds: 60 });
    let fail = true;
    const faulty = {
      bindPolicy: (...args) => store.bindPolicy(...args), contextCount: () => store.contextCount(), close: () => {},
      transaction: work => store.transaction(tx => {
        const save = tx.contexts.save;
        tx.contexts.save = (...args) => { save(...args); if (fail) throw new Error('simulated write failure'); };
        return work(tx);
      }),
    };
    const b = new KingpinAuthority({ store: faulty });
    assert.throws(() => b.decide(signal(2), request, 'retry'), /write failure/);
    assert.equal(a.hasValidLease({ ...request, lease_token: lease.lease_token }), true);
    fail = false;
    assert.equal(b.decide(signal(0), request, 'retry').capability_envelope.level, 'full');
  }
});

test('closed stores, incompatible versions, damaged records and missing databases fail closed', t => {
  const filename = temporary(t);
  const store = open(t, filename, true), a = new KingpinAuthority({ store });
  a.decide(signal(0), request, 'initial'); store.close();
  for (const fn of [() => a.decide(signal(0), request, 'closed'), () => a.issue({ ...request, seconds: 60 }), () => a.hasValidLease(request), () => a.revoke(request)]) assert.throws(fn, /closed/);
  assert.throws(() => new SQLiteStateStore({ filename: `${filename}-missing` }), /ENOENT/);
  assert.throws(() => new SQLiteStateStore({ filename, create: true }), /EEXIST/);
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA user_version = 99'); db.close();
  assert.throws(() => new SQLiteStateStore({ filename }), /schema version/);
  const repair = new DatabaseSync(filename);
  assert.equal(repair.prepare('PRAGMA user_version').get().user_version, 99);
  repair.exec('PRAGMA user_version = 2; PRAGMA ignore_check_constraints = ON; UPDATE contexts SET level = 99;'); repair.close();
  assert.throws(() => new SQLiteStateStore({ filename }), /integrity|envelope/);
});

test('corruption while open and policy changes cannot silently grant fresh state', t => {
  const filename = temporary(t), store = open(t, filename, true);
  const a = new KingpinAuthority({ store });
  a.decide(signal(2), request, 'initial');
  const policy = structuredClone(loadPolicy()); policy.tools[0].class = 'destructive';
  assert.throws(() => new KingpinAuthority({ store, policy }), /policy mismatch/);
  const db = new DatabaseSync(filename);
  db.exec('DELETE FROM store_metadata'); db.close();
  assert.throws(() => a.decide(signal(0), request, 'next'), /metadata/);
});

test('unknown persisted context and revocation records fail instead of becoming permissive defaults', t => {
  const filename = temporary(t), store = open(t, filename, true);
  const a = new KingpinAuthority({ store });
  a.decide(signal(0), request, 'initial');
  const db = new DatabaseSync(filename);
  const key = db.prepare('SELECT context_key FROM contexts').get().context_key;
  db.prepare('INSERT INTO capability_revocations VALUES (?, ?)').run(key, 'not-in-policy');
  assert.throws(() => a.decide(signal(0), request, 'unknown-revocation'), /unknown revoked/);
  db.exec('DELETE FROM capability_revocations');
  db.exec('PRAGMA foreign_keys = OFF');
  db.prepare('UPDATE contexts SET context_key = ?').run('{}'); db.close();
  assert.throws(() => a.decide(signal(0), request, 'bad-context'), /orphaned|identity/);
});

test('gateway imports no storage implementation and failed persistence cannot produce an allow response', async t => {
  const source = fs.readFileSync(new URL('./server.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /node:sqlite|state\/|SELECT |INSERT |UPDATE |DELETE /);
  process.env.NODE_ENV = 'test';
  const { createGatewayApp } = await import('./server.js');
  const store = open(t, temporary(t), true), authority = new KingpinAuthority({ store });
  store.close();
  const app = createGatewayApp({ authority,
    evaluateTurn: async () => ({ governance_signal: signal(0), top_event: { event_id: 'failed-store' } }),
    logDecision() { assert.fail('cannot log a successful decision'); },
  });
  const response = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  await app._router.stack.find(layer => layer.route?.path === '/tool').route.stack[0].handle(
    { body: { ...request, plan_id: 'plan', user_request: 'read' } }, response);
  assert.equal(response.code, 502);
  assert.equal(response.body.allow, undefined);
});

test('agent-supplied state cannot recreate authority or leases after restart', t => {
  const filename = temporary(t);
  const initial = open(t, filename, true), before = new KingpinAuthority({ store: initial });
  before.decide(signal(2, 'QUARANTINE_THRESHOLD_REACHED'), request, 'quarantine'); initial.close();
  const a = new KingpinAuthority({ store: open(t, filename) });
  const forged = { ...request, level: 0, revision: 0, clean: 2,
    capability_envelope: { level: 'full', tools: ['fs.list'] },
    lease_token: 'fake', revoked: null, seconds: 60 };
  assert.throws(() => a.issue(forged), /current envelope/);
  assert.equal(a.hasValidLease(forged), false);
  assert.equal(a.decide(signal(2), forged, 'forged').outcome, 'quarantine');
  assert.throws(() => a.issue({ ...forged, session_id: 'not-evaluated' }), /evaluated context/);
});

test('corrupt lease records and unrecognized database layouts are rejected without recreation', t => {
  const filename = temporary(t), store = open(t, filename, true);
  const a = new KingpinAuthority({ store });
  a.decide(signal(0), request, 'initial');
  a.issue({ ...request, seconds: 60 }); store.close();
  const db = new DatabaseSync(filename);
  db.exec("UPDATE leases SET args = 'damaged'"); db.close();
  assert.throws(() => new SQLiteStateStore({ filename }), /lease record/);
  const unknown = `${filename}-unknown`;
  const other = new DatabaseSync(unknown); other.exec('CREATE TABLE unrelated (id INTEGER)'); other.close();
  assert.throws(() => new SQLiteStateStore({ filename: unknown }), /schema version/);
  const inspect = new DatabaseSync(unknown);
  assert.equal(inspect.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").get().name, 'unrelated'); inspect.close();
});
