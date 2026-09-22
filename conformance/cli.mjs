import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './runtime.mjs';
import { runSuite, registry } from './runner.mjs';
import { serializeRecord } from './emitter.mjs';

// Build and validate every record before touching output. Unknown outcomes or
// harness errors have no invented canonical decision and cause nonzero exit.
try {
  const output = process.argv[2] ?? path.join(ROOT, 'conformance/output/results.jsonl');
  if (process.argv.length > 3) throw new Error('Usage: node conformance/cli.mjs [output.jsonl]');
  const resolved = path.resolve(output);
  if (!resolved.endsWith('.jsonl') || resolved.startsWith(path.join(ROOT, 'logs') + path.sep)) {
    throw new Error('Conformance output must be a separate JSONL artifact');
  }
  const results = runSuite();
  const jsonl = results.map(({ record, observed }) => serializeRecord(record, registry, { secrets: observed.secrets })).join('');
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, jsonl, { encoding: 'utf8', mode: 0o600 });
  const passed = results.filter(result => result.record.pass).length;
  console.log(`Conformance: ${passed}/${results.length} cases passed; ${output}`);
  if (passed !== results.length) process.exitCode = 1;
} catch (error) {
  // Do not echo a fixture, runtime stack, arguments or credentials on failure.
  const code = error.code === 'UNMAPPED_OUTCOME' ? 'UNMAPPED_OUTCOME' : 'HARNESS_ERROR';
  const demo = /^[a-z][a-z0-9_]*$/.test(error.demo_id) ? error.demo_id : 'startup';
  console.error(`Conformance ${demo}: ${code}; no canonical result was invented. Check registration and runtime prerequisites.`);
  process.exitCode = 1;
}
