import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { KingpinAuthority, MemoryStateStore, loadPolicy } from '../kingpin/index.js';
import { SQLiteStateStore } from '../kingpin/state/sqlite.js';
import { canonical } from '../kingpin/audit/events.js';
import { request, signal, captureDecisions } from '../tests/fixtures/authority_cases.mjs';
import { authentication, dispatch, tokens, headers } from '../tests/fixtures/auth.mjs';
process.env.NODE_ENV = 'test';
const { createGatewayApp } = await import('./server.js');
const now = 1700000000000;
function setup(t, kind) {
  const dir = mkdtempSync(join(tmpdir(), 'kingpin-audit-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const filename = join(dir, 'state.db');
  const store = kind === 'sqlite' ? new SQLiteStateStore({ filename, create: true }) : new MemoryStateStore();
  t.after(() => store.close());
  return { store, filename, runtime: new KingpinAuthority({ store, clock: () => now }) };
}
const metadata = request_id => ({ request_id, principal_id: 'trusted-admin' });
const body = { ...request, plan_id: 'p', user_request: 'list files' };

for (const kind of ['memory', 'sqlite']) {
  test(`${kind}: authenticated allow/deny/review chains correlate, omit secrets and retain legacy projection`, async t => {
    for (const [gate, reason, outcome, status, enforcement] of [[0, undefined, 'allow', 200, 'allowed'],
      [2, undefined, 'deny', 403, 'denied'], [1, 'LOW_CONFIDENCE', 'human_review', 428, 'review']]) {
      const { runtime } = setup(t, kind), logs = [];
      const app = createGatewayApp({ authentication, authority: runtime, logDecision: r => logs.push(r),
        evaluateTurn: async () => ({ governance_signal: signal(gate, reason), top_event: { event_id: 'cde-id' }, events: [] }) });
      const response = await dispatch(app, '/tool', { ...body, principal_id: 'forged', request_id: 'forged',
        args: { private_data: tokens.agent }, user_request: tokens.admin, dry_run: true, diff: tokens.reviewer });
      assert.equal(response.statusCode, status);
      const requestId = response.headers['X-Request-ID'];
      assert.notEqual(requestId, 'forged');
      const events = runtime.getEventsForRequest(requestId);
      assert.equal(events[0].event_type, 'cde.signal.created');
      assert.equal(events[1].event_type, 'authority.requested');
      const decision = events.find(e => e.event_type === 'authority.decision');
      assert.equal(decision.outcome, outcome);
      assert.deepEqual(decision.envelope, response.body.authority_decision.capability_envelope);
      assert.equal(events.at(-1).event_type, `tool.enforcement.${enforcement}`);
      for (const event of events) {
        assert.equal(event.principal_id, 'agent-principal');
        assert.equal(event.evaluation_id, 'cde-id');
        assert.equal(event.decision_id, decision.decision_id);
        assert.equal(event.request_id, requestId);
        assert.equal(event.arguments_hash.length, 64);
        assert.equal(event.agent_id, 'actor');
      }
      assert.equal(new Set(events.map(e => e.event_id)).size, events.length);
      assert.deepEqual(events.map(e => e.sequence), events.map((e, i) => i + 1));
      const encoded = JSON.stringify(events);
      for (const secret of Object.values(tokens)) assert.ok(!encoded.includes(secret));
      assert.ok(!encoded.includes('private_data'));
      assert.equal(events.some(e => e.event_type === 'review.requested'), outcome === 'human_review');
      assert.ok(!encoded.includes('review.approved') && !encoded.includes('review.denied'));
      assert.ok(!('request_id' in response.body.authority_decision));
      assert.ok(!('event_type' in logs[0]));
      assert.ok(!('request_id' in logs[0]));
      assert.deepEqual(logs[0].authority_decision, response.body.authority_decision);
      if (gate === 2) assert.equal(decision.lease_check, 'missing');
    }
  });

  test(`${kind}: control-plane audit distinguishes issuance, nonce, capability, legacy token and epoch revocation`, t => {
    const { runtime } = setup(t, kind);
    runtime.decide(signal(0), request, 'init', metadata('init'));
    const a = runtime.issue({ ...request, seconds: 60 }, metadata('issue'));
    runtime.revokeLeaseNonce(a.lease_id, metadata('nonce'));
    runtime.revokeLeaseNonce(a.lease_id, metadata('nonce'));
    runtime.revoke({ ...request, lease_token: a.lease_token }, metadata('legacy'));
    runtime.revoke({ ...request, tool: 'fs.write' }, metadata('capability'));
    runtime.revokeAllLeases(metadata('epoch'));
    assert.equal(runtime.getEventsForRequest('issue')[0].lease_id, a.lease_id);
    assert.equal(runtime.getEventsForRequest('issue')[0].expires_at_utc, a.expires_at);
    assert.equal(runtime.getEventsForRequest('nonce').length, 2);
    assert.deepEqual(runtime.getEventsForRequest('nonce')[0].reason_codes, ['NONCE_REVOKED']);
    assert.deepEqual(runtime.getEventsForRequest('legacy')[0].reason_codes, ['EXPLICIT_REVOCATION']);
    assert.equal(runtime.getEventsForRequest('capability')[0].event_type, 'capability.revoked');
    assert.equal(runtime.getEventsForRequest('epoch')[0].event_type, 'lease.epoch_advanced');
    assert.equal(runtime.getEventsForRequest('epoch')[0].lease_epoch, 1);
    assert.ok(!JSON.stringify(runtime.getEventsForRequest('issue')).includes(a.lease_token));
  });

  test(`${kind}: recovery, contraction and detailed lease rejection record actual decisions`, t => {
    const { runtime } = setup(t, kind);
    runtime.decide(signal(2), request, 'contract', metadata('flow'));
    const lease = runtime.issue({ ...request, seconds: 60 }, metadata('flow'));
    runtime.revokeLeaseNonce(lease.lease_id, metadata('flow'));
    runtime.decide(signal(2), { ...request, lease_token: lease.lease_token }, 'reject', metadata('flow'));
    runtime.decide(signal(0), request, 'clean1', metadata('flow'));
    runtime.decide(signal(0), request, 'clean2', metadata('flow'));
    const events = runtime.getEventsForRequest('flow');
    for (const type of ['authority.contracted', 'authority.restored', 'recovery.stage_changed', 'lease.rejected'])
      assert.ok(events.some(e => e.event_type === type), type);
    assert.equal(events.find(e => e.event_type === 'lease.rejected' && e.evaluation_id === 'reject').lease_check, 'nonce_revoked');
    assert.equal(events.filter(e => e.event_type === 'recovery.stage_changed').length, 2);
    const copy = runtime.getEventsForRequest('flow'); copy[0].reason_codes.push('FORGED'); copy.length = 0;
    assert.deepEqual(runtime.getEventsForRequest('flow'), events);
  });

  test(`${kind}: required event failure rolls back issue/revocation/epoch/decision and consumed IDs`, t => {
    const { store, runtime } = setup(t, kind);
    let fail = false;
    const wrapped = { bindPolicy: (...a) => store.bindPolicy(...a), contextCount: () => store.contextCount(), close() {},
      transaction: work => store.transaction(tx => work({ ...tx, audit: { append(event) {
        tx.audit.append(event); if (fail) throw new Error('audit unavailable');
      } } })) };
    const faulty = new KingpinAuthority({ store: wrapped, clock: () => now });
    runtime.decide(signal(0), request, 'init', metadata('init'));
    const lease = runtime.issue({ ...request, seconds: 60 }, metadata('issued'));
    fail = true;
    for (const work of [() => faulty.issue({ ...request, seconds: 60 }, metadata('failed')),
      () => faulty.revokeLeaseNonce(lease.lease_id, metadata('failed')),
      () => faulty.revokeAllLeases(metadata('failed')),
      () => faulty.revoke({ ...request, tool: 'fs.list' }, metadata('failed')),
      () => faulty.decide(signal(2), request, 'retry', metadata('failed'))]) {
      assert.throws(work, /audit unavailable/);
      assert.deepEqual(runtime.getEventsForRequest('failed'), []);
      assert.equal(runtime.validateLease({ ...request, lease_token: lease.lease_token }).reason, 'ok');
    }
    fail = false;
    assert.equal(faulty.decide(signal(0), request, 'retry', metadata('success')).outcome, 'allow');
    assert.equal(runtime.issue({ ...request, seconds: 60 }, metadata('epoch-check')).issuer, 'kingpin');
    assert.equal(runtime.getEventsForRequest('epoch-check')[0].lease_epoch, 0);
  });
}

test('audit query unavailability does not participate in decisions or gateway enforcement', async t => {
  const { runtime, store } = setup(t, 'memory');
  store.getEventsForRequest = () => { throw new Error('query unavailable'); };
  const app = createGatewayApp({ authentication, authority: runtime, logDecision() {},
    evaluateTurn: async () => ({ governance_signal: signal(0), top_event: { event_id: 'id' } }) });
  assert.equal((await dispatch(app, '/tool', body)).statusCode, 200);
  assert.throws(() => runtime.getEventsForRequest('anything'), /query unavailable/);
});

test('enforcement audit failure refuses an otherwise allowed request', async t => {
  const { runtime } = setup(t, 'memory');
  runtime.recordEnforcement = () => { throw new Error('audit unavailable'); };
  const app = createGatewayApp({ authentication, authority: runtime, logDecision() {},
    evaluateTurn: async () => ({ governance_signal: signal(0), top_event: { event_id: 'id' } }) });
  assert.equal((await dispatch(app, '/tool', body)).statusCode, 502);
});

test('SQLite event history survives an actual new process and prevents normal updates/deletes', t => {
  const { store, runtime, filename } = setup(t, 'sqlite');
  runtime.decide(signal(0), request, 'first', metadata('persist'));
  const expected = runtime.getEventsForRequest('persist');
  store.close();
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { SQLiteStateStore } from '${new URL('../kingpin/state/sqlite.js', import.meta.url).href}';
    const store = new SQLiteStateStore({ filename: process.argv[1] });
    console.log(JSON.stringify(store.getEventsForRequest('persist'))); store.close();
  `, filename], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), expected);
  const db = new DatabaseSync(filename);
  assert.throws(() => db.exec("UPDATE governance_events SET request_id = 'changed'"), /append-only/);
  assert.throws(() => db.exec('DELETE FROM governance_events'), /append-only/);
  db.close();
});

test('SQLite v2 migration preserves existing state and starts an empty separate event stream', t => {
  const dir = mkdtempSync(join(tmpdir(), 'kingpin-v2-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const filename = join(dir, 'v2.db'), db = new DatabaseSync(filename);
  db.exec(readFileSync(new URL('../kingpin/state/schema.sql', import.meta.url), 'utf8'));
  db.function('kingpin_lease_nonce', token => createHash('sha256').update(token).digest('hex'));
  db.exec(readFileSync(new URL('../kingpin/state/migrations/002_lease_revocation.sql', import.meta.url), 'utf8'));
  const key = canonical({ session_id: 's', speaker_id: 'actor', channel_id: 'channel', scope_key: 'scene:scene' });
  db.prepare('UPDATE store_metadata SET policy_fingerprint = ?').run(createHash('sha256').update(canonical(loadPolicy())).digest('hex'));
  db.prepare('INSERT INTO contexts VALUES (?, 2, 1, 3)').run(key);
  db.prepare('INSERT INTO consumed_evaluations VALUES (?, ?)').run(key, 'old-id');
  db.prepare('INSERT INTO capability_revocations VALUES (?, ?)').run(key, 'fs.write');
  const token = '00000000-0000-4000-8000-000000000000', nonce = createHash('sha256').update(token).digest('hex');
  db.prepare('INSERT INTO leases VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(token, key, 'fs.list', canonical(request.args), now + 60000, null, nonce, 0);
  db.prepare('INSERT INTO lease_nonce_revocations VALUES (?)').run(nonce);
  db.exec('UPDATE store_metadata SET lease_epoch = 1');
  const tables = ['store_metadata','contexts','consumed_evaluations','capability_revocations','leases','lease_nonce_revocations'];
  const before = tables.map(table => db.prepare(`SELECT * FROM ${table}`).all()); db.close();
  const originalExec = DatabaseSync.prototype.exec;
  DatabaseSync.prototype.exec = function(sql) {
    const result = originalExec.call(this, sql);
    if (sql.includes('CREATE TABLE governance_events')) throw new Error('migration fault');
    return result;
  };
  try { assert.throws(() => new SQLiteStateStore({ filename }), /migration fault/); }
  finally { DatabaseSync.prototype.exec = originalExec; }
  const rolledBack = new DatabaseSync(filename);
  assert.equal(rolledBack.prepare('PRAGMA user_version').get().user_version, 2);
  assert.equal(rolledBack.prepare("SELECT count(*) n FROM sqlite_schema WHERE name = 'governance_events'").get().n, 0);
  assert.deepEqual(tables.map(table => rolledBack.prepare(`SELECT * FROM ${table}`).all()), before);
  rolledBack.close();
  const store = new SQLiteStateStore({ filename });
  const runtime = new KingpinAuthority({ store, clock: () => now });
  assert.deepEqual(runtime.getEventsForRequest('old-id'), []);
  assert.equal(runtime.validateLease({ ...request, lease_token: token }).reason, 'epoch_revoked');
  assert.throws(() => runtime.decide(signal(0), request, 'old-id'), /already consumed/);
  store.close();
  const after = new DatabaseSync(filename);
  assert.equal(after.prepare('PRAGMA user_version').get().user_version, 4);
  assert.deepEqual(tables.map(table => after.prepare(`SELECT * FROM ${table}`).all()), before);
  after.close();
});

test('malformed persisted audit records fail closed without resetting the database', t => {
  const { runtime, filename, store } = setup(t, 'sqlite');
  runtime.decide(signal(0), request, 'init', metadata('corrupt'));
  const db = new DatabaseSync(filename);
  const trigger = db.prepare("SELECT sql FROM sqlite_schema WHERE name = 'immutable_governance_event'").get().sql;
  db.exec('DROP TRIGGER immutable_governance_event');
  db.exec(`UPDATE governance_events SET record = '{"bad":true}' WHERE sequence = 1`);
  db.exec(trigger);
  assert.throws(() => runtime.revokeAllLeases(), /audit event/);
  assert.equal(db.prepare('SELECT lease_epoch FROM store_metadata').get().lease_epoch, 0);
  store.close();
  assert.throws(() => new SQLiteStateStore({ filename }), /audit event/);
  assert.equal(db.prepare('SELECT count(*) n FROM governance_events').get().n, 3);
  db.close();
});

test('frozen authority oracle remains schema-equivalent with product audit enabled', () => {
  const frozen = JSON.parse(readFileSync(new URL('../tests/fixtures/pre_extraction_authority.json', import.meta.url), 'utf8'));
  assert.deepEqual(captureDecisions(KingpinAuthority), frozen);
});

test('authentication rejections contain only resolved identity and never evaluate or consume authority', async t => {
  const { runtime } = setup(t, 'sqlite');
  const app = createGatewayApp({ authentication, authority: runtime, logDecision() {},
    evaluateTurn() { assert.fail('rejected request must not evaluate'); } });
  for (const [credentialHeaders, changes, principal] of [[{}, {}, null],
    [headers(), { session_id: 'other', principal_id: tokens.admin }, 'agent-principal']]) {
    const response = await dispatch(app, '/tool', { ...body, ...changes }, credentialHeaders);
    assert.ok([401, 403].includes(response.statusCode));
    const events = runtime.getEventsForRequest(response.headers['X-Request-ID']);
    assert.equal(events.length, 1);
    assert.equal(events[0].event_type, 'authentication.rejected');
    assert.equal(events[0].principal_id, principal);
    assert.equal(events[0].context, null);
    assert.equal(runtime.states.size, 0);
    for (const secret of Object.values(tokens)) assert.ok(!JSON.stringify(events).includes(secret));
  }
});

test('HTTP control-plane events use administrator identity and server request correlation', async t => {
  const { runtime } = setup(t, 'sqlite');
  runtime.decide(signal(0), request, 'init');
  const app = createGatewayApp({ authentication, authority: runtime, logDecision() {} });
  const lease = await dispatch(app, '/lease', { ...request, seconds: 60, principal_id: 'forged' }, headers('admin'));
  const nonce = await dispatch(app, '/revoke/nonce', { lease_nonce: lease.body.lease_id }, headers('admin'));
  const epoch = await dispatch(app, '/revoke/all', {}, headers('admin'));
  for (const [response, type] of [[lease, 'lease.issued'], [nonce, 'lease.revoked'], [epoch, 'lease.epoch_advanced']]) {
    assert.equal(response.statusCode, 200);
    const [event] = runtime.getEventsForRequest(response.headers['X-Request-ID']);
    assert.equal(event.event_type, type);
    assert.equal(event.principal_id, 'admin-principal');
  }
});

test('lease rejection events preserve expiry, binding, nonce and epoch distinctions', t => {
  for (const reason of ['expired', 'out_of_scope', 'nonce_revoked', 'epoch_revoked']) {
    const { runtime } = setup(t, 'memory');
    runtime.decide(signal(0), request, 'init');
    const operation = { ...request, tool: 'fs.delete', seconds: 60 };
    const lease = runtime.issue(operation);
    const use = { ...operation, lease_token: lease.lease_token };
    if (reason === 'expired') runtime.clock = () => now + 60000;
    if (reason === 'out_of_scope') use.args = { path: '/elsewhere' };
    if (reason === 'nonce_revoked') runtime.revokeLeaseNonce(lease.lease_id);
    if (reason === 'epoch_revoked') runtime.revokeAllLeases();
    runtime.decide(signal(0), use, 'reject', metadata('reject'));
    assert.equal(runtime.getEventsForRequest('reject').find(e => e.event_type === 'lease.rejected').lease_check, reason);
  }
});

test('concurrent SQLite control operations have one committed sequence and matching epochs', async t => {
  const { store, filename } = setup(t, 'sqlite'); store.close();
  const script = `
    import { SQLiteStateStore } from '${new URL('../kingpin/state/sqlite.js', import.meta.url).href}';
    import { KingpinAuthority } from '${new URL('../kingpin/index.js', import.meta.url).href}';
    const store = new SQLiteStateStore({ filename: process.argv[1] });
    const runtime = new KingpinAuthority({ store });
    runtime.revokeAllLeases({ request_id: 'concurrent' }); store.close();`;
  const results = await Promise.allSettled([1, 2].map(() => promisify(execFile)(process.execPath,
    ['--input-type=module', '-e', script, filename])));
  for (const result of results) assert.equal(result.status, 'fulfilled', result.reason?.message);
  const reopened = new SQLiteStateStore({ filename });
  const events = reopened.getEventsForRequest('concurrent'); reopened.close();
  assert.deepEqual(events.map(e => e.sequence), [1, 2]);
  assert.deepEqual(events.map(e => e.lease_epoch), [1, 2]);
});

for (const kind of ['memory', 'sqlite']) {
  test(`${kind}: arbitrary product fields cannot leak into the separate legacy JSONL record`, async t => {
    const { runtime, store } = setup(t, kind), logs = [];
    const app = createGatewayApp({ authentication, authority: runtime, logDecision: record => logs.push(record),
      evaluateTurn: async () => ({ governance_signal: signal(0), top_event: { event_id: 'separation' } }) });
    const response = await dispatch(app, '/tool', body);
    assert.equal(response.statusCode, 200);
    const requestId = response.headers['X-Request-ID'];
    const before = JSON.stringify(logs);
    const original = runtime.getEventsForRequest(requestId);
    const detached = runtime.getEventsForRequest(requestId);
    for (const record of detached) {
      record.arbitrary_product_field = { nested: ['extra'] };
      record.fixture_hash = 'not-a-conformance-fixture';
      record.decision = 'not-a-governance-decision';
    }
    assert.equal(JSON.stringify(logs), before);
    assert.deepEqual(runtime.getEventsForRequest(requestId), original);
    const { sequence, ...persisted } = original[0];
    for (const extra of [{ arbitrary_product_field: true }, { fixture_hash: 'extra' }]) {
      assert.throws(() => store.transaction(tx => tx.audit.append({ ...persisted, ...extra })), /audit event/);
    }
    assert.deepEqual(runtime.getEventsForRequest(requestId), original);
    assert.equal(JSON.stringify(logs), before);
    // This is a legacy operational record, not the supplied Paper 9 envelope.
    const paper9 = ['decision', 'demo_id', 'evidence', 'fixture_hash', 'fixture_path',
      'mode', 'normative_ids', 'pass', 'rationale', 'timestamp_utc'];
    assert.deepEqual(Object.keys(logs[0]).filter(key => paper9.includes(key)), ['decision']);
  });
}
