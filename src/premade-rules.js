/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Premade (non-AI, "static") workflow rule EXECUTOR.
 *
 * Runs deterministic validators/conditions chosen from the premade catalog
 * (src/shared/premade-rules-catalog.js) — zero AI cost, no AI call. `validate()`
 * in index.js short-circuits here when `configuration.ruleKind === 'premade'`,
 * BEFORE any provider/credential/doc-fetch work.
 *
 * Contract: `executePremadeRule(config, args, invocationType)` returns
 *   { result: true }                       → ALLOW (validator) / SHOW (condition)
 *   { result: false, errorMessage }        → BLOCK with a message (validator)
 *   { result: false }                      → HIDE silently (condition)
 *
 * Inputs (mirrors how index.js destructures the validator payload):
 *   args.issue.key            — issue key (null on CREATE)
 *   args.modifiedFields       — the values being entered on the transition/create
 *                               screen NOW (CogniRunner exposes them here directly;
 *                               we also fall back to args.transition.modifiedFields)
 *
 * fail-OPEN on ANY error (validators AND conditions): a runtime bug, a REST read
 * failure, or a malformed config returns { result: true } — it never traps a
 * transition, and never silently hides one. This is safer than Altomata's
 * expression-based conditions (which fail-CLOSED/hidden) and matches CogniRunner's
 * existing AI path (license-inactive → { result: true }).
 *
 * CRITICAL: we read field values via REST on BOTH surfaces, so the status name is
 * ALWAYS `status.statusCategory.key` (the REST shape). Altomata's
 * expression-vs-REST `status.category` / `status.statusCategory` name-crossing does
 * NOT apply — there is one surface (JS/REST) here.
 *
 * Ported from Altomata src/validators.js (validators) + the manifest condition
 * expression (conditions), with the 5 acting-user conditions omitted (Forge does
 * not pass the acting user to app validators/conditions — they're marked
 * `availability:'unavailable'` in the catalog and never reach here).
 */
import api, { route } from "@forge/api";
import { redosRisk } from "./shared/regex-safety.js";

const PASS = { result: true };
// Cap the length of the value fed to a user regex — defense-in-depth so a pattern the ReDoS
// heuristic doesn't catch (e.g. overlapping-alternation) still can't run away on a 32KB field.
const REGEX_INPUT_CAP = 8000;

