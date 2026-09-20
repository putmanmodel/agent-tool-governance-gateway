import { authentication, dispatch, headers } from "../tests/fixtures/auth.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { KingpinAuthority, MemoryStateStore, loadPolicy } from '../kingpin/index.js';
import { SQLiteStateStore } from '../kingpin/state/sqlite.js';
import { request, signal } from '../tests/fixtures/authority_cases.mjs';

const now = 1700000000000;
const worker = fileURLToPath(new URL('../tests/fixtures/sqlite_process.mjs', import.meta.url));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kingpin-v04-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'state.sqlite');
}
function sqlite(t, filename, create = false) {
  const store = new SQLiteStateStore({ filename, create }); t.after(() => store.close()); return store;
}
const runtime = store => new KingpinAuthority({ store, clock: () => now });
const issue = (a, req = request) => a.issue({ ...req, seconds: 60 });
const validate = (a, lease, req = request) => a.validateLease({ ...req, lease_token: lease.lease_token });
function rowFor(store, lease) { return store.transaction(tx => tx.leases.get(lease.lease_token)); }
function processCall(filename, action, fields = {}) {
  return JSON.parse(execFileSync(process.execPath, [worker, JSON.stringify({ filename, action, ...fields })], { encoding: 'utf8' }));
}

for (const kind of ['memory', 'sqlite']) {
  const setup = t => kind === 'memory' ? new MemoryStateStore() : sqlite(t, temporary(t), true);
  test(`${kind}: secure identities are unique; nonce revocation is isolated, idempotent and permanent through recovery`, t => {
    const store = setup(t), a = runtime(store);
    a.decide(signal(0), request, 'initial');
    const first = issue(a), second = issue(a);
    assert.notEqual(first.lease_token, second.lease_token);
    assert.notEqual(first.lease_id, second.lease_id);
    assert.equal(first.lease_id, hash(first.lease_token));
    assert.equal(rowFor(store, first).nonce, first.lease_id);
    assert.equal(rowFor(store, first).issuance_epoch, 0);
    const result = a.revokeLeaseNonce(first.lease_id);
    assert.deepEqual(a.revokeLeaseNonce(first.lease_id), result);
    assert.deepEqual(validate(a, first), { valid: false, reason: 'nonce_revoked' });
    assert.deepEqual(validate(a, second), { valid: true, reason: 'ok' });
    a.decide(signal(2, 'QUARANTINE_THRESHOLD_REACHED'), request, 'quarantine');
    for (let i = 0; i < 6; i++) a.decide(signal(0), request, `recover-${i}`);
    assert.equal(validate(a, first).reason, 'nonce_revoked');
    assert.equal(validate(a, second).reason, 'envelope_contracted');
    assert.throws(() => a.revokeLeaseNonce('unknown'), /Unknown lease nonce/);
  });

  test(`${kind}: global epoch revokes all contexts without rewriting leases; fresh issuance uses new epoch`, t => {
    const store = setup(t), a = runtime(store);
    const other = { ...request, session_id: 'other' };
    a.decide(signal(0), request, 'initial'); a.decide(signal(0), other, 'initial');
    const one = issue(a), two = issue(a, other);
    const originalRows = [rowFor(store, one), rowFor(store, two)];
    assert.deepEqual(a.revokeAllLeases(), { revoked: true, lease_epoch: 1 });
    assert.deepEqual([rowFor(store, one), rowFor(store, two)], originalRows);
    assert.equal(validate(a, one).reason, 'epoch_revoked');
    assert.equal(validate(a, two, other).reason, 'epoch_revoked');
    const fresh = issue(a);
    assert.equal(rowFor(store, fresh).issuance_epoch, 1);
    assert.equal(validate(a, fresh).reason, 'ok');
    a.decide(signal(2), request, 'contract');
    for (let i = 0; i < 4; i++) a.decide(signal(0), request, `recover-${i}`);
    assert.equal(validate(a, one).reason, 'epoch_revoked');
    assert.equal(a.revokeAllLeases().lease_epoch, 2);
    assert.equal(validate(a, fresh).reason, 'epoch_revoked');
  });

  test(`${kind}: detailed reasons and legacy capability/token revocation remain distinct`, t => {
    const store = setup(t); let time = now;
    const a = new KingpinAuthority({ store, clock: () => time });
    a.decide(signal(0), request, 'initial');
    const lease = issue(a);
    assert.equal(a.validateLease(request).reason, 'missing');
    for (const req of [{ ...request, session_id: 'elsewhere' }, { ...request, tool: 'fs.read' }, { ...request, args: {} }]) {
      assert.equal(validate(a, lease, req).reason, 'out_of_scope');
    }
    time = now + 60000; assert.equal(validate(a, lease).reason, 'expired'); time = now;
    a.revoke({ ...request, lease_token: lease.lease_token });
    assert.equal(validate(a, lease).reason, 'explicit_revoked');
    const otherLease = issue(a); a.revoke(request);
    assert.equal(validate(a, otherLease).reason, 'capability_revoked');
    assert.equal(a.decide(signal(0), request, 'revoked').reason, 'capability_revoked');
    a.revokeLeaseNonce(otherLease.lease_id); assert.equal(validate(a, otherLease).reason, 'nonce_revoked');
    a.revokeAllLeases(); assert.equal(validate(a, otherLease).reason, 'epoch_revoked');
    time = now + 60000; assert.equal(validate(a, otherLease).reason, 'expired');
  });

  test(`${kind}: request fields cannot choose/reuse identity, reset epoch or bypass revocation`, t => {
    const store = setup(t), a = runtime(store);
    a.decide(signal(0), request, 'initial');
    const old = issue(a); a.revokeLeaseNonce(old.lease_id); a.revokeAllLeases();
    const forged = { ...request, nonce: old.lease_id, lease_nonce: old.lease_id, lease_id: old.lease_id,
      lease_token: old.lease_token, issuance_epoch: 0, lease_epoch: 0, revoked: false, valid: true };
    const fresh = issue(a, forged);
    assert.notEqual(fresh.lease_id, old.lease_id);
    assert.equal(rowFor(store, fresh).issuance_epoch, 1);
    assert.equal(a.validateLease(forged).reason, 'epoch_revoked');
    assert.equal(a.decide(signal(2), forged, 'gate2').outcome, 'deny');
  });

  test(`${kind}: Kingpin authority decisions enforce nonce and epoch rejection without envelope contraction`, t => {
    const store = setup(t), a = runtime(store);
    const destructive = { ...request, tool: 'fs.delete' };
    a.decide(signal(0), destructive, 'initial');
    const one = issue(a, destructive);
    const decide = (lease, id) => a.decide(signal(0), { ...destructive, lease_token: lease.lease_token }, id);
    assert.equal(decide(one, 'before').outcome, 'allow');
    a.revokeLeaseNonce(one.lease_id);
    const nonceDenied = decide(one, 'nonce-denied');
    assert.equal(nonceDenied.outcome, 'deny');
    assert.equal(nonceDenied.capability_envelope.level, 'full');
    const two = issue(a, destructive);
    assert.equal(decide(two, 'fresh-before-epoch').outcome, 'allow');
    a.revokeAllLeases();
    assert.equal(decide(two, 'epoch-denied').outcome, 'deny');
    assert.equal(decide(issue(a, destructive), 'fresh-after-epoch').outcome, 'allow');
  });

  test(`${kind}: nonce revocation and epoch changes rollback on operation failure`, t => {
    const store = setup(t), a = runtime(store);
    a.decide(signal(0), request, 'initial'); const lease = issue(a);
    const faulty = {
      bindPolicy: (...args) => store.bindPolicy(...args), contextCount: () => store.contextCount(), close() {},
      transaction: work => store.transaction(tx => { work(tx); throw new Error('simulated commit failure'); }),
    };
    const b = runtime(faulty);
    assert.throws(() => b.revokeLeaseNonce(lease.lease_id), /commit failure/);
    assert.equal(validate(a, lease).reason, 'ok');
    assert.throws(() => b.revokeAllLeases(), /commit failure/);
    assert.equal(validate(a, lease).reason, 'ok');
    assert.equal(store.transaction(tx => tx.leaseEpoch.current()), 0);
  });
}

