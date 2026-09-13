/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * RULES REST API — a Forge web trigger that lets CI pipelines, migration scripts
 * and the test harness push Listeners and Scheduled Jobs (and drive them) without
 * the admin UI. Workflow rules already have a REST path (Jira's own
 * /rest/api/3/workflows/update attaches them); listeners and jobs are app-owned,
 * so this is theirs.
 *
 * AUTH: bearer API tokens minted by an app ADMIN in Settings → API access. Only a
 * SHA-256 hash is stored (`api_tokens`); the plaintext is shown once. Every
 * request must carry `Authorization: Bearer cgr_…` (or `X-Api-Key`). No token →
 * 401 with no detail. Rows created by an ADMIN token carry createdBy "api:<tokenId>";
 * an EDITOR token acts as the ACCOUNT THAT MINTED IT and its rows carry that account,
 * because an editor token is gated on OWNERSHIP by the resolvers' own gate (F-471).
 *
 * ROUTING (Forge web-trigger URLs are fixed, so the resource travels in the
 * query string):
 *   GET    ?resource=events                         event catalogue (each row carries
 *                                                   `source` "jira"|"git" and `repos`)
 *   GET    ?resource=actions                        AI-agent action catalogue
 *   GET    ?resource=listeners[&id=]                list (slim) / one (full)
 *   POST   ?resource=listeners                      create or upsert (object or array)
 *   PUT    ?resource=listeners&id=                  merge-update
 *   DELETE ?resource=listeners&id=
 *   POST   ?resource=listeners&id=&action=enable|disable|test   (test body: {issueKey, eventType, event?})
 *   GET    ?resource=jobs[&id=]        POST/PUT/DELETE as above
 *   POST   ?resource=jobs&id=&action=enable|disable|run|preview
 *   GET    ?resource=tasks&id=<taskId>               poll a queued run (run/test results)
 *   GET    ?resource=logs[&ruleId=]                  execution logs (newest first)
 *   GET    ?resource=samples&eventType=              last captured payload for an event
 *   GET    ?resource=whoami                          token identity
 *   GET    ?resource=agents[&id=]                    Virtual Administrators: list / one
 *                                                    (status, caps, health, receipts)
 *   POST   ?resource=agents                          create a VA record   (admin)
 *   PUT    ?resource=agents&id=                      merge-update a VA    (admin)
 *   DELETE ?resource=agents&id=                      delete a VA          (admin)
 *   GET    ?resource=agents&id=&part=drafts|effects|memory      (admin)
 *   PUT    ?resource=agents&id=&part=memory                     (admin)
 *   POST   ?resource=agents&id=&action=pause|resume|tick|post   (admin)
 *   POST   ?resource=agents&id=&action=approve|reject           (admin; {itemKey, stagedAt})
 *
 * ROLES: a token carries an optional `role` (viewer|editor|admin), chosen at mint
 * time in the admin UI. ONE predicate decides every floor on this surface
 * (`tokenRoleAtLeast`), and the floors are the RESOLVERS' floors:
 *   whoami / events / actions          — any token
 *   GET listeners|jobs|logs|tasks      — viewer
 *   GET samples                        — editor (a real captured event body)
 *   POST|PUT|DELETE listeners|jobs,
 *     enable|disable|test|run          — editor      (preview: viewer)
 *   agents: overview editor; drafts / memory / effects / every write admin
 * A token minted without a role is ADMIN — that is what every token on this surface already was, and
 * narrowing existing tokens on upgrade would break callers silently. The floors on
 * ?resource=agents are the SAME floors the Agents tab's resolvers use, because a
 * REST caller must not be able to do anything the tab cannot: editor for the
 * overview (it carries no draft body, no instructions, no code), admin for every
 * read of what the agent is about to SAY and for every write.
 */
import { kvs as storage } from "@forge/kvs";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { JIRA_EVENTS, EVENT_CATEGORIES } from "./shared/jira-events.js";
import { AGENT_ACTIONS } from "./shared/agent-actions.js";
import * as L from "./listeners.js";
import * as J from "./scheduled-jobs.js";
// The ONE home for every Virtual Administrator operation (1.5 commit 5b). The Agents
// tab's resolvers are the other skin over this exact module.
import * as VA from "./va-admin.js";

const idx = () => import("./index.js");

export const API_TOKENS_KEY = "api_tokens";
// One tombstone key per revoked token id. `api_tokens` is a single array written by
// three read-modify-write sites (mint, revoke, lastUsedAt touch), so a request that
// snapshotted the array before a revoke could write the live hash back and RESURRECT
// the token. A tombstone is a key of its own: no stale array write can clear it, and
// authenticate() consults it after a hash match, so a revoke is final.
export const REVOKED_TOKEN_PREFIX = "api_token_revoked:";
export const RULES_API_WEBTRIGGER_KEY = "rules-api";
export const RULES_API_URL_KVS_KEY = "webtrigger_url:rules-api";
const MAX_TOKENS = 25;
const MAX_BODY_BYTES = 512 * 1024;
const nowIso = () => new Date().toISOString();

