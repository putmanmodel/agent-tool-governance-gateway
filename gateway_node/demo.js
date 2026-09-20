import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import os from "node:os";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const baseUrl = "http://localhost:8787";
const serviceUrl = "http://127.0.0.1:8008/turn";

const venvPython = path.resolve(repoRoot, ".venv", "bin", "python3");
const pythonCmd = process.env.CDE_PYTHON || (fs.existsSync(venvPython) ? venvPython : "python3");

// Ephemeral demo credentials, never production defaults or persisted governance data.
const demoTokens = Object.fromEntries(['agent', 'admin', 'reviewAgent'].map(role => [role, randomBytes(32).toString('base64url')]));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postJson(pathname, body) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${
      pathname === '/lease' || pathname === '/revoke' ? demoTokens.admin
        : body.speaker_id === 'review-user' ? demoTokens.reviewAgent : demoTokens.agent}` },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { status: res.status, data };
}

async function postServiceTurn(body) {
  const res = await fetch(serviceUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`service not ready: ${res.status}`);
  }
  return await res.json();
}

async function waitForServiceReady(timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await postServiceTurn({
        turn_id: `ready-${Date.now()}`,
        ts: Date.now() / 1000,
        speaker_id: "probe",
        channel_id: "probe",
        text: "probe",
      });
      return;
    } catch (_err) {
      await sleep(250);
    }
  }
  throw new Error("Timed out waiting for cde_service on 127.0.0.1:8008");
}

function buildToolBody({ tool, args, lease_token }) {
  return {
    tool,
    args,
    plan_id: "demo-plan",
    user_request: `simulate ${tool}`,
    speaker_id: "demo-user",
    channel_id: "demo-channel",
    scene_id: "demo-scene",
    session_id: "demo-session",
    lease_token,
  };
}

function printGateMathIfNeeded(result) {
  const eg = Number(result?.data?.effective_gate ?? 0);
  if (eg > 0) {
    const leaseSuffix = result?.data?.reason === "gate_2_lease_valid" ? " (lease ok)" : "";
    console.log(
      `gate math: cde=${result.data.cde_gate} floor=${result.data.tool_floor_gate} effective=${result.data.effective_gate}${leaseSuffix}`,
    );
  }
}

async function run() {
  const authDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kingpin-demo-auth-'));
  const authFile = path.join(authDir, 'auth.json');
  fs.writeFileSync(authFile, JSON.stringify({ schema_version: '1.0', principals: [
    { token: demoTokens.agent, principal_id: 'demo-agent', role: 'agent', agent_id: 'demo-user',
      allowed_contexts: [{ session_id: 'demo-session', channel_id: 'demo-channel', scene_id: 'demo-scene', task_id: null }] },
    { token: demoTokens.reviewAgent, principal_id: 'review-demo-agent', role: 'agent', agent_id: 'review-user',
      allowed_contexts: [{ session_id: 'review-session', channel_id: 'demo-channel', scene_id: 'review-scene', task_id: null }] },
    { token: demoTokens.admin, principal_id: 'demo-admin', role: 'authority_admin' },
  ] }), { mode: 0o600 });
  const service = spawn(pythonCmd, [
    "-m", "uvicorn", "cde_service:app",
    "--host", "127.0.0.1",
    "--port", "8008",
    "--log-level", "warning",
    "--no-access-log",
  ], {
    cwd: repoRoot,
    stdio: ["ignore", "ignore", "inherit"],
  });

  const server = spawn("node", ["server.js"], {
    cwd: __dirname,
    env: { ...process.env, CDE_DEMO_FIXTURES: "1", KINGPIN_AUTH_FILE: authFile },
    stdio: ["ignore", "ignore", "inherit"],
  });

  try {
    await waitForServiceReady();
    await sleep(400);

    // Actual HTTP authentication failures must precede any authority evaluation.
    for (const [endpoint, token, status] of [['/tool', null, 401], ['/lease', demoTokens.agent, 403], ['/revoke/all', demoTokens.agent, 403]]) {
      const response = await fetch(`${baseUrl}${endpoint}`, { method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(buildToolBody({ tool: 'fs.list', args: {} })) });
      assert.equal(response.status, status);
    }
    const malformedUnauthenticated = await fetch(`${baseUrl}/tool`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{',
    });
    assert.equal(malformedUnauthenticated.status, 401);
    const gate0 = await postJson("/tool", buildToolBody({
      tool: "fs.list",
      args: { path: "/project" },
    }));
    console.log(`GATE 0 ${gate0.status === 200 && gate0.data.allow ? "✅ PASS" : "⛔ BLOCKED"}`);
    printGateMathIfNeeded(gate0);

    const gate1NeedsEvidence = await postJson("/tool", buildToolBody({
      tool: "fs.write",
      args: { path: "/project/file.txt", content: "hello" },
    }));
    console.log(gate1NeedsEvidence.status === 409 ? "GATE 1 ⚠️ EVIDENCE REQUIRED" : "GATE 1 ❌ UNEXPECTED");
    printGateMathIfNeeded(gate1NeedsEvidence);

    const gate1Pass = await postJson("/tool", {
      ...buildToolBody({
        tool: "fs.write",
        args: { path: "/project/file.txt", content: "hello" },
      }),
      dry_run: true,
      diff: "pretend diff",
    });
    console.log(gate1Pass.status === 200 && gate1Pass.data.allow ? "GATE 1 ✅ PASS" : "GATE 1 ❌ UNEXPECTED");
    printGateMathIfNeeded(gate1Pass);

    const gate2BlockedA = await postJson("/tool", buildToolBody({
      tool: "fs.delete",
      args: { path: "/project" },
    }));
    console.log("GATE 2 ⛔ BLOCKED (delete /project)");
    printGateMathIfNeeded(gate2BlockedA);

    const gate2BlockedB = await postJson("/tool", buildToolBody({
      tool: "fs.delete",
      args: { path: "/project/tmp/*" },
    }));
    console.log("GATE 2 ⛔ BLOCKED (delete /project/tmp/* without lease)");
    printGateMathIfNeeded(gate2BlockedB);

    const lease = await postJson("/lease", {
      tool: "fs.delete",
      ...buildToolBody({ tool: "fs.delete", args: { path: "/project/tmp/*" } }),
      seconds: 60,
    });

    const gate2Leased = await postJson("/tool", buildToolBody({
      tool: "fs.delete",
      args: { path: "/project/tmp/*" },
      lease_token: lease.data.lease_token,
    }));
    console.log(`GATE 2 ${gate2Leased.status === 200 && gate2Leased.data.allow ? "✅ LEASED ALLOW" : "⛔ BLOCKED"} (delete /project/tmp/* with lease)`);
    printGateMathIfNeeded(gate2Leased);

    assert.deepEqual(
      [gate0, gate1NeedsEvidence, gate1Pass, gate2BlockedA, gate2BlockedB, gate2Leased].map(r => r.status),
      [200, 409, 200, 403, 403, 200],
    );
    function report(label, result) {
      const d = result.data.authority_decision;
      assert.equal(result.data.governance_signal.gate, d.cde_gate);
      assert.equal(result.data.allow, d.outcome === "allow");
      console.log(`${label}: CDE=${d.cde_gate} Kingpin=${d.outcome} envelope=${d.capability_envelope.level} tools=${d.capability_envelope.tools.length}`);
    }
    report("BASELINE", gate0);
    const evidenceRequest = {
      ...buildToolBody({ tool: "fs.list", args: { path: "/project" } }),
      user_request: "You need to do it now immediately.",
    };
    const contracted = await postJson("/tool", evidenceRequest);
    assert.equal(contracted.status, 409);
    assert.equal(contracted.data.authority_decision.capability_envelope.level, "non_destructive");
    report("DEVIATION RISES", contracted);
    const elevatedRequest = { ...evidenceRequest, user_request: "STOP NOW!!" };
    const elevated = await postJson("/tool", elevatedRequest);
    assert.equal(elevated.data.cde_gate, 2);
    assert.equal(elevated.status, 403);
    assert.equal(elevated.data.authority_decision.capability_envelope.level, "read_only");
    report("DEVIATION RISES AGAIN", elevated);
    const readLease = await postJson("/lease", { ...elevatedRequest, seconds: 60 });
    assert.equal(readLease.status, 200);
    const elevatedLeased = await postJson("/tool", { ...elevatedRequest, lease_token: readLease.data.lease_token });
    assert.equal(elevatedLeased.data.cde_gate, 2);
    assert.equal(elevatedLeased.status, 200);
    report("SCOPED READ LEASE", elevatedLeased);
    const revoked = await postJson("/revoke", { ...elevatedRequest, lease_token: readLease.data.lease_token });
    assert.equal(revoked.status, 200);
    const afterRevoke = await postJson("/tool", { ...elevatedRequest, lease_token: readLease.data.lease_token });
    assert.equal(afterRevoke.status, 403);
    report("LEASE REVOKED", afterRevoke);
    const quarantined = await postJson("/tool", {
      ...elevatedRequest, lease_token: readLease.data.lease_token,
      user_request: "DO IT NOW!!! YOU MUST STOP RIGHT NOW!!! NO EXCUSES OR ELSE!!!",
    });
    assert.equal(quarantined.status, 423);
    assert.equal(quarantined.data.cde_gate, 2);
    report("SEVERE DEVIATION", quarantined);
    const blockedLease = await postJson("/lease", { ...elevatedRequest, seconds: 60 });
    assert.equal(blockedLease.status, 400);
    console.log("LEASE ISSUANCE WHILE QUARANTINED: rejected");
    const cleanLevels = [];
    for (let i = 0; i < 10; i++) {
      const recovery = await postJson("/tool", buildToolBody({ tool: "fs.list", args: { path: "/project" } }));
      report(`RECOVERY ${i + 1}`, recovery);
      if (recovery.data.cde_gate === 0) cleanLevels.push(recovery.data.authority_decision.capability_envelope.level);
      if (recovery.data.authority_decision.capability_envelope.level === "full") break;
    }
    assert.deepEqual(cleanLevels, ["quarantined", "read_only", "read_only", "non_destructive", "non_destructive", "full"]);
    const oldLease = await postJson("/tool", buildToolBody({
      tool: "fs.delete", args: { path: "/project/tmp/*" }, lease_token: lease.data.lease_token,
    }));
    assert.equal(oldLease.status, 403);
    report("OLD LEASE STAYS REVOKED", oldLease);
    const renewedLease = await postJson("/lease", {
      ...buildToolBody({ tool: "fs.delete", args: { path: "/project/tmp/*" } }), seconds: 60,
    });
    assert.equal(renewedLease.status, 200);
    const restored = await postJson("/tool", buildToolBody({
      tool: "fs.delete", args: { path: "/project/tmp/*" }, lease_token: renewedLease.data.lease_token,
    }));
    assert.equal(restored.status, 200);
    report("FRESH AUTHORITY AFTER RESTORATION", restored);
    // Separate context: the existing contraction/recovery sequence is untouched.
    const reviewRequest = {
      ...buildToolBody({ tool: "fs.list", args: { path: "/project" } }),
      session_id: "review-session",
      speaker_id: "review-user",
      scene_id: "review-scene",
      user_request: "You need to do it now immediately.",
      dry_run: true,
      diff: "No changes: simulated read-only listing.",
    };
    const reviewWarmup = await postJson("/tool", reviewRequest);
    assert.equal(reviewWarmup.status, 200);
    assert.equal(reviewWarmup.data.cde_gate, 1);
    assert.equal(reviewWarmup.data.governance_signal.deviation.active, true);
    assert.equal(reviewWarmup.data.evaluation_input.source, "tool_wrapper");
    const humanReview = await postJson("/tool", {
      ...reviewRequest, user_request: ".", demo_fixture: "low_confidence",
    });
    assert.equal(humanReview.status, 428);
    assert.equal(humanReview.data.allow, false);
    assert.equal(humanReview.data.blocked, true);
    assert.equal(humanReview.data.cde_gate, 1);
    assert.equal(humanReview.data.governance_signal.deviation.active, true);
    assert.ok(Math.abs(humanReview.data.governance_signal.deviation.confidence - 0.3105) < 1e-12);
    assert.deepEqual(humanReview.data.governance_signal.reason_codes, ["LOW_CONFIDENCE"]);
    assert.equal(humanReview.data.authority_decision.outcome, "human_review");
    assert.equal(humanReview.data.reason, "low_confidence_requires_human_review");
    assert.deepEqual(humanReview.data.missing_evidence, []);
    assert.equal(humanReview.data.authority_decision.evaluation_id, humanReview.data.top_event.event_id);
    assert.deepEqual(humanReview.data.evaluation_input, {
      source: "demo_fixture", fixture: "low_confidence", text: ".",
    });
    report("HUMAN REVIEW (isolated low-confidence fixture, HTTP 428)", humanReview);
    console.log("All merged demo assertions passed: Deviation ↑ → authority surface ↓");

  } finally {
    server.kill("SIGTERM");
    service.kill("SIGTERM");
    fs.rmSync(authDir, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