test('nonce and epoch invalidation survive real child-process restarts', t => {
  const filename = temporary(t), store = sqlite(t, filename, true), a = runtime(store);
  a.decide(signal(0), request, 'initial'); const one = issue(a), two = issue(a); store.close();
  processCall(filename, 'revoke-nonce', { nonce: one.lease_id });
  assert.equal(processCall(filename, 'validate', { token: one.lease_token }).reason, 'nonce_revoked');
  assert.equal(processCall(filename, 'validate', { token: two.lease_token }).reason, 'ok');
  assert.equal(processCall(filename, 'revoke-all').lease_epoch, 1);
  assert.equal(processCall(filename, 'validate', { token: two.lease_token }).reason, 'epoch_revoked');
  const reopened = sqlite(t, filename), resumed = runtime(reopened);
  const fresh = issue(resumed);
  assert.equal(rowFor(reopened, fresh).issuance_epoch, 1);
  assert.equal(validate(resumed, fresh).reason, 'ok');
});

async function concurrently(t, filename, commands) {
  const children = commands.map(() => fork(worker, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }));
  t.after(() => children.forEach(child => child.kill()));
  await Promise.all(children.map(child => new Promise((resolve, reject) => {
    child.once('message', resolve); child.once('error', reject);
  })));
  return Promise.all(children.map((child, index) => new Promise((resolve, reject) => {
    child.once('message', message => message.error ? reject(new Error(message.error)) : resolve(message.result));
    child.once('error', reject); child.send({ filename, ...commands[index] });
  })));
}

