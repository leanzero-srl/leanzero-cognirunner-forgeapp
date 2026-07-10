/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/*
 * DEV-ONLY test-state web trigger for the forge-live-harness E2E suite.
 * Gated by HARNESS_SECRET (set ONLY in the development environment). Returns 404
 * unless the secret is configured (absent in prod) AND matches the Bearer header.
 * Read-only.
 */
import storage from "@forge/kvs";

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": ["application/json"] },
  body: JSON.stringify(body),
});
const notFound = () => ({ statusCode: 404, headers: { "Content-Type": ["text/plain"] }, body: "not found" });
const q = (req, n) => {
  const v = req && req.queryParameters && req.queryParameters[n];
  return Array.isArray(v) ? v[0] : v;
};

export async function testStateTrigger(req) {
  const secret = process.env.HARNESS_SECRET;
  if (!secret) return notFound();
  const authArr = (req && req.headers && (req.headers.authorization || req.headers.Authorization)) || null;
  const auth = Array.isArray(authArr) ? authArr[0] : authArr;
  const provided = typeof auth === "string" ? auth.replace(/^Bearer\s+/i, "").trim() : "";
  if (!provided || provided !== secret) return notFound();

  // Dev-gated POST action for the it12 import-commit smoke. Runs the SAME
  // commitImportCore the resolver uses (dynamic import avoids the index<->test-hook
  // top-level cycle; resolves the already-loaded module at call time). accountId:null
  // is safe — the HARNESS_SECRET Bearer gate above is the authorization.
  if (String((req && req.method) || "GET").toUpperCase() === "POST") {
    let body = {};
    try { body = JSON.parse((req && req.body) || "{}"); } catch (e) { return json(400, { error: "invalid JSON body" }); }
    if (body.action === "commit") {
      try {
        const { commitImportCore } = await import("./index.js");
        const r = await commitImportCore({ rule: body.rule, targetWorkflowName: body.targetWorkflowName, targetTransitionId: body.targetTransitionId, bindings: body.bindings || {}, accountId: null });
        return json(200, r);
      } catch (e) {
        return json(500, { error: String((e && e.message) || e) });
      }
    }
    return json(400, { error: `unknown POST action=${body.action}` });
  }

  const what = q(req, "what") || "registry";
  try {
    if (what === "registry") return json(200, { registry: (await storage.get("config_registry")) || [] });
    if (what === "provider") return json(200, { provider: (await storage.get("COGNIRUNNER_AI_PROVIDER")) || "atlassian" });
    if (what === "logs") return json(200, { logs: (await storage.get("validation_logs")) || [] });
    // Real execution logs live under per-entry log_entry:* keys (NOT validation_logs).
    if (what === "execlogs") { const { readLogs } = await import("./index.js"); return json(200, { logs: await readLogs(q(req, "ruleId") || null) }); }
    if (what === "kvs") {
      const key = q(req, "key");
      if (!key) return json(400, { error: "key required" });
      return json(200, { key, value: (await storage.get(key)) ?? null });
    }
    return json(400, { error: `unknown what=${what}` });
  } catch (e) {
    return json(500, { error: String((e && e.message) || e) });
  }
}
