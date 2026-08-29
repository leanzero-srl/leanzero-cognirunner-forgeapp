#!/usr/bin/env node
/**
 * upload-contract.test.mjs — every format the model is OFFERED must be UPLOADABLE.
 *
 * THE DEFECT THIS EXISTS FOR (found 2026-08-29). `create-pptx` was offered to the model in
 * writeTools + writeGuidance ("for a slide deck / presentation / pitch deck"), but ".pptx" was
 * missing from UPLOAD_ALLOWED_EXTENSIONS in serveAttachmentUpload. The full cost of that gap:
 * the model generates the deck, POSTs it to the bound upload webtrigger, gets 415
 * "extension .pptx not allowed" — and because the capability token is SINGLE-USE with a 10-minute
 * TTL and the guidance explicitly says do not retry, the deck is gone. Silent to the user, who
 * asked for a presentation and got nothing attached.
 *
 * Git history shows exactly how: a88908d added the allowlist; 2bd55f3 later enabled create-pptx
 * and never came back to it. Both files read correctly on their own — the CONTRACT between them
 * was the thing nobody checked. That is the shape worth guarding, not the one missing string.
 *
 * Offline and static: parses src/index.js, no Jira, no network, no AI.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, "../../src/index.js");
const src = readFileSync(SRC, "utf8");

const fail = [];
const ok = (m) => console.log(`  [OK] ${m}`);
const bad = (m) => { fail.push(m); console.log(`  [FAIL] ${m}`); };

function parseSet(re, label) {
  const m = re.exec(src);
  if (!m) throw new Error(`could not locate ${label} in src/index.js`);
  return m[1];
}

// The formats the model is told it may produce, and the extension each yields.
const fmtExt = parseSet(/DOC_FORMAT_EXT\s*=\s*\{([^}]*)\}/, "DOC_FORMAT_EXT");
const extByFormat = Object.fromEntries([...fmtExt.matchAll(/(\w+)\s*:\s*"(\w+)"/g)].map((m) => [m[1], m[2]]));

// The extensions serveAttachmentUpload will actually accept.
const allowRaw = parseSet(/UPLOAD_ALLOWED_EXTENSIONS\s*=\s*new Set\(\[([^\]]*)\]/, "UPLOAD_ALLOWED_EXTENSIONS");
const allowed = new Set([...allowRaw.matchAll(/"\.(\w+)"/g)].map((m) => m[1]));

// The write tools actually exposed to the model.
const writeRaw = parseSet(/MCP_WRITE_TOOLS\s*=\s*new Set\(\[([^\]]*)\]/, "MCP_WRITE_TOOLS");
const writeTools = new Set([...writeRaw.matchAll(/"([\w-]+)"/g)].map((m) => m[1]));

// Sanity: the parse itself must have found something, or every assertion below passes vacuously.
if (Object.keys(extByFormat).length === 0) bad("DOC_FORMAT_EXT parsed empty — the test is blind");
else ok(`parsed ${Object.keys(extByFormat).length} write formats, ${allowed.size} allowed extensions`);

// THE CONTRACT.
for (const [format, ext] of Object.entries(extByFormat)) {
  const tool = `create-${format === "doc" ? "doc" : format}`;
  if (!writeTools.has(tool)) continue; // not offered → not this test's business
  if (allowed.has(ext)) ok(`offered ${tool} → .${ext} is uploadable`);
  else bad(`offered ${tool} → .${ext} would be REJECTED 415 by serveAttachmentUpload and the single-use token burned`);
}

// NEGATIVE CONTROL — the test must be capable of failing. If a bogus format were offered, it
// should be caught; prove the allowed-set lookup is real and not always-true.
if (allowed.has("exe")) bad("negative control: .exe is allowlisted, which it must never be");
else ok("negative control: an extension outside the allowlist is correctly absent");

console.log(fail.length ? `\n${fail.length} FAILURE(S)` : "\nALL GREEN");
process.exit(fail.length ? 1 : 0);
