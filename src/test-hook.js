/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * DEV-ONLY test-state web trigger for the forge-live-harness E2E suite.
 * Gated by HARNESS_SECRET (set ONLY in the development environment). Returns 404
 * unless the secret is configured (absent in prod) AND matches the Bearer header.
 * Reads and explicitly allowlisted test actions only.
 */
import { kvs as storage } from "@forge/kvs";
import { PROVIDER_IDS, providerSlotsFor } from "./shared/provider-slots.js";
// F-163: the memory-store key NAMES come from the module that owns them — never retyped here.
import { MEMORIES_KEY, MEMORY_SETTINGS_KEY, MEMORY_STORE_FULL_KEY } from "./memories.js";

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
    // ===== Coder plan Part 0 platform probes (dev-gated) =====
    // "probe": records getAppContext().license as seen by THIS webtrigger and enqueues the same
    // question (or a Forge LLM cap measurement) into the async consumer; "readProbe" returns the
    // recorded rows. Nothing here touches production paths or user data.
    if (body.action === "probe") {
      try {
        const { getAppContext } = await import("@forge/api");
        const { Queue } = await import("@forge/events");
        let ctx = null; let ctxErr = null;
        try { ctx = getAppContext(); } catch (e) { ctxErr = String(e?.message || e); }
        const webtrigger = { hasContext: !!ctx, license: ctx?.license ?? null, keys: ctx ? Object.keys(ctx) : [], error: ctxErr };
        await storage.set("probe:license:webtrigger", { at: new Date().toISOString(), runtime: "webtrigger", ...webtrigger }, { ttl: { value: 1, unit: "DAYS" } });
        const queue = new Queue({ key: "async-ai-queue" });
        const kind = body.kind === "forgeLlm" ? "forgeLlm" : "license";
        const name = kind === "license" ? "license:consumer" : ("forgellm:" + String(body.name || Date.now()).replace(/[^A-Za-z0-9_.-]/g, ""));
        const taskId = "probe-" + Date.now().toString(36);
        const pushed = await queue.push({ body: { taskType: "probe", taskId, params: { kind, name, model: body.model, tokens: body.tokens, calls: body.calls, enqueuedAt: new Date().toISOString() } } });
        return json(200, { webtrigger, queued: { kind, name, key: "probe:" + name, pushed: pushed || null } });
      } catch (e) {
        return json(500, { error: String((e && e.message) || e) });
      }
    }
    if (body.action === "setWebhookProbeSecret") {
      const secret = String(body.secret || "");
      if (!/^[A-Za-z0-9]{16,80}$/.test(secret)) return json(400, { error: "secret must be 16-80 alphanumerics" });
      await storage.set("probe:webhook:secret", { secret, at: new Date().toISOString() }, { ttl: { value: 1, unit: "DAYS" } });
      return json(200, { ok: true });
    }
    if (body.action === "readProbe") {
      const name = String(body.name || "").replace(/[^A-Za-z0-9_.:-]/g, "");
      if (!name) return json(400, { error: "name required" });
      return json(200, { name, value: (await storage.get("probe:" + name)) || null });
    }
    // Cross-product reach: can THIS Jira-triggered function call Confluence, and what is the
    // exact error when the app is not installed on Confluence?
    if (body.action === "probeConfluence") {
      try {
        const { default: api, route } = await import("@forge/api");
        const r = await api.asApp().requestConfluence(route`/wiki/api/v2/spaces?limit=1`);
        const text = await r.text();
        return json(200, { status: r.status, ok: r.ok, body: text.slice(0, 600) });
      } catch (e) {
        return json(200, { thrown: String((e && e.message) || e).slice(0, 600) });
      }
    }
    // JSM reach as the app: service desks and one queue listing.
    if (body.action === "probeServiceDesk") {
      try {
        const { default: api, route } = await import("@forge/api");
        const r1 = await api.asApp().requestJira(route`/rest/servicedeskapi/servicedesk?limit=5`);
        const t1 = await r1.text();
        let queues = null;
        try {
          const desks = JSON.parse(t1);
          const first = desks?.values?.[0]?.id;
          if (first) {
            const r2 = await api.asApp().requestJira(route`/rest/servicedeskapi/servicedesk/${first}/queue?limit=5`);
            const t2 = await r2.text();
            let firstQueue = null;
            try { firstQueue = JSON.parse(t2)?.values?.[0]?.id || null; } catch (e) { /* ignore */ }
            let issues = null;
            if (firstQueue) {
              const r3 = await api.asApp().requestJira(route`/rest/servicedeskapi/servicedesk/${first}/queue/${firstQueue}/issue?limit=3`);
              issues = { status: r3.status, body: (await r3.text()).slice(0, 400) };
            }
            queues = { status: r2.status, body: t2.slice(0, 400), issues };
          }
        } catch (e) { queues = { error: String(e?.message || e) }; }
        return json(200, { servicedesks: { status: r1.status, body: t1.slice(0, 400) }, queues });
      } catch (e) {
        return json(200, { thrown: String((e && e.message) || e).slice(0, 600) });
      }
    }
    // Writes the advisory Git-state property on ONE issue so the condition-expression probe can
    // flip a transition. Dev site only; the harness restores/removes it afterwards.
    if (body.action === "probeProperty") {
      if (typeof body.issueKey !== "string" || !/^[A-Z][A-Z0-9_]*-\d+$/.test(body.issueKey)) return json(400, { error: "issueKey required" });
      try {
        const { default: api, route } = await import("@forge/api");
        const key = String(body.propertyKey || "cognirunner.git");
        if (body.remove === true) {
          const r = await api.asApp().requestJira(route`/rest/api/3/issue/${body.issueKey}/properties/${key}`, { method: "DELETE" });
          return json(200, { removed: r.status });
        }
        const r = await api.asApp().requestJira(route`/rest/api/3/issue/${body.issueKey}/properties/${key}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body.value || {}) });
        const back = await api.asApp().requestJira(route`/rest/api/3/issue/${body.issueKey}/properties/${key}`);
        return json(200, { put: r.status, readBack: back.status, value: (await back.text()).slice(0, 400) });
      } catch (e) {
        return json(200, { thrown: String((e && e.message) || e).slice(0, 600) });
      }
    }
    if (body.action === "commit") {
      try {
        const { commitImportCore } = await import("./index.js");
        const r = await commitImportCore({ rule: body.rule, targetWorkflowName: body.targetWorkflowName, targetTransitionId: body.targetTransitionId, bindings: body.bindings || {}, accountId: null });
        return json(200, r);
      } catch (e) {
        return json(500, { error: String((e && e.message) || e) });
      }
    }
    // Knowledge-injection A/B (dev-gated): seed a skill carrying a nonce directive, run codegen
    // WITH vs WITHOUT it selected, then delete the skill. Touches only design-time codegen + the
    // knowledge store (test data) — NOT the runtime validator/condition/PF decision path.
    if (body.action === "seedSkill") {
      try {
        const { saveSkillInternal } = await import("./skills.js");
        const r = await saveSkillInternal(
          { id: body.id, name: body.name, category: body.category || "Other", description: body.description || "", tags: body.tags || [], operationTypes: body.operationTypes || [], enabled: body.enabled !== false, builtin: false, createdBy: null },
          { instructions: body.instructions || "", examples: body.examples || "" },
        );
        return json(200, r);
      } catch (e) {
        return json(500, { error: String((e && e.message) || e) });
      }
    }
    if (body.action === "runCodegen") {
      try {
        const { runCodegenCore } = await import("./index.js");
        const r = await runCodegenCore({ prompt: body.prompt, operationType: body.operationType, selectedSkillIds: body.selectedSkillIds || [], autoMatch: body.autoMatch === true, projectKey: body.projectKey || null });
        return json(200, r);
      } catch (e) {
        return json(500, { error: String((e && e.message) || e) });
      }
    }
    if (body.action === "deleteSkill") {
      try {
        const { SKILL_INDEX_KEY, SKILL_PREFIX } = await import("./skills.js");
        const idx = (await storage.get(SKILL_INDEX_KEY)) || [];
        const next = idx.filter((s) => s.id !== body.id);
        await storage.set(SKILL_INDEX_KEY, next);
        await storage.delete(SKILL_PREFIX + body.id);
        return json(200, { success: true, removed: idx.length - next.length });
      } catch (e) {
        return json(500, { error: String((e && e.message) || e) });
      }
    }
    // At-scale campaign: claim a batch of attached-but-unregistered rules into the registry (the
    // admin "Configured Rules" table) — the same "Scan → Register all" the admin UI does, 500-capped.
    if (body.action === "registerRules") {
      try {
        const { registerDiscoveredRulesCore } = await import("./index.js");
        const r = await registerDiscoveredRulesCore(Array.isArray(body.rules) ? body.rules : [], null);
        return json(200, r);
      } catch (e) {
        return json(500, { error: String((e && e.message) || e) });
      }
    }
    // Rules REST API token for the listeners/jobs E2E harness (dev-gated; the
    // production path is the admin UI's Settings → API access).
    if (body.action === "mintApiToken") {
      try {
        const { createApiTokenInternal } = await import("./rules-api.js");
        const r = await createApiTokenInternal({ name: body.name || "harness", accountId: "harness" });
        return json(200, r);
      } catch (e) {
        return json(500, { error: String((e && e.message) || e) });
      }
    }
    // Direct consumer concurrency proof for dedicated harness fixtures. This tests
    // real KVS claims and sandbox writes, not Forge's product-event/queue delivery.
    // It never accepts code, module names, arbitrary functions or raw event data.
    if (body.action === "probeRuleDelivery") {
      const taskType = body.taskType;
      const validTaskId = (id) => typeof id === "string" && /^harness-claim-[A-Za-z0-9_.-]{1,60}$/.test(id);
      if (!["listener", "scheduledjob"].includes(taskType)
        || typeof body.ruleId !== "string" || !/^[A-Za-z0-9_.-]{3,80}$/.test(body.ruleId)
        || !validTaskId(body.taskId)
        || (body.manual !== undefined && typeof body.manual !== "boolean")
        || (body.secondTaskId !== undefined && !validTaskId(body.secondTaskId))) {
        return json(400, { error: "Expected listener or scheduledjob, a ruleId and harness-claim- task ids." });
      }
      const manual = body.manual !== false;
      // Production claims retain the existing 120-character key-part limit.
      // Reject probe identities that would truncate distinct manual task ids.
      if (taskType === "scheduledjob" && manual
        && [body.taskId, body.secondTaskId || body.taskId].some((id) => `${body.ruleId}:manual:${id}`.length > 120)) {
        return json(400, { error: "Combined manual rule/task identity exceeds the claim key limit." });
      }
      if (taskType === "listener" && (typeof body.issueKey !== "string" || !/^[A-Z][A-Z0-9_]*-\d+$/.test(body.issueKey))) {
        return json(400, { error: "Listener probe requires an issueKey." });
      }
      if (taskType === "scheduledjob" && !manual
        && (typeof body.scheduledFor !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/.test(body.scheduledFor)
          || !Number.isFinite(Date.parse(body.scheduledFor)) || new Date(body.scheduledFor).toISOString() !== body.scheduledFor)) {
        return json(400, { error: "Scheduled probe requires scheduledFor as an exact UTC minute." });
      }
      try {
        const mod = taskType === "listener" ? await import("./listeners.js") : await import("./scheduled-jobs.js");
        const rule = await (taskType === "listener" ? mod.getListener(body.ruleId) : mod.getJob(body.ruleId));
        if (!rule || rule.mode !== "script" || !rule.name.startsWith("[Harness claim]")) {
          return json(400, { error: "Probe requires a saved script rule named [Harness claim]..." });
        }
        let params; let execute;
        if (taskType === "listener") {
          const eventType = rule.events.find((e) => ["avi:jira:created:issue", "avi:jira:updated:issue"].includes(e));
          if (!eventType || rule.enabled === false) return json(400, { error: "Listener probe requires an enabled issue-created or issue-updated fixture." });
          const { default: api, route } = await import("@forge/api");
          const res = await api.asApp().requestJira(route`/rest/api/3/issue/${body.issueKey}?fields=summary,project,issuetype`);
          if (!res.ok) return json(400, { error: `Probe issue read failed: ${res.status}` });
          const event = { eventType, issue: await res.json(), selfGenerated: false };
          const { extractEventContext } = await import("./shared/jira-events.js");
          const ctx = { ...extractEventContext(eventType, event), jqlPending: Boolean(rule.filters?.jql) };
          // The fixture must satisfy the same static filters before the consumer
          // pair is invoked; no need to bypass matching just to exercise claims.
          const match = mod.matchListenerStatic(rule, ctx, event);
          if (!match.ok) return json(400, { error: `Probe fixture does not match: ${match.reason}` });
          params = { listenerId: rule.id, eventType, event, ctx };
          execute = mod.executeListenerTask;
        } else {
          if (rule.scope) return json(400, { error: "Job probe requires an unscoped fixture with explicit issue targeting." });
          if (!manual && rule.enabled === false) return json(400, { error: "Scheduled probe requires an enabled fixture." });
          params = { jobId: rule.id, manual, scheduledFor: manual ? null : body.scheduledFor };
          execute = mod.executeScheduledJobTask;
        }
        const results = await Promise.all([
          execute(params, body.taskId),
          execute(params, body.secondTaskId || body.taskId),
        ]);
        return json(200, { directConsumerProbe: true, results });
      } catch (e) {
        return json(500, { error: String((e && e.message) || e) });
      }
    }
    // Delete registry rows, optionally detaching the rules from their Jira workflows —
    // the same removeRegistryRowsCore the admin panel's Delete uses. Lets the harness
    // assert end-to-end that "delete" actually stops a rule running, and lets a
    // campaign reclaim registry slots it filled. bypassAuthz is safe here for the same
    // reason the other actions run with accountId:null — the Bearer gate above IS the
    // authorization, and this trigger returns 404 wherever HARNESS_SECRET is unset.
    // Flip a rule's disabled flag through the SAME core the resolver uses, so the
    // harness exercises the real path (including the workflow propagation that
    // conditions need) rather than poking the registry directly. A raw KVS writer
    // here would be both a dangerous primitive and a weaker test.
    if (body.action === "setDisabled") {
      try {
        const { setRuleDisabledCore } = await import("./index.js");
        const r = await setRuleDisabledCore({ id: body.id, disabled: body.disabled === true, accountId: null, bypassAuthz: true });
        return json(200, r);
      } catch (e) {
        return json(500, { error: String((e && e.message) || e) });
      }
    }
    // Invoke a read-only resolver through the REAL dispatcher (resolver.getDefinitions()
    // → exported `handler`), not through an extracted core: the point is to exercise the
    // resolver body's own wiring — filter args, context construction, sanitizeObject —
    // which unit tests of the pure pieces cannot reach. getConfigs also carries the
    // one-shot ownership/slim migrations, so this is how the harness fires and then
    // verifies them on live data. Allowlisted read-only keys ONLY: this must never
    // become a generic invoke-anything bridge.
    if (body.action === "invokeResolver") {
      // Read-only registry keys + the Listener / Scheduled Job / API-token resolvers (the
      // harness drives the admin-panel resolver layer — permission gates, payload shapes —
      // that the Rules REST API bypasses). Still an allowlist, never invoke-anything.
      const ALLOWED_KEYS = new Set(["getConfigs", "getKnowledgeCounts",
        "getListeners", "getListener", "saveListener", "deleteListener", "setListenerEnabled", "testListener", "getEventSample",
        "getScheduledJobs", "getScheduledJob", "saveScheduledJob", "deleteScheduledJob", "setScheduledJobEnabled", "runScheduledJobNow", "previewSchedule",
        "getApiTokens", "createApiToken", "revokeApiToken", "getAsyncTaskResult", "getLogs", "checkIsAdmin",
        "getAiBudget", "saveAiBudget", "getAsyncJobs",
        // HARNESS-ONLY (release 1.3 editions proof): the edition/model/usage resolvers.
        "checkLicense", "getProvider", "getOpenAIModels", "saveOpenAIModel", "getOpenAIModelFromKVS",
        "getAgentModel", "saveAgentModel", "getAiUsage", "resetAiUsage", "checkProviderHealth", "reviewConfig",
        // F-163 — the MEMORY store resolvers. The F-155..F-161 behaviour (dedup/merge, the
        // veto delete, the eviction policy and the at-cap rejection) lives in resolvers that
        // no other hook path could reach, so it could only ever be proven offline. These are
        // WRITES, deliberately: they exist to prove the memory store live, and they are behind
        // the same HARNESS_SECRET Bearer gate (absent in production) as everything else here.
        "getMemories", "addMemory", "updateMemory", "deleteMemory", "getMemorySettings", "saveMemorySettings"]);
      const functionKey = body.functionKey || body.name;
      if (!ALLOWED_KEYS.has(functionKey)) {
        return json(400, { error: `functionKey not allowlisted: ${functionKey}` });
      }
      try {
        const { handler } = await import("./index.js");
        // HARNESS-ONLY: checkLicense reads context.license, which the platform supplies on a
        // real resolver invocation. A webtrigger's getAppContext() carries the SAME license
        // object (verified live), so forwarding it makes the hook a faithful stand-in.
        let hookLicense;
        try { const { getAppContext } = await import("@forge/api"); hookLicense = getAppContext()?.license; } catch (e) { hookLicense = undefined; }
        const r = await handler(
          { call: { functionKey, payload: body.payload || {} }, context: {} },
          { principal: body.accountId ? { accountId: body.accountId } : undefined, license: hookLicense },
        );
        return json(200, r);
      } catch (e) {
        return json(500, { error: String((e && e.message) || e) });
      }
    }
    // HARNESS-ONLY (release 1.3 editions proof): seed/restore a narrow set of config slots
    // that no resolver can write on a Standard tenant (the whole point of the gate under test).
    // Key allowlist — never a generic KVS write bridge.
    if (body.action === "kvSet") {
      // F-126 — the provider slots are here so the harness can PLANT A PROVIDER FAULT and
      // prove the fail-OPEN contract LIVE: clear COGNIRUNNER_AI_PROVIDER (or a BYOK key
      // slot) and a validator/condition must still let the transition through, the health
      // banner must say "no provider" and the consumer's budget gate must fail the
      // listener/job closed. Those three 1.3 items cannot be proven any other way — no
      // resolver writes these slots on a tenant, which is the whole point of the gate.
      // The slot NAMES come from src/shared/provider-slots.js — the SAME module index.js
      // builds them with. A retyped "COGNIRUNNER_KEY_openai" here would silently rot the
      // day a helper changes, which is the defect class this repo keeps paying for.
      // Still an allowlist, never a generic KVS write bridge, and still behind
      // HARNESS_SECRET (absent in production, checked at the top of this handler).
      // F-163 — the memory store + its settings, so the harness can SEED a 200-row fixture
      // (an all-user store, a mixed store) and restore it afterwards. No resolver can plant a
      // store at the cap, which is exactly the state the F-160 eviction policy and the F-161
      // at-cap rejection are about. F-174 — plus the store-full MARKER, so a test that
      // drives the banner can back it up and restore it (constant imported, never retyped).
      const KEYS = new Set(["COGNIRUNNER_USAGE", "COGNIRUNNER_SEAT_SNAPSHOT", "COGNIRUNNER_EDITION_SNAPSHOT",
        "COGNIRUNNER_AI_PROVIDER", MEMORIES_KEY, MEMORY_SETTINGS_KEY, MEMORY_STORE_FULL_KEY]);
      for (const p of PROVIDER_IDS) for (const slot of providerSlotsFor(p)) KEYS.add(slot);
      if (!KEYS.has(body.key)) return json(400, { error: `key not allowlisted: ${body.key}` });
      if (body.value === null) await storage.delete(body.key);
      else await storage.set(body.key, body.value);
      return json(200, { key: body.key, set: body.value === null ? "deleted" : true, now: (await storage.get(body.key)) ?? null });
    }
    if (body.action === "removeRules") {
      try {
        const { removeRegistryRowsCore } = await import("./index.js");
        const r = await removeRegistryRowsCore({
          ids: Array.isArray(body.ids) ? body.ids : [],
          accountId: null,
          detach: body.detach === true,
          bypassAuthz: true,
        });
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
    if (what === "rulesApiUrl") {
      const { webTrigger } = await import("@forge/api");
      const r = await webTrigger.getUrl("rules-api");
      return json(200, { url: typeof r === "string" ? r : r && r.url });
    }
    // The kvs READ is deliberately unrestricted (no key allowlist): it is a read, it is
    // behind HARNESS_SECRET, and the harness must be able to confirm a planted fault
    // (F-126) landed on the exact slot it wrote. Nothing to widen here.
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

// ===== Coder plan Part 0 probe (c): is the webtrigger `body` byte-identical to what the sender
// signed? A GitHub/Bitbucket webhook points here with a secret stored under KVS
// `probe:webhook:secret` (set through the test hook). Records headers (names + signature
// values only), body length/sha256 and the HMAC verdict under `probe:webhook:last`.
// Unauthenticated by design (webhook senders cannot send our Bearer) — it stores no payload.
export async function gitWebhookProbe(req) {
  const { createHmac, createHash, timingSafeEqual } = await import("node:crypto");
  const row = (await storage.get("probe:webhook:secret")) || null;
  const body = typeof (req && req.body) === "string" ? req.body : "";
  const hdr = (n) => { const v = req && req.headers && (req.headers[n] || req.headers[n.toLowerCase()] || req.headers[n.toUpperCase()]); return Array.isArray(v) ? v[0] : (v || null); };
  const sig256 = hdr("x-hub-signature-256") || hdr("X-Hub-Signature-256");
  const sig = hdr("x-hub-signature") || hdr("X-Hub-Signature");
  const provider = hdr("x-github-event") ? "github" : (hdr("x-event-key") ? "bitbucket" : "unknown");
  let verdict = "no-secret";
  if (row && row.secret) {
    const expected = "sha256=" + createHmac("sha256", row.secret).update(body, "utf8").digest("hex");
    const got = sig256 || sig || "";
    verdict = got && expected.length === got.length && timingSafeEqual(Buffer.from(expected), Buffer.from(got)) ? "VALID" : "INVALID";
  }
  await storage.set("probe:webhook:last", {
    at: new Date().toISOString(), provider, event: hdr("x-github-event") || hdr("x-event-key") || null,
    bodyBytes: Buffer.byteLength(body, "utf8"), bodySha256: createHash("sha256").update(body, "utf8").digest("hex"),
    headerNames: req && req.headers ? Object.keys(req.headers) : [], sig256: sig256 ? sig256.slice(0, 20) + "…" : null, sig: sig ? sig.slice(0, 20) + "…" : null,
    verdict, bodyIsString: typeof (req && req.body) === "string",
  }, { ttl: { value: 1, unit: "DAYS" } });
  return { statusCode: 202, headers: { "Content-Type": ["application/json"] }, body: JSON.stringify({ ok: true, verdict }) };
}