test('concurrent validation/revocation serializes; no durable reactivation and no lost epoch increments', { timeout: 10000 }, async t => {
  const filename = temporary(t), store = sqlite(t, filename, true), a = runtime(store);
  a.decide(signal(0), request, 'initial'); const lease = issue(a);
  const nonceResults = await concurrently(t, filename, [
    { action: 'validate', token: lease.lease_token }, { action: 'revoke-nonce', nonce: lease.lease_id },
  ]);
  assert.ok(['ok', 'nonce_revoked'].includes(nonceResults[0].reason));
  assert.equal(validate(a, lease).reason, 'nonce_revoked');
  const epochs = await concurrently(t, filename, [{ action: 'revoke-all' }, { action: 'revoke-all' }, { action: 'validate', token: lease.lease_token }]);
  assert.deepEqual(epochs.slice(0, 2).map(result => result.lease_epoch).sort(), [1, 2]);
  assert.equal(validate(a, lease).reason, 'epoch_revoked');
  store.close();
  assert.equal(validate(runtime(sqlite(t, filename)), lease).reason, 'epoch_revoked');
});

function v1Database(filename) {
  const db = new DatabaseSync(filename);
  db.exec(fs.readFileSync(new URL('../kingpin/state/schema.sql', import.meta.url), 'utf8'));
  const fingerprint = hash(canonical(loadPolicy()));
  db.prepare('UPDATE store_metadata SET policy_fingerprint = ?').run(fingerprint);
  const key = canonical({ session_id: 's', speaker_id: 'actor', channel_id: 'channel', scope_key: 'scene:scene' });
  db.prepare('INSERT INTO contexts VALUES (?, 2, 1, 2)').run(key);
  db.prepare('INSERT INTO consumed_evaluations VALUES (?, ?)').run(key, 'used-v1');
  db.prepare('INSERT INTO capability_revocations VALUES (?, ?)').run(key, 'fs.write');
  const tokens = ['12345678-1234-4234-8234-123456789012', '12345678-1234-4234-8234-123456789013'];
  tokens.forEach((token, index) => db.prepare('INSERT INTO leases VALUES (?, ?, ?, ?, ?, ?)').run(
    token, key, 'fs.list', canonical(request.args), now + 60000, index ? 'EXPLICIT_REVOCATION' : null));
  const before = db.prepare('SELECT * FROM leases ORDER BY token').all().map(row => ({ ...row })); db.close();
  return { tokens, before };
}

test('SQLite v1 migration is deterministic, preserves all prior state, and gives old leases epoch zero', t => {
  const filename = temporary(t), { tokens, before } = v1Database(filename);
  const store = sqlite(t, filename), a = runtime(store);
  const db = new DatabaseSync(filename);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2);
  assert.equal(db.prepare('SELECT lease_epoch FROM store_metadata').get().lease_epoch, 0);
  assert.deepEqual(db.prepare('SELECT * FROM leases ORDER BY token').all().map(row => ({ ...row })),
    before.map(row => ({ ...row, nonce: hash(row.token), issuance_epoch: 0 })));
  assert.equal(a.validateLease({ ...request, lease_token: tokens[0] }).reason, 'ok');
  assert.equal(a.validateLease({ ...request, lease_token: tokens[1] }).reason, 'explicit_revoked');
  assert.throws(() => a.decide(signal(0), request, 'used-v1'), /already consumed/);
  const decision = a.decide(signal(0), request, 'new-v2');
  assert.equal(decision.capability_envelope.level, 'non_destructive');
  assert.equal(decision.capability_envelope.revision, 3);
  assert.deepEqual(decision.capability_envelope.revoked_tools, ['fs.write']);
  a.revokeLeaseNonce(hash(tokens[0]));
  assert.equal(a.validateLease({ ...request, lease_token: tokens[0] }).reason, 'nonce_revoked');
  const snapshot = db.prepare('SELECT * FROM leases ORDER BY token').all(); db.close(); store.close();
  runtime(sqlite(t, filename));
  const again = new DatabaseSync(filename);
  assert.deepEqual(again.prepare('SELECT * FROM leases ORDER BY token').all(), snapshot); again.close();
});

