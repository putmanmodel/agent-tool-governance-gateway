import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createAuthentication, loadAuthentication } from '../kingpin/auth/access.js';
import { KingpinAuthority } from '../kingpin/index.js';
import { SQLiteStateStore } from '../kingpin/state/sqlite.js';
import { request, signal } from '../tests/fixtures/authority_cases.mjs';
import { authentication, config, tokens, headers, dispatch } from '../tests/fixtures/auth.mjs';
process.env.NODE_ENV = 'test';
const { createGatewayApp } = await import('./server.js');
const body = { ...request, plan_id: 'plan', user_request: 'list files' };
const turn = { governance_signal: signal(0), top_event: { event_id: 'cde-event' }, events: [] };
const temporary = t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kingpin-auth-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir;
};

for (const route of ['/turn', '/tool', '/lease', '/revoke', '/revoke/nonce', '/revoke/all', '/review/access']) {
  test(`${route}: absent, invalid and payload-only credentials fail before collaborators run`, async () => {
    const authority = new Proxy({}, { get() { assert.fail('unauthenticated state access'); } });
    const app = createGatewayApp({ authentication, authority,
      evaluateTurn() { assert.fail('unauthenticated CDE access'); }, logDecision() { assert.fail('credential logging'); } });
    for (const credentialHeaders of [{}, { authorization: 'Bearer invalid' }, { authorization: `Bearer ${'x'.repeat(43)}` },
      { authorization: [headers().authorization] }]) {
      const response = await dispatch(app, route, { ...body, token: tokens.admin, authorization: headers('admin').authorization,
        principal_id: 'admin-principal', role: 'authority_admin', permissions: ['authority.revoke_all'] }, credentialHeaders);
      assert.equal(response.statusCode, 401);
      assert.deepEqual(response.body, { error: 'Authentication required' });
    }
  });
}

test('authenticated agents evaluate observations/tools and can present an existing lease', async () => {
  const authority = new KingpinAuthority(); let next = 0;
  const app = createGatewayApp({ authentication, authority,
    evaluateTurn: async () => ({ ...turn, top_event: { event_id: `cde-${++next}` } }), logDecision() {} });
  assert.equal((await dispatch(app, '/turn', body)).statusCode, 200);
  assert.equal((await dispatch(app, '/tool', body)).statusCode, 200);
  const destructive = { ...body, tool: 'fs.delete' };
  assert.equal((await dispatch(app, '/tool', destructive)).statusCode, 403);
  const lease = await dispatch(app, '/lease', { ...destructive, seconds: 60 }, headers('admin'));
  assert.equal(lease.statusCode, 200);
  assert.equal((await dispatch(app, '/tool', { ...destructive, ...lease.body })).statusCode, 200);
  const otherBody = { ...body, speaker_id: 'other', agent_id: 'other', session_id: 'other' };
  assert.equal((await dispatch(app, '/tool', otherBody, headers('other'))).statusCode, 200);
  const stolen = await dispatch(app, '/tool', { ...otherBody, tool: 'fs.delete', lease_token: lease.body.lease_token }, headers('other'));
  assert.equal(stolen.statusCode, 403);
  assert.equal(stolen.body.reason, 'gate_2_requires_valid_lease');
});

test('agent and reviewer cannot issue leases or perform any revocation', async () => {
  const app = createGatewayApp({ authentication, authority: new Proxy({}, { get() { assert.fail('unauthorized authority call'); } }) });
  for (const role of ['agent', 'other', 'reviewer']) {
    for (const route of ['/lease', '/revoke', '/revoke/nonce', '/revoke/all']) {
      assert.equal((await dispatch(app, route, body, headers(role))).statusCode, 403);
    }
  }
});

test('ownership rejects another agent, channel, session, scene and shadowed task before CDE/state access', async () => {
  let calls = 0;
  const app = createGatewayApp({ authentication, evaluateTurn: async () => { calls++; return turn; }, logDecision() {} });
  for (const change of [{ agent_id: 'other' }, { speaker_id: 'other' }, { session_id: 'other' },
    { channel_id: 'elsewhere' }, { scene_id: 'elsewhere' }, { task_id: 'shadowed-by-scene' }, { agent_id: null }]) {
    for (const route of ['/tool', '/turn']) assert.equal((await dispatch(app, route, { ...body, ...change })).statusCode, 403);
  }
  assert.equal(calls, 0);
  assert.equal((await dispatch(app, '/tool', { ...body, agent_id: 'actor', role: 'authority_admin', principal_id: 'forged' })).statusCode, 200);
  assert.equal(calls, 1);
});

