import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { extensionAuthenticator } from './auth.mjs';
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const auth = extensionAuthenticator({ publicKey: publicKey.export({ type: 'spki', format: 'pem' }), kid: 'key', issuer: 'openshell-gateway:test', audience: 'binding', clock: () => 100 });
const claims = { iss: 'openshell-gateway:test', aud: 'binding', sub: 'spiffe://openshell/sandbox/s1', caller_kind: 'supervisor', sandbox_id: 's1', iat: 90, exp: 200, jti: 'one' };
function call(c = claims, header = {}, sandbox = 's1') {
  const h = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'openshell-ext+jwt', kid: 'key', ...header })).toString('base64url');
  const b = Buffer.from(JSON.stringify(c)).toString('base64url');
  const token = `${h}.${b}.${sign(null, Buffer.from(`${h}.${b}`), privateKey).toString('base64url')}`;
  return { metadata: { get: () => [`Bearer ${token}`] }, request: { context: { sandbox_id: sandbox, request_id: 'r1' } } };
}
test('signed supervisor identity binds request context', () => {
  assert.deepEqual(auth(call()).sandbox_ids, ['s1']);
  assert.throws(() => auth(call(claims, {}, 'other')));
});
test('wrong audience, issuer, expiry, type, key, caller and signature fail closed', () => {
  for (const patch of [{ aud: 'other' }, { iss: 'other' }, { exp: 99 }, { iat: 101 }, { exp: 5000 }, { sub: 'other' }, { caller_kind: 'gateway' }]) assert.throws(() => auth(call({ ...claims, ...patch })));
  for (const patch of [{ alg: 'none' }, { typ: 'JWT' }, { kid: 'other' }]) assert.throws(() => auth(call(claims, patch)));
  const c = call(); const token = c.metadata.get()[0]; c.metadata.get = () => [token.slice(0, -8) + 'AAAAAAAA']; assert.throws(() => auth(c));
});
