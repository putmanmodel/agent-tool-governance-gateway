import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fork, execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { KingpinAuthority, MemoryStateStore, loadPolicy } from '../kingpin/index.js';
import { SQLiteStateStore } from '../kingpin/state/sqlite.js';
import { canonical, bindingHash } from '../kingpin/audit/events.js';
import { createAuthentication } from '../kingpin/auth/access.js';
import { pythonExecutable } from '../conformance/runtime.mjs';
import { request, signal } from '../tests/fixtures/authority_cases.mjs';
import { authentication, config, tokens, headers, dispatch } from '../tests/fixtures/auth.mjs';

const now = 1700000000000;
const agent = authentication.authenticate(headers().authorization);
const reviewer = authentication.authenticate(headers('reviewer').authorization);
const admin = authentication.authenticate(headers('admin').authorization);
const other = authentication.authenticate(headers('other').authorization);
const ready = { ...request, dry_run: true, diff: 'bounded diff' };
function filename(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kingpin-review-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'state.sqlite');
}
function setup(t, kind) {
  const file = kind === 'sqlite' ? filename(t) : null;
  const store = file ? new SQLiteStateStore({ filename: file, create: true }) : new MemoryStateStore();
  t.after(() => store.close());
  let time = now;
  const a = new KingpinAuthority({ store, clock: () => time });
  return { a, store, file, advance: () => { time += 60000; } };
}
function pending(a, req = ready) {
  const id = crypto.randomUUID();
  const decision = a.decide(signal(1, 'LOW_CONFIDENCE'), req, id,
    { request_id: id, principal_id: agent.principal_id, redact: authentication.redact });
  assert.equal(decision.outcome, 'human_review');
  return a.reviewIdForDecision(decision);
}
function approve(a, id) {
  const result = a.resolveReview(id, 'approve', reviewer);
  assert.equal(result.ready_for_consumption, true);
  assert.equal(result.execution_authorized, false);
  return result.review;
}
function withLease(a) {
  a.decide(signal(1), ready, crypto.randomUUID());
  const lease = a.issue({ ...ready, seconds: 60 });
  const req = { ...ready, lease_token: lease.lease_token };
  return { lease, req, id: pending(a, req) };
}
for (const kind of ['memory','sqlite']) {
  test(`${kind}: pending review is bound, permission separated, approved once and consumed once`, t => {
    const { a, store } = setup(t, kind), id = pending(a);
    const before = a.getReview(id, reviewer);
    assert.equal(before.status, 'pending');
    assert.equal(before.binding.arguments_hash, bindingHash(ready.args));
    assert.equal(a.listReviews(reviewer).length, 1);
    assert.throws(() => a.consumeReview(id, ready, agent), /not approved/);
    for (const principal of [agent, admin, other]) {
      assert.throws(() => a.resolveReview(id, 'approve', principal), /forbidden/);
      assert.throws(() => a.getReview(id, principal), /forbidden/);
    }
    const approved = approve(a, id);
    assert.equal(a.listReviews(reviewer).length, 0);
    assert.throws(() => a.resolveReview(id, 'deny', reviewer), /already resolved/);
    const state = store.transaction(tx => tx.contexts.get(canonical(before.context)));
    assert.equal(a.consumeReview(id, ready, agent).execution_authorized, true);
    assert.deepEqual(store.transaction(tx => tx.contexts.get(canonical(before.context))), state);
    assert.throws(() => a.consumeReview(id, ready, agent), /already consumed/);
    assert.throws(() => a.decide(signal(0), ready, before.evaluation_id), /already consumed/);
    const consumed = a.getReview(id, reviewer);
    assert.equal(consumed.status, 'consumed');
    assert.equal(consumed.resolved_at, approved.resolved_at);
    assert.equal(consumed.resolution, 'approve');
    const events = a.getEventsForRequest(before.request_id).filter(e => e.event_type.startsWith('review.'));
    assert.deepEqual(events.map(e => e.event_type), ['review.requested','review.approved','review.execution_authorized','review.execution_consumed']);
    for (const e of events) {
      assert.equal(e.schema_version, '2.0'); assert.equal(e.review_id, id);
      assert.equal(e.request_id, before.request_id); assert.equal(e.evaluation_id, before.evaluation_id);
      assert.equal(e.decision_id, before.decision_id); assert.equal(e.principal_id, agent.principal_id);
      assert.equal(e.reviewer_principal_id, e.event_type === 'review.requested' ? null : reviewer.principal_id);
    }
  });

  test(`${kind}: denial is terminal, independent and never revokes a capability`, t => {
    const { a } = setup(t, kind), id = pending(a);
    assert.equal(a.resolveReview(id, 'deny', reviewer).review.status, 'denied');
    assert.throws(() => a.resolveReview(id, 'approve', reviewer), /already resolved/);
    assert.throws(() => a.consumeReview(id, ready, agent), /not approved/);
    const another = pending(a); approve(a, another);
    assert.equal(a.consumeReview(another, ready, agent).execution_authorized, true);
    const denied = a.getReview(id, reviewer);
    assert.ok(a.getEventsForRequest(denied.request_id).some(e => e.event_type === 'review.denied'));
  });

  for (const [name, change] of Object.entries({ arguments: { args: { path: '/other' } }, tool: { tool: 'fs.read' },
    action: { action: 'other' }, target: { target: '/other' }, evidence: { diff: 'changed' }, lease: { lease_token: 'forged' } })) {
    test(`${kind}: changed ${name} invalidates only the bound approved request`, t => {
      const { a } = setup(t, kind), id = pending(a); approve(a, id);
      const result = a.consumeReview(id, { ...ready, ...change }, agent);
      assert.equal(result.execution_authorized, false); assert.equal(result.reason, 'REQUEST_BINDING_CHANGED');
      const record = a.getReview(id, reviewer);
      assert.equal(record.status, 'invalidated'); assert.equal(record.resolution, 'approve');
      assert.throws(() => a.consumeReview(id, ready, agent), /not approved/);
    });
  }

  for (const failure of ['expired','nonce_revoked','epoch_revoked','capability_revoked','authority_contracted']) {
    test(`${kind}: approval cannot bypass ${failure} or restore a revoked lease`, t => {
      const { a, advance } = setup(t, kind), { id, req, lease } = withLease(a); approve(a, id);
      if (failure === 'expired') advance();
      if (failure === 'nonce_revoked') a.revokeLeaseNonce(lease.lease_id);
      if (failure === 'epoch_revoked') a.revokeAllLeases();
      if (failure === 'capability_revoked') a.revoke(ready);
      if (failure === 'authority_contracted') a.decide(signal(2), req, 'contract');
      const result = a.consumeReview(id, req, agent);
      assert.equal(result.execution_authorized, false); assert.equal(result.reason, failure.toUpperCase());
      for (let i = 0; i < 6; i++) a.decide(signal(0), ready, `recover-${i}`);
      assert.throws(() => a.consumeReview(id, req, agent), /not approved/);
      const record = a.getReview(id, reviewer);
      assert.equal(record.resolution, 'approve'); assert.equal(record.status, 'invalidated');
    });
  }

  test(`${kind}: approval revalidates evidence, envelope, and already-revoked lease before becoming ready`, t => {
    const { a } = setup(t, kind);
    const missing = pending(a, request);
    assert.equal(a.resolveReview(missing, 'approve', reviewer).review.execution.reason, 'GATE_1_REQUIRES_DRY_RUN_AND_DIFF');
    const { id, lease } = withLease(a); a.revokeLeaseNonce(lease.lease_id);
    assert.equal(a.resolveReview(id, 'approve', reviewer).review.execution.reason, 'NONCE_REVOKED');
    const contracted = pending(a); a.decide(signal(2), ready, 'contract');
    assert.equal(a.resolveReview(contracted, 'approve', reviewer).review.execution.reason, 'AUTHORITY_CONTRACTED');
  });

  test(`${kind}: foreign agent/context and scoped reviewers cannot use or alter a review`, t => {
    const { a } = setup(t, kind), id = pending(a);
    const scoped = createAuthentication({ schema_version: '1.0', principals: [
      { principal_id: 'scoped', role: 'reviewer', token: tokens.reviewer, allowed_contexts: config.principals[1].allowed_contexts },
    ] }).authenticate(headers('reviewer').authorization);
    assert.deepEqual(a.listReviews(scoped), []);
    assert.throws(() => a.getReview(id, scoped), /forbidden/);
    assert.throws(() => a.resolveReview(id, 'approve', scoped), /forbidden/);
    approve(a, id);
    assert.throws(() => a.consumeReview(id, ready, other), /forbidden/);
    assert.throws(() => a.consumeReview(id, { ...ready, scene_id: 'other' }, agent), /forbidden/);
    assert.equal(a.getReview(id, reviewer).status, 'approved');
    assert.equal(a.consumeReview(id, ready, agent).execution_authorized, true);
  });

  test(`${kind}: audit failures roll back creation, resolution and consumption`, t => {
    const { a, store } = setup(t, kind);
    let fail = 'review.requested';
    const faulty = { bindPolicy: (...args) => store.bindPolicy(...args), contextCount: () => store.contextCount(), close() {},
      transaction: work => store.transaction(tx => {
        const append = tx.audit.append;
        tx.audit.append = e => { append(e); if (e.event_type === fail) throw Error('audit unavailable'); };
        return work(tx);
      }) };
    const b = new KingpinAuthority({ store: faulty, clock: () => now });
    assert.throws(() => pending(b), /audit unavailable/); assert.deepEqual(a.listReviews(reviewer), []);
    const id = pending(a); fail = 'review.approved';
    assert.throws(() => b.resolveReview(id, 'approve', reviewer), /audit unavailable/);
    assert.equal(a.getReview(id, reviewer).status, 'pending');
    approve(a, id); fail = 'review.execution_consumed';
    assert.throws(() => b.consumeReview(id, ready, agent), /audit unavailable/);
    assert.equal(a.getReview(id, reviewer).status, 'approved');
    assert.equal(a.consumeReview(id, ready, agent).execution_authorized, true);
  });

  test(`${kind}: credentials and raw payloads never enter review records or lifecycle audit`, t => {
    const { a } = setup(t, kind);
    const payload = Object.values(tokens).join(' ');
    const req = { ...ready, args: { secret: payload }, diff: payload, user_request: payload, action: payload, target: payload };
    const id = pending(a, req); approve(a, id); a.consumeReview(id, req, agent);
    const review = a.getReview(id, reviewer), serialized = JSON.stringify([review, a.getEventsForRequest(review.request_id)]);
    for (const token of Object.values(tokens)) assert.ok(!serialized.includes(token));
  });

  test(`${kind}: incompatible policy cannot reopen or consume bound governance state`, t => {
    const { a, store } = setup(t, kind), id = pending(a); approve(a, id);
    const policy = structuredClone(loadPolicy()); policy.tools.push({ id: 'new.tool', class: 'read_only' });
    assert.throws(() => new KingpinAuthority({ store, policy }), /policy/i);
    assert.equal(a.getReview(id, reviewer).status, 'approved');
  });
}

