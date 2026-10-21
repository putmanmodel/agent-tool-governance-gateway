import { createBridge } from '../openshell-binding/bridge.mjs';
import { createGovernance } from '../openshell-binding/governance.mjs';
import { bindingHash } from '../../kingpin/audit/events.js';

const codes = { human_review: 'kingpin_review_required', constrain: 'kingpin_constrained', deny: 'kingpin_denied', quarantine: 'kingpin_quarantined' };
// Preserve the rich result in durable Kingpin state/journal, then mechanically
// project it to the existing OpenShell decision. No header or body mutations.
export function reviewHandlers({ authority, evaluate, record, scenario = 'review', ...options }) {
  const handlers = {};
  for (const method of ['Describe', 'ValidateConfig', 'EvaluateHttpRequest']) handlers[method] = async (call, callback) => {
    let retained;
    const authorize = createGovernance({ authority, evaluate, expectedDigest: options.expectedDigest,
      session: 'openshell-review', text: scenario === 'review' ? '' : 'Please perform the bounded fixture operation.',
      evidence: scenario !== 'constrain', record: event => {
        const review_id = authority.reviewIdForDecision(event.decision);
        retained = { ...event, review_id };
        record(retained); // mandatory durable write before response
      } });
    await createBridge({ ...options, authorize })[method](call, (error, result) => {
      if (!error && result?.decision === 'DECISION_DENY' && retained) {
        result = { decision: 'DECISION_DENY', reason_code: codes[retained.decision.outcome] ?? 'kingpin_denied' };
      }
      callback(error, result);
    });
  };
  return handlers;
}

// Trusted host control-plane fixture. Credentials are resolved by the unchanged
// Kingpin authenticator, not reviewer IDs in input. No execute/forward operation.
export function reviewControl({ authority, authentication, authorization, action, reviewId, attempt }) {
  const principal = authentication.authenticate(authorization);
  authentication.authorize(principal, action === 'consume-fresh' ? 'runtime.evaluate'
    : action === 'inspect' ? 'review.access' : 'review.resolve', attempt?.request);
  if (action === 'inspect') return authority.getReview(reviewId, principal);
  if (action === 'approve' || action === 'deny') return authority.resolveReview(reviewId, action, principal);
  if (action !== 'consume-fresh') throw Error('Unsupported control operation');
  // Original provenance comes from the trusted host journal; verify the fresh
  // request against the persisted authority audit, not workload claims.
  const original = attempt?.originalReview;
  if (!original || original.review_id !== reviewId || attempt.identity.request_id === original.request_id
      || attempt.request.args.identity.request_id !== attempt.identity.request_id
      || attempt.request.args.operation.request_id !== attempt.identity.request_id) throw Error('Fresh authenticated attempt required');
  const events = authority.getEventsForRequest(attempt.identity.request_id);
  if (!events.some(e => e.event_type === 'authority.decision' && e.arguments_hash === bindingHash(attempt.request.args)
    && e.principal_id === principal.principal_id)) throw Error('Attempt lacks persisted authority binding');
  const result = authority.consumeReview(reviewId, attempt.request, principal);
  if (result.execution_authorized) throw Error('STOP: unexpected transfer of approval');
  return result;
}
