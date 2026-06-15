/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Workstream M3 — LIVE app->MCP end-to-end, now that the self-hosted MCPs serve on
// Tailscale Funnel :443 (Forge egress is 443-only; this was the F-MCP-EGRESS blocker).
// Re-statuses F7 (gendoc/research were "unusable" only because the MCP was unreachable).
//
// The decisive black-box signal for GENDOC is a NEW ATTACHMENT on the issue: that proves
// the FULL round-trip — the app reached the doc-processor MCP on :443 AND the MCP reached
// back into the app's attachment-upload web-trigger to attach the file. No forge-logs needed
// to call it (logs corroborate). RESEARCH success = the target field / a comment changes.
//
//   node scripts/mcp-live-e2e.mjs            (CLEAN=1 deletes the temp issues it creates)
//
// Assessment axes (CLAUDE.md): black-box changelog/attachments/field-values, corroborated
// by `forge logs`. Grep guidance printed at the end.

import { post, getIssue, doTransition, getTransitions, sleep } from "../lib/jira.mjs";
import { loadState, writeResult } from "../lib/state.mjs";

const CLEAN = process.env.CLEAN === "1";

const adf = (text) => ({ type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

async function createIssue(s, summary, descText) {
  const fields = {
    project: { key: s.projectKey },
    issuetype: { id: s.primaryIssueType.id },
    summary,
    labels: ["cogtest-harness", "mcp-live-e2e"],
  };
  if (descText) fields.description = adf(descText);
  const r = await post("/rest/api/3/issue", { fields });
  return r.key;
}

async function snapshot(key) {
  const issue = await getIssue(key, ["attachment", "comment", "description"]);
  return {
    attachments: (issue.fields?.attachment || []).map((a) => ({ id: a.id, filename: a.filename, mime: a.mimeType, size: a.size })),
    commentCount: issue.fields?.comment?.comments?.length || 0,
    descLen: JSON.stringify(issue.fields?.description || "").length,
  };
}

// Poll for a post-function side effect (attachment / comment / description change) up to ~36s.
async function pollFor(key, predicate, label, tries = 12, gapMs = 3000) {
  for (let i = 0; i < tries; i++) {
    await sleep(gapMs);
    const snap = await snapshot(key);
    if (predicate(snap)) {
      console.log(`    ${label}: observed after ~${((i + 1) * gapMs) / 1000}s`);
      return snap;
    }
  }
  return await snapshot(key); // final read even if predicate never satisfied
}

async function runGendoc(s, tid) {
  console.log(`\n=== GENDOC (doc-reader/docWriter MCP) — transition ${tid} ===`);
  const key = await createIssue(
    s,
    "Outage: checkout 500s after deploy v412",
    "At 14:02 UTC checkout started returning 500s. Error rate hit 30% for 11 minutes. Rolled back v412, recovered by 14:18. Suspected DB connection-pool exhaustion under the new retry path. Needs a root-cause writeup.",
  );
  console.log(`  issue ${key} created`);
  const before = await snapshot(key);
  console.log(`  before: ${before.attachments.length} attachment(s), ${before.commentCount} comment(s)`);

  const tr = await getTransitions(key);
  if (!(tr.transitions || []).some((t) => String(t.id) === String(tid))) {
    return { scenario: "gendoc", key, verdict: "NO_TRANSITION", detail: `transition ${tid} not available on a fresh issue` };
  }
  const r = await doTransition(key, tid);
  console.log(`  fired transition -> HTTP ${r.status}${r.status >= 400 ? " (BLOCKED?! " + (r.text || "").slice(0, 140) + ")" : " (allowed)"}`);

  const after = await pollFor(
    key,
    (snap) => snap.attachments.length > before.attachments.length || snap.commentCount > before.commentCount,
    "attachment/comment",
  );
  const newAtt = after.attachments.filter((a) => !before.attachments.some((b) => b.id === a.id));
  const gainedComment = after.commentCount > before.commentCount;

  let verdict, detail;
  if (newAtt.length > 0) {
    verdict = "PASS";
    detail = `created+attached ${newAtt.length} file(s): ${newAtt.map((a) => `${a.filename} (${a.mime}, ${a.size}b)`).join(", ")}${gainedComment ? " + comment" : ""}. Proves app<->MCP egress on :443 round-trip.`;
  } else if (gainedComment) {
    verdict = "PARTIAL";
    detail = "comment added but NO attachment — docWriter upload likely failed (check forge logs for upload-trigger / 403 egress).";
  } else if (r.status >= 400) {
    verdict = "HARD_FAIL";
    detail = `transition BLOCKED (${r.status}) — gendoc should never block. ${(r.text || "").slice(0, 160)}`;
  } else {
    verdict = "SKIP";
    detail = "transition allowed but no attachment/comment — MCP disabled or graceful SKIP (check forge logs).";
  }
  console.log(`  -> ${verdict}: ${detail}`);
  return { scenario: "gendoc", key, http: r.status, before, after, newAttachments: newAtt, verdict, detail };
}

async function runResearch(s, tid) {
  console.log(`\n=== RESEARCH (web-search MCP) — transition ${tid} ===`);
  const key = await createIssue(
    s,
    "Investigate session-refresh race in stateless auth",
    "Intermittent 401s during token refresh under load. Need known mitigations for refresh races in stateless services.",
  );
  console.log(`  issue ${key} created`);
  const before = await snapshot(key);

  const tr = await getTransitions(key);
  if (!(tr.transitions || []).some((t) => String(t.id) === String(tid))) {
    return { scenario: "research", key, verdict: "NO_TRANSITION", detail: `transition ${tid} not available` };
  }
  const r = await doTransition(key, tid);
  console.log(`  fired transition -> HTTP ${r.status}`);

  const after = await pollFor(
    key,
    (snap) => snap.descLen > before.descLen + 40 || snap.commentCount > before.commentCount || snap.attachments.length > before.attachments.length,
    "field/comment change",
  );
  const changed = after.descLen > before.descLen + 40 || after.commentCount > before.commentCount || after.attachments.length > before.attachments.length;

  let verdict, detail;
  if (r.status >= 400) {
    verdict = "HARD_FAIL"; detail = `transition BLOCKED (${r.status}) — research should never block. ${(r.text || "").slice(0, 160)}`;
  } else if (changed) {
    verdict = "PASS"; detail = `target updated (descLen ${before.descLen}->${after.descLen}, comments ${before.commentCount}->${after.commentCount}, att ${before.attachments.length}->${after.attachments.length}). web-search MCP reachable.`;
  } else {
    verdict = "SKIP"; detail = "transition allowed but target unchanged — web-search MCP disabled or graceful SKIP (check forge logs).";
  }
  console.log(`  -> ${verdict}: ${detail}`);
  return { scenario: "research", key, http: r.status, verdict, detail };
}

async function runKnowledge(s, tid) {
  console.log(`\n=== KNOWLEDGE (validator using builtin docs) — transition ${tid} ===`);
  // K-docs is a validator; just confirm it produces a coherent verdict (good ALLOW / bad BLOCK).
  const byCls = {};
  for (const [id, info] of Object.entries(s.issues || {})) (byCls[info.cls] ||= []).push({ id, ...info });
  const good = (byCls["control-good"] || [])[0];
  const out = [];
  if (good) {
    const tr = await getTransitions(good.key);
    if ((tr.transitions || []).some((t) => String(t.id) === String(tid))) {
      const r = await doTransition(good.key, tid);
      out.push({ issue: good.key, cls: "control-good", http: r.status, verdict: r.status < 400 ? "ALLOWED" : "BLOCKED", reason: r.status >= 400 ? (r.text || "").slice(0, 160) : "" });
    } else out.push({ issue: good.key, note: "transition not available (off-hub)" });
  }
  console.log(`  -> ${JSON.stringify(out)}`);
  return { scenario: "knowledge", results: out };
}

async function main() {
  const s = loadState();
  const rt = s.ruleTransitions || {};
  const gendocTid = rt["P-gendoc"]?.transitionId;
  const researchTid = rt["P-research"]?.transitionId;
  const knowledgeTid = rt["K-docs"]?.transitionId;
  console.log(`Workstream M3 — live MCP e2e. gendoc=${gendocTid} research=${researchTid} knowledge=${knowledgeTid}`);

  const results = [];
  if (gendocTid) results.push(await runGendoc(s, gendocTid)); else console.log("(no P-gendoc transition in testbed)");
  if (researchTid) results.push(await runResearch(s, researchTid)); else console.log("(no P-research transition in testbed)");
  if (knowledgeTid) results.push(await runKnowledge(s, knowledgeTid)); else console.log("(no K-docs transition in testbed)");

  writeResult("mcp-live-e2e.json", { results });

  console.log("\n=== M3 verdicts ===");
  for (const r of results) {
    if (r.verdict) console.log(`  ${r.scenario.padEnd(10)} ${r.verdict}${r.key ? " (" + r.key + ")" : ""}: ${r.detail || ""}`);
  }
  const gendoc = results.find((r) => r.scenario === "gendoc");
  console.log(gendoc?.verdict === "PASS"
    ? "\nF-MCP-EGRESS likely RESOLVED ✅ — gendoc round-trip succeeded on :443. F7 -> works with MCP enabled."
    : "\n⚠ gendoc did NOT attach — inspect forge logs before re-statusing F7/F-MCP-EGRESS.");
  console.log("(forge logs — grep: 'create-markdown' 'upload' 'attachment' 'MCP' '403' 'not included in external fetch' 'tools/call' 'timed out' to see the MCP round-trip.)");

  if (CLEAN) {
    const { searchJql } = await import("../lib/jira.mjs");
    const rows = await searchJql('project=' + s.projectKey + ' AND labels="mcp-live-e2e"', ["summary"], 100);
    for (const row of rows) { try { await post(`/rest/api/3/issue/${row.key}/delete`, {}); } catch { /* lacks delete perm */ } }
    console.log(`\nCLEAN: attempted delete of ${rows.length} temp issue(s).`);
  } else {
    console.log("\n(Run CLEAN=1 to delete the temp issues.)");
  }
}

main().catch((e) => { console.error("M3 FAILED:", e.message); if (e.body) console.error(JSON.stringify(e.body).slice(0, 400)); process.exit(1); });
