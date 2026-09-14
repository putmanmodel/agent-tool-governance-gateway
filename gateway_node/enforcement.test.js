import test from "node:test";
import assert from "node:assert/strict";
import { enforceAuthorityDecision } from "./enforcement.js";
import { KingpinAuthority } from "./kingpin/authority.js";

const request = { tool: "fs.list", args: { path: "/project" }, session_id: "s", speaker_id: "actor",
  channel_id: "channel", task_id: "task", scene_id: "scene" };
const signal = (gate, reason = ["DEVIATION_INACTIVE", "REVIEW_THRESHOLD_REACHED", "LEASE_THRESHOLD_REACHED"][gate]) => ({
  schema_version: "1.0", scope_key: "scene:scene", gate,
  gate_label: ["PASS", "EVIDENCE REQUIRED", "LEASE REQUIRED"][gate],
  evidence_requirements: gate === 1 ? ["dry_run", "diff"] : [], reason_codes: [reason],
  authority: { requirement: gate === 2 ? "lease" : "none", recommendation: gate === 2 ? "request_external_lease" : "none" },
  deviation: { severity: [.1, .6, .8][gate], ema_severity: [.1, .5, .7][gate], confidence: .9,
    active: gate !== 0, enter: false, exit: false, vector: { lexical: 1, pragmatic: 1 } },
});
let seq = 0;
const decide = (authority, s = signal(0), req = request) => authority.decide(s, req, `event-${++seq}`);
const issue = (authority, req = request, seconds = 60) => authority.issue({ ...req, seconds }).lease_token;

test("original six baseline outcomes remain Kingpin-owned", () => {
  const a = new KingpinAuthority();
  assert.equal(enforceAuthorityDecision(decide(a)).status, 200);
  const write = { ...request, tool: "fs.write" };
  assert.equal(enforceAuthorityDecision(decide(a, signal(0), write)).status, 409);
  assert.equal(enforceAuthorityDecision(decide(a, signal(0), { ...write, dry_run: true, diff: "diff" })).status, 200);
  const del = { ...request, tool: "fs.delete" };
  assert.equal(enforceAuthorityDecision(decide(a, signal(0), del)).status, 403);
  assert.equal(enforceAuthorityDecision(decide(a, signal(0), del)).status, 403);
  assert.equal(enforceAuthorityDecision(decide(a, signal(0), { ...del, lease_token: issue(a, del) })).status, 200);
});

test("deviation contracts envelopes monotonically and leases cannot override them", () => {
  const a = new KingpinAuthority();
  const sets = [];
  sets.push(decide(a).capability_envelope.tools);
  const destructive = { ...request, tool: "fs.delete" };
  const token = issue(a, destructive);
  sets.push(decide(a, signal(1)).capability_envelope.tools);
  assert.equal(decide(a, signal(1), { ...destructive, lease_token: token }).outcome, "deny");
  assert.throws(() => issue(a, destructive));
  sets.push(decide(a, signal(2)).capability_envelope.tools);
  const readToken = issue(a);
  assert.equal(decide(a, signal(2), { ...request, lease_token: readToken }).outcome, "allow");
  const q = decide(a, signal(2, "QUARANTINE_THRESHOLD_REACHED"), { ...request, lease_token: readToken });
  assert.equal(q.outcome, "quarantine"); sets.push(q.capability_envelope.tools);
  assert.deepEqual(sets.map(s => s.length), [7, 4, 2, 0]);
  for (let i = 1; i < sets.length; i++) assert.ok(sets[i].every(tool => sets[i - 1].includes(tool)));
  assert.throws(() => issue(a));
});

test("every gate retains its evidence/lease minimum; unknown tools denied", () => {
  for (const gate of [0, 1, 2]) {
    for (const [tool, floor] of [["fs.list", 0], ["fs.write", 1], ["fs.delete", 2]]) {
      const a = new KingpinAuthority();
      const d = decide(a, signal(gate), { ...request, tool });
      assert.equal(d.cde_gate, gate);
      assert.equal(d.effective_gate, Math.max(gate, floor));
      if (Math.max(gate, floor) === 2) assert.notEqual(d.outcome, "allow");
    }
  }
  assert.equal(decide(new KingpinAuthority(), signal(0), { ...request, tool: "unknown" }).outcome, "deny");
});

test("Gate 1 constrains until both evidence artifacts exist", () => {
  const a = new KingpinAuthority();
  for (const fields of [{}, { dry_run: true }, { diff: "diff" }, { dry_run: true, diff: " " }]) {
    assert.equal(decide(a, signal(1), { ...request, ...fields }).outcome, "constrain");
  }
  assert.equal(decide(a, signal(1), { ...request, dry_run: true, diff: "diff" }).outcome, "allow");
});

