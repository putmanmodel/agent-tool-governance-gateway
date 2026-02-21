import express from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const cdeCliPath = path.resolve(repoRoot, "cde_cli.py");
const cdeServiceUrl = process.env.CDE_SERVICE_URL || "http://127.0.0.1:8008/turn";
const venvPythonPath = path.resolve(repoRoot, ".venv", "bin", "python3");
const pythonCmd = fs.existsSync(venvPythonPath) ? venvPythonPath : "python3";
const decisionLogPath = path.resolve(repoRoot, "logs", "gateway_decisions.jsonl");

const reversibleTools = new Set(["fs.write", "git.commit"]);
const destructiveTools = new Set(["fs.delete", "shell.rm", "git.reset_hard"]);
const leases = new Map();

const app = express();
app.use(express.json({ limit: "1mb" }));

function nowMs() {
  return Date.now();
}

function appendDecisionLog(record) {
  fs.mkdirSync(path.dirname(decisionLogPath), { recursive: true });
  fs.appendFileSync(decisionLogPath, `${JSON.stringify(record)}\n`, "utf8");
}

function hasValidLease(token, tool, scope) {
  if (!token) return false;
  const lease = leases.get(token);
  if (!lease) return false;
  if (lease.tool !== tool || lease.scope !== scope) return false;
  if (lease.expires_at_ms <= nowMs()) {
    leases.delete(token);
    return false;
  }
  return true;
}

function callCdeTurnSubprocess(turnPacket) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonCmd, [cdeCliPath], { cwd: repoRoot });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      reject(err);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`cde_cli exited ${code}: ${stderr.trim()}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (err) {
        reject(new Error(`invalid cde_cli JSON: ${String(err)}`));
      }
    });

    child.stdin.write(JSON.stringify(turnPacket));
    child.stdin.end();
  });
}

async function callCdeTurn(turnPacket) {
  try {
    const response = await fetch(cdeServiceUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(turnPacket),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`cde_service returned ${response.status}: ${text}`);
    }

    return await response.json();
  } catch (_err) {
    return await callCdeTurnSubprocess(turnPacket);
  }
}

app.post("/turn", async (req, res) => {
  try {
    const result = await callCdeTurn(req.body);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

app.post("/lease", (req, res) => {
  const { tool, scope, seconds } = req.body || {};
  const s = Number(seconds);
  if (!tool || !scope || !Number.isFinite(s) || s <= 0) {
    res.status(400).json({ error: "body must include tool, scope, seconds>0" });
    return;
  }

  const leaseToken = crypto.randomUUID();
  const expiresAtMs = nowMs() + Math.floor(s * 1000);
  leases.set(leaseToken, {
    tool,
    scope,
    expires_at_ms: expiresAtMs,
  });

  res.json({
    lease_token: leaseToken,
    expires_at: new Date(expiresAtMs).toISOString(),
  });
});

app.post("/tool", async (req, res) => {
  const body = req.body || {};
  const {
    tool,
    args,
    plan_id,
    user_request,
    speaker_id,
    channel_id,
    task_id,
    scene_id,
    session_id,
    dry_run,
    diff,
    lease_token,
  } = body;

  if (!tool || !plan_id || !user_request || !speaker_id || !channel_id) {
    res.status(400).json({
      error: "required fields: tool,args,plan_id,user_request,speaker_id,channel_id",
    });
    return;
  }

  const turnPacket = {
    turn_id: `tool-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ts: Date.now() / 1000,
    speaker_id,
    channel_id,
    text: `TOOL ${tool} args=${JSON.stringify(args ?? {})} user_request=${user_request}`,
    task_id: task_id ?? null,
    scene_id: scene_id ?? null,
    session_id: session_id ?? "default",
  };

  let turn;
  try {
    turn = await callCdeTurn(turnPacket);
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
    return;
  }

  const topEvent = turn.top_event || {};
  const cdeGate = Number(topEvent?.decision?.policy_gate_level ?? turn?.decision?.policy_gate_level ?? 0);
  const toolFloorGate = destructiveTools.has(tool) ? 2 : (reversibleTools.has(tool) ? 1 : 0);
  const effectiveGate = Math.max(cdeGate, toolFloorGate);

  let status = 200;
  let allow = true;
  let blocked = false;
  let reason = "allowed";
  let requiredEvidence = [];

  if (effectiveGate === 1) {
    const hasDryRun = dry_run === true;
    const hasDiff = diff !== undefined && diff !== null && String(diff).trim().length > 0;
    if (!hasDryRun || !hasDiff) {
      allow = false;
      blocked = true;
      status = 409;
      reason = "gate_1_requires_dry_run_and_diff";
      requiredEvidence = ["dry_run", "diff"];
    }
  }

  if (effectiveGate === 2) {
    if (!destructiveTools.has(tool)) { /* gate 2 from CDE, but tool is non-destructive: no lease required */ }
    const scope = scene_id ?? task_id ?? channel_id;
    const leaseOk = hasValidLease(lease_token, tool, scope);
    if (destructiveTools.has(tool) && !leaseOk) {
      allow = false;
      blocked = true;
      status = 403;
      reason = "gate_2_destructive_tool_requires_valid_lease";
    } else if (destructiveTools.has(tool)) {
      reason = "gate_2_lease_valid";
    } else {
      reason = "gate_2_from_cde_non_destructive";
    }
  }

  const response = {
    allow,
    blocked,
    reason,
    policy_gate_level: effectiveGate,
    cde_gate: cdeGate,
    tool_floor_gate: toolFloorGate,
    effective_gate: effectiveGate,
    required_evidence: requiredEvidence,
    evidence_spans: topEvent?.evidence || [],
    baseline_hash: turn.baseline_hash ?? topEvent?.baseline_hash ?? null,
    extractor_versions: turn.extractor_versions ?? topEvent?.extractor_versions ?? null,
    decision: topEvent?.decision || turn?.decision || {},
    top_event: turn.top_event ?? null,
    events: turn.events ?? [],
  };

  appendDecisionLog({
    ts: new Date().toISOString(),
    endpoint: "/tool",
    tool,
    args: args ?? {},
    plan_id,
    user_request,
    speaker_id,
    channel_id,
    task_id: task_id ?? null,
    scene_id: scene_id ?? null,
    session_id: session_id ?? "default",
    dry_run: dry_run ?? null,
    diff: diff ?? null,
    lease_token_present: Boolean(lease_token),
    ...response,
  });

  res.status(status).json(response);
});

const port = Number(process.env.PORT || 8787);

export function startServer() {
  return app.listen(port, () => {
    console.log(`gateway_node listening on http://localhost:${port}`);
  });
}

if (process.env.NODE_ENV !== "test") {
  startServer();
}
