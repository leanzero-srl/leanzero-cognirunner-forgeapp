/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * F-626 — THE VIEWER FLOOR ON EVERY KNOWLEDGE *CONTENT* READER, ASSERTED AT ONCE.
 *
 * F-228 gated the memory reads, F-235 gated the doc/skill index reads and
 * getKnowledgeCounts — and `getContextDocContent`, the one door that returns a whole
 * document BODY, was left with no gate at all: no role floor, no licence. A caller
 * off the roster read any curated reference by id, and the "Document not found"
 * sentence told it which ids exist.
 *
 * The rule has one shape and this suite walks every door that carries it, because it
 * has now been re-opened twice by fixes to neighbouring doors:
 *   1. a caller with no role gets the `noPerm(..., "viewer")` refusal and NO body;
 *   2. a roster VIEWER gets the body (the floor is a floor, not a lock — docs,
 *      skills and memories are ORG-WIDE SHARED content, so no ownership gate);
 *   3. an unknown id, for a caller who passed the floor, answers plain not-found.
 *
 * Run: node scripts/read-floors.test.mjs (auto-discovered by run-offline.mjs)
 */

import "../lib/register-mocks-index.mjs";
import storage from "../lib/mock-kvs.mjs";
const { default: forgeApi } = await import("@forge/api");
const { handler } = await import("../../src/index.js");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const ADMIN = "acct-admin";
const VIEWER = "acct-viewer";
const OUTSIDER = "acct-outsider";

storage.__seed("app_admins", [
  { accountId: ADMIN, role: "admin", scope: "all" },
  { accountId: VIEWER, role: "viewer", scope: "all" },
]);
storage.__seed("COGNIRUNNER_AI_PROVIDER", "openai");

// The OUTSIDER must be refused on EVIDENCE, not on a mock that declines to answer:
// Jira says ADMINISTER:false and the admin groups answer 200 with no members, so
// getUserPermissions returns a real "no role" rather than the fail-closed unknown.
forgeApi.__respond((path) => {
  if (path.includes("mypermissions")) return forgeApi.__response(200, { permissions: { ADMINISTER: { havePermission: false } } });
  if (path.includes("group/member")) return forgeApi.__response(200, { values: [] });
  return forgeApi.__response(200, {});
});

const call = (functionKey, payload = {}, accountId = ADMIN) =>
  handler({ call: { functionKey, payload }, context: {} }, { principal: { accountId } });

const DOC = { id: "doc-parity-1", title: "House ADF conventions", content: "the body nobody off the roster may read" };
storage.__seed("doc_repo_index", [{ id: DOC.id, title: DOC.title, createdBy: ADMIN, disabled: false }]);
storage.__seed(`doc_repo:${DOC.id}`, DOC);

const SKILL = { id: "skill-parity-1", name: "Parity skill", instructions: "the instructions nobody off the roster may read" };
storage.__seed("skill_repo_index", [{ id: SKILL.id, name: SKILL.name, enabled: true }]);
storage.__seed(`skill_repo:${SKILL.id}`, SKILL);

storage.__seed("pf_memories", [{ id: "m1", content: "a learned fact about this instance", source: "user", confidence: 1, disabled: false }]);
storage.__seed("pf_code:rule-1:abc", { functions: [{ id: "f1", code: "api.log(1)" }] });

/* ═════ 1. the refusal shape is ONE shape, at every content door ═════ */

const REFUSED = [
  ["getContextDocContent", { id: DOC.id }, "read documentation"],
  ["getContextDocs", {}, "read documentation"],
  ["getSkillContent", { id: SKILL.id }, "read skills"],
  ["getSkills", {}, "read skills"],
  ["getMemories", {}, "read memories"],
  ["getMemoryStoreStats", {}, "read memories"],
  ["getMemorySettings", {}, "read memory settings"],
  ["getKnowledgeCounts", {}, "read knowledge counts"],
  ["getKnowledgePacks", {}, "read the knowledge packs"],
  ["getPostFunctionCode", { codeRef: "pf_code:rule-1:abc" }, "read post-function code"],
];

for (const [fn, payload, what] of REFUSED) {
  const r = await call(fn, payload, OUTSIDER);
  ok(r && r.success === false && r.reason === "no-permission" && r.hint === "ask-app-admin" && r.needsRole === "viewer"
    && r.error === `You don't have permission to ${what}.`,
    `${fn} refuses a caller with no role in the ONE noPerm shape (got ${JSON.stringify(r)})`);
  // and the refusal carries no payload — this is the whole point of the floor
  const blob = JSON.stringify(r);
  ok(!blob.includes("nobody off the roster may read") && !blob.includes("a learned fact about this instance")
    && !blob.includes("api.log(1)") && !blob.includes(DOC.title) && !blob.includes(SKILL.name),
    `${fn}'s refusal leaks no content`);
}

/* ═════ 2. a roster VIEWER still reads everything — org-wide shared content ═════ */

const docAsViewer = await call("getContextDocContent", { id: DOC.id }, VIEWER);
ok(docAsViewer.success === true && docAsViewer.doc?.content === DOC.content,
  `a viewer reads the document body (got ${JSON.stringify(docAsViewer)})`);
ok((await call("getSkillContent", { id: SKILL.id }, VIEWER)).skill?.instructions === SKILL.instructions,
  "a viewer reads the skill body");
ok((await call("getMemories", {}, VIEWER)).memories?.length === 1, "a viewer reads the memories");
ok((await call("getContextDocs", {}, VIEWER)).success === true, "a viewer reads the doc index");

// the viewer is NOT the author of the doc: the floor is a ROLE floor, never an
// ownership gate. If this ever starts failing, somebody has put a canActOnConfig on a READ.
ok(docAsViewer.doc?.content === DOC.content && VIEWER !== ADMIN,
  "the floor is a ROLE floor — a viewer who did not author the doc still reads it");

/* ═════ 3. past the floor, an unknown id is a plain not-found ═════ */

const missing = await call("getContextDocContent", { id: "doc-does-not-exist" }, VIEWER);
ok(missing.success === false && missing.error === "Document not found" && missing.reason !== "no-permission",
  `an unknown id answers plain not-found for a caller past the floor (got ${JSON.stringify(missing)})`);
ok(missing.doc === undefined, "…and carries no doc");

console.log(`\nread-floors (F-626): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