test('corrupt v1 migration fails without resetting or partially changing the database', t => {
  const filename = temporary(t); v1Database(filename);
  const db = new DatabaseSync(filename); db.exec("UPDATE leases SET args = 'corrupt'"); db.close();
  assert.throws(() => new SQLiteStateStore({ filename }), /lease record/);
  const inspect = new DatabaseSync(filename);
  assert.equal(inspect.prepare('PRAGMA user_version').get().user_version, 1);
  assert.equal(inspect.prepare('PRAGMA table_info(leases)').all().some(column => column.name === 'nonce'), false);
  assert.equal(inspect.prepare('SELECT count(*) AS n FROM leases').get().n, 2); inspect.close();
});

test('immutable identities, permanent nonce records and epoch monotonicity are enforced in SQLite', t => {
  const filename = temporary(t), store = sqlite(t, filename, true), a = runtime(store);
  a.decide(signal(0), request, 'initial'); const lease = issue(a); a.revokeLeaseNonce(lease.lease_id); a.revokeAllLeases();
  const db = new DatabaseSync(filename);
  assert.throws(() => db.exec('UPDATE leases SET issuance_epoch = 1'), /immutable/);
  assert.throws(() => db.exec("UPDATE leases SET nonce = 'chosen'"), /immutable/);
  assert.throws(() => db.exec('UPDATE store_metadata SET lease_epoch = 0'), /advance/);
  assert.throws(() => db.exec('DELETE FROM lease_nonce_revocations'), /permanent/);
  db.close();
  assert.equal(validate(a, lease).reason, 'epoch_revoked');
});

test('corrupt or incompatible nonce/epoch state fails closed, including overflow', t => {
  const filename = temporary(t), store = sqlite(t, filename, true), a = runtime(store);
  a.decide(signal(0), request, 'initial'); const lease = issue(a);
  const db = new DatabaseSync(filename);
  const metadata = db.prepare('SELECT * FROM store_metadata').get();
  db.exec('DELETE FROM store_metadata');
  db.prepare('INSERT INTO store_metadata VALUES (1, ?, ?)').run(metadata.policy_fingerprint, Number.MAX_SAFE_INTEGER);
  assert.throws(() => a.revokeAllLeases(), /invalid lease epoch/);
  assert.equal(validate(a, lease).reason, 'epoch_revoked');
  db.exec('PRAGMA foreign_keys = OFF');
  db.prepare('INSERT INTO lease_nonce_revocations VALUES (?)').run('unknown-nonce');
  assert.throws(() => a.validateLease({ ...request, lease_token: lease.lease_token }), /orphaned/);
  db.close(); store.close();
  assert.throws(() => new SQLiteStateStore({ filename }), /orphaned/);
});

test('new administrative APIs are exposed only through authenticated admin routes', async () => {
  process.env.NODE_ENV = 'test';
  const { createGatewayApp } = await import('./server.js');
  const app = createGatewayApp({ authentication });
  for (const path of ['/revoke/nonce', '/revoke/all']) {
    assert.equal((await dispatch(app, path, {}, {})).statusCode, 401);
    assert.equal((await dispatch(app, path, {}, headers('agent'))).statusCode, 403);
  }
});

test('a mid-migration failure rolls back new columns and nonce backfill before retry', t => {
  const filename = temporary(t), { tokens, before } = v1Database(filename);
  const register = DatabaseSync.prototype.function;
  const mock = t.mock.method(DatabaseSync.prototype, 'function', function(name, implementation) {
    return register.call(this, name, token => {
      if (token === tokens[1]) throw new Error('simulated nonce backfill failure');
      return implementation(token);
    });
  });
  assert.throws(() => new SQLiteStateStore({ filename }), /backfill failure/);
  mock.mock.restore();
  const inspect = new DatabaseSync(filename);
  assert.equal(inspect.prepare('PRAGMA user_version').get().user_version, 1);
  assert.deepEqual(inspect.prepare('SELECT * FROM leases ORDER BY token').all().map(row => ({ ...row })), before);
  inspect.close();
  const a = runtime(sqlite(t, filename));
  assert.equal(a.validateLease({ ...request, lease_token: tokens[0] }).reason, 'ok');
});
