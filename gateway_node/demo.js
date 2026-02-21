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
const pythonCmd = fs.existsSync(venvPython) ? venvPython : "python3";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postJson(pathname, body) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
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
  const service = spawn(pythonCmd, [
    "-m", "uvicorn", "cde_service:app",
    "--host", "127.0.0.1",
    "--port", "8008",
    "--log-level", "warning",
    "--no-access-log",
  ], {
    cwd: repoRoot,
    stdio: ["ignore", "ignore", "ignore"],
  });

  const server = spawn("node", ["server.js"], {
    cwd: __dirname,
    stdio: ["ignore", "ignore", "ignore"],
  });

  try {
    await waitForServiceReady();
    await sleep(400);

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
      scope: "demo-scene",
      seconds: 60,
    });

    const gate2Leased = await postJson("/tool", buildToolBody({
      tool: "fs.delete",
      args: { path: "/project/tmp/*" },
      lease_token: lease.data.lease_token,
    }));
    console.log(`GATE 2 ${gate2Leased.status === 200 && gate2Leased.data.allow ? "✅ LEASED ALLOW" : "⛔ BLOCKED"} (delete /project/tmp/* with lease)`);
    printGateMathIfNeeded(gate2Leased);

    console.log("\n/statuses", {
      gate0: gate0.status,
      gate1_evidence_required: gate1NeedsEvidence.status,
      gate1_pass: gate1Pass.status,
      gate2_blocked_project: gate2BlockedA.status,
      gate2_blocked_tmp_no_lease: gate2BlockedB.status,
      gate2_leased_tmp: gate2Leased.status,
    });
  } finally {
    server.kill("SIGTERM");
    service.kill("SIGTERM");
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
