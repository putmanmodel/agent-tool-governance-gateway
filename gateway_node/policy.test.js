import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KingpinAuthority, loadPolicy, validatePolicy } from '../kingpin/index.js';
import { request, signal, captureDecisions } from '../tests/fixtures/authority_cases.mjs';

const mutableDefault = () => structuredClone(loadPolicy());
const baseline = JSON.parse(fs.readFileSync(new URL('../tests/fixtures/pre_extraction_authority.json', import.meta.url)));

test('explicit bundled policy reproduces all frozen v0.3 decisions exactly', () => {
  class ConfiguredAuthority extends KingpinAuthority {
    constructor(options) { super({ ...options, policy: loadPolicy() }); }
  }
  assert.deepEqual(captureDecisions(ConfiguredAuthority), baseline);
});

test('evaluator adds tools using a local JSON file, including floors and envelope restrictions', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kingpin-policy-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const policy = mutableDefault();
  policy.policy_version = 'evaluation_1';
  policy.tools = [
    { id: 'records.fetch', class: 'read_only' },
    { id: 'records.update', class: 'write' },
    { id: 'records.purge', class: 'destructive' },
  ];
  const file = path.join(directory, 'policy.json');
  fs.writeFileSync(file, JSON.stringify(policy));
  const a = new KingpinAuthority({ policy: loadPolicy(file) });
  let id = 0;
  const decide = (tool, gate = 0, extra = {}) => a.decide(signal(gate), { ...request, tool, ...extra }, `new-${++id}`);
  assert.equal(decide('records.fetch').outcome, 'allow');
  assert.equal(decide('records.update').outcome, 'constrain');
  assert.equal(decide('records.update', 0, { dry_run: true, diff: 'diff' }).outcome, 'allow');
  assert.equal(decide('records.purge').outcome, 'deny');
  const lease = a.issue({ ...request, tool: 'records.purge', seconds: 60 });
  assert.equal(decide('records.purge', 0, lease).outcome, 'allow');
  assert.deepEqual(decide('records.fetch', 1).capability_envelope.tools, ['records.fetch', 'records.update']);
  assert.throws(() => a.issue({ ...request, tool: 'records.purge', seconds: 60 }), /current envelope/);
  assert.deepEqual(decide('records.fetch', 2).capability_envelope.tools, ['records.fetch']);
  a.revoke({ ...request, tool: 'records.fetch' });
  assert.equal(decide('records.fetch', 2).reason, 'capability_revoked');
});

test('agent-supplied class, floor, requirements and policy cannot downgrade trusted tools', () => {
  const a = new KingpinAuthority();
  const attacker = { class: 'read_only', criticality: 0, minimum_authority_floor: 0,
    tool_floor_gate: 0, evidence_requirements: [], authority_requirement: 'none',
    lease: false, policy: { tools: [{ id: 'fs.delete', class: 'read_only' }] } };
  const destructive = a.decide(signal(0), { ...request, ...attacker, tool: 'fs.delete' }, 'delete');
  assert.equal(destructive.tool_floor_gate, 2);
  assert.equal(destructive.authority_requirement, 'lease');
  assert.equal(destructive.outcome, 'deny');
  const write = a.decide(signal(0), { ...request, ...attacker, tool: 'fs.write' }, 'write');
  assert.equal(write.outcome, 'constrain');
  assert.deepEqual(write.missing_evidence, ['dry_run', 'diff']);
});

