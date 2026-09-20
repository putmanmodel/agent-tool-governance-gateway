import { KingpinAuthority } from '../../kingpin/index.js';
import { SQLiteStateStore } from '../../kingpin/state/sqlite.js';
import { request, signal } from './authority_cases.mjs';

function execute({ filename, action, token, nonce }) {
  const store = new SQLiteStateStore({ filename, create: action === 'initialize' });
  try {
    const a = new KingpinAuthority({ store, clock: () => 1700000000000 });
    if (action === 'initialize') {
      a.decide(signal(2), request, 'contract');
      const lease = a.issue({ ...request, seconds: 60 });
      a.revoke({ ...request, tool: 'fs.write' });
      const pending = a.decide(signal(0), request, 'clean-1');
      return { lease, pending };
    }
    if (action === 'resume') {
      let duplicate;
      try { a.decide(signal(0), request, 'clean-1'); } catch (error) { duplicate = error.message; }
      const validLease = a.hasValidLease({ ...request, lease_token: token });
      const next = a.decide(signal(0), request, 'clean-2');
      const denied = a.decide(signal(0), { ...request, tool: 'fs.write' }, 'revoked-write');
      return { duplicate, validLease, next, denied };
    }
    if (action === 'validate') return a.validateLease({ ...request, lease_token: token });
    if (action === 'revoke-nonce') return a.revokeLeaseNonce(nonce);
    if (action === 'revoke-all') return a.revokeAllLeases();
    if (action === 'consume') return a.decide(signal(0), request, 'racing-id');
    throw new Error('Unknown test action');
  } finally { store.close(); }
}
if (process.send) {
  process.send({ ready: true });
  process.on('message', command => {
    try { process.send({ result: execute(command) }); }
    catch (error) { process.send({ error: error.message }); }
    process.disconnect();
  });
} else {
  console.log(JSON.stringify(execute(JSON.parse(process.argv[2]))));
}
