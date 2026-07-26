/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// ADVERSARIAL bug-finding suite for CogniRunner PREMADE (non-AI) workflow rules,
// live against wolfaenpak/COGTEST. NOT happy-path: every rule type is exercised
// against an edge-case matrix designed to expose spec-vs-implementation gaps and
// asserted against the EXACT branch logic in src/premade-rules.js.
//
// Two lanes per row:
//   Lane 1  live enforcement (validators): attach ZHARNESS-<i>-<ruleType> self-
//           loops on the hub, PUT the controlled field, READ BACK the stored
//           shape, fire the transition → HTTP 204=allow / >=400=block.
//   Lane 2  direct executor: import executePremadeRule, inject a REST-backed
//           readField (+ actingUser / readUserGroups) → assert result. Covers
//           BOTH validators and conditions (conditions can't fire on REST).
// Lane 2 IS the executor, so a stable Lane-2-vs-spec mismatch is the finding;
// Lane 1 corroborates the live path. Read-back attributes quirk-vs-bug. The whole
// matrix runs 3x; only STABLE deviations count. Findings are documented in
// FINDINGS.md and locked (expectedActual) so the suite stays green + bug visible.
//
//   node test-harness/scripts/premade-adversarial.mjs
//
// Preconditions: results/testbed.json (run setup-testbed.mjs first) and a deployed
// dev app whose validate() has the premade branch (src/index.js ~10901).

import { post, doTransition, getTransitions, getIssue, getMyself } from "../lib/jira.mjs";
import { attachSelfLoopRules } from "../lib/workflow.mjs";
import { loadState, writeResult } from "../lib/state.mjs";
import { executePremadeRule } from "../../src/premade-rules.js";
import {
  detachByNamePrefix, findOrCreateMarkerIssue, ensureAtHub, resetField, readBack,
  restReadUserGroups, transitionToStatus, adfDoc,
} from "../lib/harness-pool.mjs";

const PREFIX = "ZHARNESS";
const OTHER_ID = "999999:00000000-0000-0000-0000-000000000000"; // well-formed, unowned

const s = loadState();
const CF = s.customFields || {};
const PROJECT = s.projectKey;
const HUB = s.hubStatusName;
const TYPE = {
  task: (s.issueTypes.find((t) => t.name === "Task") || {}).id,
  subtask: (s.issueTypes.find((t) => t.subtask) || {}).id,
  bug: (s.issueTypes.find((t) => t.name === "Bug") || {}).id,
};

