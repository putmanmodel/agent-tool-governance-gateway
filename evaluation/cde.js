import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

// One private, stateful child for the lifetime of the evaluator. Never respawn
// transparently: that would silently discard CDE's in-memory session history.
export async function startCde(python) {
  const child = spawn(python, ['-u', fileURLToPath(new URL('./cde_worker.py', import.meta.url))], { stdio: ['pipe','pipe','ignore'] });
  const lines = createInterface({ input: child.stdout });
  let waiting, stopped = false;
  const fail = () => { stopped = true; if (waiting) { clearTimeout(waiting.timer); waiting.reject(Error('CDE unavailable')); waiting = null; } };
  child.on('error', fail); child.on('exit', fail); child.stdin.on('error', fail);
  lines.on('line', line => {
    if (!waiting) { fail(); child.kill(); return; }
    const pending = waiting; waiting = null; clearTimeout(pending.timer);
    try { const record = JSON.parse(line); if (record.error) throw Error(); pending.resolve(record); }
    catch { pending.reject(Error('CDE evaluation failed')); }
  });
  function receive() {
    if (stopped || waiting) return Promise.reject(Error('CDE unavailable or concurrent request'));
    return new Promise((resolve, reject) => {
      waiting = { resolve, reject, timer: setTimeout(() => { fail(); child.kill(); }, 15000) };
    });
  }
  if (!(await receive()).ready) { child.kill(); throw Error('CDE did not start'); }
  return { async evaluate(packet) {
    const response = receive();
    if (!stopped) child.stdin.write(JSON.stringify(packet) + '\n');
    return (await response).result;
  }, close() { fail(); lines.close(); child.kill(); } };
}
