/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// AGENTIC LAB — the one capability the canonical/adversarial rounds don't verify
// for CORRECTNESS: a validator with enableTools that must SEARCH JIRA (JQL tool-
// calling) to decide. Forces the (weak) model to emit a valid tool-call shape and
// the app to parse + execute the JQL and feed results back. We seed a canary issue,
// then test a DUPLICATE (must BLOCK — the model has to search, find it, fail) and a
// UNIQUE one (must ALLOW). We read cogni-debug for the verdict, the reason, the
// model used, AND toolMeta (toolsUsed / toolRounds / queries) to confirm the agentic
// loop actually ran rather than the model guessing without searching.
//
//   node scripts/agentic-lab.mjs
//   AGENTIC_ATTEMPTS=2 (fires per case; the model is non-deterministic)
// Transitions are named AG-* so `CLEAN=1 npm run audit` removes them; issues labelled cogtest-agentic.

import { post, get, doTransition, sleep, BASE } from "../lib/jira.mjs";
import { readWorkflow, updateWorkflow, makeSelfLoop, buildRule, attachRuleToTransition } from "../lib/workflow.mjs";
import { loadState, writeResult } from "../lib/state.mjs";
import { adfDoc } from "../lib/synthesize.mjs";

const ATTEMPTS = parseInt(process.env.AGENTIC_ATTEMPTS || "2", 10);
const AG_LABEL = "cogtest-agentic";
// A distinctive phrase so the duplicate search is unambiguous. A per-RUN random token
// is embedded as the SALIENT term so prior runs' undeletable issues (COGTEST can't be
// cleared — 403 on delete) don't false-collide: the canary+dup share this run's token
// (they ARE duplicates), while the unique issue's fresh token has no prior match.
const RUN = Math.random().toString(36).slice(2, 7).toUpperCase();
const CANARY = `Integrate the ${RUN}QX single-sign-on bridge for the ${RUN}ZV tenant onboarding portal`;
const UNIQUE = `Provision the ${RUN}PL analytics export pipeline for the ${RUN}WB reporting console`;

async function seedIssue(projectKey, typeId, summary) {
  const body = { fields: { project: { key: projectKey }, issuetype: { id: String(typeId) }, summary, labels: [AG_LABEL], description: adfDoc("Agentic-lab probe issue.") } };
  const r = await post("/rest/api/3/issue", body);
  return r.key;
}

async function defaultIssueTypeId(projectKey) {
  const meta = await get(`/rest/api/3/issue/createmeta?projectKeys=${projectKey}&expand=projects.issuetypes`);
  const proj = meta?.projects?.[0];
  const it = (proj?.issuetypes || []).find((t) => !t.subtask) || proj?.issuetypes?.[0];
  return it?.id;
}

function parseReason(text) { try { const j = JSON.parse(text || "{}"); return [...(j.errorMessages || []), ...(j.errors ? Object.values(j.errors) : [])].join(" | "); } catch { return text || ""; } }
async function readTrace(key) { try { const r = await get(`/rest/api/3/issue/${key}/properties/cogni-debug`, { raw: true }); if (r.status >= 400) return null; return JSON.parse(r.text).value; } catch { return null; } }

async function fire(tid, key) {
  const res = await doTransition(key, tid);
  await sleep(400);
  const trace = await readTrace(key);
  const reason = res.status >= 400 ? parseReason(res.text) : (trace?.reason || "");
  const tm = trace?.toolMeta || {};
  return {
    verdict: res.status >= 400 ? "BLOCKED" : "ALLOWED",
    http: res.status,
    reason: (reason || "").slice(0, 220),
    modelUsed: trace?.modelUsed || null,
    toolsUsed: !!tm.toolsUsed,
    toolRounds: tm.toolRounds || 0,
    queries: tm.queries || tm.jql || [],
  };
}

