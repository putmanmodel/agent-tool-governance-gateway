import { KingpinAuthority, MemoryStateStore } from '../../kingpin/index.js';
import { ExecutionRuntime } from '../../execution/runtime.js';
import { authentication, headers } from './auth.mjs';
import { request, signal } from './authority_cases.mjs';
const store = new MemoryStateStore(), authority = new KingpinAuthority({ store });
const principal = authentication.authenticate(headers().authorization), reviewer = authentication.authenticate(headers('reviewer').authorization);
let seq = 0;
for (const outcome of ['succeeded','failed','unknown-success','unknown-failure','unsupported']) {
  const adapter = { execute() {
    if (outcome === 'failed') throw Object.assign(Error(), { knownNoEffect: true });
    if (outcome !== 'succeeded') throw Error('unknown');
    return { arbitrary: 'not persisted' };
  }, ...(outcome !== 'unsupported' ? { reconcile() { return outcome === 'unknown-success' ? 'succeeded' : 'failed'; } } : {}) };
  const runtime = new ExecutionRuntime({ store, adapter });
  const req = { ...request, tool: 'fs.write', args: { path: outcome }, dry_run: true, diff: 'preview' };
  const audit = { request_id: 'execution-schema', decision_id: `decision-${++seq}`, principal_id: principal.principal_id };
  const decision = authority.decide(signal(0), req, `evaluation-${seq}`, audit);
  authority.recordEnforcement(req, audit, { outcome: 'allow', evaluation_id: decision.evaluation_id });
  const result = runtime.run(runtime.capture(req, decision, audit), req);
  if (result.execution_status === 'unknown') {
    runtime.reconcile(result.execution_id, reviewer);
    if (outcome === 'unsupported') runtime.resolve(result.execution_id, 'failed', reviewer);
  }
}
console.log(JSON.stringify(authority.getEventsForRequest('execution-schema')));
