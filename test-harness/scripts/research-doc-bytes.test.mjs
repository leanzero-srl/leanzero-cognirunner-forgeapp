/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * F-855 - A RESEARCH DOCUMENT IS CAPPED IN THE UNIT THE CEILING IS IN.
 *
 * `persistResearchDoc` (src/index.js) used to `slice(0, 180000)` CHARACTERS and store
 * `contentLength: content.length`. The ceiling underneath is the 240KiB Forge KVS VALUE
 * limit, which is BYTES - the same mismatch F-836 fixed in `saveContextDoc`, left behind
 * on the one doc-writing path that has NO author in front of it. Research markdown is
 * model-authored from web sources, so non-ASCII prose is its normal case rather than its
 * edge case: 180,000 characters of CJK is roughly 540KB, three times the cap that was
 * supposed to hold it. It passed the slice, reached `storage.set`, and was refused by the
 * platform inside a catch that returns the platform's own sentence - naming no size, no
 * remedy, and no hint that the research had been done and then thrown away.
 *
 * WHAT IS ASSERTED
 *   1. A CJK document over the cap is TRUNCATED (not refused - nobody is there to be told)
 *      and what is STORED measures under DOC_CONTENT_MAX_BYTES in bytes.
 *   2. `contentLength` on both the stored row and the index row is that BYTE count, the
 *      same unit `saveContextDoc` stores, so the library's size column compares like with
 *      like instead of reading a CJK doc as a third of its weight.
 *   3. The truncation never emits a LONE SURROGATE: the cut walks code points
 *      (`clampUtf8Bytes`, src/shared/text-clamp.js), so a document of astral characters
 *      cut mid-cap is still valid UTF-16 and still valid UTF-8.
 *   4. An ASCII document under the cap is stored BYTE FOR BYTE unchanged - the fix must
 *      not start trimming the documents that were always fine.
 *
 * The cap and the measurement are IMPORTED from src/shared/registry-limits.js. Retyping
 * 200000 here is the defect this suite exists to catch (see
 * static/_screenshot-harness/shared-caps-in-ui.test.mjs section 6).
 *
 * Run: node scripts/research-doc-bytes.test.mjs (auto-discovered by run-offline.mjs)
 */

import "../lib/register-mocks-index.mjs";
import storage from "../lib/mock-kvs.mjs";
import { DOC_CONTENT_MAX_BYTES, utf8Bytes } from "../../src/shared/registry-limits.js";
import { hasLoneSurrogate } from "../../src/shared/text-clamp.js";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const { persistResearchDoc } = await import("../../src/index.js");

const DOC_INDEX_KEY = "doc_repo_index";
const DOC_PREFIX = "doc_repo:";

const storedFor = async (id) => storage.get(`${DOC_PREFIX}${id}`);
const indexRowFor = async (id) => ((await storage.get(DOC_INDEX_KEY)) || []).find((d) => d.id === id);

