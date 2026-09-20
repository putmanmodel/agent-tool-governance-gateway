import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { KingpinAuthority, loadPolicy } from '../kingpin/index.js';
import { enforceAuthorityDecision } from '../gateway_node/enforcement.js';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export function pythonExecutable() {
  return process.env.CDE_PYTHON || (existsSync(`${ROOT}.venv-task/bin/python`) ? `${ROOT}.venv-task/bin/python` : 'python3');
}
function cde(fixture, texts) {
  const { speaker_id, channel_id, scene_id } = fixture.request;
  const packets = texts.map((text, i) => ({ text, speaker_id, channel_id, scene_id,
    turn_id: `conformance-turn-${i}`, ts: i }));
  const result = spawnSync(pythonExecutable(), [`${ROOT}conformance/cde_bridge.py`], {
    cwd: ROOT, input: JSON.stringify(packets), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error('Real CDE fixture execution failed');
  return JSON.parse(result.stdout);
}

// Fixed scenario drivers call only public runtime/control-plane APIs. There is
// no input-authored code, assertion expression language, or state mutation.
export function observe(fixture) {
  const { scenario, request, calm_text } = fixture;
  let texts;
  switch (scenario) {
    case 'non_destructive': case 'missing_lease': case 'upstream': texts = [calm_text]; break;
    case 'evidence': texts = [calm_text, calm_text]; break;
    case 'scoped_lease': texts = [calm_text, calm_text, calm_text]; break;
    case 'out_of_scope': texts = [calm_text, calm_text]; break;
    case 'nonce_revoked': case 'epoch_revoked':
      texts = [calm_text, fixture.contraction_text, ...Array(fixture.recovery_turns).fill(calm_text), calm_text]; break;
    case 'human_review': texts = [fixture.warmup_text, fixture.review_text]; break;
    case 'envelope': texts = [fixture.contraction_text, calm_text]; break;
    case 'recovery': texts = [fixture.contraction_text, ...Array(fixture.recovery_turns).fill(calm_text)]; break;
    default: throw new Error('Unregistered scenario driver');
  }
  const turns = cde(fixture, texts);
  const runtime = new KingpinAuthority({ clock: () => fixture.clock_ms });
  const observations = [], leases = [];
  let cursor = 0;
  function evaluate(input = request) {
    const turn = turns[cursor], auditContext = { request_id: `harness-${cursor}`, decision_id: `decision-${cursor}` };
    cursor++;
    const decision = runtime.decide(turn.governance_signal, input, turn.top_event.event_id, auditContext);
    const enforcement = enforceAuthorityDecision(decision);
    runtime.recordEnforcement(input, auditContext, { outcome: decision.outcome,
      evaluation_id: decision.evaluation_id, reason_codes: decision.reason_codes });
    const audit = runtime.getEventsForRequest(auditContext.request_id);
    observations.push({ signal: turn.governance_signal, decision, enforcement,
      lease_check: audit.find(e => e.event_type === 'authority.decision').lease_check,
      audit, input });
    return observations.at(-1);
  }
  const issue = () => {
    const lease = runtime.issue({ ...request, seconds: fixture.lease_seconds }, { request_id: 'harness-issue' });
    leases.push(lease); return lease;
  };
  let selected;
  switch (scenario) {
    case 'non_destructive': case 'missing_lease': selected = evaluate(); break;
    case 'upstream': selected = evaluate({ ...request, ...fixture.forged_request }); break;
    case 'evidence': evaluate(); selected = evaluate({ ...request, ...fixture.evidence }); break;
    case 'human_review': evaluate({ ...request, ...fixture.evidence }); selected = evaluate({ ...request, ...fixture.evidence }); break;
    case 'envelope': evaluate(); selected = evaluate({ ...request, ...fixture.forged_request }); break;
    case 'recovery': while (cursor < turns.length) selected = evaluate(); break;
    case 'scoped_lease': case 'nonce_revoked': case 'epoch_revoked': case 'out_of_scope': {
      evaluate({ ...request, tool: 'fs.list' });
      const lease = issue();
      if (scenario === 'nonce_revoked') runtime.revokeLeaseNonce(lease.lease_id, { request_id: 'harness-revoke' });
      if (scenario === 'epoch_revoked') runtime.revokeAllLeases({ request_id: 'harness-revoke' });
      if (scenario === 'nonce_revoked' || scenario === 'epoch_revoked') {
        while (cursor < turns.length - 1) evaluate({ ...request, tool: 'fs.list' });
      }
      selected = evaluate({ ...request, lease_token: lease.lease_token,
        ...(scenario === 'out_of_scope' ? { args: fixture.other_args } : {}) });
      if (scenario === 'scoped_lease') evaluate({ ...request, lease_token: lease.lease_token, args: fixture.other_args });
      break;
    }
  }
  const tool = loadPolicy().tools.find(tool => tool.id === selected.input.tool);
  return { scenario, observations, selected, leases, toolClass: tool.class,
    // Product events stay here, outside the canonical record. Tokens are returned
    // only to the trusted runner so emission can reject accidental disclosure.
    secrets: leases.map(lease => lease.lease_token),
    controlAudit: ['harness-issue', 'harness-revoke'].flatMap(id => runtime.getEventsForRequest(id)) };
}
