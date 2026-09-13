/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline unit test for src/shared/sandbox-api-spec.js — the SINGLE SOURCE OF TRUTH for the static
// post-function sandbox API surface. Every consumer derives from this file: the codegen/fix system
// prompt (backend), the CodeMirror completions + hover docs + lint allowlist (KNOWN_API_MEMBERS), and
// the API Reference panel (frontends). This module is pure (zero imports) so it loads directly offline.
// Asserts: getApiMethodNames() returns the full callable set (>= 30, and === spec entries minus the one
// non-callable `context` accessor), KNOWN_API_MEMBERS lint allowlist == every spec name (superset of the
// callable set by exactly `context`), every spec entry is well-formed (unique name + signature/summary/
// detail/returns/promptDoc/example non-empty, signature = `api.<name>...`), and the prompt derivation
// (buildSystemPromptApiSection) embeds a sampled method's verbatim promptDoc + the guard + section
// scaffolding. Run: node --import ../lib/register-mocks.mjs scripts/sandbox-api-spec.test.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SANDBOX_API_METHODS,
  SANDBOX_CONFLUENCE_METHODS,
  CONFLUENCE_API_MEMBERS,
  CONFLUENCE_WRITE_MEMBERS,
  CONFLUENCE_SIGNATURE_REFERENCE,
  KNOWN_API_MEMBERS,
  getApiMethodNames,
  API_USAGE_GUARD,
  buildSystemPromptApiSection,
  ISSUE_KEY_OPTIONAL_METHODS,
  SANDBOX_RULES,
  resolveIssueKey,
  normalizeKeyOptionalArgs,
} from "../../src/shared/sandbox-api-spec.js";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const nonEmptyStr = (v) => typeof v === "string" && v.trim().length > 0;

// --- getApiMethodNames(): the callable surface fed to the AI + lint ---
// The entries that are members of `api` but NOT functions. Stated once, here, and asserted
// against the spec's own `callable: false` flag below so this list cannot quietly rot.
const NON_CALLABLE = ["confluence", "context"];
const names = getApiMethodNames();
ok(Array.isArray(names), "getApiMethodNames() returns an array");
// Lower bound, NOT a stale hardcoded exact count. CLAUDE.md mandates >= 30 documented methods; the old
// bug was a hardcoded 6-name subset that red-flagged real methods — this guards against regressing to that.
ok(names.length >= 30, `getApiMethodNames() lists >= 30 callable methods (got ${names.length})`);
// The NON-CALLABLE entries are filtered out: the `context` accessor (a property) and the
// `confluence` NAMESPACE object, whose own members live in SANDBOX_CONFLUENCE_METHODS. Every
// name this returns must satisfy `typeof api[name] === "function"` in the real sandbox
// (testpf-dryrun-probe.mjs asserts exactly that), which a namespace object does not.
ok(!names.includes("context"), "getApiMethodNames() excludes the non-callable `context` accessor");
ok(!names.includes("confluence"), "getApiMethodNames() excludes the non-callable `confluence` namespace");
ok(names.length === SANDBOX_API_METHODS.length - NON_CALLABLE.length, `callable count === spec entries minus the ${NON_CALLABLE.length} non-callable members (${NON_CALLABLE.join(", ")})`);
// Spot-check the well-known surface is present (the methods the old hardcoded-6 lint falsely denied).
for (const expected of ["getIssue", "updateIssue", "searchJql", "transitionIssue", "addComment", "cloneIssue", "editIssue", "addLabels", "forceStatus", "log"]) {
  ok(names.includes(expected), `callable surface includes api.${expected}`);
}

// --- KNOWN_API_MEMBERS: the lint allowlist == every documented spec name ---
const specNames = SANDBOX_API_METHODS.map((m) => m.name);
ok(KNOWN_API_MEMBERS.length === SANDBOX_API_METHODS.length, "KNOWN_API_MEMBERS has one entry per spec method");
ok(JSON.stringify(KNOWN_API_MEMBERS) === JSON.stringify(specNames), "KNOWN_API_MEMBERS === spec names in order (derived, not re-hardcoded)");
ok(KNOWN_API_MEMBERS.includes("context"), "KNOWN_API_MEMBERS keeps `context` (readable member, unlike the callable list)");
// KNOWN_API_MEMBERS must be a strict superset of the callable names by exactly the non-callables.
const extra = KNOWN_API_MEMBERS.filter((n) => !names.includes(n));
ok(JSON.stringify([...extra].sort()) === JSON.stringify([...NON_CALLABLE].sort()), `KNOWN_API_MEMBERS = callable names + exactly ${NON_CALLABLE.join(", ")} (got ${extra.join(", ")})`);
// The list above is the TEST's claim; the spec's own flag is the product's. They must agree,
// or the lint allowlist and the dry-run probe are reading two different surfaces.
const flagged = SANDBOX_API_METHODS.filter((m) => m.callable === false).map((m) => m.name);
ok(flagged.includes("confluence"), "the `confluence` namespace entry carries callable: false");
ok(flagged.every((n) => NON_CALLABLE.includes(n)), `every callable:false entry is a known non-callable (got ${flagged.join(", ")})`);
ok(names.every((n) => KNOWN_API_MEMBERS.includes(n)), "every callable name is in the lint allowlist");

