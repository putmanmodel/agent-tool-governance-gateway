import grpc from '@grpc/grpc-js';
import { readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { extensionAuthenticator } from './auth.mjs';
import { createBridge, Middleware } from './bridge.mjs';

const dir = process.env.BINDING_STATE;
if (!dir) throw Error('BINDING_STATE required');
const read = file => readFileSync(join(dir, file));
const record = event => appendFileSync(join(dir, 'middleware.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n', { mode: 0o600 });
const authenticate = extensionAuthenticator({ publicKey: read('gateway-public.pem'), kid: read('gateway-kid').toString().trim(),
  issuer: 'openshell-gateway:openshell', audience: 'urn:kingpin:binding',
  onAuthenticated: evidence => record({ type: 'authenticated', ...evidence }) });
const server = new grpc.Server({ 'grpc.max_receive_message_length': 512 * 1024 });
const config = () => JSON.parse(read('operator.json'));
const options = () => ({ authenticate, audience: 'urn:kingpin:binding', sandboxPrincipals: config().sandboxPrincipals,
  timeoutMs: 1000, authorize: async (operation, identity) => {
    record({ type: 'probe', operation, identity });
    return 'deny';
  } });
const handlers = {};
for (const method of ['Describe', 'ValidateConfig', 'EvaluateHttpRequest']) handlers[method] = async (call, callback) => {
  try {
    if (method === 'EvaluateHttpRequest') {
      // Fault injection is operator-local, never controlled by HTTP payloads.
      authenticate(call);
      record({ type: 'input_shape', middleware_name: call.request.middleware_name, phase: call.request.phase,
        target: call.request.target, config: call.request.config, body_is_buffer: Buffer.isBuffer(call.request.body) });
      if (config().fault === 'timeout') { setTimeout(() => callback(null, { decision: 'DECISION_DENY' }), 3000); return; }
      if (config().fault === 'malformed') { callback(null, { decision: 'DECISION_UNSPECIFIED' }); return; }
    }
    await createBridge(options())[method](call, callback);
  } catch { callback({ code: grpc.status.UNAUTHENTICATED, message: 'Unavailable or unauthenticated' }); }
};
server.addService(Middleware.service, handlers);
server.bindAsync('127.0.0.1:18443', grpc.ServerCredentials.createSsl(null, [{ private_key: read('tls.key'), cert_chain: read('tls.crt') }]),
  (error) => { if (error) throw error; console.log('Authenticated middleware listening on 127.0.0.1:18443'); });
process.on('SIGTERM', () => server.forceShutdown());
process.on('SIGINT', () => server.forceShutdown());
