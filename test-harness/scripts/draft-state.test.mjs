/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// F-990 — THE DRAFT RULE, PINNED.
//
// `src/shared/draft-state.js` decides what an unfinished admin form is allowed to leave
// in browser storage. The expensive failure is not "a draft did not come back"; it is a
// credential written to localStorage where it outlives the session, so the bulk of this
// file is the exclusion, from both directions:
//
//   1. Every name in DRAFT_SECRET_FIELDS is actually dropped (the NAMED list works).
//   2. A name NOBODY listed - `myNewToken` - is dropped anyway (the SHAPE belt works).
//      This is the case that matters, because it is the only one that covers the field a
//      future commit adds to OpenAIConfig without reading this file.
//   3. An ordinary sibling in the same object SURVIVES, or the feature is a no-op that
//      would pass 1 and 2 trivially.
//
// The rest pins the four ways a draft is refused: a foreign version stamp, age, a key we
// will not name, and size.
//
// Run: node scripts/draft-state.test.mjs   (auto-discovered by run-offline.mjs)

import {
  DRAFT_VERSION,
  DRAFT_TTL_DAYS,
  DRAFT_FORM_IDS,
  DRAFT_SECRET_FIELDS,
  DRAFT_MAX_CHARS,
  draftKey,
  isDraftFormId,
  isSecretishKey,
  isExcludedDraftField,
  pruneDraft,
  serializeDraft,
  deserializeDraft,
  isDraftStale,
  draftAgeLabel,
} from "../../src/shared/draft-state.js";
import { DRAFT_TTL_DAYS as TTL_FROM_LIMITS } from "../../src/shared/registry-limits.js";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

/* ── 1. the number has ONE home ─────────────────────────────────────────────────────── */
ok(DRAFT_TTL_DAYS === TTL_FROM_LIMITS,
  "DRAFT_TTL_DAYS is re-exported from registry-limits, not retyped");
ok(typeof DRAFT_TTL_DAYS === "number" && DRAFT_TTL_DAYS > 0, "the TTL is a positive number of days");

/* ── 2. every NAMED secret field is dropped, at the top level and nested ────────────── */
for (const name of DRAFT_SECRET_FIELDS) {
  const pruned = pruneDraft({ [name]: "SENTINEL-VALUE", keep: "kept" });
  ok(!(name in pruned), `pruneDraft drops the named field ${name}`);
  ok(pruned.keep === "kept", `pruneDraft keeps the sibling of ${name}`);
  ok(isExcludedDraftField(name), `isExcludedDraftField knows ${name}`);
  // and one level down, because these forms nest (wizard -> step -> generation state)
  const deep = pruneDraft({ step: { [name]: "SENTINEL-VALUE", label: "l" } });
  ok(!(name in deep.step), `pruneDraft drops ${name} nested one level down`);
  ok(deep.step.label === "l", `pruneDraft keeps the nested sibling of ${name}`);
}

/* ── 3. THE BELT: a name nobody listed, dropped by shape ────────────────────────────── */
const NOVEL = ["myNewToken", "someSecretThing", "GitHubBearer", "providerApiKey",
  "api_key_2", "userPassword", "svcCredential", "brandNewKeyInput", "pendingTaskId"];
for (const name of NOVEL) {
  ok(DRAFT_SECRET_FIELDS.indexOf(name) === -1, `${name} is deliberately NOT in the named list`);
  ok(isSecretishKey(name), `the shape belt recognises ${name}`);
  const pruned = pruneDraft({ [name]: "SENTINEL-VALUE", label: "kept" });
  ok(!(name in pruned), `pruneDraft drops the unlisted ${name} by shape`);
  ok(pruned.label === "kept", `and still keeps label beside ${name}`);
}
// The belt must not be so wide it eats ordinary form state.
for (const name of ["label", "repos", "kind", "appName", "branch", "hasChanges",
  "hasCustomUi", "title", "content", "prompt", "category", "site", "product"]) {
  ok(!isExcludedDraftField(name), `${name} is ordinary form state and survives`);
}
// A whole serialize round trip carries no sentinel anywhere in the string.
const withSecrets = {
  label: "my connection", repos: ["a/b", "c/d"], kind: "github",
  token: "ghp_SENTINEL", identityEmail: "SENTINEL@example.com", myNewToken: "SENTINEL-NOVEL",
  step: { name: "step one", taskId: "SENTINEL-TASK", generating: true },
};
const rawMixed = serializeDraft(withSecrets, 1000);
ok(typeof rawMixed === "string" && !/SENTINEL/.test(rawMixed),
  "a serialized draft contains no sentinel from any excluded field");
