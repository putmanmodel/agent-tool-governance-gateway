import grpc from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { fileURLToPath } from 'node:url';
import { bindOperation } from './operation.mjs';

const definition = loadSync(fileURLToPath(new URL('./proto/supervisor_middleware.proto', import.meta.url)), {
  keepCase: true, defaults: true, enums: String, longs: Number,
});
export const Middleware = grpc.loadPackageDefinition(definition).openshell.middleware.v1.SupervisorMiddleware;
export const CAPABILITY = 'openshell.supervisor-middleware.contract';
const PHASE = 'SUPERVISOR_MIDDLEWARE_PHASE_PRE_CREDENTIALS';
const deny = code => ({ decision: 'DECISION_DENY', reason_code: code });
const check = (condition, message) => { if (!condition) throw Error(message); };
const emptyConfig = config => config && typeof config === 'object'
  && Object.keys(config.fields ?? {}).length === 0;

function immutable(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(immutable); Object.freeze(value);
  }
  return value;
}

async function bounded(action, timeoutMs) {
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('Callback deadline exceeded')), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

/** Authentication is mandatory and injected; this module supplies no live JWT verifier.
 * authenticate(call) returns { principal_id, sandbox_ids: [...] } from verified
 * transport credentials, or throws. Never derive this result from application headers.
 * sandboxPrincipals is operator-owned sandbox-ID -> Kingpin principal-ID mapping.
 */
export function createBridge({ authenticate, authorize, sandboxPrincipals,
  audience, middlewareName = 'kingpin-binding', timeoutMs = 200 } = {}) {
  check(typeof authenticate === 'function' && typeof authorize === 'function', 'Callbacks required');
  check(typeof audience === 'string' && audience.length > 0, 'Audience required');
  check(sandboxPrincipals && typeof sandboxPrincipals === 'object', 'Trusted mapping required');
  check(Number.isInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 1000, 'Invalid timeout');
  const principals = new Map(Object.entries(sandboxPrincipals));
  const authenticateCall = async call => {
    const peer = await bounded(() => authenticate(call), timeoutMs);
    check(peer && typeof peer.principal_id === 'string' && peer.principal_id.length > 0
      && Array.isArray(peer.sandbox_ids), 'Unauthenticated peer');
    return peer;
  };

  return {
    async Describe(call, callback) {
      try {
        await authenticateCall(call);
        const peer = call.request.gateway;
        check(peer?.protocol_version?.major === 1, 'Unsupported protocol');
        check(peer.supported_capabilities?.includes(CAPABILITY), 'Missing capability');
        check((peer.required_capabilities ?? []).every(c => c === CAPABILITY), 'Unsupported required capability');
        callback(null, { name: middlewareName, expected_audience: audience,
          bindings: [{ operation: 'SUPERVISOR_MIDDLEWARE_OPERATION_HTTP_REQUEST', phase: PHASE, max_payload_bytes: 262144 }],
          extension: { protocol_version: { major: 1, minor: 0 },
            implementation_name: 'kingpin/binding-experiment', implementation_version: '0.1.0',
            supported_capabilities: [CAPABILITY], required_capabilities: [CAPABILITY] } });
      } catch { callback({ code: grpc.status.PERMISSION_DENIED, message: 'Authentication or protocol negotiation failed' }); }
    },
    async ValidateConfig(call, callback) {
      try {
        await authenticateCall(call);
        callback(null, { valid: call.request.middleware_name === middlewareName && emptyConfig(call.request.config) });
      } catch { callback({ code: grpc.status.UNAUTHENTICATED, message: 'Authentication required' }); }
    },
    async EvaluateHttpRequest(call, callback) {
      try {
        const peer = await authenticateCall(call);
        const request = call.request;
        check(request.phase === PHASE && request.middleware_name === middlewareName && emptyConfig(request.config), 'Unsupported binding');
        const sandboxId = request.context?.sandbox_id;
        check(peer.sandbox_ids.includes(sandboxId) && principals.has(sandboxId), 'Unmapped sandbox');
        const principal = principals.get(sandboxId);
        check(typeof principal === 'string' && principal.length > 0, 'Invalid principal');
        check(Array.isArray(request.headers), 'Missing headers');
        const target = request.target;
        check(target && Buffer.isBuffer(request.body), 'Missing target/body');
        const bound = bindOperation({ destination: { scheme: target.scheme, host: target.host, port: target.port },
          method: target.method, path: target.path, query: target.query,
          headers: request.headers.map(h => [h.name, h.value]), body: request.body },
        { sandbox_id: sandboxId, request_id: request.context.request_id });
        const identity = immutable({ sandbox_id: sandboxId, request_id: request.context.request_id,
          principal_id: principal, middleware_peer: peer.principal_id,
          operation_sha256: bound.operation_sha256, binding_sha256: bound.binding_sha256 });
        const decision = await bounded(() => authorize(immutable(bound.representation), identity), timeoutMs);
        callback(null, decision === 'allow' ? { decision: 'DECISION_ALLOW' } : deny('kingpin_denied'));
      } catch { callback(null, deny('kingpin_invalid_or_unavailable')); }
    },
  };
}

// Caller chooses credentials and binding. There is intentionally no production launcher.
export function createBridgeServer(options) {
  const server = new grpc.Server({ 'grpc.max_receive_message_length': 512 * 1024 });
  server.addService(Middleware.service, createBridge(options));
  return server;
}