// --- the `api.confluence.*` namespace: ONE entry group, everything derived from it ---
ok(SANDBOX_CONFLUENCE_METHODS.length === CONFLUENCE_API_MEMBERS.length, "CONFLUENCE_API_MEMBERS is derived from the member table");
ok(CONFLUENCE_API_MEMBERS.length === 6, `the namespace documents 6 members (got ${CONFLUENCE_API_MEMBERS.length})`);
ok(CONFLUENCE_WRITE_MEMBERS.join(",") === "createPage,updatePage,addComment", `the WRITE members are createPage/updatePage/addComment (got ${CONFLUENCE_WRITE_MEMBERS.join(",")})`);
for (const m of SANDBOX_CONFLUENCE_METHODS) {
  ok(nonEmptyStr(m.signature) && m.signature.startsWith(`api.confluence.${m.name}`), `${m.name}: signature is api.confluence.<name>... (got ${m.signature})`);
  ok(nonEmptyStr(m.returns) && nonEmptyStr(m.summary) && nonEmptyStr(m.example), `${m.name}: returns/summary/example populated`);
  ok(m.example.includes(`api.confluence.${m.name}`), `${m.name}: the example calls the member it documents`);
}
// The namespace's promptDoc is BUILT from the member rows — no second copy of the docs.
const cfEntry = SANDBOX_API_METHODS.find((m) => m.name === "confluence");
ok(!!cfEntry, "the spec carries one `confluence` entry");
for (const m of SANDBOX_CONFLUENCE_METHODS) {
  ok(cfEntry.promptDoc.includes(m.signature), `the namespace promptDoc documents ${m.signature}`);
}
// The two facts a generated step gets wrong if they are missing.
ok(/storage format/i.test(cfEntry.promptDoc) && /never ADF|not ADF/i.test(cfEntry.promptDoc), "the namespace promptDoc says storage format, NOT ADF");
ok(cfEntry.promptDoc.includes("confluence_unavailable"), "the namespace promptDoc names the not-installed failure code");
ok(CONFLUENCE_SIGNATURE_REFERENCE.split("\n").length === CONFLUENCE_API_MEMBERS.length, "CONFLUENCE_SIGNATURE_REFERENCE has one line per member");

// --- names are UNIQUE (a dup would silently shadow completions/hover/lint) ---
ok(new Set(specNames).size === specNames.length, "all spec method names are unique");

// --- every spec entry is well-formed (feeds prompt + completions + hover + API ref panel) ---
let missingField = null, badSig = null, promptDocMismatch = null;
for (const m of SANDBOX_API_METHODS) {
  // Required string fields — each surface reads a different one, so all must be present + non-empty.
  if (!nonEmptyStr(m.name) || !nonEmptyStr(m.signature) || !nonEmptyStr(m.summary)
    || !nonEmptyStr(m.detail) || !nonEmptyStr(m.returns) || !nonEmptyStr(m.promptDoc) || !nonEmptyStr(m.example)) {
    missingField = m.name || JSON.stringify(m);
  }
  // Signature is `api.<name>...` — the completions + hover header rely on this shape.
  if (typeof m.signature !== "string" || !m.signature.startsWith(`api.${m.name}`)) {
    badSig = `${m.name}: ${m.signature}`;
  }
  // promptDoc is the VERBATIM markdown injected into the system prompt: must be a `###` section that
  // names its own method (a mislabeled doc would teach the AI the wrong signature).
  if (typeof m.promptDoc !== "string" || !m.promptDoc.startsWith("###") || !m.promptDoc.includes(m.name)) {
    promptDocMismatch = m.name;
  }
}
ok(missingField === null, `every spec entry has non-empty name/signature/summary/detail/returns/promptDoc/example (offender: ${missingField})`);
ok(badSig === null, `every signature is \`api.<name>...\` (offender: ${badSig})`);
ok(promptDocMismatch === null, `every promptDoc is a \`###\` section naming its own method (offender: ${promptDocMismatch})`);

