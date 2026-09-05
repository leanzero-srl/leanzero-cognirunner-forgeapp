/* CogniRunner - Copyright (C) 2025 LeanZero. SPDX-License-Identifier: AGPL-3.0-or-later */
import assert from "node:assert/strict";
import { objectKeyVerdict } from "../lib/object-key-verdict.mjs";
const line = '[ABC-1] tool ERROR add_labels({"issueKey":{"key":"ABC-2"},"labels":["test"]}) → add_labels: issueKey must be an issue key like "PROJ-123" or a numeric issue ID string; pass the key, not an issue object.';
assert.equal(objectKeyVerdict({}, { logs: [line] }, [], [], "test").verdict, "PROVEN");
assert.equal(objectKeyVerdict({ result: { logs: [line] } }, {}, [], ["test"], "test").verdict, "FAILED");
assert.equal(objectKeyVerdict({}, { reason: line }, [], [], "test").verdict, "INCONCLUSIVE");
assert.equal(objectKeyVerdict({}, { logs: ['tool add_labels({"issueKey":"ABC-2"})'] }, [], [], "test").verdict, "INCONCLUSIVE");
assert.equal(objectKeyVerdict({}, { logs: [line.slice(0, 95)] }, [], [], "test").verdict, "INCONCLUSIVE");
console.log("object-key verdict: actual rejection, second reads and inconclusive traces passed");
