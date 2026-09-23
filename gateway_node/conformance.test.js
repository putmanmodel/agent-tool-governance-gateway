import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../conformance/runtime.mjs';
import { cases, registry, runCase, runSuite, validateCase } from '../conformance/runner.mjs';
import { KEYS, DECISIONS, canonicalDecision, serializeRecord, appendRecord, token } from '../conformance/emitter.mjs';

const firstRun = runSuite();
const byId = id => firstRun.find(result => result.record.demo_id === id);
const normal = firstRun[0].record;
const expectedKeys = ['decision','demo_id','evidence','fixture_hash','fixture_path','mode','normative_ids','pass','rationale','timestamp_utc'];

test('all real conformance scenarios emit exactly the Paper 9 keys and registered bindings', () => {
  assert.equal(firstRun.length, 11);
  assert.deepEqual(KEYS, expectedKeys);
  for (const { record } of firstRun) {
    assert.deepEqual(Object.keys(record).sort(), [...expectedKeys].sort());
    assert.equal(record.pass, true, record.rationale);
    assert.ok(DECISIONS.includes(record.decision));
    assert.ok(record.normative_ids.every(id => registry.some(rule => rule.id === id)));
    assert.ok(['proof','break'].includes(record.mode));
    assert.equal(serializeRecord(record, registry).split('\n').length, 2);
  }
  const specification = JSON.parse(readFileSync(path.join(ROOT, 'tests/fixtures/paper9_contract.json')));
  assert.deepEqual(KEYS, specification.exact_keys);
  assert.deepEqual(DECISIONS, specification.canonical_decisions);
});

test('canonical emitter rejects every missing key and extra product fields', () => {
  for (const key of KEYS) {
    const incomplete = { ...normal }; delete incomplete[key];
    assert.throws(() => serializeRecord(incomplete, registry), /exactly ten keys/);
  }
  for (const key of ['event_id','request_id','schema_version','principal_id','arbitrary_product_field'])
    assert.throws(() => serializeRecord({ ...normal, [key]: 'extra' }, registry), /exactly ten keys/);
});

test('canonical vocabulary and runtime mapping are explicit; unmapped outcomes fail', () => {
  for (const value of ['allow','human_review','constrain','HTTP_200','APPROVED'])
    assert.throws(() => serializeRecord({ ...normal, decision: value }, registry), /decision/);
  assert.equal(canonicalDecision('allow'), 'ALLOW');
  assert.equal(canonicalDecision('human_review'), 'REVIEW');
  assert.equal(canonicalDecision('deny'), 'DENY');
  assert.equal(canonicalDecision('quarantine'), 'QUARANTINE');
  for (const outcome of ['constrain','unknown','toString']) assert.throws(() => canonicalDecision(outcome), /no canonical mapping/);
});

test('unregistered normative IDs and unsafe fixture references are rejected before execution', () => {
  assert.throws(() => validateCase({ ...cases[0], normative_ids: ['N999'] }), /Unregistered/);
  assert.throws(() => serializeRecord({ ...normal, normative_ids: ['N999'] }, registry), /Unregistered/);
  assert.throws(() => validateCase({ ...cases[0], fixture_path: '../secret.json' }), /Fixture/);
});