test('authenticated admin delegates individual nonce, legacy capability and global revocation to Kingpin', async () => {
  const authority = new KingpinAuthority(); let next = 0;
  const app = createGatewayApp({ authentication, authority,
    evaluateTurn: async () => ({ ...turn, top_event: { event_id: `id-${++next}` } }), logDecision() {} });
  const destructive = { ...body, tool: 'fs.delete', seconds: 60 };
  await dispatch(app, '/tool', destructive);
  const one = (await dispatch(app, '/lease', destructive, headers('admin'))).body;
  const two = (await dispatch(app, '/lease', destructive, headers('admin'))).body;
  assert.equal((await dispatch(app, '/revoke/nonce', { lease_nonce: one.lease_id }, headers('admin'))).statusCode, 200);
  assert.equal(authority.validateLease({ ...destructive, lease_token: one.lease_token }).reason, 'nonce_revoked');
  assert.equal(authority.validateLease({ ...destructive, lease_token: two.lease_token }).reason, 'ok');
  assert.equal((await dispatch(app, '/revoke/all', {}, headers('admin'))).body.lease_epoch, 1);
  assert.equal(authority.validateLease({ ...destructive, lease_token: two.lease_token }).reason, 'epoch_revoked');
  assert.equal((await dispatch(app, '/revoke', destructive, headers('admin'))).statusCode, 200);
  assert.equal((await dispatch(app, '/tool', destructive)).body.reason, 'capability_revoked');
});

test('reviewer boundary is separate from admin and cannot resolve or bypass HUMAN REVIEW', async () => {
  const app = createGatewayApp({ authentication,
    evaluateTurn: async () => ({ ...turn, governance_signal: signal(1, 'LOW_CONFIDENCE') }), logDecision() {} });
  const status = await dispatch(app, '/review/access', undefined, headers('reviewer'));
  assert.deepEqual(status.body, { principal_id: 'reviewer-principal', role: 'reviewer', resolution_supported: false });
  for (const role of ['agent', 'admin']) assert.equal((await dispatch(app, '/review/access', {}, headers(role))).statusCode, 403);
  for (const role of ['admin', 'reviewer']) assert.equal((await dispatch(app, '/tool', body, headers(role))).statusCode, 403);
  assert.equal((await dispatch(app, '/tool', { ...body, dry_run: true, diff: 'diff', approved: true })).statusCode, 428);
  for (const role of ['agent', 'admin', 'reviewer']) assert.equal((await dispatch(app, '/review/resolve', { approved: true }, headers(role))).statusCode, 404);
});

test('failed authentication/authorization never evaluates CDE or consumes an evaluation ID', async () => {
  const authority = new KingpinAuthority(); let evaluations = 0;
  const app = createGatewayApp({ authentication, authority, evaluateTurn: async () => { evaluations++; return turn; }, logDecision() {} });
  await dispatch(app, '/tool', body, {});
  await dispatch(app, '/tool', { ...body, session_id: 'other' });
  assert.equal(evaluations, 0); assert.equal(authority.states.size, 0);
  assert.equal((await dispatch(app, '/tool', body)).statusCode, 200);
  assert.equal(evaluations, 1);
  assert.equal((await dispatch(app, '/tool', body)).statusCode, 502); // now the ID really is consumed
});

test('normal audit records contain trusted principal IDs and no raw configured credential', async () => {
  const logs = [];
  const app = createGatewayApp({ authentication, evaluateTurn: async () => turn, logDecision: value => logs.push(value) });
  // Include accidental credential reflection in user data as well as the real header.
  assert.equal((await dispatch(app, '/tool', { ...body, user_request: tokens.agent, args: { note: tokens.admin },
    principal_id: tokens.reviewer })).statusCode, 200);
  const encoded = JSON.stringify(logs);
  for (const token of Object.values(tokens)) assert.equal(encoded.includes(token), false);
  assert.equal(logs[0].principal_id, 'agent-principal');
  assert.equal(logs[0].user_request, '[REDACTED]');
});