async function main() {
  console.log(`AGENTIC LAB on ${BASE}\n`);
  const state = loadState();
  const wfName = state.workflowName;
  const hubRef = state.hubStatusRef;
  const projectKey = state.projectKey || "COGTEST";
  if (!wfName || !hubRef) throw new Error("Run `npm run setup` first.");

  const rule = {
    key: "AG-duplicate",
    config: {
      fieldId: "summary",
      prompt: "You are a duplicate-detection validator. Use the Jira search tool (JQL) to look for an EXISTING issue whose summary describes the same work as this issue's summary. FAIL (block) if a clear duplicate already exists. PASS if this work appears unique. You MUST search before deciding — do not guess.",
      enableTools: true,
      debugTrace: true,
    },
  };

  // Attach the agentic validator self-loop on the hub.
  console.log("Attaching AG- agentic validator self-loop…");
  let tid = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { top, wf } = await readWorkflow(wfName);
    const existing = new Set((wf.transitions || []).map((t) => String(t.id)));
    wf.transitions = (wf.transitions || []).filter((t) => !String(t.name || "").startsWith("AG-"));
    let idNum = 9700; while (existing.has(String(idNum))) idNum++;
    const built = buildRule("validator", rule.config);
    const t = makeSelfLoop(hubRef, rule.key, idNum);
    attachRuleToTransition(t, "validator", built);
    wf.transitions.push(t);
    tid = String(idNum);
    try { await updateWorkflow(top, wf); break; } catch (e) { if (attempt === 0 && /409|version/i.test(e.message)) { tid = null; continue; } throw e; }
  }
  if (!tid) throw new Error("could not attach agentic validator");
  console.log(`Attached on transition ${tid}.`);

  const typeId = await defaultIssueTypeId(projectKey);
  // Seed the canary FIRST so the duplicate search can find it, then let Jira index it.
  console.log("Seeding canary + test issues…");
  const canaryKey = await seedIssue(projectKey, typeId, CANARY);
  const dupKey = await seedIssue(projectKey, typeId, CANARY); // same summary → duplicate of canary
  const uniqueKey = await seedIssue(projectKey, typeId, UNIQUE);
  console.log(`  canary=${canaryKey} dup=${dupKey} unique=${uniqueKey}`);
  console.log("  waiting 12s for Jira search indexing…");
  await sleep(12000);

  const run = async (label, key, expect) => {
    const fires = [];
    for (let i = 0; i < ATTEMPTS; i++) fires.push(await fire(tid, key));
    const blocked = fires.filter((f) => f.verdict === "BLOCKED").length;
    const dominant = blocked > fires.length / 2 ? "BLOCKED" : "ALLOWED";
    const toolFires = fires.filter((f) => f.toolsUsed).length;
    const correct = dominant === expect;
    console.log(`\n[${label}] ${key} expect=${expect} dominant=${dominant} ${correct ? "✅" : "❌"}  (tools-used ${toolFires}/${fires.length})`);
    for (const f of fires) {
      console.log(`    ${f.verdict} http=${f.http} tools=${f.toolsUsed} rounds=${f.toolRounds} q=${JSON.stringify(f.queries).slice(0, 120)} model=${f.modelUsed}`);
      console.log(`      reason: ${f.reason}`);
    }
    return { label, key, expect, dominant, correct, toolFires, fires };
  };

  const results = [];
  results.push(await run("DUPLICATE (must BLOCK)", dupKey, "BLOCKED"));
  results.push(await run("UNIQUE (must ALLOW)", uniqueKey, "ALLOWED"));

  const correctCount = results.filter((r) => r.correct).length;
  const anyTools = results.some((r) => r.toolFires > 0);
  console.log(`\n=== AGENTIC LAB SUMMARY ===`);
  console.log(`  verdicts correct: ${correctCount}/${results.length}`);
  console.log(`  agentic loop fired (tool calls observed): ${anyTools ? "YES" : "NO — model decided without searching"}`);
  writeResult("agentic-lab.json", { base: BASE, results, correctCount, anyTools });
  console.log(`\nCleanup: CLEAN=1 npm run audit  +  delete issues by  labels = ${AG_LABEL}`);
}

main().catch((e) => { console.error("agentic-lab error:", e); process.exit(1); });
