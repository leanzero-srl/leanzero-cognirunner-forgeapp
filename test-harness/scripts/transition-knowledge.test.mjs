/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import "../lib/register-mocks-index.mjs";
import assert from "node:assert/strict";
import storage from "../lib/mock-kvs.mjs";
import { TRANSITION_API_REFERENCE, ARRAY_FIELDS_API_REFERENCE, AGILE_API_REFERENCE, API_SIGNATURE_REFERENCE, FIELD_TYPE_TABLE, SANDBOX_API_METHODS } from "../../src/shared/sandbox-api-spec.js";
import { BUILTIN_DOCS, DOC_SEED_VERSION } from "../../src/shared/builtin-docs.js";
import { BUILTIN_SKILLS, SKILL_SEED_VERSION } from "../../src/shared/builtin-skills.js";

// Load Forge consumers only after registering the actual-index mock loader.
const { handler } = await import("../../src/index.js");
const { seedBuiltinSkills } = await import("../../src/skills.js");
const { default: forgeApi } = await import("@forge/api");

// A version bump updates content while retaining an admin's disabled state.
// Run the actual seeders, since a source-text check would miss row resurrection.
const docId = "builtin_doc_transitions";
const skillId = "builtin_skill_transitions";
storage.__seed("doc_repo_index", [{ id: docId, disabled: true, createdAt: "kept-doc-date" }]);
storage.__seed("doc_repo_seed_meta", { seedVersion: DOC_SEED_VERSION - 1 });
storage.__seed("skill_repo_index", [{ id: skillId, enabled: false, createdAt: "kept-skill-date" }]);
storage.__seed("skill_repo_seed_meta", { seedVersion: SKILL_SEED_VERSION - 1 });

const result = await handler({ call: { functionKey: "getContextDocs", payload: {} }, context: {} }, {});
assert.equal(result.success, true);
await seedBuiltinSkills();
const doc = await storage.get(`doc_repo:${docId}`);
const skill = await storage.get(`skill_repo:${skillId}`);
assert.equal(doc.disabled, true);
assert.equal(doc.createdAt, "kept-doc-date");
assert.equal(skill.enabled, false);
assert.equal(skill.createdAt, "kept-skill-date");
assert.equal(doc.content, BUILTIN_DOCS.find((d) => d.id === docId).content);
assert.equal(skill.instructions, BUILTIN_SKILLS.find((s) => s.id === skillId).instructions);
assert.ok(doc.content.includes(TRANSITION_API_REFERENCE));
assert.ok(skill.instructions.includes(TRANSITION_API_REFERENCE));
for (const name of ["transitionIssue", "transitionByName", "transitionSubtasks", "transitionParent"]) {
  const method = SANDBOX_API_METHODS.find((m) => m.name === name);
  assert.ok(TRANSITION_API_REFERENCE.includes(method.promptDoc), `${name} documentation remains spec-derived`);
}
assert.ok(SANDBOX_API_METHODS.find((m) => m.name === "transitionIssue").signature.includes("extra?"));
for (const text of [doc.content, skill.instructions, skill.examples]) {
  assert.doesNotMatch(text, /ONLY transition operation|CANNOT look up transitions|cannot pass fields|Fields cannot be set during a sandbox transition/i);
}
assert.equal((await storage.get("doc_repo_index")).find((d) => d.id === docId).disabled, true);
assert.equal((await storage.get("skill_repo_index")).find((s) => s.id === skillId).enabled, false);
assert.equal((await storage.get("doc_repo_seed_meta")).seedVersion, DOC_SEED_VERSION);
assert.equal((await storage.get("skill_repo_seed_meta")).seedVersion, SKILL_SEED_VERSION);
assert.ok(FIELD_TYPE_TABLE.find((f) => f.fieldType === "Sprint").write.includes("api.moveToSprint"));
assert.ok(BUILTIN_DOCS.find((d) => d.id === "builtin_doc_sandbox").content.includes(API_SIGNATURE_REFERENCE));
for (const [id, reference, actions] of [
  ["builtin_skill_array_fields", ARRAY_FIELDS_API_REFERENCE, ["editIssue", "editIssue"]],
  ["builtin_skill_agile_fields", AGILE_API_REFERENCE, ["updateIssue", "moveToSprint"]],
]) {
  const entry = BUILTIN_SKILLS.find((s) => s.id === id);
  assert.ok(entry.instructions.includes(reference), `${id} consumes the spec reference`);
  assert.doesNotMatch(entry.instructions + entry.examples, /sandbox only sets fields|sandbox cannot move issues between sprints|unavailable in this sandbox/i);
  forgeApi.__calls.length = 0;
  const preview = await handler({ call: { functionKey: "testPostFunction", payload: { issueKey: "ABC-1", code: entry.examples } }, context: {} }, {});
  assert.equal(preview.success, true, JSON.stringify(preview));
  assert.deepEqual(preview.changes.map((c) => c.action), actions);
  assert.ok(preview.changes.every((c) => c.simulated === true));
  assert.equal(forgeApi.__calls.length, 0, `${id} example stages writes without calling Jira`);
}
console.log("transition knowledge: spec-derived content, runnable array/agile examples and disabled-row reseed assertions passed");
