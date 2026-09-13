/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * THE VIRTUAL ADMINISTRATOR'S REAL DEPS (F-468).
 *
 * Every other offline VA suite injects a FAKE dispatcher, which is right for asserting
 * order and gates and is exactly why a tool that throws on every production call passed
 * all 400 of those assertions. `DEFAULT_DEPS` had no `m`, so the `get_issue` arm of the
 * real dispatcher ran `compactIssue(issue, { extractText: m.extractTextFromADF })`
 * against `undefined` — 14 of 14 live calls on dev returned
 * "Cannot read properties of undefined", silently, because the turn survives it.
 *
 * So this suite uses the REAL `createAgentActionDispatcher` with the REAL `DEFAULT_DEPS`
 * and fails on a thrown or error-shaped tool result.
 *
 * Auto-discovered by run-offline.mjs.
 * Run: node --import ./lib/register-mocks.mjs scripts/va-agent-deps.test.mjs
 */
import "../lib/register-mocks-index.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  ✗ " + m); } };

const V = await import("../../src/virtual-admin.js");
const R = await import("../../src/agent-runner.js");

/* The module the deps must carry is loaded by `primeDeps()`, exactly as the consumer
   loads it before every VA task (src/async-handler.js). */
await V.primeDeps();
const deps = V.withDeps({});

ok(deps.m && typeof deps.m.extractTextFromADF === "function",
  `DEFAULT_DEPS carries the backend module the dispatcher needs (got ${deps.m ? Object.prototype.toString.call(deps.m) : String(deps.m)})`);

/* An issue whose description is ADF, so `extractTextFromADF` is genuinely exercised:
   a stub that merely exists would satisfy the check above and still be the wrong one. */
const ISSUE = {
  key: "SUP-1", id: "1",
  fields: {
    summary: "Cannot log in",
    project: { key: "SUP" },
    status: { name: "Open" },
    issuetype: { name: "Support" },
    description: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: "The portal rejects my password." }] }] },
    comment: { comments: [] },
  },
};

const api = {
  getIssue: async () => ISSUE,
  forIssue: () => api,
};
const session = { createApi: () => api, changes: [], recordChange: () => {}, simulated: true };

const dispatch = R.createAgentActionDispatcher({
  issueKey: "SUP-1", session, allowed: ["get_issue"], m: deps.m, executors: {},
  maxWrites: 0, writeScope: { projects: [] },
});

let threw = null;
let result = null;
try { result = await dispatch("get_issue", { issueKey: "SUP-1" }); }
catch (e) { threw = e; }

ok(!threw, `get_issue does not throw through the REAL dispatcher with the REAL deps (threw ${threw && threw.message})`);
ok(result && result.success !== false, `…and does not come back as a tool error (got ${JSON.stringify(result).slice(0, 200)})`);
ok(result && result.key === "SUP-1" && String(result.summary || "").includes("Cannot log in"),
  `…and reads the issue (got ${JSON.stringify(result).slice(0, 200)})`);
ok(JSON.stringify(result || {}).includes("The portal rejects my password."),
  `…with the ADF description extracted, which is what extractTextFromADF is for (got ${JSON.stringify(result).slice(0, 300)})`);

/* THE PROOF THAT THIS SUITE WOULD CATCH THE REGRESSION: the same call with no `m` is
   the live failure, verbatim. Asserted so a future "the dispatcher no longer needs m"
   refactor has to come here and say so. */
{
  const blind = R.createAgentActionDispatcher({
    issueKey: "SUP-1", session, allowed: ["get_issue"], m: undefined, executors: {},
    maxWrites: 0, writeScope: { projects: [] },
  });
  let caught = null;
  try { await blind("get_issue", { issueKey: "SUP-1" }); } catch (e) { caught = e; }
  ok(caught && /extractTextFromADF/.test(String(caught.message)),
    `a dispatcher built without \`m\` still fails the way the live defect did (got ${caught && caught.message})`);
}

