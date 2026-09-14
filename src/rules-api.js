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
 *   GET    ?resource=agents&part=purges                         (admin; no id, site-wide)
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
import { AGENT_ACTIONS, buildAgentGateContext } from "./shared/agent-actions.js";
import * as L from "./listeners.js";
import * as J from "./scheduled-jobs.js";
// The ONE home for every Virtual Administrator operation (1.5 commit 5b). The Agents
// tab's resolvers are the other skin over this exact module.
import * as VA from "./va-admin.js";
// The recursive `va` patch merge lives with the record's shape, not with the door.
import { mergeVaPatch } from "./shared/va-config.js";

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
  // `va` IS DEEPER THAN THE FOUR ABOVE (F-477), so it gets the recursive merge that
  // lives with the record's shape (`mergeVaPatch`, src/shared/va-config.js). A shallow
  // spread here would carry `status` and `guardrails` forward but still rebuild
  // `persona.voice` from the defaults on a rename. Without any merge at all the block
  // was REPLACED, and `normalizeVa` then resumed a paused agent and re-widened every
  // guardrail — from a request that only changed a name.
  if (patch.va && typeof patch.va === "object" && existing.va && typeof existing.va === "object") out.va = mergeVaPatch(existing.va, patch.va);
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
 * WHAT ROLE A REST SAVE ARMS A RULE WITH — one home (F-485).
 *
 * ALWAYS "editor", whatever role the token holds. The token's role gates the DOOR
 * (who may write at all); it never grants the ROW a power, because an admin-only
 * action — a pull-request verdict, an outward comment — exists on a rule only
 * because an admin CLICKED it. `?resource=agents` and the collections had this
 * constant twice; it is one value with one reason, so it is one constant.
 */
const REST_SAVED_BY_ROLE = "editor";

/*
 * THE GATE CONTEXT FOR A REST SAVE (F-480, through F-485's one fact reader).
 *
 * This file supplied NO gate context at all, so `normalizeListener`/`normalizeJob`
 * ran `assertAllowedActions` against the restrictive default and THREW on any
 * capability-gated action. A rule that legitimately held one — armed by an admin's
 * click on an instance where the capability IS enabled — was therefore permanently
 * un-editable over REST: a rename came back 400 "contains actions this rule may not
 * use". Fail-closed and loud, but a capability the product grants and this door
 * cannot see.
 *
 * The facts come from `agentGateFacts` in src/index.js and from nowhere else — the
 * comment in src/shared/agent-actions.js names the resolver, the REST API and the two
 * run sites as the callers that "cannot each assemble a different one", and this is
 * how that becomes true rather than aspirational.
 *
 * NO CONTEXT TO PASS: a web trigger carries no invocation licence, so the edition
 * comes from the snapshot ladder, exactly as it does for the git webhook's own gate.
 * FAILS TO THE RESTRICTIVE SIDE: `agentGateFacts` never throws and omits what it
 * could not read, so an unreadable instance refuses the action instead of granting
 * it — and an incapable instance still refuses this same rename, which is the point.
 *
 * FRESH (F-819), under the freshness policy written on `agentGateFacts`: every ANSWER
 * and every SAVE door reads past the 30 s provider memo, and this file is the REST SKIN
 * over the SAME save doors the resolvers expose — `saveListener`, `testListener` and
 * `saveScheduledJob` went `{fresh:true}` in F-811, so a memoised read here re-opens
 * exactly the split those closed, one door down. The measured shape: the memo still
 * holds `managed` after the provider row was deleted (it is cleared only in the
 * container that served `saveProvider`), so this door would ACCEPT a git action on an
 * instance whose fresh facts are `atlassian` + Haiku and whose own tab refuses the same
 * save `needs-frontier-model`. The cost is bounded and paid gladly — a REST save is a
 * RARE capability read, not the per-transition run-time gate that keeps the memo on
 * purpose and says so in place.
 */
const restGateContext = async () => {
  const { agentGateFacts } = await idx();
  const facts = await agentGateFacts(null, { fresh: true });
  return buildAgentGateContext({ ...facts, triggerSource: null, savedByRole: REST_SAVED_BY_ROLE });
};

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
const noPrincipal = (what) => json(403, {
  error: `This token has no owning account and may not ${what}. Mint a new token.`,
  reason: "no-permission", needsRole: "admin", hint: "ask-app-admin",
});

