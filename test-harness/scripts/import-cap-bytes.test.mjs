/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// F-875 — THE IMPORT DOOR'S SIZE CAP IS A BYTE CAP, SO IT MUST BE MEASURED IN BYTES.
//
// `EXPORT_CAPS.maxBytes` (src/shared/rule-portability.js) is 1 MB "of import text".
// `previewImport` compared it against `String.length`, which counts UTF-16 code units:
// every CJK code point is 1 unit and 3 UTF-8 bytes, so a 3 MB import measured 1 M and
// went through — three times the budget, on a path that then parses it and resolves
// bindings for up to 50 rules inside a 25 s resolver.
//
// This suite drives the REAL resolver (same shape as agent-gate-resolvers.test.mjs) and
// asserts BOTH directions, because a cap that refuses everything is not a fix:
//   1. CJK text under the CHAR count but over the BYTE cap is REFUSED, and refused
//      BEFORE anything happens — the payload is deliberately invalid JSON, so if the
//      cap ever stopped firing first the error would be the parse error instead.
//   2. An ASCII payload inside the byte cap still reaches the parse/schema stage.
//   3. Exactly-at-the-cap is ADMITTED (the comparison is strictly `>`), which is the
//      boundary a byte/char confusion would move.
//
// Run: node scripts/import-cap-bytes.test.mjs   (auto-discovered by run-offline.mjs)

import "../lib/register-mocks-index.mjs";
import storage from "../lib/mock-kvs.mjs";
import { EXPORT_CAPS } from "../../src/shared/rule-portability.js";
const { default: forgeApi } = await import("@forge/api");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const EDITOR = "acct-editor";
await storage.set("COGNIRUNNER_AI_PROVIDER", "openai");
await storage.set("app_admins", [{ accountId: EDITOR, role: "editor", scope: "all" }]);
forgeApi.__respond(() => forgeApi.__response(200, {}));

const { handler } = await import("../../src/index.js");
const call = (functionKey, payload = {}, accountId = EDITOR) =>
  handler({ call: { functionKey, payload }, context: {} }, { principal: { accountId } });

const bytesOf = (s) => new TextEncoder().encode(s).length;
const TOO_LARGE = /too large/i;

/* ===== 1. CJK: under the char count, over the byte cap → refused ===== */
{
  // Not valid JSON on purpose: the ONLY way this answers "too large" is if the cap
  // is checked before the parse, which is the commitImportCore ordering lesson.
  const cjk = "一".repeat(Math.floor(EXPORT_CAPS.maxBytes * 0.9));
  ok(cjk.length <= EXPORT_CAPS.maxBytes, `fixture is inside the cap when counted in CHARS (${cjk.length})`);
  ok(bytesOf(cjk) > EXPORT_CAPS.maxBytes, `fixture is over the cap when counted in BYTES (${bytesOf(cjk)})`);
  const res = await call("previewImport", { json: cjk });
  ok(res && res.success === false, "an over-byte-cap CJK import is refused");
  ok(res && TOO_LARGE.test(String(res.error)), `refused BY THE CAP, before the parse (got: ${res && res.error})`);
}

/* ===== 2. an ASCII payload inside the cap is NOT refused by the cap ===== */
{
  const small = JSON.stringify({ kind: "cognirunner-rules-export", schemaVersion: 1, rules: [] });
  const res = await call("previewImport", { json: small });
  ok(res && !TOO_LARGE.test(String(res.error || "")), "a small payload is never refused by the size cap");
}

/* ===== 3. the boundary: exactly maxBytes is admitted, one byte more is not ===== */
{
  const atCap = "a".repeat(EXPORT_CAPS.maxBytes);
  ok(bytesOf(atCap) === EXPORT_CAPS.maxBytes, "boundary fixture is exactly maxBytes");
  const at = await call("previewImport", { json: atCap });
  ok(at && !TOO_LARGE.test(String(at.error || "")), "exactly maxBytes is admitted (strict >)");
  const over = await call("previewImport", { json: `${atCap}a` });
  ok(over && over.success === false && TOO_LARGE.test(String(over.error)), "maxBytes + 1 byte is refused");
}

/* ===== 4. empty input is still the empty-input refusal, not a size refusal ===== */
{
  const res = await call("previewImport", { json: "" });
  ok(res && res.success === false && !TOO_LARGE.test(String(res.error)), "empty input keeps its own refusal reason");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
