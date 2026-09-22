// Test-only crash hook lives exclusively in this fixture. No production failpoint
// option, environment variable or HTTP route exists.
import fs from 'node:fs';
import { SQLiteStateStore } from '../../kingpin/state/sqlite.js';
import { KingpinAuthority } from '../../kingpin/index.js';
import { ExecutionRuntime } from '../../execution/runtime.js';
import { createSandboxAdapter } from '../../evaluation/sandbox.js';
import { signal } from './authority_cases.mjs';
import { authentication, headers } from './auth.mjs';
function run(input) {
  if (input.announce) process.send({ recovering: true });
  const store = new SQLiteStateStore({ filename: input.filename });
  const authority = new KingpinAuthority({ store });
  const adapter = createSandboxAdapter(input.sandbox);
  const runtime = new ExecutionRuntime({ store, adapter: ['crash','hold'].includes(input.action) ? {
    ...adapter, execute(request) {
      if (input.action === 'hold') {
        const result = adapter.execute(request);
        process.send({ adapter_started: true });
        const deadline = Date.now() + 5000;
        while (!fs.existsSync(input.release) && Date.now() < deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        if (!fs.existsSync(input.release)) throw Error('Test release missing');
        return result;
      }
      if (input.phase === 'after-effect') adapter.execute(request);
      process.kill(process.pid, 'SIGKILL');
    },
  } : adapter });
  try {
    if (input.action === 'recover') { runtime.recover(); return store.transaction(tx => tx.executions.list()); }
    if (input.action === 'reconcile') return runtime.reconcile(input.id, authentication.authenticate(headers('reviewer').authorization));
    if (input.action === 'resolve') return runtime.resolve(input.id, input.outcome, authentication.authenticate(headers('reviewer').authorization));
    const audit = input.audit || { request_id: 'crash-request', decision_id: 'crash-decision', principal_id: 'agent-principal' };
    const observed = signal(0);
    observed.scope_key = input.request.scene_id ? `scene:${input.request.scene_id}` : `agent:${input.request.speaker_id}`;
    const decision = input.decision || authority.decide(observed, input.request, 'crash-evaluation', audit);
    if (!input.decision) authority.recordEnforcement(input.request, audit, { outcome: 'allow', evaluation_id: decision.evaluation_id });
    return runtime.run(runtime.capture(input.request, decision, audit), input.request);
  } finally { store.close(); }
}
if (process.send) {
  process.send({ ready: true });
  process.once('message', input => {
    try { process.send({ result: run(input) }); } catch (e) { process.send({ error: e.message }); }
    process.disconnect();
  });
} else {
  console.log(JSON.stringify(run(JSON.parse(process.argv[2]))));
}
