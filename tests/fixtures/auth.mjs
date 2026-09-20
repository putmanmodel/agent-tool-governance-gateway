// Test-only credentials generated per process. Never used by production defaults.
import { randomBytes } from 'node:crypto';
import { createAuthentication } from '../../kingpin/auth/access.js';
export const tokens = { agent: randomBytes(32).toString('base64url'),
  other: randomBytes(32).toString('base64url'), admin: randomBytes(32).toString('base64url'), reviewer: randomBytes(32).toString('base64url') };
export const config = { schema_version: '1.0', principals: [
  { token: tokens.agent, principal_id: 'agent-principal', role: 'agent', agent_id: 'actor',
    allowed_contexts: [{ session_id: 's', channel_id: 'channel', scene_id: 'scene', task_id: null }] },
  { token: tokens.other, principal_id: 'other-principal', role: 'agent', agent_id: 'other',
    allowed_contexts: [{ session_id: 'other', channel_id: 'channel', scene_id: 'scene', task_id: null }] },
  { token: tokens.admin, principal_id: 'admin-principal', role: 'authority_admin' },
  { token: tokens.reviewer, principal_id: 'reviewer-principal', role: 'reviewer' },
] };
export const authentication = createAuthentication(config);
export const headers = (role = 'agent') => ({ authorization: `Bearer ${tokens[role]}` });
export async function dispatch(app, pathname, body, suppliedHeaders = headers()) {
  const route = app._router.stack.find(layer => layer.route?.path === pathname)?.route;
  const response = { statusCode: 200, headersSent: false,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; this.headersSent = true; return this; } };
  if (!route) return { ...response, statusCode: 404 };
  await route.stack[0].handle({ body, headers: suppliedHeaders }, response);
  return response;
}
