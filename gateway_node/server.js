import crypto from "node:crypto";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { buildEvaluationInput } from "./demo_input.js";
import { loadAuthentication, AccessError } from "../kingpin/auth/access.js";
import { KingpinAuthority } from "../kingpin/index.js";
import { enforceAuthorityDecision } from "./enforcement.js";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const cdeServiceUrl = process.env.CDE_SERVICE_URL || "http://127.0.0.1:8008/turn";
const decisionLogPath = path.resolve(repoRoot, "logs", "gateway_decisions.jsonl");

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

// Injected collaborators make the transport boundary testable without duplicating policy.
export function createGatewayApp({
  authentication = loadAuthentication(),
  authority = new KingpinAuthority(),
  evaluateTurn = callCdeTurn,
  logDecision = appendDecisionLog,
  mode = "demo",
  adapter = null,
  execution = null,
  build = null,
} = {}) {
  if (!['demo','evaluation'].includes(mode)) throw Error('Unsupported runtime mode');
  if (mode === 'evaluation' && (!adapter || !execution || !build || process.env.CDE_DEMO_FIXTURES === '1')) throw Error('Evaluation requires configured adapter/execution/build and forbids demo fixtures');
  const app = express();
  const authenticatedRequests = new WeakMap();
  function auditContext(req, res) {
    req.auditContext ??= { request_id: crypto.randomUUID(), principal_id: null,
      decision_id: null, redact: record => authentication.redact(record) };
    res.set?.('X-Request-ID', req.auditContext.request_id);
    return req.auditContext;
  }
  function authenticationRejected(req, res, status) {
    const context = auditContext(req, res);
    try { authority.recordAuthenticationRejection(context, status === 401 ? 'AUTHENTICATION_REQUIRED' : 'FORBIDDEN'); } catch {}
  }
  function authenticateRequest(req) {
    if (!authenticatedRequests.has(req)) {
      authenticatedRequests.set(req, authentication.authenticate(req.headers?.authorization));
    }
    return authenticatedRequests.get(req);
  }
  // Reject unauthenticated callers before parsing any operational payload.
  app.use((req, res, next) => {
    try { authenticateRequest(req); next(); }
    catch {
      authenticationRejected(req, res, 401);
      res.status(401).json({ error: "Authentication required" });
    }
  });
  app.use(express.json({ limit: "1mb" }));
  // Serialize this gateway's evaluation → authority → enforcement sequence.
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
        if (req.governedTool) {
          try { authority.recordEnforcement({}, req.auditContext, { outcome: 'failed', reason_codes: ['RUNTIME_FAILURE'] }); } catch {}
        }
        if (!res.headersSent) res.status(500).json({ error: "Operation failed" });
      } finally {
        // Do not release on client disconnect while evaluation is still running.
        release();
      }
    };
  }

  // Authentication and ownership precede CDE and authority access; refusals append audit evidence only.
  function protectedRoute(permission, handler) {
    const execute = serialized(handler);
    return async (req, res) => {
      try {
        const context = auditContext(req, res);
        const principal = authenticateRequest(req);
        context.principal_id = principal.principal_id;
        authentication.authorize(principal, permission, req.body);
        if (permission === "runtime.evaluate" && req.body?.lease_token) {
          authentication.authorize(principal, "runtime.use_lease", req.body);
        }
        req.authPrincipal = principal;
      } catch (error) {
        const status = error instanceof AccessError ? error.status : 401;
        authenticationRejected(req, res, status);
        res.status(status).json({ error: status === 401 ? "Authentication required" : "Forbidden" });
        return;
      }
      return execute(req, res);
    };
  }
  function audit(req, record) {
    logDecision(authentication.redact({ ...record, principal_id: req.authPrincipal.principal_id }));
  }

  app.post("/turn", protectedRoute("runtime.evaluate", async (req, res) => {
    try {
      const result = await evaluateTurn(req.body);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: "Operation rejected" });
    }
  }));

  app.post("/lease", protectedRoute("authority.issue_lease", (req, res) => {
    try {
      const lease = authority.issue(req.body || {}, req.auditContext);
      audit(req, { ts: new Date().toISOString(), endpoint: "/lease", issuer: "kingpin",
        context: lease.context, tool: req.body.tool, expires_at: lease.expires_at, lease_id: lease.lease_id });
      res.json(lease);
    } catch (err) {
      res.status(400).json({ error: "Operation rejected" });
    }
  }));

  app.post("/revoke", protectedRoute("authority.revoke_lease", (req, res) => {
    try {
      const result = authority.revoke(req.body || {}, req.auditContext);
      audit(req, { ts: new Date().toISOString(), endpoint: "/revoke", ...result });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: "Operation rejected" });
    }
  }));

  const toolHandler = protectedRoute("runtime.evaluate", async (req, res) => {
    req.governedTool = true;
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
      try { authority.recordEnforcement({}, req.auditContext, { outcome: 'failed', reason_codes: ['INVALID_REQUEST'] }); } catch {}
      res.status(400).json({
        error: "required fields: tool,args,plan_id,user_request,speaker_id,channel_id",
      });
      return;
    }

    let evaluationInput;
    try {
      if (mode === 'evaluation' && ['demo_fixture','governance_signal','force_gate','force_recovery','evaluation_id'].some(key => Object.hasOwn(body, key))) throw Error('Unsupported control input');
      evaluationInput = req.observedTool ? { source: 'agent_observation', text: body.user_request }
        : buildEvaluationInput(body, mode === 'demo' && process.env.CDE_DEMO_FIXTURES === "1");
    } catch (err) {
      try { authority.recordEnforcement({}, req.auditContext, { outcome: 'failed', reason_codes: ['INVALID_REQUEST'] }); } catch {}
      res.status(400).json({ error: "Operation rejected" });
      return;
    }

    const turnPacket = {
      turn_id: `tool-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      ts: Date.now() / 1000,
      speaker_id,
      channel_id,
      text: evaluationInput.text,
      task_id: task_id ?? null,
      scene_id: scene_id ?? null,
      session_id: session_id ?? "default",
    };

    let turn;
    try {
      turn = await evaluateTurn(turnPacket);
    } catch (err) {
      try { authority.recordEnforcement(body, req.auditContext, { outcome: 'failed', reason_codes: ['CDE_UNAVAILABLE'] }); } catch {}
      res.status(503).json({ error: "Evaluation unavailable" });
      return;
    }

    const topEvent = turn.top_event || {};
    let enforcement;
    try {
      req.auditContext.decision_id = crypto.randomUUID();
      const authorityDecision = authority.decide(turn.governance_signal, body, topEvent.event_id, req.auditContext);
      enforcement = enforceAuthorityDecision(authorityDecision);
      const reviewId = authority.reviewIdForDecision?.(authorityDecision);
      if (reviewId) res.set?.('X-Review-ID', reviewId);
    } catch (err) {
      try { authority.recordEnforcement(body, req.auditContext, { outcome: 'failed',
        evaluation_id: topEvent.event_id ?? null, reason_codes: ['AUTHORITY_OR_AUDIT_FAILURE'] }); } catch {}
      res.status(502).json({ error: "Authority operation failed" });
      return;
    }
    const response = {
      ...enforcement.response,
      evaluation_input: evaluationInput,
      governance_signal: turn.governance_signal,
      evidence_spans: topEvent?.evidence || [],
      baseline_hash: turn.baseline_hash ?? topEvent?.baseline_hash ?? null,
      extractor_versions: turn.extractor_versions ?? topEvent?.extractor_versions ?? null,
      decision: topEvent?.decision || turn?.decision || {},
      top_event: turn.top_event ?? null,
      events: turn.events ?? [],
    };

    audit(req, {
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

    try {
      authority.recordEnforcement(body, req.auditContext, { outcome: response.authority_decision.outcome,
        evaluation_id: response.authority_decision.evaluation_id, reason_codes: response.authority_decision.reason_codes });
    } catch {
      res.status(502).json({ error: "Authority operation failed" });
      return;
    }
    if (response.allow && adapter) {
      try {
        const receipt = execution.run(execution.capture(body, response.authority_decision, req.auditContext), body);
        if (receipt.error) {
          try { authority.recordEnforcement(body, req.auditContext, { outcome: 'failed', evaluation_id: response.authority_decision.evaluation_id, reason_codes: ['ADAPTER_FAILURE'] }); } catch {}
          res.status(receipt.execution_status === 'failed' ? 422 : 503).json(receipt); return;
        }
        Object.assign(response, receipt);
      }
      catch (error) {
        if (error.code === 'EXECUTION_CONFLICT') { res.status(409).json({ error: 'Execution already recorded or reconciliation required', execution_id: error.execution_id }); return; }
        try { authority.recordEnforcement(body, req.auditContext, { outcome: 'failed', evaluation_id: response.authority_decision.evaluation_id, reason_codes: ['ADAPTER_FAILURE'] }); } catch {}
        res.status(422).json({ error: 'Sandbox operation failed', execution_authorized: true }); return;
      }
    }
    res.status(enforcement.status).json(response);
  });
  app.post('/tool', toolHandler);
  if (mode === 'evaluation') {
    app.post('/tool/observed', (req, res) => { req.observedTool = true; return toolHandler(req, res); });
    // No configuration, credentials, filesystem paths or operational payloads.
    app.get('/status', (req, res) => {
      try { authenticateRequest(req); res.json(build); }
      catch { res.status(401).json({ error: 'Authentication required' }); }
    });
    app.get('/executions', protectedRoute('execution.read', (req, res) => {
      try { res.json({ executions: execution.list(req.authPrincipal) }); } catch { res.status(403).json({ error: 'Execution unavailable' }); }
    }));
    app.get('/executions/:execution_id', protectedRoute('execution.read', (req, res) => {
      try { res.json(execution.get(req.params.execution_id, req.authPrincipal)); } catch { res.status(403).json({ error: 'Execution unavailable' }); }
    }));
    app.post('/executions/:execution_id/reconcile', protectedRoute('execution.reconcile', (req, res) => {
      try { res.json(execution.reconcile(req.params.execution_id, req.authPrincipal)); } catch { res.status(409).json({ error: 'Reconciliation unavailable' }); }
    }));
    app.post('/executions/:execution_id/resolve', protectedRoute('execution.resolve', (req, res) => {
      try { res.json(execution.resolve(req.params.execution_id, req.body?.outcome, req.authPrincipal, req.auditContext)); } catch { res.status(409).json({ error: 'Disposition unavailable' }); }
    }));
    app.get('/audit/:request_id', protectedRoute('audit.read', (req, res) => {
      try { res.json({ events: authority.getEventsForRequest(req.params.request_id) }); }
      catch { res.status(503).json({ error: 'Audit unavailable' }); }
    }));
  }
  app.post("/revoke/nonce", protectedRoute("authority.revoke_lease", (req, res) => {
    try {
      const result = authority.revokeLeaseNonce(req.body?.lease_nonce, req.auditContext);
      audit(req, { ts: new Date().toISOString(), endpoint: "/revoke/nonce", ...result });
      res.json(result);
    } catch { res.status(400).json({ error: "Operation rejected" }); }
  }));

  app.post("/revoke/all", protectedRoute("authority.revoke_all", (req, res) => {
    try {
      const result = authority.revokeAllLeases(req.auditContext);
      audit(req, { ts: new Date().toISOString(), endpoint: "/revoke/all", ...result });
      res.json(result);
    } catch { res.status(400).json({ error: "Operation rejected" }); }
  }));

  app.get('/reviews', protectedRoute('review.access', (req, res) => {
    try { res.json({ reviews: authority.listReviews(req.authPrincipal) }); }
    catch { res.status(403).json({ error: 'Review unavailable or forbidden' }); }
  }));
  app.get('/reviews/:review_id', protectedRoute('review.access', (req, res) => {
    try { res.json(authority.getReview(req.params.review_id, req.authPrincipal)); }
    catch { res.status(403).json({ error: 'Review unavailable or forbidden' }); }
  }));
  for (const resolution of ['approve', 'deny']) {
    app.post(`/reviews/:review_id/${resolution}`, protectedRoute('review.resolve', (req, res) => {
      try { res.json(authority.resolveReview(req.params.review_id, resolution, req.authPrincipal, req.auditContext)); }
      catch { res.status(409).json({ error: 'Review unavailable, forbidden or already resolved' }); }
    }));
  }
  app.post('/reviews/:review_id/execute', protectedRoute('runtime.evaluate', (req, res) => {
    try {
      const result = authority.consumeReview(req.params.review_id, req.body, req.authPrincipal);
      if (!result.execution_authorized) {
        res.status(403).json({ review_id: result.review_id, execution_authorized: false, reason: result.reason });
        return;
      }
      const enforcement = enforceAuthorityDecision(result.authority_decision);
      authority.recordEnforcement(req.body, { ...result.correlation, principal_id: req.authPrincipal.principal_id,
        redact: value => authentication.redact(value) }, { outcome: result.authority_decision.outcome,
        evaluation_id: result.authority_decision.evaluation_id, reason_codes: result.authority_decision.reason_codes });
      const toolResult = adapter ? execution.run(execution.capture(req.body, result.authority_decision,
        { ...result.correlation, principal_id: req.authPrincipal.principal_id, redact: value => authentication.redact(value) }, result.review_id), req.body) : {};
      if (toolResult.error) {
        try { authority.recordEnforcement(req.body, { ...result.correlation, principal_id: req.authPrincipal.principal_id },
          { outcome: 'failed', evaluation_id: result.authority_decision.evaluation_id, reason_codes: ['ADAPTER_FAILURE'] }); } catch {}
        res.status(toolResult.execution_status === 'failed' ? 422 : 503).json(toolResult); return;
      }
      res.status(enforcement.status).json({ ...enforcement.response, ...toolResult, review_id: result.review_id,
        execution_authorized: true, authorization_consumed: true });
    } catch { res.status(409).json({ error: 'Review execution refused' }); }
  }));
  app.get('/review/access', protectedRoute('review.access', (req, res) => {
    res.json({ principal_id: req.authPrincipal.principal_id, role: req.authPrincipal.role,
      resolution_supported: true });
  }));
  // Do not expose JSON parser stacks, internal errors or reflected payloads.
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (req.path === '/tool') {
      const context = auditContext(req, res);
      context.principal_id = authenticatedRequests.get(req)?.principal_id ?? null;
      try { authority.recordEnforcement({}, context, { outcome: 'failed', reason_codes: ['INVALID_REQUEST'] }); } catch {}
    }
    res.status(err.type === "entity.too.large" ? 413 : 400).json({ error: "Invalid request" });
  });
  return app;
}

const port = Number(process.env.PORT || 8787);

export function startServer() {
  return createGatewayApp().listen(port, "127.0.0.1", () => {
    console.log(`gateway_node v0.4.0-dev mode=demo storage=memory policy=demo_v1 listening on http://localhost:${port}`);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename && process.env.NODE_ENV !== "test") {
  startServer();
}
