import test from "node:test";
import assert from "node:assert/strict";
import { enforceGovernance } from "./enforcement.js";
import { DemoAuthority } from "./demo_authority.js";

const signal = gate => ({ schema_version: "1.0", gate,
  gate_label: ["PASS", "EVIDENCE REQUIRED", "LEASE REQUIRED"][gate],
  evidence_requirements: gate === 1 ? ["dry_run", "diff"] : [],
  authority: { requirement: gate === 2 ? "lease" : "none" } });
const request = { tool: "fs.list", channel_id: "channel", task_id: "task", scene_id: "scene" };

test("all CDE gates and tool floors; authority cannot lower CDE gate", () => {
  const authority = new DemoAuthority();
  for (const gate of [0, 1, 2]) {
    for (const [tool, floor] of [["fs.list", 0], ["fs.write", 1], ["fs.delete", 2]]) {
      const result = enforceGovernance(signal(gate), { ...request, tool }, authority);
      assert.equal(result.response.cde_gate, gate);
      assert.equal(result.response.effective_gate, Math.max(gate, floor));
      assert.equal(result.status, [200, 409, 403][Math.max(gate, floor)]);
    }
  }
});

test("Gate 1 checks both pieces of evidence", () => {
  for (const fields of [{}, { dry_run: true }, { diff: "diff" }, { dry_run: true, diff: " " }]) {
    assert.equal(enforceGovernance(signal(1), { ...request, ...fields }, new DemoAuthority()).status, 409);
  }
  assert.equal(enforceGovernance(signal(1), { ...request, dry_run: true, diff: "diff" }, new DemoAuthority()).status, 200);
});

test("CDE Gate 2 requires external lease even for non-destructive tools", () => {
  let now = 1000;
  const authority = new DemoAuthority(() => now);
  const lease = authority.issue({ tool: request.tool, scope: "scene", seconds: 1 });
  const leased = { ...request, lease_token: lease.lease_token };
  assert.equal(enforceGovernance(signal(2), leased, authority).status, 200);
  assert.equal(enforceGovernance(signal(2), { ...leased, tool: "fs.write" }, authority).status, 403);
  assert.equal(enforceGovernance(signal(2), { ...leased, scene_id: "wrong" }, authority).status, 403);
  assert.equal(enforceGovernance(signal(2), { ...leased, lease_token: "unknown" }, authority).status, 403);
  now = 2000;
  assert.equal(enforceGovernance(signal(2), leased, authority).status, 403);
});

test("missing/malformed signals fail closed", () => {
  for (const bad of [null, {}, { ...signal(0), gate: 3 }, { ...signal(0), schema_version: "2.0" }, { ...signal(2), authority: {} }]) {
    assert.throws(() => enforceGovernance(bad, request, new DemoAuthority()));
  }
});
