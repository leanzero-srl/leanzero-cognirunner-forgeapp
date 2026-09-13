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
// GIT validators (1.4 commit 10). Each name has ONE home and is imported, never
// retyped: the repo-id normaliser, the advisory property's key, the connection
// row + its allow-list predicate + the adapter factory.
import { normalizeRepoId } from "./shared/git-ids.js";
import { GIT_PROPERTY_KEY } from "./listeners.js";
import { getConnection, isRepoAllowed, providerForConnection } from "./git-connections.js";

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
async function runValidator(cfg, mf, issueKey, read, gitDeps = {}) {
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

  // GIT validators (no field picker, one outbound provider call). Handled before
  // the field guard for the same reason the issue-level rules are.
  if (isGitValidatorType(cfg.ruleType)) {
    const run = runGitValidator(cfg, issueKey, gitDeps);
    // The 8 s ceiling. `raceDeadline` is index.js's ONE deadline helper, injected
    // through opts so this module does not import index.js (a cycle) and does not
    // grow a second copy of it. Without it (offline tests) the adapter's own
    // per-call timeout still bounds the call.
    if (typeof gitDeps.raceDeadline !== "function") return run;
    try {
      return await gitDeps.raceDeadline(run, Date.now() + GIT_VALIDATOR_BUDGET_MS, "Git validator");
    } catch {
      // Timed out. Same decision as any other transport fault.
      return cfg.strict === true
        ? { result: false, errorMessage: (cfg.errorMessage && cfg.errorMessage.trim()) || `Checking the pull request in ${normalizeRepoId(cfg.repo) || "the repository"} took too long, and this rule is set to Strict.`, banner: "git_unavailable" }
        : { result: true, gitReason: "provider-timeout", banner: "git_unavailable" };
    }
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
    // ⚠️ FIELD TYPES — OFFLINE REFERENCE ONLY, and DELIBERATELY DIVERGENT from
    // the live semantics. At runtime a condition is evaluated by JIRA as the
    // manifest expression, never by this function; the expression's semantics
    // are the product's truth: strictly typed (no numeric coercion — expression
    // `==` errors across types), case-insensitive via toLowerCase on both sides,
    // custom fields of verified kinds only (exprProp/exprKind — see
    // CONDITION_FIELD_KINDS), and field-equals ALLOWS on an empty field. The
    // looser matching below (numeric coercion, isEmpty's ADF/whitespace
    // handling) exists for offline unit coverage of legacy shapes only.
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
    // Git conditions are evaluated by JIRA, as branches of the manifest expression
    // (they read the advisory cognirunner.git property; a missing property is TRUE).
    // runCondition is never the live evaluator for them — this branch exists only so
    // the belt-and-suspenders path SHOWS the transition instead of logging an
    // "unrecognized rule type" warning. The VALIDATORS with these same keys are the
    // ones that verify live, in runGitValidator.
    case "git-pr-merged":
    case "git-pr-approved":
    case "git-build-passed":
      return true;
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

/* ===== GIT VALIDATORS (1.4 commit 10) ===================================== */

/** The four git validator rule types. Conditions with the same keys are a DIFFERENT
 *  engine (the manifest expression) — see runCondition's git note. */
export const GIT_VALIDATOR_TYPES = [
  "git-build-passed",
  "git-pr-approved",
  "git-pr-comments-resolved",
  "git-pr-merged",
];
export const isGitValidatorType = (t) => GIT_VALIDATOR_TYPES.includes(t);

/**
 * Wall clock for the WHOLE git check, inside the validator's own budget. A
 * transition is a human waiting on a screen: the adapter's per-call timeout is
 * 10 s and one check can chain two calls, so the ceiling has to be here, not
 * there. 8 s leaves the rest of validate() (log write, registry read) room
 * inside the 25 s platform cap.
 */
export const GIT_VALIDATOR_BUDGET_MS = 8000;

/** Build states that are a DETERMINATE "has not passed" (rollUpChecks vocabulary). */
const BUILD_NOT_PASSED = ["failed", "running", "pending"];

/**
 * Does this LIVE pull request name the issue? (F-362.)
 *
 * Word-boundary, case-insensitive: "T-1" matches "feature/T-1-thing" and
 * "T-1: add the thing", and does NOT match "T-12". The key is escaped before it
 * reaches the RegExp — it arrives from an arbitrary issue and must never be read
 * as a pattern.
 */
const issueKeyNamedIn = (text, issueKey) => {
  const key = String(issueKey || "").trim();
  const hay = typeof text === "string" ? text : "";
  if (!key || !hay) return false;
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9])${esc}([^A-Za-z0-9]|$)`, "i").test(hay);
};

/**
 * The candidate/issue binding, per prMatch mode. "branch" reads only the source
 * branch; "property" and "both" accept branch OR title. No mode returns true
 * without a LIVE signal — the property never binds anything by itself (F-362).
 */
const prIsBoundToIssue = (pr, issueKey, prMatch) => {
  if (!issueKey) return false;
  const branch = issueKeyNamedIn(pr && pr.sourceBranch, issueKey);
  if (prMatch === "branch") return branch;
  return branch || issueKeyNamedIn(pr && pr.title, issueKey);
};

/** Read the advisory cognirunner.git property for one issue. Never throws. */
async function readGitProperty(issueKey) {
  try {
    const res = await api.asApp().requestJira(
      route`/rest/api/3/issue/${issueKey}/properties/${GIT_PROPERTY_KEY}`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return null;
    const body = await res.json();
    return body && body.value ? body.value : null;
  } catch {
    return null;
  }
}

/**
 * Run a GIT validator. Returns the same shape as every other validator, plus an
 * optional `banner` the execution log and config-view render.
 *
 * WHY IT NEVER TRUSTS THE PROPERTY. `cognirunner.git` is the last state this app
 * SAW (listeners.js: "THE PROPERTY IS ADVISORY"). Anyone who can write an issue
 * property can set `pr.merged:true`, and deliveries arrive out of order. So the
 * property is an INDEX — it supplies the candidate PR number — and every answer
 * that blocks or allows comes from a live provider read on this transition.
 * F-362 closed the other half of that promise: the property also chose the
 * SUBJECT of the read, so a forged number pointed the gate at an unrelated
 * merged PR. The live pull request must now NAME the issue (source branch or
 * title) in every prMatch mode, or it is no candidate at all.
 *
 * FAIL-OPEN / FAIL-CLOSED, on purpose (LAW 3). Validators fail OPEN by default;
 * `strict:true` is the admin opting into the opposite, and two cases ignore it:
 *
 *   situation                          strict:false          strict:true
 *   ---------------------------------- --------------------- ---------------------
 *   config not finished (no connection  ALLOW                 ALLOW
 *     id / no repo)                     (the rule isn't built yet — same as every
 *                                        other premade rule's malformed-config path)
 *   connection id names no row          BLOCK                 BLOCK   <- fail CLOSED
 *   repo not on the allow-list          BLOCK                 BLOCK   <- fail CLOSED
 *   no pull request found               ALLOW                 BLOCK
 *   dead token (auth_dead)              ALLOW + banner        BLOCK (names the
 *                                                              connection, never
 *                                                              the token)
 *   network error / timeout / 429       ALLOW + banner        BLOCK
 *   determinate negative (not merged,
 *     not approved, build failed,
 *     unresolved comment)               BLOCK                 BLOCK
 *   unknown (no checks at all, thread
 *     resolution unreadable on GitHub)  ALLOW                 BLOCK
 *
 * The two fail-CLOSED rows are the §8 "dead gate" finding: a rule pointing at a
 * connection that was deleted, or at a repository the connection is not allowed
 * to read, is MISCONFIGURED — not unlucky. Letting it pass silently turns a gate
 * somebody relies on into decoration, and nothing anywhere would say so. A
 * transport fault is different in kind: the rule is correct, the world is
 * momentarily unreachable, and that is what `strict` is for.
 */
async function runGitValidator(cfg, issueKey, deps) {
  const strict = cfg.strict === true;
  const fail = (msg) => ({ result: false, errorMessage: (cfg.errorMessage && cfg.errorMessage.trim()) || msg });
  const allow = (reason, banner) => ({ result: true, gitReason: reason, ...(banner ? { banner } : {}) });

  const connectionId = typeof cfg.connectionId === "string" ? cfg.connectionId.trim() : "";
  const repo = normalizeRepoId(cfg.repo);
  // Unfinished config → fail OPEN, exactly like `if (!cfg.fieldId) return PASS`.
  if (!connectionId || !repo) return allow("not-configured");

  const getConn = deps.getConnection || getConnection;
  const allowedRepo = deps.isRepoAllowed || isRepoAllowed;
  const makeProvider = deps.providerForConnection || providerForConnection;
  const readProperty = deps.readGitProperty || readGitProperty;

  const conn = await getConn(connectionId);
  if (!conn) {
    return fail("This rule points at a git connection that no longer exists. Re-pick the connection in the rule's configuration.");
  }
  const connLabel = conn.label || conn.id || "the git connection";
  if (!allowedRepo(conn, repo)) {
    // FAIL CLOSED regardless of `strict`: a misconfigured gate must not silently pass.
    return fail(`This rule checks ${repo}, which is not on the allow-list of the git connection “${connLabel}”. Add the repository to that connection, or point the rule at one that is allowed.`);
  }

  // The candidate pull request. The property is the INDEX and never the evidence:
  // it NOMINATES a pull request number, and `prMatch` says which LIVE signal must
  // bind that pull request to THIS issue before any answer is read off it:
  //   "property" — the property may nominate the candidate; the live PR must still
  //                name the issue in its source branch OR its title,
  //   "branch"   — only the LIVE source branch counts,
  //   "both"     — branch OR title (the default; the widest LIVE match).
  // F-362: no mode accepts an unbound candidate. Before this, "property" and "both"
  // took the number on the property's word alone, so anyone with issue-edit could
  // point a "code must be merged" gate at an old merged PR in the same repo and
  // walk through it. The binding is read from the LIVE pull request, never from
  // the property. There is no discovery-by-listing: the adapter has no
  // list-pull-requests method, so an issue whose repo has no property entry has
  // no candidate.
  const prMatch = cfg.prMatch === "property" || cfg.prMatch === "branch" ? cfg.prMatch : "both";
  const prop = issueKey ? await readProperty(issueKey) : null;
  const entry = prop && prop.repos && typeof prop.repos === "object" ? prop.repos[repo] : null;
  const number = entry && entry.pr && entry.pr.number != null ? Number(entry.pr.number) : null;
  // An unbound candidate is NOT a pull request for this issue — it is the same
  // situation as "none found", and it takes the same fail-open/fail-closed answer
  // (the banner tells config-view and the execution log which of the two it was).
  const noPr = (reason, banner) =>
    strict
      ? fail(`No pull request for this issue was found in ${repo}, so this check cannot pass. Open a pull request whose branch or title names ${issueKey || "this issue"}, or turn Strict off on this rule.`)
      : allow(reason || "no-pull-request", banner);
  if (!Number.isFinite(number) || number <= 0) return noPr();

  try {
    const provider = await makeProvider(connectionId, { repo });
    const live = await provider.getPullRequestState({ repo, number });
    const pr = (live && live.pr) || {};
    // THE BINDING CHECK (F-362) — runs in EVERY mode, on the LIVE pull request.
    if (!prIsBoundToIssue(pr, issueKey, prMatch)) return noPr("pr-unbound", "pr_unbound");
    switch (cfg.ruleType) {
      case "git-pr-merged":
        return (live && live.state) === "merged" || pr.state === "merged"
          ? PASS
          : fail(`Pull request #${number} in ${repo} is not merged yet.`);
      case "git-pr-approved":
        if (live && live.changesRequested) return fail(`Pull request #${number} in ${repo} has changes requested.`);
        return live && live.approved ? PASS : fail(`Pull request #${number} in ${repo} has not been approved yet.`);
      case "git-build-passed": {
        const ref = pr.headSha || (entry && entry.pr && entry.pr.headSha) || null;
        if (!ref) return strict ? fail(`The head commit of pull request #${number} in ${repo} could not be read, so the build state is unknown.`) : allow("no-head-sha");
        const build = await provider.getBuildState({ repo, ref });
        const state = (build && build.state) || "none";
        if (state === "success") return PASS;
        if (BUILD_NOT_PASSED.includes(state)) {
          return fail(state === "failed"
            ? `The build on pull request #${number} in ${repo} failed${build && build.name ? ` (${build.name})` : ""}.`
            : `The build on pull request #${number} in ${repo} has not finished yet.`);
        }
        // "none" — no checks reported at all. Not a negative, an absence.
        return strict ? fail(`No build has reported on pull request #${number} in ${repo}.`) : allow("no-checks");
      }
      case "git-pr-comments-resolved": {
        const comments = await provider.listPullRequestComments({ repo, number });
        const rows = Array.isArray(comments) ? comments : [];
        const unresolved = rows.filter((c) => c && c.resolved === false).length;
        if (unresolved > 0) return fail(`Pull request #${number} in ${repo} still has ${unresolved} unresolved review comment${unresolved === 1 ? "" : "s"}.`);
        // F-269: `resolved === null` is NOT PROVEN — GitHub REST cannot answer
        // thread resolution. Never read it as "resolved".
        const unknown = rows.some((c) => c && c.resolved !== true && c.resolved !== false);
        if (unknown) {
          return strict
            ? fail(`Whether the review comments on pull request #${number} in ${repo} are resolved cannot be read from this provider, and this rule is set to Strict.`)
            : allow("resolution-unknown");
        }
        return PASS;
      }
      default:
        return PASS; // unknown git rule type → fail OPEN
    }
  } catch (e) {
    const code = e && e.code;
    // A repo the connection may not read can also surface here (a row edited
    // between our check and the adapter's) — same fail-CLOSED answer.
    if (code === "not_supported" || code === "not_found") {
      return fail(`This rule's git connection “${connLabel}” cannot read ${repo}. Check the connection's repository allow-list.`);
    }
    if (code === "auth_dead") {
      // The credential is dead. The message NAMES the connection and never any
      // part of the token; `banner:"auth_dead"` is what config-view renders.
      return strict
        ? { ...fail(`The git connection “${connLabel}” can no longer sign in, so this check cannot run. An admin must re-connect it.`), banner: "auth_dead" }
        : allow("auth-dead", "auth_dead");
    }
    return strict
      ? { ...fail(`${repo} could not be reached to check this pull request (${code || "error"}).`), banner: "git_unavailable" }
      : allow("provider-unavailable", "git_unavailable");
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
      out = await runValidator(cfg, mf, issueKey, read, opts.gitDeps || opts);
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
      ...(out?.banner ? { banner: out.banner } : {}),
      ...(out?.gitReason ? { why: out.gitReason } : {}),
    })}`);
  } catch { /* best-effort trace */ }
  return out;
}