// Callable methods take arguments in the signature paren (context has none) — the `context` accessor is
// the only entry whose signature has no call parens.
const parenless = SANDBOX_API_METHODS.filter((m) => !m.signature.includes("("));
ok(JSON.stringify(parenless.map((m) => m.name).sort()) === JSON.stringify([...NON_CALLABLE].sort()),
  `only the non-callable members have a paren-less signature (got ${parenless.map((m) => m.name).join(", ")})`);

// --- prompt/hover/completion DERIVATIONS are non-empty for a sample method ---
const sample = SANDBOX_API_METHODS.find((m) => m.name === "getIssue");
ok(sample && nonEmptyStr(sample.summary) && nonEmptyStr(sample.detail) && nonEmptyStr(sample.example),
  "sample method (getIssue) has the completion/hover fields populated");

const prompt = buildSystemPromptApiSection();
ok(nonEmptyStr(prompt), "buildSystemPromptApiSection() returns a non-empty prompt");
ok(nonEmptyStr(API_USAGE_GUARD) && prompt.includes(API_USAGE_GUARD), "prompt embeds the API_USAGE_GUARD lead paragraph");
ok(prompt.includes(sample.promptDoc), "prompt embeds the sampled method's VERBATIM promptDoc");
// Every documented method's promptDoc must appear in the built prompt (nothing silently dropped).
ok(SANDBOX_API_METHODS.every((m) => prompt.includes(m.promptDoc)), "prompt embeds every method's promptDoc (single source, no drops)");
// Section scaffolding the resolver's dynamic tail appends onto.
for (const heading of ["## SANDBOX API REFERENCE", "## FIELD TYPE REFERENCE", "## COMMON PATTERNS", "## RULES"]) {
  ok(prompt.includes(heading), `prompt contains section heading "${heading}"`);
}
ok(prompt.includes("| Jira Field Type |"), "prompt renders the field-type reference table header");

// --- F-004: "which issue does this act on when the caller doesn't say?" -------
// One answer (resolveIssueKey), used by production createApi() AND the dry-run testApi.
// The regression this guards: api.getIssue() became GET /issue/undefined -> 404 in
// production while Test Run passed, because three places answered the question differently.
ok(Array.isArray(ISSUE_KEY_OPTIONAL_METHODS) && ISSUE_KEY_OPTIONAL_METHODS.length === 5,
  "ISSUE_KEY_OPTIONAL_METHODS lists the 5 key-first methods");
