import { validateReview, validateReviewTransition } from '../review/model.js';
import { canonical } from '../audit/events.js';
import { validateEvent } from '../audit/events.js';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, openSync, closeSync } from 'node:fs';
import { check, validContext, validLease, validEpoch } from './interfaces.js';

const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('./migrations/002_lease_revocation.sql', import.meta.url), 'utf8');
const auditMigration = readFileSync(new URL('./migrations/003_governance_events.sql', import.meta.url), 'utf8');
const reviewMigration = readFileSync(new URL('./migrations/004_human_review.sql', import.meta.url), 'utf8');
const nonceForToken = token => crypto.createHash('sha256').update(token).digest('hex');
const schemaQuery = "SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name";
const reference = new DatabaseSync(':memory:');
reference.exec(schema);
const expectedSchemas = { 1: JSON.stringify(reference.prepare(schemaQuery).all()) };
reference.function('kingpin_lease_nonce', nonceForToken);
reference.exec(migration);
expectedSchemas[2] = JSON.stringify(reference.prepare(schemaQuery).all());
reference.exec(auditMigration);
expectedSchemas[3] = JSON.stringify(reference.prepare(schemaQuery).all());
reference.exec(reviewMigration);
expectedSchemas[4] = JSON.stringify(reference.prepare(schemaQuery).all());
reference.close();

export class SQLiteStateStore {
  #db;
  #active = false;
  #fingerprint;
  #toolIds;

