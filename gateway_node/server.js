import express from "express";
import fs from "node:fs";
import path from "node:path";
import { KingpinAuthority } from "./kingpin/authority.js";
import { enforceAuthorityDecision } from "./enforcement.js";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const cdeServiceUrl = process.env.CDE_SERVICE_URL || "http://127.0.0.1:8008/turn";
const decisionLogPath = path.resolve(repoRoot, "logs", "gateway_decisions.jsonl");

const authority = new KingpinAuthority();

const app = express();
app.use(express.json({ limit: "1mb" }));
// Serialize this in-memory demo's evaluation → authority → enforcement sequence.
// A lease/revocation cannot interleave between an authority decision and its use.
let pending = Promise.resolve();
function serialized(handler) {
  return async (req, res) => {
    const previous = pending;
    let release;
    pending = new Promise(resolve => { release = resolve; });
    await previous;
    try {
      await handler(req, res);
    } catch (err) {
      if (!res.headersSent) res.status(500).json({ error: String(err.message || err) });
    } finally {
      // Do not release on client disconnect while evaluation is still running.
      release();
    }
  };
}

function appendDecisionLog(record) {
  fs.mkdirSync(path.dirname(decisionLogPath), { recursive: true });
  fs.appendFileSync(decisionLogPath, `${JSON.stringify(record)}\n`, "utf8");
}

async function callCdeTurn(turnPacket) {
  // A fresh CLI process would silently discard session EMA/hysteresis history.
  const response = await fetch(cdeServiceUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(turnPacket),
  });
  if (!response.ok) throw new Error(`cde_service returned ${response.status}: ${await response.text()}`);
  return await response.json();
}

app.post("/turn", serialized(async (req, res) => {
  try {
    const result = await callCdeTurn(req.body);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
}));

app.post("/lease", serialized((req, res) => {
  try {
    const lease = authority.issue(req.body || {});
    appendDecisionLog({ ts: new Date().toISOString(), endpoint: "/lease", issuer: "kingpin",
      context: lease.context, tool: req.body.tool, expires_at: lease.expires_at, lease_id: lease.lease_id });
    res.json(lease);
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
}));

app.post("/revoke", serialized((req, res) => {
  try {
    const result = authority.revoke(req.body || {});
    appendDecisionLog({ ts: new Date().toISOString(), endpoint: "/revoke", ...result });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
}));

app.post("/tool", serialized(async (req, res) => {
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
    res.status(503).json({ error: String(err.message || err) });
    return;
  }

  const topEvent = turn.top_event || {};
  let enforcement;
  try {
    const authorityDecision = authority.decide(turn.governance_signal, body, topEvent.event_id);
    enforcement = enforceAuthorityDecision(authorityDecision);
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
    return;
  }
  const response = {
    ...enforcement.response,
    governance_signal: turn.governance_signal,
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

  res.status(enforcement.status).json(response);
}));

const port = Number(process.env.PORT || 8787);

export function startServer() {
  return app.listen(port, "127.0.0.1", () => {
    console.log(`gateway_node listening on http://localhost:${port}`);
  });
}

if (process.env.NODE_ENV !== "test") {
  startServer();
}
