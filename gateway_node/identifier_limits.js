import fs from 'node:fs';

const fields = ['turn_id', 'speaker_id', 'session_id', 'channel_id', 'scene_id', 'task_id', 'tool'];
const exactKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
export function validateLimitsDefinition(specification) {
  if (!exactKeys(specification, ['schema_version', 'max_utf8_bytes']) || specification.schema_version !== '1.0'
      || !exactKeys(specification.max_utf8_bytes, fields)
      || !Object.values(specification.max_utf8_bytes).every(value => Number.isSafeInteger(value) && value > 0)) {
    throw Error('Invalid identifier limits definition');
  }
  return Object.freeze({ ...specification.max_utf8_bytes });
}
// Same trusted source as Python; never read limits from request or policy_state.
export const IDENTIFIER_LIMITS = validateLimitsDefinition(JSON.parse(
  fs.readFileSync(new URL('../src/types/identifier_limits.json', import.meta.url))));
export function validateIdentifiers(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('Invalid identifiers');
  for (const [name, maximum] of Object.entries(IDENTIFIER_LIMITS)) {
    if (!Object.hasOwn(body, name)) continue;
    const value = body[name];
    if (value === null && ['session_id', 'scene_id', 'task_id'].includes(name)) continue;
    if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > maximum
        || Buffer.from(value, 'utf8').toString('utf8') !== value) throw Error('Invalid identifiers');
  }
}
