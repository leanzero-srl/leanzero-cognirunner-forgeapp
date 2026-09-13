/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// F-646 — THE EVIDENCE WRITERS MUST NOT BE ABLE TO PRINT A CREDENTIAL.
//
// `parity-doors-live.mjs` promised in its own header that "No token, URL or secret is
// ever printed", and then dumped `JSON.stringify(e.json).slice(0, 250)` on a FAIL arm
// that fires on a SUCCESSFUL `createApiToken` — which returns the plaintext `token` at
// the TOP LEVEL of that body. The token reached stdout and results/evidence.json.
//
// This suite holds two properties, because fixing only the first would let the next
// driver re-open it:
//   1. BEHAVIOUR — lib/redact.mjs masks a top-level `token` (and the other credential
//      shapes) whether it is handed an object or an already-stringified body.
//   2. SOURCE — no scripts/*-live.mjs hands a MINT RESPONSE to JSON.stringify raw. A
//      stringify is only accepted when it is wrapped in redactSecrets(), or when its
//      guard proves the token is ABSENT. F-646's guard did not: it was a disjunct
//      (`!tok.token || tok.role !== "editor"`), so it also fired with a live token in
//      hand. A disjunctive guard is therefore the exact discriminator, not a proxy.
//
// Auto-discovered by run-offline.mjs (npm run test:offline). Run alone:
//   node test-harness/scripts/evidence-redaction.test.mjs
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const libDir = path.resolve(here, "../lib");
const { redactSecrets, redactString, REDACTED } =
  await import(pathToFileURL(path.join(libDir, "redact.mjs")).href);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
/** Never print the secret itself, even from a failing assertion. */
const clean = (s) => !/cgr_deadbeef|sk-live|ghp_|github_pat_|ATATT|xoxb-/.test(JSON.stringify(s));

/* ── 1. THE EXACT F-646 BODY: createApiToken's answer, token at the TOP LEVEL ──── */
const MINT = { success: true, token: "cgr_deadbeef0123456789abcdef0123456789abcdef01234567", row: { id: "tok_1", role: "admin", prefix: "cgr_deadbe" } };

const asObject = redactSecrets(MINT);
ok(asObject.token === REDACTED, "a top-level `token` is masked when the body is passed as an OBJECT");
ok(clean(asObject), "…and the plaintext token appears nowhere in the redacted object");
ok(asObject.success === true && asObject.row.id === "tok_1" && asObject.row.role === "admin",
  "…while the fields the assertion actually needs (success, row.id, row.role) survive");
ok(MINT.token.startsWith("cgr_"), "redactSecrets does NOT mutate its input (the driver still holds the real answer)");

// The way F-646 actually escaped: the driver stringified FIRST, so a key-walk alone sees only a string.
const asText = redactSecrets({ body: JSON.stringify(MINT).slice(0, 250) });
ok(clean(asText), "a top-level `token` is masked when the body was ALREADY stringified (the F-646 shape)");
ok(/"token"\s*:\s*"\[REDACTED\]"/.test(asText.body), "…and the masked pair keeps its shape so the evidence stays readable");

/* ── 2. the other credential shapes and the dev web-trigger URL ────────────────── */
ok(clean(redactSecrets({ apiKey: "sk-live-abcdef0123456789" })), "`apiKey` is masked");
ok(clean(redactSecrets({ secret: "hunter2hunter2" })) && redactSecrets({ secret: "x" }).secret === REDACTED, "`secret` is masked");
ok(clean(redactString("bearer ghp_abcdefghijklmnopqrst1234")), "a ghp_ token is masked wherever it appears");
ok(clean(redactString("pat github_pat_11ABCDEFG0123456789_abcdef")), "a github_pat_ token is masked");
ok(clean(redactString("ATATT3xFfGF0abcdefghij==")), "an ATATT Atlassian token is masked");
ok(clean(redactString("xoxb-1234-5678-abcdefg")), "an xoxb- Slack token is masked");
ok(!/atlassian-dev\.net/.test(JSON.stringify(redactSecrets({ url: "https://abc123.hello.atlassian-dev.net/x1/yz" }))),
  "a dev web-trigger `url` is masked — the URL is itself the capability");
ok(redactSecrets({ url: "https://wolfaenpak.atlassian.net/browse/COG-1" }).url === "https://wolfaenpak.atlassian.net/browse/COG-1",
  "…but an ordinary Jira URL is left alone, so evidence stays useful");

/* ── 3. it must survive whatever an evidence writer hands it ───────────────────── */
const cyc = { a: 1 }; cyc.self = cyc;
ok(redactSecrets(cyc).self === "[CIRCULAR]", "a cyclic payload does not hang the writer");
ok(clean(redactSecrets({ checks: [{ d: { nested: { token: "cgr_deadbeef00" } } }] })), "a token nested in an array of checks is masked");
ok(redactSecrets(null) === null && redactSecrets(undefined) === undefined && redactSecrets(7) === 7,
  "null / undefined / primitives pass through untouched");