async function workers(t, input, commands) {
  const children = commands.map(() => fork(new URL('../tests/fixtures/review_process.mjs', import.meta.url), [], { stdio: ['ignore','ignore','ignore','ipc'] }));
  t.after(() => children.forEach(c => c.kill()));
  await Promise.all(children.map(c => new Promise((resolve, reject) => { c.once('message', resolve); c.once('error', reject); })));
  return Promise.all(children.map((c, i) => new Promise((resolve, reject) => {
    c.once('message', resolve); c.once('error', reject); c.send({ ...input, ...commands[i] });
  })));
}

test('SQLite: pending, approved, denied and consumed history survives separate process restarts', async t => {
  const { a, store, file } = setup(t, 'sqlite');
  const pendingId = pending(a), approved = pending(a), denied = pending(a);
  const input = { filename: file, config, now, principal: reviewer.principal_id }; store.close();
  assert.equal((await workers(t, input, [{ id: pendingId }]))[0].result.status, 'pending');
  for (const [id, resolution] of [[approved,'approve'],[denied,'deny']]) {
    assert.ok((await workers(t, input, [{ action: 'resolve', id, resolution }]))[0].result);
  }
  assert.equal((await workers(t, input, [{ id: approved }]))[0].result.status, 'approved');
  assert.equal((await workers(t, input, [{ id: denied }]))[0].result.status, 'denied');
  assert.equal((await workers(t, input, [{ action: 'consume', id: approved, request: ready, principal: agent.principal_id }]))[0].result.execution_authorized, true);
  assert.equal((await workers(t, input, [{ id: approved }]))[0].result.status, 'consumed');
});