for (const n of ISSUE_KEY_OPTIONAL_METHODS) {
  const entry = SANDBOX_API_METHODS.find((m) => m.name === n);
  ok(!!entry, `key-optional method ${n} is documented in the spec`);
  ok(entry && entry.signature.includes("issueKey?"), `api.${n} signature marks the key optional`);
  ok(entry && entry.detail.includes("issueKey?"), `api.${n} hover detail marks the key optional`);
  // F-067 companion: the completion dropdown is the one editor surface that renders `detail`
  // (the hover and the API Reference panel render signature/returns/summary/example), so the
  // short form of the empty-key rule has to live there or a human typing never sees it.
  ok(entry && /an empty key throws/.test(entry.detail),
    `api.${n} completion detail carries the short empty-key hint`);
  ok(entry && /key is OPTIONAL/i.test(entry.promptDoc), `api.${n} promptDoc says the key is optional`);
  // F-052: a doc that only says "omit it and the call targets the current issue" made the
  // generator emit `api.updateIssue(issue.fields.parent?.key || "", fields)` — an explicitly
  // EMPTY key, which resolveIssueKey throws on. Every key-optional doc must say so, or the
  // prompt and the runtime disagree and the disagreement ships as generated code.
  ok(entry && /empty or blank string THROWS/.test(entry.promptDoc),
    `api.${n} promptDoc warns that an explicitly-passed empty key THROWS`);
  ok(entry && entry.promptDoc.includes('|| ""'),
    `api.${n} promptDoc names the || "" pattern the model must not emit`);
}
// ...and the same rule once in the shared RULES block, so the model reads it as a rule too.
const emptyKeyRules = SANDBOX_RULES.filter((r) => /EMPTY issue key/.test(r));
ok(emptyKeyRules.length === 1, "SANDBOX_RULES states the empty-issue-key rule exactly once");
ok(emptyKeyRules[0] && emptyKeyRules[0].includes('|| ""'), "the rule names the || \"\" pattern");
ok(prompt.includes(emptyKeyRules[0] || "\u0000"), "the built system prompt carries the empty-issue-key rule");
// createIssueLink / rankIssue / forIssue take a key first but it is NOT the bound issue.
for (const n of ["createIssueLink", "rankIssue", "forIssue"]) {
  ok(!ISSUE_KEY_OPTIONAL_METHODS.includes(n), `${n} is NOT key-optional (its first arg is not the bound issue)`);
}
const norm = (m, ...args) => normalizeKeyOptionalArgs(m, args);
ok(resolveIssueKey("PROJ-1", "PROJ-9", "getIssue") === "PROJ-1", "explicit key wins over the bound issue");
ok(resolveIssueKey(undefined, "PROJ-9", "getIssue") === "PROJ-9", "omitted key falls back to the bound issue");
ok(resolveIssueKey(null, "PROJ-9", "getIssue") === "PROJ-9", "null key falls back to the bound issue");
// OMITTED vs EMPTY. `api.updateIssue(parent.key || "", fields)` passed a key and it is empty —
// falling back to the bound issue there would be a WRITE ON THE WRONG ISSUE, in silence.
for (const empty of ["", "   "]) {
  let msg = null;
  try { resolveIssueKey(empty, "PROJ-9", "updateIssue"); } catch (e) { msg = e.message; }
  ok(msg && /empty string/.test(msg), `an explicitly-passed empty key (${JSON.stringify(empty)}) throws instead of targeting the bound issue`);
  ok(msg && msg.includes("api.updateIssue()"), "the empty-key error names the method");
  ok(msg && /omit the argument/.test(msg), "the empty-key error says how to target the current issue on purpose");
}
// ...and it still throws when there is no bound issue either (no accidental second path).
let emptyNoBound = null;
try { resolveIssueKey("", null, "getIssue"); } catch (e) { emptyNoBound = e.message; }
ok(emptyNoBound && /empty string/.test(emptyNoBound), "an empty key throws even with no bound issue");
// normalizeKeyOptionalArgs must not swallow it: a 2-arg call keeps "" in the key slot.
ok(norm("updateIssue", "", { summary: "x" }).key === "", "updateIssue(\"\", fields) keeps the empty key so resolveIssueKey can reject it");
ok(norm("editIssue", "", { labels: [] }).key === "", "editIssue(\"\", update) keeps the empty key");
ok(resolveIssueKey(10023, "PROJ-9", "getIssue") === "10023", "a numeric issue ID is accepted (issue/{idOrKey})");
// An issue OBJECT passed where a key belongs must FAIL, never silently fall back to the
// current issue — that would turn a caller bug into a write on the wrong issue.
let badType = null;
try { resolveIssueKey({ key: "PROJ-1" }, "PROJ-9", "updateIssue"); } catch (e) { badType = e.message; }
ok(badType && /must be a string/.test(badType), "a non-string, non-numeric key throws instead of falling back");
let threw = null;
try { resolveIssueKey(undefined, null, "getIssue"); } catch (e) { threw = e.message; }
ok(threw !== null, "resolveIssueKey throws when there is no explicit and no bound key");
ok(threw && threw.includes("api.forIssue(") && threw.includes("getIssue"),
  "the throw names the method and points at api.forIssue(key)");

