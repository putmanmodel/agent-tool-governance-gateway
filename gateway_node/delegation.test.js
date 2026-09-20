import { authentication, headers } from "../tests/fixtures/auth.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import { request, signal } from '../tests/fixtures/authority_cases.mjs';
import { KingpinAuthority } from '../kingpin/index.js';

process.env.NODE_ENV = 'test';
const { createGatewayApp } = await import('./server.js');

// Exercise the actual registered Express route, including its serialization and
// response projection, without opening a socket. HTTP transport is covered by demo.js.
async function post(app, path, body) {
  const route = app._router.stack.find(layer => layer.route?.path === path).route;
  const response = { statusCode: 200, headersSent: false,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; this.headersSent = true; return this; } };
  await route.stack[0].handle({ body, headers: headers(path === '/lease' || path === '/revoke' ? 'admin' : 'agent') }, response);
  return response;
}
const body = { ...request, tool: 'fs.delete', plan_id: 'plan', user_request: 'simulate delete',
  evaluation_id: 'untrusted-client-id' };
const turn = { governance_signal: signal(2), top_event: { event_id: 'trusted-cde-id' }, events: [] };
const template = new KingpinAuthority().decide(signal(0), request, 'template');

test('gateway delegates once with original request, CDE signal and trusted event ID, then projects each outcome', async () => {
  for (const [outcome, status] of Object.entries({ allow: 200, constrain: 409, deny: 403, quarantine: 423, human_review: 428 })) {
    const calls = [], logs = [], enforcementCalls = [];
    // Deliberately disagree with local tool-floor/CDE policy: transport must obey
    // its authority collaborator, not independently recompute that policy.
    const decision = { ...template, outcome, reason: 'authority-owned-reason' };
    const app = createGatewayApp({ authentication,
      authority: { recordEnforcement(...args) { enforcementCalls.push(args); }, decide(...args) { calls.push(args); return decision; } },
      evaluateTurn: async () => turn,
      logDecision: record => logs.push(record),
    });
    const response = await post(app, '/tool', body);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], turn.governance_signal);
    assert.equal(calls[0][1], body);
    assert.equal(calls[0][2], 'trusted-cde-id');
    assert.equal(response.statusCode, status);
    assert.equal(response.body.authority_decision, decision);
    assert.equal(response.body.reason, decision.reason);
    assert.equal(response.body.allow, outcome === 'allow');
    assert.equal(response.body.blocked, outcome !== 'allow');
    assert.equal(response.body.effective_gate, decision.effective_gate);
    assert.equal(enforcementCalls.length, 1);
    assert.equal(enforcementCalls[0][0], body);
    assert.equal(enforcementCalls[0][1].principal_id, 'agent-principal');
    assert.equal(enforcementCalls[0][2].outcome, outcome);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].authority_decision, decision);
  }
});

test('gateway preserves HUMAN REVIEW returned by the extracted runtime', async () => {
  const review = { ...turn, governance_signal: signal(1, 'LOW_CONFIDENCE') };
  const app = createGatewayApp({ authentication, evaluateTurn: async () => review, logDecision() {} });
  const response = await post(app, '/tool', { ...body, tool: 'fs.list', dry_run: true, diff: 'diff' });
  assert.equal(response.statusCode, 428);
  assert.equal(response.body.authority_decision.outcome, 'human_review');
  assert.deepEqual(response.body.missing_evidence, []);
});

test('gateway fails closed on authority errors and does not fall back to CDE gate', async () => {
  const app = createGatewayApp({ authentication,
    authority: { decide() { throw new Error('CDE evaluation already consumed'); } },
    evaluateTurn: async () => ({ ...turn, governance_signal: signal(0) }),
    logDecision() { assert.fail('failed authority determination must not log a success'); },
  });
  const response = await post(app, '/tool', body);
  assert.equal(response.statusCode, 502);
  assert.deepEqual(response.body, { error: 'Authority operation failed' });
});

test('lease and revoke routes delegate unchanged bodies and responses to Kingpin', async () => {
  const calls = [];
  const lease = { issuer: 'kingpin', lease_id: 'id', lease_token: 'token', context: {}, expires_at: 'expiry' };
  const revocation = { revoked: true, context: {}, target: { tool: body.tool }, capability_envelope: {} };
  const app = createGatewayApp({ authentication, authority: {
    issue(value) { calls.push(['issue', value]); return lease; },
    revoke(value) { calls.push(['revoke', value]); return revocation; },
  }, logDecision() {} });
  assert.equal((await post(app, '/lease', body)).body, lease);
  assert.equal((await post(app, '/revoke', body)).body, revocation);
  assert.deepEqual(calls, [['issue', body], ['revoke', body]]);
});

test('evaluation-only turn route never invokes Kingpin', async () => {
  const app = createGatewayApp({ authentication, authority: { decide() { assert.fail('evaluation is not authority'); } },
    evaluateTurn: async value => { assert.equal(value, body); return turn; }, logDecision() {} });
  assert.equal((await post(app, '/turn', body)).body, turn);
});