// ── Tokens ───────────────────────────────────────────────────────────────────

const sha256 = (s) => createHash("sha256").update(String(s)).digest("hex");
const readTokens = async () => { const v = (await storage.get(API_TOKENS_KEY)) || []; return Array.isArray(v) ? v : []; };
const publicRow = (t) => ({ id: t.id, name: t.name, prefix: t.prefix, createdAt: t.createdAt, createdBy: t.createdBy, role: tokenRole(t), lastUsedAt: t.lastUsedAt || null, revokedAt: t.revokedAt || null });
/*
 * THE TOKEN'S ROLE. Only `?resource=agents` gates on it today (the Agents-tab floors,
 * mirrored), and a row minted before this field existed reads as ADMIN — which is
 * exactly what such a token could already do here (create jobs, delete them, run
 * them). Defaulting a missing role to anything narrower would revoke capability from
 * live integrations on upgrade, silently, which is the worse failure of the two.
 */
export const TOKEN_ROLES = ["viewer", "editor", "admin"];
const ROLE_RANK = Object.freeze({ viewer: 1, editor: 2, admin: 3 });
const tokenRole = (t) => (t && TOKEN_ROLES.includes(String(t.role)) ? String(t.role) : "admin");
/*
 * THE ONE ROLE FLOOR ON THIS SURFACE (F-466). Every resource asks this predicate and
 * nothing else - `?resource=agents` used to be the only gated one, so a viewer token
 * could write a listener that the Listeners tab would have refused a viewer's click.
 * The floors are the RESOLVERS' floors, read off `src/index.js`, because a REST caller
 * must never hold a power the product's own UI does not grant.
 */
