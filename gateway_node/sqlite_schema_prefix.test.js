import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { KingpinAuthority } from '../kingpin/index.js';
import { SQLiteStateStore } from '../kingpin/state/sqlite.js';
import { ExecutionRuntime } from '../execution/runtime.js';
import { request, signal } from '../tests/fixtures/authority_cases.mjs';

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kingpin-schema-prefix-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, 'state.sqlite');
}
function raw(filename, work) {
  const db = new DatabaseSync(filename);
  try { return work(db); } finally { db.close(); }
}
function current(filename) {
  const store = new SQLiteStateStore({ filename, create: true });
  new KingpinAuthority({ store });
  store.close();
}
const migrations = ['schema.sql', 'migrations/002_lease_revocation.sql',
  'migrations/003_governance_events.sql', 'migrations/004_human_review.sql', 'migrations/005_executions.sql'];
function legacy(filename, version) {
  raw(filename, db => {
    db.function('kingpin_lease_nonce', token => createHash('sha256').update(token).digest('hex'));
    for (const name of migrations.slice(0, version)) db.exec(fs.readFileSync(new URL('../kingpin/state/' + name, import.meta.url), 'utf8'));
  });
}

for (const version of [1, 2, 3, 4, 5]) {
  test(`schema ${version}: valid database migrates/reopens`, t => {
    const filename = temporary(t); legacy(filename, version);
    const store = new SQLiteStateStore({ filename });
    try { new KingpinAuthority({ store }); } finally { store.close(); }
    assert.equal(raw(filename, db => db.prepare('PRAGMA user_version').get().user_version), 5);
  });
  test(`schema ${version}: literal-prefix impostor rejects without migration`, t => {
    const filename = temporary(t); legacy(filename, version);
    raw(filename, db => db.exec('CREATE TABLE sqliteXunexpected (value TEXT)'));
    assert.throws(() => new SQLiteStateStore({ filename }), /incompatible SQLite schema/);
    assert.equal(raw(filename, db => db.prepare('PRAGMA user_version').get().user_version), version);
  });
}

for (const name of ['sqliteXunexpected', 'app_unexpected']) {
  for (const [kind, ddl] of Object.entries({
    table: `CREATE TABLE ${name} (value TEXT)`,
    index: `CREATE INDEX ${name} ON contexts(level)`,
    view: `CREATE VIEW ${name} AS SELECT level FROM contexts`,
    trigger: `CREATE TRIGGER ${name} AFTER INSERT ON contexts BEGIN SELECT 1; END`,
  })) {
    test(`unexpected ${kind} ${name} rejects on reopen`, t => {
      const filename = temporary(t); current(filename);
      raw(filename, db => db.exec(ddl));
      assert.throws(() => new SQLiteStateStore({ filename }), /incompatible SQLite schema/);
    });
  }
}

test('transaction verification also rejects a newly introduced impostor', t => {
  const filename = temporary(t);
  const store = new SQLiteStateStore({ filename, create: true });
  t.after(() => store.close());
  const authority = new KingpinAuthority({ store });
  raw(filename, db => db.exec('CREATE TABLE sqliteXunexpected (value TEXT)'));
  assert.throws(() => authority.decide(signal(0), request, 'blocked'), /incompatible SQLite schema/);
  assert.equal(raw(filename, db => db.prepare('SELECT count(*) n FROM governance_events').get().n), 0);
});

test('real internal objects remain accepted; events and execution records survive reopen unchanged', t => {
  const filename = temporary(t);
  let store = new SQLiteStateStore({ filename, create: true });
  t.after(() => store.close());
  const authority = new KingpinAuthority({ store });
  const req = { ...request, tool: 'fs.write', dry_run: true, diff: 'test preflight' };
  const audit = { request_id: 'prefix-request', decision_id: 'prefix-decision', principal_id: 'test-agent' };
  const decision = authority.decide(signal(0), req, 'prefix-evaluation', audit);
  assert.equal(decision.outcome, 'allow');
  authority.recordEnforcement(req, audit, { outcome: 'allow', evaluation_id: decision.evaluation_id });
  const execution = new ExecutionRuntime({ store, adapter: { execute: () => ({ completed: true }) } });
  assert.equal(execution.run(execution.capture(req, decision, audit), req).execution_status, 'succeeded');
  const events = authority.getEventsForRequest(audit.request_id);
  const records = store.transaction(tx => tx.executions.list());
  assert.equal(records.length, 1);
  store.close();
  const internal = raw(filename, db => {
    db.exec('ANALYZE');
    return db.prepare('SELECT name FROM sqlite_schema').all().map(r => r.name);
  });
  assert.ok(internal.includes('sqlite_sequence'));
  assert.ok(internal.includes('sqlite_stat1'));
  assert.ok(internal.some(name => name.startsWith('sqlite_autoindex_')));
  store = new SQLiteStateStore({ filename });
  const reopened = new KingpinAuthority({ store });
  assert.deepEqual(reopened.getEventsForRequest(audit.request_id), events);
  assert.deepEqual(store.transaction(tx => tx.executions.list()), records);
});

test('missing or incompatible governance state fails closed without recreation', t => {
  const filename = temporary(t);
  assert.throws(() => new SQLiteStateStore({ filename }), /ENOENT/);
  assert.equal(fs.existsSync(filename), false);
  current(filename);
  raw(filename, db => db.exec('PRAGMA user_version=999'));
  assert.throws(() => new SQLiteStateStore({ filename }), /unsupported SQLite schema version/);
  assert.equal(raw(filename, db => db.prepare('PRAGMA user_version').get().user_version), 999);
});
