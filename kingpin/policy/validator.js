// Version 1 describes the existing three classes and gate requirements only.
// These constraints prevent misspellings or inconsistent requirements from
// silently weakening the runtime's existing gate semantics.
function require(condition, message) {
  if (!condition) throw new Error(`Invalid Kingpin policy: ${message}`);
}
function object(value, keys, location) {
  require(value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype, `${location} must be a plain object`);
  require(Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)),
    `${location} must contain exactly ${keys.join(', ')}`);
}
function sameArray(value, expected) {
  return Array.isArray(value) && value.length === expected.length
    && expected.every((item, index) => value[index] === item);
}
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export function validatePolicy(policy) {
  object(policy, ['schema_version', 'policy_version', 'classes', 'gate_requirements', 'tools'], 'policy');
  require(policy.schema_version === '1.0', 'unsupported schema_version');
  require(typeof policy.policy_version === 'string' && policy.policy_version.trim().length > 0,
    'policy_version must be nonempty');
  const classes = ['read_only', 'write', 'destructive'];
  const envelopes = ['full', 'non_destructive', 'read_only'];
  object(policy.classes, classes, 'classes');
  classes.forEach((name, floor) => {
    const entry = policy.classes[name];
    object(entry, ['minimum_authority_floor', 'allowed_envelopes'], `classes.${name}`);
    require(entry.minimum_authority_floor === floor, `${name} has an inconsistent floor`);
    require(sameArray(entry.allowed_envelopes, envelopes.slice(0, 3 - floor)),
      `${name} has inconsistent envelope restrictions`);
  });
  object(policy.gate_requirements, ['0', '1', '2'], 'gate_requirements');
  for (const gate of [0, 1, 2]) {
    const requirements = policy.gate_requirements[gate];
    object(requirements, ['evidence', 'lease'], `gate_requirements.${gate}`);
    require(sameArray(requirements.evidence, gate === 1 ? ['dry_run', 'diff'] : [])
      && requirements.lease === (gate === 2), `gate ${gate} requirements must preserve v0.3 semantics`);
  }
  require(Array.isArray(policy.tools), 'tools must be an array');
  const ids = new Set();
  for (const tool of policy.tools) {
    object(tool, ['id', 'class'], 'tool');
    require(typeof tool.id === 'string' && tool.id.trim().length > 0 && tool.id === tool.id.trim(),
      'tool id must be nonempty with no surrounding whitespace');
    require(!ids.has(tool.id), `duplicate tool id ${tool.id}`);
    require(classes.includes(tool.class), `unknown class for ${tool.id}`);
    ids.add(tool.id);
  }
  // Own immutable copy: callers cannot mutate a runtime's trusted configuration.
  return freeze(structuredClone(policy));
}