test('each fixture hash covers the exact designated bytes', () => {
  for (const { record } of firstRun) {
    const bytes = readFileSync(path.join(ROOT, record.fixture_path));
    const hash = `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
    assert.equal(record.fixture_hash, hash);
    assert.notEqual(record.fixture_hash, `sha256:${crypto.createHash('sha256').update(JSON.stringify(JSON.parse(bytes))).digest('hex')}`);
  }
});

test('proof ALLOW and expected break DENY both pass conformance', () => {
  const proof = byId('proof_non_destructive_allow').record;
  const breaking = byId('break_destructive_without_lease').record;
  assert.equal(proof.mode, 'proof'); assert.equal(proof.decision, 'ALLOW'); assert.equal(proof.pass, true);
  assert.equal(breaking.mode, 'break'); assert.equal(breaking.decision, 'DENY'); assert.equal(breaking.pass, true);
});

test('a real denied runtime result fails an intentionally unmet proof assertion', () => {
  const result = runCase({ ...cases[0], demo_id: 'detector_denial', fixture_path: 'conformance/fixtures/detector_denial.json' });
  assert.equal(result.record.decision, 'DENY'); assert.equal(result.record.pass, false);
  assert.equal(result.observed.selected.decision.outcome, 'deny');
  assert.match(result.record.rationale, /expected="allow" observed="deny" FAIL/);
  assert.equal(JSON.parse(serializeRecord(result.record, registry)).pass, false);
});

for (const [demo, reason] of [['break_nonce_revoked','nonce_revoked'], ['break_epoch_revoked','epoch_revoked'], ['break_out_of_scope','out_of_scope']]) {
  test(`${demo}: actual lease rejection is a passing break`, () => {
    const { record, observed } = byId(demo);
    assert.equal(record.pass, true); assert.equal(record.decision, 'DENY');
    assert.equal(observed.selected.lease_check, reason);
    assert.ok(record.evidence.includes(token('lease_check', reason)));
    assert.ok(record.evidence.includes(token('valid_contract', false)));
  });
}

test('HUMAN REVIEW conformance requires withholding, without fake resolution', () => {
  const { record, observed, assessment } = byId('break_human_review_no_execution');
  assert.equal(record.decision, 'REVIEW'); assert.equal(record.pass, true);
  assert.equal(observed.selected.enforcement.response.allow, false);
  assert.ok(assessment.checks.some(c => c.name === 'withheld' && c.actual === false));
  assert.ok(observed.selected.audit.some(event => event.event_type === 'tool.enforcement.review'));
  assert.ok(!observed.selected.audit.some(event => /^review\.(approved|denied)$/.test(event.event_type)));
});

test('canonical output remains isolated from arbitrary product event extensions', () => {
  for (const result of firstRun) {
    const before = serializeRecord(result.record, registry);
    for (const event of result.observed.observations.flatMap(o => o.audit)) {
      assert.ok(event.schema_version && event.event_id);
      Object.assign(event, { arbitrary_product_field: { nested: ['extra'] }, fixture_hash: 'product', decision: 'product' });
    }
    assert.equal(serializeRecord(result.record, registry), before);
    assert.ok(!before.includes('arbitrary_product_field'));
  }
});

test('runner does not write either operational JSONL file', () => {
  const paths = ['logs/cde_audit.jsonl','logs/gateway_decisions.jsonl'].map(file => path.join(ROOT, file));
  const snapshot = () => paths.map(file => existsSync(file) ? readFileSync(file) : null);
  const before = snapshot(); runCase(cases[0]);
  assert.deepEqual(snapshot(), before);
});

test('emitter refuses bearer credentials, secret values and credential token names before writing', t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'conformance-secret-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const filename = path.join(dir, 'output.jsonl'), secret = crypto.randomBytes(32).toString('base64url');
  for (const record of [{ ...normal, rationale: `Bearer ${secret}` },
    { ...normal, evidence: [token('note', `Bearer\t${secret}`)] },
    { ...normal, evidence: [token('lease_token', secret)] },
    { ...normal, evidence: [token('note', secret)] }]) {
    assert.throws(() => appendRecord(filename, record, registry, { secrets: [secret] }), /Credential/);
    assert.equal(existsSync(filename), false);
  }
  for (const { record, observed } of firstRun) {
    const bytes = serializeRecord(record, registry, { secrets: observed.secrets });
    for (const value of observed.secrets) assert.ok(!bytes.includes(value));
  }
});

test('evidence token grammar rejects ambiguous representations', () => {
  for (const evidence of ["reason_codes=['reason']", 'thing:yes', 'x=unquoted', 'x=1e6'])
    assert.throws(() => serializeRecord({ ...normal, evidence: [evidence] }, registry), /evidence token/);
  const value = token('reason_codes', ['one','two']);
  assert.equal(JSON.parse(JSON.parse(value.split('=').slice(1).join('=')))[1], 'two');
});

test('two real executions preserve all canonical fields except actual emission time', () => {
  const secondRun = runSuite();
  for (let i = 0; i < firstRun.length; i++) {
    const { timestamp_utc: firstTime, ...first } = firstRun[i].record;
    const { timestamp_utc: secondTime, ...second } = secondRun[i].record;
    assert.deepEqual(second, first);
    assert.ok(Date.parse(secondTime) >= Date.parse(firstTime));
  }
});

test('CLI emits an evaluator artifact without runtime or audit fields', t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'conformance-cli-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const filename = path.join(dir, 'results.jsonl');
  const result = spawnSync(process.execPath, [path.join(ROOT, 'conformance/cli.mjs'), filename], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const rows = readFileSync(filename, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, cases.length);
  assert.ok(rows.every(row => row.pass && Object.keys(row).length === 10));
});

test('an unmet review withholding assertion fails without fabricating a runtime decision', () => {
  // Use the real allowed result against the review assertion driver. This is an
  // assertion-detector unit test, not a registered proof/break runtime case.
  const allowed = byId('proof_non_destructive_allow').observed;
  // The driver swap changes the test expectation only; all runtime artifacts
  // remain real and untouched.
  return import('../conformance/assertions.mjs').then(({ assess }) => {
    const assessment = assess({ ...allowed, scenario: 'human_review' });
    assert.equal(assessment.pass, false);
    assert.ok(assessment.checks.some(check => check.name === 'withheld' && !check.pass));
  });
});

test('CLI rejects output into operational log directory', () => {
  const filename = path.join(ROOT, 'logs/cde_audit.jsonl');
  const before = existsSync(filename) ? readFileSync(filename) : null;
  const result = spawnSync(process.execPath, [path.join(ROOT, 'conformance/cli.mjs'), filename], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.deepEqual(existsSync(filename) ? readFileSync(filename) : null, before);
});

test('evidence-phase fixture overrides cannot replace operation identity', async () => {
  const { observe } = await import('../conformance/runtime.mjs');
  const { assess } = await import('../conformance/assertions.mjs');
  const fixture = JSON.parse(readFileSync(path.join(ROOT, 'conformance/fixtures/evidence.json')));
  assert.equal(assess(observe(fixture)).pass, true);
  for (const [key, value] of Object.entries({ tool:'fs.list', args:{path:'other'}, action:'other', tool_action:'other',
    target:'other', tool_target:'other', session_id:'other', speaker_id:'other', channel_id:'other', scene_id:'other', task_id:'other',
    agent_id:'other', plan_id:'other', user_request:'other', lease_token:'other' })) {
    assert.throws(() => observe({ ...fixture, evidence:{ ...fixture.evidence, [key]:value } }), /only dry_run and diff/, key);
  }
  assert.throws(() => observe({ ...fixture, evidence:{ tool:'fs.list' } }), /only dry_run and diff/);
});

test('evidence assessment independently rejects changed operation or absent evidence', async () => {
  const { observe } = await import('../conformance/runtime.mjs');
  const { assess } = await import('../conformance/assertions.mjs');
  const fixture = JSON.parse(readFileSync(path.join(ROOT, 'conformance/fixtures/evidence.json')));
  for (const change of [{tool:'fs.list'}, {action:'other'}, {target:'other'}, {args:{path:'other'}}, {session_id:'other'}, {dry_run:false}, {diff:''}]) {
    const observed = observe(fixture);
    Object.assign(observed.selected.input, change);
    assert.equal(assess(observed).pass, false, JSON.stringify(change));
  }
});
