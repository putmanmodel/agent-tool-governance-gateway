import { appendFileSync } from 'node:fs';

export const KEYS = Object.freeze(['decision', 'demo_id', 'evidence', 'fixture_hash', 'fixture_path',
  'mode', 'normative_ids', 'pass', 'rationale', 'timestamp_utc']);
export const DECISIONS = Object.freeze(['ALLOW', 'REVIEW', 'DENY', 'FLAG_PROJECTION',
  'REJECT_OR_FLAG_PROJECTION', 'QUARANTINE', 'ESCALATE']);

// Mechanical outcome translation only; an unmapped outcome is a harness error.
export function canonicalDecision(outcome) {
  const mapping = { allow: 'ALLOW', human_review: 'REVIEW', deny: 'DENY', quarantine: 'QUARANTINE' };
  if (!Object.hasOwn(mapping, outcome)) {
    const error = new Error('Runtime outcome has no canonical mapping');
    error.code = 'UNMAPPED_OUTCOME'; throw error;
  }
  return mapping[outcome];
}

export function token(name, value) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9_-]+$/.test(name)) throw new Error('Invalid evidence name');
  if (value === undefined) return name;
  if (typeof value === 'boolean') return `${name}=${value}`;
  if (typeof value === 'number' && Number.isFinite(value) && !String(value).match(/[eE]/)) return `${name}=${value}`;
  if (typeof value === 'string') return `${name}=${JSON.stringify(value)}`;
  if (Array.isArray(value) || (value && typeof value === 'object')) return `${name}=${JSON.stringify(JSON.stringify(value))}`;
  throw new Error('Unsupported evidence value');
}

export function validateRecord(record, registry, { secrets = [] } = {}) {
  if (!record || Array.isArray(record) || Object.keys(record).sort().join() !== [...KEYS].sort().join()) throw new Error('Canonical envelope requires exactly ten keys');
  if (!DECISIONS.includes(record.decision)) throw new Error('Invalid canonical decision');
  if (!['proof', 'break'].includes(record.mode) || typeof record.pass !== 'boolean') throw new Error('Invalid case result');
  if (typeof record.demo_id !== 'string' || !/^[a-z][a-z0-9_]*$/.test(record.demo_id)) throw new Error('Invalid demo ID');
  if (typeof record.fixture_hash !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(record.fixture_hash)) throw new Error('Invalid fixture hash');
  if (typeof record.fixture_path !== 'string' || !/^conformance\/fixtures\/[a-z0-9_]+\.json$/.test(record.fixture_path)) throw new Error('Invalid fixture path');
  if (!Array.isArray(record.normative_ids) || !record.normative_ids.length
      || new Set(record.normative_ids).size !== record.normative_ids.length
      || record.normative_ids.some(id => !registry.some(rule => rule.id === id))) throw new Error('Unregistered normative ID');
  if (typeof record.rationale !== 'string' || !record.rationale.length) throw new Error('Missing rationale');
  if (typeof record.timestamp_utc !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(record.timestamp_utc)
      || !Number.isFinite(Date.parse(record.timestamp_utc))) throw new Error('Invalid emission timestamp');
  if (!Array.isArray(record.evidence)) throw new Error('Evidence must be ordered tokens');
  for (const entry of record.evidence) {
    if (typeof entry !== 'string' || !/^[A-Za-z0-9_-]+(?:=(?:true|false|-?\d+(?:\.\d+)?|"(?:[^"\\\x00-\x1f]|\\[\\"nrt])*"))?$/.test(entry)) {
      throw new Error('Invalid evidence token');
    }
    if (/^(?:authorization|bearer|credential|password|secret|lease_token|access_token|refresh_token)(?:=|$)/i.test(entry)) throw new Error('Credential evidence prohibited');
  }
  const inspect = value => {
    if (value && typeof value === 'object') return Object.values(value).forEach(inspect);
    if (typeof value !== 'string') return;
    if (/\bbearer(?:\s|\\[nrt])+/i.test(value)
        || secrets.some(secret => typeof secret === 'string' && secret && value.includes(secret))) throw new Error('Credential material prohibited');
    const quoted = value.match(/^[A-Za-z0-9_-]+=(".*")$/s);
    if (quoted) inspect(JSON.parse(quoted[1]));
  };
  inspect(record);
  return record;
}

export function serializeRecord(record, registry, options) {
  validateRecord(record, registry, options);
  return JSON.stringify(Object.fromEntries(KEYS.map(key => [key, record[key]]))) + '\n';
}
export function appendRecord(path, record, registry, options) {
  appendFileSync(path, serializeRecord(record, registry, options), { encoding: 'utf8', mode: 0o600 });
}