test("leases bind actor/session/channel/scope/tool/args and expire at boundary", () => {
  let now = 1000;
  const a = new KingpinAuthority({ clock: () => now });
  decide(a);
  const leased = { ...request, lease_token: issue(a, request, 1) };
  assert.equal(a.hasValidLease(leased), true);
  for (const field of ["session_id", "speaker_id", "channel_id", "scene_id", "tool"]) {
    assert.equal(a.hasValidLease({ ...leased, [field]: "other" }), false);
  }
  assert.equal(a.hasValidLease({ ...leased, args: { path: "/elsewhere" } }), false);
  assert.equal(a.hasValidLease({ ...leased, lease_token: "unknown" }), false);
  now = 2000;
  assert.equal(a.hasValidLease(leased), false);
});

test("canonical argument order, lease revocation and capability revocation", () => {
  const a = new KingpinAuthority(); decide(a);
  const req = { ...request, args: { b: 2, a: 1 } };
  const token = issue(a, req);
  assert.ok(a.hasValidLease({ ...req, args: { a: 1, b: 2 }, lease_token: token }));
  assert.throws(() => a.revoke({ ...req, session_id: "other", lease_token: token }));
  a.revoke({ ...req, lease_token: token });
  assert.equal(a.hasValidLease({ ...req, lease_token: token }), false);
  a.revoke(request);
  assert.equal(decide(a).reason, "capability_revoked");
  assert.throws(() => issue(a));
});

test("re-entry takes two distinct clean evaluations per step, resets on deviation", () => {
  const a = new KingpinAuthority(); decide(a);
  const token = issue(a);
  decide(a, signal(2, "QUARANTINE_THRESHOLD_REACHED"));
  assert.equal(decide(a).capability_envelope.clean_evaluations, 1);
  decide(a, signal(1));
  assert.equal(decide(a).capability_envelope.level, "quarantined");
  assert.equal(decide(a).capability_envelope.level, "read_only");
  assert.equal(decide(a).capability_envelope.level, "read_only");
  assert.equal(decide(a).capability_envelope.level, "non_destructive");
  assert.equal(decide(a).capability_envelope.level, "non_destructive");
  assert.equal(decide(a).capability_envelope.level, "full");
  assert.equal(a.hasValidLease({ ...request, lease_token: token }), false);
  assert.ok(a.hasValidLease({ ...request, lease_token: issue(a) }));
});

test("restoration never clears explicit capability revocation", () => {
  const a = new KingpinAuthority(); decide(a); a.revoke({ ...request, tool: "fs.write" });
  decide(a, signal(2));
  for (let i = 0; i < 4; i++) decide(a);
  assert.equal(decide(a, signal(0), { ...request, tool: "fs.write" }).reason, "capability_revoked");
});

test("duplicate evaluations cannot accelerate restoration; contexts are isolated", () => {
  const a = new KingpinAuthority(); decide(a, signal(2));
  a.decide(signal(0), request, "same");
  assert.throws(() => a.decide(signal(0), request, "same"));
  assert.equal(decide(a, signal(0), { ...request, session_id: "other" }).capability_envelope.level, "full");
  assert.equal(decide(a).capability_envelope.level, "non_destructive");
});

test("low confidence requires human review even with evidence", () => {
  const a = new KingpinAuthority();
  const d = decide(a, signal(1, "LOW_CONFIDENCE"), { ...request, dry_run: true, diff: "diff" });
  assert.equal(d.outcome, "human_review"); assert.equal(enforceAuthorityDecision(d).status, 428);
});

test("invalid signals fail closed before mutating state", () => {
  const a = new KingpinAuthority();
  for (const bad of [null, {}, { ...signal(0), gate: 3 }, { ...signal(0), schema_version: "2.0" },
    { ...signal(2), authority: {} }, { ...signal(0), scope_key: "scene:other" },
    { ...signal(0), deviation: { ...signal(0).deviation, severity: NaN } },
    { ...signal(1), reason_codes: ["DEVIATION_INACTIVE"] }]) {
    assert.throws(() => decide(a, bad));
  }
  assert.equal(a.states.size, 0);
  assert.throws(() => issue(a));
});

test("gateway mechanically enforces all five outcomes; CDE input remains unchanged", () => {
  const a = new KingpinAuthority(); const s = signal(0); const original = structuredClone(s);
  const d = decide(a, s); assert.deepEqual(s, original);
  for (const [outcome, status] of Object.entries({ allow: 200, constrain: 409, deny: 403, quarantine: 423, human_review: 428 })) {
    const result = enforceAuthorityDecision({ ...d, outcome });
    assert.equal(result.status, status); assert.equal(result.response.allow, outcome === "allow");
  }
  assert.throws(() => enforceAuthorityDecision(null));
  assert.throws(() => enforceAuthorityDecision({ ...d, issuer: "cde" }));
});

test("identical ordered evaluation streams deterministically restore identical envelopes", () => {
  const left = new KingpinAuthority(); const right = new KingpinAuthority();
  const stream = [signal(0), signal(1), signal(2), signal(2, "QUARANTINE_THRESHOLD_REACHED"),
    signal(0), signal(1), ...Array.from({ length: 6 }, () => signal(0))];
  stream.forEach((s, i) => {
    assert.deepEqual(left.decide(s, request, `replay-${i}`), right.decide(s, request, `replay-${i}`));
  });
});
