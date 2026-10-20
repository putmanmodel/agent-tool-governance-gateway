import test from 'node:test';
import assert from 'node:assert/strict';
import grpc from '@grpc/grpc-js';
import { createBridge, createBridgeServer, Middleware, CAPABILITY } from './bridge.mjs';
import { bindOperation } from './operation.mjs';

const request = () => ({ phase: 'SUPERVISOR_MIDDLEWARE_PHASE_PRE_CREDENTIALS', middleware_name: 'kingpin-binding', config: { fields: {} },
  context: { sandbox_id: 'sandbox-1', request_id: 'request-1', sandbox: 'ignored-name' },
  target: { scheme: 'http', host: 'host.openshell.internal', port: 18089, method: 'POST', path: '/resource/A', query: 'x=1&x=2' },
  headers: [{ name: 'x-operation-mode', value: 'one' }, { name: 'x-operation-mode', value: 'two' }], body: Buffer.from([0, 255]) });
const options = authorize => ({ audience: 'urn:kingpin:local-test', sandboxPrincipals: { 'sandbox-1': 'agent-1' },
  authenticate: () => ({ principal_id: 'mock-supervisor', sandbox_ids: ['sandbox-1'] }), authorize });
const invoke = (bridge, method, req) => new Promise((resolve, reject) => bridge[method]({ request: req }, (err, result) => err ? reject(err) : resolve(result)));

test('middleware fields derive the exact representation; workload labels cannot set identity/action', async () => {
  let captured;
  const bridge = createBridge(options((operation, identity) => { captured = { operation, identity }; return 'allow'; }));
  const req = request();
  req.headers.push({ name: 'x-sandbox-id', value: 'victim' }, { name: 'x-action', value: 'read' }, { name: 'x-kp-request-id', value: 'forged' });
  assert.equal((await invoke(bridge, 'EvaluateHttpRequest', req)).decision, 'DECISION_ALLOW');
  const expected = bindOperation({ destination: { scheme: 'http', host: 'host.openshell.internal', port: 18089 },
    method: 'POST', path: '/resource/A', query: 'x=1&x=2', headers: [['x-operation-mode', 'one'], ['x-operation-mode', 'two']], body: Buffer.from([0, 255]) },
  { sandbox_id: 'sandbox-1', request_id: 'request-1' });
  assert.deepEqual(captured.operation, expected.representation);
  assert.equal(captured.identity.principal_id, 'agent-1');
  assert.equal(captured.identity.binding_sha256, expected.binding_sha256);
});

for (const [name, mutate] of [
  ['sandbox identity', r => delete r.context.sandbox_id],
  ['unmapped sandbox', r => r.context.sandbox_id = 'victim'],
  ['request correlation', r => delete r.context.request_id],
  ['destination', r => r.target.host = 'bad/host'],
  ['live plaintext relay reported as https', r => r.target.scheme = 'https'],
  ['port', r => r.target.port = 0],
  ['body type', r => r.body = 'not bytes'],
  ['body size', r => r.body = Buffer.alloc(262145)],
  ['path encoding', r => r.target.path = '/%41'],
  ['phase', r => r.phase = 'SUPERVISOR_MIDDLEWARE_PHASE_PRE_RETURN'],
  ['config', r => r.config = { fields: { unexpected: { bool_value: true } } }],
]) test(`fail closed: ${name}`, async () => {
  let calls = 0; const bridge = createBridge(options(() => { calls++; return 'allow'; }));
  const req = request(); mutate(req);
  assert.equal((await invoke(bridge, 'EvaluateHttpRequest', req)).decision, 'DECISION_DENY'); assert.equal(calls, 0);
});

test('authentication and callback failures cannot allow', async () => {
  for (const authorize of [() => 'deny', () => true, () => { throw Error('secret'); }, () => new Promise(() => {})]) {
    const bridge = createBridge({ ...options(authorize), timeoutMs: 10 });
    assert.equal((await invoke(bridge, 'EvaluateHttpRequest', request())).decision, 'DECISION_DENY');
  }
  const bridge = createBridge({ ...options(() => 'allow'), authenticate: () => null });
  assert.equal((await invoke(bridge, 'EvaluateHttpRequest', request())).decision, 'DECISION_DENY');
});

