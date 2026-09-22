// Representative ordered streams shared by the frozen pre-extraction oracle test.
export const request = { tool: 'fs.list', args: { path: '/project' }, session_id: 's',
  speaker_id: 'actor', channel_id: 'channel', scene_id: 'scene' };
export function signal(gate, reason = ['DEVIATION_INACTIVE', 'REVIEW_THRESHOLD_REACHED', 'LEASE_THRESHOLD_REACHED'][gate]) {
  return { schema_version: '1.0', scope_key: 'scene:scene', gate,
    gate_label: ['PASS', 'EVIDENCE REQUIRED', 'LEASE REQUIRED'][gate],
    evidence_requirements: gate === 1 ? ['dry_run', 'diff'] : [], reason_codes: [reason],
    authority: { requirement: gate === 2 ? 'lease' : 'none', recommendation: gate === 2 ? 'request_external_lease' : 'none' },
    deviation: { severity: [.1, .6, .8][gate], ema_severity: [.1, .5, .7][gate], confidence: reason === 'LOW_CONFIDENCE' ? .2 : .9,
      active: gate !== 0, enter: false, exit: false, vector: {} } };
}
export function captureDecisions(KingpinAuthority) {
  const results = {};
  let sequence = 0;
  const fresh = () => new KingpinAuthority({ clock: () => 1700000000000 });
  const decide = (a, s = signal(0), req = request, id = `evaluation-${++sequence}`) => a.decide(s, req, id);
  for (const gate of [0, 1, 2]) {
    for (const tool of ['fs.list', 'fs.write', 'fs.delete']) {
      for (const evidence of [false, true]) {
        results[`gate-${gate}-${tool}-evidence-${evidence}`] = decide(fresh(), signal(gate),
          { ...request, tool, ...(evidence ? { dry_run: true, diff: 'diff' } : {}) });
      }
    }
  }
  for (const tool of ['fs.list', 'fs.delete']) {
    results[`review-${tool}`] = decide(fresh(), signal(1, 'LOW_CONFIDENCE'),
      { ...request, tool, dry_run: true, diff: 'diff' });
  }
  const a = fresh();
  results.progression = [0, 1, 2, 3, 0, 0, 0, 0, 0, 0].map(g =>
    decide(a, g === 3 ? signal(2, 'QUARANTINE_THRESHOLD_REACHED') : signal(g)));
  const b = fresh();
  decide(b, signal(2));
  const lease = b.issue({ ...request, seconds: 60 });
  const leased = { ...request, lease_token: lease.lease_token };
  results.leased = decide(b, signal(2), leased);
  b.revoke(leased);
  results.revoked = decide(b, signal(2), leased);
  results.recovered = Array.from({ length: 4 }, () => decide(b));
  results.oldLeaseValid = b.hasValidLease(leased);
  b.revoke(request);
  results.capabilityRevoked = decide(b);
  results.otherContext = decide(b, signal(0), { ...request, session_id: 'other' });
  const c = fresh();
  results.consumed = decide(c, signal(1), request, 'once');
  try { decide(c, signal(0), request, 'once'); } catch (error) { results.duplicateError = error.message; }
  results.reusedInOtherContext = decide(c, signal(0), { ...request, channel_id: 'other' }, 'once');
  return results;
}