/*
 * F-493 — THE OWNING ACCOUNT'S ROLE IS RE-READ ON A CREATE TOO.
 *
 * Every route on an EXISTING row asks `gateExistingRow`, which reads the account's LIVE
 * role. The create route read only the stamp on the token, so an editor token kept
 * minting live listeners and jobs after its owning account was demoted to viewer or
 * deactivated — rows the product's own UI would have refused that person, enabled, and
 * governable afterwards by nobody but an admin (the owner cannot edit them either,
 * because `ownerGate` correctly refuses them).
 *
 * THE SAME FLOOR THE RESOLVER USES on the same path: `requireRole(accountId, "editor")`,
 * which is what `saveListener`'s create branch asks in src/index.js. Not a new predicate.
 *
 * FAILS CLOSED. A role read that throws refuses: "I cannot tell whether this account may
 * author rules" is not "it may". ADMIN TOKENS SKIP IT, deliberately and as documented for
 * `ownerGate` — an admin token is scope "all" and has always survived its minter's
 * demotion; narrowing that here would revoke a power from every live integration on
 * upgrade, silently, which is the worse failure of the two.
 */
const creatorGate = async (who, what) => {
  if (tokenRole(who) === "admin") return null;
  const accountId = who && who.createdBy;
  if (!accountId) return noPrincipal(what);
  const { requireRole } = await idx();
  let allowed = false;
  try { allowed = await requireRole(accountId, "editor"); } catch (e) { allowed = false; }
  return allowed ? null : json(403, {
    error: `The account this token acts as may no longer ${what}.`,
    reason: "no-permission", needsRole: "editor", hint: "ask-app-admin",
  });
};

/*
 * F-503 — THE TOKEN'S EFFECTIVE PERMISSIONS, NOT ITS MINTER'S.
 *
 * `ownerGate` handed `gateExistingRow` an ACCOUNT ID and let it re-derive the verdict
 * from that account's live role. But `createApiToken` is `requireAdmin`, so the minter
 * of EVERY token is an app admin — and `rowGateVerdict` short-circuits on
 * `seesEverything` for an admin. F-471's ownership arm was therefore unreachable
 * through any token on a healthy instance: an editor token edited, disabled and
 * deleted foreign rows (live: a foreign-row PUT returned 200, and F-490's upsert
 * became a silent ownership TRANSFER), and only a post-hoc demotion of the minter
 * made the gate bite at all.
 *
 * THE TWO FACTS AN EDITOR TOKEN RESOLVES TO:
 *   role  = min(the token's stamped role, the minter's LIVE role). The stamp is the
 *           ceiling the admin chose at mint; the live role is the ceiling the product
 *           still grants that human. A demoted minter drags the token down with it
 *           (F-493's rule, now on the existing-row routes too); a minter who is an
 *           admin does NOT drag an editor token up, which is the whole finding.
 *   scope = "own". Not the minter's stored scope: the token is the narrower principal,
 *           and "own" is what the role the admin picked is worth. "Own rows" are rows
 *           stamped with the minter's account — which is exactly what this surface
 *           stamps for an editor token (`actor`, below).
 * ADMIN TOKENS RETURN EARLY and keep scope "all", unchanged and deliberate (see the
 * F-471 and F-493 blocks): narrowing them would revoke a power from every live
 * integration on upgrade.
 *
 * THE COMPARISON IS STILL THEIRS. We pass `{role, scope}` — two facts — and never a
 * verdict. `ownershipAllows` in src/index.js remains the only code that compares a
 * `createdBy` to a principal, so the F-261 existence-leak rule (an unknown id and a
 * foreign row are one refusal for a scope-"own" caller) keeps applying for free.
 *
 * FAILS CLOSED: a role read that throws, or an account with no role, leaves `role`
 * null, which `rowGateVerdict` answers "no-role" — the same 403 a role-less clicker
 * gets. `min` is spelled with `tokenRoleAtLeast`, the surface's ONE role comparison;
 * do not add a second rank table here.
 */
const effectiveTokenPerms = async (who, accountId) => {
  const { getUserPermissions } = await idx();
  let live = null;
  try {
    const p = await getUserPermissions(accountId);
    live = p && p.role ? String(p.role) : null;
  } catch (e) { live = null; }
  const stamped = tokenRole(who);
  return {
    role: live && tokenRoleAtLeast({ role: live }, stamped) ? stamped : live,
    scope: "own", // an admin token never reaches here — it returns early in `ownerGate`
    accountId,
  };
};