test('trusted mapping alone cannot override authenticated sandbox scope', async () => {
  let called = false;
  const bridge = createBridge({ ...options(() => { called = true; return 'allow'; }),
    authenticate: () => ({ principal_id: 'other-supervisor', sandbox_ids: ['other-sandbox'] }) });
  assert.equal((await invoke(bridge, 'EvaluateHttpRequest', request())).decision, 'DECISION_DENY');
  assert.equal(called, false);
});

test('changing trusted correlation changes binding without changing application digest', async () => {
  const seen = [];
  const bridge = createBridge(options((_op, identity) => { seen.push(identity); return 'allow'; }));
  await invoke(bridge, 'EvaluateHttpRequest', request());
  const second = request(); second.context.request_id = 'request-2';
  await invoke(bridge, 'EvaluateHttpRequest', second);
  assert.equal(seen[0].operation_sha256, seen[1].operation_sha256);
  assert.notEqual(seen[0].binding_sha256, seen[1].binding_sha256);
});

test('discovery rejects unknown required capabilities and configuration rejects wrong registration', async () => {
  const bridge = createBridge(options(() => 'allow'));
  await assert.rejects(invoke(bridge, 'Describe', { gateway: { protocol_version: { major: 1 },
    supported_capabilities: [CAPABILITY], required_capabilities: ['unsupported'] } }));
  assert.equal((await invoke(bridge, 'ValidateConfig', { middleware_name: 'other', config: {} })).valid, false);
});

test('real local protobuf gRPC round trip: discovery, config, evaluation and authentication', async t => {
  const seen = [];
  const server = createBridgeServer({ ...options((op, identity) => { seen.push({ op, identity }); return 'allow'; }),
    // Local mock credential only. Not an OpenShell JWT implementation.
    authenticate: call => {
      assert.deepEqual(call.metadata.get('authorization'), ['Bearer local-test-only']);
      return { principal_id: 'mock-supervisor', sandbox_ids: ['sandbox-1'] };
    } });
  const port = await new Promise((resolve, reject) => server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (e,p) => e ? reject(e) : resolve(p)));
  const client = new Middleware(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
  t.after(() => { client.close(); server.forceShutdown(); });
  const metadata = new grpc.Metadata(); metadata.set('authorization', 'Bearer local-test-only');
  const rpc = (method, value, meta = metadata) => new Promise((resolve, reject) => client[method](value, meta,
    { deadline: Date.now() + 2000 }, (e,r) => e ? reject(e) : resolve(r)));
  const peer = { protocol_version: { major: 1, minor: 0 }, supported_capabilities: [CAPABILITY], required_capabilities: [CAPABILITY] };
  const manifest = await rpc('Describe', { gateway: peer });
  assert.equal(manifest.bindings[0].max_payload_bytes, 262144);
  assert.equal(manifest.expected_audience, 'urn:kingpin:local-test');
  await assert.rejects(rpc('Describe', { gateway: { ...peer, protocol_version: { major: 2 } } }));
  assert.equal((await rpc('ValidateConfig', { middleware_name: 'kingpin-binding', config: {} })).valid, true);
  assert.equal((await rpc('EvaluateHttpRequest', request())).decision, 'DECISION_ALLOW');
  assert.equal(seen[0].op.raw_query, 'x=1&x=2');
  assert.deepEqual(seen[0].op.application_headers, [['x-operation-mode', 'one'], ['x-operation-mode', 'two']]);
  assert.equal((await rpc('EvaluateHttpRequest', request(), new grpc.Metadata())).decision, 'DECISION_DENY');
  const missing = request(); delete missing.context.sandbox_id;
  assert.equal((await rpc('EvaluateHttpRequest', missing)).decision, 'DECISION_DENY');
  // Proto3 omits empty scalar fields. A legal bodyless/queryless request decodes to defaults.
  const empty = request(); delete empty.body; delete empty.target.query; empty.headers = [];
  assert.equal((await rpc('EvaluateHttpRequest', empty)).decision, 'DECISION_ALLOW');
  assert.equal(seen.at(-1).op.raw_query, '');
});
