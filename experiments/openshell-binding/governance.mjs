import { randomUUID, createHash } from 'node:crypto';
import { loadPolicy } from '../../kingpin/index.js';
import { bindingHash } from '../../kingpin/audit/events.js';
import { operationDigest, VERSION } from './operation.mjs';

export const TOOL = 'openshell.fixture.post';
export function fixturePolicy() {
  const policy = structuredClone(loadPolicy());
  policy.policy_version = 'openshell_binding_experiment_v1';
  policy.tools = [{ id: TOOL, class: 'write' }];
  return policy;
}
export const fixtureInput = () => ({ destination: { scheme: 'http', host: 'host.openshell.internal', port: 18089 },
  method: 'POST', path: '/resource/A', query: 'x=1&x=2',
  headers: [['content-type', 'text/plain'], ['x-operation-mode', 'first'], ['x-operation-mode', 'second']], body: Buffer.from('data') });
const sha = x => createHash('sha256').update(x).digest('hex');

// Private control-plane configuration, never supplied by the workload.
// CDE assesses the operator's turn context; it is not an HTTP policy classifier.
export function createGovernance({ authority, evaluate, expectedDigest, record,
  session = 'openshell-binding', text = 'Please perform the bounded fixture operation.', evidence = true }) {
  let busy = false;
  return async (operation, identity) => {
    if (busy) throw Error('Concurrent governance evaluation');
    busy = true;
    try {
      const snapshot = structuredClone(operation);
      const digest = operationDigest(snapshot);
      const binding = sha(JSON.stringify([VERSION, identity.sandbox_id, identity.request_id, digest]));
      if (snapshot.sandbox_id !== identity.sandbox_id || snapshot.request_id !== identity.request_id
          || digest !== identity.operation_sha256 || binding !== identity.binding_sha256) throw Error('Binding mismatch');
      const request = { session_id: session, speaker_id: identity.principal_id, channel_id: 'openshell',
        tool: digest === expectedDigest ? TOOL : 'openshell.unmapped',
        args: { operation: snapshot, identity: structuredClone(identity) } };
      // Pure local preview of this synthetic fixture's declared effect, not remote execution.
      if (evidence && digest === expectedDigest) {
        request.dry_run = true;
        request.diff = `Synthetic fixture preview: +1 observation/effect; operation_sha256=${digest}`;
      }
      const packet = { session_id: session, turn_id: randomUUID(), ts: Date.now() / 1000,
        speaker_id: request.speaker_id, channel_id: request.channel_id, text };
      let timer;
      let result;
      try {
        result = await Promise.race([Promise.resolve().then(() => evaluate(packet)), new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error('Governance deadline exceeded')), 500);
        })]);
      } finally { clearTimeout(timer); }
      const signal = result?.governance_signal;
      const evaluationId = result?.top_event?.event_id;
      if (!signal || !evaluationId || JSON.stringify(signal) !== JSON.stringify(result.top_event.governance_signal)) throw Error('Malformed CDE response');
      const audit = { request_id: identity.request_id, principal_id: identity.principal_id, decision_id: randomUUID() };
      const decision = authority.decide(signal, request, evaluationId, audit);
      const events = authority.getEventsForRequest(identity.request_id);
      const event = events.find(e => e.event_type === 'authority.decision' && e.decision_id === audit.decision_id);
      if (!event || event.arguments_hash !== bindingHash(request.args) || event.evaluation_id !== evaluationId
          || event.outcome !== decision.outcome || operationDigest(operation) !== digest) throw Error('Unbound authority decision');
      // Must succeed before returning allow; no claim that OpenShell forwarded yet.
      record({ type: 'governance', packet, signal, decision, request, identity, audit,
        operation_sha256: digest, binding_sha256: binding, arguments_hash: event.arguments_hash, events });
      return decision.outcome === 'allow' ? 'allow' : 'deny';
    } finally { busy = false; }
  };
}

// Offline evidence assertion, not receiver-side enforcement or authenticated headers.
export function assertObservation(governance, observations) {
  if (governance.decision.outcome !== 'allow' || observations.length !== 1) throw Error('Unauthorized or non-single effect');
  const observation = observations[0];
  if (!observation.supported || observation.operation_sha256 !== governance.operation_sha256
      || observation.request_id_claims.length > 1) throw Error('Operation/evidence discrepancy');
  return true;
}