// ---- date anchors (UTC calendar days, matching premade-rules.js:223-229) ----
const todayUTC = () => { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
const isoDay = (off) => new Date(todayUTC() + off * 86400000).toISOString().slice(0, 10);
const D0 = isoDay(0), D1 = isoDay(1), Dm1 = isoDay(-1), D7 = isoDay(7), D8 = isoDay(8);

// ---- field shorthand (id + write-role) ----
const F = {
  TXT: { id: CF.text?.id, role: "text" },
  SEL: { id: CF.select?.id, role: "select" },
  NUM: { id: CF.number?.id, role: "number" },
  DATE: { id: CF.date?.id, role: "date" },
  DT: { id: CF.datetime?.id, role: "datetime" },
  USER: { id: CF.user?.id, role: "user" },
  MUSER: { id: CF.multiuser?.id, role: "multiuser" },
  MSEL: { id: CF.multiselect?.id, role: "multiselect" },
  CHK: { id: CF.checkboxes?.id, role: "checkboxes" },
  RAD: { id: CF.radio?.id, role: "radio" },
  CASC: { id: CF.cascading?.id, role: "cascading" },
  VER: { id: CF.version?.id, role: "version" },
  PROJ: { id: CF.project?.id, role: "project" },
  LBL: { id: "labels", role: "labels" },
  DESC: { id: "description", role: "adf" },
};
const put = (f, value) => ({ fieldId: f.id, role: f.role, value });

// ===================================================================== pool
async function buildPool() {
  console.log("Building bounded marker pool (find-or-create, never accumulate)...");
  const P = {};
  const mk = async (role, marker, fields = {}) => { P[role] = await findOrCreateMarkerIssue(PROJECT, marker, fields); return P[role]; };

  await mk("PRIMARY", "ZHARNESS-PRIMARY", { issuetype: { id: TYPE.task } });
  await mk("USERHOLDER", "ZHARNESS-USERHOLDER", { issuetype: { id: TYPE.task } });
  await mk("SUB_MIXED", "ZHARNESS-SUBPARENT-MIXED", { issuetype: { id: TYPE.task } });
  await mk("SUB_ALL", "ZHARNESS-SUBPARENT-ALL", { issuetype: { id: TYPE.task } });
  await mk("SUB_NONE", "ZHARNESS-SUBPARENT-NONE", { issuetype: { id: TYPE.task } });
  await mk("PS_PARENT", "ZHARNESS-PS-PARENT", { issuetype: { id: TYPE.task } });
  await mk("ATTACH", "ZHARNESS-ATTACH", { issuetype: { id: TYPE.task } });
  await mk("NOATTACH", "ZHARNESS-NOATTACH", { issuetype: { id: TYPE.task } });
  await mk("LINK_RESOLVED", "ZHARNESS-LINK-RESOLVED", { issuetype: { id: TYPE.task } });
  await mk("LINK_OPEN", "ZHARNESS-LINK-OPEN", { issuetype: { id: TYPE.task } });
  await mk("LINK_TGT_DONE", "ZHARNESS-LINK-TGT-DONE", { issuetype: { id: TYPE.task } });
  await mk("LINK_TGT_OPEN", "ZHARNESS-LINK-TGT-OPEN", { issuetype: { id: TYPE.task } });
  await mk("RESOLVED", "ZHARNESS-RESOLVED", { issuetype: { id: TYPE.task } });
  await mk("TYPE_BUG", "ZHARNESS-TYPE-BUG", { issuetype: { id: TYPE.bug } });
  try { await mk("PRIO_HIGHEST", "ZHARNESS-PRIO-HIGHEST", { issuetype: { id: TYPE.task }, priority: { name: "Highest" } }); }
  catch (e) { console.log(`  (PRIO_HIGHEST not creatable with priority: ${e.message})`); }

  // me + group context
  const me = (await getMyself()).accountId;
  let myGroups = [];
  try { myGroups = await restReadUserGroups(me); } catch { /* ignore */ }
  const showGroup = myGroups.find((g) => g === (CF.group?.group)) || myGroups[0] || "jira-administrators";
  const hideGroup = "zzz-harness-nonexistent-group";

  // ---- structural invariants (idempotent: build only if absent) ----
  const childrenOf = async (key) => (await getIssue(key, "subtasks")).fields?.subtasks || [];
  const ensureSubtask = async (parentKey, marker, done) => {
    const existing = await childrenOf(parentKey);
    let childKey = existing.find((c) => c.fields?.summary === marker)?.key;
    if (!childKey) {
      const r = await post("/rest/api/3/issue", { fields: { project: { key: PROJECT }, issuetype: { id: TYPE.subtask }, parent: { key: parentKey }, summary: marker } });
      childKey = r.key;
    }
    const st = (await getIssue(childKey, "status")).fields?.status?.statusCategory?.key;
    if (done && st !== "done") await transitionToStatus(childKey, "Done").catch((e) => console.log(`  (subtask->Done ${childKey}: ${e.message})`));
    return childKey;
  };

  await ensureSubtask(P.SUB_MIXED, "ZHARNESS-SUB-MIXED-DONE", true);
  await ensureSubtask(P.SUB_MIXED, "ZHARNESS-SUB-MIXED-OPEN", false);
  await ensureSubtask(P.SUB_ALL, "ZHARNESS-SUB-ALL-DONE", true);
  await ensureSubtask(P.PS_PARENT, "ZHARNESS-PS-CHILD", false).then((k) => { P.PS_CHILD = k; });

  // resolved fixtures
  const ensureResolved = async (key) => {
    const st = (await getIssue(key, "status")).fields?.status?.statusCategory?.key;
    if (st !== "done") await transitionToStatus(key, "Done").catch((e) => console.log(`  (resolve ${key}: ${e.message})`));
  };
  await ensureResolved(P.RESOLVED);
  await ensureResolved(P.LINK_TGT_DONE);

  // links (Blocks): LINK_RESOLVED -> LINK_TGT_DONE ; LINK_OPEN -> LINK_TGT_OPEN
  const ensureLink = async (fromKey, toKey) => {
    const links = (await getIssue(fromKey, "issuelinks")).fields?.issuelinks || [];
    const has = links.some((l) => (l.inwardIssue?.key === toKey || l.outwardIssue?.key === toKey));
    if (!has) await post("/rest/api/3/issueLink", { type: { name: "Blocks" }, inwardIssue: { key: fromKey }, outwardIssue: { key: toKey } }).catch((e) => console.log(`  (link ${fromKey}->${toKey}: ${e.message})`));
  };
  await ensureLink(P.LINK_RESOLVED, P.LINK_TGT_DONE);
  await ensureLink(P.LINK_OPEN, P.LINK_TGT_OPEN);

  // attachment on ATTACH
  const atts = (await getIssue(P.ATTACH, "attachment")).fields?.attachment || [];
  if (atts.length === 0) {
    try {
      const env = (await import("../lib/env.mjs")).loadEnv();
      const base = env.JIRA_BASE_URL.replace(/\/$/, "");
      const auth = "Basic " + Buffer.from(`${env.JIRA_ADMIN_EMAIL}:${env.JIRA_API_TOKEN}`).toString("base64");
      const fd = new FormData();
      fd.append("file", new Blob(["adversarial harness attachment"], { type: "text/plain" }), "zharness.txt");
      const r = await fetch(`${base}/rest/api/3/issue/${P.ATTACH}/attachments`, { method: "POST", headers: { Authorization: auth, "X-Atlassian-Token": "no-check", Accept: "application/json" }, body: fd });
      if (!r.ok) throw new Error(`${r.status}`);
    } catch (e) { console.log(`  (attachment upload failed: ${e.message}) — attachment pass-rows will be skipped`); }
  }

  // assignee on USERHOLDER = me (reporter is already me as creator)
  await resetField(P.USERHOLDER, "assignee", { accountId: me }, "assignee").catch((e) => console.log(`  (set assignee: ${e.message})`));

  // keep the Lane-1 fixtures parked at the hub
  for (const role of ["PRIMARY", "SUB_MIXED", "SUB_ALL", "SUB_NONE", "ATTACH", "NOATTACH"]) {
    await ensureAtHub(P[role], HUB).catch((e) => console.log(`  (ensureAtHub ${role}: ${e.message})`));
  }

  const attachmentOk = ((await getIssue(P.ATTACH, "attachment")).fields?.attachment || []).length > 0;
  console.log(`Pool ready (${Object.keys(P).length} issues). me=${me} showGroup=${showGroup} attachmentOk=${attachmentOk}`);
  return { P, me, showGroup, hideGroup, attachmentOk };
}

// ============================================================ rule matrix
// Row: { rowId, fixture, put?, mf?, actingUser?('self'|'other'|null), expected, why,
//        expectedActual?, findingId?, note? }
// Spec: { id, kind, ruleType, config, valueSource('persisted'|'modified'), rows, liveEnforceable }
function buildRuleSpecs(ctx) {
  const { showGroup, hideGroup, attachmentOk } = ctx;
  const specs = [];
  const V = (id, ruleType, cfg, rows, opts = {}) => specs.push({ id, kind: "validator", ruleType, config: { ruleKind: "premade", ruleType, ...cfg }, valueSource: opts.valueSource || "persisted", liveEnforceable: opts.liveEnforceable !== false, rows });
  const C = (id, ruleType, cfg, rows) => specs.push({ id, kind: "condition", ruleType, config: { ruleKind: "premade", ruleType, ...cfg }, valueSource: "persisted", liveEnforceable: false, rows });
  const r = (rowId, fixture, o) => ({ rowId, fixture, ...o });

  // ---------------------------------------------------------------- VALIDATORS
  V("field-required/text", "field-required", { fieldId: F.TXT.id, fieldName: "Text" }, [
    r("filled", "PRIMARY", { put: put(F.TXT, "a clear value"), expected: "allow", why: "isEmpty false :160" }),
    r("empty-str", "PRIMARY", { put: put(F.TXT, ""), expected: "block", why: 'isEmpty("") :91' }),
    r("null", "PRIMARY", { put: put(F.TXT, null), expected: "block", why: "isEmpty(null) :91" }),
    r("whitespace", "PRIMARY", { put: put(F.TXT, "   "), expected: "block", why: "FIXED B1: isEmpty trims strings → '   ' empty :91" }),
  ]);
  V("field-required/desc", "field-required", { fieldId: F.DESC.id, fieldName: "Description" }, [
    r("adf-empty", "PRIMARY", { put: put(F.DESC, adfDoc("")), expected: "block", why: "adfText blank → isEmpty :94" }),
    r("adf-text", "PRIMARY", { put: put(F.DESC, adfDoc("x")), expected: "allow", why: "adfText 'x' :94" }),
    r("adf-ws", "PRIMARY", { put: put(F.DESC, adfDoc("   ")), expected: "block", why: "ADF trims :94 → blank → block" }),
  ]);

  V("field-changed/text", "field-changed", { fieldId: F.TXT.id, fieldName: "Text" }, [
    r("mf-new", "PRIMARY", { mf: { [F.TXT.id]: "new" }, expected: "allow", why: "in mf & !empty :162" }),
    r("mf-empty", "PRIMARY", { mf: { [F.TXT.id]: "" }, expected: "block", why: "isEmpty mf :162" }),
    r("mf-absent", "PRIMARY", { put: put(F.TXT, "persisted"), expected: "block", why: "not in mf → block :162 (persisted presence never satisfies)" }),
  ], { valueSource: "modified", liveEnforceable: false });

  V("field-comparison/num-gte5", "field-comparison", { fieldId: F.NUM.id, fieldName: "Number", op: "gte", compareValue: "5" }, [
    r("eq5", "PRIMARY", { put: put(F.NUM, 5), expected: "allow", why: "5>=5 :180" }),
    r("4", "PRIMARY", { put: put(F.NUM, 4), expected: "block", why: "4>=5 false" }),
    r("empty", "PRIMARY", { put: put(F.NUM, null), expected: "allow", why: "isEmpty → PASS :166" }),
  ]);
  V("field-comparison/num-gt5", "field-comparison", { fieldId: F.NUM.id, fieldName: "Number", op: "gt", compareValue: "5" }, [
    r("eq5", "PRIMARY", { put: put(F.NUM, 5), expected: "block", why: "5>5 false :180" }),
    r("6", "PRIMARY", { put: put(F.NUM, 6), expected: "allow", why: "6>5" }),
  ]);
  V("field-comparison/num-lte5", "field-comparison", { fieldId: F.NUM.id, fieldName: "Number", op: "lte", compareValue: "5" }, [
    r("eq5", "PRIMARY", { put: put(F.NUM, 5), expected: "allow", why: "5<=5" }),
    r("6", "PRIMARY", { put: put(F.NUM, 6), expected: "block", why: "6<=5 false" }),
  ]);
  V("field-comparison/num-eq5", "field-comparison", { fieldId: F.NUM.id, fieldName: "Number", op: "eq", compareValue: "5" }, [
    r("5", "PRIMARY", { put: put(F.NUM, 5), expected: "allow", why: "5===5 :190" }),
    r("5.00", "PRIMARY", { put: put(F.NUM, 5), expected: "allow", why: "numeric coercion 5===5 even vs '5'", note: "number field stores 5" }),
  ]);
  V("field-comparison/num-gt-text", "field-comparison", { fieldId: F.SEL.id, fieldName: "Select", op: "gt", compareValue: "5" }, [
    r("high", "PRIMARY", { put: put(F.SEL, "High"), expected: "allow", why: "non-numeric gt → fail-open :185" }),
  ]);
  V("field-comparison/date-gt", "field-comparison", { fieldId: F.DATE.id, fieldName: "Date", op: "gt", compareValue: "2026-01-01" }, [
    r("after", "PRIMARY", { put: put(F.DATE, "2026-07-01"), expected: "allow", why: "ISO date da>db :182" }),
    r("before", "PRIMARY", { put: put(F.DATE, "2025-01-01"), expected: "block", why: "da>db false" }),
  ]);
  V("field-comparison/date-gte-eq", "field-comparison", { fieldId: F.DATE.id, fieldName: "Date", op: "gte", compareValue: "2026-07-01" }, [
    r("equal", "PRIMARY", { put: put(F.DATE, "2026-07-01"), expected: "allow", why: "da>=db equal :183" }),
  ]);
  V("field-comparison/contains", "field-comparison", { fieldId: F.TXT.id, fieldName: "Text", op: "contains", compareValue: "world" }, [
    r("hit", "PRIMARY", { put: put(F.TXT, "Hello World"), expected: "allow", why: "norm includes :189 (ci)" }),
    r("miss", "PRIMARY", { put: put(F.TXT, "nope"), expected: "block", why: "no substring" }),
  ]);
  V("field-comparison/eq-select-ci", "field-comparison", { fieldId: F.SEL.id, fieldName: "Select", op: "eq", compareValue: "high" }, [
    r("ci", "PRIMARY", { put: put(F.SEL, "High"), expected: "allow", why: "norm ci eq :190" }),
  ]);
  V("field-comparison/eq-multi-some", "field-comparison", { fieldId: F.MSEL.id, fieldName: "Multi", op: "eq", compareValue: "Backend" }, [
    r("some", "PRIMARY", { put: put(F.MSEL, ["Backend", "Security"]), expected: "allow", why: "parts.some eq :190 (array-aware, intentional per code comment)" }),
  ]);

  V("field-regex/text", "field-regex", { fieldId: F.TXT.id, fieldName: "Text", regex: "^[A-Z]{3}-\\d+$" }, [
    r("match", "PRIMARY", { put: put(F.TXT, "ABC-12"), expected: "allow", why: "re.test :196" }),
    r("nomatch", "PRIMARY", { put: put(F.TXT, "abc"), expected: "block", why: "no match" }),
    r("empty", "PRIMARY", { put: put(F.TXT, ""), expected: "allow", why: "isEmpty → PASS :194" }),
    r("whitespace", "PRIMARY", { put: put(F.TXT, "   "), expected: "allow", why: "FIXED B1 cross-effect: isEmpty('   ') now true → regex skips empty (PASS) :194" }),
  ]);
  V("field-regex/bad", "field-regex", { fieldId: F.TXT.id, fieldName: "Text", regex: "[" }, [
    r("badpat", "PRIMARY", { put: put(F.TXT, "anything"), expected: "allow", why: "RegExp throws → fail-open :195" }),
  ]);
  V("field-regex/empty-pat", "field-regex", { fieldId: F.TXT.id, fieldName: "Text", regex: "" }, [
    r("matchall", "PRIMARY", { put: put(F.TXT, "anything"), expected: "allow", why: "new RegExp('') matches all" }),
  ]);

  V("allowed-values/select-ci", "allowed-values", { fieldId: F.SEL.id, fieldName: "Select", allowedValues: "low, medium, high" }, [
    r("ci", "PRIMARY", { put: put(F.SEL, "High"), expected: "allow", why: "norm ci every :203" }),
    r("not", "PRIMARY", { put: put(F.SEL, "Security"), expected: "block", why: "Security not in list" }),
    r("empty", "PRIMARY", { put: put(F.SEL, null), expected: "allow", why: "isEmpty → PASS :200" }),
  ]);
  V("allowed-values/multi-every", "allowed-values", { fieldId: F.MSEL.id, fieldName: "Multi", allowedValues: "Backend, Frontend" }, [
    r("partial", "PRIMARY", { put: put(F.MSEL, ["Backend", "Security"]), expected: "block", why: ".every — Security not allowed :203" }),
    r("subset", "PRIMARY", { put: put(F.MSEL, ["Backend"]), expected: "allow", why: "every passes" }),
  ]);
  V("allowed-values/empty-list", "allowed-values", { fieldId: F.SEL.id, fieldName: "Select", allowedValues: "" }, [
    r("any", "PRIMARY", { put: put(F.SEL, "High"), expected: "allow", why: "!allowed.length → PASS :200" }),
  ]);

  V("text-length/min5", "text-length", { fieldId: F.TXT.id, fieldName: "Text", min: "5", max: "" }, [
    r("eq5", "PRIMARY", { put: put(F.TXT, "abcde"), expected: "allow", why: "len5 !<5 :216" }),
    r("4", "PRIMARY", { put: put(F.TXT, "abcd"), expected: "block", why: "4<5" }),
  ]);
  V("text-length/max5", "text-length", { fieldId: F.TXT.id, fieldName: "Text", min: "", max: "5" }, [
    r("eq5", "PRIMARY", { put: put(F.TXT, "abcde"), expected: "allow", why: "len5 !>5 :217" }),
    r("6", "PRIMARY", { put: put(F.TXT, "abcdef"), expected: "block", why: "6>5" }),
  ]);
  V("text-length/max1-emoji", "text-length", { fieldId: F.TXT.id, fieldName: "Text", min: "", max: "1" }, [
    r("emoji", "PRIMARY", { put: put(F.TXT, "😀"), expected: "allow", why: "FIXED B2: [...text].length counts code points → emoji=1 :212" }),
  ]);
  V("text-length/nogate", "text-length", { fieldId: F.TXT.id, fieldName: "Text", min: "", max: "" }, [
    r("any", "PRIMARY", { put: put(F.TXT, "whatever length"), expected: "allow", why: "hasMin/hasMax false :214" }),
  ]);
  V("text-length/nonstring", "text-length", { fieldId: F.NUM.id, fieldName: "Number", min: "3", max: "" }, [
    r("number", "PRIMARY", { put: put(F.NUM, 12), expected: "allow", why: "non-string/doc → fail-open :211 (silent no-op on misconfig)" }),
  ]);

  V("date-relative/future", "date-relative", { fieldId: F.DATE.id, fieldName: "Date", mode: "future" }, [
    r("today", "PRIMARY", { put: put(F.DATE, D0), expected: "block", why: "target===now not >now :235 (strict)" }),
    r("tomorrow", "PRIMARY", { put: put(F.DATE, D1), expected: "allow", why: "future" }),
    r("yesterday", "PRIMARY", { put: put(F.DATE, Dm1), expected: "block", why: "past" }),
    r("empty", "PRIMARY", { put: put(F.DATE, null), expected: "allow", why: "unset → PASS :221" }),
  ]);
  V("date-relative/within7", "date-relative", { fieldId: F.DATE.id, fieldName: "Date", mode: "within", days: "7" }, [
    r("plus7", "PRIMARY", { put: put(F.DATE, D7), expected: "allow", why: "<=now+7d inclusive :233" }),
    r("plus8", "PRIMARY", { put: put(F.DATE, D8), expected: "block", why: ">now+7d" }),
    r("today", "PRIMARY", { put: put(F.DATE, D0), expected: "allow", why: ">=now inclusive" }),
    r("yesterday", "PRIMARY", { put: put(F.DATE, Dm1), expected: "block", why: "<now" }),
  ]);
  V("date-relative/within-blank", "date-relative", { fieldId: F.DATE.id, fieldName: "Date", mode: "within", days: "" }, [
    r("far", "PRIMARY", { put: put(F.DATE, isoDay(999)), expected: "allow", why: "blank days → NaN → PASS :232" }),
  ]);

  V("field-cardinality/min1", "field-cardinality", { fieldId: F.MSEL.id, fieldName: "Multi", min: "1", max: "" }, [
    r("one", "PRIMARY", { put: put(F.MSEL, ["Backend"]), expected: "allow", why: "cnt1>=1 :244" }),
    r("zero", "PRIMARY", { put: put(F.MSEL, null), expected: "block", why: "cnt0<1" }),
  ]);
  V("field-cardinality/max2", "field-cardinality", { fieldId: F.MSEL.id, fieldName: "Multi", min: "", max: "2" }, [
    r("three", "PRIMARY", { put: put(F.MSEL, ["Backend", "Frontend", "Infra"]), expected: "block", why: "cnt3>2 :245" }),
    r("two", "PRIMARY", { put: put(F.MSEL, ["Backend", "Frontend"]), expected: "allow", why: "cnt2!>2" }),
  ]);
  V("field-cardinality/exactly1", "field-cardinality", { fieldId: F.SEL.id, fieldName: "Select", min: "1", max: "1" }, [
    r("single", "PRIMARY", { put: put(F.SEL, "High"), expected: "allow", why: "[v] cnt1 in [1,1] :240" }),
    r("cleared", "PRIMARY", { put: put(F.SEL, null), expected: "block", why: "[] cnt0<1" }),
  ]);

  V("sub-tasks-resolved", "sub-tasks-resolved", {}, [
    r("mixed", "SUB_MIXED", { expected: "block", why: "1 open subtask :130" }),
    r("all-done", "SUB_ALL", { expected: "allow", why: "0 open :130" }),
    r("none", "SUB_NONE", { expected: "allow", why: "no subtasks → PASS :128" }),
  ]);
  V("attachment-required", "attachment-required", {}, [
    r("none", "NOATTACH", { expected: "block", why: "0 attachments :135" }),
    ...(attachmentOk ? [r("has", "ATTACH", { expected: "allow", why: ">=1 attachment :135" })] : []),
  ]);

  // comment-required: modifiedFields.comment, Lane-2-authoritative (screenless self-loop).
  V("comment-required", "comment-required", {}, [
    r("text", "PRIMARY", { mf: { comment: "looks good" }, expected: "allow", why: "trim!='' :148" }),
    r("adf", "PRIMARY", { mf: { comment: adfDoc("ok") }, expected: "allow", why: "adfText :143" }),
    r("empty", "PRIMARY", { mf: { comment: "" }, expected: "block", why: "trim '' :145" }),
    r("whitespace", "PRIMARY", { mf: { comment: "   " }, expected: "block", why: "comment-required DOES trim :145" }),
    r("absent", "PRIMARY", { mf: {}, expected: "block", why: "no comment → '' → block :145" }),
  ], { valueSource: "modified", liveEnforceable: false });
  V("comment-required/min10", "comment-required", { minLen: "10" }, [
    r("nine", "PRIMARY", { mf: { comment: "123456789" }, expected: "block", why: "9<10 :147" }),
    r("ten", "PRIMARY", { mf: { comment: "1234567890" }, expected: "allow", why: "10!<10 inclusive" }),
  ], { valueSource: "modified", liveEnforceable: false });

  // ---------------------------------------------------------------- CONDITIONS
  C("field-has-value", "field-has-value", { fieldId: F.TXT.id }, [
    r("set", "PRIMARY", { put: put(F.TXT, "x"), expected: "show", why: "!isEmpty :264" }),
    r("cleared", "PRIMARY", { put: put(F.TXT, null), expected: "hide", why: "isEmpty" }),
    r("whitespace", "PRIMARY", { put: put(F.TXT, "   "), expected: "hide", why: "FIXED B1: isEmpty trims → '   ' empty → hide :264" }),
  ]);
  C("field-empty", "field-empty", { fieldId: F.TXT.id }, [
    r("cleared", "PRIMARY", { put: put(F.TXT, null), expected: "show", why: "isEmpty :268" }),
    r("set", "PRIMARY", { put: put(F.TXT, "x"), expected: "hide", why: "not empty" }),
  ]);
  C("field-equals/select", "field-equals", { fieldId: F.SEL.id, value: "high" }, [
    r("match", "PRIMARY", { put: put(F.SEL, "High"), expected: "show", why: "norm ci eq :272" }),
    r("no", "PRIMARY", { put: put(F.SEL, "Low"), expected: "hide", why: "≠" }),
  ]);
  C("field-equals/num", "field-equals", { fieldId: F.NUM.id, value: "5.0" }, [
    r("numeric", "PRIMARY", { put: put(F.NUM, 5), expected: "show", why: "FIXED B3: numeric coercion → 5 == 5.0 :272" }),
  ]);
  C("field-equals/multi", "field-equals", { fieldId: F.MSEL.id, value: "Backend" }, [
    r("joined", "PRIMARY", { put: put(F.MSEL, ["Backend", "Security"]), expected: "hide", why: "fieldText joins → 'Backend, Security' ≠ 'Backend' :272 (≠ field-comparison .some)" }),
  ]);
  C("issue-type-is", "issue-type-is", { issueTypeName: "Bug" }, [
    r("bug", "TYPE_BUG", { expected: "show", why: "norm name eq :277" }),
    r("task", "PRIMARY", { expected: "hide", why: "Task≠Bug" }),
  ]);
  C("has-attachments", "has-attachments", {}, [
    r("none", "NOATTACH", { expected: "hide", why: "0 :281" }),
    ...(attachmentOk ? [r("has", "ATTACH", { expected: "show", why: ">=1" })] : []),
  ]);
  C("issue-is-resolved", "issue-is-resolved", {}, [
    r("resolved", "RESOLVED", { expected: "show", why: "resolution!=null :284" }),
    r("open", "PRIMARY", { expected: "hide", why: "null resolution" }),
  ]);
  C("sub-tasks-all-resolved", "sub-tasks-all-resolved", {}, [
    r("all", "SUB_ALL", { expected: "show", why: "every done :288" }),
    r("mixed", "SUB_MIXED", { expected: "hide", why: "one open" }),
    r("none", "SUB_NONE", { expected: "show", why: "[].every → true" }),
  ]);
  C("parent-status-is/backlog", "parent-status-is", { statusName: "Backlog" }, [
    r("child", "PS_CHILD", { expected: "show", why: "parent status Backlog :294" }),
    r("toplevel", "PRIMARY", { expected: "show", why: "no parent → SHOW (vacuous) :293" }),
  ]);
  C("parent-status-is/done", "parent-status-is", { statusName: "Done" }, [
    r("child", "PS_CHILD", { expected: "hide", why: "parent Backlog ≠ Done" }),
  ]);
  C("resolution-is", "resolution-is", { resolutionName: "Done" }, [
    r("resolved", "RESOLVED", { expected: "show", why: "norm name eq :299" }),
    r("open", "PRIMARY", { expected: "hide", why: "'' ≠ done" }),
  ]);
  C("priority-is", "priority-is", { priorityName: "Highest" }, [
    ...(ctx.P.PRIO_HIGHEST ? [r("highest", "PRIO_HIGHEST", { expected: "show", why: "norm eq :304" })] : []),
    r("default", "PRIMARY", { expected: "hide", why: "≠ Highest" }),
  ]);
  C("linked-issue-resolved/any", "linked-issue-resolved", {}, [
    r("resolved", "LINK_RESOLVED", { expected: "show", why: "every done :310" }),
    r("open", "LINK_OPEN", { expected: "hide", why: "link target open" }),
    r("none", "PRIMARY", { expected: "show", why: "[].every → SHOW" }),
  ]);
  C("linked-issue-resolved/typed", "linked-issue-resolved", { linkTypeName: "Cloners" }, [
    r("nomatch-type", "LINK_OPEN", { expected: "show", why: "filter to absent type → [].every → SHOW (vacuous) :311" }),
  ]);

  // acting-user conditions (Lane 2; inject actingUser)
  C("current-user-is-assignee", "current-user-is-assignee", {}, [
    r("self", "USERHOLDER", { actingUser: "self", expected: "show", why: "accountId eq :318" }),
    r("other", "USERHOLDER", { actingUser: "other", expected: "hide", why: "≠" }),
    r("noactor", "USERHOLDER", { actingUser: null, expected: "show", why: "!actingUser → SHOW (fail-open) :316" }),
  ]);
  C("current-user-is-reporter", "current-user-is-reporter", {}, [
    r("self", "USERHOLDER", { actingUser: "self", expected: "show", why: "reporter=creator=me :323" }),
    r("other", "USERHOLDER", { actingUser: "other", expected: "hide", why: "≠" }),
  ]);
  C("user-in-field/single", "user-in-field", { fieldId: F.USER.id }, [
    r("self", "PRIMARY", { put: put(F.USER, ctx.me), actingUser: "self", expected: "show", why: "u.accountId eq :328" }),
    r("other", "PRIMARY", { put: put(F.USER, ctx.me), actingUser: "other", expected: "hide", why: "≠" }),
    r("cleared", "PRIMARY", { put: put(F.USER, null), actingUser: "self", expected: "hide", why: "u null ≠ me" }),
  ]);
  C("user-in-field/multi", "user-in-field", { fieldId: F.MUSER.id }, [
    r("multi", "PRIMARY", { put: put(F.MUSER, [{ accountId: ctx.me }]), actingUser: "self", expected: "show", why: "FIXED F-UIF1: multi-user array now matches any member :325-331" }),
  ]);
  C("user-in-group", "user-in-group", { groupName: showGroup }, [
    r("member", "PRIMARY", { actingUser: "self", expected: "show", why: "some norm eq :333" }),
    r("noactor", "PRIMARY", { actingUser: null, expected: "show", why: "!actingUser → SHOW :331" }),
  ]);
  C("user-in-group/nonmember", "user-in-group", { groupName: hideGroup }, [
    r("nonmember", "PRIMARY", { actingUser: "self", expected: "hide", why: "not in group → some false :333" }),
  ]);

  return specs;
}

// ============================================================ lane engine
const toBool = (v) => v === "allow" || v === "show";
const vWord = (kind, b) => (kind === "condition" ? (b ? "show" : "hide") : (b ? "allow" : "block"));

const restReadField = async (issueKey, fieldId) => (await getIssue(issueKey, encodeURIComponent(fieldId))).fields?.[fieldId];

async function evalLane2(spec, row, fixtureKey, ctx) {
  const actingUser = row.actingUser === "self" ? ctx.me : row.actingUser === "other" ? OTHER_ID : undefined;
  const args = { issue: { key: fixtureKey }, modifiedFields: row.mf || {} };
  const opts = { readField: restReadField, actingUser, readUserGroups: restReadUserGroups };
  const out = await executePremadeRule(spec.config, args, spec.kind, opts);
  return vWord(spec.kind, out?.result !== false);
}

async function fireLane1(tName, fixtureKey) {
  const tr = await getTransitions(fixtureKey);
  const t = (tr.transitions || []).find((x) => x.name === tName);
  if (!t) return { lane1: "NA", status: null, reason: "transition not listed" };
  const res = await doTransition(fixtureKey, t.id);
  let reason = "";
  try { const j = JSON.parse(res.text || "{}"); reason = (j.errorMessages || []).join(" | ") || JSON.stringify(j.errors || {}); }
  catch { reason = (res.text || "").slice(0, 160); }
  return { lane1: res.status >= 400 ? "block" : "allow", status: res.status, reason };
}

async function runOnce(specs, ctx, tNames) {
  const out = [];
  for (const spec of specs) {
    for (const row of spec.rows) {
      const fixtureKey = ctx.P[row.fixture];
      if (!fixtureKey) { out.push({ specId: spec.id, rowId: row.rowId, skipped: "no fixture" }); continue; }
      // state setup (serialized — many rows share PRIMARY)
      let stored;
      if (row.put) {
        await resetField(fixtureKey, row.put.fieldId, row.put.value, row.put.role);
        stored = await readBack(fixtureKey, row.put.fieldId);
      }
      const lane2 = await evalLane2(spec, row, fixtureKey, ctx);
      let lane1 = null, l1 = null;
      if (spec.kind === "validator" && spec.liveEnforceable && tNames[spec.id]) {
        l1 = await fireLane1(tNames[spec.id], fixtureKey);
        lane1 = l1.lane1;
      }
      out.push({
        specId: spec.id, rowId: row.rowId, kind: spec.kind, ruleType: spec.ruleType,
        fixture: row.fixture, expected: row.expected, expectedActual: row.expectedActual || null,
        findingId: row.findingId || null, note: row.note || null,
        lane1, lane2, status: l1?.status ?? null, reason: l1?.reason || null,
        stored: stored === undefined ? null : summarizeStored(stored),
      });
    }
  }
  return out;
}

function summarizeStored(v) {
  try { const s = JSON.stringify(v); return s && s.length > 200 ? s.slice(0, 200) + "…" : s; } catch { return String(v); }
}

// ============================================================ analysis
function classifyRow(runs) {
  // runs: array of 3 row-result objects for the same (specId,rowId)
  const key = (rr) => `${rr.lane1}|${rr.lane2}`;
  const stable = runs.every((rr) => key(rr) === key(runs[0]));
  const rr = runs[0];
  const expBool = toBool(rr.expected);
  const lane2Bool = toBool(rr.lane2);
  const lane1Bool = rr.lane1 == null || rr.lane1 === "NA" ? null : toBool(rr.lane1);
  const laneDivergence = lane1Bool != null && lane1Bool !== lane2Bool;
  const deviatesFromSpec = lane2Bool !== expBool; // executor vs spec-intent
  // Gate on the executor lane (truth). Locked rows assert ACTUAL behavior.
  const target = rr.expectedActual ? toBool(rr.expectedActual) : expBool;
  const gatePass = lane2Bool === target;
  return { stable, deviatesFromSpec, laneDivergence, lane1Bool, lane2Bool, expBool, target, gatePass, locked: !!rr.expectedActual };
}

async function main() {
  if (!s.workflowName) throw new Error("Run setup-testbed.mjs first (no workflowName in testbed.json).");
  console.log(`=== Premade Adversarial Suite — ${PROJECT} @ ${s.workflowName} ===\n`);

  const removed = await detachByNamePrefix(s.workflowName, PREFIX);
  if (removed) console.log(`Detached ${removed} leftover ${PREFIX} transition(s).`);

  const poolCtx = await buildPool();
  const ctx = { ...poolCtx };
  const specs = buildRuleSpecs(ctx);

  // attach live-enforceable validators
  const liveSpecs = specs.filter((sp) => sp.kind === "validator" && sp.liveEnforceable);
  const attachSpecs = liveSpecs.map((sp, i) => ({ name: `${PREFIX}-${i}-${sp.ruleType}`, type: "validator", config: sp.config }));
  const tNames = {};
  liveSpecs.forEach((sp, i) => { tNames[sp.id] = `${PREFIX}-${i}-${sp.ruleType}`; });
  console.log(`Attaching ${attachSpecs.length} live validator self-loops...`);
  await attachSelfLoopRules(s.workflowName, s.hubStatusRef, attachSpecs, 9301);
  await new Promise((res) => setTimeout(res, 2500));

  const rowCount = specs.reduce((n, sp) => n + sp.rows.length, 0);
  console.log(`Matrix: ${specs.length} rule-specs, ${rowCount} rows. Running 3× (flakiness gate)...\n`);

  const runs = [];
  try {
    for (let i = 0; i < 3; i++) {
      console.log(`--- run ${i + 1}/3 ---`);
      runs.push(await runOnce(specs, ctx, tNames));
    }
  } finally {
    const r2 = await detachByNamePrefix(s.workflowName, PREFIX);
    console.log(`\nTeardown: detached ${r2} ${PREFIX} transition(s).`);
  }

  // group by specId+rowId across runs
  const byRow = new Map();
  for (let i = 0; i < runs.length; i++) {
    for (const rr of runs[i]) {
      const k = `${rr.specId}::${rr.rowId}`;
      if (!byRow.has(k)) byRow.set(k, []);
      byRow.get(k)[i] = rr;
    }
  }

  const stability = [], findings = [], deviations = [], brokenLocks = [], flaky = [], laneDiv = [], locked = [];
  let gateFail = 0;
  for (const [k, group] of byRow) {
    if (group.some((g) => !g || g.skipped)) continue;
    const c = classifyRow(group);
    const head = group[0];
    const rec = { key: k, specId: head.specId, rowId: head.rowId, kind: head.kind, expected: head.expected, expectedActual: head.expectedActual, findingId: head.findingId, note: head.note, lane1: head.lane1, lane2: head.lane2, status: head.status, reason: head.reason, stored: head.stored, ...c };
    stability.push(rec);
    if (!c.stable) { flaky.push(rec); continue; }
    if (c.laneDivergence) laneDiv.push(rec);
    if (c.locked) locked.push(rec);
    if (!c.gatePass) {
      // executor lane disagrees with the asserted target
      if (c.locked) { brokenLocks.push(rec); gateFail++; }     // expectedActual was wrong
      else { deviations.push(rec); gateFail++; }                // new, un-triaged deviation
    } else if (c.locked && c.deviatesFromSpec) {
      findings.push(rec);                                       // locked finding: green but visible
    }
  }

  // ---- report ----
  console.log(`\n===== RESULTS =====`);
  const stablePass = stability.filter((x) => x.stable && x.gatePass).length;
  console.log(`Rows: ${stability.length} | stable-pass: ${stablePass} | locked findings: ${findings.length} | NEW deviations: ${deviations.length} | flaky: ${flaky.length} | lane-divergences: ${laneDiv.length}`);

  if (findings.length) {
    console.log(`\n🔎 LOCKED FINDINGS (green-but-visible):`);
    for (const f of findings) console.log(`  🔎 ${f.findingId} ${f.specId}/${f.rowId}: asserting ACTUAL=${f.expectedActual}, spec wanted=${f.expected}`);
  }
  if (deviations.length) {
    console.log(`\n❌ NEW STABLE DEVIATIONS (triage → attribute → lock/fix):`);
    for (const d of deviations) console.log(`  ✗ ${d.specId}/${d.rowId}: expected ${d.expected}, lane2=${d.lane2}${d.lane1 ? ` lane1=${d.lane1}` : ""} | stored=${d.stored}${d.reason ? " | " + d.reason : ""}`);
  }
  if (brokenLocks.length) {
    console.log(`\n🔧 BROKEN LOCKS (expectedActual no longer matches — re-triage):`);
    for (const d of brokenLocks) console.log(`  🔧 ${d.findingId} ${d.specId}/${d.rowId}: expectedActual=${d.expectedActual} but lane2=${d.lane2}`);
  }
  if (laneDiv.length) {
    console.log(`\n⚠️  LANE DIVERGENCES (live≠executor → deploy skew / wiring):`);
    for (const d of laneDiv) console.log(`  ⚠ ${d.specId}/${d.rowId}: lane1=${d.lane1} lane2=${d.lane2} (HTTP ${d.status ?? "?"})`);
  }
  if (flaky.length) {
    console.log(`\n🌀 FLAKY (non-deterministic across 3×):`);
    for (const f of flaky) console.log(`  🌀 ${f.specId}/${f.rowId}: ${f.key}`);
  }

  writeResult("premade-adversarial.json", {
    at: new Date().toISOString(), workflowName: s.workflowName, project: PROJECT, me: ctx.me,
    pool: ctx.P, counts: { rows: stability.length, stablePass, findings: findings.length, deviations: deviations.length, brokenLocks: brokenLocks.length, flaky: flaky.length, laneDivergences: laneDiv.length },
    runs, stability, findings, deviations, brokenLocks, flaky, laneDivergences: laneDiv, locked,
  });
  console.log(`\nReport -> results/premade-adversarial.json`);

  if (gateFail > 0) { console.log(`\nGATE: ${gateFail} unlocked stable deviation(s) — triage required.`); process.exit(1); }
  console.log(`\nGATE: green (all stable rows assert their target; findings locked & visible).`);
}

main().catch((e) => { console.error("ADVERSARIAL SUITE FAILED:", e.message); if (e.body) console.error(JSON.stringify(e.body, null, 2)); process.exit(1); });
