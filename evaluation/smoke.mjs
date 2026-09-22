// Real HTTP packaging smoke: fresh temporary configuration, actual example client,
// process restart, then durable audit/review/epoch continuity. No fixed secrets.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kingpin-evaluator-smoke-'));
const script = name => fileURLToPath(new URL(name, import.meta.url));
const python = process.env.CDE_PYTHON;
if (!python || !path.isAbsolute(python)) throw Error('Set CDE_PYTHON to an absolute Python executable');
let child;
async function launch(initialize) {
  child = spawn(process.execPath, [script('start.mjs'), path.join(directory, 'config/runtime.json'), ...(initialize ? ['--initialize'] : [])], { stdio: ['ignore','pipe','pipe'] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Evaluator startup timed out')), 20000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(Error(`Evaluator exited: ${code}`)); });
    child.stdout.on('data', data => { if (data.toString().includes('Evaluation listening')) { clearTimeout(timer); resolve(); } });
    child.stderr.on('data', () => {});
  });
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await exited;
}
try {
  execFileSync(process.execPath, [script('configure.mjs'), path.join(directory, 'config'), python], { stdio: 'pipe' });
  const filename = path.join(directory, 'config/runtime.json');
  const config = JSON.parse(fs.readFileSync(filename)); config.port = Number(process.env.EVALUATION_SMOKE_PORT || 18789);
  fs.writeFileSync(filename, JSON.stringify(config));
  await launch(true);
  const output = execFileSync(process.execPath, [script('client.mjs'), filename], { encoding: 'utf8' });
  process.stdout.write(output);
  const saved = JSON.parse(fs.readFileSync(path.join(directory, 'config/client-checkpoint.json')));
  const printedId = /^Request ID: (.+)$/m.exec(output)?.[1];
  if (!printedId || printedId !== saved.request) throw Error('Client did not print the server request ID');
  const auth = JSON.parse(fs.readFileSync(path.join(directory, 'config/auth.json')));
  for (const secret of [...auth.principals.map(p => p.token), saved.lease]) {
    if (output.includes(secret)) throw Error('Client printed a credential or lease token');
  }
  const trace = execFileSync(process.execPath, [script('trace.mjs'), filename, printedId], { encoding: 'utf8' });
  if (!trace.includes('Execution SUCCEEDED (adapter receipt)')) throw Error('Trace omitted execution receipt');
  process.stdout.write(trace);
  await stop(); await launch(false);
  process.stdout.write(execFileSync(process.execPath, [script('client.mjs'), filename, '--continuity'], { encoding: 'utf8' }));
} finally { await stop(); fs.rmSync(directory, { recursive: true, force: true }); }