test('SQLite: competing reviewers and concurrent replay have one durable winner', async t => {
  const { a, file } = setup(t, 'sqlite'), id = pending(a);
  const second = { principal_id: 'second-reviewer', role: 'reviewer', token: crypto.randomBytes(32).toString('base64url') };
  const input = { filename: file, config: { ...config, principals: [...config.principals, second] }, now, id, principal: reviewer.principal_id };
  const resolutions = await workers(t, input, [
    { action: 'resolve', resolution: 'approve' }, { action: 'resolve', resolution: 'deny', principal: second.principal_id },
  ]);
  assert.equal(resolutions.filter(r => r.result).length, 1);
  assert.equal(resolutions.filter(r => /already resolved/.test(r.error)).length, 1);
  const executable = pending(a); approve(a, executable);
  const results = await workers(t, { ...input, id: executable, request: ready, principal: agent.principal_id }, [
    { action: 'consume' }, { action: 'consume' },
  ]);
  assert.equal(results.filter(r => r.result?.execution_authorized).length, 1);
  assert.equal(results.filter(r => /already consumed/.test(r.error)).length, 1);
});

for (const action of ['nonce','epoch']) {
  test(`SQLite: approval racing ${action} revocation cannot yield executable stale approval`, async t => {
    const { a, file } = setup(t, 'sqlite'), { id, req, lease } = withLease(a);
    const input = { filename: file, config, now, id, principal: reviewer.principal_id };
    const results = await workers(t, input, [{ action: 'resolve', resolution: 'approve' }, { action, nonce: lease.lease_id }]);
    assert.ok(results.every(r => r.result));
    const review = a.getReview(id, reviewer);
    if (review.status === 'approved') assert.equal(a.consumeReview(id, req, agent).execution_authorized, false);
    else assert.equal(review.status, 'invalidated');
    assert.equal(a.getReview(id, reviewer).execution.reason, `${action === 'nonce' ? 'NONCE' : 'EPOCH'}_REVOKED`);
  });
}

