import { createPublicKey, verify } from 'node:crypto';

export function extensionAuthenticator({ publicKey, kid, issuer, audience, clock = () => Date.now() / 1000, onAuthenticated = () => {} }) {
  const key = createPublicKey(publicKey);
  if (key.asymmetricKeyType !== 'ed25519') throw Error('Ed25519 trust anchor required');
  return call => {
    const values = call.metadata.get('authorization');
    if (values.length !== 1 || typeof values[0] !== 'string' || !values[0].startsWith('Bearer ')) throw Error('Missing credential');
    const token = values[0].slice(7);
    if (token.length > 16384) throw Error('Oversize credential');
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some(p => !/^[A-Za-z0-9_-]+$/.test(p))) throw Error('Invalid JWT');
    const header = JSON.parse(Buffer.from(parts[0], 'base64url'));
    if (header.alg !== 'EdDSA' || header.typ !== 'openshell-ext+jwt' || header.kid !== kid || header.crit) throw Error('Invalid JOSE header');
    if (!verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'))) throw Error('Invalid signature');
    const c = JSON.parse(Buffer.from(parts[1], 'base64url')); const now = clock();
    if (c.iss !== issuer || c.aud !== audience || !Number.isInteger(c.iat) || !Number.isInteger(c.exp)
      || c.iat > now || c.exp <= now || c.exp <= c.iat || c.exp - c.iat > 3600
      || typeof c.jti !== 'string' || !c.jti) throw Error('Invalid claims');
    const supervisor = c.caller_kind === 'supervisor';
    if (supervisor ? (typeof c.sandbox_id !== 'string' || !c.sandbox_id || c.sub !== `spiffe://openshell/sandbox/${c.sandbox_id}`)
      : (c.caller_kind !== 'gateway' || c.sub !== issuer || c.sandbox_id !== undefined)) throw Error('Invalid caller');
    if (call.request.context && (!supervisor || call.request.context.sandbox_id !== c.sandbox_id)) throw Error('Sandbox mismatch');
    onAuthenticated({ caller_kind: c.caller_kind, subject: c.sub, sandbox_id: c.sandbox_id ?? null,
      request_id: call.request.context?.request_id ?? null });
    return { principal_id: c.sub, sandbox_ids: supervisor ? [c.sandbox_id] : [] };
  };
}