/** Read a single persisted field via REST. Throws on a non-OK response (→ fail-OPEN upstream). */
async function getRawField(issueKey, fieldId) {
  const res = await api.asApp().requestJira(
    route`/rest/api/3/issue/${issueKey}?fields=${fieldId}`,
    { headers: { Accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`issue read ${res.status}`);
  const data = await res.json();
  return (data?.fields || {})[fieldId];
}

/** Group names the given user belongs to (for the user-in-group condition). */
async function getUserGroups(accountId) {
  const res = await api.asApp().requestJira(
    route`/rest/api/3/user/groups?accountId=${accountId}`,
    { headers: { Accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`user groups read ${res.status}`);
  const data = await res.json();
  // GET /user/groups returns an array of { name, ... }.
  return (Array.isArray(data) ? data : data?.items || []).map((g) => g && g.name).filter(Boolean);
}

/** Flatten an ADF (rich-text) doc to its text content. Inline NON-text nodes (mentions, emoji,
 *  dates, smart-link cards) carry their visible text in `attrs`, not `node.text` — emit it so
 *  isEmpty / text-length / fieldText don't undercount rich content (e.g. a description made only
 *  of an @mention + emoji must NOT read as empty). Mirrors index.js extractTextFromADF. */
function adfText(node) {
  if (!node || typeof node !== "object") return "";
  let t = typeof node.text === "string" ? node.text : "";
  if (!t && node.attrs) {
    const a = node.attrs;
    if (node.type === "mention" || node.type === "status") t = a.text || "";
    else if (node.type === "emoji") t = a.text || a.shortName || "";
    else if (node.type === "date") t = a.timestamp != null ? String(a.timestamp) : "";
    else if (node.type === "inlineCard" || node.type === "blockCard" || node.type === "embedCard") t = a.url || "";
  }
  for (const c of node.content || []) t += adfText(c);
  return t;
}

/** Empty = absent, null, '', empty array, ADF with no text, or {} — mirrors the form's intent. */
function isEmpty(v) {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === ""; // whitespace-only counts as empty ("has a value")
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") {
    if (Array.isArray(v.content)) return adfText(v).trim() === ""; // ADF rich text
    if ("value" in v || "name" in v || "id" in v || "accountId" in v || "key" in v) return false; // option/user/etc.
    return Object.keys(v).length === 0;
  }
  return false;
}

/** Best-effort scalar text for a value (string / number / option / user / ADF / array of these). */
function fieldText(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(fieldText).join(", ");
  if (typeof v === "object") {
    if (Array.isArray(v.content)) return adfText(v); // ADF
    // accountId last: a user field on the transition screen arrives as {accountId}-only.
    return v.value ?? v.name ?? v.displayName ?? v.key ?? v.accountId ?? "";
  }
  return String(v);
}

const norm = (s) => String(s).trim().toLowerCase();

/**
 * Run a VALIDATOR rule. Returns { result:true } to ALLOW or { result:false, errorMessage } to BLOCK.
 * `mf` = the modified-fields map (transition/create screen). Ported verbatim from Altomata validators.js.
 */
async function runValidator(cfg, mf, issueKey, read) {
  const label = cfg.fieldName || "This field";
  const fail = (msg) => ({ result: false, errorMessage: (cfg.errorMessage && cfg.errorMessage.trim()) || msg });

  // Issue-level rules (no field picker) — handled before the field guard.
  if (cfg.ruleType === "sub-tasks-resolved") {
    if (!issueKey) return PASS; // Create → no persisted sub-tasks → nothing to enforce
    const subs = await read(issueKey, "subtasks");
    if (!Array.isArray(subs) || subs.length === 0) return PASS; // no sub-tasks → fail-OPEN
    const open = subs.filter((s) => s?.fields?.status?.statusCategory?.key !== "done");
    return open.length === 0 ? PASS : fail(`Resolve all sub-tasks first (${open.length} still open).`);
  }
  if (cfg.ruleType === "attachment-required") {
    if (!issueKey) return PASS; // Create → no persisted attachments → fail-OPEN
    const atts = await read(issueKey, "attachment"); // REST field id is 'attachment' (singular) → array
    return Array.isArray(atts) && atts.length > 0 ? PASS : fail("Add an attachment before this transition.");
  }
  // comment-required: the comment a user types on the transition screen arrives in modifiedFields.comment
  // (an ADF doc, or a string on some hosting paths). There is NO persisted "comment" field, so this is
  // screen-only. If the Comment field isn't on the transition screen it blocks for everyone (deterministic
  // by design; the config form warns). Handled here (before the field guard) because it has no fieldId.
  if (cfg.ruleType === "comment-required") {
    const c = mf.comment;
    const text = c && typeof c === "object" && Array.isArray(c.content) ? adfText(c) : typeof c === "string" ? c : "";
    const t = text.trim();
    if (t === "") return fail("Add a comment to make this transition.");
    const min = cfg.minLen === "" || cfg.minLen == null ? NaN : Number(cfg.minLen); // presence-gated like text-length
    if (Number.isFinite(min) && [...t].length < min) return fail(`Your comment must be at least ${min} characters.`); // code points, not UTF-16 units
    return PASS;
  }

  if (!cfg.fieldId) return PASS;
  // value the user is submitting NOW (transition/create screen) → else the persisted value → else (Create) empty.
  let value;
  if (cfg.fieldId in mf) value = mf[cfg.fieldId];
  else if (issueKey) value = await read(issueKey, cfg.fieldId);
  else value = undefined;

  switch (cfg.ruleType) {
    case "field-required":
      return isEmpty(value) ? fail(`${label} must be set before this transition.`) : PASS;
    case "field-changed": // the field must be edited (to a non-empty value) on this transition
      return cfg.fieldId in mf && !isEmpty(mf[cfg.fieldId])
        ? PASS
        : fail(`${label} must be changed as part of this transition.`);
    case "field-comparison": {
      if (isEmpty(value)) return PASS; // nothing to compare — that's the required rule's job
      const opv = cfg.op || "eq";
      const target = String(cfg.compareValue ?? "").trim();
      if (target === "") return PASS;
      const C = { eq: "equal to", ne: "not equal to", gt: "greater than", lt: "less than", gte: "at least", lte: "at most", contains: "contain" };
      const parts = Array.isArray(value) ? value.map(fieldText) : [fieldText(value)]; // array-aware (per-element)
      // strict numeric: the WHOLE trimmed string must be a number — so a date ("2026-07-01") or version
      // ("1.2.3") is NOT numeric (was silently parseFloat'd to its leading number → year-only date compares).
      const num = (s) => { const t = String(s).trim(); return t !== "" && Number.isFinite(Number(t)) ? Number(t) : NaN; };
      const a = num(parts.length === 1 ? parts[0] : ""), b = num(target);
      const nums = !Number.isNaN(a) && !Number.isNaN(b);
      // date-aware ordering for ISO-date fields (Due date etc.) so gt/lt work on dates, not years.
      const isDate = (s) => /^\d{4}-\d{2}-\d{2}/.test(String(s).trim());
      if (["gt", "lt", "gte", "lte"].includes(opv)) {
        if (nums) { const ok = opv === "gt" ? a > b : opv === "lt" ? a < b : opv === "gte" ? a >= b : a <= b; return ok ? PASS : fail(`${label} must be ${C[opv]} “${target}”.`); }
        if (parts.length === 1 && isDate(parts[0]) && isDate(target)) {
          const da = Date.parse(parts[0]), db = Date.parse(target);
          if (!Number.isNaN(da) && !Number.isNaN(db)) { const ok = opv === "gt" ? da > db : opv === "lt" ? da < db : opv === "gte" ? da >= db : da <= db; return ok ? PASS : fail(`${label} must be ${C[opv]} “${target}”.`); }
        }
        return PASS; // can't order non-numeric/non-date → fail-open
      }
      let ok;
      if (opv === "ne") ok = nums ? a !== b : !parts.some((p) => norm(p) === norm(target));
      else if (opv === "contains") ok = parts.some((p) => norm(p).includes(norm(target)));
      else ok = nums ? a === b : parts.some((p) => norm(p) === norm(target)); // eq
      return ok ? PASS : fail(`${label} must be ${C[opv] || opv} “${target}”.`);
    }
    case "field-regex": {
      if (isEmpty(value)) return PASS; // emptiness is the required rule's job — don't double-enforce
      // ReDoS guard: NEVER execute a nested-unbounded-quantifier pattern (e.g. ^(a+)+$) — synchronous
      // catastrophic backtracking can blow the 25s sync-validator budget on reporter-controlled input,
      // hanging the transition for everyone. Fail-OPEN (allow) instead of running it. This also protects
      // rules that were saved before the config-time guard existed.
      if (redosRisk(cfg.regex)) { console.warn("[cognirunner:premade] field-regex skipped — pattern risks catastrophic backtracking (ReDoS); failing open"); return PASS; }
      let re; try { re = new RegExp(cfg.regex || ""); } catch { return PASS; } // bad pattern → fail-open
      // Cap the tested length (defense-in-depth) so a shape the heuristic misses can't run away.
      return re.test(fieldText(value).slice(0, REGEX_INPUT_CAP)) ? PASS : fail(`${label} must match the required format.`);
    }
    case "allowed-values": {
      const allowed = String(cfg.allowedValues || "").split(",").map((s) => s.trim()).filter(Boolean);
      if (!allowed.length || isEmpty(value)) return PASS;
      const allowedN = allowed.map(norm);
      const got = Array.isArray(value) ? value.map(fieldText) : [fieldText(value)];
      return got.every((g) => allowedN.includes(norm(g))) ? PASS : fail(`${label} must be one of: ${allowed.join(", ")}.`);
    }
    case "text-length": {
      // value may be a plain string, an ADF doc (rich-text fields), or null — flatten ADF via adfText.
      let text;
      if (typeof value === "string") text = value;
      else if (value && typeof value === "object" && value.type === "doc") text = adfText(value);
      else if (value == null) text = "";
      else return PASS; // unexpected shape → fail-open
      const len = [...text].length; // count Unicode code points (an emoji/astral char = 1, not 2 UTF-16 units)
      // Presence-gate: Number('')/Number(null) are 0 (finite) — only Number(undefined) is NaN.
      const hasMin = cfg.min !== "" && cfg.min != null, hasMax = cfg.max !== "" && cfg.max != null;
      const min = Number(cfg.min), max = Number(cfg.max);
      if (hasMin && Number.isFinite(min) && len < min) return fail(`${label} must be at least ${min} characters (currently ${len}).`);
      if (hasMax && Number.isFinite(max) && len > max) return fail(`${label} must be at most ${max} characters (currently ${len}).`);
      return PASS;
    }
    case "date-relative": {
      if (value == null || value === "") return PASS; // unset → fail-open
      const s = String(value).trim();
      const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s); // 'YYYY-MM-DD' carries no timezone
      const target = dateOnly ? Date.parse(`${s}T00:00:00Z`) : Date.parse(s);
      if (Number.isNaN(target)) return PASS; // unparseable → fail-open
      // For a date-only field, compare calendar days in UTC on BOTH sides (a datetime field keeps its own
      // offset). Verify live near local midnight for a non-UTC user — the one MED-confidence path.
      let now = Date.now();
      if (dateOnly) { const d = new Date(); now = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }
      if (cfg.mode === "within") {
        const n = cfg.days === "" || cfg.days == null ? NaN : Number(cfg.days); // blank days → fail-open, not a 0-day window
        if (!Number.isFinite(n)) return PASS;
        return target >= now && target <= now + n * 86400000 ? PASS : fail(`${label} must be within ${n} day${n === 1 ? "" : "s"}.`);
      }
      return target > now ? PASS : fail(`${label} must be in the future.`);
    }
    case "field-cardinality": {
      // count the VALUES of a multi-value field; a single value coerces to count 1, empty → 0. Presence-gate
      // min/max exactly like text-length. On Create the unset field → 0, so a min≥1 blocks (usually intended).
      const arr = Array.isArray(value) ? value : isEmpty(value) ? [] : [value];
      const cnt = arr.length;
      const hasMin = cfg.min !== "" && cfg.min != null, hasMax = cfg.max !== "" && cfg.max != null;
      const min = Number(cfg.min), max = Number(cfg.max);
      if (hasMin && Number.isFinite(min) && cnt < min) return fail(`${label} needs at least ${min} value${min === 1 ? "" : "s"} (currently ${cnt}).`);
      if (hasMax && Number.isFinite(max) && cnt > max) return fail(`${label} must have at most ${max} value${max === 1 ? "" : "s"} (currently ${cnt}).`);
      return PASS;
    }
    default:
      // Observability: a premade validator with an unrecognized ruleType does NOTHING (fail-open).
      // Without this line that is invisible — the rule silently allows every transition and looks
      // like it "passed". Surfacing it makes a misconfigured rule debuggable in forge logs.
      console.warn(`[cognirunner:premade] unrecognized validator ruleType ${JSON.stringify(cfg.ruleType)} — failing OPEN (allowing every transition). Check the rule's premade config.`);
      return PASS; // unknown rule type → fail-open
  }
}

/**
 * Run a CONDITION rule. Returns a boolean: true = SHOW the transition, false = HIDE it.
 * Reads persisted issue fields via REST (one targeted read per rule). On CREATE (no issue) → SHOW.
 * Re-expressed from the manifest condition expression; the 5 acting-user conditions are omitted.
 */
async function runCondition(cfg, issueKey, read, actingUser, readUserGroups) {
  // CREATE (no persisted issue) → SHOW. A persisted-issue condition has nothing to evaluate yet.
  if (!issueKey) return true;
  switch (cfg.ruleType) {
    case "field-has-value": {
      if (!cfg.fieldId) return true;
      return !isEmpty(await read(issueKey, cfg.fieldId));
    }
    case "field-empty": {
      if (!cfg.fieldId) return true;
      return isEmpty(await read(issueKey, cfg.fieldId));
    }
    case "field-equals": {
      if (!cfg.fieldId || cfg.value == null) return true;
      const got = fieldText(await read(issueKey, cfg.fieldId));
      // Numeric coercion to match field-comparison's eq (so 5 equals "5.0"); falls back to
      // case-insensitive text equality for non-numbers (and multi-value joins → text path).
      const numOf = (x) => { const t = String(x).trim(); return t !== "" && Number.isFinite(Number(t)) ? Number(t) : NaN; };
      const a = numOf(got), b = numOf(cfg.value);
      if (!Number.isNaN(a) && !Number.isNaN(b)) return a === b;
      return norm(got) === norm(cfg.value);
    }
    case "issue-type-is": {
      if (cfg.issueTypeName == null) return true;
      const it = await read(issueKey, "issuetype");
      return norm(it?.name ?? "") === norm(cfg.issueTypeName);
    }
    case "has-attachments": {
      const a = await read(issueKey, "attachment");
      return Array.isArray(a) && a.length >= 1;
    }
    case "issue-is-resolved": {
      return (await read(issueKey, "resolution")) != null;
    }
    case "sub-tasks-all-resolved": {
      const subs = await read(issueKey, "subtasks");
      return (Array.isArray(subs) ? subs : []).every((s) => s?.fields?.status?.statusCategory?.key === "done");
    }
    case "parent-status-is": {
      if (cfg.statusName == null) return true;
      const parent = await read(issueKey, "parent");
      if (parent == null) return true; // top-level issue → SHOW
      return norm(parent?.fields?.status?.name ?? "") === norm(cfg.statusName);
    }
    case "resolution-is": {
      if (cfg.resolutionName == null) return true;
      const r = await read(issueKey, "resolution");
      return norm(r?.name ?? "") === norm(cfg.resolutionName);
    }
    case "priority-is": {
      if (cfg.priorityName == null) return true;
      const p = await read(issueKey, "priority");
      return norm(p?.name ?? "") === norm(cfg.priorityName);
    }
    case "linked-issue-resolved": {
      const links = await read(issueKey, "issuelinks");
      const arr = Array.isArray(links) ? links : [];
      const done = (l) => (l?.inwardIssue || l?.outwardIssue)?.fields?.status?.statusCategory?.key === "done";
      if (cfg.linkTypeName == null) return arr.every(done); // any link type
      return arr.filter((l) => norm(l?.type?.name ?? "") === norm(cfg.linkTypeName)).every(done);
    }
    // --- Acting-user conditions. actingUser = the accountId from args.user (present
    //     in the rule payload). If it's unavailable we SHOW (fail-OPEN). ---
    case "current-user-is-assignee": {
      if (!actingUser) return true;
      const a = await read(issueKey, "assignee");
      return a?.accountId === actingUser;
    }
    case "current-user-is-reporter": {
      if (!actingUser) return true;
      const r = await read(issueKey, "reporter");
      return r?.accountId === actingUser;
    }
    case "user-in-field": {
      if (!cfg.fieldId || !actingUser) return true;
      const u = await read(issueKey, cfg.fieldId);
      // Single-user fields read as { accountId }; multi-user fields as [{ accountId }, …].
      // Handle both so pointing this at a multi-user field (e.g. Approvers) matches any member
      // instead of silently hiding for everyone.
      const ids = Array.isArray(u) ? u.map((x) => x && x.accountId) : [u && u.accountId];
      return ids.includes(actingUser);
    }
    case "user-in-group": {
      if (cfg.groupName == null || !actingUser) return true;
      const groups = await readUserGroups(actingUser);
      return (Array.isArray(groups) ? groups : []).some((g) => norm(g) === norm(cfg.groupName));
    }
    default:
      console.warn(`[cognirunner:premade] unrecognized condition ruleType ${JSON.stringify(cfg.ruleType)} — failing OPEN (showing the transition). Check the rule's premade config.`);
      return true; // unknown / unavailable rule type → SHOW (fail-OPEN)
  }
}

/**
 * Entry point. Dispatches to the validator or condition path, fail-OPEN on any error,
 * and emits one structured (metadata-only — never field VALUES) trace line per evaluation
 * so a premade rule firing is observable in `forge logs`.
 */
export async function executePremadeRule(config, args, invocationType, opts = {}) {
  const cfg = config || {};
  const issueKey = args?.issue?.key;
  const mf = args?.modifiedFields || args?.transition?.modifiedFields || {};
  // Field reader is injectable for offline unit testing (defaults to the live REST read).
  const read = opts.readField || getRawField;
  // Acting user (for the user-conditions) — present in the rule payload as args.user.accountId.
  const actingUser = opts.actingUser ?? args?.user?.accountId ?? args?.context?.accountId ?? null;
  const readUserGroups = opts.readUserGroups || getUserGroups;
  let out;
  try {
    if (!cfg.ruleType) {
      out = PASS;
    } else if (invocationType === "condition") {
      out = (await runCondition(cfg, issueKey, read, actingUser, readUserGroups)) ? PASS : { result: false }; // hide silently — no message
    } else {
      out = await runValidator(cfg, mf, issueKey, read);
    }
  } catch {
    out = PASS; // fail-OPEN — a runtime bug never traps (or silently hides) a transition
  }
  try {
    console.log(`[cognirunner:premade] ${JSON.stringify({
      kind: invocationType,
      rule: cfg.ruleType || null,
      field: cfg.fieldId || null,
      issue: issueKey || null,
      result: out?.result !== false,
      blocked: out?.result === false,
    })}`);
  } catch { /* best-effort trace */ }
  return out;
}
