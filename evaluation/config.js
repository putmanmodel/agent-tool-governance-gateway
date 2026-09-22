import { ExecutionRuntime } from '../execution/runtime.js';
import fs from 'node:fs';
import path from 'node:path';
import { loadPolicy } from '../kingpin/policy/loader.js';
import { loadAuthentication } from '../kingpin/auth/access.js';
import { SQLiteStateStore } from '../kingpin/state/sqlite.js';
import { KingpinAuthority } from '../kingpin/index.js';
import { createSandboxAdapter } from './sandbox.js';

export function loadEvaluation(filename) {
  if (!filename) throw Error('An evaluator runtime configuration path is required');
  const base = path.dirname(path.resolve(filename));
  const config = JSON.parse(fs.readFileSync(filename, 'utf8'));
  const keys = ['schema_version','mode','database','auth','policy','sandbox','host','port','python'];
  if (!config || Object.keys(config).sort().join() !== keys.sort().join()
      || config.schema_version !== '1.0' || config.mode !== 'evaluation'
      || !['127.0.0.1','::1'].includes(config.host) || !Number.isInteger(config.port) || config.port < 1024 || config.port > 65535
      || !['database','auth','policy','sandbox','python'].every(key => typeof config[key] === 'string' && config[key].length)) throw Error('Invalid evaluation configuration');
  if (process.env.CDE_DEMO_FIXTURES === '1') throw Error('Demo fixtures are forbidden in evaluation mode');
  const resolve = key => path.resolve(base, config[key]);
  const policy = loadPolicy(resolve('policy'));
  const authentication = loadAuthentication(resolve('auth'));
  // Fail before opening governance storage if the adapter or Python path is invalid.
  fs.accessSync(resolve('python'), fs.constants.X_OK);
  const adapter = createSandboxAdapter(resolve('sandbox'));
  const sandboxRoot = fs.realpathSync(resolve('sandbox'));
  for (const file of [path.resolve(filename), ...['database','auth','policy','python'].map(resolve)]) {
    const physical = fs.existsSync(file) ? fs.realpathSync(file) : path.join(fs.realpathSync(path.dirname(file)), path.basename(file));
    const relative = path.relative(sandboxRoot, physical);
    if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) throw Error('Control files must be outside the sandbox');
  }
  const database = fs.existsSync(resolve('database')) ? fs.realpathSync(resolve('database'))
    : path.join(fs.realpathSync(path.dirname(resolve('database'))), path.basename(resolve('database')));
  if (fs.existsSync(database) && fs.statSync(database).nlink !== 1) throw Error('Database hard links are unsupported');
  return { config, policy, authentication, adapter, database, python: resolve('python') };
}
export function openEvaluation(filename, { initialize = false } = {}) {
  const loaded = loadEvaluation(filename);
  const store = new SQLiteStateStore({ filename: loaded.database, create: initialize });
  try {
    const authority = new KingpinAuthority({ store, policy: loaded.policy });
    return { ...loaded, store, authority, execution: new ExecutionRuntime({ store, adapter: loaded.adapter }) };
  } catch (error) { store.close(); throw error; }
}
export function buildIdentity(policy, buildId = null) {
  return Object.freeze({ product: 'Kingpin governed tool evaluator', version: '0.4.0-dev',
    storage_schema_version: 5, policy_version: policy.policy_version, runtime_mode: 'evaluation', build_id: buildId });
}