export const tokenRoleAtLeast = (who, floor) => ROLE_RANK[tokenRole(who)] >= ROLE_RANK[floor];
const tombstoneKey = (id) => REVOKED_TOKEN_PREFIX + String(id).replace(/[^a-zA-Z0-9:._#-]/g, "-").slice(0, 120);
const isRevoked = async (id) => Boolean(await storage.get(tombstoneKey(id)));

export const listApiTokens = async () => {
  const rows = await readTokens();
  // Report a resurrected row as revoked: the tombstone, not the array, is the truth.
  const out = [];
  for (const t of rows) {
    const row = publicRow(t);
    if (!row.revokedAt) {
      try { const stone = await storage.get(tombstoneKey(t.id)); if (stone) row.revokedAt = stone.revokedAt || nowIso(); } catch { /* best-effort */ }
    }
    out.push(row);
  }
  return out;
};

/*
 * A role asked for at MINT time is either in the closed set or it is REFUSED - never
 * coerced. Silently minting an ADMIN token for a caller who typed "viwer" is the one
 * failure this field exists to prevent. Omitted (undefined/null/"") stays null, which
 * READS as admin: the documented compatibility default, and what every row minted
 * before this field existed already is.
 */
const normalizeMintRole = (role) => {
  if (role === undefined || role === null || role === "") return null;
  const r = String(role).trim().toLowerCase();
  if (!TOKEN_ROLES.includes(r)) throw new Error(`Unknown token role "${String(role).slice(0, 40)}". Use one of: ${TOKEN_ROLES.join(", ")}.`);
  return r;
};

/** Mint a token; returns { token (plaintext, once), row }. */
export const createApiTokenInternal = async ({ name, accountId, role }) => {
  const token = `cgr_${randomBytes(24).toString("hex")}`;
  const row = { id: `tok_${Date.now().toString(36)}${randomBytes(3).toString("hex")}`, name: String(name || "API token").slice(0, 80), hash: sha256(token), prefix: token.slice(0, 10), createdAt: nowIso(), createdBy: accountId || null, role: normalizeMintRole(role), lastUsedAt: null, revokedAt: null };
  // Read IMMEDIATELY before the write (nothing awaited in between but the write
  // itself): a token minted or revoked while this request was hashing must not be
  // dropped by a stale snapshot. Two mints that overlap this narrow window can still
  // lose one row — KVS has no compare-and-set on a value — but a REVOKE can never be
  // lost, because its tombstone lives outside this array.
  const cutoff = Date.now() - 30 * 86400000;
  const all = await readTokens();
  const expired = all.filter((t) => t.revokedAt && Date.parse(t.revokedAt) <= cutoff);
  const rows = all.filter((t) => !expired.includes(t)); // prune revoked rows older than 30 days
  if (rows.filter((t) => !t.revokedAt).length >= MAX_TOKENS) throw new Error(`Token limit reached (${MAX_TOKENS}). Revoke unused tokens first.`);
  rows.push(row);
  await storage.set(API_TOKENS_KEY, rows);
  // The pruned rows carry no hash any more, so their tombstones can go too (bounded store).
  for (const t of expired) { try { await storage.delete(tombstoneKey(t.id)); } catch { /* best-effort */ } }
  return { token, row: publicRow(row) };
};

export const revokeApiTokenInternal = async (id) => {
  const rows = await readTokens();
  const t = rows.find((r) => r.id === id);
  if (!t) return { revoked: false };
  const revokedAt = nowIso();
  // TOMBSTONE FIRST — from this instant the token is dead even if the array write
  // below fails, and even if an in-flight request writes its stale snapshot after us.
  await storage.set(tombstoneKey(id), { id, revokedAt });
  const fresh = await readTokens();
  const row = fresh.find((r) => r.id === id);
  if (row) { row.revokedAt = revokedAt; row.hash = "revoked"; await storage.set(API_TOKENS_KEY, fresh); }
  return { revoked: true };
};

const headerOf = (req, name) => {
  const h = (req && req.headers) || {};
  const v = h[name] ?? h[name.toLowerCase()] ?? h[name[0].toUpperCase() + name.slice(1)];
  return Array.isArray(v) ? v[0] : v;
};

const authenticate = async (req) => {
  const auth = headerOf(req, "authorization");
  let token = typeof auth === "string" ? auth.replace(/^Bearer\s+/i, "").trim() : "";
  if (!token) { const k = headerOf(req, "x-api-key"); if (typeof k === "string") token = k.trim(); }
  if (!token || !/^cgr_[0-9a-f]{48}$/.test(token)) return null;
  const want = Buffer.from(sha256(token), "hex");
  const rows = await readTokens();
  let hit = null;
  for (const r of rows) {
    if (r.revokedAt || typeof r.hash !== "string" || r.hash.length !== 64) continue;
    const have = Buffer.from(r.hash, "hex");
    if (have.length === want.length && timingSafeEqual(have, want)) hit = r;
  }
  if (!hit) return null;
  // The array row may be a resurrected corpse; the tombstone is authoritative. A KVS
  // failure here throws and the caller answers 401 — this check fails CLOSED.
  if (await isRevoked(hit.id)) return null;
  // Touch lastUsedAt at most once per hour (cheap, no write storm) — but NEVER by
  // writing back this snapshot: re-read and merge ONLY lastUsedAt into the matching
  // row, so a revoke or a mint that landed since the read above survives untouched.
  if (!hit.lastUsedAt || Date.now() - Date.parse(hit.lastUsedAt) > 3600000) {
    let fresh; let row;
    try { fresh = await readTokens(); row = fresh.find((r) => r.id === hit.id); }
    catch { return hit; } // read failed: skip the touch, the request itself is authentic
    if (!row || row.revokedAt || row.hash !== hit.hash) return null; // revoked/rotated meanwhile
    row.lastUsedAt = nowIso();
    try { await storage.set(API_TOKENS_KEY, fresh); } catch { /* best-effort */ }
    return { ...row };
  }
  return hit;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const json = (statusCode, body) => ({ statusCode, headers: { "Content-Type": ["application/json"], "Cache-Control": ["no-store"] }, body: JSON.stringify(body) });
const q = (req, n) => { const v = req && req.queryParameters && req.queryParameters[n]; return Array.isArray(v) ? v[0] : v; };
const parseBody = (req) => {
  const raw = (req && req.body) || "";
  if (!raw) return {};
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) throw new Error(`body exceeds ${MAX_BODY_BYTES} bytes`);
  try { return JSON.parse(raw); } catch { throw new Error("body is not valid JSON"); }
};
const merge = (existing, patch) => {
  const out = { ...existing, ...patch };
  for (const k of ["filters", "agent", "schedule", "scope"]) {
    if (patch[k] && typeof patch[k] === "object" && existing[k] && typeof existing[k] === "object") out[k] = { ...existing[k], ...patch[k] };
  }
  delete out.stats; delete out.createdAt; delete out.createdBy; delete out.lastCheckedAt;
  return out;
};

// ONE validation-error body, for EVERY resource on this surface. A refusal that
// carries a machine-readable reason (agent.allowedActions, `reason:"action-not-allowed"`
// + `refused[]`; a brake; a byte cap) keeps it; everything else stays the bare
// `{ error }` the admin UI already renders.
// F-331 — the REST refusal is the SAME shape the resolvers return, or the admin UI
// and an API client disagree about why a save was refused. `needsRole` names the role
// the caller would need and `hint` names the remedy the UI renders ("ask-app-admin",
// "not-owner"); dropping them left a REST client with prose it had to parse.
// It sits at MODULE level (1.5 commit 8) because `?resource=agents` refuses through it
// too, and a second copy is a second answer to "why was this refused".
const errBody = (e) => ({
  error: e && e.message ? String(e.message).slice(0, 500) : "invalid",
  ...(e && e.reason ? { reason: e.reason } : {}),
  ...(e && e.needsRole ? { needsRole: e.needsRole } : {}),
  ...(e && e.hint ? { hint: e.hint } : {}),
  ...(e && Array.isArray(e.refused) ? { refused: e.refused } : {}),
});

/*
 * The ONE refusal a role floor produces, in the ONE refusal shape (`reason`,
 * `needsRole`, `hint`) the resolvers and the admin UI already speak. Returns null when
 * the token clears the floor, so every call site reads
 * `const r = floor(...); if (r) return r;`.
 */
const roleFloor = (who, level, what) => (tokenRoleAtLeast(who, level)
  ? null
  : json(403, { error: `This token may not ${what}.`, reason: "no-permission", needsRole: level, hint: "ask-app-admin" }));

/*
 * F-471 — OWNERSHIP, through the RESOLVERS' gate and nothing else.
 *
 * The role floors above mirror the resolvers' ROLE floors; they had no analogue for
 * the resolvers' other arm. `gateExistingRow`'s `minRole:"editor"` is only half the
 * question a click answers — the other half is scope "own", which refuses an editor
 * the rows they did not write. Without it an EDITOR token could edit, disable and
 * delete ANY listener or job on the instance, including an admin-armed one, while the
 * same person's click on the Listeners tab is refused.
 *
 * A TOKEN ACTS AS THE ACCOUNT THAT MINTED IT. `createdBy` is on the row already, so
 * the token resolves to a principal and the ownership question is asked EXACTLY once,
 * in `src/index.js` (`gateExistingRow` → `rowGateVerdict`). There is deliberately no
 * ownership rule in this file: a second one is how two doors to the same row grow two
 * answers, and the F-261 existence-leak rule (an unknown id and a foreign row are the
 * same refusal for a scope-"own" caller) would have to be re-derived here to match.
 *
 * ADMIN TOKENS KEEP SCOPE "ALL" and skip this gate — that is what an admin's verdict
 * is in `rowGateVerdict` anyway, and it is what every token on this surface already
 * was (a row with no `role` reads as admin). So no live integration loses a power on
 * upgrade: only an EDITOR token, a role that could not be minted before F-466,
 * narrows. An editor token with no `createdBy` has no principal to act as and is
 * REFUSED in the one refusal shape — failing open there would hand back exactly the
 * capability this gate exists to remove.
 */
const ownerGate = async (who, row, { what, minRole = "editor", destructive = false, notFound }) => {
  if (tokenRole(who) === "admin") return null; // scope "all" — the pre-F-466 behaviour
  const accountId = who && who.createdBy;
  if (!accountId) {
    return json(403, {
      error: `This token has no owning account and may not ${what}. Mint a new token.`,
      reason: "no-permission", needsRole: "admin", hint: "ask-app-admin",
    });
  }
  const { gateExistingRow } = await idx();
  const refusal = await gateExistingRow(accountId, row, { what, minRole, destructive, notFound });
  if (!refusal) return null;
  // The resolver's refusal object, unchanged, as an HTTP answer: `reason:"no-permission"`
  // is a 403 (role floor or ownership, with `needsRole`/`hint` intact); anything else is
  // the "not found" arm, which `rowGateVerdict` only produces for a scope-"all" caller.
  return json(refusal.reason === "no-permission" ? 403 : 404, errBody({
    message: refusal.error, reason: refusal.reason, needsRole: refusal.needsRole, hint: refusal.hint,
  }));
};

const eventCatalog = () => ({
  categories: EVENT_CATEGORIES,
  // `source` tells a client WHERE the event comes from ("jira" = a Forge product
  // event; "git" = the app's own webhook), and `repos:true` says the listener MUST
  // carry a filters.repos allow-list — a create/update without one is 400.
  events: JIRA_EVENTS.map((e) => ({ id: e.id, source: e.source, category: e.category, label: e.label, description: e.description, filters: e.filters, volume: e.volume, issueBound: e.issueBound, issueIdOnly: e.issueIdOnly, projectScoped: e.projectScoped, repos: e.repos === true, payloadHint: e.payloadHint })),
});

// ── Resource handlers ────────────────────────────────────────────────────────

const handleCollection = async ({ req, method, id, action, body, who, kind }) => {
  const isL = kind === "listeners";
  const mod = isL ? L : J;
  const list = isL ? L.listListeners : J.listJobs;
  const get = isL ? L.getListener : J.getJob;
  const save = isL ? L.saveListener : J.saveJob;
  const remove = isL ? L.deleteListener : J.deleteJob;
  const setEnabled = isL ? L.setListenerEnabled : J.setJobEnabled;
  const noun = isL ? "listener" : "job";
  /*
   * WHO A NEW ROW BELONGS TO (F-471). An ADMIN token keeps recording `api:<tokenId>`:
   * it is the audit string every row minted over this surface already carries, its
   * scope is "all", and ownership never gates it. An EDITOR token records the ACCOUNT
   * THAT MINTED IT, because ownership DOES gate it — a row stamped with a token id
   * could never match `perms.accountId`, so an editor token would be unable to edit
   * back the rule it had just written. Same principal either way: `ownerGate` asks the
   * ownership question about `who.createdBy`, so the stamp and the gate agree.
   */
  const actor = tokenRole(who) === "admin" ? `api:${who.id}` : (who.createdBy || `api:${who.id}`);
  /*
   * THE FLOORS, mirrored one-for-one off the resolvers in `src/index.js` (F-466):
   * getListeners/getScheduledJobs and their by-id reads gate on `viewer`; every write
   * — save, delete, enable/disable, test, run — gates on `editor`. The resolvers reach
   * that floor through `gateExistingRow`, whose OWNERSHIP arm is asked here too
   * (`ownerGate`, F-471) for every write on an EXISTING row.
   * Before F-466, EVERY token was admin-in-effect here regardless of its role.
   */
  const floor = (level, what) => roleFloor(who, level, what);
  // A REST token carries no role, so every save through this surface is recorded as
  // `savedByRole:"editor"` (the normalizer's default). That is deliberate and it is a
  // REFUSAL, not an oversight: a rule armed over the API can never hold an
  // admin-only power such as a PR verdict action. Arming one is an admin's click.

  if (method === "GET") {
    const gate = floor("viewer", `view ${kind}`); if (gate) return gate;
    if (id) { const row = await get(id); return row ? json(200, { [noun]: row }) : json(404, { error: `${noun} not found` }); }
    return json(200, { [kind]: await list() });
  }
  if (method === "DELETE") {
    const gate = floor("editor", `delete a ${noun}`); if (gate) return gate;
    if (!id) return json(400, { error: "id required" });
    // `destructive` selects the narrower ownership rule the delete resolver uses: an
    // OWNERLESS row is not yours. The row is read before the gate so an unknown id and
    // a foreign one give a scope-"own" caller the same answer (F-261).
    const owned = await ownerGate(who, await get(id), { what: `delete this ${noun}`, destructive: true, notFound: `${noun} not found` });
    if (owned) return owned;
    const r = await remove(id);
    return json(r.removed ? 200 : 404, r.removed ? { deleted: id } : { error: `${noun} not found` });
  }
  if (method === "PUT") {
    const gate = floor("editor", `change a ${noun}`); if (gate) return gate;
    if (!id) return json(400, { error: "id required" });
    const existing = await get(id);
    const owned = await ownerGate(who, existing, { what: `edit this ${noun}`, notFound: `${noun} not found` });
    if (owned) return owned;
    if (!existing) return json(404, { error: `${noun} not found` });
    try { const saved = await save({ ...merge(existing, body || {}), id }, { accountId: actor }); return json(200, { [noun]: saved }); } catch (e) { return json(400, errBody(e)); }
  }
  if (method === "POST" && action) {
    // `preview` computes nothing but the next fire times of a cron string — the
    // previewSchedule resolver's floor is `viewer`, and this one matches it.
    const gate = floor(action === "preview" ? "viewer" : "editor", `${action} a ${noun}`); if (gate) return gate;
    if (!id) return json(400, { error: "id required" });
    const row = await get(id);
    // `preview` only computes the next fire times of a cron string — it is a VIEWER
    // route and asks no ownership question, exactly as the previewSchedule resolver
    // does not. Every other action here is a write on someone's row.
    if (action !== "preview") {
      const owned = await ownerGate(who, row, { what: `${action} this ${noun}`, notFound: `${noun} not found` });
      if (owned) return owned;
    }
    if (!row) return json(404, { error: `${noun} not found` });
    if (action === "enable" || action === "disable") { const saved = await setEnabled(id, action === "enable"); return json(200, { [noun]: saved }); }
    if (isL && action === "test") {
      try {
        const r = await L.testListener({ listener: row, issueKey: body && body.issueKey, eventType: body && body.eventType, syntheticEvent: body && body.event, deadline: Date.now() + 20000 });
        return json(200, { result: r });
      // F-337 — the LAST refusal site on this surface that bypassed errBody. A
      // testListener throw can carry raw Jira body text (`JQL check failed: 400 …`);
      // it is clamped and shaped exactly like every other refusal here.
      } catch (e) { return json(400, errBody(e)); }
    }
    if (!isL && action === "run") {
      const r = await J.enqueueJobRun({ job: row, manual: true, accountId: actor });
      return json(202, { queued: true, taskId: r.taskId, poll: `?resource=tasks&id=${encodeURIComponent(r.taskId)}` });
    }
    if (!isL && action === "preview") return json(200, J.previewSchedule({ cron: (body && body.cron) || row.schedule.cron, timeZone: (body && body.timeZone) || row.schedule.timeZone, count: (body && body.count) || 5 }));
    return json(400, { error: `unknown action "${action}" for ${kind}` });
  }
  if (method === "POST") {
    const gate = floor("editor", `create ${kind}`); if (gate) return gate;
    const items = Array.isArray(body) ? body : (body && Array.isArray(body[kind]) ? body[kind] : [body]);
    if (!items.length || items.length > 100) return json(400, { error: "provide 1-100 items" });
    const saved = []; const errors = [];
    for (let i = 0; i < items.length; i++) {
      try { saved.push(await save(items[i], { accountId: actor })); } catch (e) { errors.push({ index: i, name: items[i] && items[i].name, ...errBody(e) }); }
    }
    const status = saved.length ? (errors.length ? 207 : (items.length === 1 ? 201 : 200)) : 400;
    // Single-item ergonomics: `{ listener }` on success, `{ error }` on failure (the UI's shape).
    if (items.length === 1) return json(status, saved.length === 1 ? { [noun]: saved[0] } : (errors[0] ? { error: errors[0].error, ...(errors[0].reason ? { reason: errors[0].reason } : {}), ...(errors[0].refused ? { refused: errors[0].refused } : {}) } : { error: "invalid" }));
    return json(status, { [kind]: saved, errors });
  }
  return json(405, { error: `method ${method} not allowed` });
};

/* ── ?resource=agents — the Virtual Administrator, over REST ───────────────────
 *
 * THE SECOND SKIN OVER `src/va-admin.js`, and nothing else. The Agents tab's
 * resolvers are the first. Every route below is one call into that module plus a
 * role floor and an HTTP status; no route reads the ledger, shapes an answer or
 * decides what a draft means, because a second implementation of "approve a draft"
 * is how one rule grows two behaviours that disagree.
 *
 * A VA IS A JOB. This resource is a VIEW over `?resource=jobs` filtered to
 * `mode:"va"` — not a second store. Delete goes through the job delete, the save
 * goes through `saveJob`, and an id that names a non-VA job is a 404 here.
 *
 * NO NEW CAPABILITY. The floors are the resolvers' floors (`src/index.js`, the VA
 * group): editor for the overview, admin for a staged draft, the memory, the
 * effects and every write. A REST caller that could read a staged customer reply at
 * the editor floor would be a power the product does not grant in its own UI.
 *
 * THE WIZARD IS NOT HERE, deliberately. `wizardStep`/`wizardReset` are an interview
 * with server-held state keyed by an ACCOUNT; a token is not an account, and a
 * half-finished interview reachable by two doors has no owner. The record the wizard
 * produces is exactly what `POST ?resource=agents` takes, so nothing is unreachable.
 *
 * NEITHER `approve` NOR `reject` POSTS. They record a human verdict on the ledger
 * row; the post phase is the only thing that delivers a draft, behind eleven gates.
 * `tick` and `post` are a shortcut through the CLOCK and not through a gate: they
 * take the same bucketed claim the planner takes, so a REST press cannot double-run
 * an agent the scheduler is already running.
 */
const VA_STATUS_BY_REASON = Object.freeze({
  job_id_required: 400, item_key_required: 400, va_invalid: 400,
  not_found: 404, not_a_virtual_administrator: 404, no_such_item: 404,
  // A CONFLICT, not a bad request: the caller asked for something legal that the
  // agent's current state refuses. A client retries these after re-reading; it must
  // not "fix" its body.
  not_in_shadow: 409, no_staged_draft: 409, draft_changed: 409,
  agent_disabled: 409, agent_paused: 409, already_running: 409,
  // A FAULT, and it is reported as one. "I could not read the drafts" and "there are
  // no drafts" must never reach a client as the same answer.
  job_read_failed: 502, job_index_read_failed: 502, job_write_failed: 502,
  index_read_failed: 502, item_read_failed: 502, scan_failed: 502,
  scan_unavailable: 502, memory_read_failed: 502, memory_write_failed: 502,
  claim_failed: 502, enqueue_failed: 502,
});

/** `{ok, ...}` from va-admin → an HTTP answer, in the ONE refusal shape. */
const vaJson = (r, okStatus = 200) => {
  if (r && r.ok === true) { const { ok, ...rest } = r; return json(okStatus, rest); }
  const { ok, reason, message, ...rest } = (r && typeof r === "object") ? r : {};
  return json(VA_STATUS_BY_REASON[reason] || 400, {
    error: VA.refusalSentence(r) || "invalid",
    reason: reason || null,
    ...rest,
  });
};

const handleAgents = async ({ method, id, action, part, body, who, req }) => {
  const actor = `api:${who.id}`;
  const floor = (level, what) => roleFloor(who, level, what);

  /* A REST save is recorded as `savedByRole:"editor"` exactly as a listener or job
   * save is, and for the same reason: an admin-only power (a PR verdict action) is
   * an admin's CLICK, never a token's. The role on the token gates the DOOR; it does
   * not grant the row a power. */
  const savedByRole = "editor";

  const loadVaJob = async () => {
    const row = await J.getJob(id);
    return row && row.mode === "va" ? row : null;
  };

  if (method === "GET" && !id) {
    const r = floor("editor", "list Virtual Administrators"); if (r) return r;
    return vaJson(await VA.listAgents({}));
  }
  if (!id) {
    if (method !== "POST" || action || part) return json(400, { error: "id required" });
  }

  if (part) {
    const r = floor("admin", `read a Virtual Administrator's ${part}`); if (r) return r;
    if (part === "drafts") { if (method !== "GET") return json(405, { error: `method ${method} not allowed` }); return vaJson(await VA.drafts({ jobId: id })); }
    if (part === "effects") { if (method !== "GET") return json(405, { error: `method ${method} not allowed` }); return vaJson(await VA.effects({ jobId: id, limit: q(req, "limit") })); }
    if (part === "memory") {
      if (method === "GET") return vaJson(await VA.memory({ jobId: id }));
      // PUT only. The clamp and the defang are `writeMemory`'s, at write time (F-423),
      // and `clamped:true` comes back rather than being swallowed: an admin whose note
      // was cut at the byte cap would otherwise believe the agent knows something it
      // does not. A second clamp here would be a second authority on the cap.
      if (method === "PUT") return vaJson(await VA.saveMemory({ jobId: id, memory: body && body.memory, constraints: body && body.constraints }));
      return json(405, { error: `method ${method} not allowed` });
    }
    return json(400, { error: `unknown part "${part}" for agents`, parts: ["drafts", "effects", "memory"] });
  }

  if (method === "GET") {
    const r = floor("editor", "view Virtual Administrators"); if (r) return r;
    return vaJson(await VA.status({ jobId: id }));
  }

  if (method === "DELETE") {
    const r = floor("admin", "delete a Virtual Administrator"); if (r) return r;
    if (!(await loadVaJob())) return json(404, { error: "agent not found" });
    const out = await J.deleteJob(id);          // the job delete; a VA has no second store
    return json(out.removed ? 200 : 404, out.removed ? { deleted: id } : { error: "agent not found" });
  }

  if (method === "POST" && action) {
    const r = floor("admin", `${action} a Virtual Administrator`); if (r) return r;
    if (action === "pause") return vaJson(await VA.pause({ jobId: id, accountId: actor, reason: body && body.reason }));
    if (action === "resume") return vaJson(await VA.resume({ jobId: id, accountId: actor, reason: body && body.reason }));
    if (action === "tick") return vaJson(await VA.runTickNow({ jobId: id, accountId: actor }), 202);
    if (action === "post") return vaJson(await VA.runPostNow({ jobId: id, accountId: actor }), 202);
    if (action === "approve" || action === "reject") {
      const args = { jobId: id, itemKey: body && (body.itemKey != null ? body.itemKey : body.issueKey), stagedAt: body && body.stagedAt, reason: body && body.reason, accountId: actor };
      return vaJson(await (action === "approve" ? VA.approveDraft(args) : VA.rejectDraft(args)));
    }
    return json(400, { error: `unknown action "${action}" for agents`, actions: ["pause", "resume", "tick", "post", "approve", "reject"] });
  }

  if (method === "POST" || method === "PUT") {
    const r = floor("admin", "create or change a Virtual Administrator"); if (r) return r;
    let input;
    let existing = null;
    if (method === "PUT") {
      existing = await loadVaJob();
      if (!existing) return json(404, { error: "agent not found" });
      // The SAME merge the other collections use, so a PUT is a patch here too; `va`
      // is a merged sub-object like `agent`/`schedule`/`scope` already are.
      input = { ...merge(existing, body || {}), id, mode: "va" };
    } else {
      // `?id=` wins over a body id: a POST to a named agent is an UPSERT of that
      // agent, and a body that named a different one would edit a row the caller did
      // not address.
      input = { ...(body && typeof body === "object" ? body : {}), mode: "va", ...(id ? { id } : {}) };
      if (input.id) {
        existing = await J.getJob(input.id);
        if (existing && existing.mode !== "va") return json(409, { error: "that id belongs to a scheduled job that is not a Virtual Administrator" });
      }
    }
    // ONE normalisation, and it is the resolver's: the live catalogue check, the
    // shadow re-arm and the cadence-derived schedule/name all live in
    // `va-admin.prepareVaSave`. A second copy here would be a second answer to what a
    // VA record means, and the copy nobody looks at is the one that drifts.
    const prepared = await VA.prepareVaSave({ input, existing, savedByRole });
    if (!prepared.ok) return vaJson(prepared);
    try {
      const job = await J.saveJob(prepared.input, { accountId: actor, savedByRole });
      return json(method === "PUT" || input.id ? 200 : 201, { agent: job, ...(prepared.refused.length ? { refused: prepared.refused } : {}) });
    // A byte cap, a brake or an action allow-list refusal from `saveJob` arrives in
    // the ONE refusal shape (`errBody`, module-level since commit 8 so this resource
    // and the collections cannot answer a refusal differently) — `reason`,
    // `needsRole`, `hint` and `refused[]` included.
    } catch (e) { return json(400, errBody(e)); }
  }
  return json(405, { error: `method ${method} not allowed` });
};

/** Web-trigger entry point (manifest: webtrigger rules-api → function rules-api-fn). */
export async function rulesApiHandler(req) {
  const method = String((req && req.method) || "GET").toUpperCase();
  let who;
  try { who = await authenticate(req); } catch { who = null; }
  if (!who) return json(401, { error: "unauthorized" });
  const resource = String(q(req, "resource") || "").toLowerCase();
  const id = q(req, "id") ? String(q(req, "id")).slice(0, 80) : null;
  const action = q(req, "action") ? String(q(req, "action")).toLowerCase() : null;
  const part = q(req, "part") ? String(q(req, "part")).toLowerCase().slice(0, 40) : null;
  let body;
  try { body = method === "GET" || method === "DELETE" ? {} : parseBody(req); } catch (e) { return json(400, { error: e.message }); }
  try {
    const m = await idx();
    switch (resource) {
      // whoami is the token describing ITSELF, and events/actions are the static
      // catalogues the frontends import straight from `src/shared/` — no floor, and
      // none in the product either.
      case "whoami": return json(200, { token: publicRow(who), app: "CogniRunner", now: nowIso() });
      case "events": return json(200, eventCatalog());
      case "actions": return json(200, { actions: AGENT_ACTIONS.map((a) => ({ id: a.id, kind: a.kind, label: a.label, description: a.description })) });
      // `return await` — without it the rejection escapes this try and the caller gets
      // a platform error page instead of the `{ "error": … }` contract (and no log).
      case "listeners": return await handleCollection({ req, method, id, action, body, who, kind: "listeners" });
      case "jobs": return await handleCollection({ req, method, id, action, body, who, kind: "jobs" });
      case "agents": return await handleAgents({ req, method, id, action, part, body, who });
      case "samples": {
        // EDITOR, mirroring the getEventSample resolver: a captured payload is a real
        // event body from the instance, not a catalogue entry.
        { const r = roleFloor(who, "editor", "read event samples"); if (r) return r; }
        const s = await L.getEventSample(String(q(req, "eventType") || ""));
        return s ? json(200, s) : json(404, { error: "no sample captured yet for this event" });
      }
      case "logs": {
        // VIEWER, mirroring getLogs. NOTE: the resolver ALSO narrows a scope-"own"
        // caller's rows; a token has no account and therefore no owner scope, which is
        // why a narrower token role is the only lever a reader gets here.
        { const r = roleFloor(who, "viewer", "read execution logs"); if (r) return r; }
        const ruleId = q(req, "ruleId") ? String(q(req, "ruleId")).slice(0, 120) : null;
        return json(200, { logs: await m.readLogs(ruleId) });
      }
      case "tasks": {
        // VIEWER, mirroring getAsyncTaskResult (which is a viewer floor because the
        // read also CONSUMES the row).
        { const r = roleFloor(who, "viewer", "read task results"); if (r) return r; }
        if (!id) return json(400, { error: "id required" });
        const row = await storage.get(`async_task:${id}`);
        const job = await storage.get(`async_job:${id}`);
        if (!row) return json(200, { taskId: id, status: job ? job.status : "pending", job: job || null });
        if (row.status === "done" || row.status === "error") { try { await storage.delete(`async_task:${id}`); } catch { /* ignore */ } }
        return json(200, { taskId: id, status: row.status, result: row.result, error: row.error, job: job || null });
      }
      default: return json(404, { error: "unknown resource", resources: ["events", "actions", "listeners", "jobs", "agents", "tasks", "logs", "samples", "whoami"] });
    }
  } catch (e) {
    console.error("[rules-api] error:", e);
    return json(500, { error: String((e && e.message) || e).slice(0, 300) });
  }
}