ok(/my connection/.test(rawMixed) && /a\/b/.test(rawMixed) && /step one/.test(rawMixed),
  "and the non-secret siblings, including nested ones, ARE present");

/* ── 4. version bump discards ───────────────────────────────────────────────────────── */
const good = serializeDraft({ label: "x" }, 5000);
ok(deserializeDraft(good) !== null, "a current-version draft reads back");
ok(deserializeDraft(good).data.label === "x", "and carries its value");
ok(deserializeDraft(good).savedAt === 5000, "and its savedAt stamp");
const foreign = JSON.stringify({ v: DRAFT_VERSION + 1, savedAt: 5000, data: { label: "x" } });
ok(deserializeDraft(foreign) === null, "a draft from a FUTURE version is discarded, not migrated");
const older = JSON.stringify({ v: DRAFT_VERSION - 1, savedAt: 5000, data: { label: "x" } });
ok(deserializeDraft(older) === null, "a draft from an OLDER version is discarded");
ok(deserializeDraft(JSON.stringify({ savedAt: 1, data: { a: 1 } })) === null, "an unstamped draft is discarded");
// and nothing hostile throws
for (const bad of ["", "{", "null", "[]", '"str"', "123", JSON.stringify({ v: DRAFT_VERSION, data: 5 }), undefined, null, 7, {}]) {
  let threw = false, out;
  try { out = deserializeDraft(bad); } catch (e) { threw = true; }
  ok(!threw && out === null, `deserializeDraft refuses ${JSON.stringify(bad)} without throwing`);
}

/* ── 5. the TTL boundary ────────────────────────────────────────────────────────────── */
const DAY = 86400000;
const now = 1_000_000_000_000;
ok(isDraftStale(now - (DRAFT_TTL_DAYS * DAY) + 1000, now) === false,
  "a draft one second inside the TTL is fresh");
ok(isDraftStale(now - (DRAFT_TTL_DAYS * DAY), now) === false,
  "a draft exactly AT the TTL is still fresh (the boundary is inclusive)");
ok(isDraftStale(now - (DRAFT_TTL_DAYS * DAY) - 1, now) === true,
  "one millisecond past the TTL is stale");
ok(isDraftStale(0, now) === true, "a zero stamp is stale");
ok(isDraftStale(null, now) === true && isDraftStale("nope", now) === true,
  "an unreadable stamp is stale, never treated as new");
ok(isDraftStale(now + 60000, now) === false, "a clock-skewed future stamp is not called stale");

/* ── 6. draftKey: the vocabulary is closed and the parts cannot inject ──────────────── */
ok(draftKey("5b10a2", DRAFT_FORM_IDS.CODE_PIPELINE) === "cr-draft:5b10a2:code-pipeline",
  "draftKey builds cr-draft:<accountId>:<formId>");
ok(draftKey(null, DRAFT_FORM_IDS.CODE_PIPELINE) === null,
  "a null accountId yields no key (the panel sets it async; a draft must never key on null)");
