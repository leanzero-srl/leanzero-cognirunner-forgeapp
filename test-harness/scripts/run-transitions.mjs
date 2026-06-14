/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Drive every (rule x applicable-issue) pair against the live app and score
// black-box. Validators -> fire transition (204 allowed / 4xx blocked, reason
// from errorMessages). Conditions -> visibility via getTransitions. PFs -> fire
// then poll the issue for the expected mutation. Special two-phase agentic gate.

import { get, getIssue, getTransitions, doTransition, mapLimit, sleep } from "../lib/jira.mjs";
import { buildRules } from "../fixtures/rules.mjs";
import { loadState, writeResult } from "../lib/state.mjs";

const CONCURRENCY = parseInt(process.env.RUN_CONCURRENCY || "3", 10);
const MAX_PER_CLASS = parseInt(process.env.RUN_MAX_PER_CLASS || "0", 10); // 0 = unlimited
const POLL_MS = 3000;
const MUTATE_TIMEOUT = 45000;
const SKIP_WAIT = 18000;

function parseReason(text) {
  try {
    const j = JSON.parse(text || "{}");
    const msgs = j.errorMessages || [];
    const errs = j.errors ? Object.values(j.errors) : [];
    return [...msgs, ...errs].join(" | ").slice(0, 300);
  } catch {
    return (text || "").slice(0, 200);
  }
}

function pfFields(state) {
  const ids = Object.values(state.customFields).map((f) => f.id);
  return ["labels", "updated", "comment", "subtasks", "issuelinks", "attachment", ...ids].join(",");
}

// Read the opt-in cogni-debug issue property (set by debugTrace) for runtime
// internals the workflow result can't surface — esp. agentic toolMeta + tokens.
async function readDebugTrace(key) {
  try {
    const r = await get(`/rest/api/3/issue/${key}/properties/cogni-debug`);
    return r?.value || null;
  } catch {
    return null;
  }
}

async function runValidator(rule, tid, issue) {
  const t0 = Date.now();
  const res = await doTransition(issue.key, tid);
  const latencyMs = Date.now() - t0;
  const blocked = res.status >= 400;
  const actual = blocked ? "BLOCKED" : "ALLOWED";
  const expected = rule.expect(issue);
  const reason = blocked ? parseReason(res.text) : "";
  const aiError = /ai\s*(service\s*)?error|service error|timed out|timeout/i.test(reason);
  const out = { kind: "validator", expected, actual, correct: actual === expected, aiError, http: res.status, reason, latencyMs };
  // Agentic observability: pull toolMeta from the debug property if enabled.
  if (rule.config?.enableTools) {
    const trace = await readDebugTrace(issue.key);
    if (trace?.toolMeta) out.toolMeta = trace.toolMeta;
    if (trace && !out.reason) out.reason = String(trace.reason || "").slice(0, 200);
  }
  return out;
}

async function runCondition(rule, tid, issue) {
  const t0 = Date.now();
  const tr = await getTransitions(issue.key);
  const latencyMs = Date.now() - t0;
  const visible = (tr.transitions || []).some((t) => String(t.id) === String(tid));
  const actual = visible ? "VISIBLE" : "HIDDEN";
  const expected = rule.expect(issue);
  return { kind: "condition", expected, actual, correct: actual === expected, http: 200, reason: "", latencyMs };
}

async function runPf(rule, tid, issue, state, fields) {
  const before = await getIssue(issue.key, fields);
  const t0 = Date.now();
  const res = await doTransition(issue.key, tid);
  const transitionHttp = res.status;
  let after = before;
  let a = { pass: false, detail: "" };

  if (rule.expectPf === "MUTATED") {
    const deadline = Date.now() + MUTATE_TIMEOUT;
    do {
      await sleep(POLL_MS);
      after = await getIssue(issue.key, fields);
      a = rule.assert(state, before, after);
      if (a.pass) break;
    } while (Date.now() < deadline);
  } else {
    // SKIPPED: give the PF time to (not) act, then verify unchanged
    await sleep(SKIP_WAIT);
    after = await getIssue(issue.key, fields);
    a = rule.assert(state, before, after);
  }
  const latencyMs = Date.now() - t0;
  return {
    kind: "pf",
    expected: rule.expectPf,
    actual: a.pass ? rule.expectPf : (rule.expectPf === "MUTATED" ? "NOT_MUTATED" : "UNEXPECTED_MUTATION"),
    correct: a.pass,
    http: transitionHttp,
    reason: a.detail,
    latencyMs,
  };
}

async function runCase(c, state, fields) {
  const base = { ruleKey: c.rule.key, ruleName: c.rule.name, type: c.rule.type, study: c.rule.study, issueId: c.issueId, issueKey: c.issue.key, cls: c.issue.cls };
  try {
    let r;
    if (c.rule.type === "validator") r = await runValidator(c.rule, c.tid, c.issue);
    else if (c.rule.type === "condition") r = await runCondition(c.rule, c.tid, c.issue);
    else r = await runPf(c.rule, c.tid, c.issue, state, fields);
    return { ...base, ...r };
  } catch (e) {
    return { ...base, kind: "error", correct: false, error: e.message.slice(0, 200) };
  }
}

