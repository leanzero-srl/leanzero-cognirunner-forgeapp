/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline unit test for the Jira REST endpoint catalog (src/shared/jira-endpoints.js) — a PURE, dependency-free
// single-source-of-truth consumed by the Custom UI endpoint picker AND the backend AI prompts (suggestEndpoint +
// codegen via buildEndpointPromptBlock). Covers: catalog entry shape, ENDPOINT_CATEGORIES derivation, the prompt
// block lists endpoints, the categories filter, includeBodies toggle, and the maxBytes truncation edge.
//
// TRUNCATION CONTRACT (docstring: "Hard-trims at maxBytes with a truncation marker"): the CONTENT is sliced to
// exactly maxBytes, then a fixed 27-char marker "\n…[endpoint list truncated]" is appended. So the returned
// string is maxBytes+27 when truncated (the real backend call index.js:5631 uses maxBytes:8192 → 8219 and relies
// on this). "Never exceeds" is therefore asserted as: the content BEFORE the marker never exceeds maxBytes, and
// the only overflow is the constant marker. Run: node test-harness/scripts/jira-endpoints.test.mjs
import JIRA_ENDPOINTS, { buildEndpointPromptBlock, ENDPOINT_CATEGORIES } from "../../src/shared/jira-endpoints.js";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const MARKER = "\n…[endpoint list truncated]";
const MARKER_LEN = MARKER.length; // 27
const VALID_METHODS = new Set(["GET", "POST", "PUT", "DELETE", "PATCH"]);

// ============================================================================
// 1) Default export is the catalog array + basic sanity
// ============================================================================
ok(Array.isArray(JIRA_ENDPOINTS) && JIRA_ENDPOINTS.length > 20, "default export is a non-trivial endpoint array");

// ============================================================================
// 2) Catalog entry shape — every entry has the required keys with correct types
// ============================================================================
let allShape = true, allMethod = true, allPath = true, allDesc = true, allNotes = true, allParams = true, allBody = true;
for (const e of JIRA_ENDPOINTS) {
  // required own keys present (params/body/notes may be null but the key must exist)
  for (const k of ["category", "method", "path", "description", "params", "body", "notes"]) {
    if (!Object.prototype.hasOwnProperty.call(e, k)) allShape = false;
  }
  if (typeof e.method !== "string" || !VALID_METHODS.has(e.method)) allMethod = false;
  if (typeof e.path !== "string" || !e.path.startsWith("/rest/api/3/")) allPath = false;
  if (typeof e.description !== "string" || e.description.length === 0) allDesc = false;
  if (typeof e.notes !== "string" || e.notes.length === 0) allNotes = false;
  if (!(e.params === null || typeof e.params === "string")) allParams = false;
  if (!(e.body === null || typeof e.body === "string")) allBody = false;
}
ok(allShape, "every entry has category/method/path/description/params/body/notes keys");
ok(allMethod, "every entry.method is a valid HTTP verb (GET/POST/PUT/DELETE)");
ok(allPath, "every entry.path is a string under /rest/api/3/");
ok(allDesc, "every entry.description is a non-empty string");
ok(allNotes, "every entry.notes is a non-empty string");
ok(allParams, "every entry.params is null or a string");
ok(allBody, "every entry.body is null or a string");

// ============================================================================
// 3) ENDPOINT_CATEGORIES — derived, de-duplicated, complete, non-empty
// ============================================================================
ok(Array.isArray(ENDPOINT_CATEGORIES) && ENDPOINT_CATEGORIES.length > 0, "ENDPOINT_CATEGORIES is a non-empty array");
ok(new Set(ENDPOINT_CATEGORIES).size === ENDPOINT_CATEGORIES.length, "ENDPOINT_CATEGORIES has no duplicates");
ok(ENDPOINT_CATEGORIES.every((c) => JIRA_ENDPOINTS.some((e) => e.category === c)), "every category is backed by >=1 entry");
ok([...new Set(JIRA_ENDPOINTS.map((e) => e.category))].every((c) => ENDPOINT_CATEGORIES.includes(c)),
  "every entry's category appears in ENDPOINT_CATEGORIES (complete)");

