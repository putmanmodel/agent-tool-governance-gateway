// Automated crash/restart HTTP test. The only SIGKILL hook is execution_process.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { startEvaluation } from '../../evaluation/start.mjs';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'execution-http-'));
let runtime;
try {
  for (const phase of ['before-effect','after-effect']) {
    const directory = path.join(root, phase);
    execFileSync(process.execPath, [new URL('../../evaluation/configure.mjs', import.meta.url).pathname, directory, process.env.CDE_PYTHON], { stdio: 'pipe' });
    const filename = path.join(directory, 'runtime.json');
    const config = JSON.parse(fs.readFileSync(filename)); config.port = Number(process.env.EXECUTION_SMOKE_PORT || 18790);
    fs.writeFileSync(filename, JSON.stringify(config));
    runtime = await startEvaluation(filename, { initialize: true }); await runtime.close(); runtime = null;
    const sandbox = path.join(directory, 'sandbox'), target = path.join(sandbox, 'crash.txt');
    const request = { tool: 'fs.write', args: { path: 'crash.txt', content: 'one intended effect' },
      speaker_id: 'evaluator', session_id: 'evaluation', channel_id: 'tools', scene_id: 'sandbox',
      plan_id: 'crash-test', user_request: 'Please write this test file.', dry_run: true, diff: 'preview' };
    const crashed = spawnSync(process.execPath, [new URL('./execution_process.mjs', import.meta.url).pathname,
      JSON.stringify({ filename: path.join(directory, 'governance.sqlite'), sandbox, action: 'crash', phase, request,
        audit: { request_id: 'crash-request', decision_id: 'crash-decision', principal_id: 'evaluator-agent' } })], { stdio: 'pipe' });
    assert.equal(crashed.signal, 'SIGKILL');
    const before = fs.existsSync(target) ? fs.statSync(target).mtimeMs : null;
    runtime = await startEvaluation(filename);
    const auth = JSON.parse(fs.readFileSync(path.join(directory, 'auth.json')));
    const token = auth.principals.find(p => p.role === 'authority_admin').token;
    const headers = { authorization: `Bearer ${token}` }, url = `http://127.0.0.1:${config.port}`;
    const events = (await (await fetch(url + '/audit/crash-request', { headers })).json()).events;
    const unknown = events.find(e => e.event_type === 'tool.execution.unknown'); assert.ok(unknown);
    const receipt = await (await fetch(url + '/executions/' + unknown.execution_id, { headers })).json();
    assert.equal(receipt.status, phase === 'after-effect' ? 'reconciled_succeeded' : 'reconciled_failed');
    assert.equal(fs.existsSync(target) ? fs.statSync(target).mtimeMs : null, before);
    console.log(`${phase}: real evaluator restart recorded unknown, reconciled and did not repeat the write`);
    await runtime.close(); runtime = null;
  }
} finally { if (runtime) await runtime.close(); fs.rmSync(root, { recursive: true, force: true }); }