test('malformed, inconsistent and unsupported policy fails before a runtime is created', () => {
  const changes = [
    p => { p.schema_version = '2.0'; }, p => { p.policy_version = ''; },
    p => { delete p.tools; }, p => { p.tools = {}; },
    p => { p.tools.push({ ...p.tools[0] }); },
    p => { p.tools[0].class = 'unknown'; }, p => { p.tools[0].id = ' '; },
    p => { p.tools[0].script = 'return true'; },
    p => { p.classes.destructive.minimum_authority_floor = 0; },
    p => { p.classes.read_only.allowed_envelopes.push('quarantined'); },
    p => { p.gate_requirements[1].evidence = []; },
    p => { p.gate_requirements[2].lease = false; },
    p => { p.gate_requirements[0].lease = 'false'; },
    p => { p.extra = true; },
  ];
  for (const change of changes) {
    const policy = mutableDefault(); change(policy);
    assert.throws(() => validatePolicy(policy), /Invalid Kingpin policy/);
    assert.throws(() => new KingpinAuthority({ policy }), /Invalid Kingpin policy/);
  }
  for (const policy of [null, [], {}, 'policy']) {
    assert.throws(() => new KingpinAuthority({ policy }), /Invalid Kingpin policy/);
  }
});

test('policy read and JSON parse errors never fall back to defaults', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kingpin-policy-invalid-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  assert.throws(() => loadPolicy(path.join(directory, 'missing.json')), /ENOENT/);
  const file = path.join(directory, 'bad.json');
  fs.writeFileSync(file, '{');
  assert.throws(() => loadPolicy(file), SyntaxError);
  fs.writeFileSync(file, '{}');
  assert.throws(() => loadPolicy(file), /Invalid Kingpin policy/);
});

test('unknown tools deterministically deny, cannot acquire leases, and never inherit prototype names', () => {
  for (const tool of ['unknown', '__proto__', 'constructor', 'toString']) {
    for (const gate of [0, 1, 2]) {
      const left = new KingpinAuthority(), right = new KingpinAuthority();
      const req = { ...request, tool, class: 'read_only', dry_run: true, diff: 'diff' };
      const result = left.decide(signal(gate), req, 'unknown');
      assert.deepEqual(result, right.decide(signal(gate), req, 'unknown'));
      assert.equal(result.outcome, 'deny');
      assert.equal(result.reason, 'outside_capability_envelope');
      assert.equal(result.tool_floor_gate, 0); // frozen compatibility projection, not a classification
      assert.throws(() => left.issue({ ...req, seconds: 60 }), /current envelope/);
      assert.throws(() => left.revoke(req), /known tool/);
    }
  }
  const a = new KingpinAuthority();
  assert.equal(a.decide(signal(2, 'QUARANTINE_THRESHOLD_REACHED'), { ...request, tool: 'unknown' }, 'q').outcome, 'quarantine');
});

test('configuration is copied and immutable; modifying decisions cannot weaken future evidence', () => {
  const policy = mutableDefault();
  const a = new KingpinAuthority({ policy });
  policy.tools.find(tool => tool.id === 'fs.delete').class = 'read_only';
  policy.gate_requirements[1].evidence.length = 0;
  assert.equal(a.decide(signal(0), { ...request, tool: 'fs.delete' }, 'immutable').outcome, 'deny');
  const first = a.decide(signal(1), request, 'evidence-1');
  first.evidence_requirements.length = 0;
  assert.deepEqual(a.decide(signal(1), request, 'evidence-2').missing_evidence, ['dry_run', 'diff']);
  const loaded = loadPolicy();
  assert.throws(() => { loaded.tools[0].class = 'destructive'; }, TypeError);
});

test('configuration version is available for audit without changing the frozen decision schema', () => {
  const policy = mutableDefault(); policy.policy_version = 'evaluator_v2';
  const a = new KingpinAuthority({ policy });
  policy.policy_version = 'changed-after-construction';
  assert.deepEqual(a.policyContext, { schema_version: '1.0', policy_version: 'evaluator_v2' });
  assert.throws(() => { a.policyContext.policy_version = 'spoofed'; }, TypeError);
  const actual = a.decide(signal(0), request, 'version');
  const expected = new KingpinAuthority().decide(signal(0), request, 'version');
  assert.deepEqual(actual, expected);
  assert.equal(actual.policy_version, 'demo_v1');
});
