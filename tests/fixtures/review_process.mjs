import { SQLiteStateStore } from '../../kingpin/state/sqlite.js';
import { KingpinAuthority } from '../../kingpin/index.js';
import { createAuthentication } from '../../kingpin/auth/access.js';
export function run(input) {
  const store = new SQLiteStateStore({ filename: input.filename });
  try {
    const a = new KingpinAuthority({ store, clock: () => input.now });
    const auth = createAuthentication(input.config);
    const principal = auth.authenticate(`Bearer ${input.config.principals.find(p => p.principal_id === input.principal).token}`);
    if (input.action === 'resolve') return a.resolveReview(input.id, input.resolution, principal);
    if (input.action === 'consume') return a.consumeReview(input.id, input.request, principal);
    if (input.action === 'nonce') return a.revokeLeaseNonce(input.nonce);
    if (input.action === 'epoch') return a.revokeAllLeases();
    return a.getReview(input.id, principal);
  } finally { store.close(); }
}
if (process.send) {
  process.send({ ready: true });
  process.once('message', input => {
    try { process.send({ result: run(input) }); } catch (error) { process.send({ error: error.message }); }
    process.disconnect();
  });
}
