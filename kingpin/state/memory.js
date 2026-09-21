import { validateReview, validateReviewTransition } from '../review/model.js';
import { canonical } from '../audit/events.js';
import { validateEvent } from '../audit/events.js';
import { check, validContext, validLease, validEpoch } from './interfaces.js';

export class MemoryStateStore {
  #events = [];
  #reviews = new Map();
  #contexts = new Map();
  #evaluations = new Map();
  #revocations = new Map();
  #leases = new Map();
  #leaseEpoch = 0;
  #nonceRevocations = new Set();
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
    const events = structuredClone(this.#events);
    const reviews = structuredClone(this.#reviews);
    const contexts = structuredClone(this.#contexts), evaluations = structuredClone(this.#evaluations);
    const revocations = structuredClone(this.#revocations), leases = structuredClone(this.#leases);
    let leaseEpoch = this.#leaseEpoch;
    const nonceRevocations = new Set(this.#nonceRevocations);
    this.#active = true;
    let open = true;
    const guard = fn => (...args) => { check(open, 'transaction ended'); return fn(...args); };
    const exists = key => check(contexts.has(key), 'missing context');
    const tx = {
      reviews: {
        get: guard(id => structuredClone(reviews.get(id))),
        list: guard(() => structuredClone([...reviews.values()])),
        insert: guard(record => {
          validateReview(record);
          check(record.status === 'pending' && !reviews.has(record.review_id), 'duplicate/nonpending review');
          check(evaluations.get(canonical(record.context))?.has(record.evaluation_id), 'missing review evaluation');
          check(![...reviews.values()].some(r => r.decision_id === record.decision_id
            || (canonical(r.context) === canonical(record.context) && r.evaluation_id === record.evaluation_id)), 'duplicate review evaluation');
          reviews.set(record.review_id, structuredClone(record));
        }),
        save: guard(record => {
          check(reviews.has(record.review_id), 'missing review');
          validateReviewTransition(reviews.get(record.review_id), record);
          reviews.set(record.review_id, structuredClone(record));
        }),
      },
      audit: { append: guard(record => {
        validateEvent(record);
        check(!events.some(e => e.event_id === record.event_id), 'duplicate audit event');
        events.push({ ...structuredClone(record), sequence: events.length + 1 });
      }) },
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
      leaseEpoch: {
        current: guard(() => leaseEpoch),
        advance: guard(() => { validEpoch(leaseEpoch + 1); return ++leaseEpoch; }),
      },
      nonceRevocations: {
        has: guard(nonce => nonceRevocations.has(nonce)),
        add: guard(nonce => {
          check([...leases.values()].some(lease => lease.nonce === nonce), 'missing lease nonce');
          nonceRevocations.add(nonce);
        }),
      },
      leases: {
        getByNonce: guard(nonce => structuredClone([...leases.values()].find(lease => lease.nonce === nonce))),
        get: guard(token => structuredClone(leases.get(token))),
        insert: guard((token, lease) => {
          exists(lease.key); validLease(lease); check(!leases.has(token), 'duplicate lease');
          check(lease.issuance_epoch === leaseEpoch, 'issuance epoch mismatch');
          check(![...leases.values()].some(existing => existing.nonce === lease.nonce), 'duplicate lease nonce');
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
      this.#events = events;
      this.#reviews = reviews;
      this.#contexts = contexts; this.#evaluations = evaluations;
      this.#revocations = revocations; this.#leases = leases;
      this.#leaseEpoch = leaseEpoch; this.#nonceRevocations = nonceRevocations;
      return result;
    } finally { open = false; this.#active = false; }
  }
  getEventsForRequest(requestId) {
    check(!this.#closed, 'store closed');
    return structuredClone(this.#events.filter(event => event.request_id === requestId));
  }
  contextCount() { check(!this.#closed, 'store closed'); return this.#contexts.size; }
  close() { check(!this.#active, 'transaction active'); this.#closed = true; }
}