test('malformed auth config, unsafe session sharing and forged principals fail closed', () => {
  for (const mutate of [c => { c.schema_version = '2.0'; }, c => { c.principals[0].role = 'owner'; },
    c => { c.principals[0].permissions = ['authority.issue_lease']; }, c => { c.principals[1].token = c.principals[0].token; },
    c => { c.principals[1].allowed_contexts[0].session_id = 's'; }, c => { c.principals[0].allowed_contexts = []; }]) {
    const copy = structuredClone(config); mutate(copy);
    assert.throws(() => createAuthentication(copy), /Invalid authentication configuration/);
  }
  const principal = authentication.authenticate(headers().authorization);
  assert.throws(() => authentication.authorize({ ...principal, role: 'authority_admin' }, 'authority.issue_lease'), /Forbidden/);
  assert.throws(() => { principal.permissions.push('authority.issue_lease'); }, TypeError);
  assert.throws(() => loadAuthentication('/nonexistent/auth-config.json'), /Unable to load/);
  assert.throws(() => loadAuthentication(''), /required/);
});

test('credential reload after process restart preserves permissions and SQLite governance state without storing tokens', async t => {
  const dir = temporary(t), filename = path.join(dir, 'state.sqlite'), authFile = path.join(dir, 'auth.json');
  fs.writeFileSync(authFile, JSON.stringify(config), { mode: 0o600 });
  const store = new SQLiteStateStore({ filename, create: true });
  const authority = new KingpinAuthority({ store });
  const app = createGatewayApp({ authentication: loadAuthentication(authFile), authority, evaluateTurn: async () => turn, logDecision() {} });
  await dispatch(app, '/tool', body);
  const lease = (await dispatch(app, '/lease', { ...body, seconds: 60 }, headers('admin'))).body;
  await dispatch(app, '/revoke/nonce', { lease_nonce: lease.lease_id }, headers('admin'));
  await dispatch(app, '/revoke/all', {}, headers('admin')); store.close();
  // A separate process loads the same auth file; no token is passed in argv or stdout.
  const child = `import { loadAuthentication } from './kingpin/auth/access.js';
    import { KingpinAuthority } from './kingpin/index.js';
    import { SQLiteStateStore } from './kingpin/state/sqlite.js';
    import fs from 'node:fs';
    const c=JSON.parse(fs.readFileSync(process.env.KINGPIN_AUTH_FILE));
    const auth=loadAuthentication();
    const principals=c.principals.map(p=>auth.authenticate('Bearer '+p.token));
    const store=new SQLiteStateStore({filename:process.env.TEST_DB}); const a=new KingpinAuthority({store});
    const request=JSON.parse(process.env.TEST_REQUEST);
    let replay; try { a.decide(JSON.parse(process.env.TEST_SIGNAL),request,'cde-event'); } catch { replay=true; }
    console.log(JSON.stringify({principals, replay, lease:a.validateLease(request)}));store.close();`;
  const output = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', child], {
    cwd: path.resolve(import.meta.dirname, '..'), encoding: 'utf8', env: { ...process.env, KINGPIN_AUTH_FILE: authFile,
      TEST_DB: filename, TEST_REQUEST: JSON.stringify({ ...request, lease_token: lease.lease_token }), TEST_SIGNAL: JSON.stringify(signal(0)) },
  }));
  assert.equal(output.replay, true); assert.equal(output.lease.reason, 'epoch_revoked');
  for (const entry of config.principals) assert.deepEqual(output.principals.find(p => p.principal_id === entry.principal_id),
    authentication.authenticate(`Bearer ${entry.token}`));
  const dbBytes = fs.readFileSync(filename);
  for (const token of Object.values(tokens)) assert.equal(dbBytes.includes(Buffer.from(token)), false);
});

test('auth resolver and authority failures do not fall through or leak sensitive errors', async () => {
  const resolver = { authenticate() { throw new Error(tokens.admin); } };
  const app = createGatewayApp({ authentication: resolver, evaluateTurn() { assert.fail('not authenticated'); } });
  assert.equal((await dispatch(app, '/tool', body)).statusCode, 401);
  const broken = createGatewayApp({ authentication, authority: { issue() { throw new Error(tokens.admin); } } });
  const result = await dispatch(broken, '/lease', body, headers('admin'));
  assert.equal(result.statusCode, 400); assert.equal(JSON.stringify(result.body).includes(tokens.admin), false);
});
