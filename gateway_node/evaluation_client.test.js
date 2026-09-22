import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { config } from '../tests/fixtures/auth.mjs';

// Exercise the actual CLI's first write with controlled HTTP responses. The full
// authenticated walkthrough and printed-ID trace lookup run in evaluation:smoke.
function run(t, requestId) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'evaluation-client-id-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'auth.json'), JSON.stringify(config));
  const filename = path.join(directory, 'runtime.json');
  fs.writeFileSync(filename, JSON.stringify({ auth: 'auth.json', host: '127.0.0.1', port: 8788 }));
  const script = `
    let calls = 0;
    globalThis.fetch = async () => {
      if (++calls === 1) return new Response(JSON.stringify({ runtime_mode: 'evaluation' }));
      if (calls === 2) return new Response(JSON.stringify({ allow: true }), {
        headers: ${JSON.stringify(requestId === null ? {} : { 'X-Request-ID': requestId })}
      });
      process.exit(0); // Stop before the rest of the separately smoke-tested walkthrough.
    };
    await import(${JSON.stringify(new URL('../evaluation/client.mjs', import.meta.url).href)});
  `;
  return spawnSync(process.execPath, ['--input-type=module', '-', filename], { input: script, encoding: 'utf8' });
}
test('client surfaces the exact write response request ID without credentials', t => {
  const id = 'server-provided-write-correlation';
  const result = run(t, id);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`ALLOW: wrote sandbox file.\nRequest ID: ${id}\n`));
  assert.equal((result.stdout.match(/^Request ID:/gm) || []).length, 1);
  for (const principal of config.principals) assert.ok(!(result.stdout + result.stderr).includes(principal.token));
});
test('client fails clearly if the successful write has no request ID', t => {
  for (const header of [null, '']) {
    const result = run(t, header);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Successful write response is missing required X-Request-ID/);
    assert.ok(!result.stdout.includes('Request ID:'));
    for (const principal of config.principals) assert.ok(!(result.stdout + result.stderr).includes(principal.token));
  }
});
