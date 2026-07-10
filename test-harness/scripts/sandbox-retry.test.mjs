/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * OFFLINE unit test for the sandbox retry-idempotency guard (retryingRequestJira in
 * src/index.js). Extracts the REAL shipped `isRetriable` predicate + TRANSIENT_REST set
 * via fs and evaluates them — asserts the method×status retry truth table so a
 * non-idempotent POST is never retried on a (possibly-after-commit) 5xx.
 *   node test-harness/scripts/sandbox-retry.test.mjs   # exits 1 on any failure
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "..", "..", "src", "index.js"), "utf8");

const trMatch = SRC.match(/const TRANSIENT_REST = (\[[^\]]*\]);/);
const irMatch = SRC.match(/const isRetriable =([\s\S]*?);/);
if (!trMatch || !irMatch) { console.error("FAIL: could not locate TRANSIENT_REST / isRetriable in source"); process.exit(2); }
const TRANSIENT_REST = JSON.parse(trMatch[1]);
const arrowExpr = irMatch[1].trim();

function isRetriableFor(httpMethod) {
  // The eval'd arrow closes over `httpMethod` (this param) and `TRANSIENT_REST` (module const),
  // exactly the two names it references in the shipped source.
  // eslint-disable-next-line no-eval
  return eval(`(${arrowExpr})`);
}

let pass = 0, fail = 0;
const check = (method, status, want) => {
  const got = !!isRetriableFor(method)(status);
  if (got === want) pass++;
  else { fail++; console.log(`  FAIL ${method} ${status}: want retriable=${want}, got ${got}`); }
};

// Sanity: the transient set is the documented one.
if (JSON.stringify(TRANSIENT_REST) !== JSON.stringify([429, 502, 503, 504])) {
  fail++; console.log(`  FAIL TRANSIENT_REST changed: ${JSON.stringify(TRANSIENT_REST)}`);
} else pass++;

// POST (non-idempotent): ONLY 429 is safe to retry.
check("POST", 429, true);
for (const s of [502, 503, 504, 500, 200, 409]) check("POST", s, false);

// Idempotent verbs: retry on every transient code, not on others.
for (const m of ["GET", "PUT", "DELETE"]) {
  for (const s of [429, 502, 503, 504]) check(m, s, true);
  for (const s of [200, 500, 400, 404, 409]) check(m, s, false);
}

// Default (unspecified method → "GET" upstream) behaves idempotently.
check("GET", 503, true);

console.log(`\nsandbox retry idempotency: ${pass}/${pass + fail} assertions passed.`);
process.exit(fail ? 1 : 0);
