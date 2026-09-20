import crypto from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { ROOT, observe } from './runtime.mjs';
import { assess } from './assertions.mjs';
import { canonicalDecision, token, validateRecord } from './emitter.mjs';

export const registry = JSON.parse(readFileSync(new URL('./normatives.json', import.meta.url)));
export const cases = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url)));
export const hashBytes = bytes => `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;

export function validateCase(entry, rules = registry) {
  if (!entry || Object.keys(entry).sort().join() !== 'demo_id,fixture_path,mode,normative_ids,scenario') throw new Error('Invalid case registration');
  if (!/^[a-z][a-z0-9_]*$/.test(entry.demo_id) || !['proof','break'].includes(entry.mode)) throw new Error('Invalid case identity/mode');
  if (!Array.isArray(entry.normative_ids) || !entry.normative_ids.length
      || new Set(entry.normative_ids).size !== entry.normative_ids.length
      || entry.normative_ids.some(id => !rules.some(rule => rule.id === id))) throw new Error('Unregistered normative ID');
  if (!/^conformance\/fixtures\/[a-z0-9_]+\.json$/.test(entry.fixture_path)) throw new Error('Fixture must be a registered repository file');
}

function evidenceFor(observed, assessment, fixtureHash, decision) {
  const { selected: s, observations, leases, toolClass } = observed;
  const tool_class = { read_only: 'non_destructive', write: 'reversible', destructive: 'destructive' }[toolClass];
  const evidence = [token('tool_id', s.input.tool), token('tool_class', tool_class),
    token('policy_gate_level', s.decision.effective_gate),
    token('review_band', ['Auto', 'HumanReview', 'Quarantine'][s.decision.effective_gate]),
    token('cde_gate', s.signal.gate), token('runtime_outcome', s.decision.outcome),
    token('allowed', s.enforcement.response.allow), token('blocked', s.enforcement.response.blocked),
    token('forwarded', s.audit.some(event => event.event_type === 'cde.signal.created' && event.evaluation_id === s.decision.evaluation_id)), token('governance_approved', s.decision.outcome === 'allow'),
    token('reason_codes', s.decision.reason_codes), token('required_evidence', s.decision.evidence_requirements),
    token('missing_evidence', s.decision.missing_evidence), token('envelope_level', s.decision.capability_envelope.level),
    token('envelope_tools', s.decision.capability_envelope.tools),
    token('observed_outcomes', observations.map(o => o.decision.outcome)),
    token('observed_levels', observations.map(o => o.decision.capability_envelope.level)),
    token('observed_cde_gates', observations.map(o => o.signal.gate)),
    token('assertions_passed', assessment.checks.filter(c => c.pass).map(c => c.name)),
    token('assertions_failed', assessment.checks.filter(c => !c.pass).map(c => c.name))];
  if (s.input.dry_run !== undefined) evidence.push(token('dry_run', s.input.dry_run));
  if (s.lease_check !== null) evidence.push(token('lease_check', s.lease_check));
  if (toolClass === 'destructive') evidence.push(token('valid_contract', s.lease_check === 'ok'));
  if (leases.length) {
    // A fixture-local identity alias is derived from the actual issuance order.
    // Raw random nonce/token stays in the returned operational trace, never JSONL.
    const index = leases.findIndex(lease => lease.lease_token === s.input.lease_token);
    if (index < 0) throw new Error('Cannot bind observed lease to issuance');
    const lease = leases[index];
    const issued = observed.controlAudit.find(event => event.event_type === 'lease.issued' && event.lease_id === lease.lease_id);
    if (!issued) throw new Error('Missing issuance evidence');
    evidence.push(token('lease_id', `issuance_${index + 1}`), token('lease_identity_normalization', 'fixture_local_issuance_order'),
      token('lease_scope', [lease.context, issued.tool_id, issued.arguments_hash]),
      token('lease_expires_at', Date.parse(lease.expires_at) / 1000), token('lease_issuance_epoch', issued.lease_epoch));
  }
  // Paper 9 §7: reproducible opaque binding for the in-band precondition claims.
  // This is correlation, not a signature or new authority token.
  evidence.push(token('governance_token', hashBytes(Buffer.from(JSON.stringify({ fixtureHash, decision, evidence })))));
  return evidence;
}

export function runCase(entry, { emissionClock = Date.now } = {}) {
  validateCase(entry);
  const absolute = realpathSync(path.join(ROOT, entry.fixture_path));
  const fixtureDirectory = realpathSync(path.join(ROOT, 'conformance/fixtures')) + path.sep;
  if (!absolute.startsWith(fixtureDirectory)) throw new Error('Fixture escapes registered directory');
  const bytes = readFileSync(absolute);
  const fixture = JSON.parse(bytes);
  if (fixture.scenario !== entry.scenario) throw new Error('Fixture driver disagrees with registration');
  const observed = observe(fixture);
  const assessment = assess(observed);
  const decision = canonicalDecision(observed.selected.decision.outcome);
  const fixture_hash = hashBytes(bytes);
  // Construct each of the ten fields explicitly. Never spread operational data.
  const record = { decision, demo_id: entry.demo_id,
    evidence: evidenceFor(observed, assessment, fixture_hash, decision), fixture_hash,
    fixture_path: entry.fixture_path, mode: entry.mode, normative_ids: [...entry.normative_ids],
    pass: assessment.pass, rationale: assessment.rationale,
    timestamp_utc: new Date(emissionClock()).toISOString() };
  validateRecord(record, registry, { secrets: observed.secrets });
  return { record, observed, assessment };
}

export function runSuite(options) {
  if (new Set(cases.map(c => c.demo_id)).size !== cases.length) throw new Error('Duplicate demo ID');
  return cases.map(entry => {
    try { return runCase(entry, options); }
    catch (error) { error.demo_id = /^[a-z][a-z0-9_]*$/.test(entry.demo_id) ? entry.demo_id : 'invalid_registration'; throw error; }
  });
}
