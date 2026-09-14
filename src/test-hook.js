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
import { readBearerToken } from "./shared/http-headers.js";
// F-163: the memory-store key NAMES come from the module that owns them — never retyped here.
import { MEMORIES_KEY, MEMORY_SETTINGS_KEY, MEMORY_STORE_FULL_KEY } from "./memories.js";
// F-566: same discipline for the knowledge-pack settings slot — the module that owns it.
import { KNOWLEDGE_SETTINGS_KEY } from "./knowledge-packs.js";

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

/* ───────────────── 1.5 probe P1 — the JSM audience question (FRAME §5) ─────────────────
 *
 * FRAME-1.5 §5 P1 is a CONTRADICTION, not a curiosity: this app's own sandbox spec says
 * a JSM internal note is the comment property `sd.public.comment = { internal: true }`
 * (src/shared/sandbox-api-spec.js:279), the 1.5 plan text says `sd.public.comment = false`.
 * The code is the authority, and the VA's audience gate is built on whichever is true.
 * So the probe POSTS one short fixed comment both ways and READS IT BACK through the
 * JSM request-comment API, where `public` is the portal's own answer.
 *
 * WHAT IT REPORTS: status codes, response KEYS, the boolean `public`, and whether the
 * property echo carries `internal: true`. NEVER a body, never a comment id, never a
 * display name — a probe result is evidence, not a data export.
 *
 * THE COMMENT IS ALWAYS DELETED. The delete lives in `finally` and runs on the throw
 * path, the non-2xx read path and the happy path alike: a probe that leaves a comment on
 * a customer-visible request has become the leak it was measuring.
 */
export const JSM_PROBE_COMMENT_TEXT = "CogniRunner harness audience probe — safe to ignore, deleted automatically.";
export const JSM_INTERNAL_PROPERTY_KEY = "sd.public.comment";

/** The error CLASS only — a message can carry a URL, an issue key or a token. */
const errorClassOf = (e) => (e && (e.code || e.name) ? String(e.code || e.name) : "Error").slice(0, 60);
const keysOf = (data) => (data && typeof data === "object" && !Array.isArray(data) ? Object.keys(data).slice(0, 30) : []);
const jsonOf = async (res) => { try { return JSON.parse(String(await res.text()).slice(0, 200000)); } catch { return null; } };

/* ═══════════════════════════════════════════════════════════════════════════════════
 * F-627/F-628 — "A SECRET IS NEVER PLANTABLE", IN ONE HOME.
 *
 * Two doors in this file now PLANT A ROW from a caller-supplied object: `pipelineRow`
 * (a `git_pipeline:*` record) and `vaTombstone`'s `turns`. Both build their row field by
 * field from an allow-list, so a stray key cannot reach storage by construction — but
 * "by construction" is a property a future edit can lose quietly, and the promise the
 * whole file rests on ("the write resolvers are off the allow-list because a planted
 * token would then exist on a real tenant") deserves a check that FAILS LOUDLY rather
 * than an argument that has to be re-derived by every reader.
 *
 * So a plant body is REFUSED OUTRIGHT when it so much as mentions a credential: any key
 * whose name reads like one, at any depth, and any string value that looks like a stored
 * key slot, a provider token or a web-trigger URL. It is deliberately coarse — a harness
 * body has no legitimate reason to carry any of these, and a false refusal costs a
 * driver one rename while a false accept costs a tenant a live credential.
 *
 * Returns `null` when the body is clean, or `{ error, harnessRefusal, field }`.
 * ═══════════════════════════════════════════════════════════════════════════════════ */
const SECRET_KEY_HINTS = [
  "token", "secret", "password", "credential", "apikey", "privatekey", "bearer",
  "authorization", "cookie", "webtrigger", "webhookurl", "cognirunnerkey", "gitconnection",
];
/** COGNIRUNNER_KEY_* slots, GitHub/Bitbucket/OpenAI token shapes, Forge web-trigger URLs. */
const SECRET_VALUE_RE =
  /(COGNIRUNNER_KEY_|git_conn_secret:|\bgh[pousr]_[A-Za-z0-9]{8}|\bgithub_pat_|\bsk-[A-Za-z0-9_-]{12}|\bxoxb-|\.atlassian-dev\.net\/)/;

export const SECRET_PLANT_REFUSAL = "harnessRefusal: a plant body may never carry a credential — this door plants state, never secrets";

/*
 * F-632 — ONE PREDICATE FOR "THE HARNESS PLANTED THIS ROW", AND ONE REFUSAL FOR WHEN IT
 * DID NOT. The pipeline door shipped with this discipline and the tombstone door shipped
 * without it, in the same commit: `pipelineRow clear` refused a row it had not planted,
 * while `vaTombstone clear` deleted ANY tombstone and `op:"age"` rewrote a real one.
 * Deleting a real `va_purged:{agent}` row is the one direction that hands a purged agent
 * its voice back and destroys the record the F-608 purges panel exists to print, and an
 * age is the soft form of the same thing. Both doors now ask the SAME question here
 * rather than each carrying its own copy of it.
 */
export const harnessPlanted = (row) => Boolean(row && typeof row === "object" && row.plantedBy === "harness");

export const notPlantedRefusal = (what) => ({
  error: `harnessRefusal: that ${what} was not planted by the harness — this door never touches a real record`,
  harnessRefusal: "not-planted",
});

export const findPlantedSecret = (value, path = "", depth = 0) => {
  if (depth > 6) return null;
  if (typeof value === "string") {
    return SECRET_VALUE_RE.test(value) ? { field: path || "(root)", why: "value-looks-like-a-credential" } : null;
  }
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length && i < 50; i++) {
      const hit = findPlantedSecret(value[i], `${path}[${i}]`, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  for (const [k, v] of Object.entries(value)) {
    const flat = k.toLowerCase().replace(/[^a-z0-9]/g, "");
    // `key` alone is a legitimate harness word (a KVS key); the hints below are not.
    if (SECRET_KEY_HINTS.some((h) => flat.includes(h))) return { field: path ? `${path}.${k}` : k, why: "field-name-reads-like-a-credential" };
    const hit = findPlantedSecret(v, path ? `${path}.${k}` : k, depth + 1);
    if (hit) return hit;
  }
  return null;
};

/**
 * The four calls, as real `route` templates. Injected as a unit so the offline suite can
 * drive every branch (including the delete) without a network.
 */
export const createJsmProbeCalls = (api, route) => ({
  postComment: (issueKey, payload) =>
    api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/comment`, {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(payload),
    }),
  readJsdComment: (issueKey, commentId) =>
    api.asApp().requestJira(route`/rest/servicedeskapi/request/${issueKey}/comment/${commentId}`),
  readCommentProperty: (commentId) =>
    api.asApp().requestJira(route`/rest/api/3/comment/${commentId}/properties/sd.public.comment`),
  deleteComment: (issueKey, commentId) =>
    api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/comment/${commentId}`, { method: "DELETE" }),
});

export async function runJsmCommentProbe({ issueKey, mode, calls }) {
  const internal = mode !== "public";
  const out = {
    mode: internal ? "internal" : "public",
    postStatus: null, hasId: false, readStatus: null, jsdPublic: null,
    keys: [], propertyStatus: null, propertyEcho: null, deleteStatus: null, errorClass: null,
  };
  let commentId = null;
  try {
    const payload = {
      body: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: JSM_PROBE_COMMENT_TEXT }] }] },
    };
    // The ONE claim under test: the property shape for an internal note. The public arm
    // sends NO property at all — that is what "public" means on this API.
    if (internal) payload.properties = [{ key: JSM_INTERNAL_PROPERTY_KEY, value: { internal: true } }];
    const post = await calls.postComment(issueKey, payload);
    out.postStatus = post && post.status != null ? post.status : null;
    const created = await jsonOf(post);
    const rawId = created && created.id != null ? String(created.id) : "";
    // Only a digit id is ever interpolated into a later path.
    if (/^[0-9]{1,20}$/.test(rawId)) { commentId = rawId; out.hasId = true; }
    if (commentId) {
      const read = await calls.readJsdComment(issueKey, commentId);
      out.readStatus = read && read.status != null ? read.status : null;
      const data = await jsonOf(read);
      out.keys = keysOf(data);
      out.jsdPublic = data && typeof data.public === "boolean" ? data.public : null;
      const prop = await calls.readCommentProperty(commentId);
      out.propertyStatus = prop && prop.status != null ? prop.status : null;
      const pv = await jsonOf(prop);
      const value = pv && pv.value;
      out.propertyEcho = value && typeof value === "object"
        ? { internal: value.internal === true, keys: keysOf(value) }
        : null;
    }
  } catch (e) {
    out.errorClass = errorClassOf(e);
  } finally {
    // ALWAYS. Throw path, error-status path, happy path.
    if (commentId) {
      try {
        const del = await calls.deleteComment(issueKey, commentId);
        out.deleteStatus = del && del.status != null ? del.status : null;
      } catch (e) {
        out.deleteStatus = null;
        out.deleteErrorClass = errorClassOf(e);
      }
    } else {
      out.deleteStatus = "nothing-to-delete";
    }
  }
  return out;
}

