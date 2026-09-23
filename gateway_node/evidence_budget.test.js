import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { pythonExecutable } from '../conformance/runtime.mjs';
import { KingpinAuthority } from '../kingpin/index.js';
import { createGatewayApp } from './server.js';
import { authentication, dispatch } from '../tests/fixtures/auth.mjs';
import { request } from '../tests/fixtures/authority_cases.mjs';

test('large real CDE observation is bounded and remains quarantined through Kingpin/gateway', async () => {
  const text = '!!! '.repeat(62500);
  const packet = { turn_id: 'budget', ts: 1, speaker_id: 'actor', channel_id: 'channel', scene_id: 'scene', text };
  const turn = JSON.parse(execFileSync(pythonExecutable(), ['../cde_cli.py'], {
    cwd: new URL('.', import.meta.url), input: JSON.stringify(packet), encoding: 'utf8', maxBuffer: 300000,
  }));
  let invoked = false;
  const app = createGatewayApp({ authentication, authority: new KingpinAuthority(),
    evaluateTurn: async () => turn, adapter: async () => { invoked = true; }, logDecision() {} });
  const result = await dispatch(app, '/tool', { ...request, plan_id: 'budget', user_request: text });
  assert.equal(result.statusCode, 423);
  assert.equal(result.body.allow, false);
  assert.equal(invoked, false);
  assert.equal(result.body.top_event.evidence_budget.observed, 62500);
  assert.equal(result.body.top_event.evidence_budget.omitted, 62372);
  assert.equal(result.body.evidence_spans.length, 128);
  assert.ok(Buffer.byteLength(JSON.stringify(result.body)) < 500000);
});