ok(draftKey("", DRAFT_FORM_IDS.CODE_PIPELINE) === null, "an empty accountId yields no key");
ok(draftKey(undefined, DRAFT_FORM_IDS.DOC_ADD) === null, "an undefined accountId yields no key");
ok(draftKey("5b10a2", "not-a-form") === null, "a form id outside the vocabulary yields no key");
ok(draftKey("5b10a2", "") === null && draftKey("5b10a2", null) === null, "a missing form id yields no key");
for (const id of Object.values(DRAFT_FORM_IDS)) {
  ok(isDraftFormId(id), `${id} is in the vocabulary`);
  ok(typeof draftKey("acct", id) === "string", `${id} names a key`);
  ok(/^[a-z0-9-]+$/.test(id), `${id} is a plain kebab id`);
}
// key injection: a hostile accountId must not be able to reach another form's row or
// invent a third segment.
const hostile = [
  "a:code-pipeline",          // would land on another form's key
  "../../etc",
  "a b/c",
  "a\nb",
  "a}{\"x\":1}",
  "a:" + DRAFT_FORM_IDS.DOC_ADD,
];
for (const h of hostile) {
  const k = draftKey(h, DRAFT_FORM_IDS.CODE_PIPELINE);
  ok(typeof k === "string", `draftKey still names a key for ${JSON.stringify(h)}`);
  ok(k.split(":").length === 3,
    `a hostile accountId cannot add a segment: ${JSON.stringify(h)} -> ${k}`);
  ok(k.endsWith(":" + DRAFT_FORM_IDS.CODE_PIPELINE),
    `a hostile accountId cannot redirect the form segment: ${k}`);
  ok(!/[^a-zA-Z0-9:._#-]/.test(k), `the built key has no unsafe characters: ${k}`);
}
ok(draftKey(":::", DRAFT_FORM_IDS.DOC_ADD) === null,
  "an all-colon accountId sanitises to nothing and yields no key rather than fanning out");
ok(draftKey("-", DRAFT_FORM_IDS.DOC_ADD) === null, "an accountId that sanitises to nothing yields no key");
ok(draftKey("///", DRAFT_FORM_IDS.DOC_ADD) === null, "an accountId of only unsafe characters yields no key");
ok(draftKey("x".repeat(500), DRAFT_FORM_IDS.DOC_ADD).length < 200, "a hostile long accountId is clamped");

/* ── 7. the size clamp ──────────────────────────────────────────────────────────────── */
const small = serializeDraft({ body: "x".repeat(1000) });
ok(typeof small === "string" && small.length < DRAFT_MAX_CHARS, "an ordinary draft serialises");
const huge = serializeDraft({ body: "x".repeat(DRAFT_MAX_CHARS + 10) });
ok(huge === null, "a draft over the clamp is not written at all");
ok(serializeDraft({}) === null, "an empty draft is not written");
ok(serializeDraft(null) === null && serializeDraft(undefined) === null, "nothing is not written");
ok(serializeDraft({ onChange: () => {}, ref: { current: 1 } }) !== null,
  "a draft whose only real content is a ref still serialises the ref's plain object");
ok(serializeDraft({ onChange: () => {} }) === null,
  "a draft of nothing but functions is not written");

/* ── 8. prune refuses the unserialisable rather than corrupting it ──────────────────── */
const exotic = pruneDraft({
  fn: () => {}, map: new Map([["a", 1]]), set: new Set([1]),
  when: new Date(0), nan: NaN, inf: Infinity, n: 5, s: "s", b: false,
  arr: [1, () => {}, "three"], nested: { deep: { deeper: { ok: 1 } } },
});
ok(!("fn" in exotic) && !("map" in exotic) && !("set" in exotic), "functions, Maps and Sets are dropped");
ok(!("nan" in exotic) && !("inf" in exotic), "non-finite numbers are dropped");
ok(exotic.when === new Date(0).toISOString(), "a Date becomes its ISO string");
ok(exotic.n === 5 && exotic.s === "s" && exotic.b === false, "plain scalars survive, including false");
ok(Array.isArray(exotic.arr) && exotic.arr.length === 3 && exotic.arr[1] === null,
  "an array keeps its POSITIONS, with an unserialisable element nulled rather than removed");
ok(exotic.nested.deep.deeper.ok === 1, "nesting survives");
// a cycle must cost a truncated draft, never a stack overflow in the admin panel
const cyclic = { label: "x" }; cyclic.self = cyclic;
let cycleThrew = false;
try { pruneDraft(cyclic); } catch (e) { cycleThrew = true; }
ok(!cycleThrew, "a cyclic state does not blow the stack");
ok(serializeDraft(cyclic) !== null, "and still yields a writable draft");

/* ── 9. the age label, and the house rule on dashes ─────────────────────────────────── */
const labels = [
  draftAgeLabel(now, now), draftAgeLabel(now - 60000, now), draftAgeLabel(now - 300000, now),
  draftAgeLabel(now - 3600000, now), draftAgeLabel(now - 7200000, now),
  draftAgeLabel(now - DAY, now), draftAgeLabel(now - 3 * DAY, now),
];
ok(labels[0] === "a moment ago" && labels[1] === "1 minute ago" && labels[2] === "5 minutes ago",
  "minute labels read naturally");
ok(labels[3] === "1 hour ago" && labels[4] === "2 hours ago", "hour labels read naturally");
ok(labels[5] === "1 day ago" && labels[6] === "3 days ago", "day labels read naturally");
ok(labels.every((l) => !/[–—]/.test(l)), "no em or en dashes in the copy");

console.log(`\ndraft-state: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
