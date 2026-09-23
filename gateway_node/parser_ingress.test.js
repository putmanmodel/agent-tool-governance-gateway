import test from 'node:test';
import assert from 'node:assert/strict';
import { createGatewayApp } from './server.js';
import { KingpinAuthority } from '../kingpin/index.js';
import { authentication, headers } from '../tests/fixtures/auth.mjs';

test('real JSON parser failures correlate every governed route and accepted variant only', async t => {
  const authority = new KingpinAuthority(); let evaluations = 0, executions = 0, decisions = 0;
  const original = authority.decide.bind(authority);
  authority.decide = (...args) => { decisions++; return original(...args); };
  const app = createGatewayApp({ authentication, authority, mode:'evaluation', build:{}, logDecision(){},
    adapter:{execute(){executions++;}}, execution:{run(){executions++;}}, evaluateTurn(){evaluations++;} });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  for (const route of ['/tool','/tool/observed','/TOOL','/TOOL/OBSERVED','/Tool/Observed/','/tool/?probe=1']) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, {
      method:'POST', headers:{...headers(),'content-type':'application/json'}, body:'{"broken":' });
    assert.equal(response.status, 400, route); await response.text();
    const id = response.headers.get('x-request-id'); assert.ok(id, route);
    const events = authority.getEventsForRequest(id);
    assert.deepEqual(events.map(e => e.event_type), ['tool.enforcement.failed']);
    assert.deepEqual(events[0].reason_codes, ['INVALID_REQUEST']);
    assert.equal(events[0].principal_id, 'agent-principal');
  }
  for (const route of ['/unrelated','/status','/toolish']) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, {
      method:'POST', headers:{...headers(),'content-type':'application/json'}, body:'{"broken":' });
    assert.equal(response.status, 400); assert.equal(response.headers.get('x-request-id'), null); await response.text();
  }
  assert.equal(evaluations, 0); assert.equal(decisions, 0); assert.equal(executions, 0);
});
