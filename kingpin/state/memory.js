import { check, validContext, validLease } from './interfaces.js';

export class MemoryStateStore {
  #contexts = new Map();
  #evaluations = new Map();
  #revocations = new Map();
  #leases = new Map();
  #policy;
  #closed = false;
  #active = false;

  bindPolicy(fingerprint) {
    check(!this.#closed && !this.#active, 'store unavailable');
    check(this.#policy === undefined || this.#policy === fingerprint, 'policy mismatch');
    this.#policy = fingerprint;
  }
  transaction(work) {
    check(!this.#closed && !this.#active && this.#policy !== undefined, 'store unavailable or unbound');
    const contexts = structuredClone(this.#contexts), evaluations = structuredClone(this.#evaluations);
    const revocations = structuredClone(this.#revocations), leases = structuredClone(this.#leases);
    this.#active = true;
    let open = true;
    const guard = fn => (...args) => { check(open, 'transaction ended'); return fn(...args); };
    const exists = key => check(contexts.has(key), 'missing context');
    const tx = {
      contexts: {
        get: guard(key => structuredClone(contexts.get(key))),
        create: guard((key, state) => {
          validContext(key, state); check(!contexts.has(key), 'duplicate context');
          contexts.set(key, { level: state.level, clean: state.clean, revision: state.revision });
          evaluations.set(key, new Set()); revocations.set(key, new Set());
        }),
        save: guard((key, state) => {
          exists(key); validContext(key, state);
          contexts.set(key, { level: state.level, clean: state.clean, revision: state.revision });
        }),
      },
      evaluations: { consume: guard((key, id) => {
        exists(key); const seen = evaluations.get(key);
        if (seen.has(id)) return false;
        seen.add(id); return true;
      }) },
      revocations: {
        list: guard(key => { exists(key); return new Set(revocations.get(key)); }),
        add: guard((key, tool) => { exists(key); revocations.get(key).add(tool); }),
      },
      leases: {
        get: guard(token => structuredClone(leases.get(token))),
        insert: guard((token, lease) => {
          exists(lease.key); validLease(lease); check(!leases.has(token), 'duplicate lease');
          leases.set(token, structuredClone(lease));
        }),
        revoke: guard((token, reason) => {
          check(leases.has(token), 'missing lease'); leases.get(token).revoked = reason;
        }),
        revokeContext: guard((key, reason, tool) => {
          for (const lease of leases.values()) {
            if (lease.key === key && (!tool || lease.tool === tool)) lease.revoked = reason;
          }
        }),
      },
    };
    try {
      const result = work(tx);
      check(!result || typeof result.then !== 'function', 'async transaction not supported');
      this.#contexts = contexts; this.#evaluations = evaluations;
      this.#revocations = revocations; this.#leases = leases;
      return result;
    } finally { open = false; this.#active = false; }
  }
  contextCount() { check(!this.#closed, 'store closed'); return this.#contexts.size; }
  close() { check(!this.#active, 'transaction active'); this.#closed = true; }
}