function v3(file) {
  const db = new DatabaseSync(file);
  db.exec(fs.readFileSync(new URL('../kingpin/state/schema.sql', import.meta.url), 'utf8'));
  db.function('kingpin_lease_nonce', token => crypto.createHash('sha256').update(token).digest('hex'));
  for (const name of ['002_lease_revocation','003_governance_events']) db.exec(fs.readFileSync(new URL(`../kingpin/state/migrations/${name}.sql`, import.meta.url), 'utf8'));
  db.prepare('UPDATE store_metadata SET policy_fingerprint=?').run(bindingHash(loadPolicy()));
  const key = canonical({ session_id: 's', speaker_id: 'actor', channel_id: 'channel', scope_key: 'scene:scene' });
  db.prepare('INSERT INTO contexts VALUES (?,1,0,1)').run(key);
  db.prepare('INSERT INTO consumed_evaluations VALUES (?,?)').run(key, 'old-id');
  db.close();
}
test('SQLite v3 -> v4 preserves state and migration failure rolls back before retry', t => {
  const file = filename(t); v3(file);
  const exec = DatabaseSync.prototype.exec;
  const mock = t.mock.method(DatabaseSync.prototype, 'exec', function(sql) {
    const result = exec.call(this, sql);
    if (sql.includes('CREATE TABLE reviews')) throw Error('migration interrupted');
    return result;
  });
  assert.throws(() => new SQLiteStateStore({ filename: file }), /migration interrupted/); mock.mock.restore();
  const db = new DatabaseSync(file);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 3);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name='reviews'").get().n, 0); db.close();
  const store = new SQLiteStateStore({ filename: file }); t.after(() => store.close());
  const a = new KingpinAuthority({ store });
  assert.deepEqual(a.listReviews(reviewer), []);
  assert.throws(() => a.decide(signal(0), request, 'old-id'), /already consumed/);
  assert.ok(pending(a));
});

test('SQLite corrupted review state fails closed without resetting history', t => {
  const { a, store, file } = setup(t, 'sqlite'), id = pending(a); store.close();
  const db = new DatabaseSync(file);
  const trigger = db.prepare("SELECT sql FROM sqlite_schema WHERE name='guarded_review_transition'").get().sql;
  db.exec('DROP TRIGGER guarded_review_transition');
  db.prepare("UPDATE reviews SET record=json_set(record, '$.binding_hash', ?) WHERE review_id=?").run('0'.repeat(64), id);
  db.exec(trigger); db.close();
  assert.throws(() => new SQLiteStateStore({ filename: file }), /binding mismatch/);
});