// The two guards must be INDISTINGUISHABLE: the key-LESS stub message template in
// createApi() and the key-OPTIONAL resolveIssueKey() message must render identically.
const here = path.dirname(fileURLToPath(import.meta.url));
const indexSrc = readFileSync(path.join(here, "../../src/index.js"), "utf8");
const stubTpl = indexSrc.match(/throw new Error\(`(api\.\$\{m\}\(\)[^`]*)`\)/);
ok(!!stubTpl, "found the ISSUE_BOUND_METHODS throwing-stub message template in src/index.js");
if (stubTpl) {
  const rendered = stubTpl[1].split("${m}").join("addComment").split("${where}").join("this job run");
  let optMsg = "";
  try { resolveIssueKey(undefined, null, "addComment", "this job run"); } catch (e) { optMsg = e.message; }
  ok(optMsg === rendered, "key-optional and key-less guards throw the SAME message (operator can't tell them apart)");
}

// --- ARITY: omitting the key must SHIFT the remaining arguments -------------
// Without this, api.updateIssue({ priority }) would put the payload in `key` and PUT
// `{ fields: undefined }` — the "optional key" promise has to hold for the 2-arg methods.
const fieldsObj = { priority: { name: "High" } };
ok(norm("getIssue", "PROJ-1").key === "PROJ-1", "getIssue(key) keeps the key");
ok(norm("getIssue").key === undefined, "getIssue() has no key (defaults later)");
for (const m of ["updateIssue", "editIssue"]) {
  const shifted = norm(m, fieldsObj);
  ok(shifted.key === undefined && shifted.rest[0] === fieldsObj, `${m}(payload) shifts the payload out of the key slot`);
  const explicit = norm(m, "PROJ-1", fieldsObj);
  ok(explicit.key === "PROJ-1" && explicit.rest[0] === fieldsObj, `${m}(key, payload) keeps both`);
}
const t1 = norm("transitionIssue", "31");
ok(t1.key === undefined && t1.rest[0] === "31", "transitionIssue(id) treats the lone argument as the transition id");
const t2 = norm("transitionIssue", "PROJ-1", "31");
ok(t2.key === "PROJ-1" && t2.rest[0] === "31", "transitionIssue(key, id) keeps both");
const t3 = norm("transitionIssue", "31", { fields: {} });
ok(t3.key === undefined && t3.rest[0] === "31" && t3.rest[1] && typeof t3.rest[1] === "object",
  "transitionIssue(id, extra) is key-less (2nd arg is an object)");
const n1 = norm("transitionByName", "Done");
ok(n1.key === undefined && n1.rest[0] === "Done", "transitionByName(name) treats the lone argument as the name");
const n2 = norm("transitionByName", "PROJ-1", "Done");
ok(n2.key === "PROJ-1" && n2.rest[0] === "Done", "transitionByName(key, name) keeps both");
const n3 = norm("transitionByName", "Done", { fields: {} });
ok(n3.key === undefined && n3.rest[0] === "Done" && n3.rest[1], "transitionByName(name, extra) is key-less");
const n4 = norm("transitionByName", "PROJ-1", "Done", { fields: {} });
ok(n4.key === "PROJ-1" && n4.rest[0] === "Done" && n4.rest[1], "transitionByName(key, name, extra) keeps all three");

// Test Run must reuse the production session, with no legacy factory to drift.
const testResolver = indexSrc.slice(indexSrc.indexOf('resolver.define("testPostFunction"'), indexSrc.indexOf('// ═══════════════════════ LISTENERS'));
ok(testResolver.includes("const session = createSandboxSession({") && testResolver.includes("config: { simulationMode: true }"), "Test Run always uses the production session with server-forced simulation");
ok(!testResolver.includes("makeTestApi") && !testResolver.includes('"MOCK-1"'), "no second API factory or invented issue survives in Test Run");
for (const n of ISSUE_KEY_OPTIONAL_METHODS) {
  ok(indexSrc.includes(`resolveIssueKey(key, issueKey, "${n}"`), `createApi().${n} resolves the issue through resolveIssueKey`);
  if (n !== "getIssue") {
    const uses = indexSrc.split(`normalizeKeyOptionalArgs("${n}", args)`).length - 1;
    ok(uses === 1, `${n} argument normalization has one production home, reused by Test Run`);
  }
}

// Every `example` in the spec must be a call the final implementation accepts: for the
// key-optional methods that means the explicit (key, ...) form or a valid shifted form.
for (const n of ISSUE_KEY_OPTIONAL_METHODS) {
  const entry = SANDBOX_API_METHODS.find((m) => m.name === n);
  ok(entry && entry.example.includes(`api.${n}(api.context.issueKey`),
    `api.${n} example still passes the key EXPLICITLY (the default is a safety net, not the house style)`);
}
// The forIssue doc promises api.forIssue("PROJ-1").transitionByName("Done") — that is the
// 1-argument shifted form, so transitionByName must be key-optional AND arity-normalized.
const forIssueDoc = SANDBOX_API_METHODS.find((m) => m.name === "forIssue").promptDoc;
ok(!/transitionByName/.test(forIssueDoc) || ISSUE_KEY_OPTIONAL_METHODS.includes("transitionByName"),
  "forIssue promptDoc only promises transitionByName because it is key-optional");

console.log(`\nsandbox-api-spec: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
