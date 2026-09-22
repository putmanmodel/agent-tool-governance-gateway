import { KingpinAuthority } from '../../kingpin/index.js';
import { request, signal } from './authority_cases.mjs';
const runtime = new KingpinAuthority({ clock: () => 1700000000000 });
const audit = { request_id: 'schema-fixture', principal_id: 'fixture-principal', decision_id: 'fixture-decision' };
for (const [i, s] of [signal(0), signal(1), signal(1, 'LOW_CONFIDENCE'), signal(2), signal(0), signal(0)].entries()) {
  const decision = runtime.decide(s, request, `evaluation-${i}`, audit);
  runtime.recordEnforcement(request, audit, { outcome: decision.outcome, evaluation_id: decision.evaluation_id,
    reason_codes: decision.reason_codes });
}
const lease = runtime.issue({ ...request, seconds: 60 }, audit);
runtime.revokeLeaseNonce(lease.lease_id, audit);
runtime.revoke({ ...request, tool: 'fs.write' }, audit);
runtime.revokeAllLeases(audit);
runtime.recordAuthenticationRejection(audit, 'FORBIDDEN');
console.log(JSON.stringify(runtime.getEventsForRequest(audit.request_id)));