const ownerGate = async (who, row, { what, minRole = "editor", destructive = false, notFound }) => {
  if (tokenRole(who) === "admin") return null; // scope "all" — the pre-F-466 behaviour
  const accountId = who && who.createdBy;
  if (!accountId) return noPrincipal(what);
  const { gateExistingRow } = await idx();
  const perms = await effectiveTokenPerms(who, accountId);
  const refusal = await gateExistingRow(accountId, row, { what, minRole, destructive, notFound, perms });
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
   * A VIRTUAL ADMINISTRATOR IS NOT A JOB ON THIS RESOURCE (F-478).
   *
   * A VA is stored as a job row, so `?resource=jobs` was a SECOND door onto every
   * agent — and an editor-floor one. It bypassed `prepareVaSave` entirely: no live
   * catalogue check, no shadow re-arm, no cadence-derived schedule, and it deleted at
   * editor what `?resource=agents` protects at admin, while a viewer could read the
   * whole `va` block (persona, instructions, memory-shaped guardrails) off a GET.
   *
   * So every route here refuses a `mode:"va"` row BY NAME and points at the resource
   * that owns it, and the list hides them. It is the exact mirror of the agents
   * resource refusing a script job with `not_a_virtual_administrator`: one row, one
   * door, and the door carries the floor.
   */
  const vaDoor = (row) => (row && row.mode === "va"
    ? json(404, {
      error: "That id belongs to a Virtual Administrator. Use ?resource=agents.",
      reason: "is_a_virtual_administrator",
      resource: "agents",
    })
    : null);
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
  // `savedByRole:"editor"` (`REST_SAVED_BY_ROLE`, passed explicitly). That is
  // deliberate and it is a REFUSAL, not an oversight: a rule armed over the API can
  // never hold an admin-only power such as a PR verdict action. Arming one is an
  // admin's click. What it is NOT is a refusal of every CAPABILITY-gated action —
  // that was F-480, and the gate context (`restGateContext`) is what tells this door
  // which capabilities the instance actually has.

  if (method === "GET") {
    const gate = floor("viewer", `view ${kind}`); if (gate) return gate;
    if (id) { const row = await get(id); const va = vaDoor(row); if (va) return va; return row ? json(200, { [noun]: row }) : json(404, { error: `${noun} not found` }); }
    const rows = await list();
    return json(200, { [kind]: isL ? rows : rows.filter((r) => r && r.mode !== "va") });
  }
  if (method === "DELETE") {
    const gate = floor("editor", `delete a ${noun}`); if (gate) return gate;
    if (!id) return json(400, { error: "id required" });
    const rowForDelete = await get(id);
    { const va = vaDoor(rowForDelete); if (va) return va; }
    // `destructive` selects the narrower ownership rule the delete resolver uses: an
    // OWNERLESS row is not yours. The row is read before the gate so an unknown id and
    // a foreign one give a scope-"own" caller the same answer (F-261).
    const owned = await ownerGate(who, rowForDelete, { what: `delete this ${noun}`, destructive: true, notFound: `${noun} not found` });
    if (owned) return owned;
    const r = await remove(id);
    return json(r.removed ? 200 : 404, r.removed ? { deleted: id } : { error: `${noun} not found` });
  }
  if (method === "PUT") {
    const gate = floor("editor", `change a ${noun}`); if (gate) return gate;
    if (!id) return json(400, { error: "id required" });
    const existing = await get(id);
    { const va = vaDoor(existing); if (va) return va; }
    const owned = await ownerGate(who, existing, { what: `edit this ${noun}`, notFound: `${noun} not found` });
    if (owned) return owned;
    if (!existing) return json(404, { error: `${noun} not found` });
    // The instance's gate context (F-480). Without it this rename refuses every
    // capability-gated action the row legitimately holds.
    const agentGate = await restGateContext();
    try { const saved = await save({ ...merge(existing, body || {}), id }, { accountId: actor, gate: agentGate, savedByRole: REST_SAVED_BY_ROLE }); return json(200, { [noun]: saved }); } catch (e) { return json(400, errBody(e)); }
  }
  if (method === "POST" && action) {
    // `preview` computes nothing but the next fire times of a cron string — the
    // previewSchedule resolver's floor is `viewer`, and this one matches it.
    const gate = floor(action === "preview" ? "viewer" : "editor", `${action} a ${noun}`); if (gate) return gate;
    if (!id) return json(400, { error: "id required" });
    const row = await get(id);
    { const va = vaDoor(row); if (va) return va; }
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
    // …and the LIVE role of the account the token acts as (F-493). The token's own role
    // is a stamp made when it was minted; every other route on this surface re-reads the
    // account, and a create that did not was how a demoted owner kept authoring rules.
    const creator = await creatorGate(who, `create ${kind}`); if (creator) return creator;
    const items = Array.isArray(body) ? body : (body && Array.isArray(body[kind]) ? body[kind] : [body]);
    if (!items.length || items.length > 100) return json(400, { error: "provide 1-100 items" });
    // CREATE is the same door (F-478): a `mode:"va"` body here would mint an agent with
    // none of `prepareVaSave`'s checks, at the editor floor. It is refused before the
    // batch runs, so a mixed batch cannot half-create one.
    if (!isL) {
      const va = items.map((it) => vaDoor(it)).find(Boolean); if (va) return va;
    }
    /*
     * A BODY ID IS AN EDIT, AND AN EDIT ASKS THE OWNERSHIP QUESTION (F-490).
     *
     * `saveListener`/`saveJob` UPSERT by `input.id`, so a create that names an existing
     * row REPLACES it in place — and `normalizeListener` carries `existing.createdBy`
     * forward, which is what made the hijack invisible. This was the only write route on
     * this surface that asked nothing: the same body sent as `PUT ?id=` is refused 403
     * `not-owner`, and the resolver the UI uses gates a body-supplied id the same way
     * (`gateExistingRow` in src/index.js). One rule, and the REST door was the wider home.
     *
     * THE GATE IS `ownerGate` — imported, not restated: a second ownership rule here is
     * how two doors onto one row grow two answers, and the F-261 existence-leak rule (an
     * unknown id and a foreign row are the same refusal for a scope-"own" caller) would
     * have to be re-derived to match. An ADMIN token skips it, exactly as it does on PUT.
     *
     * BEFORE THE BATCH RUNS, like the VA door above: a refused item must not leave the
     * earlier items of a mixed batch already written.
     */
    for (const it of items) {
      if (!it || !it.id) continue;
      const row = await get(String(it.id));
      // An UPSERT that names an existing AGENT is the F-478 door from the other side:
      // without `mode:"va"` in the body it would rewrite the agent as a plain script
      // job, losing the whole record. Same read, so it is asked here.
      if (!isL) { const hit = vaDoor(row); if (hit) return hit; }
      /*
       * F-616 — AN UNMATCHED BODY ID IS A 404, NOT A CREATE AT THAT ID.
       *
       * This route used to `continue` here, so a POST whose body named an id that
       * matched nothing fell into `save()` and `normalizeListener`/`normalizeJob`
       * honoured the caller's id — a create at an id the CLIENT chose. An id is a
       * namespace (a VA's whole `va_*` ledger and its purge tombstone hang off its
       * job id), so that is how a deleted agent gets re-created on top of its own
       * dead state. The resolvers close the same hole in the same words
       * (`gateSaveById`, src/index.js): a create omits the id, an id that names no
       * row is "not found". PUT already answered 404 here; this is the twin.
       *
       * F-620 — AND THE ORDER IS THE OWNERSHIP QUESTION FIRST, like every other
       * route here (GET-by-id, DELETE, PUT, POST-action). The 404 sat ABOVE
       * `ownerGate`, which handed a scope-"own" token a free oracle: 404 meant the
       * id was unused, 403 `not-owner` meant a colleague owned a row there — F-261's
       * existence leak, re-opened on the widest door onto it (100 ids per request,
       * refused before any write, so probing was free). `ownerGate` answers a NULL
       * row on the same rule the resolvers do: "not found" only for a scope-"all"
       * caller, the byte-identical `not-owner` 403 for everyone else. An admin token
       * short-circuits it, so the plain 404 below is still what an admin sees.
       */
      const owned = await ownerGate(who, row, { what: `replace this ${noun}`, notFound: `${noun} not found` });
      if (owned) return owned;
      if (!row) return json(404, { error: `${noun} not found` });
    }
    // ONE fact read for the whole batch (F-480/F-485): the instance's capabilities do
    // not change between two items of the same request, and re-reading them per item
    // would spend a provider/licence read 100 times for one answer.
    const agentGate = await restGateContext();
    const saved = []; const errors = [];
    for (let i = 0; i < items.length; i++) {
      try { saved.push(await save(items[i], { accountId: actor, gate: agentGate, savedByRole: REST_SAVED_BY_ROLE })); } catch (e) { errors.push({ index: i, name: items[i] && items[i].name, ...errBody(e) }); }
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
  // A CONFLICT too, and the same one the Coder answers: the request is legal, the
  // INSTANCE cannot run an agent (edition, provider, model or a spent allowance).
  // Nothing in the body would fix it, so it must not read as 400. `agentDisabled` and
  // `capability` ride through `vaJson`'s `...rest`.
  agent_capability_off: 409,
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
   * not grant the row a power. The value and its reason live once, at module level
   * (F-485), because the collections door arms rows with the same rule. */
  const savedByRole = REST_SAVED_BY_ROLE;

  const loadVaJob = async () => {
    const row = await J.getJob(id);
    return row && row.mode === "va" ? row : null;
  };

  /* F-608 — `?resource=agents&part=purges`, the ONE part with NO id.
   *
   * Every other part is a slice of an agent that still exists. This one is the
   * opposite: the agents that were DELETED mid-turn and had already written to Jira
   * when they went, read off F-595's tombstones. There is no id to give because the
   * agent is gone, so it is answered here, ABOVE the "id required" gate and above the
   * no-id list — otherwise `part=purges` would silently return the agent list.
   *
   * ADMIN, the same floor as `part=effects`: it names what an agent did to Jira.
   *
   * An id WITH it is refused rather than ignored: a caller who passed one is asking a
   * question this part cannot answer (the tombstones are not indexed per agent), and a
   * silently site-wide answer to a per-agent request is the worse of the two. */
  if (part === "purges") {
    const r = floor("admin", "review what a deleted Virtual Administrator wrote"); if (r) return r;
    if (method !== "GET") return json(405, { error: `method ${method} not allowed` });
    if (id) return json(400, { error: "part=purges takes no id; it lists site-wide purges of agents that no longer exist" });
    return vaJson(await VA.listRecentPurges({ limit: q(req, "limit") }));
  }

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
    return json(400, { error: `unknown part "${part}" for agents`, parts: ["drafts", "effects", "memory", "purges (no id)"] });
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
      // The SAME merge the other collections use, so a PUT is a patch here too. `va`
      // is merged RECURSIVELY (`mergeVaPatch`, F-477) rather than by the shallow spread
      // the flat sub-objects get: a partial `va` that replaced the block rebuilt every
      // absent part from the defaults, which resumed a paused agent and re-widened its
      // guardrails.
      input = { ...merge(existing, body || {}), id, mode: "va" };
    } else {
      // `?id=` wins over a body id: a POST to a named agent is an UPSERT of that
      // agent, and a body that named a different one would edit a row the caller did
      // not address.
      input = { ...(body && typeof body === "object" ? body : {}), mode: "va", ...(id ? { id } : {}) };
      if (input.id) {
        existing = await J.getJob(input.id);
        if (existing && existing.mode !== "va") return json(409, { error: "that id belongs to a scheduled job that is not a Virtual Administrator" });
        // F-616 — the UPSERT arm, and the one that was exploited: a POST naming an
        // id that matches no row used to CREATE the agent at that id, which plants
        // a live agent on a deleted one's `va_*` namespace and its standing
        // `va_purged:` tombstone. An agent is created WITHOUT an id; an id that
        // names no agent is not found. Same rule as `gateSaveById` in src/index.js.
        if (!existing) return json(404, { error: "agent not found" });
      }
    }
    // ONE normalisation, and it is the resolver's: the live catalogue check, the
    // shadow re-arm and the cadence-derived schedule/name all live in
    // `va-admin.prepareVaSave`. A second copy here would be a second answer to what a
    // VA record means, and the copy nobody looks at is the one that drifts.
    const prepared = await VA.prepareVaSave({ input, existing, savedByRole });
    if (!prepared.ok) return vaJson(prepared);
    try {
      // The gate context, from the ONE fact reader, exactly as the collections door
      // and the resolvers build it (F-480/F-485). A Virtual Administrator's job row
      // carries `agent.allowedActions` like any other, so without it a re-save of an
      // agent that holds a capability-gated action refuses that action.
      const job = await J.saveJob(prepared.input, { accountId: actor, gate: await restGateContext(), savedByRole });
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
