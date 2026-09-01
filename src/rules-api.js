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
 * 401 with no detail. Rows created through the API carry createdBy "api:<tokenId>".
 *
 * ROUTING (Forge web-trigger URLs are fixed, so the resource travels in the
 * query string):
 *   GET    ?resource=events                         event catalogue
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
 */
import storage from "@forge/kvs";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { JIRA_EVENTS, EVENT_CATEGORIES } from "./shared/jira-events.js";
import { AGENT_ACTIONS } from "./shared/agent-actions.js";
import * as L from "./listeners.js";
import * as J from "./scheduled-jobs.js";

const idx = () => import("./index.js");

export const API_TOKENS_KEY = "api_tokens";
export const RULES_API_WEBTRIGGER_KEY = "rules-api";
export const RULES_API_URL_KVS_KEY = "webtrigger_url:rules-api";
const MAX_TOKENS = 25;
const MAX_BODY_BYTES = 512 * 1024;
const nowIso = () => new Date().toISOString();

// ── Tokens ───────────────────────────────────────────────────────────────────

const sha256 = (s) => createHash("sha256").update(String(s)).digest("hex");
const readTokens = async () => { const v = (await storage.get(API_TOKENS_KEY)) || []; return Array.isArray(v) ? v : []; };
const publicRow = (t) => ({ id: t.id, name: t.name, prefix: t.prefix, createdAt: t.createdAt, createdBy: t.createdBy, lastUsedAt: t.lastUsedAt || null, revokedAt: t.revokedAt || null });

export const listApiTokens = async () => (await readTokens()).map(publicRow);

/** Mint a token; returns { token (plaintext, once), row }. */
export const createApiTokenInternal = async ({ name, accountId }) => {
  const rows = await readTokens();
  if (rows.filter((t) => !t.revokedAt).length >= MAX_TOKENS) throw new Error(`Token limit reached (${MAX_TOKENS}). Revoke unused tokens first.`);
  const token = `cgr_${randomBytes(24).toString("hex")}`;
  const row = { id: `tok_${Date.now().toString(36)}${randomBytes(3).toString("hex")}`, name: String(name || "API token").slice(0, 80), hash: sha256(token), prefix: token.slice(0, 10), createdAt: nowIso(), createdBy: accountId || null, lastUsedAt: null, revokedAt: null };
  rows.push(row);
  await storage.set(API_TOKENS_KEY, rows);
  return { token, row: publicRow(row) };
};