/* ── 4. SOURCE SCAN — no live driver stringifies a mint response raw ───────────── */
const liveFiles = readdirSync(here).filter((f) => f.endsWith("-live.mjs")).sort();
ok(liveFiles.length > 20, `the scan actually found the live drivers (${liveFiles.length})`);

const MINTS = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+[^;\n]*(?:createApiToken|mintApiToken)/;

/* The mint variables are short and generic (`r`, `a`, `e`, `tok`) and drivers re-bind
   those names all over the file, so following a name across a whole script produces
   pure noise (six false hits on first run: a `call` helper, a kvSet, a deleteListener).
   The handling that matters is the guard IMMEDIATELY after the mint — F-646 leaked two
   lines after its own assignment — so the window is deliberately narrow and the price
   of that choice is paid by the positive control below. */
const WINDOW = 15;
function scanSource(src) {
  const lines = src.split("\n");
  const hits = [];
  let vars = 0;
  lines.forEach((decl, d) => {
    const m = decl.match(MINTS);
    if (!m) return;
    vars++;
    const esc = m[1].replace(/\$/g, "\\$");
    const raw = new RegExp(`JSON\\.stringify\\(\\s*${esc}\\.(?:json|body)\\b`);
    for (let i = d; i < Math.min(lines.length, d + WINDOW); i++) {
      const line = lines[i];
      if (!raw.test(line)) continue;
      if (/redactSecrets\s*\(/.test(line)) continue;              // explicitly redacted
      // Safe ONLY when the guard proves the token is ABSENT: a negated `.token` test
      // with no disjunct. F-646's guard had a disjunct, so it fired holding a token.
      const negatedToken = new RegExp(`!\\(?[^)]*${esc}[.\\w]*\\.token`).test(line);
      if (negatedToken && !line.includes("||")) continue;
      hits.push(i + 1);
    }
  });
  return { hits, vars };
}

/* POSITIVE CONTROL — an empty offender list is not evidence until the scan is shown to
   fire. This is parity-doors-live.mjs:114-116 EXACTLY as it read before the fix. */
const F646_ORIGINAL = [
  'const e = await invoke("createApiToken", { name: `parity-editor-x`, role: "editor" });',
  'editorTok = { token: e.json && e.json.token, id: e.json && e.json.row && e.json.row.id };',
  'if (!editorTok.token || editorTok.role !== "editor") { FAIL("no EDITOR token could be minted", { body: JSON.stringify(e.json).slice(0, 250) }); return; }',
].join("\n");
ok(scanSource(F646_ORIGINAL).hits.length === 1, "POSITIVE CONTROL: the scan FIRES on the original F-646 line");
/* …and the two shapes it must NOT fire on, or it would be unusable. */
ok(scanSource([
  'const a = await hook({ action: "mintApiToken", name: "x" });',
  'if (!(a.body && a.body.success && a.body.token)) throw new Error(`refused: ${JSON.stringify(a.body).slice(0, 300)}`);',
].join("\n")).hits.length === 0, "NEGATIVE CONTROL: a guard that proves the token is absent is not flagged");
ok(scanSource([
  'const e = await invoke("createApiToken", { name: "x", role: "editor" });',
  'if (!e.json.token || e.json.role !== "editor") { FAIL("x", { body: JSON.stringify(redactSecrets(e.json)).slice(0, 250) }); return; }',
].join("\n")).hits.length === 0, "NEGATIVE CONTROL: an explicitly redacted stringify is not flagged");

const offenders = [];
let scannedVars = 0;
for (const f of liveFiles) {
  const { hits, vars } = scanSource(readFileSync(path.join(here, f), "utf8"));
  scannedVars += vars;
  for (const ln of hits) offenders.push(`${f}:${ln}`);
}
ok(scannedVars >= 4, `the scan located mint-response variables to follow (${scannedVars})`);
ok(offenders.length === 0, `no live driver stringifies a mint response un-redacted (offending sites: ${offenders.join(", ")})`);

/* ── 5. the two hardened drivers redact in the writers themselves ──────────────── */
for (const f of ["parity-doors-live.mjs", "knowledge-doors-editor-live.mjs"]) {
  const src = readFileSync(path.join(here, f), "utf8");
  ok(/from "\.\.\/lib\/redact\.mjs"/.test(src), `${f} imports the shared redactor`);
  for (const w of ["PASS", "FAIL", "NV"]) {
    const decl = src.split("\n").find((l) => l.startsWith(`const ${w} = (`));
    ok(!!decl && /redactSecrets\(/.test(decl), `${f}: the ${w} writer redacts before the console line AND before it pushes into ev`);
  }
  const write = src.split("\n").filter((l) => /writeFileSync\(/.test(l) && /evidence\.json/.test(l));
  ok(write.length > 0 && write.every((l) => /redactSecrets\(/.test(l)),
    `${f}: the evidence.json write is redacted too (fields assigned outside PASS/FAIL/NV reach it)`);
}

console.log(`\nevidence-redaction: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