  // Explicit creation is separate from reopening: a missing deployment file must
  // not silently become fresh, permissive state on restart.
  constructor({ filename, create = false } = {}) {
    check(typeof filename === 'string' && filename.length > 0 && filename !== ':memory:', 'SQLite filename required');
    if (create) {
      const fd = openSync(filename, 'wx', 0o600); closeSync(fd);
    } else {
      const fd = openSync(filename, 'r+'); closeSync(fd);
    }
    try {
      this.#db = new DatabaseSync(filename);
      this.#db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = FULL;');
      this.#db.exec('BEGIN IMMEDIATE');
      try {
        if (create) this.#db.exec(schema);
        const version = this.#db.prepare('PRAGMA user_version').get().user_version;
        if (version === 1) {
          this.#verify(1);
          this.#db.function('kingpin_lease_nonce', nonceForToken);
          this.#db.exec(migration);
        }
        if (this.#db.prepare('PRAGMA user_version').get().user_version === 2) {
          this.#verify(2);
          this.#db.exec(auditMigration);
        }
        if (this.#db.prepare('PRAGMA user_version').get().user_version === 3) {
          this.#verify(3);
          this.#db.exec(reviewMigration);
        }
        this.#verify();
        this.#db.exec('COMMIT');
      } catch (error) { this.#db.exec('ROLLBACK'); throw error; }
    } catch (error) { this.#db?.close(); this.#db = undefined; throw error; }
  }

  #verify(version = 4) {
    check(this.#db.prepare('PRAGMA user_version').get().user_version === version, 'unsupported SQLite schema version');
    check(JSON.stringify(this.#db.prepare(schemaQuery).all()) === expectedSchemas[version], 'incompatible SQLite schema');
    check(this.#db.prepare('PRAGMA quick_check').all().every(row => row.quick_check === 'ok'), 'SQLite integrity check failed');
    check(this.#db.prepare('PRAGMA foreign_key_check').all().length === 0, 'orphaned governance records');
    const metadata = this.#db.prepare('SELECT * FROM store_metadata').all();
    check(metadata.length === 1 && metadata[0].singleton === 1, 'missing store metadata');
    const fingerprint = metadata[0].policy_fingerprint;
    if (version >= 2) validEpoch(metadata[0].lease_epoch);
    check(fingerprint === null || /^[a-f0-9]{64}$/.test(fingerprint), 'invalid policy fingerprint');
    if (this.#fingerprint !== undefined) check(fingerprint === this.#fingerprint, 'policy mismatch');
    const rows = this.#db.prepare('SELECT * FROM contexts').all();
    check(fingerprint !== null || rows.length === 0, 'unbound persisted contexts');
    for (const row of rows) validContext(row.context_key, row);
    for (const row of this.#db.prepare('SELECT * FROM leases').all()) {
      validLease(row, { legacy: version === 1 });
      if (version >= 2) {
        check(row.nonce === nonceForToken(row.token), 'lease nonce identity mismatch');
        check(row.issuance_epoch <= metadata[0].lease_epoch, 'future issuance epoch');
      }
      if (this.#toolIds) check(this.#toolIds.has(row.tool), "unknown leased capability");
      check(/^[a-f0-9-]{36}$/.test(row.token), 'invalid lease token');
    }
    if (version >= 3) {
      for (const row of this.#db.prepare('SELECT * FROM governance_events ORDER BY sequence').all()) {
        const record = validateEvent(JSON.parse(row.record));
        check(record.event_id === row.event_id && record.request_id === row.request_id
          && Number.isSafeInteger(row.sequence) && row.sequence > 0, 'invalid audit record binding');
      }
    }
    if (version >= 4) {
      for (const row of this.#db.prepare('SELECT * FROM reviews').all()) {
        const review = validateReview(JSON.parse(row.record));
        check(row.review_id === review.review_id && row.status === review.status
          && row.context_key === canonical(review.context) && row.evaluation_id === review.evaluation_id
          && row.decision_id === review.decision_id && review.policy_fingerprint === fingerprint, 'invalid persisted review');
      }
    }
    if (this.#toolIds) {
      for (const row of this.#db.prepare('SELECT tool FROM capability_revocations').all()) {
        check(this.#toolIds.has(row.tool), 'unknown revoked capability');
      }
    }
  }

  #transaction(work) {
    check(this.#db && !this.#active, 'store closed or transaction active');
    this.#db.exec('BEGIN IMMEDIATE');
    this.#active = true;
    try {
      this.#verify();
      const result = work();
      check(!result || typeof result.then !== 'function', 'async transaction not supported');
      this.#db.exec('COMMIT');
      return result;
    } catch (error) {
      try { this.#db.exec('ROLLBACK'); } catch { this.close(); }
      throw error;
    } finally { this.#active = false; }
  }

  bindPolicy(fingerprint, toolIds) {
    check(Array.isArray(toolIds) && toolIds.every(tool => typeof tool === 'string'), 'policy catalog required');
    const previous = this.#toolIds;
    this.#toolIds = new Set(toolIds);
    try {
      this.#transaction(() => {
        const prior = this.#db.prepare('SELECT policy_fingerprint FROM store_metadata WHERE singleton = 1').get().policy_fingerprint;
        check(prior === null || prior === fingerprint, 'policy mismatch');
        this.#db.prepare('UPDATE store_metadata SET policy_fingerprint = ? WHERE singleton = 1').run(fingerprint);
      });
      this.#fingerprint = fingerprint;
    } catch (error) { this.#toolIds = previous; throw error; }
  }

  transaction(work) {
    check(this.#fingerprint !== undefined, 'store unbound');
    return this.#transaction(() => {
      let open = true;
      const guard = fn => (...args) => { check(open, 'transaction ended'); return fn(...args); };
      const run = (sql, ...args) => this.#db.prepare(sql).run(...args);
      const tx = {
        reviews: {
          get: guard(id => {
            const row = this.#db.prepare('SELECT record FROM reviews WHERE review_id = ?').get(id);
            return row ? validateReview(JSON.parse(row.record)) : undefined;
          }),
          list: guard(() => this.#db.prepare('SELECT record FROM reviews ORDER BY rowid').all().map(row => validateReview(JSON.parse(row.record)))),
          insert: guard(record => {
            validateReview(record); check(record.status === 'pending', 'review must start pending');
            run('INSERT INTO reviews VALUES (?, ?, ?, ?, ?, ?)', record.review_id, canonical(record.context),
              record.evaluation_id, record.decision_id, record.status, JSON.stringify(record));
          }),
          save: guard(record => {
            const row = this.#db.prepare('SELECT record FROM reviews WHERE review_id = ?').get(record.review_id);
            check(row, 'missing review');
            const previous = JSON.parse(row.record); validateReviewTransition(previous, record);
            check(run('UPDATE reviews SET status = ?, record = ? WHERE review_id = ? AND status = ?',
              record.status, JSON.stringify(record), record.review_id, previous.status).changes === 1, 'review race');
          }),
        },
        audit: { append: guard(record => {
          validateEvent(record);
          const inserted = run('INSERT INTO governance_events(event_id, request_id, record) VALUES (?, ?, ?)',
            record.event_id, record.request_id, JSON.stringify(record));
          check(Number.isSafeInteger(inserted.lastInsertRowid) && inserted.lastInsertRowid > 0, 'invalid audit sequence');
        }) },
        contexts: {
          get: guard(key => this.#db.prepare('SELECT level, clean, revision FROM contexts WHERE context_key = ?').get(key)),
          create: guard((key, state) => {
            validContext(key, state);
            run('INSERT INTO contexts VALUES (?, ?, ?, ?)', key, state.level, state.clean, state.revision);
          }),
          save: guard((key, state) => {
            validContext(key, state);
            check(run('UPDATE contexts SET level = ?, clean = ?, revision = ? WHERE context_key = ?',
              state.level, state.clean, state.revision, key).changes === 1, 'missing context');
          }),
        },
        evaluations: { consume: guard((key, id) => run(
          'INSERT INTO consumed_evaluations VALUES (?, ?) ON CONFLICT(context_key, evaluation_id) DO NOTHING', key, id).changes === 1) },
        revocations: {
          list: guard(key => new Set(this.#db.prepare('SELECT tool FROM capability_revocations WHERE context_key = ? ORDER BY tool').all(key).map(row => row.tool))),
          add: guard((key, tool) => run('INSERT INTO capability_revocations VALUES (?, ?) ON CONFLICT DO NOTHING', key, tool)),
        },
        leaseEpoch: {
          current: guard(() => this.#db.prepare('SELECT lease_epoch FROM store_metadata WHERE singleton = 1').get().lease_epoch),
          advance: guard(() => {
            const current = this.#db.prepare('SELECT lease_epoch FROM store_metadata WHERE singleton = 1').get().lease_epoch;
            validEpoch(current + 1);
            check(run('UPDATE store_metadata SET lease_epoch = lease_epoch + 1 WHERE singleton = 1').changes === 1, 'missing lease epoch');
            return current + 1;
          }),
        },
        nonceRevocations: {
          has: guard(nonce => Boolean(this.#db.prepare('SELECT nonce FROM lease_nonce_revocations WHERE nonce = ?').get(nonce))),
          add: guard(nonce => run('INSERT INTO lease_nonce_revocations VALUES (?) ON CONFLICT(nonce) DO NOTHING', nonce)),
        },
        leases: {
          getByNonce: guard(nonce => typeof nonce === 'string' ? this.#db.prepare(
            'SELECT context_key AS key, tool, args, expires_at_ms, revoked, nonce, issuance_epoch FROM leases WHERE nonce = ?').get(nonce) : undefined),
          get: guard(token => typeof token === 'string' ? this.#db.prepare(
            'SELECT context_key AS key, tool, args, expires_at_ms, revoked, nonce, issuance_epoch FROM leases WHERE token = ?').get(token) : undefined),
          insert: guard((token, lease) => {
            validLease(lease);
            check(lease.nonce === nonceForToken(token), 'lease nonce identity mismatch');
            check(lease.issuance_epoch === tx.leaseEpoch.current(), 'issuance epoch mismatch');
            run('INSERT INTO leases VALUES (?, ?, ?, ?, ?, ?, ?, ?)', token, lease.key, lease.tool, lease.args, lease.expires_at_ms, lease.revoked, lease.nonce, lease.issuance_epoch);
          }),
          revoke: guard((token, reason) => check(run('UPDATE leases SET revoked = ? WHERE token = ?', reason, token).changes === 1, 'missing lease')),
          revokeContext: guard((key, reason, tool) => tool
            ? run('UPDATE leases SET revoked = ? WHERE context_key = ? AND tool = ?', reason, key, tool)
            : run('UPDATE leases SET revoked = ? WHERE context_key = ?', reason, key)),
        },
      };
      try { return work(tx); } finally { open = false; }
    });
  }
  getEventsForRequest(requestId) {
    check(this.#db && !this.#active, 'store unavailable');
    return this.#db.prepare('SELECT * FROM governance_events WHERE request_id = ? ORDER BY sequence')
      .all(requestId).map(row => {
        const record = validateEvent(JSON.parse(row.record));
        check(record.event_id === row.event_id && record.request_id === row.request_id
          && Number.isSafeInteger(row.sequence) && row.sequence > 0, 'invalid audit record binding');
        return { ...record, sequence: row.sequence };
      });
  }
  contextCount() { return this.#transaction(() => this.#db.prepare('SELECT count(*) AS count FROM contexts').get().count); }
  close() { this.#db?.close(); this.#db = undefined; }
}
