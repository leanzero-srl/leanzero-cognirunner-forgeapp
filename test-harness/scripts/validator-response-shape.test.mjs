/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * F-384 — THE OBJECT `validate()` HANDS BACK TO JIRA, AND NOTHING ELSE.
 *
 * The platform accepts exactly `{ result, errorMessage? }` from a jira:workflowValidator.
 * Proven live on wolfaenpak dev, A/B on one transition and one issue:
 *   { result: true }                              → HTTP 204, transition allowed
 *   { result: true, gitReason: "not-configured" } → HTTP 400 "returned a response in an
 *                                                   unexpected format"
 * ONE extra key is sufficient. `runGitValidator`'s `allow()` always attached `gitReason`
 * (and the fail-open paths a `banner`), and `validate()` returned that object verbatim —
 * so EVERY git-validator allow path BLOCKED the user, while the execution log and
 * `forge logs` both said `result:true, blocked:false`. The fail-OPEN promise was inverted
 * and the app reported nothing.
 *
 * WHY THIS FILE EXISTS AND NOT ANOTHER ASSERTION IN THE PREMADE SUITE: every offline suite
 * we had asserted the object `executePremadeRule` returns — the RICH one, which is correct
 * for the log and for the REST/test surfaces. None of them ever looked at what crosses the
 * PLATFORM boundary. This suite drives the real `validate()` from src/index.js and asserts
 * the SHAPE of what it returns for every premade validator, on an allow path and on a block
 * path, so widening the contract again fails here instead of on a customer's transition.
 *
 *   node --import ./lib/register-mocks-index.mjs scripts/validator-response-shape.test.mjs
 */
import "../lib/register-mocks-index.mjs";
import { PREMADE_VALIDATORS } from "../../src/shared/premade-rules-catalog.js";
const { default: forgeApi } = await import("@forge/api");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const { validate } = await import("../../src/index.js");

/** THE CONTRACT. Anything else is an HTTP 400 on a real transition. */
const assertShape = (out, label) => {
  ok(out && typeof out === "object", `${label}: an object is returned`);
  const keys = Object.keys(out || {});
  const extra = keys.filter((k) => k !== "result" && k !== "errorMessage");
  ok(extra.length === 0, `${label}: NO key beyond result/errorMessage (extra: ${JSON.stringify(extra)})`);
  ok(typeof out?.result === "boolean", `${label}: result is a boolean`);
  if (out?.result === true) {
    ok(!("errorMessage" in out), `${label}: an ALLOW carries no errorMessage`);
  } else {
    ok(typeof out?.errorMessage === "string" && out.errorMessage.length > 0,
      `${label}: a BLOCK carries a human sentence`);
  }
};

/* Two worlds, so every validator is exercised on both sides of its own verdict without
 * this suite having to know each rule's semantics — the SHAPE is what is under test. */
const EMPTY_ISSUE = {
  key: "LZPT-1",
  fields: { summary: "", description: null, labels: [], attachment: [], comment: { comments: [] }, subtasks: [], issuelinks: [], priority: null, resolution: null, duedate: null, assignee: null, reporter: null },
};
const FULL_ISSUE = {
  key: "LZPT-1",
  fields: {
    summary: "A real summary that is long enough to satisfy a length rule",
    description: "A real description that is long enough to satisfy a length rule",
    labels: ["ready"], attachment: [{ id: "1", filename: "a.png" }],
    comment: { comments: [{ id: "1", body: "done" }] },
    subtasks: [], issuelinks: [], duedate: "2030-01-01",
    priority: { name: "High" }, resolution: { name: "Done" },
    assignee: { accountId: "acct-1" }, reporter: { accountId: "acct-1" },
  },
};

const respondWith = (issue) => {
  forgeApi.__respond((path) => {
    if (path.includes("mypermissions")) {
      return forgeApi.__response(200, { permissions: { TRANSITION_ISSUES: { havePermission: true } } });
    }
    if (path.includes("/properties/")) return forgeApi.__response(404, {});
    if (path.includes("/issue/")) return forgeApi.__response(200, issue);
    return forgeApi.__response(200, {});
  });
};

const cfgFor = (key) => ({
  ruleKind: "premade",
  ruleType: key,
  fieldId: "description",
  // Enough parameters that every parameterised rule has something to decide with; a rule
  // that ignores them is unaffected, and a MISCONFIGURED rule must also answer in shape.
  regex: ".+", allowed: ["Done"], op: "eq", value: "Done",
  min: 5, max: 4000, days: 30, direction: "after",
  repo: "leanzero/cognirunner", connectionId: "gc_missing",
  errorMessage: "",
});

const run = (key, issue, extraCfg = {}) => {
  respondWith(issue);
  return validate({
    issue: { key: issue.key },
    configuration: { ...cfgFor(key), ...extraCfg },
    modifiedFields: {},
    context: { extension: { type: "jira:workflowValidator" }, license: { isActive: true } },
  });
};

for (const v of PREMADE_VALIDATORS) {
  const key = v.key;
  assertShape(await run(key, EMPTY_ISSUE), `${key} (empty issue)`);
  assertShape(await run(key, FULL_ISSUE), `${key} (populated issue)`);
  // Strict flips the git validators' fail-open paths into blocks — the OTHER half of the
  // object that used to carry `banner`.
  assertShape(await run(key, FULL_ISSUE, { strict: true }), `${key} (strict)`);
  // …and with NOTHING configured, which is the half-built rule and the git validators'
  // `gitReason:"not-configured"` allow — the exact object the live A/B proved Jira refuses.
  assertShape(await run(key, FULL_ISSUE, { connectionId: "", repo: "", fieldId: "" }), `${key} (unconfigured)`);
}