export const revokeApiTokenInternal = async (id) => {
  const rows = await readTokens();
  const t = rows.find((r) => r.id === id);
  if (!t) return { revoked: false };
  t.revokedAt = nowIso(); t.hash = "revoked";
  await storage.set(API_TOKENS_KEY, rows);
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
  // Touch lastUsedAt at most once per hour (cheap, no write storm).
  if (!hit.lastUsedAt || Date.now() - Date.parse(hit.lastUsedAt) > 3600000) {
    hit.lastUsedAt = nowIso();
    try { await storage.set(API_TOKENS_KEY, rows); } catch { /* best-effort */ }
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

const eventCatalog = () => ({
  categories: EVENT_CATEGORIES,
  events: JIRA_EVENTS.map((e) => ({ id: e.id, category: e.category, label: e.label, description: e.description, filters: e.filters, volume: e.volume, issueBound: e.issueBound, issueIdOnly: e.issueIdOnly, projectScoped: e.projectScoped, payloadHint: e.payloadHint })),
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
  const actor = `api:${who.id}`;

  if (method === "GET") {
    if (id) { const row = await get(id); return row ? json(200, { [noun]: row }) : json(404, { error: `${noun} not found` }); }
    return json(200, { [kind]: await list() });
  }
  if (method === "DELETE") {
    if (!id) return json(400, { error: "id required" });
    const r = await remove(id);
    return json(r.removed ? 200 : 404, r.removed ? { deleted: id } : { error: `${noun} not found` });
  }
  if (method === "PUT") {
    if (!id) return json(400, { error: "id required" });
    const existing = await get(id);
    if (!existing) return json(404, { error: `${noun} not found` });
    try { const saved = await save({ ...merge(existing, body || {}), id }, { accountId: actor }); return json(200, { [noun]: saved }); } catch (e) { return json(400, { error: e.message }); }
  }
  if (method === "POST" && action) {
    if (!id) return json(400, { error: "id required" });
    const row = await get(id);
    if (!row) return json(404, { error: `${noun} not found` });
    if (action === "enable" || action === "disable") { const saved = await setEnabled(id, action === "enable"); return json(200, { [noun]: saved }); }
    if (isL && action === "test") {
      try {
        const r = await L.testListener({ listener: row, issueKey: body && body.issueKey, eventType: body && body.eventType, syntheticEvent: body && body.event, deadline: Date.now() + 20000 });
        return json(200, { result: r });
      } catch (e) { return json(400, { error: e.message }); }
    }
    if (!isL && action === "run") {
      const r = await J.enqueueJobRun({ job: row, manual: true, accountId: actor });
      return json(202, { queued: true, taskId: r.taskId, poll: `?resource=tasks&id=${encodeURIComponent(r.taskId)}` });
    }
    if (!isL && action === "preview") return json(200, J.previewSchedule({ cron: (body && body.cron) || row.schedule.cron, timeZone: (body && body.timeZone) || row.schedule.timeZone, count: (body && body.count) || 5 }));
    return json(400, { error: `unknown action "${action}" for ${kind}` });
  }
  if (method === "POST") {
    const items = Array.isArray(body) ? body : (body && Array.isArray(body[kind]) ? body[kind] : [body]);
    if (!items.length || items.length > 100) return json(400, { error: "provide 1-100 items" });
    const saved = []; const errors = [];
    for (let i = 0; i < items.length; i++) {
      try { saved.push(await save(items[i], { accountId: actor })); } catch (e) { errors.push({ index: i, name: items[i] && items[i].name, error: e.message }); }
    }
    const status = saved.length ? (errors.length ? 207 : (items.length === 1 ? 201 : 200)) : 400;
    return json(status, items.length === 1 && saved.length === 1 && !errors.length ? { [noun]: saved[0] } : { [kind]: saved, errors });
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
  let body;
  try { body = method === "GET" || method === "DELETE" ? {} : parseBody(req); } catch (e) { return json(400, { error: e.message }); }
  try {
    const m = await idx();
    switch (resource) {
      case "whoami": return json(200, { token: publicRow(who), app: "CogniRunner", now: nowIso() });
      case "events": return json(200, eventCatalog());
      case "actions": return json(200, { actions: AGENT_ACTIONS.map((a) => ({ id: a.id, kind: a.kind, label: a.label, description: a.description })) });
      case "listeners": return handleCollection({ req, method, id, action, body, who, kind: "listeners" });
      case "jobs": return handleCollection({ req, method, id, action, body, who, kind: "jobs" });
      case "samples": {
        const s = await L.getEventSample(String(q(req, "eventType") || ""));
        return s ? json(200, s) : json(404, { error: "no sample captured yet for this event" });
      }
      case "logs": {
        const ruleId = q(req, "ruleId") ? String(q(req, "ruleId")).slice(0, 120) : null;
        return json(200, { logs: await m.readLogs(ruleId) });
      }
      case "tasks": {
        if (!id) return json(400, { error: "id required" });
        const row = await storage.get(`async_task:${id}`);
        const job = await storage.get(`async_job:${id}`);
        if (!row) return json(200, { taskId: id, status: job ? job.status : "pending", job: job || null });
        if (row.status === "done" || row.status === "error") { try { await storage.delete(`async_task:${id}`); } catch { /* ignore */ } }
        return json(200, { taskId: id, status: row.status, result: row.result, error: row.error, job: job || null });
      }
      default: return json(404, { error: "unknown resource", resources: ["events", "actions", "listeners", "jobs", "tasks", "logs", "samples", "whoami"] });
    }
  } catch (e) {
    console.error("[rules-api] error:", e);
    return json(500, { error: String((e && e.message) || e).slice(0, 300) });
  }
}