/* ── 1 + 2 + 3. A CJK DOCUMENT OVER THE CAP ──────────────────────────────────
 *
 * "研究結果" is 3 bytes per character in UTF-8 and 1 UTF-16 code unit each, which is the
 * whole point: by the OLD character rule this document measured well under the cap while
 * really being ~3x it. The astral tail proves the cut is code-point safe. */
{
  const cjk = "研究結果とその根拠。".repeat(30000);       // 300k chars, ~900k bytes
  const astral = "𝍢🎯".repeat(2000);                      // surrogate pairs, 4 bytes each
  const markdown = `# 調査\n\n${cjk}${astral}`;
  ok(utf8Bytes(markdown) > DOC_CONTENT_MAX_BYTES * 3,
    `the fixture really is far over the cap (${utf8Bytes(markdown)} bytes vs ${DOC_CONTENT_MAX_BYTES})`);
  ok(markdown.length < DOC_CONTENT_MAX_BYTES * 2,
    `…while measuring far less in CHARACTERS (${markdown.length}) - the mismatch that let it through`);

  const saved = await persistResearchDoc({ title: "調査ノート", markdown, actorAccountId: "acct-1" });
  ok(saved && saved.ok === true, `an oversized research doc is SAVED, not refused (got ${JSON.stringify(saved)})`);

  const row = await storedFor(saved.id);
  ok(row && typeof row.content === "string" && row.content.length > 0, "…with content actually stored");
  const bytes = utf8Bytes(row.content);
  ok(bytes <= DOC_CONTENT_MAX_BYTES,
    `…truncated UNDER the byte cap (${bytes} <= ${DOC_CONTENT_MAX_BYTES}); the old char slice stored about ${utf8Bytes(markdown.slice(0, 180000))}`);
  ok(bytes > DOC_CONTENT_MAX_BYTES * 0.9,
    `…and not over-trimmed - it uses the budget it has (${bytes})`);
  ok(row.content.startsWith("# 調査"), "…keeping the head of the document, which is the part worth keeping");
  ok(/Truncated/.test(row.content), "…and saying so at the end, so a reader knows the research was cut and not simply short");
  ok(!hasLoneSurrogate(row.content), "…with no LONE SURROGATE at the cut - the clamp walks code points, never code units");

  ok(row.contentLength === bytes,
    `the stored row's contentLength is the BYTE count (got ${row.contentLength}, bytes ${bytes}, chars ${row.content.length})`);
  const idx = await indexRowFor(saved.id);
  ok(idx && idx.contentLength === bytes,
    `…and the index row agrees, so the library list and the document cannot disagree (got ${idx && idx.contentLength})`);
  ok(row.contentLength !== row.content.length,
    "…and it is demonstrably NOT the character count, which is what made this invisible");
}

/* ── 4. AN ASCII DOCUMENT UNDER THE CAP IS UNTOUCHED ──────────────────────── */
{
  const markdown = `# Findings\n\n${"A short, ordinary ASCII paragraph about an API. ".repeat(200)}`;
  ok(utf8Bytes(markdown) === markdown.length, "the ASCII fixture measures the same in bytes and characters");
  ok(utf8Bytes(markdown) < DOC_CONTENT_MAX_BYTES, "…and is comfortably under the cap");

  const saved = await persistResearchDoc({ title: "Findings", markdown, actorAccountId: "acct-1" });
  ok(saved && saved.ok === true, `an ordinary research doc saves (got ${JSON.stringify(saved)})`);
  const row = await storedFor(saved.id);
  ok(row.content === markdown, "…byte for byte unchanged - the byte cap must not start trimming what was always fine");
  ok(!/Truncated/.test(row.content), "…with no truncation marker appended to a document that was not truncated");
  ok(row.contentLength === utf8Bytes(markdown), "…and contentLength is still the byte count (identical here, by construction)");
}

/* ── 5. THE DEDUP-UPDATE PATH KEEPS THE UNIT ──────────────────────────────────
 * Re-saving the same title + category UPDATES in place. The second write must not be the
 * one that reintroduces a character count on a row that already carried bytes. */
{
  const markdown = `# 調査\n\n${"根拠となる資料。".repeat(20000)}`;
  const first = await persistResearchDoc({ title: "更新されるノート", markdown, actorAccountId: "acct-1" });
  const second = await persistResearchDoc({ title: "更新されるノート", markdown: `${markdown}${markdown}`, actorAccountId: "acct-1" });
  ok(second.ok === true && second.updated === true && second.id === first.id,
    `the same title + category updates the SAME row (got ${JSON.stringify(second)})`);
  const row = await storedFor(second.id);
  ok(utf8Bytes(row.content) <= DOC_CONTENT_MAX_BYTES, "…still under the byte cap after the update");
  ok(row.contentLength === utf8Bytes(row.content), "…and still measured in bytes on the update path");
}

console.log(`\nresearch-doc-bytes: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
