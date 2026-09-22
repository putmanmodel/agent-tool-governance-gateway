// A fixed list of ordinary assertions over observations, not a policy/rule engine.
export function assess(observed) {
  const { selected: s, observations: all, scenario } = observed;
  const checks = [];
  const check = (name, actual, expected) => checks.push({ name, actual, expected,
    pass: JSON.stringify(actual) === JSON.stringify(expected) });
  const allowed = o => o.enforcement.response.allow;
  check('gateway_matches_authority', allowed(s), s.decision.outcome === 'allow');
  if (['nonce_revoked', 'epoch_revoked'].includes(scenario)) {
    check('recovered_envelope', s.decision.capability_envelope.level, 'full');
    check('real_contraction_occurred', all.some(o => o.decision.capability_envelope.level === 'quarantined'), true);
  }
  switch (scenario) {
    case 'non_destructive':
      check('read_only_allow', s.decision.outcome, 'allow'); check('gateway_permits', allowed(s), true); break;
    case 'evidence':
      check('missing_evidence_constrained', all[0].decision.outcome, 'constrain');
      check('missing_evidence_withheld', allowed(all[0]), false);
      check('required_evidence', all[0].decision.missing_evidence, ['dry_run', 'diff']);
      check('evidence_satisfied', s.decision.missing_evidence, []);
      check('evidence_allows', s.decision.outcome, 'allow'); check('gateway_permits', allowed(s), true); break;
    case 'scoped_lease':
      check('lease_valid', s.lease_check, 'ok'); check('intended_operation_allowed', allowed(s), true);
      check('different_args_denied', all.at(-1).decision.outcome, 'deny');
      check('scope_check', all.at(-1).lease_check, 'out_of_scope'); check('different_args_withheld', allowed(all.at(-1)), false); break;
    case 'recovery': {
      check('initial_quarantine', all[0].decision.capability_envelope.level, 'quarantined');
      const clean = all.filter(o => o.signal.gate === 0).slice(0, 6);
      check('staged_recovery', clean.map(o => o.decision.capability_envelope.level),
        ['quarantined', 'read_only', 'read_only', 'non_destructive', 'non_destructive', 'full']);
      check('recovered_allow', s.decision.outcome, 'allow'); check('gateway_permits', allowed(s), true); break;
    }
    case 'missing_lease': case 'upstream':
      check('upstream_open_is_not_authority', s.signal.gate, 0);
      check('destructive_floor', s.decision.tool_floor_gate, 2);
      check('missing_lease', s.lease_check, 'missing');
      check('denied', s.decision.outcome, 'deny'); check('withheld', allowed(s), false); break;
    case 'nonce_revoked': case 'epoch_revoked': case 'out_of_scope':
      check('specific_lease_rejection', s.lease_check, scenario);
      check('denied', s.decision.outcome, 'deny'); check('withheld', allowed(s), false); break;
    case 'human_review':
      check('real_low_confidence', s.signal.reason_codes, ['LOW_CONFIDENCE']);
      check('review', s.decision.outcome, 'human_review'); check('withheld', allowed(s), false);
      check('blocked', s.enforcement.response.blocked, true); break;
    case 'envelope':
      check('initial_contraction', all[0].decision.capability_envelope.level, 'read_only');
      check('contracted_envelope_retained', s.decision.capability_envelope.level, 'read_only');
      check('destructive_not_in_envelope', s.decision.capability_envelope.tools.includes('fs.delete'), false);
      check('denied', s.decision.outcome, 'deny'); check('withheld', allowed(s), false); break;
    default: throw new Error('Unregistered assertion driver');
  }
  return { pass: checks.every(check => check.pass), checks,
    rationale: checks.map(c => `${c.name}: expected=${JSON.stringify(c.expected)} observed=${JSON.stringify(c.actual)} ${c.pass ? 'PASS' : 'FAIL'}`).join('; ') };
}
