import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

const ROLE_PERMISSIONS = Object.freeze({
  agent: Object.freeze(['runtime.evaluate', 'runtime.use_lease']),
  authority_admin: Object.freeze(['authority.issue_lease', 'authority.revoke_lease', 'authority.revoke_all', 'audit.read']),
  reviewer: Object.freeze(['review.access', 'review.resolve']),
});
const tokenShape = /^[A-Za-z0-9_-]{32,256}$/;
const text = value => typeof value === 'string' && value.trim().length > 0;
const digest = token => createHash('sha256').update(token).digest();
function configCheck(condition) {
  if (!condition) throw new Error('Invalid authentication configuration');
}
function keys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
}
export class AccessError extends Error {
  constructor(status) { super(status === 401 ? 'Authentication required' : 'Forbidden'); this.status = status; }
}

// This resolver is constructed only by trusted server code, never from request JSON.
export function createAuthentication(config) {
  configCheck(keys(config, ['schema_version', 'principals']) && config.schema_version === '1.0'
    && Array.isArray(config.principals) && config.principals.length > 0);
  const principals = new WeakSet(), ids = new Set(), tokens = new Set(), sessions = new Map();
  const entries = config.principals.map(entry => {
    configCheck(entry && Object.hasOwn(ROLE_PERMISSIONS, entry.role));
    const agent = entry.role === 'agent';
    const scopedReviewer = entry.role === 'reviewer' && Object.hasOwn(entry, 'allowed_contexts');
    configCheck(keys(entry, agent ? ['token', 'principal_id', 'role', 'agent_id', 'allowed_contexts']
      : scopedReviewer ? ['token', 'principal_id', 'role', 'allowed_contexts'] : ['token', 'principal_id', 'role']));
    configCheck(text(entry.principal_id) && !ids.has(entry.principal_id)
      && typeof entry.token === 'string' && tokenShape.test(entry.token) && !tokens.has(entry.token));
    ids.add(entry.principal_id); tokens.add(entry.token);
    let contexts;
    if (agent || scopedReviewer) {
      configCheck((!agent || text(entry.agent_id)) && Array.isArray(entry.allowed_contexts) && entry.allowed_contexts.length > 0);
      contexts = entry.allowed_contexts.map(context => {
        configCheck(keys(context, ['session_id', 'channel_id', 'scene_id', 'task_id'])
          && text(context.session_id) && text(context.channel_id)
          && [context.scene_id, context.task_id].every(value => value === null || text(value)));
        // CDE's EMA state is session-wide: distinct principals cannot share a session,
        // even when their Kingpin speaker/channel/scope keys would otherwise differ.
        if (agent) {
          configCheck(!sessions.has(context.session_id) || sessions.get(context.session_id) === entry.principal_id);
          sessions.set(context.session_id, entry.principal_id);
        }
        return Object.freeze({ ...context });
      });
    }
    const principal = Object.freeze({ principal_id: entry.principal_id, role: entry.role,
      permissions: ROLE_PERMISSIONS[entry.role], ...(agent ? { agent_id: entry.agent_id } : {}),
      ...(contexts ? { allowed_contexts: Object.freeze(contexts) } : {}) });
    principals.add(principal);
    return { hash: digest(entry.token), principal };
  });
  // Only for preventing accidental credential reflection in normal gateway audit data.
  const secrets = [...tokens];
  return Object.freeze({
    authenticate(authorization) {
      const match = typeof authorization === 'string' && /^Bearer ([A-Za-z0-9_-]{32,256})$/i.exec(authorization);
      if (!match) throw new AccessError(401);
      const candidate = digest(match[1]);
      let resolved;
      for (const entry of entries) {
        if (timingSafeEqual(candidate, entry.hash)) resolved = entry.principal;
      }
      if (!resolved) throw new AccessError(401);
      return resolved;
    },
    authorize(principal, permission, request) {
      if (!principals.has(principal) || !principal.permissions.includes(permission)) throw new AccessError(403);
      if (permission.startsWith('runtime.')) {
        if (!request || request.speaker_id !== principal.agent_id
          || (Object.hasOwn(request, 'agent_id') && request.agent_id !== principal.agent_id)
          || !principal.allowed_contexts.some(context => context.session_id === (request.session_id ?? 'default')
            && context.channel_id === request.channel_id
            && context.scene_id === (request.scene_id ?? null) && context.task_id === (request.task_id ?? null))) {
          throw new AccessError(403);
        }
      }
      return principal;
    },
    redact(record) {
      const encoded = JSON.stringify(record);
      if (!secrets.some(secret => encoded.includes(secret))) return record;
      return JSON.parse(secrets.reduce((value, secret) => value.split(secret).join('[REDACTED]'), encoded));
    },
  });
}

export function loadAuthentication(filename = process.env.KINGPIN_AUTH_FILE) {
  if (!text(filename)) throw new Error('KINGPIN_AUTH_FILE is required');
  let config;
  try { config = JSON.parse(readFileSync(filename, 'utf8')); }
  catch { throw new Error('Unable to load authentication configuration'); }
  return createAuthentication(config);
}
