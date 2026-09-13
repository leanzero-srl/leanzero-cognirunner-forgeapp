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

console.log(`\nva-agent-deps: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