test('gateway holds review, authenticates scoped resolution and delegates one-use execution', async () => {
  process.env.NODE_ENV = 'test';
  const { createGatewayApp } = await import('./server.js');
  const a = new KingpinAuthority();
  let evaluations = 0;
  const app = createGatewayApp({ authentication, authority: a, logDecision() {},
    evaluateTurn: async () => ({ governance_signal: signal(1, 'LOW_CONFIDENCE'), top_event: { event_id: `review-http-${++evaluations}` } }) });
  const body = { ...ready, plan_id: 'plan', user_request: 'List project files' };
  const response = await dispatch(app, '/tool', body);
  assert.equal(response.statusCode, 428);
  assert.equal(response.body.allow, false);
  assert.equal(response.body.authority_decision.outcome, 'human_review');
  const id = response.headers['X-Review-ID']; assert.ok(id);
  for (const role of ['agent','admin']) assert.equal((await dispatch(app, `/reviews/${id}/approve`, {}, headers(role))).statusCode, 403);
  assert.equal((await dispatch(app, `/reviews/${id}/approve`, {}, {})).statusCode, 401);
  const approved = await dispatch(app, `/reviews/${id}/approve`, { reviewer_principal_id: 'forged' }, headers('reviewer'));
  assert.equal(approved.body.review.reviewer_principal_id, reviewer.principal_id);
  const result = await dispatch(app, `/reviews/${id}/execute`, body);
  assert.equal(result.body.execution_authorized, true);
  assert.equal((await dispatch(app, `/reviews/${id}/execute`, body)).statusCode, 409);
  assert.equal(evaluations, 1);
});


test('real CDE low-confidence signal creates a held review and only bounded approval releases it', async () => {
  process.env.NODE_ENV = 'test';
  const { createGatewayApp } = await import('./server.js');
  const packets = ['You need to do it now immediately.', '.'].map((text, i) => ({
    turn_id: `real-review-${i}`, ts: now / 1000 + i, speaker_id: 'actor', channel_id: 'channel',
    scene_id: 'scene', task_id: null, session_id: 's', text,
  }));
  const python = pythonExecutable();
  const turns = JSON.parse(execFileSync(python, [new URL('../conformance/cde_bridge.py', import.meta.url).pathname],
    { input: JSON.stringify(packets), encoding: 'utf8' }));
  const a = new KingpinAuthority();
  a.decide(turns[0].governance_signal, ready, turns[0].top_event.event_id);
  const app = createGatewayApp({ authentication, authority: a, logDecision() {}, evaluateTurn: async () => turns[1] });
  const body = { ...ready, plan_id: 'real-review', user_request: '.' };
  const held = await dispatch(app, '/tool', body);
  assert.equal(held.statusCode, 428); assert.equal(held.body.allow, false);
  const id = held.headers['X-Review-ID'];
  assert.equal((await dispatch(app, '/reviews', {}, headers('reviewer'))).body.reviews.length, 1);
  assert.equal((await dispatch(app, `/reviews/${id}`, {}, headers('reviewer'))).body.status, 'pending');
  await dispatch(app, `/reviews/${id}/approve`, {}, headers('reviewer'));
  const released = await dispatch(app, `/reviews/${id}/execute`, body);
  assert.equal(released.statusCode, 200); assert.equal(released.body.allow, true);
});

test('gateway refuses when enforcement audit fails after consumption and cannot replay permission', async () => {
  process.env.NODE_ENV = 'test';
  const { createGatewayApp } = await import('./server.js');
  const a = new KingpinAuthority(), id = pending(a); approve(a, id);
  a.recordEnforcement = () => { throw Error('storage unavailable'); };
  const app = createGatewayApp({ authentication, authority: a, logDecision() {} });
  const response = await dispatch(app, `/reviews/${id}/execute`, ready);
  assert.equal(response.statusCode, 409); assert.notEqual(response.body.allow, true);
  assert.equal(a.getReview(id, reviewer).status, 'consumed');
  assert.equal((await dispatch(app, `/reviews/${id}/execute`, ready)).statusCode, 409);
});