/* ── F-549 — THE VA'S FIELD-GUIDE AUDIENCE ────────────────────────────────────
 *
 * The bake tags FOUR sections `va` WITHOUT `agent` — all four of them Confluence
 * ADF/storage-format sections. `buildAgentKnowledge` translated the VA's "agentRun" to
 * "agent", so `matchesAudience` filtered those four out of the pool BEFORE scoring and a
 * VA that posts a Confluence page or an ADF comment could never be shown one of them,
 * while the admin's Knowledge tab went on advertising a `va: 8 KB` budget nothing spent.
 *
 * Asserted through the REAL `selectFieldGuide` over the REAL baked packs — not the
 * dependency-free selector with fixture sections, because the defect is in the TAGS the
 * bake emitted and a fixture would assert the test's own idea of them.
 */
{
  const KP = await import("../../src/knowledge-packs.js");
  const limits = await import("../../src/shared/registry-limits.js");

  // A VA item turn whose work is Confluence-shaped: exactly the turn the four sections
  // exist for, and exactly the one that has never seen them.
  const TEXT = "Post a Confluence page and an ADF comment summarising the support queue, using the storage format body.";

  const va = await KP.selectFieldGuide({ audience: "va", text: TEXT });
  const vaOnly = (r) => r.sections.filter((s) => s.audience.includes("va") && !s.audience.includes("agent"));

  ok(va.budget === limits.fieldGuideBudget("va") && va.budget === 8192,
    `F-549: a VA turn is selected against the va budget (got ${va.budget}, expected ${limits.fieldGuideBudget("va")})`);
  ok(va.bytes <= va.budget, `F-549: …and the selection is WITHIN it (${va.bytes} <= ${va.budget})`);
  ok(va.sections.some((s) => s.audience.includes("va")),
    `F-549: …and it includes a va-tagged section (got ${va.sections.length} section(s))`);
  ok(vaOnly(va).length > 0,
    `F-549: …including at least one of the four the \`agent\` audience can NEVER reach (got ${vaOnly(va).map((s) => s.title).join(" | ") || "none"})`);

  // THE CONTROL, on the SAME text, which is what makes the check above mean anything: the
  // old audience cannot surface them, so this is the defect and not a scoring accident.
  const agent = await KP.selectFieldGuide({ audience: "agent", text: TEXT });
  ok(vaOnly(agent).length === 0,
    `F-549: the \`agent\` audience surfaces NONE of them on the same text — the tags, not the scorer (got ${vaOnly(agent).length})`);

  // The four exist and are exactly four, so a bake that re-tags them has to come here.
  const four = KP.ALL_SECTIONS.filter((s) => Array.isArray(s.audience) && s.audience.includes("va") && !s.audience.includes("agent"));
  ok(four.length === 4, `F-549: the bake still emits exactly 4 va-without-agent sections (got ${four.length})`);
  ok(four.every((s) => s.id.startsWith("confluence-rest-correctness/")),
    "F-549: …and all four are Confluence body-format sections");

  // THE CALL SITE. `audience` stays "agentRun" (the skills/memories budget row — there is
  // no `va` row in KNOWLEDGE_BUDGET_BYTES, so "va" there would quietly DROP the skills
  // budget to the unknown-caller fallback), and `fieldGuideAudience` is "va".
  const { readFileSync } = await import("node:fs");
  const vaSrc = readFileSync(new URL("../../src/virtual-admin.js", import.meta.url), "utf8");
  // From the dep down to its closing `},` — the comment above the options is long, so a
  // fixed character window would silently miss the lines this is here to pin.
  const from = vaSrc.indexOf("buildKnowledge: async");
  const call = vaSrc.slice(from, vaSrc.indexOf("\n  },", from));
  ok(/audience:\s*"agentRun"/.test(call), "F-549: the VA keeps the agentRun SKILLS/MEMORIES budget");
  ok(/fieldGuideAudience:\s*"va"/.test(call), "F-549: …and asks for the va FIELD-GUIDE audience");
  ok(limits.KNOWLEDGE_BUDGET_BYTES.va === undefined,
    "F-549: …and that split is necessary because KNOWLEDGE_BUDGET_BYTES has no va row");

  // THE HALF THAT IS NOT CUT. Not an assertion in either direction: `buildAgentKnowledge`
  // is another surgeon's file, and a check that failed the day they landed it would break
  // their gate for doing the right thing. It is printed so the gap cannot go quiet.
  const lstSrc = readFileSync(new URL("../../src/listeners.js", import.meta.url), "utf8");
  if (!/fieldGuideAudience:\s*guideAudience/.test(lstSrc)) {
    console.log("  · F-549 HALF OPEN: src/listeners.js buildAgentKnowledge does not yet read"
      + " `fieldGuideAudience`, so the option above is inert. See the comment at the call site.");
  }
}

console.log(`\nva-agent-deps: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
