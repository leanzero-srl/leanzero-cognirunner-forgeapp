/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline: src/shared/confluence-endpoints.js.
// The catalogue exists to be the ONE Confluence endpoint list, in the SAME shape as
// jira-endpoints.js, so the picker and the prompt builder need no product branch.
// This test is what keeps the two from drifting: entry keys must match exactly, every
// path must start with /wiki/, the five plan §3.12 categories must all be present, and
// the prompt block must group, include bodies on request and honour maxBytes.
// Run: node scripts/confluence-endpoints.test.mjs   (auto-discovered by run-offline.mjs)

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const cUrl = path.join(here, "..", "..", "src", "shared", "confluence-endpoints.js");
const jUrl = path.join(here, "..", "..", "src", "shared", "jira-endpoints.js");

const c = await import(cUrl);
const j = await import(jUrl);

const CONFLUENCE = c.default;
const JIRA = j.default;

let checks = 0;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };
const eq = (a, b, msg) => { checks++; assert.deepEqual(a, b, msg); };

/* ---- exports ---- */
ok(Array.isArray(CONFLUENCE) && CONFLUENCE.length > 0, "default export is a non-empty array");
ok(c.CONFLUENCE_ENDPOINT_VERSION === 1, "CONFLUENCE_ENDPOINT_VERSION is exported and is 1");
ok(Array.isArray(c.CONFLUENCE_ENDPOINT_CATEGORIES), "CONFLUENCE_ENDPOINT_CATEGORIES is exported");
ok(typeof c.buildConfluenceEndpointPromptBlock === "function", "buildConfluenceEndpointPromptBlock is exported");

/* ---- shape parity with jira-endpoints.js ---- */
const jiraKeys = [...new Set(JIRA.flatMap((e) => Object.keys(e)))].sort();
for (const e of CONFLUENCE) {
  eq(Object.keys(e).sort(), jiraKeys,
    `entry "${e.method} ${e.path} — ${e.description}" has exactly the jira-endpoints key set`);
  ok(typeof e.category === "string" && e.category.length > 0, `${e.path}: category is a non-empty string`);
  ok(["GET", "POST", "PUT", "DELETE"].includes(e.method), `${e.path}: method is a known verb (${e.method})`);
  ok(typeof e.description === "string" && e.description.length > 0, `${e.path}: has a one-line description`);
  ok(e.params === null || typeof e.params === "string", `${e.path}: params is null or a string`);
  ok(e.body === null || typeof e.body === "string", `${e.path}: body is null or a string template`);
  ok(typeof e.notes === "string" && e.notes.length > 0, `${e.path}: has notes`);
}

/* ---- the /wiki/ prefix: what requestConfluence expects ---- */
for (const e of CONFLUENCE) {
  ok(e.path.startsWith("/wiki/"), `path starts with /wiki/ (${e.path})`);
}

/* ---- every body template parses as JSON (a broken template teaches the model a broken body) ---- */
for (const e of CONFLUENCE) {
  if (!e.body) continue;
  checks++;
  assert.doesNotThrow(() => JSON.parse(e.body), `${e.description}: body template is valid JSON`);
}

/* ---- the five plan §3.12 categories ---- */
eq(c.CONFLUENCE_ENDPOINT_CATEGORIES,
  ["Pages", "Search (CQL)", "Spaces", "Comments", "Attachments"],
  "categories are exactly the plan's five, in order");
for (const cat of c.CONFLUENCE_ENDPOINT_CATEGORIES) {
  ok(CONFLUENCE.some((e) => e.category === cat), `category ${cat} has at least one entry`);
}

/* ---- the install probe is in the catalogue (the client calls the endpoint the catalogue documents) ---- */
ok(CONFLUENCE.some((e) => e.method === "GET" && e.path === "/wiki/api/v2/spaces" && e.params === "?limit=1"),
  "the /wiki/api/v2/spaces?limit=1 install probe is catalogued");

/* ---- prompt block ---- */
const block = c.buildConfluenceEndpointPromptBlock();
ok(block.includes("PAGES:") && block.includes("SEARCH (CQL):") && block.includes("ATTACHMENTS:"),
  "prompt block groups by upper-cased category");
ok(block.includes("GET /wiki/api/v2/pages/{id}"), "prompt block carries method + path");
ok(!block.includes("```json"), "prompt block omits body templates by default");

const withBodies = c.buildConfluenceEndpointPromptBlock({ includeBodies: true, maxBytes: 100000 });
ok(withBodies.includes("```json"), "includeBodies emits fenced body templates");
ok(withBodies.includes('"spaceId"'), "the create-page body template reaches the prompt block");

const only = c.buildConfluenceEndpointPromptBlock({ categories: ["Spaces"] });
ok(only.includes("SPACES:") && !only.includes("PAGES:"), "categories filter selects a subset");

const tiny = c.buildConfluenceEndpointPromptBlock({ maxBytes: 200 });
ok(tiny.length <= 200 + "\n…[endpoint list truncated]".length, "maxBytes is honoured");
ok(tiny.endsWith("…[endpoint list truncated]"), "an over-budget block is marked truncated");

/* ---- no duplicate (method, path, description) triples ---- */
const seen = new Set();
for (const e of CONFLUENCE) {
  const k = `${e.method} ${e.path} ${e.description}`;
  ok(!seen.has(k), `no duplicate entry: ${k}`);
  seen.add(k);
}

console.log(`confluence-endpoints: ${checks} passed, 0 failed`);