export async function testStateTrigger(req) {
  const secret = process.env.HARNESS_SECRET;
  if (!secret) return notFound();
  // F-341: header names are case-insensitive — the read folds case over the actual
  // keys in ONE place (src/shared/http-headers.js), shared with gitWebhook's hookHeader.
  const provided = readBearerToken(req);
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
    // 1.4 commit 5 — plant a PER-REPO webhook signing secret so a tester can sign a
    // delivery to the PRODUCTION `git-webhook` trigger. Writes through
    // git-connections.js (`gitHookSecretKey`) so the key name has ONE home, and it is
    // dev-gated by the same HARNESS_SECRET Bearer as everything else in this file —
    // there is no path to this action in production, where HARNESS_SECRET is unset.
    if (body.action === "plantHookSecret") {
      const connId = String(body.connId || "");
      const repoId = String(body.repoId || "");
      const secretValue = String(body.secret || "");
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(connId)) return json(400, { error: "connId required" });
      if (!/^[^/\s]+\/[^/\s]+$/.test(repoId)) return json(400, { error: "repoId must be owner/name" });
      if (!/^[A-Za-z0-9]{16,80}$/.test(secretValue)) return json(400, { error: "secret must be 16-80 alphanumerics" });
      const { gitHookSecretKey, normalizeRepoId, plantHarnessConnection } = await import("./git-connections.js");
      // F-339 — the secret alone proves nothing: `gitWebhook` 404s unless a
      // `git_conn:*` row exists AND the repo is on its allow-list, and the write
      // resolvers are deliberately off the allow-list below. So the hook may plant
      // a TOKENLESS STAND-IN row for the same connId — routing without a credential.
      // Its shape lives in git-connections.js; this is wiring. It never overwrites
      // an existing row, and no `git_conn_secret:*` key is written on any path.
      let connection = null;
      if (body.plantConnection === true) {
        const planted = await plantHarnessConnection({ id: connId, kind: body.kind || "github", repoId });
        if (!planted.ok) return json(400, { error: planted.error, code: planted.code });
        connection = planted.connection;
      }
      const key = gitHookSecretKey(connId, repoId);
      await storage.set(key, { secret: secretValue, connId, repoId: normalizeRepoId(repoId), createdAt: new Date().toISOString() });
      // The secret is what the CALLER just sent us; echoing the KEY (never the value)
      // is what makes the plant verifiable without a read path for secrets.
      return json(200, { ok: true, key, connection });
    }
    // F-339 — the cleanup half. It refuses any row that is not a stand-in, so it
    // is not a delete path for a real connection (`deleteGitConnection` stays off
    // the invoke allow-list).
    if (body.action === "deleteHarnessConnection") {
      const connId = String(body.connId || "");
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(connId)) return json(400, { error: "connId required" });
      const { deleteHarnessConnection } = await import("./git-connections.js");
      const r = await deleteHarnessConnection(connId);
      return json(r.ok ? 200 : 400, r);
    }
    /* F-664 — WHAT THE THREE `read*Fault` ACTIONS ANSWER, for all four kinds.
     * `readHarnessFault` now returns `{ key, value, until, expired }`, and each read action
     * below spreads that answer, so a live driver polling a lever sees the row's OWN
     * deadline and whether it has passed. It matters because the platform TTL does NOT end
     * a lever: Forge KVS deletes expired keys lazily, and a Jira fault armed for 5 s was
     * measured still biting at 615 s. The bound is the `until` stamp on the row, enforced
     * on every read in src/harness-fault.js — so `value: null, expired: true` is a lever
     * that ended by itself, and `value: null, expired: false` is one that was never armed.
     * The `?what=kvs` reader below is deliberately UNCHANGED: `until` is a field of the
     * row, not KVS metadata, so a plain `storage.get` already shows it. */
    // ===== F-335 live proof: the dev-only dispatch fault lever =====
    // Arms N consecutive forced throws at the git-event dispatch seam so the live driver
    // can prove the retry/attempt-cap/claim-release contract without breaking anything
    // for real. All of it — the key shape, the cap, the TTL and the env gate — lives in
    // src/harness-fault.js; this is wiring behind the same HARNESS_SECRET Bearer gate as
    // every other action here, and the lever itself is additionally inert whenever that
    // env var is absent (production).
    if (body.action === "armGitDispatchFault" || body.action === "disarmGitDispatchFault" || body.action === "readGitDispatchFault") {
      const connId = String(body.connectionId || body.connId || "");
      const deliveryId = String(body.deliveryId || "");
      if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(connId)) return json(400, { error: "connectionId required" });
      if (!/^[A-Za-z0-9_.:-]{1,120}$/.test(deliveryId)) return json(400, { error: "deliveryId required" });
      const { armHarnessFault, disarmHarnessFault, readHarnessFault, HARNESS_FAULT_GIT_DISPATCH, HARNESS_FAULT_MAX_COUNT } = await import("./harness-fault.js");
      const parts = [connId, deliveryId];
      if (body.action === "armGitDispatchFault") {
        const n = Math.floor(Number(body.count) || 1);
        if (!(n >= 1 && n <= HARNESS_FAULT_MAX_COUNT)) return json(400, { error: `count must be 1-${HARNESS_FAULT_MAX_COUNT}` });
        return json(200, { ok: true, ...(await armHarnessFault(HARNESS_FAULT_GIT_DISPATCH, parts, n)) });
      }
      if (body.action === "disarmGitDispatchFault") return json(200, { ok: true, ...(await disarmHarnessFault(HARNESS_FAULT_GIT_DISPATCH, parts)) });
      return json(200, { ok: true, ...(await readHarnessFault(HARNESS_FAULT_GIT_DISPATCH, parts)) });
    }
    // ===== F-504 live proof: the dev-only HOOK-PROMOTE fault lever =====
    // Same shape, same allow-list discipline and same one-shot semantics as the dispatch
    // lever above — arming N units makes the next N promotions of THIS connection+repo
    // throw at step 3 of rotateGitHookSecret, which is the only way a live driver can
    // reach `hookState:"rotation-failed"`, the pending-secret acceptance window (F-481)
    // and the reconcile-on-retry (F-491). No secret is accepted or returned on any of the
    // three actions: the lever is keyed by connection and repo alone.
    if (body.action === "armHookPromoteFault" || body.action === "disarmHookPromoteFault" || body.action === "readHookPromoteFault") {
      const connId = String(body.connectionId || body.connId || "");
      const repoId = String(body.repoId || body.repo || "");
      if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(connId)) return json(400, { error: "connectionId required" });
      if (!/^[^/\s]+\/[^/\s]+$/.test(repoId) || repoId.length > 120) return json(400, { error: "repoId must be owner/name" });
      const { armHarnessFault, disarmHarnessFault, readHarnessFault, HARNESS_FAULT_HOOK_PROMOTE, HARNESS_FAULT_MAX_COUNT } = await import("./harness-fault.js");
      const { normalizeRepoId } = await import("./shared/git-ids.js");
      // The consumer keys on the NORMALISED repo id (that is what rotate holds), so the
      // arming side must normalise too or the lever would never be found.
      const parts = [connId, normalizeRepoId(repoId)];
      if (body.action === "armHookPromoteFault") {
        const n = Math.floor(Number(body.count) || 1);
        if (!(n >= 1 && n <= HARNESS_FAULT_MAX_COUNT)) return json(400, { error: `count must be 1-${HARNESS_FAULT_MAX_COUNT}` });
        return json(200, { ok: true, ...(await armHarnessFault(HARNESS_FAULT_HOOK_PROMOTE, parts, n)) });
      }
      if (body.action === "disarmHookPromoteFault") return json(200, { ok: true, ...(await disarmHarnessFault(HARNESS_FAULT_HOOK_PROMOTE, parts)) });
      return json(200, { ok: true, ...(await readHarnessFault(HARNESS_FAULT_HOOK_PROMOTE, parts)) });
    }
    /* ===== F-629 live proof: the dev-only KEY-READ fault lever =====
     * THE THIRD MEMBER of the `armHarnessFault` family, and the first that is not
     * git-scoped. F-603 is a bug about what the provider settings card does when
     * `getOpenAIKey` FAILS — a stale `noKeyNeeded` painting a BYOK provider as "Managed
     * by LeanZero, nothing to paste here" with no key input at all — and that resolver is
     * a KVS read plus a provider switch, so nothing a tester can do from outside makes it
     * fail. The fix could only ever be exercised against a mock.
     *
     * KEYED BY PROVIDER ID ALONE, so the F-603 scenario is expressible: the managed engine
     * loads fine, then OpenAI's read fails. The cap, the two modes, the TTL and the env
     * gate all live in src/harness-fault.js; this is wiring behind the same HARNESS_SECRET
     * Bearer as everything else here, and the lever is additionally inert wherever that
     * env var is absent (production).
     *
     * IT ACCEPTS NO KEY AND RETURNS NO KEY. The body carries a provider id, a mode and a
     * TTL — nothing else — and the three answers carry the fault KEY, never a slot value.
     */
    if (body.action === "armKeyReadFault" || body.action === "disarmKeyReadFault" || body.action === "readKeyReadFault") {
      const provider = String(body.provider || "");
      if (!PROVIDER_IDS.includes(provider)) return json(400, { error: `provider must be one of: ${PROVIDER_IDS.join(", ")}` });
      const {
        armKeyReadFault, disarmHarnessFault, readHarnessFault,
        HARNESS_FAULT_KEY_READ, KEY_READ_FAULT_MODES, HARNESS_KEY_READ_FAULT_MAX_TTL_SECONDS,
      } = await import("./harness-fault.js");
      if (body.action === "armKeyReadFault") {
        if (!KEY_READ_FAULT_MODES.includes(body.mode)) return json(400, { error: `mode must be one of: ${KEY_READ_FAULT_MODES.join(", ")}` });
        const r = await armKeyReadFault(provider, body.mode, body.ttlSeconds);
        // The clamp lives with the lever; a refusal from it overrides the optimistic ok.
        return json(r.ok === false ? 400 : 200, { ok: true, provider, maxTtlSeconds: HARNESS_KEY_READ_FAULT_MAX_TTL_SECONDS, ...r });
      }
      if (body.action === "disarmKeyReadFault") return json(200, { ok: true, provider, ...(await disarmHarnessFault(HARNESS_FAULT_KEY_READ, [provider])) });
      return json(200, { ok: true, provider, ...(await readHarnessFault(HARNESS_FAULT_KEY_READ, [provider])) });
    }
    /* ===== F-655 live proof: the dev-only JIRA TRANSPORT fault lever =====
     * THE FOURTH MEMBER of the `armHarnessFault` family. F-648 made `searchUsers` fail
     * CLOSED for the whole transport class — a 403/429/500 from Jira's user search is
     * `{success:false, reason:"jira_unavailable"}` and no longer an empty success the
     * admin reads as "that person is not on this site" — and nothing a tester can do from
     * outside makes that endpoint fail, so the arm (and the ordering of the admin gate
     * above it) had no live door.
     *
     * THE PATH IS EXACT. `armJiraFault` accepts only a member of `JIRA_FAULT_PATHS`; there
     * is no wildcard and no prefix match, because a lever that can fault "anything under
     * /rest" is a lever that can break an arbitrary product path on a real tenant. The
     * status range, the path allow-list and the TTL cap all live in src/harness-fault.js;
     * this is wiring behind the same HARNESS_SECRET Bearer as everything else here, and
     * the lever is additionally inert wherever that env var is absent (production).
     *
     * It plants no data and returns none: the body carries a path, a status and a TTL. */
    if (body.action === "armJiraFault" || body.action === "disarmJiraFault" || body.action === "readJiraFault") {
      const {
        armJiraFault, disarmHarnessFault, readHarnessFault,
        HARNESS_FAULT_JIRA, JIRA_FAULT_PATHS, HARNESS_JIRA_FAULT_MAX_TTL_SECONDS,
      } = await import("./harness-fault.js");
      const path = String(body.path || "");
      if (!JIRA_FAULT_PATHS.includes(path)) return json(400, { error: `path must be one of: ${JIRA_FAULT_PATHS.join(", ")}` });
      if (body.action === "armJiraFault") {
        const r = await armJiraFault(path, body.status, body.ttlSeconds);
        // The clamps live with the lever; a refusal from it overrides the optimistic ok.
        return json(r.ok === false ? 400 : 200, { ok: true, path, maxTtlSeconds: HARNESS_JIRA_FAULT_MAX_TTL_SECONDS, ...r });
      }
      if (body.action === "disarmJiraFault") return json(200, { ok: true, path, ...(await disarmHarnessFault(HARNESS_FAULT_JIRA, [path])) });
      return json(200, { ok: true, path, ...(await readHarnessFault(HARNESS_FAULT_JIRA, [path])) });
    }
    /* ===== F-667: THE SWEEP — one call that clears a crashed driver's leftovers =====
     * F-664 bounded a fault row on the READ, which ends a lever the moment anything looks
     * at it. It does NOT reach the row nobody will look at again: a driver that dies before
     * its `finally` leaves a fault on a key only that dead process knew, and Forge KVS
     * deletes expired keys lazily (up to 48 h). Worse, every row armed by a build before the
     * F-664 deploy carries no `until` at all — F-667's read-time fix dates those from
     * `armedAt` + the ten-minute ceiling, and THIS action is how they actually leave storage.
     *
     * IT DELETES ONLY EXPIRED ROWS, and it says which: the answer lists every
     * row in the fault keyspace with its stored `until`, the deadline that BOUNDS it and whether
     * that has passed. A live lever is listed and left alone — an action that could cancel a
     * running driver's fault would make every suite's result depend on who else pressed it;
     * `disarmJiraFault` and friends are still how you end a lever you armed. `dryRun: true` —
     * the literal `true` and nothing else (F-673) — lists without deleting.
     *
     * F-673: THE SWEEP IS TIME-BOUNDED AND RESUMABLE, because this door is a web trigger the
     * platform kills at 25 s and the old loop could be killed holding an answer it never sent.
     * A caller may pass `maxMs` (clamped in harness-fault.js to 20 s) and a `cursor`; a sweep
     * that runs out of budget answers 200 with `truncated: true, reason: "budget"` and the
     * cursor to POST back, so "keep going" is this same action again rather than a guess.
     *
     * The enumeration, the budget, the page caps and the env gate all live in
     * src/harness-fault.js; this is wiring behind the same HARNESS_SECRET Bearer as every
     * other action here, and the sweep is additionally inert wherever that env var is absent
     * (production). */
    /* F-676 — THE ONE CALLER-CONTROLLED VALUE THIS ACTION ADDED IS VALIDATED LIKE THE REST.
     * `cursor` used to be a bare `typeof === "string"` check and then went STRAIGHT into
     * `storage.query().cursor(...)` — the only input on this door with no allow-list, next
     * to siblings that check `JIRA_FAULT_PATHS.includes(path)` and a 400-599 status range.
     * And the POST branch has no try/catch of its own (the only outer `catch` is on the GET
     * `what` branch), so a KVS that REJECTS a malformed or foreign token threw out of
     * `testStateTrigger` and the caller got a platform 500 with NO JSON body, where every
     * other refusal here is a 400 with a reason. A resume loop then cannot tell "bad token"
     * from "the tenant is down".
     *
     * So: an opaque-token grammar, a 2 KB ceiling, and a try/catch that turns any throw from
     * the sweep into JSON. This is a DOOR guard, not a tightening of a fail-open:
     * `sweepHarnessFaults` still applies its own `BEGINS_WITH` prefix predicate (the key
     * shape has ONE home, in harness-fault.js, and is not retyped here) and still deletes
     * only expired rows, so a cursor that slips through the grammar can no more reach a live
     * lever than one that does not.
     *
     * F-685: the grammar itself is not retyped here either. It is
     * `sweepCursorWellFormed` in harness-fault.js, next to the encoder that produces the
     * only tokens it admits — the door used to hold a WIDER-charactered but narrower-in-
     * effect copy while the library accepted any string as a legacy raw cursor, which is two
     * answers to one question. Legacy raw cursors are refused now; see that docblock.
     *
     * F-684 — THE DIAGNOSIS IS THE ERROR'S, NOT THE SHAPE OF THE REQUEST.
     * Every throw with a cursor in play used to be answered `400 bad-cursor`, purely because
     * a cursor had been supplied — a cause the failure never carried. A resume loop that hit
     * `RATE_LIMIT_EXCEEDED` on call 4 was told its valid token was bad, dropped it and
     * re-swept from the top, doubling the load on the KVS already refusing it; the identical
     * platform fault on call 1 answered `500 sweep-failed`. The door now discriminates on
     * the ERROR: `decodeSweepCursor` refuses a token SYNCHRONOUSLY, before the sweep touches
     * KVS at all, and only that refusal (`BAD_SWEEP_CURSOR_CODE`) is `bad-cursor`. Anything
     * thrown from the query or the deletes is `sweep-failed`, carrying the platform error's
     * own `code` when it has one, so a caller can back off rather than restart.
     *
     * F-683/F-691/F-692 — THE ANSWER CONTRACT, AND THE ONE FIELD THAT CARRIES IT.
     *
     * `complete` IS THE FINISHED SIGNAL. It is computed in ONE place — `sweepAnswerTail` in
     * harness-fault.js — as `!truncated && !unresolved`, where `unresolved` is a failed
     * delete from ANY call of this drain, inherited through the resume token. This door
     * returns it EXPLICITLY, after the spread, so a future reshape of the library's answer
     * cannot quietly stop carrying it.
     *
     * ⚠ DEPRECATED: DERIVING FINISHEDNESS FROM `truncated` (or from `cursor === null`).
     * Both are per-CALL facts. A drain that budget-broke after a page whose deletes failed
     * answers `truncated: false` on its final call while rows it condemned are still live —
     * that is F-691, and re-deriving is how a caller re-acquires the bug the library just
     * fixed. Read `complete`. A caller loops while `cursor !== null` and STOPS ONLY ON
     * `complete === true`; `failedResume` (a token, or null) names the page to go back to.
     *
     * `reason: "deletes-failed"` carries the cursor of the page whose deletes failed so the
     * caller retries it, and `reason: "deletes-failing"` says the call is NOT converging —
     * a whole batch landed nothing — so a loop must back off instead of spinning. */
    /* ===== F-706 live proof: the dev-only DELETE fault lever =====
     * THE SEVENTH MEMBER of the `armHarnessFault` family, and the one the SWEEP's own answer
     * contract needs. F-682 (`deletes-failing`), F-683 (`deletes-failed` + `failedResume`),
     * F-690 (the drain's back-off) and F-691 (the unresolved failure riding the resume token)
     * are all about what the sweep does when a KVS delete REFUSES — and nothing a tester can
     * do on a real tenant makes one refuse. plant-sweep-live saw `failed: 0` throughout, so
     * that whole half of the contract was proven against the offline mock only.
     *
     * THE PREFIX IS EXACT, and it is the PLANT's: `armDeleteFault` accepts
     * `HARNESS_FAULT_PLANT_PREFIX` and nothing else, by equality, exactly as `armJiraFault`
     * accepts one path. A lever that could fail an arbitrary delete could strand app data;
     * this one can only refuse to remove inert ballast nothing reads, which expires on its
     * own in 60 s anyway. The prefix allow-list, the mode allow-list, the count cap and the
     * TTL cap (120 s) all live in src/harness-fault.js, never retyped here, and the lever
     * is consulted in exactly one place: the shared delete batch of the sweep and the clear.
     *
     * F-722 — AND THE COUNT CAP THE DOOR PUBLISHES IS THE DRAINABLE ONE. It used to be a
     * hand-set 50, about five times what a drain tolerates: a faulted sweep spends only
     * `KVS_DELETE_BATCH` units per call and answers byte-identically, so the drain's spin
     * detector stops at `IDENTICAL_ANSWER_LIMIT * KVS_DELETE_BATCH` units with the rest still
     * armed — and the cleanup, which reads the same lever, then fails with "PLANTED ROWS MAY
     * REMAIN" for a reason the tenant does not contain. `DELETE_FAULT_DRAINABLE_MAX` is
     * derived from those two constants, and the arm answers it as `maxCount` AND as
     * `drainableMax`, so a driver reading this door learns the number and its name.
     *
     * It plants no data and returns none: the body carries a prefix, a mode, a count and a
     * TTL. Disarm and read are the generic pair, keyed by the same prefix. */
    if (body.action === "armDeleteFault" || body.action === "disarmDeleteFault" || body.action === "readDeleteFault") {
      const {
        armDeleteFault, disarmHarnessFault, readHarnessFault,
        HARNESS_FAULT_DELETE, HARNESS_FAULT_PLANT_PREFIX, DELETE_FAULT_MODES,
        DELETE_FAULT_DRAINABLE_MAX, HARNESS_DELETE_FAULT_MAX_TTL_SECONDS,
      } = await import("./harness-fault.js");
      // The one prefix this family may touch has ONE home; the door names it, never a literal.
      const prefix = HARNESS_FAULT_PLANT_PREFIX;
      if (body.action === "armDeleteFault") {
        const r = await armDeleteFault({ prefix: body.prefix === undefined ? prefix : body.prefix, mode: body.mode, count: body.count, ttlSeconds: body.ttlSeconds });
        // The clamps live with the lever; a refusal from it overrides the optimistic ok.
        return json(r.ok === false ? 400 : 200, {
          ok: true, prefix, modes: DELETE_FAULT_MODES,
          maxCount: DELETE_FAULT_DRAINABLE_MAX, drainableMax: DELETE_FAULT_DRAINABLE_MAX,
          maxTtlSeconds: HARNESS_DELETE_FAULT_MAX_TTL_SECONDS, ...r,
        });
      }
      if (body.action === "disarmDeleteFault") return json(200, { ok: true, prefix, ...(await disarmHarnessFault(HARNESS_FAULT_DELETE, [prefix])) });
      return json(200, { ok: true, prefix, ...(await readHarnessFault(HARNESS_FAULT_DELETE, [prefix])) });
    }

    if (body.action === "sweepHarnessFaults") {
      const { sweepHarnessFaults, sweepCursorWellFormed, BAD_SWEEP_CURSOR_CODE } = await import("./harness-fault.js");
      const rawCursor = body.cursor;
      let cursor = null;
      if (rawCursor !== undefined && rawCursor !== null) {
        // The same predicate the library applies, run early so an over-long or non-string
        // body is refused before anything else looks at it.
        if (!sweepCursorWellFormed(rawCursor)) return json(400, { ok: false, reason: "bad-cursor" });
        cursor = rawCursor;
      }
      let r;
      try {
        r = await sweepHarnessFaults({
          dryRun: body.dryRun === true,
          maxMs: typeof body.maxMs === "number" ? body.maxMs : undefined,
          cursor,
        });
      } catch (e) {
        const message = String((e && e.message) || e).slice(0, 300);
        const code = (e && typeof e.code === "string" && e.code) || null;
        // The ONLY `bad-cursor` is the library's own pre-KVS refusal of the token.
        if (code === BAD_SWEEP_CURSOR_CODE) return json(400, { ok: false, reason: "bad-cursor", error: message });
        // Everything else is the platform's, with its code when it carries one — never a
        // bodyless 500, and never the caller's token blamed for the tenant's state.
        return json(500, { ok: false, reason: "sweep-failed", code, error: message });
      }
      // A refusal from the lever overrides the optimistic ok, exactly like the arm actions.
      // `complete` is named EXPLICITLY (F-692): it is the finished signal, and a field that
      // only ever arrives by spread is a field a reshape can drop without anyone noticing.
      return json(r.ok === false ? 400 : 200, { ok: true, ...r, complete: r.complete === true });
    }
    /* ===== F-688: THE BALLAST — the only way to give the sweep a second page =====
     * Everything F-673/F-674/F-677/F-682/F-683 built into `sweepHarnessFaults` — the resume
     * token, the real KVS cursor round-trip, the paced deletes, the progress guarantee and
     * `complete` — engages only once the fault keyspace is bigger than one page of
     * 100. The arming actions above cannot get there: one row per exact path, one per
     * provider, a handful per connection. So a tester on a real tenant could never prove the
     * multi-page path, and every resume assertion in this repo stayed offline-only.
     *
     * THE PLANTED ROWS ARE INERT, and that is what licenses a lever that writes five hundred
     * of them when the dangerous ones are capped at one. They go under the kind `plant`, and
     * NOTHING READS THAT KIND: every consumer names its kind exactly —
     * `harnessFaultArmed(HARNESS_FAULT_GIT_DISPATCH…)`, `(HARNESS_FAULT_HOOK_PROMOTE…)`,
     * `readHarnessFault(HARNESS_FAULT_KEY_READ…)` inside `keyReadFaultMode`,
     * `readHarnessFault(HARNESS_FAULT_JIRA…)` inside `jiraFaultStatus`, and the four read
     * actions above, which pass those same four constants. There is no wildcard read, no
     * prefix read and no enumeration anywhere but `sweepHarnessFaults`, which only DELETES.
     * A planted row therefore occupies the keyspace and bites nothing.
     *
     * REFUSED IN PRODUCTION, by the same mechanism as every other action here and one more
     * inside the lever: `HARNESS_SECRET` is set in development and staging and NEVER in
     * production, so this door is 404 there, and `plantHarnessFaults` / `clearPlantedFaults`
     * each ask `harnessEnabled()` as their first statement and answer `harness-off` even if
     * something inside the app calls them directly.
     *
     * `n` IS CLAMPED IN THE LEVER, not here — the clamp lives with the constant it bounds,
     * like the 400-599 status range and the TTL caps. `expired: true` dates the rows in the
     * past so the sweep will actually delete them; anything else plants live rows the sweep
     * must list and leave alone. Every row carries its TTL in the SECONDS shape, so forgotten
     * ballast leaves on its own even if nobody clears it.
     *
     * F-696 — THIS DOOR HAS A BUDGET AND A RESUME, LIKE THE SWEEP'S. Measured live: 200 rows
     * take 17–18 s, so the documented 500 was ~45 s against a trigger killed at 25 s, and a
     * plant that timed out answered NOTHING while having written an unknown number of rows.
     * `maxMs` (clamped in the lever to 20 s) bounds the call; a `budget` break answers
     * F-724/F-745 — AND THE ANSWER SAYS HOW IT IS RESUMED. `resume: "start-index"` means
     * carry on from `nextIndex`; `resume: "repost"` (`reason: "clearing"` / `"clear-failed"`)
     * means send this SAME body again — `nextIndex` deliberately does not advance there, and
     * `clearedSoFar` / `remainingStale` are the progress to watch instead (POST `clearToken`
     * back to keep `clearedSoFar` cumulative, F-744); `resume: "stop"` (`writes-failed`)
     * means do NOT loop — the store refused writes, the population is short, and nothing
     * downstream may be asserted over it. The mapping is the lever's `plantResumeMode` and is
     * never re-derived here.
     * `{ planted, failed, truncated, reason: "budget", nextIndex }` and the caller POSTs the
     * SAME `n` back with `startIndex: nextIndex` until `complete: true`. `maxN` is what THIS
     * call may ask for — one call's worth for a fresh plant, the full population for a resumed
     * one — and it is computed by the lever's `plantMaxForCall`, never retyped here.
     *
     * F-710 — HITTING THAT CEILING IS A TRUNCATION, NOT A FINISH. A fresh `{ n: 500 }` plants
     * 150 and answers `truncated: true, reason: "call-max", nextIndex: 150` with `n` still 500:
     * the population is ECHOED, never rewritten to the clamp. It used to answer `n: 150,
     * complete: true`, so a caller looping "until complete" planted one call's worth believing
     * it had planted what it asked for — the opposite of the loop this door documents, and the
     * reason a live driver's `planted === 200` assertion was red. `maxN` is this call's
     * ceiling and `n` is the population: two different numbers, both in the answer.
     *
     * F-697/F-709 — the TTL covers the WALL TIME of the drain this door forces (one budget
     * plus a cold start per resumed call, plus a full minute after the last row), and the
     * whole population shares ONE deadline carried on `plant:000`, so the head of a large
     * `expired: false` population is still live when the sweep the tester is about to run
     * walks over it. `armedAt` is still stamped per batch: two stamps, two jobs.
     *
     * F-708 — `startIndex` IS JUDGED AGAINST `n`, in the lever, and past it is a REFUSAL that
     * comes back through this door's existing `ok === false` → 400 path. It used to be a 200
     * whose `nextIndex` pointed behind its own `startIndex` and whose `complete: true` told a
     * drain loop that a keyspace it never looked at was planted. Exactly AT `n` is the loop's
     * own last POST and answers `noop: true, planted: 0, complete: true`. A FRESH plant also
     * removes any older population past `n` first and reports it as `cleared`, because the
     * keys are `i`-derived: a smaller re-plant would otherwise leave the previous tail alive
     * under an answer that names a population the store does not hold. */
    if (body.action === "plantHarnessFaults") {
      const { plantHarnessFaults, plantMaxForCall, HARNESS_FAULT_PLANT_PREFIX } = await import("./harness-fault.js");
      const r = await plantHarnessFaults({
        n: body.n,
        expired: body.expired === true,
        maxMs: typeof body.maxMs === "number" ? body.maxMs : undefined,
        startIndex: body.startIndex,
        /* F-744: the running cleared count of an identical re-POST loop, carried in the
         * answer's own `clearToken`. Best-effort in the lever — it is a progress report,
         * not an input to a decision — so the door forwards it and judges nothing. */
        clearToken: typeof body.clearToken === "string" ? body.clearToken : undefined,
      });
      // A refusal from the lever overrides the optimistic ok, exactly like the arm actions.
      // `complete` is named EXPLICITLY (F-692): it is the finished signal, and a field that
      // only ever arrives by spread is a field a reshape can drop without anyone noticing.
      return json(r.ok === false ? 400 : 200, {
        ok: true, maxN: plantMaxForCall(body.startIndex), prefix: HARNESS_FAULT_PLANT_PREFIX,
        ...r, complete: r.complete === true,
      });
    }
    /* The other half: delete the ballast, and ONLY the ballast. The prefix is NOT a
     * parameter — no caller gets to name the keyspace an unconditional delete walks — and it
     * is bound to `HARNESS_FAULT_PLANT_PREFIX` in the library. The answer is the sweep's own shape
     * (`truncated` / `reason` / `cursor` / `complete` / `failedResume`), assembled by the same
     * `sweepAnswerTail`, validated and diagnosed by the same two rules: `sweepCursorWellFormed`
     * at the door (F-676/F-685) and only the library's own pre-KVS refusal of a token is
     * `bad-cursor` (F-684). `complete` is the finished signal here too, for the same reason
     * (F-691/F-692): `truncated` is a per-CALL fact and re-deriving from it is deprecated. */
    if (body.action === "clearPlantedFaults") {
      const { clearPlantedFaults, sweepCursorWellFormed, BAD_SWEEP_CURSOR_CODE } = await import("./harness-fault.js");
      const rawCursor = body.cursor;
      let cursor = null;
      if (rawCursor !== undefined && rawCursor !== null) {
        if (!sweepCursorWellFormed(rawCursor)) return json(400, { ok: false, reason: "bad-cursor" });
        cursor = rawCursor;
      }
      let r;
      try {
        r = await clearPlantedFaults({ maxMs: typeof body.maxMs === "number" ? body.maxMs : undefined, cursor });
      } catch (e) {
        const message = String((e && e.message) || e).slice(0, 300);
        const code = (e && typeof e.code === "string" && e.code) || null;
        if (code === BAD_SWEEP_CURSOR_CODE) return json(400, { ok: false, reason: "bad-cursor", error: message });
        return json(500, { ok: false, reason: "clear-failed", code, error: message });
      }
      // Explicit for the same reason as the sweep above (F-692): this is THE finished signal.
      return json(r.ok === false ? 400 : 200, { ok: true, ...r, complete: r.complete === true });
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
    // ===== 1.5 §5 probes P1–P4 (dev-gated, dev/staging only) =====
    // Every one of these returns STATUS CODES, RESPONSE KEYS and an ERROR CLASS only —
    // never a body, never a token, never a comment id.
    //
    // P1 — the JSM audience contradiction. Posts one short fixed comment as the app
    // (internal: with `sd.public.comment = {internal:true}`; public: with no property),
    // reads it back through the JSM request-comment API and DELETES it on every path.
    if (body.action === "probeJsmComment") {
      if (typeof body.issueKey !== "string" || !/^[A-Z][A-Z0-9_]*-\d+$/.test(body.issueKey)) return json(400, { error: "issueKey required" });
      const mode = body.mode === "public" ? "public" : "internal";
      const { default: api, route } = await import("@forge/api");
      const r = await runJsmCommentProbe({ issueKey: body.issueKey, mode, calls: createJsmProbeCalls(api, route) });
      return json(200, r);
    }
    // P2 — what a site answers when the app is NOT installed on Confluence. The shape of
    // the NOT-INSTALLED answer is what 1.5 needs; this site may well HAVE it installed,
    // in which case `installed:true` is the honest result and the question is still open.
    if (body.action === "probeConfluenceInstalled") {
      try {
        const { createConfluenceClient, INSTALL_PROBE_PATH } = await import("./confluence-client.js");
        // The transport is instrumented ONLY to capture the status and the top-level
        // response KEYS; the body itself is read and dropped here and never returned.
        let status = null; let bodyKeys = [];
        const client = createConfluenceClient({
          request: async (path, init) => {
            const { default: api } = await import("@forge/api");
            const res = await api.asApp().requestConfluence(path, init);
            status = res && res.status != null ? res.status : null;
            const clone = typeof res.clone === "function" ? res.clone() : null;
            if (clone) { const data = await jsonOf(clone); bodyKeys = keysOf(data); }
            return res;
          },
        });
        const out = await client.probeInstalled();
        return json(200, { probePath: INSTALL_PROBE_PATH, installed: out.installed === true, status: status ?? out.status ?? null, code: out.code || null, bodyKeys });
      } catch (e) {
        return json(200, { errorClass: errorClassOf(e) });
      }
    }
    // P3/P4 — the same two reaches FROM THE CONSUMER, which is where a VA item and a
    // queued Confluence post-function actually run. One NON-AI task type, two kinds; the
    // consumer writes `harness_probe:<kind>:<id>` (TTL 10 min) and `readHarnessProbe`
    // reads it. The handler additionally refuses when HARNESS_SECRET is absent.
    if (body.action === "probeConfluenceFromConsumer" || body.action === "probeServicedeskFromConsumer") {
      try {
        const { Queue } = await import("@forge/events");
        const { HARNESS_PROBE_TASK, harnessProbeKey } = await import("./async-handler.js");
        const kind = body.action === "probeServicedeskFromConsumer" ? "servicedesk" : "confluence";
        // P4 runs on the long queue by default (the sweep it stands in for does);
        // P3 answers the question on whichever queue the caller asks for.
        const long = kind === "servicedesk" ? body.long !== false : body.long === true;
        const probeId = "p" + Date.now().toString(36);
        const taskId = "harnessprobe-" + probeId;
        const queue = new Queue({ key: long ? "long-queue" : "async-ai-queue" });
        await queue.push({ body: { taskType: HARNESS_PROBE_TASK, taskId, params: { kind, probeId, queue: long ? "long" : "standard", enqueuedAt: new Date().toISOString() } } });
        return json(200, { id: probeId, kind, queue: long ? "long" : "standard", key: harnessProbeKey(kind, probeId) });
      } catch (e) {
        return json(200, { errorClass: errorClassOf(e) });
      }
    }
    if (body.action === "readHarnessProbe") {
      const id = String(body.id || "");
      if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(id)) return json(400, { error: "id required" });
      const { harnessProbeKey, HARNESS_PROBE_KINDS } = await import("./async-handler.js");
      const kind = HARNESS_PROBE_KINDS.includes(body.kind) ? body.kind : "confluence";
      const key = harnessProbeKey(kind, id);
      return json(200, { id, kind, key, value: (await storage.get(key)) || null });
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
        // F-590 — the skill index has ONE writer (src/skills.js). The hook
        // used to hard-delete here, bypassing the builtin flip-to-disabled rule.
        const { deleteSkillRows } = await import("./skills.js");
        const r = await deleteSkillRows(body.id, { who: "test-hook" });
        return json(200, { success: true, removed: r.removed, mode: r.mode });
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
    // Invoke an allowlisted resolver through the REAL dispatcher (resolver.getDefinitions()
    // → exported `handler`), not through an extracted core: the point is to exercise the
    // resolver body's own wiring — filter args, context construction, sanitizeObject —
    // which unit tests of the pure pieces cannot reach. getConfigs also carries the
    // one-shot ownership/slim migrations, so this is how the harness fires and then
    // verifies them on live data. THE ALLOW-LIST BELOW IS THE ONLY AUTHORITY on what may
    // be driven: most of it is read-only, the mutators on it are named and justified where
    // they are listed, and this must never become a generic invoke-anything bridge. The
    // whole trigger is dev/staging only — the HARNESS_SECRET Bearer gate at the top of this
    // handler 404s wherever the variable is unset, which is every production deployment —
    // and a driver that calls a mutator MUST restore what it changed in the same run.
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
        "getMemories", "addMemory", "updateMemory", "deleteMemory", "getMemorySettings", "saveMemorySettings",
        // F-189 — read-only: what the store weighs against both ceilings.
        "getMemoryStoreStats",
        // F-253 — read-only knowledge/read surfaces, here to prove TWO things live that no
        // other hook path can reach. (1) The VIEWER FLOOR (F-235): a viewer-role account must
        // still get docs, skills, skill content, knowledge counts and logs — these resolvers
        // are the floor, so a regression that over-tightens requireRole shows up as a denial
        // here rather than in a UI nobody scripts. (2) The explainRule OWNER ASYMMETRY: the
        // same rule read by its owner and by a non-owner must differ in what canActOnConfig
        // permits, which only a two-accountId invocation can demonstrate.
        // getKnowledgeCounts and getLogs are already allowlisted above; listed here in the
        // comment only, not re-added — one entry, one home.
        "getContextDocs", "getSkills", "getSkillContent", "explainRule",
        /* ── F-637 / F-638 — THE FIVE KNOWLEDGE/PROVIDER DOORS THAT HAD NO LIVE ARM. ─────
         * Each of these was refused BY NAME (`functionKey not allowlisted: …`), so five
         * shipped fixes could be proven offline and nowhere else. The hook is the right
         * instrument for all five because it is the only path that can choose the CALLING
         * PRINCIPAL (`body.accountId` → `principal.accountId` on the handler call below),
         * and every one of these findings is about WHO the door answers.
         *
         * THREE OF THEM ARE MUTATORS (`saveSkill`, `deleteSkill`, `deleteContextDoc`).
         * They are admitted on the same terms as `saveListener`/`deleteScheduledJob`/
         * `addMemory` above and no wider: this whole trigger is DEV/STAGING ONLY — it is
         * gated by the `HARNESS_SECRET` Bearer check at the top of this handler and 404s
         * wherever that variable is unset, which is every production deployment. They keep
         * their OWN gates (the hook bypasses nothing: a scope-"own" editor still gets the
         * `notOwner` sentence, a builtin row still asks the admin question), and A DRIVER
         * THAT CALLS THEM MUST RESTORE WHAT IT CHANGED — re-save the skill it edited,
         * re-seed the doc it deleted — in the same run, in a `finally`.
         *
         * NOT WIDENED BY ANY OF THIS: every deploy/dispatch key stays out. `setupGitPipeline`
         * is still absent, `triggerGitDeploy` is still reachable ONLY through the F-627
         * outdated-only wrapper below, and the Coder write doors are still forced to
         * simulation. A knowledge door is not a precedent for a door that touches a
         * customer's repository.
         *
         *   saveSkill            — F-622: the unknown-id arm must answer the same sentence
         *                          a colleague's skill does, for a scope-"own" editor.
         *   deleteSkill          — F-624: the same existence parity on the destructive twin.
         *   deleteContextDoc     — F-625: the same existence parity on the docs delete.
         *   getContextDocContent — F-626: the viewer floor on the doc CONTENT reader, which
         *                          had no gate of any kind.
         *   getOpenAIKey         — F-629/F-633: the only consumer of the `armKeyReadFault`
         *                          lever, and the door F-633 put a viewer floor on. It
         *                          returns `hasKey`/`isByok` booleans and a base URL — never
         *                          key material — and the fault lever it reads is itself
         *                          inert without HARNESS_SECRET.
         */
        "saveSkill", "deleteSkill", "deleteContextDoc", "getContextDocContent", "getOpenAIKey",
        /* F-655 — `searchUsers`, on exactly the same terms as the five above and for the
         * same reason: F-648 made it fail CLOSED for the whole Jira transport class
         * (`reason:"jira_unavailable"`, kept distinct from the F-257 admin refusal), and
         * neither that arm nor the ORDER of the admin gate above it could be exercised on
         * a tenant — the key was refused by name here, and nothing made Jira's user search
         * fail. The `armJiraFault` action above is the other half of that door.
         *
         * READ-ONLY. It grants nothing: it forwards a query string to Jira's own
         * `/rest/api/3/user/search` as the app and returns accountId / displayName /
         * avatar / (when Jira discloses it) email — strictly less than `getAppAdmins`,
         * already allowlisted, and it writes nothing. It keeps its OWN admin gate, which
         * is half of what is worth testing: driven with a non-admin `body.accountId` it
         * must answer the refusal, and it must do so BEFORE the fault lever is consulted. */
        "searchUsers",
        // F-566 — the knowledge-pack surfaces. `getKnowledgePacks` is a pure READ of the
        // generated index (titles, tags, sizes, budgets — never a pack BODY), the same
        // class as `getKnowledgeCounts` above. `saveKnowledgeSettings` is a WRITE and is
        // admitted deliberately: "the packs are opt-out" is a product claim, and with the
        // resolver closed to the harness the disable path had no live proof on any build —
        // a tester could read the settings row through `?what=kvs` and never write it.
        // It keeps its OWN admin gate (requireAdmin) — the hook does not bypass it, so a
        // harness driving it with a non-admin accountId still gets the refusal, which is
        // half of what is worth testing. It plants no credential, calls no model and
        // writes nothing outside this instance's own settings row; the clamp in
        // `saveKnowledgeSettings` runs before the write, so a phantom pack id cannot be
        // stored through here either.
        "getKnowledgePacks", "saveKnowledgeSettings",
        // 1.5 commit 5b — the Virtual Administrator READ surfaces, so a live pass can
        // prove the permission floors and the answer shapes on real data: the editor
        // floor on listVaAgents/getVaStatus and the ADMIN floor on the three below.
        // DELIBERATELY ABSENT, and this is the same line the git resolvers draw:
        // saveVaMemory, approveVaDraft, rejectVaDraft, pauseVa, resumeVa, runVaTickNow
        // and runVaPostNow. Every one of those either changes a live automation or
        // moves a human's verdict onto a message queued for a real customer, and a
        // harness that can run a VA tick is a harness that can be turned into one.
        // `vaWizardStep` is also absent: it CREATES an agent and it calls a model.
        "listVaAgents", "getVaStatus", "listVaDrafts", "listVaEffects", "getVaMemory",
        // F-608 — `getVaRecentPurges` joins them on the same terms: it is a READ over
        // F-595's purge tombstones (which agents wrote to Jira while being deleted), it
        // takes no id, it changes nothing and it clears nothing — `clearPurgeTombstone`
        // stays the only authority on whether a tombstone may go, and it is not here.
        "getVaRecentPurges",
        // 1.4 commit 2 — the git-connection READ surfaces only, so a live pass can
        // prove the admin gate and the "a resolver never returns a token" contract
        // on real data. DELIBERATELY ABSENT: saveGitConnection, deleteGitConnection,
        // saveForgeIdentity, clearForgeIdentity, rotateGitCredential. A harness that
        // can plant or destroy a credential is a harness that can be turned into
        // one, and a planted token would then exist on a real tenant — so the write
        // side is driven by a human admin in the UI, never from here. F-339 does NOT
        // relax this: the `plantHookSecret` action can plant a TOKENLESS stand-in row
        // (status "harness", no secret key, one repo) so the inbound path is provable,
        // and `deleteHarnessConnection` refuses anything else — the resolvers stay out. The kvSet
        // allow-list below is NOT widened for `git_conn:*` / `git_conn_secret:*`
        // for the same reason: secrets are never plantable.
        // `testGitConnection` is here despite writing the whoami verdict back to the
        // row: that WRITE is the thing under test (the auth_dead banner has one
        // source), it creates no credential, and it cannot delete one.
        "listGitConnections", "testGitConnection", "getForgeIdentityStatus",
        // 1.4 commit 7 — the pipeline READ. `git_pipeline:*` rows are also reachable
        // through the GET `?what=kvs` read (deliberately unrestricted: it is a read,
        // behind HARNESS_SECRET), which is how a tester confirms the bounded row landed
        // on the exact slot. DELIBERATELY ABSENT: setupGitPipeline — it pushes the deploy
        // credential into a customer's repository and commits to it, and a harness that
        // can do that is a harness that can be turned into one.
        //
        // F-627 — `triggerGitDeploy` IS here now, and ONLY through the outdated-only
        // wrapper below. The sentence above has not been relaxed: what changed is that
        // the hook can no longer ask for a deploy that would actually be DISPATCHED.
        // `triggerPipelineDeploy` refuses an outdated row with `pipeline_outdated` BEFORE
        // it touches the provider (src/git-pipeline.js), so the wrapper admits the call
        // only when the stored row is outdated by the product's own predicate — the
        // resolver is then exercised for real and the one thing it can reach is a
        // refusal. F-611 is the reason it had to be reachable at all: the fix lives in
        // the resolver, and the Code tab's button (F-602) is the half a reader sees.
        //
        // The kvSet allow-list below is still NOT widened for `git_pipeline:*` — the
        // F-627 `pipelineRow` action is the door, and it is a CLAMPED plant that can
        // never write `lockHash`/`lockScopes`, which is the permission-lock objection the
        // old wording recorded here.
        "getGitPipelineStatus", "triggerGitDeploy",
        // 1.4 commit 8 — the Coder thread READ only, so a live pass can prove the owner
        // asymmetry (owner sees the thread, another editor is refused with `not-owner`)
        // on a real row. DELIBERATELY ABSENT: startCoderTurn and confirmCoderTicket. The
        // first spends a frontier model's tokens on somebody's tenant; the second is the
        // one door between a model's request and a write to a customer's repository, and
        // a harness that can walk through it is a harness that can be turned into one.
        // The kvSet allow-list below is NOT widened for `coder_thread:*` / `coder_ticket:*`
        // either: a plantable ticket is a plantable CONSENT, which is the fact the whole
        // confirm flow depends on. (`?what=kvs` still READS those rows — a read behind
        // HARNESS_SECRET is how a tester confirms the thread landed.)
        // F-387 — the CAPABILITY READ joins them. `getAgentCapability` answers "may the
        // Coder run on this instance, and if not why" from the same facts the gate uses.
        // It is a pure READ (no write, no model call, no token spend), the same class as
        // `getProvider`/`getAgentModel` above, and it was absent by omission rather than by
        // the policy stated in the paragraph above: with it closed, the refusal a Standard
        // tenant actually emits could only ever be DERIVED, never observed.
        "getAgentCapability",
        // F-387 — the two WRITE doors, admitted ONLY through the forced-simulation wrapper
        // below. The paragraph above still holds and is not relaxed: what changed is that
        // the harness can no longer ask for a LIVE turn at all. `startCoderTurn` is rewritten
        // to `simulation:true` whatever the payload says, and `confirmCoderTicket` is refused
        // unless the ticket it answers belongs to a thread that is itself simulated — so no
        // write to a customer's repository can be planted through this hook, which is the
        // property the original exclusion was protecting. A frontier model's tokens are still
        // spent by a simulated turn; that is a COST, not a write, and it is bounded by the
        // same HARNESS_SECRET gate as everything else here.
        "startCoderTurn", "confirmCoderTicket",
        "getCoderThread"]);
      const functionKey = body.functionKey || body.name;
      if (!ALLOWED_KEYS.has(functionKey)) {
        return json(400, { error: `functionKey not allowlisted: ${functionKey}` });
      }
      /* ── F-387 — THE FORCED-SIMULATION WRAPPER. ───────────────────────────────────────
       * The hook may drive the Coder, but it may never drive it LIVE.
       *   startCoderTurn      → `simulation` is OVERWRITTEN with true. The payload cannot
       *                         ask for a live turn; the engine fixes the mode from the
       *                         thread's FIRST turn (F-360), so the whole thread is
       *                         simulated from here on.
       *   confirmCoderTicket  → the payload has no say in the mode at all (F-360 again:
       *                         the thread row is the authority), so the check is on the
       *                         ROW: the ticket must be simulated, and so must the thread
       *                         it belongs to. Anything else is refused here, before the
       *                         resolver, with the reason named.
       * A refusal is a 400 with `harnessRefusal`, never a silent pass — a harness that
       * quietly does something other than what it was asked is worse than one that stops. */
      let hookPayload = body.payload || {};
      if (functionKey === "startCoderTurn") {
        hookPayload = { ...hookPayload, simulation: true };
      } else if (functionKey === "confirmCoderTicket") {
        const { coderTicketKey, coderThreadKey } = await import("./coder-engine.js");
        const ticketId = String(hookPayload.ticketId || "");
        let ticket = null;
        try { ticket = await storage.get(coderTicketKey(ticketId)); } catch (e) { ticket = null; }
        if (!ticket || typeof ticket !== "object") {
          return json(400, { error: "harnessRefusal: no such Coder ticket — the hook will not answer a ticket it cannot read", harnessRefusal: "ticket-unreadable" });
        }
        let thread = null;
        try { thread = await storage.get(coderThreadKey(ticket.issueKey, ticket.threadId)); } catch (e) { thread = null; }
        // BOTH rows must say simulated. A missing thread row is NOT a licence: unknown is
        // refused, the same direction every other gate in this app fails.
        if (ticket.simulation !== true || !thread || thread.simulation !== true) {
          return json(400, {
            error: "harnessRefusal: the hook only answers a ticket on a SIMULATED thread — a live confirm writes to a customer's repository",
            harnessRefusal: "not-simulated",
            ticketSimulation: ticket.simulation === true,
            threadSimulation: thread ? thread.simulation === true : null,
          });
        }
      } else if (functionKey === "triggerGitDeploy") {
        /* ── F-627 — THE OUTDATED-ONLY WRAPPER. ─────────────────────────────────────
         * Same shape and same reason as the forced-simulation wrapper above: the hook may
         * drive this resolver, but it may never drive it into a REAL dispatch. A deploy
         * on a current row starts CI on a customer's repository; a deploy on an OUTDATED
         * row is refused by `triggerPipelineDeploy` with `pipeline_outdated` before the
         * provider is touched at all, and that refusal is the whole of F-611.
         *
         * So the row is read HERE and asked `pipelineOutdated` — the product's own
         * predicate from src/shared/git-pipeline-state.js, never a restatement — and
         * anything else is refused before the resolver runs. A row that cannot be read is
         * refused too: unknown is not a licence, the same direction every gate here fails. */
        const { readPipelineRow } = await import("./git-pipeline.js");
        const { pipelineOutdated } = await import("./shared/git-pipeline-state.js");
        let row = null;
        try { row = await readPipelineRow(hookPayload.connectionId, hookPayload.repo); } catch (e) { row = null; }
        if (!row || !pipelineOutdated(row)) {
          return json(400, {
            error: "harnessRefusal: the hook only triggers a deploy on an OUTDATED pipeline row — any other row would be dispatched for real against a customer's repository",
            harnessRefusal: "not-outdated",
            hasRow: Boolean(row),
            outdated: pipelineOutdated(row),
          });
        }
      }
      try {
        const { handler } = await import("./index.js");
        // HARNESS-ONLY: checkLicense reads context.license, which the platform supplies on a
        // real resolver invocation. A webtrigger's getAppContext() carries the SAME license
        // object (verified live), so forwarding it makes the hook a faithful stand-in.
        let hookLicense;
        try { const { getAppContext } = await import("@forge/api"); hookLicense = getAppContext()?.license; } catch (e) { hookLicense = undefined; }
        const r = await handler(
          { call: { functionKey, payload: hookPayload }, context: {} },
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
      // F-566 — the knowledge-pack SETTINGS row (a settings key, never a secret), so a
      // driver can back up the instance's pack switches before it flips them and put them
      // back afterwards. The resolver alone cannot do that: it clamps to the known pack
      // ids, which is right for a product surface and wrong for a restore.
      const KEYS = new Set(["COGNIRUNNER_USAGE", "COGNIRUNNER_SEAT_SNAPSHOT", "COGNIRUNNER_EDITION_SNAPSHOT",
        "COGNIRUNNER_AI_PROVIDER", MEMORIES_KEY, MEMORY_SETTINGS_KEY, MEMORY_STORE_FULL_KEY,
        KNOWLEDGE_SETTINGS_KEY]);
      for (const p of PROVIDER_IDS) for (const slot of providerSlotsFor(p)) KEYS.add(slot);
      if (!KEYS.has(body.key)) return json(400, { error: `key not allowlisted: ${body.key}` });
      if (body.value === null) await storage.delete(body.key);
      else await storage.set(body.key, body.value);
      return json(200, { key: body.key, set: body.value === null ? "deleted" : true, now: (await storage.get(body.key)) ?? null });
    }
    /*
     * F-627 — THE PIPELINE-ROW DOOR, and why it had to exist.
     *
     * F-604, F-605 and F-611 are all about ONE state of a `git_pipeline:*` row — the
     * committed workflow is older than the scaffold this build installs (`outdated`), or
     * a setup run died and left "queued" behind (`stuck`). Neither state was reachable on
     * a tenant: a setup always stamps the CURRENT `SCAFFOLD_VERSION`, and there is no
     * lever that stops the `gitpipeline` consumer mid-run. So the prefilled setup form,
     * the preserved header facts, the stuck-queued banner and the `pipeline_outdated`
     * deploy refusal were render-proven and live-unprovable. This is their door.
     *
     * WHAT IT PLANTS, AND WHAT IT REFUSES TO. The row is built FIELD BY FIELD from an
     * allow-list — status, scaffold version, the two ageable timestamps, the declared
     * scaffold variables, the developer space and app ids, the branch. Everything else on
     * a real row is written as its empty value, and TWO fields are deliberately never
     * plantable at all: `lockHash` and `lockScopes`. That is the objection the old
     * comment on the invoke allow-list recorded — "a plantable row is a plantable
     * permission LOCK" — and it is answered by construction rather than by prose: this
     * door cannot state what scopes a repository's committed lock declares, so it cannot
     * talk any gate into accepting one. `findPlantedSecret` refuses the body outright if
     * it so much as names a credential.
     *
     * IT NEVER OVERWRITES A REAL ROW. A plant lands only on a free key or on a key this
     * same door planted (`plantedBy: "harness"`), and `clear` deletes only a planted row —
     * so a harness pointed at a tenant with a genuinely installed pipeline refuses instead
     * of destroying the record of it. Same discipline as `deleteHarnessConnection`.
     *
     * THE READ IS THE PRODUCT'S OWN ANSWER. It returns `publicPipelineRow(row)` — the
     * exact projection `getGitPipelineStatus` hands the Code tab — plus the three
     * predicates from `src/shared/git-pipeline-state.js` computed on the stored row, so a
     * driver grades the planted state against the SAME functions the tab renders from and
     * never against a restatement of them.
     */
    if (body.action === "pipelineRow") {
      const connId = String(body.connId || body.connectionId || "");
      const repoRaw = String(body.repoId || body.repo || "");
      if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(connId)) return json(400, { error: "connId required" });
      if (!/^[^/\s]+\/[^/\s]+$/.test(repoRaw) || repoRaw.length > 120) return json(400, { error: "repoId must be owner/name" });
      const { gitPipelineKey, normalizeDeveloperSpaceId, normalizeForgeAppId } = await import("./shared/git-ids.js");
      const { normalizeRepoId } = await import("./git-connections.js");
      const { publicPipelineRow, PIPELINE_SCAFFOLD } = await import("./git-pipeline.js");
      const { pipelineOutdated, pipelineLive, pipelineStuck } = await import("./shared/git-pipeline-state.js");
      const { SCAFFOLD_VERSION, scaffoldVarNames, scaffoldVarError } = await import("./shared/git-scaffolds.js");
      const repoId = normalizeRepoId(repoRaw);
      const key = gitPipelineKey(connId, repoId);
      const op = String(body.op || "read");
      const existing = (await storage.get(key)) ?? null;
      const planted = harnessPlanted(existing);

      if (op === "read") {
        return json(200, {
          ok: true, key, planted,
          row: publicPipelineRow(existing),
          // The SAME three functions the projection and the Code tab ask, on the stored
          // row, so a driver can prove projection and predicate agree rather than assume it.
          predicates: {
            outdated: pipelineOutdated(existing),
            live: pipelineLive(existing),
            stuck: pipelineStuck(existing),
          },
          currentScaffoldVersion: SCAFFOLD_VERSION,
        });
      }
      if (op === "clear") {
        if (existing && !planted) {
          return json(409, { ...notPlantedRefusal("pipeline row"), key });
        }
        await storage.delete(key);
        return json(200, { ok: true, key, row: (await storage.get(key)) ?? null });
      }
      if (op !== "plant") return json(400, { error: `unknown op "${op}" for pipelineRow (plant|read|clear)` });

      // A credential mentioned ANYWHERE in the body refuses the whole plant, before
      // anything is read or written. One home: `findPlantedSecret`.
      const leak = findPlantedSecret(body);
      if (leak) return json(400, { error: SECRET_PLANT_REFUSAL, harnessRefusal: "secret-field", field: leak.field, why: leak.why });

      if (existing && !planted) {
        return json(409, { ...notPlantedRefusal("pipeline row"), error: "harnessRefusal: a real pipeline row already exists for that repository — this door never overwrites one", key });
      }
      const status = body.status === "queued" ? "queued" : "installed";
      if (body.status !== undefined && body.status !== "queued" && body.status !== "installed") {
        return json(400, { error: 'status must be "installed" or "queued"' });
      }
      // CLAMPED to what this build can actually describe: 1..SCAFFOLD_VERSION. A version
      // above the current one would make `scaffoldOutdatedReason` answer null and the row
      // would claim to be NEWER than the app, a state no setup can produce.
      const wantVersion = body.scaffoldVersion === undefined ? 1 : Math.trunc(Number(body.scaffoldVersion));
      if (!Number.isFinite(wantVersion)) return json(400, { error: "scaffoldVersion must be a number" });
      const scaffoldVersion = Math.max(1, Math.min(SCAFFOLD_VERSION, wantVersion));
      const ageMs = Math.max(0, Math.min(7 * 24 * 3600 * 1000, Number(body.ageMs) || 0));
      const stamp = new Date(Date.now() - ageMs).toISOString();

      // Only DECLARED scaffold variables, each through the module that owns "is this
      // variable usable" (F-541). A value the product would refuse is refused here too.
      let scaffoldVars = null;
      if (body.scaffoldVars !== undefined) {
        if (!body.scaffoldVars || typeof body.scaffoldVars !== "object" || Array.isArray(body.scaffoldVars)) {
          return json(400, { error: "scaffoldVars must be an object" });
        }
        const out = {};
        for (const name of scaffoldVarNames(PIPELINE_SCAFFOLD)) {
          const v = body.scaffoldVars[name];
          if (v === undefined || v === null) continue;
          const text = String(v).slice(0, 200);
          const err = scaffoldVarError(name, text);
          if (err) return json(400, { error: err, variable: name });
          out[name] = text;
        }
        scaffoldVars = Object.keys(out).length ? out : null;
      }
      let developerSpaceId = null;
      if (body.developerSpaceId !== undefined && body.developerSpaceId !== null) {
        developerSpaceId = normalizeDeveloperSpaceId(body.developerSpaceId);
        if (!developerSpaceId) return json(400, { error: "invalid developerSpaceId" });
      }
      let appId = null;
      if (body.appId !== undefined && body.appId !== null) {
        appId = normalizeForgeAppId(body.appId);
        if (!appId) return json(400, { error: "invalid appId" });
      }
      let branch = "main";
      if (body.branch !== undefined && body.branch !== null) {
        branch = String(body.branch);
        if (!/^[A-Za-z0-9._/-]{1,120}$/.test(branch)) return json(400, { error: "invalid branch" });
      }

      const row = {
        connId,
        repoId,
        kind: "github",
        scaffold: PIPELINE_SCAFFOLD,
        scaffoldVersion,
        status,
        steps: [],
        failedStep: null,
        // NEVER PLANTABLE. See the docblock: the permission lock is the one fact a
        // planted row must not be able to assert.
        lockHash: null,
        lockScopes: [],
        branch,
        commitSha: null,
        installedAt: status === "installed" ? stamp : null,
        queuedAt: stamp,
        startedAt: null,
        updatedAt: stamp,
        lastRun: null,
        requestedBy: null,
        scaffoldVars,
        developerSpaceId,
        appId,
        plantedBy: "harness",
      };
      await storage.set(key, row);
      return json(200, {
        ok: true, key, op, planted: true,
        row: publicPipelineRow(row),
        predicates: { outdated: pipelineOutdated(row), live: pipelineLive(row), stuck: pipelineStuck(row) },
        currentScaffoldVersion: SCAFFOLD_VERSION,
        effectiveAgeMs: ageMs,
      });
    }
    /*
     * F-616 — THE PURGE-TOMBSTONE DOOR, and why it had to exist.
     *
     * F-575's settle window was driven live by DELETING a Virtual Administrator and
     * RE-CREATING it under the same id through `saveScheduledJob`. That only worked
     * because a save carrying an unknown id CREATED the row at that id — the defect
     * F-616 closes. With the door shut there is no product path to a re-created agent,
     * so the window would have gone unproven; this is its replacement.
     *
     * WHAT IT DOES. Writes, ages, reads or deletes `va_purged:{agent}` — the tombstone
     * `purgeAgent` stamps on delete and `clearPurgeTombstone` weighs on the first prepare
     * tick. The KEY and the TTL come from `src/shared/va-keys.js`, the module that owns
     * them; nothing is retyped here.
     *
     * F-628 — a plant may additionally carry `turns`, the writes that landed while the
     * agent was being deleted. They are written through the PRODUCT's own writer
     * (`recordPurgedTurnWrites`, src/va-ledger.js), one turn per call, never by a second
     * writer in this file — see the block below for why that distinction is the whole
     * value of the door.
     *
     * WHY IT IS NOT A PLANTABLE PERMISSION (the objection the old driver recorded when
     * it refused to add `va_purged:*` to `kvSet`'s allow-list). A tombstone GRANTS
     * nothing: every writer that reads one REFUSES under it. Planting one can only take
     * an agent's voice away, never hand it one. The directions that DO relax something
     * are `clear` (which hands a purged agent its voice back outright) and `op:"age"`/a
     * large `ageMs` (which retires a settle window early) — and F-632 closed both: every
     * write and the delete refuse a row that is not stamped `plantedBy:"harness"`, through
     * the same `harnessPlanted` predicate `pipelineRow` asks. On top of that this door is
     * behind the same HARNESS_SECRET Bearer as everything else in this file (absent in
     * production, checked at the top of the handler), it refuses an agent id that names
     * no job row, and it never touches any other key.
     *
     * THE CLAMP IS THE POINT. `clearPurgeTombstone` only considers a tombstone STAMPED
     * BEFORE the job's `createdAt` (that is what tells a re-created job from a tick of
     * the deleted one). A planted `at` is therefore clamped to `createdAt - 1s`, so a
     * fresh plant lands on the SETTLE-WINDOW arm rather than the `tombstone_newer_than_job`
     * one, and `ageMs` moves it further back to retire the window. The answer reports the
     * job's `createdAt`, the effective age and whether the clamp bit, so a driver grades
     * on measured facts and never on an assumed clock.
     */
    if (body.action === "vaTombstone") {
      const agent = String(body.agent || "");
      if (!/^[A-Za-z0-9_.-]{3,80}$/.test(agent)) return json(400, { error: "agent must be a job id (3-80 chars of A-Za-z0-9_.-)" });
      const { vaPurgedKey, VA_PURGED_TTL } = await import("./shared/va-keys.js");
      const key = vaPurgedKey(agent);
      const op = String(body.op || "read");
      if (op === "read") return json(200, { ok: true, key, row: (await storage.get(key)) ?? null });
      if (op === "clear") {
        // F-632 — the same predicate `pipelineRow clear` asks, from the same home. A
        // tombstone this door did not plant is a REAL purge record: deleting it retires a
        // live settle window and erases the landed writes the F-608 purges panel reports,
        // so it is refused and left exactly as it stands.
        const standing = (await storage.get(key)) ?? null;
        if (standing && !harnessPlanted(standing)) return json(409, { ...notPlantedRefusal("tombstone"), key, row: standing });
        await storage.delete(key);
        return json(200, { ok: true, key, row: (await storage.get(key)) ?? null });
      }
      if (op === "plant" || op === "age") {
        // F-628 — a write body may never name a credential. One home, shared with the
        // F-627 pipeline door, and asked BEFORE anything is read or written.
        const leak = findPlantedSecret(body);
        if (leak) return json(400, { error: SECRET_PLANT_REFUSAL, harnessRefusal: "secret-field", field: leak.field, why: leak.why });
        const { getJob } = await import("./scheduled-jobs.js");
        const job = await getJob(agent);
        // A tombstone for an id that is not a live row would be unreachable litter, and
        // the clamp below has nothing to clamp against.
        if (!job) return json(404, { error: "no scheduled job / agent with that id" });
        const existing = (await storage.get(key)) ?? null;
        if (op === "age" && !existing) return json(409, { error: "no tombstone to age — plant one first" });
        // F-632 — both write ops REWRITE the row they find, and moving a real tombstone's
        // `at` back is the soft form of deleting it (it retires the settle window early).
        // So a plant or an age over a row this door did not plant is refused, exactly as
        // `pipelineRow plant` refuses a real pipeline record.
        if (existing && !harnessPlanted(existing)) return json(409, { ...notPlantedRefusal("tombstone"), key, op, row: existing });
        const ageMs = Math.max(0, Math.min(7 * 24 * 3600 * 1000, Number(body.ageMs) || 0));
        const createdMs = Date.parse((job.createdAt == null ? "" : job.createdAt));
        const wanted = Date.now() - ageMs;
        const at = Number.isFinite(createdMs) ? Math.min(wanted, createdMs - 1000) : wanted;
        const row = {
          at: new Date(at).toISOString(),
          agent,
          plantedBy: "harness",
          // F-628 — `age` rewrites the row, so without this an age would silently ERASE
          // the turns a plant had recorded. The carrier survives its own timestamp move.
          ...(existing && Array.isArray(existing.turns) && existing.turns.length ? { turns: existing.turns } : {}),
        };
        await storage.set(key, row, VA_PURGED_TTL);

        /* ── F-628 — THE TURNS THAT LANDED WHILE THE AGENT WAS BEING DELETED ────────
         * F-608's "recently deleted agents that wrote during deletion" panel returns a
         * row ONLY when `turns[].landedWrites` is non-empty, and the sole producer of
         * that field is `recordPurgedTurnWrites` running inside a turn that is writing
         * to Jira at the moment the agent is deleted — a race no driver can schedule. So
         * the panel could only ever be proven EMPTY live, and an empty list is not
         * evidence that a populated one would render.
         *
         * THE WRITE GOES THROUGH THE PRODUCT'S OWN WRITER, ONE TURN PER CALL. That is
         * the whole point: a second writer here would produce a row that merely RESEMBLES
         * what a real race produces, and the panel would then be proven against the
         * harness's idea of the shape rather than the engine's. `recordPurgedTurnWrites`
         * applies its own caps, refuses when no tombstone stands, and is the thing whose
         * output `listRecentPurges` projects.
         *
         * CLAMPED HERE FIRST, well inside the product's own bounds: at most five turns of
         * at most five writes each, every string 64 characters. A tombstone GRANTS
         * nothing — every ledger writer refuses under one — so its CONTENT grants nothing
         * either, which is why the objection that keeps `va_purged:*` out of `kvSet` does
         * not reach this. `at` is clamped to the last seven days and never to the future. */
        let noted = null;
        if (body.turns !== undefined) {
          if (!Array.isArray(body.turns)) return json(400, { error: "turns must be an array" });
          const { recordPurgedTurnWrites } = await import("./va-ledger.js");
          const results = [];
          for (const t of body.turns.slice(0, 5)) {
            if (!t || typeof t !== "object") return json(400, { error: "each turn must be an object" });
            const writes = (Array.isArray(t.writes) ? t.writes : [])
              .slice(0, 5)
              .map((w) => String(w == null ? "" : w).slice(0, 64))
              .filter(Boolean);
            if (!writes.length) return json(400, { error: "each turn needs at least one write string" });
            let issueKey = null;
            if (t.issueKey !== undefined && t.issueKey !== null && String(t.issueKey) !== "") {
              issueKey = String(t.issueKey);
              if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(issueKey)) return json(400, { error: `turn issueKey must be an issue key (got ${issueKey.slice(0, 40)})` });
            }
            const wantedAt = Date.parse(t.at == null ? "" : String(t.at));
            const now = Number.isFinite(wantedAt)
              ? Math.max(Date.now() - 7 * 24 * 3600 * 1000, Math.min(Date.now(), wantedAt))
              : Date.now();
            results.push(await recordPurgedTurnWrites(storage, agent, { issueKey, landedWrites: writes, now }));
          }
          noted = results;
        }

        return json(200, {
          ok: true, key, row: (await storage.get(key)) ?? row, op,
          jobCreatedAt: job.createdAt || null,
          effectiveAgeMs: Date.now() - at,
          clampedToCreatedAt: Number.isFinite(createdMs) && wanted > createdMs - 1000,
          // What the PRODUCT's writer said about each turn — `{ok:true, turns, writes}`
          // or its own refusal reason. A driver grades on the writer's answer, not on ours.
          ...(noted ? { noted } : {}),
        });
      }
      return json(400, { error: `unknown op "${op}" for vaTombstone (plant|age|read|clear)` });
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