// ============================================================================
// 4) The prompt block LISTS endpoints (default: no bodies, maxBytes 6144)
// ============================================================================
const full = buildEndpointPromptBlock({ maxBytes: 1e9, includeBodies: false }); // effectively un-truncated
ok(buildEndpointPromptBlock() === full, "no-arg call === explicit defaults (6144 fits the 6016-char no-body block, so no truncation)");
ok(full.includes("- GET /rest/api/3/issue/{issueIdOrKey}"), "block lists the GET issue endpoint in '- METHOD path' form");
ok(full.includes("- POST /rest/api/3/search/jql"), "block lists the POST search/jql endpoint");
ok(full.includes("ISSUES:") && full.includes("SEARCH:"), "category headers are uppercased with a colon");
ok(full.includes("/rest/api/3/issue/{issueIdOrKey}?fields=summary"), "params are concatenated onto the path");
ok(/— Get issue details \(/.test(full), "description follows an em-dash and notes follow in parentheses");
// every category header should appear in the un-filtered block
ok(ENDPOINT_CATEGORIES.every((c) => full.includes(`${c.toUpperCase()}:`)), "un-filtered block contains every category header");

// ============================================================================
// 5) includeBodies toggles the fenced JSON body templates
// ============================================================================
ok(!full.includes("Body template:") && !full.includes("```json"), "includeBodies:false omits body templates entirely");
const withBodies = buildEndpointPromptBlock({ maxBytes: 1e9, includeBodies: true });
ok(withBodies.includes("Body template:") && withBodies.includes("```json"), "includeBodies:true appends fenced 'Body template:' blocks");
ok(withBodies.includes('"outwardIssue"'), "a real body template (issueLink) is embedded verbatim when includeBodies:true");
ok(withBodies.length > full.length, "the with-bodies block is strictly larger than the no-bodies block");
// GET/DELETE entries have body:null and must never get a body block even with includeBodies
ok(!/GET \/rest\/api\/3\/myself[\s\S]*?Body template:/.test(
  buildEndpointPromptBlock({ categories: ["Users"], includeBodies: true, maxBytes: 1e9 })),
  "a body:null endpoint (GET /myself) gets no Body template even with includeBodies");

// ============================================================================
// 6) categories filter — subset, order follows the catalog, edge cases
// ============================================================================
const issuesOnly = buildEndpointPromptBlock({ categories: ["Issues"], maxBytes: 1e9 });
ok(issuesOnly.includes("ISSUES:") && !issuesOnly.includes("SEARCH:"), "categories:['Issues'] includes only the Issues section");
// arg order is ignored — output order follows ENDPOINT_CATEGORIES (catalog order: Issues before Search)
const reordered = buildEndpointPromptBlock({ categories: ["Search", "Issues"], maxBytes: 1e9 });
ok(reordered.indexOf("ISSUES:") < reordered.indexOf("SEARCH:"), "output order follows catalog order, not the categories-arg order");
ok(buildEndpointPromptBlock({ categories: ["NoSuchCategory"], maxBytes: 1e9 }) === "", "an unknown category yields an empty block");
ok(buildEndpointPromptBlock({ categories: [], maxBytes: 1e9 }) === "", "an empty categories array (truthy Set) filters out everything → ''");

// ============================================================================
// 7) maxBytes truncation edge — the byte-cap contract
// ============================================================================
// (a) no truncation when the block fits: length <= maxBytes and NO marker
ok(full.length <= 6016 + 1, "sanity: full no-body block is ~6016 chars"); // guards the fixtures below
const fits = buildEndpointPromptBlock({ maxBytes: full.length }); // strict '>' so exactly-equal does NOT truncate
ok(fits === full && !fits.endsWith(MARKER), "maxBytes == block length does not truncate (strict >), no marker");
ok(fits.length <= full.length, "un-truncated block never exceeds maxBytes");

// (b) truncation triggers one char under the boundary
const cut = buildEndpointPromptBlock({ maxBytes: full.length - 1 });
ok(cut.endsWith(MARKER), "one byte under the size → truncated, marker appended");
ok(cut.slice(0, full.length - 1) === full.slice(0, full.length - 1), "truncated content is a verbatim prefix of the full block");
ok(cut.slice(full.length - 1) === MARKER, "everything after maxBytes is exactly the marker (content capped at maxBytes)");
ok(cut.length === (full.length - 1) + MARKER_LEN, "truncated length == maxBytes + fixed marker length (only the marker overflows)");

// (c) a small cap: content is exactly maxBytes chars, then the marker
const tiny = buildEndpointPromptBlock({ maxBytes: 50 });
ok(tiny.slice(0, 50) === full.slice(0, 50) && tiny.slice(50) === MARKER, "maxBytes:50 → 50 content chars + marker");
ok(tiny.length === 50 + MARKER_LEN, "maxBytes:50 total length is 50 + marker (content never exceeds the cap)");

// (d) maxBytes:0 → no content, marker only
const zero = buildEndpointPromptBlock({ maxBytes: 0 });
ok(zero === MARKER, "maxBytes:0 → the marker only (empty content, still capped)");

// (e) mirror the REAL backend caller (index.js:5631) — with-bodies at 8192 exceeds 10841 so it truncates
const codegenBlock = buildEndpointPromptBlock({ includeBodies: true, maxBytes: 8192 });
ok(codegenBlock.endsWith(MARKER) && codegenBlock.length === 8192 + MARKER_LEN,
  "real caller shape: includeBodies+maxBytes:8192 truncates to 8192 content + marker");

// (f) the content-before-marker invariant holds for a spread of caps (never exceeds maxBytes)
let capHolds = true;
for (const cap of [10, 100, 1000, 3000, 6000, 6015]) {
  const b = buildEndpointPromptBlock({ maxBytes: cap, includeBodies: false });
  const content = b.endsWith(MARKER) ? b.slice(0, b.length - MARKER_LEN) : b;
  if (content.length > cap) capHolds = false;
}
ok(capHolds, "across many caps, the content before the marker never exceeds maxBytes");

console.log(`\njira-endpoints: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