async function twoPhaseGate(rule, tid, state) {
  // Phase 1: fire on GATE-STORY -> expect BLOCKED (GATE-BUG-4 open)
  const story = Object.entries(state.issues).find(([id]) => id === "GATE-STORY")?.[1];
  const bug4 = Object.entries(state.issues).find(([id]) => id === "GATE-BUG-4")?.[1];
  if (!story) return [];
  const out = [];
  // Ensure GATE-BUG-4 is OPEN before phase 1 (earlier runs may have closed it),
  // so the block→allow transition is actually exercised.
  if (bug4) {
    const tr0 = await getTransitions(bug4.key);
    const reopen = (tr0.transitions || []).find((t) => /backlog|to do|open|in progress/i.test(t.name));
    if (reopen) { await doTransition(bug4.key, reopen.id); await sleep(4000); }
  }
  const p1 = await doTransition(story.key, tid);
  out.push({ ruleKey: rule.key, ruleName: rule.name, type: "validator", study: "agentic", issueId: "GATE-STORY", issueKey: story.key, cls: "agentic-gate", kind: "validator", phase: "open-bug", expected: "BLOCKED", actual: p1.status >= 400 ? "BLOCKED" : "ALLOWED", correct: p1.status >= 400, http: p1.status, reason: p1.status >= 400 ? parseReason(p1.text) : "" });

  // Phase 2: close GATE-BUG-4, then re-fire -> expect ALLOWED
  if (bug4) {
    const tr = await getTransitions(bug4.key);
    const done = (tr.transitions || []).find((t) => /done/i.test(t.name));
    if (done) await doTransition(bug4.key, done.id);
    await sleep(4000); // let the index settle for JQL
    const p2 = await doTransition(story.key, tid);
    out.push({ ruleKey: rule.key, ruleName: rule.name, type: "validator", study: "agentic", issueId: "GATE-STORY", issueKey: story.key, cls: "agentic-gate", kind: "validator", phase: "bug-closed", expected: "ALLOWED", actual: p2.status >= 400 ? "BLOCKED" : "ALLOWED", correct: p2.status < 400, http: p2.status, reason: p2.status >= 400 ? parseReason(p2.text) : "" });
  }
  return out;
}

async function main() {
  const state = loadState();
  if (!state.ruleTransitions || !state.issues) throw new Error("Run attach-rules + seed-issues first.");
  const rules = buildRules(state);
  const fields = pfFields(state);

  // Group issues by class
  const byCls = {};
  for (const [id, info] of Object.entries(state.issues)) {
    (byCls[info.cls] ||= []).push({ id, key: info.key, cls: info.cls });
  }

  // Build case list
  const cases = [];
  for (const rule of rules) {
    const tinfo = state.ruleTransitions[rule.key];
    if (!tinfo) { console.log(`  no transition for ${rule.key}, skipping`); continue; }
    if (rule.twoPhaseGate) continue; // handled separately
    const classes = rule.appliesTo || [];
    for (const cls of classes) {
      let pool = byCls[cls] || [];
      if (MAX_PER_CLASS > 0) pool = pool.slice(0, MAX_PER_CLASS);
      for (const issue of pool) {
        cases.push({ rule, tid: tinfo.transitionId, issueId: issue.id, issue });
      }
    }
  }
  let runCases = cases;
  if (process.env.SMOKE === "1") {
    // one case per rule
    const seen = new Set();
    runCases = cases.filter((c) => (seen.has(c.rule.key) ? false : seen.add(c.rule.key)));
    console.log(`SMOKE mode: ${runCases.length} cases (one per rule).`);
  }
  console.log(`Running ${runCases.length} test cases across ${rules.length} rules at concurrency ${CONCURRENCY}...`);

  let done = 0;
  const results = await mapLimit(runCases, CONCURRENCY, async (c) => {
    const r = await runCase(c, state, fields);
    done++;
    if (process.env.SMOKE === "1" || done % 20 === 0) console.log(`  ${done}/${runCases.length} ${r.ruleKey} ${r.issueId}: ${r.actual} (${r.correct ? "ok" : "MISS"})${r.reason ? " :: " + r.reason.slice(0, 90) : ""}`);
    return r;
  });

  // Two-phase agentic gate
  const gateRule = rules.find((r) => r.twoPhaseGate);
  if (gateRule) {
    console.log("Running two-phase agentic gate...");
    const g = await twoPhaseGate(gateRule, state.ruleTransitions[gateRule.key].transitionId, state);
    results.push(...g);
  }

  writeResult("run-results.json", { generatedAtNote: "stamp added by report", total: results.length, results });

  // Console summary
  const byStudy = {};
  for (const r of results) {
    const s = (byStudy[r.study] ||= { total: 0, correct: 0 });
    s.total++; if (r.correct) s.correct++;
  }
  console.log("\n=== Summary by study ===");
  for (const [study, s] of Object.entries(byStudy)) {
    console.log(`  ${study}: ${s.correct}/${s.total} correct`);
  }
  const misses = results.filter((r) => !r.correct);
  console.log(`\nTotal: ${results.filter((r) => r.correct).length}/${results.length} correct, ${misses.length} misses/errors`);
  console.log("Results written to results/run-results.json");
}

main().catch((e) => {
  console.error("RUN FAILED:", e.message);
  if (e.body) console.error(JSON.stringify(e.body, null, 2));
  process.exit(1);
});
