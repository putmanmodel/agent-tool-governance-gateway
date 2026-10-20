import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { bindOperation, representOperation, canonicalPath } from './operation.mjs';
import { createReceiver, observeOperation } from './receiver.mjs';

const context = { sandbox_id: 'sandbox-1', request_id: 'request-1' };
const input = () => ({ destination: { scheme: 'http', host: 'host.openshell.internal', port: 18089 },
  method: 'POST', path: '/resource/A', query: 'item=1&item=2',
  headers: [['Content-Type', 'application/octet-stream'], ['X-Operation-Mode', 'a'], ['x-operation-mode', 'b']],
  body: Buffer.from([0, 255, 10]) });
const bind = x => bindOperation(x, context);

test('duplicate raw queries retain order, encoding, and empty values', () => {
  const base = input();
  for (const query of ['item=2&item=1', 'item=1', 'item=1&item=2&item=', 'item=%31&item=2']) {
    assert.notEqual(bind({ ...base, query }).operation_sha256, bind(base).operation_sha256);
  }
  assert.equal(bind(base).representation.raw_query, 'item=1&item=2');
});

test('duplicate meaningful headers remain ordered and normalized only for case/outer whitespace', () => {
  const base = input(); const original = bind(base);
  assert.deepEqual(original.representation.application_headers.slice(1), [['x-operation-mode', 'a'], ['x-operation-mode', 'b']]);
  assert.notEqual(bind({ ...base, headers: [...base.headers].reverse() }).operation_sha256, original.operation_sha256);
  assert.equal(bind({ ...base, headers: base.headers.map(([k,v]) => [k.toUpperCase(), ` ${v}\t`]) }).operation_sha256, original.operation_sha256);
});

test('canonical path subset rejects encodings and ambiguity instead of normalizing them', () => {
  for (const path of ['/a%2Fb', '/%41', '/a/../b', '/a//b', '/a/', '/a?b', 'http://host/a', '/é']) {
    assert.throws(() => canonicalPath(path));
  }
  assert.equal(canonicalPath('/resource/A'), '/resource/A');
  assert.notEqual(bind(input()).operation_sha256, bind({ ...input(), path: '/resource/B' }).operation_sha256);
});

for (const [name, change] of [
  ['body', { body: Buffer.from([0, 255, 11]) }], ['method', { method: 'PUT' }],
  ['meaningful header', { headers: [['content-type', 'text/plain']] }],
  ['destination', { destination: { scheme: 'http', host: 'other.example', port: 18089 } }],
]) test(`${name} change alters binding`, () => assert.notEqual(bind(input()).binding_sha256, bind({ ...input(), ...change }).binding_sha256));

test('identity and request correlation are bound separately from operation equality', () => {
  const original = bind(input());
  for (const other of [{ ...context, sandbox_id: 'sandbox-2' }, { ...context, request_id: 'request-2' }]) {
    const next = bindOperation(input(), other);
    assert.equal(next.operation_sha256, original.operation_sha256);
    assert.notEqual(next.binding_sha256, original.binding_sha256);
  }
  assert.throws(() => bindOperation(input(), {}));
  assert.equal(bind({ ...input(), headers: [...input().headers, ['x-kp-request-id', 'spoof']] }).binding_sha256, original.binding_sha256);
});

test('representation rejects non-byte bodies and noncanonical destination', () => {
  assert.throws(() => representOperation({ ...input(), body: 'text' }));
  assert.throws(() => representOperation({ ...input(), destination: { scheme: 'https', host: 'HOST', port: 443 } }));
});

test('independent receiver agrees on supported bytes and preserves unsupported observations', () => {
  const base = input();
  const observed = observeOperation({ method: base.method, target: `${base.path}?${base.query}`,
    rawHeaders: ['Host', 'host.openshell.internal:18089', ...base.headers.flat()], body: base.body, port: 18089 });
  assert.deepEqual(observed.operation, representOperation(base));
  assert.equal(observed.operation_sha256, bind(base).operation_sha256);
  assert.equal(observed.identity_authenticated, false);
  const unsupported = observeOperation({ method: 'POST', target: '/%41', rawHeaders: ['Host', 'host.openshell.internal:18089'], body: Buffer.alloc(0), port: 18089 });
  assert.equal(unsupported.operation, null);
  assert.equal(unsupported.raw_target, '/%41');
});

test('independent observer detects each supported operation mutation', () => {
  const original = input();
  const variants = [
    { query: 'item=2&item=1' }, { method: 'DELETE' }, { path: '/resource/B' },
    { body: Buffer.from([0, 255, 11]) },
    { headers: [...original.headers].reverse() },
    { headers: [['content-type', 'application/json'], ['x-operation-mode', 'changed']] },
  ];
  for (const variant of variants) {
    const changed = { ...original, ...variant };
    const observed = observeOperation({ method: changed.method,
      target: `${changed.path}?${changed.query}`, body: changed.body, port: 18089,
      rawHeaders: ['Host', 'host.openshell.internal:18089', ...changed.headers.flat()] });
    assert.equal(observed.operation_sha256, bind(changed).operation_sha256);
    assert.notEqual(observed.operation_sha256, bind(original).operation_sha256);
  }
});

test('loopback receiver counts effects without any Kingpin authorization, including unsupported paths', async t => {
  const fixture = createReceiver();
  await new Promise(resolve => fixture.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => fixture.server.close(resolve)));
  const port = fixture.server.address().port;
  for (const path of ['/resource/A?x=1&x=2', '/%41']) {
    const result = await new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, method: 'POST', path,
        headers: ['Host', `host.openshell.internal:${port}`, 'X-Operation-Mode', 'one', 'X-Operation-Mode', 'two', 'X-Kp-Request-Id', 'untrusted'] }, res => {
        let data = ''; res.on('data', x => data += x); res.on('end', () => resolve({ status: res.statusCode, ...JSON.parse(data) }));
      });
      req.on('error', reject); req.end(Buffer.from('effect'));
    });
    assert.equal(result.status, 200);
  }
  assert.equal(fixture.effectCount, 2);
  assert.deepEqual(fixture.records[0].operation.application_headers, [['x-operation-mode', 'one'], ['x-operation-mode', 'two']]);
  assert.deepEqual(fixture.records[0].request_id_claims, ['untrusted']);
  assert.equal(fixture.records[1].supported, false);
});