/* The exact live A/B that found this, reproduced offline. A git validator with no
 * connection picked is the "half-built rule" case: it must ALLOW, and the allow must be
 * the bare object — `gitReason:"not-configured"` is what Jira refused. */
for (const key of ["git-pr-merged", "git-pr-approved", "git-build-passed", "git-pr-comments-resolved"]) {
  const out = await run(key, FULL_ISSUE, { connectionId: "", repo: "" });
  eq(out, { result: true }, `${key} with no connection allows with the BARE contract object`);
}

/* THE CONFLUENCE VALIDATOR (1.5 commit 7) carries the SAME extra keys the git ones do —
 * `banner` on every degradation row and `confluenceReason` on every fail-OPEN allow — so
 * it is the exact class of rule F-384 was found on. Each cell of its degradation table is
 * driven here for SHAPE, on top of the semantic coverage in premade-confluence.test.mjs:
 * a correct verdict that Jira refuses to parse is a blocked user and a green log row.
 *
 * `respondWith` answers 200 {} to any Confluence path (the mock routes requestConfluence
 * through the same responder), so the search returns no results — the determinate "no
 * page matched" BLOCK. Strict flips the fault rows. */
{
  const CQL = { spaceKey: "DOCS", cqlTemplate: "title ~ {issueKey}" };
  for (const extra of [
    { ...CQL },                                   // determinate negative → BLOCK
    { ...CQL, strict: true },                     // …strict changes nothing here
    { ...CQL, mode: "semantic", prompt: "x" },    // semantic, no judge available → degrade
    { ...CQL, mode: "semantic", prompt: "x", strict: true },
    { spaceKey: "", cqlTemplate: "x" },           // misconfig → BLOCK in both columns
    { spaceKey: "DOCS", cqlTemplate: "" },
    { spaceKey: "DOCS", cqlTemplate: "{nope}" },
    { spaceKey: "DOCS", cqlTemplate: "x", mode: "semantic", prompt: "" },
    { spaceKey: "DOCS", cqlTemplate: "x", errorMessage: "Write the design page first." },
  ]) {
    assertShape(await run("confluence-page-exists", FULL_ISSUE, extra),
      `confluence-page-exists ${JSON.stringify(extra)}`);
  }
  // The fail-OPEN allow is the object the live A/B proved Jira refuses when it carries
  // one extra key. `confluenceReason` and `banner` must NOT cross the boundary.
  const open = await run("confluence-page-exists", FULL_ISSUE, { spaceKey: "DOCS", cqlTemplate: "x", __forceUnavailable: true });
  ok(!("confluenceReason" in open) && !("banner" in open),
    "a Confluence fail-OPEN never carries confluenceReason/banner across the platform boundary");
}

/* …and a real block still carries its sentence and nothing else. */
{
  const out = await run("field-required", EMPTY_ISSUE);
  eq(out.result, false, "field-required on an empty field still blocks");
  eq(Object.keys(out).sort(), ["errorMessage", "result"], "…with exactly the two contract keys");
}

/* An unlicensed instance fails OPEN, and that answer is in shape too. */
{
  respondWith(FULL_ISSUE);
  const out = await validate({
    issue: { key: "LZPT-1" }, configuration: cfgFor("field-required"), modifiedFields: {},
    context: { extension: { type: "jira:workflowValidator" } }, license: { isActive: false },
  });
  assertShape(out, "unlicensed (fail open)");
}

/* ══════════ F-399 — WHAT THE INVOCATION PUTS IN forge logs ══════════ */
// Both workflow entry points used to `JSON.stringify(args, null, 2)` the WHOLE platform
// payload, which carries `context.contextToken` — the platform's signed JWT — and every
// modified FIELD VALUE. Forge logs are readable by site admins and forwarded off-site.
{
  const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1In0.sig";
  const SECRET_VALUE = "patient name Ada Lovelace, 1990-12-10";
  const captured = [];
  const realLog = console.log;
  console.log = (...a) => { captured.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")); };
  try {
    respondWith(FULL_ISSUE);
    await validate({
      issue: { key: "LZPT-1" },
      configuration: cfgFor("field-required"),
      modifiedFields: { summary: { value: SECRET_VALUE }, customfield_10001: { value: JWT } },
      context: {
        extension: { type: "jira:workflowValidator", key: "ai-text-field-validator" },
        contextToken: JWT, license: { isActive: true }, accountId: "acct-1",
      },
    });
    const { executePostFunction } = await import("../../src/index.js");
    await executePostFunction({
      issue: { key: "LZPT-1" },
      configuration: JSON.stringify({ type: "postfunction-static", ruleId: "r1", functions: [] }),
      context: { extension: { key: "ai-static-post-function" }, contextToken: JWT, license: { isActive: true } },
    });
  } finally { console.log = realLog; }
  const all = captured.join("\n");
  ok(!all.includes("contextToken"), "no invocation log names contextToken");
  ok(!/eyJ[A-Za-z0-9_-]{5,}/.test(all), "no JWT-shaped string reaches the logs");
  ok(!all.includes(SECRET_VALUE), "no modified-field VALUE reaches the logs");
  ok(/AI Validator invoked:/.test(all) && /Post-function invoked:/.test(all),
    "…both entry points still log an allow-listed summary (the diagnostic is kept, not deleted)");
  ok(/"modifiedFieldIds":\["summary","customfield_10001"\]/.test(all),
    "…naming the modified field IDs, which is what a diagnostic actually needs");
}

console.log(`\nvalidator response shape: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
