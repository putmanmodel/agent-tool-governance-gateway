import { DatabaseSync } from 'node:sqlite';
import { readFileSync, openSync, closeSync } from 'node:fs';
import { check, validContext, validLease } from './interfaces.js';

const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
const schemaQuery = "SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name";
const reference = new DatabaseSync(':memory:');
reference.exec(schema);
const expectedSchema = JSON.stringify(reference.prepare(schemaQuery).all());
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
        this.#verify();
        this.#db.exec('COMMIT');
      } catch (error) { this.#db.exec('ROLLBACK'); throw error; }
    } catch (error) { this.#db?.close(); this.#db = undefined; throw error; }
  }

  #verify() {
    check(this.#db.prepare('PRAGMA user_version').get().user_version === 1, 'unsupported SQLite schema version');
    check(JSON.stringify(this.#db.prepare(schemaQuery).all()) === expectedSchema, 'incompatible SQLite schema');
    check(this.#db.prepare('PRAGMA quick_check').all().every(row => row.quick_check === 'ok'), 'SQLite integrity check failed');
    check(this.#db.prepare('PRAGMA foreign_key_check').all().length === 0, 'orphaned governance records');
    const metadata = this.#db.prepare('SELECT * FROM store_metadata').all();
    check(metadata.length === 1 && metadata[0].singleton === 1, 'missing store metadata');
    const fingerprint = metadata[0].policy_fingerprint;
    check(fingerprint === null || /^[a-f0-9]{64}$/.test(fingerprint), 'invalid policy fingerprint');
    if (this.#fingerprint !== undefined) check(fingerprint === this.#fingerprint, 'policy mismatch');
    const rows = this.#db.prepare('SELECT * FROM contexts').all();
    check(fingerprint !== null || rows.length === 0, 'unbound persisted contexts');
    for (const row of rows) validContext(row.context_key, row);
    for (const row of this.#db.prepare('SELECT * FROM leases').all()) {
      validLease(row);
      if (this.#toolIds) check(this.#toolIds.has(row.tool), "unknown leased capability");
      check(/^[a-f0-9-]{36}$/.test(row.token), 'invalid lease token');
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
        leases: {
          get: guard(token => typeof token === 'string' ? this.#db.prepare(
            'SELECT context_key AS key, tool, args, expires_at_ms, revoked FROM leases WHERE token = ?').get(token) : undefined),
          insert: guard((token, lease) => {
            validLease(lease);
            run('INSERT INTO leases VALUES (?, ?, ?, ?, ?, ?)', token, lease.key, lease.tool, lease.args, lease.expires_at_ms, lease.revoked);
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
  contextCount() { return this.#transaction(() => this.#db.prepare('SELECT count(*) AS count FROM contexts').get().count); }
  close() { this.#db?.close(); this.#db = undefined; }
}
