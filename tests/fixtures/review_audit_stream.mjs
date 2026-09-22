import { KingpinAuthority } from '../../kingpin/index.js';
import { authentication, headers } from './auth.mjs';
import { request, signal } from './authority_cases.mjs';
const a = new KingpinAuthority();
const agent = authentication.authenticate(headers().authorization);
const reviewer = authentication.authenticate(headers('reviewer').authorization);
const req = { ...request, dry_run: true, diff: 'preview' };
for (const mode of ['consume','deny','invalidate']) {
  const decision = a.decide(signal(1, 'LOW_CONFIDENCE'), req, mode,
    { request_id: 'review-schema', principal_id: agent.principal_id });
  const id = a.reviewIdForDecision(decision);
  a.resolveReview(id, mode === 'deny' ? 'deny' : 'approve', reviewer);
  if (mode !== 'deny') a.consumeReview(id, mode === 'consume' ? req : { ...req, args: {} }, agent);
}
console.log(JSON.stringify(a.getEventsForRequest('review-schema')));
