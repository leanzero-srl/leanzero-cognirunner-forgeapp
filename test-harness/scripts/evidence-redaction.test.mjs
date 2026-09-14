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
import { maskNonCode, callArgs, objectValue } from "../lib/js-source-scan.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const libDir = path.resolve(here, "../lib");
const { redactSecrets, redactString, REDACTED, maskEmail, looksLikeCredentialValue } =
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

/* ── 2b. F-650 — THE APP'S OWN TOKEN, SECRET-SHAPED KEYS, QUERY CREDENTIALS ─────
   Every shape below was MEASURED passing through verbatim before the fix. The
   fixture token is a real-shaped one: `cgr_` + 48 lowercase hex, which is what
   `createApiTokenInternal` mints (`randomBytes(24).toString("hex")`). */
const CGR = "cgr_" + "ab12cd34".repeat(6);               // 48 hex, the live shape
const noCgr = (v) => !JSON.stringify(v).includes(CGR);

ok(CGR.length === 52, "the fixture really is the minted shape (cgr_ + 48 hex)");
ok(noCgr(redactString(`Authorization: Bearer ${CGR}`)),
  "F-650: a cgr_ token in a BARE STRING is masked (the app's own prefix was the one missing)");
ok(noCgr(redactSecrets({ note: `minted ${CGR}` })),
  "F-650: a cgr_ token in prose under an innocent key is masked");
ok(noCgr(redactSecrets({ url: `https://wolfaenpak.atlassian.net/x1/abc?token=${CGR}` })),
  "F-650: a credential in a QUERY PARAMETER is masked even on a non-dev host");
ok(redactString("https://x/y?secret=hunter2&z=keep").includes("z=keep")
  && !/hunter2/.test(redactString("https://x/y?secret=hunter2&z=keep")),
  "F-650: a `secret=` query VALUE is masked while unrelated parameters survive");
ok(redactString("the key=value pair is documented") === "the key=value pair is documented",
  "NEGATIVE: `key=` in prose (no ? or &) is NOT masked — the query rule is anchored");

/* ── 2b-ii. F-663 — `key=` IS DECIDED BY THE VALUE, NOT BY THE PARAMETER NAME ────
   `key` used to be an unconditional alternative in SECRET_QUERY, and the harness's own
   KVS door is `?what=kvs&key=<kvs key>` — so the identifier an evidence line exists to
   record was the thing that got redacted. Both halves are asserted: the KVS key NAME
   survives, a credential-shaped value in the same parameter still does not. */
const kvsUrls = [
  "https://x.example/x1/hook?what=kvs&key=app_admins",
  "https://x.example/x1/hook?what=kvs&key=COGNIRUNNER_MEMORY_SETTINGS",
  "https://x.example/x1/hook?what=kvs&key=validation_logs",
  "https://x.example/x1/hook?what=kvs&key=job%3A7f3a9c21-0000-4000-8000-abcdefabcdef",
  "https://x.example/x1/hook?what=kvs&key=pf_code%3Arule-1%3Aa1b2c3",
  "https://wolfaenpak.atlassian.net/rest/api/3/projectvalidate/key?key=COG",
];
for (const u of kvsUrls) ok(redactString(u) === u, `F-663: a KVS/Jira key NAME survives — ${u.slice(u.indexOf("key="))}`);
ok(!/\[REDACTED\]/.test(redactString(kvsUrls[0])) && redactString(kvsUrls[0]).includes("what=kvs"),
  "F-663: …and the rest of the hook URL is untouched with it");

const HEX48 = "ab12cd34".repeat(6);
ok(redactString(`https://x/y?key=${HEX48}`) === "https://x/y?key=[REDACTED]",
  "F-663: a 48-hex value under `key=` IS still masked");
ok(redactString("https://x/y?key=sk-live-abcdef0123456789") === "https://x/y?key=[REDACTED]",
  "F-663: a value with a known credential PREFIX under `key=` is masked whatever its length");
ok(redactString("https://x/y?key=QUJDREVGR0hJSktMTU5PUFFSUw==&z=keep")
  === "https://x/y?key=[REDACTED]&z=keep",
  "F-663: a base64 value under `key=` is masked, and the next parameter survives the cut");
ok(redactString("https://x/y?key=aB3xY9zQ7mK2pL5nR8tV") === "https://x/y?key=[REDACTED]",
  "F-663: 20+ chars of mixed case AND digits is a token, not a word");
/* The judgement calls, stated so a later reader does not 'fix' them back. */
ok(redactString("https://x/y?key=short_name") === "https://x/y?key=short_name",
  "F-663 NEGATIVE: a short value is a name — length alone is the first gate");
ok(redactString("https://x/y?key=doc_repo_seed_meta_and_then_some") === "https://x/y?key=doc_repo_seed_meta_and_then_some",
  "F-663 NEGATIVE: a long value carrying a separator is a NAME, not a credential");
ok(looksLikeCredentialValue("cgr_" + HEX48) && !looksLikeCredentialValue("app_admins")
  && !looksLikeCredentialValue("job:7f3a9c21") && looksLikeCredentialValue(HEX48),
  "F-663: the shape predicate is exported and agrees with the rule that uses it");
/* POSITIVE CONTROL — the PRE-FIX behaviour, reconstructed, so the pass above is evidence
   that something changed rather than that nothing ever fired. */
const PRE_FIX_QUERY = /([?&](?:token|secret|key|api[_-]?key|apikey|password|auth|access_token)=)[^&\s"'<>\\]+/gi;
ok(kvsUrls[0].replace(PRE_FIX_QUERY, "$1[REDACTED]") === "https://x.example/x1/hook?what=kvs&key=[REDACTED]",
  "POSITIVE CONTROL: the pre-fix rule DID clobber the KVS key name — this suite is testing a real change");
ok(kvsUrls[0].replace(PRE_FIX_QUERY, "$1[REDACTED]") !== redactString(kvsUrls[0]),
  "…and the shipped rule no longer agrees with it");
ok(redactSecrets({ harnessSecret: "s3cr3t" }).harnessSecret === REDACTED
  && redactSecrets({ HARNESS_SECRET: "s3cr3t" }).HARNESS_SECRET === REDACTED
  && redactSecrets({ hookSecret: "s3cr3t" }).hookSecret === REDACTED
  && redactSecrets({ editorApiKey: "x" }).editorApiKey === REDACTED,
  "F-650: key matching is now case-insensitive SUBSTRING (`^secret$` missed harnessSecret)");
const budget = redactSecrets({ maxTokens: 4000, promptTokens: 812, tokensPerMinute: 35000 });
ok(budget.maxTokens === 4000 && budget.promptTokens === 812 && budget.tokensPerMinute === 35000,
  "NEGATIVE: numeric token COUNTS survive — the substring rule fires on strings only");
ok(redactSecrets({ row: { prefix: "cgr_deadbe", id: "tok_1" } }).row.prefix === "cgr_deadbe",
  "NEGATIVE: `row.prefix` (cgr_ + 6 hex, the public handle) is NOT masked — {48,} is deliberate");
ok(redactSecrets({ tokenCount: 0, secretsFound: "" }).tokenCount === 0,
  "NEGATIVE: a zero / empty value is not turned into [REDACTED] noise");
const beforeCgr = { token: CGR };
redactSecrets(beforeCgr);
ok(beforeCgr.token === CGR, "the no-mutation contract still holds with the new layers");

/* ── 2c. F-652 — PII: `emailAddress` lands in `app_admins` since F-647 ─────────── */
const ROSTER = [
  { accountId: "557058:aaa", displayName: "Mihai Perdum", emailAddress: "mihai@wolfaenpak.com", role: "admin", scope: "all" },
  { accountId: "557058:bbb", displayName: "Mihai Perdum", emailAddress: "mihai.perdum+contractor2025@wolfaenpak.com", role: "editor", scope: "own" },
];
const noAddr = (v) => !/mihai@|contractor2025@/.test(JSON.stringify(v));
const rRoster = redactSecrets(ROSTER);

ok(noAddr(rRoster), "F-652: `emailAddress` in a roster row is masked (it was passing through verbatim)");
ok(rRoster[0].emailAddress === "m***@wolfaenpak.com", "…to <local-initial>***@<domain>");
ok(rRoster[0].emailAddress.endsWith("@wolfaenpak.com"),
  "…the DOMAIN is KEPT on purpose — a flat [REDACTED] would destroy the namesake evidence");
ok(rRoster[0].accountId === "557058:aaa" && rRoster[0].displayName === "Mihai Perdum" && rRoster[1].role === "editor",
  "…while accountId / displayName / role — the fields the namesake proof needs — survive");
ok(ROSTER[0].emailAddress === "mihai@wolfaenpak.com", "the no-mutation contract holds for the PII layer too");
ok(JSON.stringify(redactSecrets(rRoster)) === JSON.stringify(rRoster),
  "the mask is IDEMPOTENT — a payload redacted by a writer AND at the file boundary is stable");

// The other arm: the driver stringifies the roster and slices it into a FAIL payload.
ok(noAddr(redactSecrets({ before: JSON.stringify(ROSTER) })),
  "F-652: an email inside an ALREADY-STRINGIFIED roster is masked (the key-walk alone would miss it)");
ok(noAddr(redactString(JSON.stringify(ROSTER)).slice(0, 300)),
  "…and redacting BEFORE the slice leaves no half-address under the cut");
ok(redactSecrets({ email: "x@y.co" }).email === "x***@y.co"
  && redactSecrets({ emailAddress: "x@y.co" }).emailAddress === "x***@y.co"
  && redactSecrets({ email_address: "x@y.co" }).email_address === "x***@y.co",
  "the PII key set covers email / emailAddress / email_address");
ok(redactSecrets({ email: "not-an-address" }).email === REDACTED,
  "a PII key whose value is not an address is masked outright rather than half-shown");
ok(redactSecrets({ note: "reach me at mihai@wolfaenpak.com about it" }).note === "reach me at m***@wolfaenpak.com about it",
  "an email in PROSE under an innocent key is masked, and the sentence stays readable");
ok(redactSecrets({ id: "557058:653160a5-6112-470d-baea-333ac760364e" }).id === "557058:653160a5-6112-470d-baea-333ac760364e",
  "NEGATIVE: an account id is NOT an email and is left whole — it is the discriminator under test");

/* ── 2c-ii. F-662 — ONE EMAIL RULE, AND ITS LOCAL PART IS RFC-ISH ───────────────
   `perm-discriminator-live.mjs` carried a SECOND, narrower `EMAIL_RE` and ran it FIRST,
   so the shared rule could only fail to match what the local one had already rewritten.
   The apostrophe local part is the measured divergence. */
ok(redactString("mail o'brien@tenant.com now") === "mail o***@tenant.com now",
  "F-662: an apostrophe local part is masked WHOLE (the driver's local rule left `o'b***@`)");
ok(maskEmail("o'brien@tenant.com") === "o***@tenant.com", "…by the shared mask, to the documented shape");
for (const addr of [
  "first.last@tenant.com", "mihai.perdum+contractor2025@tenant.com", "o'brien@tenant.com",
  "d'angelo.smith@sub.tenant.co.uk", "a!b#c$d%e&f'g*h+i/j=k?l^m_n`o{p|q}r~s@tenant.com",
  "x-y_z@tenant-two.com",
]) {
  const masked = redactString(`contact ${addr} please`);
  ok(!masked.includes(addr) && /\*\*\*@/.test(masked) && masked.endsWith(" please"),
    `F-662: the RFC-ish local part covers ${addr.slice(0, 12)}… (got: ${masked})`);
}
/* POSITIVE CONTROL — the narrow class the driver used, so "it passes now" is a change. */
const F662_LOCAL_RE = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
ok("o'brien@tenant.com".replace(F662_LOCAL_RE, (_m, a, d) => `${a}***@${d}`) === "o'b***@tenant.com",
  "POSITIVE CONTROL: the deleted local rule really did leave `o'` in front of the mask");
ok(redactString("o'brien@tenant.com") !== "o'b***@tenant.com",
  "…and the shared rule disagrees with it, which is the whole reason there is now only one");
/* IDEMPOTENCE survives the wider class: `*` is not atext, so a masked address is stable. */
ok(redactString(redactString("o'brien@tenant.com")) === redactString("o'brien@tenant.com"),
  "F-662: the wider class is still idempotent");
ok(redactString("https://wolfaenpak.atlassian.net/browse/COG-1") === "https://wolfaenpak.atlassian.net/browse/COG-1",
  "F-662 NEGATIVE: the wider local part does not start eating ordinary URLs");
ok(redactString("2 + 2 = 4 and a/b?c") === "2 + 2 = 4 and a/b?c",
  "F-662 NEGATIVE: …nor ordinary prose that happens to contain atext punctuation");

/* THE RESTORE MUST STILL WORK. The byte-identical roster restore compares the RAW
   snapshot held in memory. Redacted comparison is what would break, and it breaks the
   dangerous way: two DIFFERENT addresses collapse onto one mask and compare EQUAL. */
const restored = JSON.parse(JSON.stringify(ROSTER));
const notRestored = JSON.parse(JSON.stringify(ROSTER));
notRestored[1].emailAddress = "mihai.perdum+contractor2024@wolfaenpak.com";  // a DIFFERENT account
ok(JSON.stringify(restored) === JSON.stringify(ROSTER),
  "RESTORE: a raw in-memory snapshot still compares byte-identical to an unchanged roster");
ok(JSON.stringify(notRestored) !== JSON.stringify(ROSTER),
  "RESTORE: a raw comparison still DETECTS a roster that came back different");
ok(JSON.stringify(redactSecrets(notRestored)) === JSON.stringify(redactSecrets(ROSTER)),
  "…and this is exactly why the comparison must stay RAW: the redacted forms are EQUAL");

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

/* ── 4b. F-650 — THE CHEAP TEXTUAL NET OVER THE EVIDENCE WRITERS ────────────────
   The scan above follows a MINT VARIABLE, which is why F-650 slipped past it: the
   leak it predicts is not a stringified mint answer but a token INTERPOLATED into a
   writer's own argument — ``FAIL("refused", { url: `${RULES_URL}?token=${tok("admin")}` })``
   or ``info(`using ${editorToken}`)``. That has no mint variable near it at all.
   This is a TEXT net, not an analysis: it reads the argument text of every
   FAIL/NV/info call and flags the three shapes a credential actually arrives in.
   It is allowed to be crude because both controls below are paid in full. */
/* No `\b` before `tok`: the variable is usually a camelCase TAIL (`adminToken`,
   `editorTok`), and a word boundary is exactly what is missing there. */
const LEAKY_ARG = /\$\{[^}]*tok|token\s*\}|[?&]token=/i;
function scanWriters(src) {
  const hits = [];
  src.split("\n").forEach((line, i) => {
    const call = line.match(/\b(?:FAIL|NV|info)\s*\(([\s\S]*)$/);
    if (!call || !LEAKY_ARG.test(call[1])) return;
    if (/redactSecrets\s*\(|redactString\s*\(/.test(line)) return;   // explicitly redacted
    // Safe ONLY when the guard on the same line proves the token is ABSENT — the same
    // discriminator section 4 uses, and for the same reason: F-646's guard was a
    // disjunct, so it fired holding a live token.
    if (/!\(?[^)]*\.token\b/.test(line) && !line.includes("||")) return;
    hits.push(i + 1);
  });
  return hits;
}

/* POSITIVE CONTROL — the two shapes F-650 names, written the obvious way. */
ok(scanWriters('    FAIL("rest call refused", { url: `${RULES_URL}?token=${tok("admin")}` });').length === 1,
  "POSITIVE CONTROL: the writer net FIRES on a token interpolated into a FAIL payload");
ok(scanWriters('  info(`calling the rules API with ${adminToken}`);').length === 1,
  "POSITIVE CONTROL: the writer net FIRES on `${…token}` inside an info line");
ok(scanWriters('    NV("unreachable", { url: RULES_URL + "?token=" + t });').length === 1,
  "POSITIVE CONTROL: the writer net FIRES on a concatenated `?token=`");
/* …and the shapes it must NOT fire on, or the drivers become unwritable. */
ok(scanWriters('  FAIL("refused", { body: JSON.stringify(redactSecrets(tok.json)).slice(0, 200) });').length === 0,
  "NEGATIVE CONTROL: an explicitly redacted payload is not flagged");
ok(scanWriters('  if (!(tok.body && tok.body.success && tok.body.token)) { FAIL(`refused: ${JSON.stringify(tok.body).slice(0, 300)}`); return; }').length === 0,
  "NEGATIVE CONTROL: a guard that proves the token is absent is not flagged (va-shadow-door:303)");
ok(scanWriters('  info(`${rows.length} row(s) -> ${OUT}/roster-before.json`);').length === 0,
  "NEGATIVE CONTROL: an ordinary interpolated info line is not flagged");

const offenders = [];
let scannedVars = 0;
for (const f of liveFiles) {
  const src = readFileSync(path.join(here, f), "utf8");
  const { hits, vars } = scanSource(src);
  scannedVars += vars;
  for (const ln of hits) offenders.push(`${f}:${ln}`);
  for (const ln of scanWriters(src)) offenders.push(`${f}:${ln} (writer arg)`);
}
ok(scannedVars >= 4, `the scan located mint-response variables to follow (${scannedVars})`);
ok(offenders.length === 0, `no live driver stringifies a mint response un-redacted (offending sites: ${offenders.join(", ")})`);

/* ── 4c. F-652 — NO DRIVER WRITES AN `app_admins` SNAPSHOT UN-REDACTED ──────────
   The roster is the one artefact that carries PII, and it reaches disk through named
   snapshot files as well as through evidence.json. This is a whole-directory rule, so
   a NEW driver that snapshots the roster inherits it instead of having to remember. */
const rosterWriters = [];
for (const f of liveFiles) {
  const src = readFileSync(path.join(here, f), "utf8");
  if (!/app_admins/.test(src)) continue;
  rosterWriters.push(f);
  const bad = src.split("\n")
    .map((l, i) => ({ l, n: i + 1 }))
    .filter(({ l }) => /writeFileSync\(/.test(l) && /roster|evidence\.json/i.test(l) && !/redactSecrets\(/.test(l));
  ok(bad.length === 0, `${f}: every roster/evidence file write is redacted (raw at: ${bad.map((b) => b.n).join(", ")})`);
}
ok(rosterWriters.length >= 2, `the roster-snapshot rule found drivers to apply to (${rosterWriters.join(", ")})`);

/* ── 4c-ii. F-660 — THE PII RULE HAS TO COVER PIXELS ────────────────────────────
   Everything above is TEXT. The permission drivers also write full-page SCREENSHOTS of
   the Permissions tab, where the same real addresses render as PIXELS — and none of these
   scans opens an image, so the suite stayed green while the artefact directory filled
   with legible addresses. F-651 made it worse on purpose: the email no longer ellipsises,
   it wraps and owns a line.

   The rule is crude and therefore enforceable: a `*-live.mjs` that mentions `perm-` may
   not contain a RAW `.screenshot(` call. It calls `shotMasked` from lib/roster-ui.mjs,
   which masks every `.perm-ident-email`, ASSERTS in the DOM that nothing readable is
   left, captures, and restores. `roster-ui.test.mjs` proves that helper on a fake DOM. */
/* A word character before the dot: a real receiver (`page.screenshot(`), never prose that
   quotes the method name (``a raw `.screenshot(` call``), which the rule's own docblocks do. */
const PERM_SHOT = /\w\.screenshot\s*\(/;
function scanRawShots(src) {
  return src.split("\n")
    .map((l, i) => ({ l, n: i + 1 }))
    .filter(({ l }) => PERM_SHOT.test(l) && !/^\s*\*/.test(l) && !/^\s*\/\//.test(l) && !/shotMasked/.test(l))
    .map(({ n }) => n);
}
ok(scanRawShots('    await page.screenshot({ path: `${OUT}/01-search-rows.png` }).catch(() => {});').length === 1,
  "POSITIVE CONTROL: the pixel rule FIRES on the raw capture the drivers used to do");
ok(scanRawShots('    await shotMasked(page, frame, `${OUT}/01-search-rows.png`, { strict: false });').length === 0,
  "NEGATIVE CONTROL: a capture routed through the mask helper is not flagged");
ok(scanRawShots(' * a driver does not call page.screenshot( on the Permissions tab').length === 0,
  "NEGATIVE CONTROL: the rule written out in a docblock is not an offence");

const permDrivers = liveFiles.filter((f) => /perm-/.test(readFileSync(path.join(here, f), "utf8")));
ok(permDrivers.length >= 3, `the pixel rule found the Permissions drivers to apply to (${permDrivers.join(", ")})`);
for (const f of permDrivers) {
  const src = readFileSync(path.join(here, f), "utf8");
  const raw = scanRawShots(src);
  ok(raw.length === 0, `${f}: every capture goes through the email mask (raw page.screenshot at: ${raw.join(", ")})`);
  ok(/shotMasked|makeShot/.test(src), `${f}: …and it imports the mask helper rather than rolling its own`);
}

/* ── 4c-ii. F-668 — THE REFUSAL IS ARMED, AND THE ANSWER IS READ ────────────────
   `shotMasked` always had the right behaviour: `strict` defaults to true, a readable
   address ABORTS the capture, and the non-strict branch returns `{captured:false, reason}`
   for the caller to record. All nine live call sites disarmed it — `{ strict: false }`
   plus a `.catch` that discarded the answer — so the refusal branch never ran anywhere
   and the reason had no reader. The failure mode is a GREEN run with a silently missing
   PNG; and fixing nine sites by hand schedules the tenth.

   So the rule is on the directory, not the file: a driver does not name `shotMasked` at
   all. It binds `makeShot(NV)` ONCE and calls that. Two things are forbidden in a
   `*-live.mjs`: waiving `strict`, and swallowing the capture's answer. */
/* F-672 — THE RULE MUST KEY ON THE BINDING, NOT ON A NAME THE DRIVER CHOOSES.
   As first written, the swallow rule was `/(shotMasked|shot_)\s*\(...\.catch\s*\(/` and
   the direct-call rule was `/\bshotMasked\s*\(/`. Both name RECEIVERS, and nothing
   requires a `makeShot` binding to be called `shot_`. Two one-line bypasses defeat the
   whole directory rule:

     const snap = makeShot(NV);  await snap(page, frame, p).catch(() => {});
     import { shotMasked as snap } from "../lib/roster-ui.mjs";  await snap(...).catch(...);

   Neither waives `strict`, neither spells `shotMasked`, and `/makeShot\s*\(/` is satisfied
   — so a green run silently drops the PNG. And with `strict` now defaulting true, the
   throw being eaten is F-660's LEAK REFUSAL, not a cosmetic loss. So the scan RESOLVES
   BINDINGS first: every identifier imported from `roster-ui.mjs` (honouring `as`
   aliases) and every identifier assigned from a `makeShot(` call, per file. The rules
   then apply to those identifiers, whatever the driver named them. */
const codeLines = (src) => src.split("\n").map((l, i) => ({ l, n: i + 1 }))
  .filter(({ l }) => !/^\s*\*/.test(l) && !/^\s*\/\//.test(l));

/* F-678 — THE BINDING RESOLVER MUST NOT ENUMERATE SHAPES IT HAPPENS TO HAVE SEEN.
   F-672 closed the receiver-NAME bypass; the resolver it installed still recognised only
   TWO shapes: a bare declarator assigned from `makeShot(`, and an identifier imported
   DIRECTLY from `roster-ui.mjs`. Two more shapes resolved to nothing:

     const S = { hero: makeShot(NV) };  await S.hero(page, frame, p).catch(() => {});
     // lib/roster-shots.mjs:  export { shotMasked as snap };
     import { snap } from "../lib/roster-shots.mjs";  await snap(...).catch(...);

   Neither waives `strict`, neither spells `shotMasked`, and `/makeShot\s*\(/` is satisfied
   by the driver's OTHER, conforming capture — so the `madeNames.size >= 1` guard passed on
   the conforming one while the unresolved one ate F-660's leak refusal. A mixed file could
   hide a capture; the guard only caught a file where EVERY capture was unresolvable.

   So two things change. The resolver learns both shapes — depth-1 object properties (bound
   as `obj.prop`) and one-level re-export aliases through any `test-harness/lib/*.mjs`. And
   the guard stops being "at least one binding resolved" and becomes "EVERY `makeShot(` call
   in the file resolved to a binding": `madeUnresolved` reports the line numbers that did
   not, so a shape nobody anticipated FAILS LOUDLY instead of passing quietly. Anything
   nested deeper than one level is deliberately left unresolved for exactly that reason. */

/** Regex-safe form of a binding name, which may be a member expression (`s.shot`). */
const rxName = (n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A call to any of `names`, honouring dotted member bindings. */
const callsAny = (names) => new RegExp(`\\b(?:${[...names].map(rxName).join("|")})\\s*\\(`);

/*
 * ONE LEVEL of re-export: `lib/x.mjs` imports from roster-ui.mjs and exports under another
 * name. Returns basename -> Map(exportedName -> "shotMasked" | "makeShot"). One level only,
 * and stated as such: a two-hop chain resolves to nothing, which leaves its `makeShot(` call
 * UNRESOLVED and therefore FAILS the guard rather than slipping past it.
 */
/** The re-export map of ONE lib source. Split out so a control can feed it text (below). */
function parseReexports(src) {
  const code = codeLines(src).map(({ l }) => l).join("\n");
  const localOrigin = new Map();        // local name in this lib -> origin export of roster-ui
  for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'][^"']*roster-ui\.mjs["']/g)) {
    for (const spec of m[1].split(",")) {
      const a = spec.trim().match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      if (a) localOrigin.set(a[2] || a[1], a[1]);
    }
  }
  const map = new Map();
  /* `export { shotMasked as snap } from "./roster-ui.mjs"` — the direct re-export form. */
  for (const m of code.matchAll(/export\s*\{([^}]*)\}\s*from\s*["'][^"']*roster-ui\.mjs["']/g)) {
    for (const spec of m[1].split(",")) {
      const a = spec.trim().match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      if (a && (a[1] === "shotMasked" || a[1] === "makeShot")) map.set(a[2] || a[1], a[1]);
    }
  }
  /* `import { shotMasked as s } …` then `export { s as snap };` — the two-statement form. */
  for (const m of code.matchAll(/export\s*\{([^}]*)\}\s*(?!from)/g)) {
    for (const spec of m[1].split(",")) {
      const a = spec.trim().match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      if (!a) continue;
      const origin = localOrigin.get(a[1]);
      if (origin === "shotMasked" || origin === "makeShot") map.set(a[2] || a[1], origin);
    }
  }
  return map;
}
function libReexports() {
  const out = new Map();
  let files = [];
  try { files = readdirSync(libDir).filter((f) => f.endsWith(".mjs")); } catch { return out; }
  for (const f of files) {
    let src = "";
    try { src = readFileSync(path.join(libDir, f), "utf8"); } catch { continue; }
    const map = parseReexports(src);
    if (map.size) out.set(f, map);
  }
  return out;
}
const LIB_REEXPORTS = libReexports();

/* THE ONE-LEVEL WALK, PROVEN ON SOURCE rather than asserted about the current lib dir.
   No test-harness/lib/*.mjs re-exports a roster-ui capture today, so a control that only
   looked at the real directory would prove nothing about the parser — the same "an empty
   result is not evidence" trap this suite exists to close. These feed it both re-export
   forms directly, and a negative that must NOT resolve. */
ok(parseReexports('import { shotMasked as s } from "./roster-ui.mjs";\nexport { s as snap };').get("snap") === "shotMasked",
  "POSITIVE CONTROL (F-678): the two-statement re-export `import { shotMasked as s } … export { s as snap }` resolves snap -> shotMasked");
ok(parseReexports('export { makeShot as mk } from "./roster-ui.mjs";').get("mk") === "makeShot",
  "POSITIVE CONTROL (F-678): the direct `export { makeShot as mk } from` form resolves mk -> makeShot");
ok(parseReexports('import { maskEmailsOnPage } from "./roster-ui.mjs";\nexport { maskEmailsOnPage as mask };').size === 0,
  "NEGATIVE CONTROL: re-exporting a roster-ui helper that is NOT a capture does not make it one");
ok(parseReexports('import { shotMasked } from "./somewhere-else.mjs";\nexport { shotMasked as snap };').size === 0,
  "NEGATIVE CONTROL: a `shotMasked` that did not come from roster-ui.mjs is not resolved on the strength of its name");

/** The identifiers in `src` that ultimately denote a capture function.
    `reexports` is injectable ONLY so the control below can prove the one-level lib walk
    end to end; production callers take the real lib directory. */
function captureBindings(src, reexports = LIB_REEXPORTS) {
  const lines = codeLines(src);
  const code = lines.map(({ l }) => l).join("\n");
  const imported = new Map();           // local name -> origin export ("shotMasked"/"makeShot"/…)
  for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'][^"']*roster-ui\.mjs["']/g)) {
    for (const spec of m[1].split(",")) {
      const a = spec.trim().match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      if (a) imported.set(a[2] || a[1], a[1]);
    }
  }
  /* …and the same names arriving through ONE level of re-export in test-harness/lib. */
  for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']([^"']+\.mjs)["']/g)) {
    const base = path.basename(m[2]);
    const reexp = reexports.get(base);
    if (!reexp) continue;
    for (const spec of m[1].split(",")) {
      const a = spec.trim().match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      const origin = a && reexp.get(a[1]);
      if (origin) imported.set(a[2] || a[1], origin);
    }
  }
  const local = (exported) => [...imported.entries()].filter(([, e]) => e === exported).map(([l]) => l);

  /* An alias of `shotMasked` IS a capture function — calling it is calling shotMasked. */
  const shotMaskedNames = new Set(["shotMasked", ...local("shotMasked")]);
  for (const n of [...shotMaskedNames]) {
    for (const m of code.matchAll(new RegExp(`\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${rxName(n)}\\s*[;,\\n]`, "g"))) shotMaskedNames.add(m[1]);
  }

  /* A `makeShot(...)` RESULT is a capture function, under whatever name and in whatever
     container it is bound. Every binding records the LINE it consumed, so the guard below
     can tell a resolved call from one that merely exists. */
  const makeShotNames = ["makeShot", ...local("makeShot")];
  const madeNames = new Set();
  const resolvedLines = new Set();
  const mkAlt = makeShotNames.map(rxName).join("|");
  const DECL = new RegExp(`\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:await\\s+)?(?:${mkAlt})\\s*\\(`, "g");
  const PROP = new RegExp(`([A-Za-z_$][\\w$]*)\\s*:\\s*(?:await\\s+)?(?:${mkAlt})\\s*\\(`, "g");
  const ASSIGN = new RegExp(`([A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)+)\\s*=\\s*(?:await\\s+)?(?:${mkAlt})\\s*\\(`, "g");
  const OPEN_OBJ = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\{/;

  for (let i = 0; i < lines.length; i++) {
    const { l, n } = lines[i];
    for (const m of l.matchAll(DECL)) { madeNames.add(m[1]); resolvedLines.add(n); }
    /* `obj.shot = makeShot(...)` — a member assignment is a binding too. */
    for (const m of l.matchAll(ASSIGN)) { madeNames.add(m[1]); resolvedLines.add(n); }
    /* `const S = { hero: makeShot(NV) }` — walk the object literal, ONE level deep, and
       bind `S.hero`. A property nested deeper is left unresolved on purpose. */
    const open = l.match(OPEN_OBJ);
    if (!open) continue;
    const obj = open[1];
    /* Depth is tracked PER CHARACTER, not per line: `{ a: { b: makeShot(NV) } }` puts both
       properties on one line, and a line-granular walk would bind the depth-2 one as though
       it were a direct property. Only depth-1 text is collected, carrying the line number it
       came from, so anything nested deeper never produces a binding — and therefore lands in
       `madeUnresolved` and FAILS the guard, which is the intended treatment of a shape this
       resolver does not understand. */
    const segments = [];               // { text, n } at depth exactly 1
    let depth = 0, buf = "", bufLine = 0, done = false;
    for (let j = i; j < lines.length && !done; j++) {
      const full = lines[j].l;
      const from = j === i ? full.indexOf("{") : 0;
      for (let k = from; k < full.length; k++) {
        const ch = full[k];
        if (ch === "{") {
          depth++;
          if (depth === 1) { buf = ""; bufLine = lines[j].n; continue; }
        } else if (ch === "}") {
          if (depth === 1) { segments.push({ text: buf, n: bufLine }); buf = ""; }
          depth--;
          if (depth === 0) { done = true; break; }
          continue;
        }
        if (depth === 1) { buf += ch; if (ch === "\n") bufLine = lines[j].n; }
      }
      if (depth === 1) { segments.push({ text: buf, n: bufLine }); buf = ""; bufLine = lines[j + 1] ? lines[j + 1].n : bufLine; }
    }
    for (const seg of segments) {
      for (const m of seg.text.matchAll(PROP)) { madeNames.add(`${obj}.${m[1]}`); resolvedLines.add(seg.n); }
    }
  }

  /* THE GUARD'S EVIDENCE: every line that CALLS a makeShot-denoting name but produced no
     binding. A non-empty list is a capture shape this resolver does not understand. */
  const MK_CALL = new RegExp(`\\b(?:${mkAlt})\\s*\\(`);
  const madeUnresolved = lines
    .filter(({ l, n }) => MK_CALL.test(l) && !resolvedLines.has(n) && !/^\s*import\b/.test(l))
    .map(({ n }) => n);

  return { shotMaskedNames, madeNames, madeUnresolved, all: new Set([...shotMaskedNames, ...madeNames]) };
}

const WAIVES_STRICT = /strict\s*:\s*false/;
/** `.catch` anywhere on a line (or its continuation) that CALLS a capture binding. */
function scanSwallowedShots(src) {
  const { all } = captureBindings(src);
  if (all.size === 0) return [];
  const calls = callsAny(all);
  const lines = codeLines(src);
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    if (!calls.test(lines[i].l)) continue;
    /* The continuation line is read too, so wrapping the `.catch` onto the next line is
       not a third bypass of the same rule. */
    const tail = (lines[i].l + "\n" + (lines[i + 1] ? lines[i + 1].l : "")).split("\n")[1] || "";
    if (/\.catch\s*\(/.test(lines[i].l) || /^\s*\.catch\s*\(/.test(tail)) hits.push(lines[i].n);
  }
  return hits;
}
/** Calling `shotMasked` — or any alias of it — instead of the driver's makeShot binding. */
function scanDirectShotMasked(src) {
  const { shotMaskedNames } = captureBindings(src);
  const re = callsAny(shotMaskedNames);
  return codeLines(src).filter(({ l }) => re.test(l) && !/\bmakeShot\s*\(/.test(l)).map(({ n }) => n);
}

ok(WAIVES_STRICT.test("await shotMasked(page, frame, p, { strict: false });"),
  "POSITIVE CONTROL: the strict-waiver rule FIRES on the line all nine call sites carried");
ok(!WAIVES_STRICT.test("await shot_(page, frame, `${OUT}/01.png`);"),
  "NEGATIVE CONTROL: a makeShot call that takes the default is not flagged");

const ALIAS_MADE = 'import { makeRosterUI, makeShot } from "../lib/roster-ui.mjs";\nconst snap = makeShot(NV);\nawait snap(page, frame, `${OUT}/01.png`).catch(() => {});';
const ALIAS_IMPORTED = 'import { shotMasked as snap } from "../lib/roster-ui.mjs";\nawait snap(page, frame, `${OUT}/01.png`).catch(() => {});';
ok(scanSwallowedShots('const shot_ = makeShot(NV);\nawait shot_(page, frame, p).catch(() => {});').length === 1,
  "POSITIVE CONTROL: the swallowed-answer rule still FIRES on the conventional `shot_` receiver");
ok(scanSwallowedShots(ALIAS_MADE).length === 1,
  "POSITIVE CONTROL (F-672): …and on a makeShot binding named ANYTHING — the receiver-name bypass is closed");
ok(scanSwallowedShots(ALIAS_IMPORTED).length === 1,
  "POSITIVE CONTROL (F-672): …and on an `import { shotMasked as snap }` alias, which defeated the old /\\bshotMasked\\(/ too");
ok(scanSwallowedShots('const shot_ = makeShot(NV);\nconst r = await shot_(page, frame, p);').length === 0,
  "NEGATIVE CONTROL: a recorded capture is not flagged");
ok(scanSwallowedShots('const rows = await readRows(frame, ".perm-admin-card").catch(() => []);').length === 0,
  "NEGATIVE CONTROL: a `.catch` on a call that is NOT a capture binding is nobody's business here");
ok(scanSwallowedShots('const shot_ = makeShot(NV);\nawait shot_(page, frame, p)\n  .catch(() => {});').length === 1,
  "POSITIVE CONTROL: wrapping the `.catch` onto the next line is not a third bypass");
ok(scanDirectShotMasked(ALIAS_IMPORTED).length === 1,
  "POSITIVE CONTROL (F-672): the direct-call rule resolves the `as` alias rather than matching the literal name");
ok(scanDirectShotMasked('import { makeShot } from "../lib/roster-ui.mjs";\nconst shot_ = makeShot(NV);\nawait shot_(page, frame, p);').length === 0,
  "NEGATIVE CONTROL: going through a makeShot binding is the sanctioned route, not an offence");

/* ── F-678 controls: the two binding SHAPES the F-672 resolver could not see ──────
   Both are MIXED files — a conforming `shot_` binding alongside the unresolved one —
   because that is the reachable case: with a conforming binding present, the old
   `madeNames.size >= 1` guard passed and the offending capture went unpoliced. */
const OBJ_PROP = [
  'import { makeShot } from "../lib/roster-ui.mjs";',
  "const shot_ = makeShot(NV);",
  "const S = { hero: makeShot(NV) };",
  "await shot_(page, frame, p);",
  "await S.hero(page, frame, p).catch(() => {});",
].join("\n");
ok(captureBindings(OBJ_PROP).madeNames.has("S.hero"),
  "POSITIVE CONTROL (F-678): an object-property capture resolves to the binding `S.hero`");
ok(scanSwallowedShots(OBJ_PROP).length === 1,
  "POSITIVE CONTROL (F-678): …and the swallowed-answer rule FIRES on it, in a file whose other capture conforms");
ok(captureBindings(OBJ_PROP).madeUnresolved.length === 0,
  "…with every makeShot( call in that file accounted for");

const OBJ_PROP_MULTILINE = [
  'import { makeShot } from "../lib/roster-ui.mjs";',
  "const S = {",
  "  hero: makeShot(NV),",
  "};",
  "await S.hero(page, frame, p).catch(() => {});",
].join("\n");
ok(scanSwallowedShots(OBJ_PROP_MULTILINE).length === 1,
  "POSITIVE CONTROL (F-678): spreading the object literal over lines is not a bypass either");

const MEMBER_ASSIGN = [
  'import { makeShot } from "../lib/roster-ui.mjs";',
  "const S = {};",
  "S.hero = makeShot(NV);",
  "await S.hero(page, frame, p).catch(() => {});",
].join("\n");
ok(scanSwallowedShots(MEMBER_ASSIGN).length === 1,
  "POSITIVE CONTROL (F-678): nor is assigning the capture onto a member after the fact");

/* THE RE-EXPORT SHAPE, END TO END. No lib re-exports a capture today, so the map is
   INJECTED — the parser that builds it for real is proven separately, on source, above. */
const FAKE_REEXPORTS = new Map([["roster-shots.mjs", new Map([["snap", "shotMasked"], ["mk", "makeShot"]])]]);
const REEXPORT_ALIAS = 'import { snap } from "../lib/roster-shots.mjs";\nawait snap(page, frame, p).catch(() => {});';
ok(captureBindings(REEXPORT_ALIAS, FAKE_REEXPORTS).shotMaskedNames.has("snap"),
  "POSITIVE CONTROL (F-678): a capture aliased through ONE level of lib re-export resolves to a shotMasked binding");
ok(captureBindings(REEXPORT_ALIAS, FAKE_REEXPORTS).all.has("snap"),
  "…so the swallow rule and the direct-call rule both police it");
const REEXPORT_MADE = 'import { mk } from "../lib/roster-shots.mjs";\nconst shot_ = mk(NV);\nawait shot_(page, frame, p).catch(() => {});';
ok(captureBindings(REEXPORT_MADE, FAKE_REEXPORTS).madeNames.has("shot_"),
  "POSITIVE CONTROL (F-678): …and a `makeShot` re-exported as `mk` still produces a resolved capture binding");
ok(captureBindings(REEXPORT_MADE, FAKE_REEXPORTS).madeUnresolved.length === 0,
  "…with its makeShot-equivalent call accounted for by the guard");
/* `all` always carries the literal `shotMasked`, so the discriminator is whether `snap`
   is in it — not whether the set is empty. */
ok(!captureBindings(REEXPORT_ALIAS, new Map()).all.has("snap"),
  "NEGATIVE CONTROL: with no re-export map, that same import does NOT resolve — the pass above comes from the walk, not from the name `snap`");
ok(scanSwallowedShots(REEXPORT_ALIAS).length === 0,
  "…and against the REAL lib directory it is unresolved today, which is the honest state of the one-level walk: proven on source, with no live consumer");

/* The one-level bound, stated as a control rather than as a comment: a capture aliased
   through a lib that this walk does not resolve leaves its makeShot( call UNRESOLVED, and
   the guard below turns that into a FAIL. Unknown shapes fail loudly; they do not pass. */
const UNRESOLVED_SHAPE = [
  'import { makeShot } from "../lib/roster-ui.mjs";',
  "const shot_ = makeShot(NV);",
  "const deep = { a: { b: makeShot(NV) } };",
  "await shot_(page, frame, p);",
].join("\n");
ok(captureBindings(UNRESOLVED_SHAPE).madeUnresolved.length === 1,
  "POSITIVE CONTROL (F-678): a capture shape the resolver does NOT understand is reported unresolved, not silently ignored");
ok(captureBindings(UNRESOLVED_SHAPE).madeNames.size >= 1,
  "…even though the file has a conforming binding too — which is exactly the case the old `size >= 1` guard waved through");

for (const f of permDrivers) {
  const src = readFileSync(path.join(here, f), "utf8");
  const waived = codeLines(src).filter(({ l }) => WAIVES_STRICT.test(l)).map(({ n }) => n);
  ok(waived.length === 0, `${f}: no capture waives \`strict\` — a readable address aborts the run (at: ${waived.join(", ")})`);
  const swallowed = scanSwallowedShots(src);
  ok(swallowed.length === 0, `${f}: no capture's answer is discarded with .catch, under ANY binding name (at: ${swallowed.join(", ")})`);
  const direct = scanDirectShotMasked(src);
  ok(direct.length === 0, `${f}: shotMasked is not called directly, nor through an alias — makeShot is the one home of the recording (at: ${direct.join(", ")})`);
  ok(/makeShot\s*\(/.test(src), `${f}: captures are bound to this driver's own N/V writer via makeShot`);
  /* The rule is only worth anything if it found EVERY binding it is policing (F-678).
     "At least one resolved" let a mixed file hide a capture behind a conforming sibling;
     the bar is now that no `makeShot(` call in the file is left unaccounted for. */
  const b = captureBindings(src);
  ok(b.madeNames.size >= 1,
    `${f}: …and the scan RESOLVED that binding by name (${[...b.madeNames].join(", ") || "none — the rule would be scanning nothing"})`);
  ok(b.madeUnresolved.length === 0,
    `${f}: …and EVERY makeShot( call resolved to a binding — an unresolved one is a capture the swallow rule cannot police (at: ${b.madeUnresolved.join(", ")})`);
}

/* ── 4c-ii-b. F-681 / F-689 — THE SUCCESSFUL CAPTURE HAS A WRITER, AND A LEAK FAILS
   THE RUN ───────────────────────────────────────────────────────────────────────
   Everything above polices the capture that did NOT happen: strict is armed, the answer
   is not swallowed, the one home is `makeShot`. None of it says a word about the capture
   that DID — and that is the branch carrying the proof. `{total, masked, readable}` IS
   the F-660 DOM assertion; without it "no PNG in this directory is unmasked" can only be
   ARGUED from the absence of a throw, never READ off the artefact set.

   `makeShot` grew the PASS writer and the `shots` ledger under F-681. The fix reached the
   library and ONE driver of four, and it stayed that way through TWO passes — F-681's own
   surgeon deliberately WITHHELD this rule because it would have failed the gate on the
   three unconverted drivers, and the file-scoped test that landed with 50291a7 names only
   the two it converted. That is precisely the mechanism that lets a fix stall at one call
   site: the rule that would have caught it was postponed until the code agreed with it.
   So the rule goes on the DIRECTORY, and its cohort is derived — every `*-live.mjs` whose
   CODE calls `makeShot(` — so the fifth driver written next month is inside it on the day
   it is written, without anyone remembering to add a filename to a list.

   Three things are required of such a driver:

     1. `makeShot` is handed the writer TRIPLE `{ pass, nv, fail }`, not a bare function.
        A bare `NV` is read by `makeShot` as "this driver offered no PASS writer" and the
        successful capture is recorded NOWHERE — the exact pre-fix shape. `pass:` is the
        load-bearing key: `{ nv: NV, fail: FAIL }` is an object and still records nothing.
        Where the driver also builds `makeRosterUI`, its `record` needs the same triple,
        because grantRole/removeAccount take captures the driver never holds. That half is
        conditional on the call being present — `user-search-fault-live.mjs` has no roster.
     2. The ledger reaches the evidence FILE. An `ev.shots = …` (or an equivalent
        assignment onto an evidence field) before the write, or the numbers die in a
        variable nobody kept.
     3. A leak is a RUN-level FAIL. Every one of these drivers wraps its capture in a seam
        that converts a throw into a recorded sentence and carries on — `attempt()` inside
        `restoreRosterToSnapshot`, or a plain step-level `catch` that writes N/V — so a PII
        refusal came back as prose in a run that still exited 0. The driver must READ a
        `leaked` flag and turn it into `FAIL(`.

   THE SCAN READS CODE, NOT PROSE. These drivers now document their own history — "this
   used to be `makeShot(NV)`" is a sentence three of them carry — and a rule reading the
   comments goes red on a file that is CORRECT. Block and line comments are stripped
   first; `://` is spared so a URL on a code line survives. */
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/*
 * THE ARGUMENT AND OBJECT WALKERS LIVE IN `lib/js-source-scan.mjs` (F-716, F-730).
 *
 * F-716 replaced an unbounded regex window with a parenthesis walk, which fixed the window
 * and left the walker STRING-BLIND: `stripComments` removes comments and nothing removes
 * string or template bodies, so a parenthesis inside a FAIL MESSAGE was counted as code.
 * MEASURED before the fix: `leakFailNamesArtefacts('FAIL("a capture was REFUSED :) the mask
 * failed", { paths: shot.leaks.map(s => s.path) });')` returned FALSE — a correct leak FAIL
 * that names its artefacts inside its own parens reported as naming nothing, and this suite
 * red on a driver that is right. The other direction is worse: an unmatched `(` in a message
 * either returns `null` (read as a failure) or, with a spare `)` downstream, swallows forward
 * past the call and re-opens the very window F-716 was cut to close. The directory's FAIL
 * messages routinely parenthesise — `(GET → 200)`, `(src/harness-fault.js)`, `(F-660)` — and
 * today they all happen to balance, which is luck, not a rule.
 *
 * The library masks non-code to SPACES of the same length, balances on the mask and slices
 * the ORIGINAL, so a FAIL's real message (where `REFUSED` lives) survives for the predicates
 * below while only code parens are counted. It is a library and not a local copy because
 * `scripts/live-driver-scope.test.mjs` needed the same answer and had grown its own — the
 * second-home defect these rules exist to police.
 */


/** Every `makeShot(` call in the file is passed an object literal carrying a `pass:` key. */
const hasPassWriter = (code) => {
  const calls = callArgs(code, "makeShot");
  /* `every` over an empty list is vacuously true, which is CORRECT here: a roster-only
     driver binds no `makeShot` and is held by `rosterRecordHasPass` instead. The cohort —
     not this predicate — is what guarantees at least one of the two applies. */
  return calls.every((a) => a !== null && /^\s*\{/.test(a) && /\bpass\s*:/.test(a));
};
/** …and `makeRosterUI`'s `record`, for EVERY call, with a missing/unreadable one a FAILURE. */
const rosterRecordHasPass = (code) => {
  const calls = callArgs(code, "makeRosterUI");
  return calls.length > 0 && calls.every((a) => {
    if (a === null) return false;               // an unclosed call is not a proven one
    const record = objectValue(a, "record");
    return record !== null && /\bpass\s*:/.test(record);
  });
};
const usesRosterUI = (code) => /makeRosterUI\s*\(/.test(code);
/* F-705 — THE COHORT PREDICATE, shared by the filter and its controls so the thing asserted
   is the thing that runs. Either door into the camera puts a driver inside all three rules. */
const captureCohort = (code) => /makeShot\s*\(/.test(code) || usesRosterUI(code);
/** The ledger is assigned onto the evidence object before it is written. */
const writesShotLedger = (code) => /\bev\.shots\s*=/.test(code)
  || /\bev\.[A-Za-z_$][\w$]*\s*=\s*[^=;]*\bshots\b/.test(code);
/** A `leaked` flag is read AND turned into a FAIL. */
const failsOnLeak = (code) => /\.leaked\b|\bleaked\s*\(\s*\)/.test(code) && /FAIL\s*\(/.test(code);
/** F-701 (folded in from f689-drivers.test.mjs) — the leak FAIL names the artefacts.
 *
 * F-716 — THE WINDOW WAS UNBOUNDED, SO THE RULE MEANT "A `paths:` EXISTS NEARBY".
 * The predicate used to be `code.match(/FAIL\([\s\S]{0,120}?REFUSED[\s\S]{0,600}/)` and then
 * test `/\b(paths|leaks)\s*:/` over that MATCH. The 600-character tail runs clean past the
 * closing paren of the leak FAIL and on into whatever follows it, so a leak FAIL that names
 * NOTHING passed whenever any `paths:` or `leaks:` token turned up in the next 600
 * characters — which is the shape of every one of the four drivers it covers. Two measured
 * shapes both returned `true` from the old predicate:
 *   · `FAIL("…REFUSED…");` followed by an unrelated `FAIL("restore leaked", { paths: … });`
 *     — the pre-F-700 driver text with the artefacts dropped from the arm that MATTERS;
 *   · `FAIL("…REFUSED…");` followed by `ev.summary = { leaks: leaks.length };` — a COUNT,
 *     not a path, and not even on a failure arm.
 * The suite's own control (`!leakFailNamesArtefacts("FAIL('…REFUSED…');")`) passed only
 * because nothing followed it in that one-line string: it proved the rule could go red on
 * an EMPTY file, never on a FILE.
 *
 * The fix is the walker this file already owns. `callArgs` closes each `FAIL(` on its
 * MATCHING paren, so the text examined is exactly that call's own argument list and stops
 * there. Every FAIL whose arguments mention a refused capture must name the artefacts
 * INSIDE its own parens; a call the walker cannot close is `null` and counts as a failure,
 * never as a pass. At least one such FAIL must exist, or a driver that simply never
 * mentions REFUSED would satisfy the rule vacuously — which is what `!!m` used to buy. */
const leakFailNamesArtefacts = (code) => {
  const refusalArgs = callArgs(code, "FAIL").filter((a) => a === null || /REFUSED/.test(a));
  return refusalArgs.length > 0
    && refusalArgs.every((a) => a !== null && /\b(paths|leaks)\s*:/.test(a));
};

/* ── F-730 · THE WALKER IS NO LONGER STRING-BLIND ───────────────────────────────
   The first two are the MEASURED pre-fix failures, verbatim. Both used to be wrong in the
   direction that matters most — the first called a CORRECT driver broken, the second
   re-opened the unbounded window F-716 closed — so a green suite below is evidence the
   walker can still tell code from prose rather than evidence it got lucky. */
{
  const spareClose = 'FAIL("a capture was REFUSED :) the mask failed", { paths: shot.leaks.map(s => s.path) });';
  ok(callArgs(spareClose, "FAIL").length === 1 && /\bpaths\s*:/.test(callArgs(spareClose, "FAIL")[0]),
    "POSITIVE CONTROL (F-730): a `)` inside a FAIL MESSAGE no longer truncates that call's own argument list");
  ok(leakFailNamesArtefacts(spareClose),
    "POSITIVE CONTROL (F-730): …so the leak rule stops going RED on a driver that names its artefacts correctly — the measured pre-fix answer was false");

  const spareOpen = 'FAIL("the mask REFUSED the capture ( and never closed", { paths: p });\nconst after = f(1);';
  const openArgs = callArgs(spareOpen, "FAIL");
  ok(openArgs.length === 1 && openArgs[0] !== null && /\bpaths\s*:/.test(openArgs[0]),
    "POSITIVE CONTROL (F-730): …and an unmatched `(` in a message neither returns null nor swallows forward into the next call");
  ok(!openArgs[0].includes("const after"),
    "…the window really does stop at the call's own closing paren, which is the whole of F-716");

  /* A FAIL written inside a STRING is not a call site. The mask is what makes that true. */
  ok(callArgs('const help = "write FAIL(msg, { paths })";\nFAIL("REFUSED", { paths: p });', "FAIL").length === 1,
    "POSITIVE CONTROL (F-730): a call NAME inside a string literal is not a call");

  /* The mask's contract, asserted rather than assumed: the slice indices are only valid
     because masking preserves LENGTH and newlines. */
  for (const s of [
    'const a = "x(y)"; f(1);',
    "const t = `a ${ b(1) } c`; g(2);",
    "const r = /a(b/.test(x); h(3);",
    "/* ( */ k(4);\n// )\nm(5);",
    "const n = `${ `${ deep }` }`;",
  ]) {
    ok(maskNonCode(s).length === s.length, `the mask preserves LENGTH so a slice of the original is aligned: ${JSON.stringify(s)}`);
    ok(maskNonCode(s).split("\n").length === s.split("\n").length, "…and preserves newlines, so a reported line number is honest");
  }
  ok(maskNonCode('f("a(b");') === "f(     );",
    "…and the mask of `f(\"a(b\");` keeps the call's own parens and blanks the one in the string");
  ok(objectValue('{ record: { pass: P, note: "} not a brace" }, other: 1 }', "record") === '{ pass: P, note: "} not a brace" }',
    "POSITIVE CONTROL (F-730): the object walker is string-blind no longer either — a `}` inside a message does not close the object");

  /* NEGATIVE CONTROL: the rule must still be able to FAIL. A leak FAIL that names nothing
     inside its own parens is caught even when a `paths:` follows it — F-716's finding. */
  ok(!leakFailNamesArtefacts('FAIL("a capture was REFUSED");\nFAIL("restore leaked", { paths: q });'),
    "NEGATIVE CONTROL: a leak FAIL that names NOTHING is still caught with an unrelated `paths:` right behind it");
}

/* POSITIVE CONTROLS — the PRE-FIX shapes, written out, so a green rule is evidence that
   the rule can still go red rather than evidence that it forgot how. */
ok(hasPassWriter("const shot_ = makeShot({ pass: PASS, nv: NV, fail: FAIL });"),
  "the PASS-writer rule ACCEPTS the writer triple");
ok(!hasPassWriter("const shot_ = makeShot(NV);"),
  "POSITIVE CONTROL (F-689): the PASS-writer rule FIRES on the pre-fix `makeShot(NV)` — the shape three drivers carried");
ok(!hasPassWriter("const shot_ = makeShot({ nv: NV, fail: FAIL });"),
  "POSITIVE CONTROL: …and on an object with no `pass:` key, which is the same defect wearing braces");
/* F-705 — WHERE THE "NO CALLS AT ALL" GUARANTEE NOW LIVES. `hasPassWriter` used to demand
   `calls.length > 0`, which made it the thing that excluded a file with no `makeShot`. That
   is exactly why a roster-only driver could not be admitted to the cohort. The emptiness
   check moved UP to the cohort — a file with NEITHER door is not a capture driver — and this
   predicate is now vacuously true on a file it does not govern, which is correct and is
   asserted here rather than left to be rediscovered. */
ok(hasPassWriter("await shot_(page, frame, p);"),
  "a file with no makeShot call is not held by the makeShot rule — the cohort, not this predicate, decides who is governed");
ok(!captureCohort("await shot_(page, frame, p);"),
  "POSITIVE CONTROL (F-705): …and a file with NEITHER makeShot nor makeRosterUI is not in the cohort at all, so nothing is excused by vacuous truth");
ok(!hasPassWriter("const a = makeShot({ pass: PASS });\nconst b = makeShot(NV);"),
  "POSITIVE CONTROL: EVERY call must carry the writer — one conforming sibling does not cover an unconverted one");
ok(!rosterRecordHasPass("makeRosterUI({ withAdminPanel, rosterRows: rosterRaw, out: OUT, record: NV })"),
  "POSITIVE CONTROL (F-689): the roster-record rule FIRES on the pre-fix `record: NV`");
ok(rosterRecordHasPass("makeRosterUI({ withAdminPanel, out: OUT, record: { pass: PASS, nv: NV, fail: FAIL } })"),
  "…and ACCEPTS the triple");
/* The loop applies this predicate only `if (usesRosterUI(code))`, so a driver that builds no
   roster is never asked. The predicate itself answers FALSE on "no calls found" ON PURPOSE
   (F-705): the old version returned TRUE for a `null` match, so the one input it could not
   read — an options object past its 400-char window — was reported as compliant. */
ok(!rosterRecordHasPass("const shot_ = makeShot({ pass: PASS, nv: NV, fail: FAIL });"),
  "F-705: 'I found no makeRosterUI call' is NOT a pass — unreadable and absent both answer false, and the cohort gate decides applicability");
ok(usesRosterUI("makeRosterUI({ record: { pass: PASS } })") && !usesRosterUI("const shot_ = makeShot({ pass: PASS });"),
  "…and `usesRosterUI` is the gate that keeps a makeShot-only driver from ever being asked");
/* ── F-705 POSITIVE CONTROLS · THE ROSTER-ONLY DRIVER, THE SHAPE THAT ESCAPED ──────
   The breaker's `perm-scope-own-live.mjs`: every capture taken through `makeRosterUI`, no
   `makeShot` anywhere. Under the old cohort it was governed by nothing at all. Each control
   below is that file, and each must be SEEN and then JUDGED — an exclusion is not evidence
   until the matcher is shown to see the object. */
{
  const rosterOnly = `const { withAdminPanel, rosterRows } = await makeRosterUI({ withAdminPanel, rosterRows: rosterRaw, out: OUT, record: NV });
await grantRole(page, acc);`;
  ok(captureCohort(rosterOnly),
    "POSITIVE CONTROL (F-705): a driver that captures ONLY through makeRosterUI is INSIDE the cohort — the old `makeShot(`-derived cohort excluded it from all three rules");
  ok(!rosterRecordHasPass(rosterOnly),
    "…and once inside, its `record: NV` is FAILED — grantRole/removeAccount capture on its behalf and a bare N/V records a successful capture nowhere");
  ok(hasPassWriter(rosterOnly),
    "…while the makeShot rule stays silent on it, because that is not the door it took");
}
/* EVERY call, not the first: `code.match` examined one builder and left a second unchecked. */
ok(!rosterRecordHasPass("makeRosterUI({ record: { pass: PASS } });\nmakeRosterUI({ out: OUT, record: NV });"),
  "POSITIVE CONTROL (F-705): a SECOND makeRosterUI call is checked too — matchAll, not first-match");
ok(rosterRecordHasPass("makeRosterUI({ record: { pass: PASS } });\nmakeRosterUI({ out: OUT, record: { pass: PASS, fail: FAIL } });"),
  "…and two conforming builders both pass");
/* THE NULL MATCH. An options object past the old 400-char window made `code.match` return
   null, and `!m` handed that back as TRUE: the rule called a driver compliant precisely
   because it could not read it. The walk reads any length, and an UNCLOSED call is false. */
{
  const long = `makeRosterUI({ withAdminPanel, rosterRows, out: OUT, note: "${"x".repeat(500)}", record: NV })`;
  ok(long.length > 400, "the control really is past the window that used to produce a null match");
  ok(!rosterRecordHasPass(long),
    "POSITIVE CONTROL (F-705): a long options object is READ and its `record: NV` failed — it used to return true by null match");
  const longOk = `makeRosterUI({ withAdminPanel, note: "${"x".repeat(500)}", record: { pass: PASS } })`;
  ok(rosterRecordHasPass(longOk), "…and a long options object with a proper record still passes");
}
ok(!rosterRecordHasPass("makeRosterUI({ record: { pass: PASS }"),
  "POSITIVE CONTROL: an UNCLOSED call is not a proven one — unreadable is a FAIL, never a pass");
/* A nested object inside `record` no longer terminates the scan early: the old `[^}]*` gave
   up at the first inner `}`, so a `pass:` after one was invisible. */
ok(rosterRecordHasPass("makeRosterUI({ record: { opts: { deep: 1 }, pass: PASS } })"),
  "POSITIVE CONTROL: `record` is brace-balanced, so a `pass:` after a nested object is found");
/* KNOWN LOOSENESS, STATED RATHER THAN HIDDEN: a `pass:` nested deeper inside `record` is
   accepted. The rule is "a writer was handed over", and no driver has ever written that
   shape; tightening it to a DIRECT key is a separate question, not smuggled in here. */
ok(rosterRecordHasPass("makeRosterUI({ record: { opts: { pass: 1 } } })"),
  "a `pass:` nested inside record is accepted — the documented limit of this predicate");

ok(!writesShotLedger("const allShots = [...shot_.shots];"),
  "POSITIVE CONTROL (F-689): the ledger rule FIRES when the shots are computed but never assigned into the evidence");
ok(writesShotLedger("ev.shots = shot_.shots;"),
  "…and ACCEPTS the direct assignment");
ok(writesShotLedger("ev.captures = [...shot_.shots, ...uiShots()];"),
  "NEGATIVE CONTROL: an equivalently-named evidence field carrying the shots is accepted — the rule is about the ledger reaching evidence.json, not about one property name");
ok(!failsOnLeak("if (shot_.leaked) NV('a capture was refused');"),
  "POSITIVE CONTROL (F-689): the leak rule FIRES when `leaked` is read but only recorded as N/V — the run still exits 0");
ok(!failsOnLeak("FAIL('something else went wrong');"),
  "POSITIVE CONTROL: …and when there is a FAIL writer but nothing ever reads `leaked`");
ok(failsOnLeak("if (shot_.leaked || uiLeaked()) FAIL('a capture was REFUSED', { paths });"),
  "…and ACCEPTS a run-level FAIL driven off either binding's leak flag");
/* F-701 — the two rules folded in from the deleted `f689-drivers.test.mjs`, with the
   controls that prove each can still go red. */
ok(leakFailNamesArtefacts("FAIL('a capture was REFUSED because an address survived', { paths: leaks.map((s) => s.path), leaks });"),
  "the artefact-naming rule ACCEPTS the `paths:` shape");
ok(leakFailNamesArtefacts("FAIL('a capture was REFUSED because an address survived', { leaks: shot_.leaks });"),
  "…and the `leaks:` shape, whose entries each carry a `.path` — the rule is about naming the PNGs, not about one key name");
ok(!leakFailNamesArtefacts("FAIL('a capture was REFUSED because an address survived');"),
  "POSITIVE CONTROL (F-701): …and FIRES on a leak FAIL that names nothing, leaving the operator no PNG to destroy");
ok(!leakFailNamesArtefacts("FAIL('something unrelated', { paths });"),
  "POSITIVE CONTROL: …and is not satisfied by a `paths:` on some OTHER failure arm");
/* F-716 — THE TWO SHAPES THE 600-CHARACTER WINDOW USED TO PASS. Both are a leak FAIL that
   names NOTHING, followed by a `paths:`/`leaks:` token the old tail ran on into. These are
   the controls the one-line control above could not be: a file, not an empty string. */
ok(!leakFailNamesArtefacts(
  `FAIL("a capture was REFUSED because an address survived");
   if (restore && restore.leaked) FAIL("restore leaked", { paths: restore.paths });`),
  "POSITIVE CONTROL (F-716): a bare leak FAIL followed by a SECOND, unrelated FAIL that does name paths is REFUSED — the old window read past the first call's closing paren and passed the exact pre-F-700 driver text with the artefacts dropped from the arm that matters");
ok(!leakFailNamesArtefacts(
  `FAIL("a capture was REFUSED because an address survived");
   const leaks = all.filter((s) => s.readable);
   ev.summary = { leaks: leaks.length };`),
  "POSITIVE CONTROL (F-716): …and a bare leak FAIL followed by `ev.summary = { leaks }` is REFUSED too — a COUNT on an evidence field is not a path, and is not even on a failure arm");
/* …and the bound really is the FAIL call's own parens, not a shorter window: a leak FAIL
   whose argument list is LONGER than the old 120/600 budget still passes when it names the
   artefacts inside itself. A rule that went red here would be trading one arbitrary cutoff
   for another. */
ok(leakFailNamesArtefacts(
  `FAIL("a capture of the Permissions tab was REFUSED because a bare e-mail address survived the redactor in the rendered roster row, which means the PNG on disk carries it too and must be destroyed before this evidence directory is shared with anyone",
     { paths: shot_.leaks.map((s) => s.path), leaks: shot_.leaks });`),
  "NEGATIVE CONTROL (F-716): a long, correct leak FAIL is still ACCEPTED — the bound is the call's matching paren, not a shorter character budget");
/* A FAIL the walker cannot close is not a proven one, exactly as `hasPassWriter` treats it. */
ok(!leakFailNamesArtefacts('FAIL("a capture was REFUSED", { paths: p });\nFAIL("unclosed", { paths: q };'),
  "NEGATIVE CONTROL (F-716): an unbalanced FAIL( is a FAILURE, never a pass — the walker returns null and the rule refuses rather than guessing");

/* F-705 — THE COHORT IS EVERY DRIVER THAT CAPTURES, NOT EVERY DRIVER THAT BINDS `makeShot`.
   `makeRosterUI({ record })` calls `makeShot(record)` internally and `grantRole` /
   `removeAccount` capture on its behalf, so a driver that takes all its Permissions-tab
   captures through the roster builder sat OUTSIDE all three rules: no PASS writer required,
   no `ev.shots` ledger required, no run-level leak FAIL required. Its successful captures
   would be recorded nowhere and a PII refusal inside `restoreRosterToSnapshot`'s `attempt()`
   seam would become an `actions[].threw` sentence in a run that exits 0 — byte for byte the
   pre-F-681 state this rule was written to make impossible. The rule's own stated purpose is
   that "the fifth driver written next month is inside it on the day it is written", and that
   only holds if the cohort names both doors into the camera. */
const captureDrivers = liveFiles.filter((f) => captureCohort(stripComments(readFileSync(path.join(here, f), "utf8"))));
ok(captureDrivers.length >= 4,
  `the PASS-writer rule found every driver that captures, through makeShot OR makeRosterUI (${captureDrivers.join(", ")})`);
for (const f of captureDrivers) {
  const code = stripComments(readFileSync(path.join(here, f), "utf8"));
  ok(hasPassWriter(code),
    `${f}: every makeShot( call is handed the writer TRIPLE — a bare N/V records a SUCCESSFUL capture nowhere (F-681/F-689)`);
  if (usesRosterUI(code)) {
    ok(rosterRecordHasPass(code),
      `${f}: …and makeRosterUI's \`record\` carries a \`pass\` writer too — grantRole/removeAccount take captures this driver never holds`);
  }
  ok(writesShotLedger(code),
    `${f}: the capture ledger is assigned into the evidence object — otherwise the {total, masked, readable} proof dies in a variable`);
  ok(failsOnLeak(code),
    `${f}: a refused capture is a RUN-level FAIL — the step-level seam converts the throw into a sentence and would otherwise exit 0`);
  /* F-701 — FOLDED IN FROM `f689-drivers.test.mjs`, WHICH THIS RULE SUPERSEDES.
     That suite named two of the four drivers in a hand-maintained `DRIVERS` array and
     would have gone RED the moment a third was converted — two homes of one rule, the
     staler one authoritative-looking. Everything it asserted is here except these two
     lines, so they come across rather than being lost with the file.

     `names the artefacts` is deliberately NOT `paths:`. The old rule required that exact
     key and therefore excluded `perm-namesake-ui-live.mjs`, which passes `{ leaks }` —
     objects that each carry a `.path`. The requirement is that an operator can tell WHICH
     PNGs to destroy, and both shapes answer it; demanding one key name would be a rule
     about spelling. */
  ok(leakFailNamesArtefacts(code),
    `${f}: the leak FAIL NAMES the artefacts it refused (paths: or leaks:) — an operator has to know which PNGs to destroy`);
  ok(/process\.exit(Code)?\s*(=|\()\s*/.test(code) && /fails\s*(>|\?)/.test(code),
    `${f}: …and a FAIL still drives a non-zero exit, or the run-level leak FAIL buys nothing`);
}

/* ── 4c-iii. F-657 — NO PERMISSION DRIVER PICKS AN ACCOUNT ITS OWN WAY ──────────
   F-654 was fixed in one driver; the driver written as the PROOF of that fix carried the
   same defect verbatim, because it had its own selection code. So the rule is on the
   directory, not on the file: every `*-live.mjs` that drives the Permissions tab must go
   through `selectByDiscriminator` (directly, or via `makeRosterUI`, which is the only
   other caller), and none may use the AMBIGUOUS `.perm-ident` locator as a discriminator
   — that class is the BASE class on the email span as well as the id chip, so `.first()`
   is the ADDRESS on any row that carries one. */
const AMBIGUOUS_IDENT = /\.locator\(\s*["']\.perm-ident["']\s*\)\s*\.first\(\)/;
ok(AMBIGUOUS_IDENT.test('const ident = (await r.locator(".perm-ident").first().innerText().catch(() => "")).trim();'),
  "POSITIVE CONTROL: the ambiguous-discriminator rule FIRES on the line the drivers used");
ok(!AMBIGUOUS_IDENT.test('const idEl = r.locator(".perm-ident-id"); const t = await idEl.first().getAttribute("title");'),
  "NEGATIVE CONTROL: reading the id chip specifically is not flagged");
ok(!AMBIGUOUS_IDENT.test('identSpans: await r.locator(".perm-ident").count(),'),
  "NEGATIVE CONTROL: COUNTING the ident spans is legitimate — it is how the suppression check works");
for (const f of permDrivers) {
  const src = readFileSync(path.join(here, f), "utf8");
  const drivesTab = /perm-search-item|perm-admin-card/.test(src);
  if (!drivesTab) continue;
  ok(/selectByDiscriminator|makeRosterUI/.test(src),
    `${f}: the account is chosen by selectByDiscriminator, not by this driver's own idea of which row`);
  const amb = src.split("\n").map((l, i) => ({ l, n: i + 1 })).filter(({ l }) => AMBIGUOUS_IDENT.test(l)).map(({ n }) => n);
  ok(amb.length === 0, `${f}: no ambiguous \`.perm-ident\` discriminator read (at: ${amb.join(", ")})`);
}

/* ── 4d. F-662 — NO DRIVER MAY KEEP A SECOND EMAIL MASK ─────────────────────────
   The defect was not a bad regex, it was a SECOND regex. Removing the one copy without
   this rule schedules its return: the next driver that wants "belt and braces" writes its
   own `EMAIL_RE` and the two homes drift again. A `@` inside a character class is the
   discriminator — `lib/redact.mjs` is the only file allowed to define one. */
function scanLocalEmailRules(src) {
  return src.split("\n")
    .map((l, i) => ({ l, n: i + 1 }))
    .filter(({ l }) => /\/[^\/\n]*\[[^\]\n]*\][^\/\n]*@/.test(l) || /\bEMAIL_RE\b/.test(l))
    .filter(({ l }) => !/^\s*\*/.test(l) && !/^\s*\/\//.test(l))       // prose in a docblock
    .map(({ n }) => n);
}
/* POSITIVE CONTROL — the line this rule exists to have caught, verbatim from the driver. */
ok(scanLocalEmailRules("const EMAIL_RE = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\\.[A-Za-z]{2,})/g;").length === 1,
  "POSITIVE CONTROL: the second-email-rule scan FIRES on the deleted local regex");
ok(scanLocalEmailRules(' * `o\'brien@tenant.com` is masked by the shared rule.').length === 0,
  "NEGATIVE CONTROL: an address discussed in a docblock is not a rule");
ok(scanLocalEmailRules('  info(`row ${r.i}: email=${r.emailShown}`);').length === 0,
  "NEGATIVE CONTROL: an ordinary line mentioning email is not a rule");
const emailRuleOffenders = [];
for (const f of liveFiles) {
  for (const n of scanLocalEmailRules(readFileSync(path.join(here, f), "utf8"))) emailRuleOffenders.push(`${f}:${n}`);
}
ok(emailRuleOffenders.length === 0,
  `F-662: lib/redact.mjs is the ONLY home of the email rule (second homes at: ${emailRuleOffenders.join(", ")})`);

/* ── 4e. F-686 — NO DRIVER ARMS A USER-VISIBLE FAULT WITHOUT THE SHARED-DEV ACK ──
   F-679 wrote the refusal and put it in ONE file. Four drivers armed the same levers on
   the same shared tenant; three of them had nothing but `--env=dev`, and one had not even
   that. The recurrence-proof fix is not "add the guard three times" — it is this rule: if
   a `*-live.mjs` calls arm{KeyRead,Jira,Dispatch,HookPromote}Fault, it must import
   `requireEnvAck` from lib/shared-env-guard.mjs. A fifth fault driver written next month
   with its own inline copy fails `npm run test:offline` before it is ever run.

   The scan ignores docblock prose, or every file that merely EXPLAINS the lever would be
   dragged in — the discriminator is a call, not a mention. */
/* F-736 — THE COHORT IS EVERY GATED LEVER, NOT THE FOUR THAT EXISTED WHEN 4e WAS CUT.
   `armDeleteFault` is the seventh lever and F-721 gave it its `FAULT_HARMS` sentence, but
   only half of that note shipped: this alternation never learned the name, so a
   delete-fault driver written next month could carry its own inline refusal (or none) and
   `scanArmCalls` would return `[]` — the file simply would not be in `armingDrivers`, and
   the three per-file assertions below would never run against it. 4e's docblock promise
   ("a fifth fault driver written next month … fails `npm run test:offline`") was false for
   it. It is green today only because `delete-fault-drain-live.mjs` happens to import the
   guard for its own reasons, which is luck, not a rule. `\barm` keeps `disarmDeleteFault`
   out: there is no word boundary between the `s` and the `a`. */
const ARM_CALL = /\barm(?:KeyRead|Jira|Git ?Dispatch|Dispatch|HookPromote|Delete)Fault\b/;
function scanArmCalls(src) {
  return src.split("\n")
    .map((l, i) => ({ l, n: i + 1 }))
    .filter(({ l }) => !/^\s*\*/.test(l) && !/^\s*\/\//.test(l))       // prose in a docblock
    .filter(({ l }) => ARM_CALL.test(l))
    .map(({ n }) => n);
}
/* POSITIVE CONTROLS — the exact arming lines the unguarded drivers carried. */
ok(scanArmCalls('const arm = (mode, ttl) => hook({ action: "armKeyReadFault", provider: PROVIDER, mode, ttl });').length === 1,
  "POSITIVE CONTROL: the arming scan FIRES on the armKeyReadFault line key-status-fault-ui-live.mjs carried unguarded");
ok(scanArmCalls('  const t = await hook({ action: "armJiraFault", path: PATH, status: 429, ttlSeconds: 240 });').length === 1,
  "POSITIVE CONTROL: …and on the armJiraFault line user-search-fault-live.mjs carried with no --env at all");
ok(scanArmCalls('        const armed = await hook({ action: "armHookPromoteFault", connectionId: c, repoId: R, count: 1 });').length === 1,
  "POSITIVE CONTROL: …and on armHookPromoteFault, so the rule is not narrowed to the two key/jira levers");
/* F-736 — verbatim from delete-fault-drain-live.mjs:447, the only caller that exists today.
   It is the control that would have failed before the `Delete` branch was added. */
ok(scanArmCalls('  const armLever = (mode, count) => hook({ action: "armDeleteFault", mode, count, ttlSeconds: TTL_SECONDS });').length === 1,
  "POSITIVE CONTROL: …and on armDeleteFault, the seventh gated lever — F-721 gave it a FAULT_HARMS sentence and 4e never learned its name (F-736)");
/* NEGATIVE CONTROLS — a file may DISCUSS or DISARM a lever without arming one. */
ok(scanArmCalls(' * `armKeyReadFault("openai", "refuse")` is the door this driver opens.').length === 0,
  "NEGATIVE CONTROL: a docblock naming the lever is not an arming");
ok(scanArmCalls('const disarm = () => hook({ action: "disarmKeyReadFault", provider: PROVIDER });').length === 0,
  "NEGATIVE CONTROL: disarming is not arming — cleanup must never trip the rule");
ok(scanArmCalls('  const disarmLever = () => hook({ action: "disarmDeleteFault" });').length === 0,
  "NEGATIVE CONTROL: …and the new Delete branch does not swallow its own disarm either (F-736)");
ok(scanArmCalls('const readLever = () => hook({ action: "readKeyReadFault", provider: PROVIDER });').length === 0,
  "NEGATIVE CONTROL: reading the lever row is not arming");

const armingDrivers = liveFiles.filter((f) => scanArmCalls(readFileSync(path.join(here, f), "utf8")).length > 0);
ok(armingDrivers.length >= 4,
  `F-686: the rule found the fault-arming drivers to apply to (${armingDrivers.join(", ")})`);
for (const f of armingDrivers) {
  const src = readFileSync(path.join(here, f), "utf8");
  ok(/from "\.\.\/lib\/shared-env-guard\.mjs"/.test(src),
    `${f}: arms a user-visible fault, so it must import the shared-dev guard from lib/shared-env-guard.mjs`);
  ok(/requireEnvAck\s*\(/.test(src),
    `${f}: …and must actually CALL requireEnvAck — an unused import is not a guard`);
  /* The guard is only worth anything if it runs BEFORE the levers. An inline second copy
     of the refusal is the drift this rule exists to prevent, so it is an offence too. */
  ok(!/console\.error\(\[[\s\S]{0,400}?i-know-dev-is-shared/.test(src),
    `${f}: the refusal TEXT has one home — no driver keeps its own copy of it`);
}

/* ── 4f. F-699 — THE ENVIRONMENT MAPPING HAS ONE HOME, AND IT IS NOT A DRIVER ────
   `lib/shared-env-guard.mjs` claimed in its own docblock that it returned the web-trigger
   URL "so no driver re-decides that mapping" — on a day when SEVENTEEN `*-live.mjs` still
   carried the env→URL ternary inline, FIVE of them with INVERTED polarity
   (`ENV_NAME === "staging" ? STAGING : TESTSTATE_URL`), so an unrecognised `--env` there
   resolved to the SHARED DEV tenant: the exact target the guard defaults away from. The
   env→Forge-env-id fork — the same decision one line below — sat byte-copied in eighteen
   more. One rule, thirty-odd homes, two polarities.

   Unifying them without this rule schedules the return: the next driver is written by
   copying the nearest sibling, and the nearest sibling is where the ternary used to be. So
   the discriminator is the LITERAL. A driver may not read `STAGING_TESTSTATE_URL`, and may
   not retype an environment id UUID; both come out of the one table, via `requireEnvAck`
   (settles one environment, refuses the shared tenant, returns the whole row), `forgeEnvId`
   (the id alone, for a dev-only Playwright script with no web trigger and no `.env`) or
   `hookUrlFor`/`hookUrlVar` (for `probes-1.5-live.mjs`, which talks to BOTH environments in
   one run and so cannot settle on one).

   `TESTSTATE_URL` on its own is NOT an offence: a dev-only driver reading the dev trigger
   is not deciding a mapping, it is naming the only environment it has. The defect is the
   FORK and the second copy of the staging half.

   Docblock prose is exempt, as everywhere else in this file — a header that says
   "Env: STAGING_TESTSTATE_URL + HARNESS_SECRET" is documentation, and a rule that reads it
   goes red on a correct file. The discriminator is a read, not a mention. */
const ENV_ID_LITERAL = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/;
const KNOWN_ENV_IDS = ["989ecaa0-261b-406e-b444-78c01c0d7772", "1abe9beb-537b-43c1-b94f-e877e251f779"];
function scanEnvMappingHomes(src) {
  return src.split("\n")
    .map((l, i) => ({ l, n: i + 1 }))
    .filter(({ l }) => !/^\s*\*/.test(l) && !/^\s*\/\//.test(l))       // prose in a docblock
    .filter(({ l }) => /STAGING_TESTSTATE_URL/.test(l) || KNOWN_ENV_IDS.some((id) => l.includes(id)))
    .map(({ n }) => n);
}
/* POSITIVE CONTROLS — every shape the directory actually carried, verbatim. */
ok(scanEnvMappingHomes('const HOOK_URL = ENV_NAME === "dev" ? env.TESTSTATE_URL : env.STAGING_TESTSTATE_URL;').length === 1,
  "POSITIVE CONTROL (F-699): the mapping rule FIRES on the env→URL ternary seventeen drivers carried");
ok(scanEnvMappingHomes('const HOOK_URL = ENV_NAME === "staging" ? env.STAGING_TESTSTATE_URL : env.TESTSTATE_URL;').length === 1,
  "POSITIVE CONTROL: …and on the INVERTED polarity, which landed an unknown --env on the shared dev tenant");
ok(scanEnvMappingHomes('const URL_ = process.env.STAGING_TESTSTATE_URL || env.STAGING_TESTSTATE_URL || "";').length === 1,
  "POSITIVE CONTROL: …and on the staging-only read the coder drivers carried, which is the same second home without the fork");
ok(scanEnvMappingHomes('const ENV_ID = arg("envid", ENV_NAME === "dev" ? "989ecaa0-261b-406e-b444-78c01c0d7772" : "1abe9beb-537b-43c1-b94f-e877e251f779");').length === 1,
  "POSITIVE CONTROL: …and on the env-id ternary that was byte-copied into four drivers");
ok(scanEnvMappingHomes('const ADMIN_PAGE = "https://x/jira/apps/36415848-6868-4697-9554-3c3ad87b8da9/989ecaa0-261b-406e-b444-78c01c0d7772";').length === 1,
  "POSITIVE CONTROL: …and on an id buried inside an admin-page URL, which is how nine more drivers hid it");
/* NEGATIVE CONTROLS — the fixed shapes, and the things that must NOT be dragged in. */
ok(scanEnvMappingHomes('const { envName: ENV_NAME, hookUrl: HOOK_URL, envId: ENV_ID_DEFAULT } = requireEnvAck(process.argv.slice(2), { faults: [], defaultEnv: "staging" });').length === 0,
  "NEGATIVE CONTROL: the converted call site is clean");
ok(scanEnvMappingHomes('const ENV_ID = forgeEnvId("dev");').length === 0,
  "NEGATIVE CONTROL: …as is the id-only helper");
ok(scanEnvMappingHomes(' * Env: STAGING_TESTSTATE_URL + HARNESS_SECRET + HARNESS_ADMIN_ACCOUNT_ID.').length === 0,
  "NEGATIVE CONTROL: a docblock naming the variable an operator must set is documentation, not a second home");
ok(scanEnvMappingHomes('const HOOK_URL = env.TESTSTATE_URL;').length === 0,
  "NEGATIVE CONTROL: a dev-only driver reading the dev trigger decides no mapping and is left alone");
ok(scanEnvMappingHomes('const APP = "36415848-6868-4697-9554-3c3ad87b8da9";').length === 0,
  "NEGATIVE CONTROL: the APP id is a UUID too, and is not an environment — the rule names the two env ids, it does not ban UUIDs");
ok(ENV_ID_LITERAL.test(KNOWN_ENV_IDS[0]) && ENV_ID_LITERAL.test(KNOWN_ENV_IDS[1]),
  "the two ids this rule polices really are the UUID shape it describes");

const mappingOffenders = [];
for (const f of liveFiles) {
  for (const n of scanEnvMappingHomes(readFileSync(path.join(here, f), "utf8"))) mappingOffenders.push(`${f}:${n}`);
}
ok(mappingOffenders.length === 0,
  `F-699: lib/shared-env-guard.mjs is the ONLY home of the environment mapping (second homes at: ${mappingOffenders.join(", ")})`);
/* …and the guard really is that home, so a green rule above is not green because the
   table was deleted along with its copies. */
const guardSrc = readFileSync(path.join(here, "../lib/shared-env-guard.mjs"), "utf8");
for (const id of KNOWN_ENV_IDS) {
  ok(guardSrc.includes(id), `F-699: the guard carries the ${id.slice(0, 8)}… environment id — the one home is populated`);
}
ok(/STAGING_TESTSTATE_URL/.test(guardSrc) && /TESTSTATE_URL/.test(guardSrc),
  "F-699: …and both web-trigger variable names, so nothing was unified by deletion");

/* ── 4f-1. F-715 — THE ENV-ID HALF COVERS lib/ AND scripts/, NOT JUST THE DRIVERS ──
   ABSORBED FROM `live-driver-scope.test.mjs` RULE 3 by F-718, which is the same medicine
   this rule prescribes: that rule's own comment said "it belongs in 4f and should be
   folded there when that file is not held by another pass", and a rule about second homes
   living in two homes is the joke writing itself. `live-driver-scope.test.mjs` now carries
   a pointer here and nothing else.

   The cohort above is `scripts/*-live.mjs`, so on the day 4f shipped the dev id had a
   SECOND home in `lib/workflow.mjs` — exported, and imported by 58 harness scripts, where
   it builds every extension ARI the workflow-attach path uses — and the staging id a THIRD
   in `scripts/_probe-shadow-badge.mjs`. A LIBRARY is precisely where "the next driver is
   written by copying the nearest sibling" bites hardest. The ids are NOT secrets (they are
   in every Custom UI ARI the browser sees); the defect is DRIFT when an environment is
   redeployed, which would leave the one edit here and every copy addressing a dead env.

   The ids are read out of the guard's own table, so this rule and the one above cannot
   disagree about what they are policing. */
{
  const ids = [...guardSrc.matchAll(/forgeEnvId:\s*"([0-9a-f-]{36})"/g)].map((m) => m[1]);
  ok(ids.length === 2, `F-715: the guard's table carries both environment ids (${ids.length})`);
  ok(ids.every((id) => KNOWN_ENV_IDS.includes(id)),
    "F-715: …and they are the same two ids rule 4f names, so the wide scan and the driver scan police one set");

  /* `org-workflow-compiler.test.mjs` is a FIXTURE: it asserts a compiled ARI string, so the
     id is the thing under test rather than a configuration copy. This file is the rule's
     HOME: it asserts the guard CONTAINS both ids, so the literals here are the subject of a
     check, not a copy of config. */
  const EXEMPT = new Set(["shared-env-guard.mjs", "org-workflow-compiler.test.mjs", "evidence-redaction.test.mjs"]);
  const libDir = path.join(here, "..", "lib");
  const wideCohort = [
    ...readdirSync(libDir).filter((f) => f.endsWith(".mjs")).map((f) => ["lib", f, path.join(libDir, f)]),
    ...readdirSync(here).filter((f) => f.endsWith(".mjs")).map((f) => ["scripts", f, path.join(here, f)]),
  ].filter(([, f]) => !EXEMPT.has(f));
  ok(wideCohort.length > 80, `F-715: the env-id cohort covers lib AND scripts (${wideCohort.length} files)`);
  ok(wideCohort.some(([d]) => d === "lib") && wideCohort.some(([d]) => d === "scripts"),
    "F-715: …and really does contain files from BOTH, so a green result is not an empty list");

  const wideOffenders = [];
  for (const [dir, f, full] of wideCohort) {
    const src = readFileSync(full, "utf8");
    for (const id of ids) if (src.includes(id)) wideOffenders.push(`${dir}/${f}:${id.slice(0, 8)}…`);
  }
  ok(wideOffenders.length === 0,
    `F-715: no file under lib/ or scripts/ retypes an environment id instead of reading forgeEnvId() (${wideOffenders.join(", ")})`);

  /* POSITIVE CONTROLS: the two pre-fix lines, verbatim, through the same predicate. */
  const flags = (src) => ids.filter((id) => src.includes(id));
  ok(flags(`export const ENV_ID = "${ids[0]}";`).length === 1,
    "POSITIVE CONTROL (F-715): the pre-fix lib/workflow.mjs export of the dev id is caught");
  ok(flags(`await p.goto("https://wolfaenpak.atlassian.net/jira/apps/x/${ids[1]}")`).length === 1,
    "POSITIVE CONTROL (F-715): the pre-fix _probe-shadow-badge.mjs staging admin-page URL is caught");
  ok(flags('const ENV_ID = forgeEnvId("dev");').length === 0,
    "NEGATIVE CONTROL (F-715): reading the id through forgeEnvId() is clean");
}

/* ── 4g. F-718 — A DRIVER'S `mutates` IS ITS TRUE SET ───────────────────────────
   The shared-dev acknowledgement used to be drawn at ARMS-A-FAULT. The result was that
   `plant-sweep-live.mjs`, which plants INERT ballast, demanded `--i-know-dev-is-shared`,
   while `va-purge-on-delete-live.mjs` DELETED a virtual agent, `coder-pin-kept-live.mjs`
   REWROTE `COGNIRUNNER_AI_PROVIDER` and `knowledge-doors-editor-live.mjs` WROTE SKILLS
   into the shared store — all on `--env=dev`, in silence. The line is now MUTATES SHARED
   DEV, and `requireEnvAck` takes a `mutates:` array beside `faults:`.

   A declaration nobody checks is a comment. This rule is the check, and it has to go BOTH
   ways, because each direction fails differently:
     - a driver that CALLS a mutator and declares `mutates: []` is the F-718 defect exactly
       — it runs on the shared tenant with no refusal;
     - a driver that declares a mutation it never performs cries wolf, and a refusal nobody
       believes is the refusal people learn to pass `--i-know-dev-is-shared` through
       without reading. That is how F-679's text stops working.

   WHAT THIS RULE DOES NOT DO, stated rather than hidden: it does not check that the WORDS
   match the mutators found. A token→word map would be a second home of the classification
   (LAW 1) and would rot the first time a resolver was renamed; the words are a human
   judgement the driver's author makes and this file cannot audit. The rule polices the
   EMPTY/NON-EMPTY boundary, which is the one the refusal actually turns on.

   COHORT LIMIT, ONE OF TWO, AND THE OTHER IS THE LIVE ONE. The cohort gap this docblock
   used to state — "only drivers that CALL `requireEnvAck` can declare anything, which is
   31 of the 57" — was CLOSED by F-733: the dev-only 26 declare through `declareMutations`,
   and the union is asserted below to be every `*-live.mjs`. Saying otherwise here was a
   docblock outliving its defect, which is F-699's own failure mode.

   THE LIMIT THAT REMAINS IS VISIBILITY (F-737). `callsMutator` is a TOKEN SCAN over one
   file. It cannot see a write made by CLICKING the product, and it cannot see a write a
   `lib/` helper makes on the driver's behalf unless the helper's name is itself in the
   list. Both halves are addressed as far as a scanner can: the shared writers are
   IMPORT-AWARE (lib/jira.mjs, lib/workflow.mjs, lib/rules-api.mjs), and a driver that
   drives the product UI is marked UNAUDITABLE and excused from the cry-wolf arm only —
   never from the arm that matters. What is NOT closed, and cannot be by this file: a UI
   driver that declares `[]` while clicking a write. That is F-734's shape, it is a human
   judgement, and the honest thing is to say so rather than to imply the scan covers it. */
const MUTATOR_CALLS = [
  /* test-hook actions that write the tenant directly */
  /\bkvSet\b/, /\bvaTombstone\b/, /\bplantHarnessFaults\b/, /\bclearPlantedFaults\b/,
  /\bsweepHarnessFaults\b/, /\bplantHookSecret\b/, /\bdeleteHarnessConnection\b/, /\bmintApiToken\b/,
  /* resolvers that write: knowledge, memories, provider slots, agents, jobs, listeners, tokens */
  /\bsaveSkill\b/, /\bdeleteSkill\b/, /\bsaveContextDoc\b/, /\bdeleteContextDoc\b/,
  /\baddMemory\b/, /\bupdateMemory\b/, /\bdeleteMemory\b/, /\bsaveMemorySettings\b/,
  /\bsaveAgentModel\b/, /\bstartCoderTurn\b/,
  /\bsaveScheduledJob\b/, /\bdeleteScheduledJob\b/, /\brunScheduledJobNow\b/,
  /\bsaveListener\b/, /\bdeleteListener\b/,
  /\bcreateApiToken\b/, /\brevokeApiToken\b/, /\bdeleteApiToken\b/,
  /\bregisterRule\b/, /\bremoveRule\b/, /\btriggerGitDeploy\b/,
  /* the app's own permission writes */
  /\baddAppAdmin\b/, /\bgrantRole\b/, /\bremoveAccount\b/,
  /* F-733 — doors the list did not know because no GUARDED driver used them, and the
     dev-only cohort is full of them. Each was found by declaring the 26 honestly and
     watching this rule call a TRUE declaration a cry of wolf. */
  /\bseedSkill\b/,                                   // the hook's skill writer/restorer
  /\bdeleteIssueFixture\b/,                          // lib/fixture-cleanup.mjs — a real DELETE
  /* F-737 — the verb list is the WRITERS on `rulesApi`, and `enable`/`disable` change
     whether real Jira events run rules while `test` EXECUTES one. `preview` and the
     getters stay out: a dry run and a read are not mutations. */
  /\brulesApi\.[A-Za-z]+\.(?:create|update|remove|run|enable|disable|test)\b/,
  /\bprobeJsmComment\b/,                            // the hook probe that COMMENTS on a real JSM issue
];

/** `gh api -X POST|PUT|DELETE …` — a repository write driven through the GitHub CLI. It is a
 *  mutation of a real repo, and `pipeline-scaffold-live.mjs` makes several. */
function writesRepo(code) {
  return /["']-X["']\s*,\s*["'](?:POST|PUT|PATCH|DELETE)["']/.test(code);
}

/* THE SHARED JIRA WRITERS, IMPORT-AWARE (F-733). `writesJira` below matches a literal
 * `method: "POST"` beside a REST path, which is how a driver that builds its own fetch writes.
 * A driver that imports `post`/`put`/`del`/`doTransition` from `lib/jira.mjs` writes Jira just
 * as hard, and the literal lives in the LIBRARY — so eight honestly-declared drivers were
 * reported as declaring a mutation they never made. The import clause is what makes a bare
 * `post(` a Jira write rather than `testState.post(`, which is a harness hook call. */
const JIRA_WRITE_HELPERS = ["post", "put", "del", "doTransition"];
const WORKFLOW_WRITE_HELPERS = ["updateWorkflow", "attachSelfLoopRules"];
/* F-737 — REACHING THE RULES REST CLIENT AT ALL IS A WRITE, WHATEVER VERB FOLLOWS.
 * `ensureRulesApi()` MINTS AN API TOKEN on the tenant (`action: "mintApiToken"`), and every
 * `rulesApi.*` and `api()` call goes through it — so a driver that only LISTS listeners still
 * creates a token row, against a live cap of 25, and `closeRulesApi` revoking it is a restore
 * and not an absence of mutation. The token name is typed ONLY inside `lib/rules-api.mjs`, so
 * `mintApiToken` being in the list above never fired for any driver: the word is in the
 * library, the call is in the driver. That is the shape of this whole gap. */
const RULES_API_HELPERS = ["ensureRulesApi", "rulesApi", "api", "closeRulesApi"];
function importedWriters(code, moduleRe, wanted) {
  const out = new Set();
  for (const m of code.matchAll(new RegExp(`\\bimport\\s*\\{([^}]*)\\}\\s*from\\s*["'][^"']*${moduleRe}["']`, "g"))) {
    for (const spec of m[1].split(",")) {
      const parts = spec.trim().split(/\s+as\s+/);
      if (wanted.includes(parts[0].trim())) out.add(parts[parts.length - 1].trim());
    }
  }
  return out;
}
/** A Jira write is a TWO-LINE shape (`jira(\`/rest/api/…\`, {` then `method: "POST",`), so
 *  it is matched on the whole file rather than per line — the only rule here that is. */
function writesJira(code) {
  return /\/rest\/(api|servicedeskapi)\//.test(code) && /\bmethod:\s*"(POST|PUT|DELETE)"/.test(code);
}
/* A NAME QUOTED INSIDE ANOTHER STRING IS A SEARCH PATTERN, NOT A CALL (F-733).
 * `campaign-test-run-ui-live.mjs` watches the network for a save it must NEVER see —
 * `(r.postData() || "").includes('"saveListener"')` — and then ASSERTS the list is empty.
 * A `\bsaveListener\b` scan reads that as a write and calls a read-only driver a liar, which
 * is the "cry wolf" half of this rule firing on the one file that proves it does not write.
 * The discriminator is the NESTED quote: a resolver or action name is a call when it is
 * invoked (`name(`) or quoted DIRECTLY (`action: "kvSet"`, `call('saveListener', …)`), and a
 * pattern when its quotes are themselves inside quotes. */
const mutatorNameRe = (name) =>
  new RegExp(`\\b${name}\\s*\\(|(?<!["'\`])(["'\`])${name}\\1(?!["'\`])`);

function callsMutator(code) {
  const hits = MUTATOR_CALLS
    .filter((re) => {
      const name = String(re).match(/^\/\\b([A-Za-z]+)\\b\/$/);
      return name ? mutatorNameRe(name[1]).test(code) : re.test(code);
    })
    .map((re) => String(re).slice(3, -3));
  if (writesJira(code)) hits.push("jira:POST/PUT/DELETE");
  if (writesRepo(code)) hits.push("gh:-X POST/PUT/DELETE");
  for (const n of importedWriters(code, "lib/jira\\.mjs", JIRA_WRITE_HELPERS)) {
    if (new RegExp(`\\b${n}\\s*\\(`).test(code)) hits.push(`jira:${n}()`);
  }
  for (const n of importedWriters(code, "lib/workflow\\.mjs", WORKFLOW_WRITE_HELPERS)) {
    if (new RegExp(`\\b${n}\\s*\\(`).test(code)) hits.push(`workflow:${n}()`);
  }
  /* `rulesApi` is an OBJECT, not a function, so it is a hit on any member call — the token is
     already minted by then. The others are called directly. */
  for (const n of importedWriters(code, "lib/rules-api\\.mjs", RULES_API_HELPERS)) {
    if (new RegExp(`\\b${n}\\s*[.(]`).test(code)) hits.push(`rulesApi:${n} (mints a token)`);
  }
  return hits;
}

/* F-737 — A DRIVER THAT CLICKS THE PRODUCT CANNOT BE AUDITED BY A TOKEN SCAN.
 * `perm-namesake-ui-live.mjs` GRANTS AN APP-ADMIN ROLE by clicking a row in the Permissions
 * tab and proves it landed by diffing `app_admins` in KVS. There is no resolver name, no
 * `method: "POST"` and no helper import anywhere in the file — the write is a mouse event —
 * so `callsMutator` returns `[]` and the cry-wolf arm below would call its honest
 * `mutates: ["roster"]` a declaration it never performs (F-734). The scan is not going to
 * learn to read Playwright. What it CAN do is know that it cannot see, and stop asserting the
 * one direction it is blind in: a UI driver is excused from "declares but calls no mutator"
 * and is NOT excused from "calls a mutator so may not declare []", which is the arm the
 * refusal turns on. The blindness is then stated in the docblock rather than implied by a
 * green result. */
function drivesProductUI(code) {
  /* BOTH IMPORT SHAPES. Half this cohort imports Playwright statically at module top
     (`import { chromium } from "…/playwright/index.mjs"`), and half — including
     perm-namesake-ui-live.mjs, the driver this exemption exists for — imports it DYNAMICALLY
     inside the browser helper (`await import("…/playwright/index.mjs")`) so the file can be
     read offline without the browser package present. A `from`-only match saw the first half
     and missed the second, which is the half that matters. */
  return /(?:\bfrom|\bimport\s*\()\s*["'][^"']*playwright[^"']*["']/.test(code) && /\.click\s*\(/.test(code);
}
/** The declared array, read out of the `mutates:` literal OR — for a dev-only driver with no
 *  `--env` to resolve — out of `declareMutations([…])`, which is the same declaration with the
 *  environment half removed (F-733). `null` = no declaration found, which the guard THROWS on
 *  either way, so it can never ship. */
function declaredMutations(code) {
  const m = code.match(/\bmutates:\s*\[([^\]]*)\]/) || code.match(/\bdeclareMutations\s*\(\s*\[([^\]]*)\]/);
  if (!m) return null;
  return [...m[1].matchAll(/"([A-Za-z]+)"/g)].map((x) => x[1]);
}
/* POSITIVE CONTROLS — the three shapes F-718 found, verbatim from the drivers. */
ok(callsMutator('const r = await hook({ action: "kvSet", key: AGENT_MODEL_SLOT, value: v });').length === 1,
  "POSITIVE CONTROL (F-718): the mutator scan FIRES on the kvSet that rewrote a provider slot on dev unguarded");
ok(callsMutator('await invoke("deleteScheduledJob", { id });').length === 1,
  "POSITIVE CONTROL (F-718): …and on the job/agent delete va-purge-on-delete-live.mjs runs");
ok(callsMutator('const s = await invoke("saveSkill", { skill });').length === 1,
  "POSITIVE CONTROL (F-718): …and on the skill write knowledge-doors-editor-live.mjs makes into the shared store");
ok(callsMutator('const post = await jira(`/rest/api/3/issue/${k}/comment`, {\n  method: "POST",\n  body,\n});').length === 1,
  "POSITIVE CONTROL (F-718): …and on a REAL Jira write, whose url and method sit on different lines");
/* NEGATIVE CONTROLS — reads, and the two-part Jira predicate's halves on their own. */
ok(callsMutator('const r = await invoke("getScheduledJob", { id });').length === 0,
  "NEGATIVE CONTROL: a getter is not a mutator");
ok(callsMutator('const r = await hook(null, "GET", `?what=kvs&key=${k}`);').length === 0,
  "NEGATIVE CONTROL: READING a kvs row through the GET door is not kvSet");
ok(callsMutator('const PATH = "/rest/api/3/user/search";').length === 0,
  "NEGATIVE CONTROL: naming a REST path without a write method is not a Jira write — user-search-fault-live.mjs only reads it");
ok(callsMutator('const r = await fetch(HOOK, { method: "POST", body });').length === 0,
  "NEGATIVE CONTROL: POSTing to the harness web trigger is how EVERY driver talks to the app — it is not a Jira write");
ok(callsMutator('await invoke("disarmKeyReadFault", { provider: P });').length === 0,
  "NEGATIVE CONTROL: disarming a lever is a fault concern, declared under faults:, not a mutation");
/* ── F-733 · THE DOORS THE LIST DID NOT KNOW, each with the shape that found it ──── */
ok(callsMutator('import { get, post, del } from "../lib/jira.mjs";\nconst k = (await post("/rest/api/3/issue", f)).key;').length === 1,
  "POSITIVE CONTROL (F-733): a Jira write through the SHARED helper is a write — the `method: \"POST\"` literal lives in lib/jira.mjs, and eight honestly-declared drivers were reported as crying wolf because of it");
ok(callsMutator('import { get, getIssue } from "../lib/jira.mjs";\nconst r = await get("/rest/api/3/issue/X");').length === 0,
  "NEGATIVE CONTROL: importing the READ helpers from the same module is not a write — the import clause is the discriminator, not the module");
ok(callsMutator('import { post as jpost } from "../lib/jira.mjs";\nawait jpost("/rest/api/3/issue", f);').length === 1,
  "…and an `as` RENAME does not hide it");
ok(callsMutator('const r = await testState.post({ action: "readHarnessProbe" });').length === 0,
  "NEGATIVE CONTROL: `testState.post` is a harness hook call, not a Jira write — which is why the import clause has to decide");
ok(callsMutator('import { readWorkflow, updateWorkflow } from "../lib/workflow.mjs";\nawait updateWorkflow(top, wf);').length === 1,
  "POSITIVE CONTROL (F-733): rewriting a WORKFLOW is a `rules` mutation and was invisible for the same reason");
ok(callsMutator('const L = await rulesApi.listeners.create({ name: "x" });').length === 1,
  "POSITIVE CONTROL (F-733): the Rules REST client's writers count too");
ok(callsMutator('const r = await rulesApi.listeners.get(id);').length === 0,
  "NEGATIVE CONTROL: …and its readers do not");
/* F-737 — the verbs the list did not know, and the helper door that bypasses all of them. */
ok(callsMutator('await rulesApi.listeners.enable(id);').length === 1,
  "POSITIVE CONTROL (F-737): `enable` is a write — a listener that starts running real Jira events is a tenant change, and the verb list held only create/update/remove/run");
ok(callsMutator('await rulesApi.jobs.disable(id);').length === 1,
  "POSITIVE CONTROL (F-737): …so is `disable`");
ok(callsMutator('await rulesApi.listeners.test(id, { sample });').length === 1,
  "POSITIVE CONTROL (F-737): …and `test` EXECUTES the listener, which is why it is not a read");
ok(callsMutator('await rulesApi.jobs.preview(id, {});').length === 0,
  "NEGATIVE CONTROL (F-737): `preview` is a dry run and stays out — the boundary is real work, not the shape of the call");
ok(callsMutator('import { ensureRulesApi } from "../lib/rules-api.mjs";\nconst { url } = await ensureRulesApi();').length === 1,
  "POSITIVE CONTROL (F-737): `ensureRulesApi()` MINTS AN API TOKEN against a live cap of 25 — `mintApiToken` is in the list above but is typed only inside the library, so the word is in one file and the call is in another");
ok(callsMutator('import { rulesApi, closeRulesApi } from "../lib/rules-api.mjs";\nconst r = await rulesApi.listeners.list();').length >= 1,
  "POSITIVE CONTROL (F-737): …and a driver that only LISTS still mints one, so reaching the client at all is the mutation, whatever verb follows");
ok(callsMutator('import { testState } from "../lib/rules-api.mjs";\nconst r = await testState.get("rulesApiUrl");').length === 0,
  "NEGATIVE CONTROL (F-737): importing only `testState` from the same module is the raw hook door and mints nothing — the import clause decides, as it does for lib/jira.mjs");

/* F-737 — the UI detector, on the two shapes that exist and the one that must not trip it. */
ok(drivesProductUI('const { chromium } = await import("../../static/_screenshot-harness/node_modules/playwright/index.mjs");\nawait frame.locator(".perm-search-item").click();'),
  "POSITIVE CONTROL (F-737): the DYNAMIC import shape counts — perm-namesake-ui-live.mjs imports Playwright inside its browser helper, and a `from`-only match missed exactly the driver the exemption exists for");
ok(drivesProductUI('import { chromium } from "playwright";\nawait frame.locator(".perm-search-item").click();'),
  "POSITIVE CONTROL (F-737): a Playwright driver that CLICKS is unauditable — perm-namesake-ui-live.mjs grants an app-admin role with a mouse event and no scannable token (F-734)");
ok(!drivesProductUI('import { chromium } from "playwright";\nconst n = await frame.locator(".perm-admin-card").count();'),
  "NEGATIVE CONTROL (F-737): a Playwright driver that only READS the DOM is auditable like any other — opening a browser is not the discriminator, clicking is");
ok(!drivesProductUI('const r = await hook({ action: "kvSet" });\nbtn.click();'),
  "NEGATIVE CONTROL (F-737): a `.click(` with no Playwright import is not a product UI driver");
ok(callsMutator('gh(["api", "-X", "POST", `/repos/${REPO}/git/refs`, "--input", "-"], body);').length === 1,
  "POSITIVE CONTROL (F-733): a `gh api -X POST` writes a real repository — pipeline-scaffold-live.mjs makes several and declared `git` honestly");
ok(callsMutator('gh(["api", `/repos/${REPO}/actions/variables`]);').length === 0,
  "NEGATIVE CONTROL: …and a `gh api` READ does not");
/* THE NESTED-QUOTE RULE, both ways. */
ok(callsMutator(`page.on('request', r => { if ((r.postData() || '').includes('"saveListener"')) seen.push(r); });`).length === 0,
  "POSITIVE CONTROL (F-733): a resolver name quoted INSIDE another string is a SEARCH PATTERN — campaign-test-run-ui-live.mjs watches for a save it asserts never happens, and a \\b scan called that read-only driver a liar");
ok(callsMutator(`const r = await call('saveListener', { listener });`).length === 1,
  "NEGATIVE CONTROL: …while the name quoted DIRECTLY as a call argument is still a write");
ok(callsMutator('const r = await hook({ action: "kvSet", key: K, value: v });').length === 1,
  "…as is an action name quoted directly in a hook body, which is how most of this list is used");
/* And the declaration reader, which the rule stands on. */
ok(declaredMutations('requireEnvAck(a, { faults: [], mutates: ["agents", "jobs"], defaultEnv: "dev" })').join(",") === "agents,jobs",
  "the declaration reader returns the words a driver named");
ok(declaredMutations('requireEnvAck(a, { faults: [], mutates: [], defaultEnv: "dev" })').length === 0,
  "…and an EMPTY declaration is an empty array, not a missing one");
ok(declaredMutations('requireEnvAck(a, { faults: [] })') === null,
  "…and a call with no `mutates` at all is null — which the guard itself THROWS on, so it can never ship");
/* F-733 — the dev-only form reads IDENTICALLY. That is the whole point: rule 4g is one rule,
   not two, and a driver that cannot resolve an environment still declares a blast radius. */
ok(declaredMutations('declareMutations(["roster"]);').join(",") === "roster",
  "F-733: the same reader sees the dev-only declaration");
ok(declaredMutations("declareMutations([]);").length === 0,
  "…and its EMPTY form is an empty array, not a missing one");

/* F-733 — THE COHORT IS NOW EVERY DRIVER, WHICH IS THE GAP THIS RULE USED TO STATE.
   The comment above said it plainly: only a driver that CALLS `requireEnvAck` could declare
   anything, twenty-five `*-live.mjs` never do, and several of those WRITE — roles granted,
   skills written into the shared store, a deploy pushed. Routing them through the guard was
   the wrong fix (F-699: it would make a Playwright script demand a `.env` and a
   `TESTSTATE_URL` it has no use for), so they got the DECLARATION half on its own. */
const guardedDrivers = liveFiles.filter((f) => {
  const code = stripComments(readFileSync(path.join(here, f), "utf8"));
  return /requireEnvAck\s*\(/.test(code) || /declareMutations\s*\(/.test(code);
});
ok(guardedDrivers.length >= 30,
  `F-718: the rule found the drivers that go through the guard and can therefore declare (${guardedDrivers.length})`);
ok(guardedDrivers.length === liveFiles.length,
  `F-733: EVERY *-live.mjs declares its blast radius — the dev-only cohort is no longer outside the rule (${liveFiles.filter((f) => !guardedDrivers.includes(f)).join(", ") || "none undeclared"})`);
{
  /* …and both halves of that union have real subjects, so a green result above is not green
     because one of the two doors was quietly emptied. */
  const viaGuard = guardedDrivers.filter((f) => /requireEnvAck\s*\(/.test(stripComments(readFileSync(path.join(here, f), "utf8"))));
  const viaDeclare = guardedDrivers.filter((f) => !viaGuard.includes(f));
  ok(viaGuard.length >= 25, `F-733: the environment-resolving door still holds its drivers (${viaGuard.length})`);
  ok(viaDeclare.length >= 20, `F-733: …and the dev-only door holds its own (${viaDeclare.length})`);
  /* A dev-only driver must NOT resolve an environment: `declareMutations` exists precisely so
     that it does not, and a file carrying both is a conversion done twice. */
  for (const f of viaDeclare) {
    const code = stripComments(readFileSync(path.join(here, f), "utf8"));
    ok(!/requireEnvAck\s*\(/.test(code),
      `${f}: declares through the dev-only door and must not ALSO call requireEnvAck — one home for the decision, per driver`);
    ok(/from\s+"\.\.\/lib\/shared-env-guard\.mjs"/.test(code),
      `${f}: imports declareMutations from the guard rather than describing its own blast radius (the F-686 defect, one cohort over)`);
  }
}
{
  let declaredSome = 0, declaredNone = 0, unauditable = 0;
  for (const f of guardedDrivers) {
    const code = stripComments(readFileSync(path.join(here, f), "utf8"));
    const declared = declaredMutations(code);
    ok(declared !== null, `${f}: declares a \`mutates:\` array — an undeclared blast radius is the F-718 defect`);
    if (declared === null) continue;
    const found = callsMutator(code);
    const ui = drivesProductUI(code);
    if (declared.length) declaredSome++; else declaredNone++;
    if (found.length) {
      /* THE ARM THAT MATTERS, AND IT APPLIES TO EVERY FILE. A UI driver gets no excuse
         here: if the scan CAN see a write, `mutates: []` is a lie whoever made it. */
      ok(declared.length > 0,
        `${f}: calls ${found.length} mutator(s) (${found.slice(0, 4).join(", ")}) so it may NOT declare \`mutates: []\` — it would run on shared dev with no refusal`);
    } else if (ui) {
      /* F-737 — UNAUDITABLE, AND SAID SO. The write is a mouse event; the scan is blind to
         it, and a blind rule must not answer. Counted, so the exemption cannot quietly
         grow to cover the directory. */
      unauditable++;
    } else {
      ok(declared.length === 0,
        `${f}: declares ${JSON.stringify(declared)} but this file calls no mutator in the maintained list — a refusal nobody believes is one people learn to flag through`);
    }
  }
  /* BOTH ARMS MUST HAVE SUBJECTS. A rule where every file took the same branch would be
     green for the wrong reason, and the empty-declaration arm is the one that rots first. */
  ok(declaredSome >= 15, `F-718: the mutating arm has real subjects (${declaredSome} drivers declare a non-empty mutates)`);
  ok(declaredNone >= 3, `F-718: …and so does the read-only arm (${declaredNone} drivers declare mutates: [])`);
  /* F-737 — AND THE EXEMPTION IS BOUNDED. It exists for a handful of Playwright drivers
     whose writes are clicks; if it ever covered most of the directory the rule would be
     asserting almost nothing and this number is where that shows up. */
  /* F-734 supplies this arm's first and (today) only subject: perm-namesake-ui-live.mjs
     declares `roster` for a grant made by clicking a row. An exemption with no subject is
     an exemption nobody is testing, so it is asserted from BOTH sides. */
  ok(unauditable >= 1,
    `F-737/F-734: the UI exemption has a real subject (${unauditable}) — a rule arm no file takes is green for the wrong reason`);
  ok(unauditable <= 12,
    `F-737: the UI exemption stays a handful (${unauditable} unauditable driver(s) declare a mutation the scan cannot confirm) — it excuses the cry-wolf arm only, never the one the refusal turns on`);
}
/* The guard really is the home of the vocabulary, so a green rule above is not green
   because the words mean nothing. Every word any driver declares must exist there. */
{
  /* The words IN DECLARATION ORDER, parsed out of MUTATION_HARMS — two-space indentation is
     the discriminator (ENVS' rows sit at four, FAULT_HARMS' values are arrow functions and
     never `: "`). `VOCAB` is the membership form; `MUTATION_WORDS` keeps the sequence, which
     F-739's parity check below compares against the README's transcription. */
  const MUTATION_WORDS = [...guardSrc.matchAll(/^\s{2}([a-zA-Z]+):\s*"/gm)].map((m) => m[1]);
  const VOCAB = new Set(MUTATION_WORDS);
  ok(MUTATION_WORDS.length === VOCAB.size && VOCAB.size >= 12,
    `F-739: the guard's vocabulary parses to ${VOCAB.size} distinct words — a parse that collapsed or duplicated would make the parity below meaningless`);
  ok(VOCAB.has("agents") && VOCAB.has("providerSlot") && VOCAB.has("kvs"),
    "F-718: MUTATION_HARMS in the guard is readable from here and carries the words the drivers use");
  const unknown = [];
  for (const f of guardedDrivers) {
    const declared = declaredMutations(stripComments(readFileSync(path.join(here, f), "utf8"))) || [];
    for (const w of declared) if (!VOCAB.has(w)) unknown.push(`${f}:${w}`);
  }
  ok(unknown.length === 0,
    `F-718: every declared word is in the guard's CLOSED vocabulary (unknown: ${unknown.join(", ")})`);

  /* ── F-739 — THE CLOSED VOCABULARY HAS TWO HOMES, AND ONLY ONE WAS CHECKED ──────
     Everything above reads the words OUT of the guard, so the guard and the drivers cannot
     drift. `README.md` retypes all twelve by hand in the F-718 paragraph, and nothing
     asserted that copy — LAW 1's signature defect, sitting inside the very range that
     folded `live-driver-scope`'s RULE 3 into 4f "because a rule about second homes is the
     last rule that should have two".

     The drift is not hypothetical in shape: the vocabulary is explicitly designed to GROW
     ("add a word to MUTATION_HARMS with its sentence"), and the day a thirteenth word is
     added the suite stays green — 4g parses the guard, so the new word is legal at once —
     while the README still teaches twelve. The next driver author reads the README as the
     closed set and either gets a THROW on a word that IS legal, or picks `kvs` as "the
     honest catch-all" for a mutation that now has its own word, and the refusal then prints
     a sentence describing the wrong blast radius. `rules` is already a word no driver uses,
     so the list's accuracy was never self-evident from the drivers either.

     ORDER IS ASSERTED TOO, not just membership. The README reads as a transcription of the
     table; keeping the sequence identical is free, and it makes "which one is missing"
     answerable from the diff rather than from a set subtraction. */
  const README = readFileSync(path.join(here, "../README.md"), "utf8");
  /** The backticked words inside the `closed vocabulary (…)` parenthesis, which wraps across
   *  lines in the prose. `null` when the paragraph is gone — which is a failure, not a pass. */
  function readmeVocabulary(md) {
    const at = md.indexOf("closed vocabulary (");
    if (at < 0) return null;
    const close = md.indexOf(")", at);
    if (close < 0) return null;
    return [...md.slice(at, close).matchAll(/`([a-zA-Z]+)`/g)].map((m) => m[1]);
  }
  /* CONTROLS — the parser has to be able to FAIL, or the parity below is decorative. */
  ok((readmeVocabulary("from a closed vocabulary (`roster`, `skills`,\n`kvs`); either array") || []).join(",") === "roster,skills,kvs",
    "F-739: the README vocabulary parser reads a list that WRAPS across lines, which the real paragraph does");
  ok(readmeVocabulary("no such paragraph here") === null,
    "F-739: …and answers null when the paragraph is gone, so deleting the sentence fails the parity rather than satisfying it");
  ok((readmeVocabulary("closed vocabulary (`roster`, `skills`)") || []).join(",") !== MUTATION_WORDS.join(","),
    "F-739: …and a SHORT list is not equal to the guard's — the control that proves the comparison below can go red");

  const readmeWords = readmeVocabulary(README);
  ok(readmeWords !== null, "F-739: README.md still carries the closed-vocabulary paragraph the drivers are taught from");
  ok(readmeWords !== null && readmeWords.join(", ") === MUTATION_WORDS.join(", "),
    `F-739: README.md lists EXACTLY the words in MUTATION_HARMS, in order — guard: [${MUTATION_WORDS.join(", ")}] README: [${(readmeWords || []).join(", ")}]`);
}

/* ── 4h. F-741 — A DRIVER THAT CAN CHOOSE ITS TENANT MAY NOT NAME ONE IN A STRING ──
   `va-receipt-copy-live.mjs` printed "on STAGING" and "hook reachable on staging" from three
   hard-coded literals while `--env=dev` moved the run to dev and `evidence.json` recorded
   `env: "dev"` beside them. A reader triaging that FAIL looks at the wrong tenant — and it
   was residue of F-714, which fixed the same split ONE LINE AT A TIME in the same file.

   Fixing the three literals would have scheduled the recurrence, so the directory was
   searched: FOUR MORE drivers had it. `coder-pin-kept-live.mjs` and `coder-skills-live.mjs`
   take `--env` and DISCARD `envName` entirely, then say STAGING in a banner and in three
   assertion sentences; `va-pinned-survival-live.mjs` and `va-compaction-live.mjs` BIND
   `ENV_NAME` at the guard call and then do not use it — the latter in the sentence that tells
   an operator which `forge logs -e <env>` to read, which sends them to the other tenant's
   logs. One rule, six homes.

   THE COHORT IS DRIVERS WITH A CHOICE. A driver pinned by `forceEnv` (F-735) or declaring
   through the dev-only door (F-733) has exactly one tenant, so the literal cannot lie and
   naming it is just prose. The discriminator is therefore "calls `requireEnvAck` and is not
   pinned", which is the same condition under which the guard itself resolves a row.

   PROSE IS EXEMPT, as everywhere else here: a docblock explaining that a flow only exists on
   one environment is documentation, not output. The scan reads code. */
{
  const TENANT_IN_STRING = /["'`][^"'`\n]*(?<![A-Za-z_])(STAGING|staging|DEV)(?![A-Za-z_])[^"'`\n]*["'`]/;
  /** The legitimate homes, removed before the scan: the guard's own options, the one-off
   *  env-id/url readers that take an environment BY NAME on purpose, the `.env` variable
   *  name, and `--env=` in a usage line. Each is the mapping being READ, not retyped. */
  const stripLegitimate = (l) => l
    .replace(/\b(?:defaultEnv|forceEnv)\s*:\s*"(?:dev|staging)"/g, "")
    .replace(/\b(?:forgeEnvId|hookUrlFor|hookUrlVar)\(\s*"(?:dev|staging)"\s*\)/g, "")
    .replace(/\bSTAGING_TESTSTATE_URL\b/g, "")
    .replace(/--env=(?:dev|staging)/g, "")
    /* A FLAG NAME IS NOT A CLAIM ABOUT THIS RUN. `va-shadow-door-live.mjs` reads
       `arg("staging-envid", …)`, an override F-732 deliberately gave its own name so that
       `--envid` could keep the single meaning "confirm the settled row". The literal names
       an OPTION, not the tenant the run is on, and no operator reads it as output. */
    .replace(/\barg\(\s*["'][^"']*["']/g, "arg(");
  function tenantLiterals(code) {
    return code.split("\n").map((l, i) => ({ l, n: i + 1 }))
      .filter(({ l }) => TENANT_IN_STRING.test(stripLegitimate(l)))
      .map(({ n }) => n);
  }
  /* POSITIVE CONTROLS — verbatim from the five files, before they were fixed. */
  ok(tenantLiterals('  console.log(`\\nF-577 — THE RECEIPT COPY, on STAGING, agent ${NAME}\\n`);').length === 1,
    "POSITIVE CONTROL (F-741): the banner va-receipt-copy-live.mjs printed on every run, including --env=dev");
  ok(tenantLiterals('  PASS("hook reachable on staging");').length === 1,
    "POSITIVE CONTROL (F-741): …and the PASS line beside it");
  ok(tenantLiterals('  check("staging starts on the Coder edition with a NON-frontier agent model",').length === 1,
    "POSITIVE CONTROL (F-741): …and an ASSERTION SENTENCE naming the tenant, which coder-skills-live.mjs had three of");
  ok(tenantLiterals('  info("asserted from `forge logs -e staging` after this run");').length === 1,
    "POSITIVE CONTROL (F-741): …and the sentence telling an operator WHICH logs to read — the one that sends them to the other tenant");
  /* NEGATIVE CONTROLS — the mapping being read, and the fixed form. */
  ok(tenantLiterals('const r = requireEnvAck(argv, { faults: [], mutates: [], defaultEnv: "staging" });').length === 0,
    "NEGATIVE CONTROL (F-741): `defaultEnv` is the guard's own option — where a free choice LANDS is not a claim about where this run went");
  ok(tenantLiterals('const ADMIN = forgeEnvId("staging");').length === 0,
    "NEGATIVE CONTROL (F-741): reading the table BY NAME is the one home being used, not a second one");
  ok(tenantLiterals('const u = env.STAGING_TESTSTATE_URL;').length === 0,
    "NEGATIVE CONTROL (F-741): the .env VARIABLE NAME is not a tenant name in a sentence");
  ok(tenantLiterals('  console.log(`hook reachable on ${ENV_NAME}`);').length === 0,
    "NEGATIVE CONTROL (F-741): the fixed form — the name comes from the settled row");
  ok(tenantLiterals('const STAGING_ENV = arg("staging-envid", forgeEnvId("staging"));').length === 0,
    "NEGATIVE CONTROL (F-741): a FLAG NAME is an option, not a claim about this run — F-732 gave va-shadow-door-live.mjs's two-environment override its own name on purpose");
  ok(tenantLiterals('const DEVICE = "development";').length === 0,
    "NEGATIVE CONTROL (F-741): `dev` inside a longer word is not the environment — the boundary is checked on both sides");

  const offenders = [];
  let scanned = 0;
  for (const f of liveFiles) {
    const code = stripComments(readFileSync(path.join(here, f), "utf8"));
    if (!/requireEnvAck\s*\(/.test(code)) continue;      // dev-only door: one tenant, cannot lie
    if (/forceEnv\s*:/.test(code)) continue;              // pinned by the library (F-735): likewise
    scanned++;
    for (const n of tenantLiterals(code)) offenders.push(`${f}:${n}`);
  }
  ok(scanned >= 20, `F-741: the rule has a real cohort — ${scanned} driver(s) can resolve more than one environment`);
  ok(offenders.length === 0,
    `F-741: no driver with a CHOICE of tenant names one in a string — the name comes from the guard's settled row (at: ${offenders.join(", ")})`);
}

/* ── 4f-2. F-713 — THE SCOPE RULE HAS MOVED OUT OF THIS FILE (F-728) ────────────
   It lived HERE and in `scripts/live-driver-scope.test.mjs` at once — F-713 shipped the
   F-711 rule in two homes in one commit — and the two homes did not read the guard the same
   way. The sibling PARSES the guard's export list out of the library "so it cannot drift";
   this copy RETYPED the seven names three hundred lines after its own docblock promised the
   vocabulary was "DERIVED FROM THE DIRECTORY, never hand-listed". Add `forgeEnvArg` to the
   guard and call it from a driver without importing it: the sibling goes red, correctly, and
   this copy stays green because the name is not in its literal array — two rules disagreeing
   about one file, with whichever is read first deciding.

   So there is ONE home, and it is `scripts/live-driver-scope.test.mjs`, which was already the
   stronger of the two: its cohort is every `*-live.mjs` PLUS every `_probe-*` (F-715 put those
   on the same environment rule, so they are on the same scope rule), and its RULE 2 polices
   EVERY unbound SCREAMING_SNAKE name rather than only the guard-derived ones — a strict
   superset of what family (b) here could see. Its RULE 2b now covers the lowercase result-field
   aliases neither rule could see (F-729). Do not re-add a copy here: a rule about second homes
   is the last rule that should have one, which is exactly what 4f-1 says on its way IN. */

/* ── 4g-2. F-686 — AN ARMING DRIVER'S BLAST RADIUS MAY NOT BE EMPTY ─────────────
   `faults: []` is the legitimate mapping-only form for a driver that arms nothing, and it
   is also the one-token way to silence the shared-dev refusal on a driver that arms
   plenty. 4e proves the guard is CALLED; this proves it was told the truth. */
/* F-749 — THE EXTRACTOR MAY NOT ASSUME THE CALL SITS AT COLUMN 0. The first shape of this
   rule ended its match at `\n})`, a closing brace with NO indentation, and `[\s\S]{0,400}?`
   capped the call at 400 characters. Both are true of a driver that calls the guard at
   module scope and false of one that calls it inside `async function run()` — which
   `delete-fault-drain-live.mjs` does, indenting its `});` by two spaces. There the match
   failed outright, `call` was null, and the assertion FAILED a driver that declares
   `faults: ["deleteFault"]` perfectly honestly. A rule that cannot read a legal call is not
   a stricter rule, it is a broken one; the only reason nobody had seen it is that the one
   indented caller was not in `armingDrivers` until F-736 put it there. Balance the
   parentheses instead of guessing where the call ends. */
function guardCallSource(src, fn = "requireEnvAck") {
  const open = src.search(new RegExp("\\b" + fn + "\\s*\\("));
  if (open < 0) return null;
  const from = src.indexOf("(", open);
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) return src.slice(from, i + 1);
  }
  return null;                                          // unbalanced — not a call we can read
}
/* POSITIVE CONTROLS — the two shapes that exist in the directory, including the one that broke. */
ok(/faults: \["deleteFault"\]/.test(guardCallSource('  const r = requireEnvAck(argv, {\n    faults: ["deleteFault"],\n    mutates: ["kvs"],\n  });') || ""),
  "POSITIVE CONTROL (F-749): the call extractor reads an INDENTED call inside a function — the shape delete-fault-drain-live.mjs has, which the old `\\n})` anchor could not match at all");
ok(/faults: \[\]/.test(guardCallSource('const { envName } = requireEnvAck(process.argv.slice(2), { faults: [], mutates: [] });') || ""),
  "POSITIVE CONTROL (F-749): …and the one-line module-scope call every other driver uses");
ok(/faults: \["real"\]/.test(guardCallSource(stripComments('/* the old shape was requireEnvAck([...argv, "--env=dev"], { faults: [] }) */\nrequireEnvAck(argv, { faults: ["real"] });')) || ""),
  "NEGATIVE CONTROL (F-749/F-735): a docblock QUOTING an old call shape is prose — the extractor reads the real call, or documenting a defect would fail the rule that documents it");
ok(guardCallSource("const r = await other(1);") === null,
  "NEGATIVE CONTROL (F-749): a file with no such call yields null rather than a stray slice");
ok(!/mutates/.test(guardCallSource('requireEnvAck(a, { faults: ["x"] });\nsomethingElse({ mutates: ["roster"] });') || ""),
  "NEGATIVE CONTROL (F-749): the extractor stops at the call's OWN closing paren and does not swallow the next statement");

for (const f of armingDrivers) {
  /* PROSE IS NOT A CALL — the discriminator every scan in this file uses, and this one
     needs it too: `git-dispatch-drop-live.mjs` QUOTES its old `requireEnvAck([...argv,
     "--env=dev"], …)` shape in the docblock that explains why the pin moved to `forceEnv`
     (F-735), and an unstripped extractor picks the COMMENT up first and reads its
     `faults:` — or its absence — instead of the real call's. Documenting a defect must
     never fail the rule that documents it. */
  const src = stripComments(readFileSync(path.join(here, f), "utf8"));
  const call = guardCallSource(src);
  ok(!!call && /faults\s*:\s*\[\s*[^\]\s]/.test(call),
    `${f}: arms a fault, so its requireEnvAck call must NAME one — \`faults: []\` on an arming driver silences the refusal it exists for`);
}

/* ── 4h. F-702 — THE SWEEP DRAIN HAS ONE HOME, AND THE LEDGER STORES A STRING ────
   F-690 moved the drain DECISION into `lib/sweep-drain.mjs` and left the loop to each
   caller. That held for exactly one driver: `plant-sweep-live.mjs` landed in the SAME
   range with a hand-rolled loop that never imported the module, so the contract had two
   homes again and the pure function had one caller. The copy re-derived finishedness from
   `truncated` (deprecated by F-692 now that `complete` exists), paced a flat 1 s instead of
   500/1000/2000, and had neither spin detection nor the resumed-once rule — so the SAME
   refusing store failed with "still not complete after 10 resume call(s)" in one driver and
   a named `not-converging` in the other.

   A DIRECTORY RULE, not a per-file one, for the reason F-689 gives: the next drain driver
   is inside it on the day it is written, without anyone remembering to add it. */
const sweepDrivers = liveFiles.filter((f) => /sweepHarnessFaults|clearPlantedFaults/.test(stripComments(readFileSync(path.join(here, f), "utf8"))));
ok(sweepDrivers.length >= 2,
  `the drain rule found every driver that sweeps the fault keyspace (${sweepDrivers.join(", ")})`);

/** The local helpers a driver binds to a sweeping web-trigger action. */
const sweepHelpers = (code) =>
  [...code.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=[^;]*?action:\s*"(?:sweepHarnessFaults|clearPlantedFaults)"/g)].map((m) => m[1]);

/**
 * Every LOOP BODY in the file, brace-balanced from the loop keyword. Regexes cannot match
 * nested braces, and a drain loop is nothing but nested braces, so the body is walked.
 */
const loopBodies = (code) => {
  const out = [];
  for (const m of code.matchAll(/\b(?:while|for)\s*\(|\bdo\s*\{/g)) {
    let i = code.indexOf("{", m.index);
    if (i < 0) continue;
    let depth = 0;
    for (let j = i; j < code.length; j++) {
      if (code[j] === "{") depth++;
      else if (code[j] === "}") { depth--; if (depth === 0) { out.push(code.slice(i, j + 1)); break; } }
    }
  }
  return out;
};

for (const f of sweepDrivers) {
  const code = stripComments(readFileSync(path.join(here, f), "utf8"));

  /* (a) FINISHEDNESS IS READ, NEVER RE-DERIVED. `complete` is the library's single source;
     the two agree on every answer the current library can emit, which is exactly what makes
     a private copy dangerous — it keeps agreeing right up until the answer is reshaped. */
  ok(!/truncated\s*(?:!==|===)\s*true/.test(code),
    `${f}: no \`truncated !== true\` / \`truncated === true\` finishedness test — read \`complete\` (or \`answerComplete\`), the one source F-692 deprecates the derivation for`);

  /* (b) THE LOOP IS THE LIBRARY'S. A sweeping driver imports the drain and does not write
     its own around a sweep call. */
  ok(/from\s+"\.\.\/lib\/sweep-drain\.mjs"/.test(code),
    `${f}: imports the drain from lib/sweep-drain.mjs rather than hand-rolling the contract`);
  const helpers = sweepHelpers(code);
  ok(helpers.length > 0, `${f}: the rule can SEE this driver's sweep helper(s) — a rule that matches nothing proves nothing`);
  for (const body of loopBodies(code)) {
    for (const h of helpers) {
      ok(!new RegExp(`\\b${h}\\s*\\(`).test(body),
        `${f}: \`${h}(\` is called inside a hand-written loop — the resume loop belongs to drainSweep(), or the back-off and the spin detector exist only in the other driver`);
    }
  }

  /* (c) THE DRAIN LEDGER STORES COPIED PRIMITIVES, NEVER A SECOND REFERENCE. `redactSecrets`
     is cycle-safe by WeakSet: an object already reachable from `ev` is written as
     `[CIRCULAR]` the second time it is met. `{ call: 1, ...ev.firstReal }` is a SHALLOW
     copy — it re-used the very cursor object `ev.firstReal.cursor` held — so call 1's cursor,
     the one field this driver exists to prove, was erased from the ledger. */
  ok(!/\.\.\.ev\./.test(code),
    `${f}: an evidence sub-object is spread into another evidence node — the spread is SHALLOW, so the redactor meets the nested object twice and writes [CIRCULAR] over it; copy the token as a STRING`);
}

/* POSITIVE CONTROLS. Each is the pre-cut shape, and each must FIRE — an empty match set is
   not evidence until the matcher is shown to see the thing at all. */
ok(/truncated\s*(?:!==|===)\s*true/.test("if (s.truncated !== true) { complete = s.failed === 0; }"),
  "POSITIVE CONTROL: the derivation ban SEES the exact line plant-sweep-live carried");
ok(/truncated\s*(?:!==|===)\s*true/.test("res.json.complete === true || res.json.truncated !== true"),
  "POSITIVE CONTROL: …and the cleanup loop's OR, whose right arm calls a refusing page finished");
{
  const before = `const sweep = (body) => hook({ action: "sweepHarnessFaults", ...body });
    while (!complete && n < MAX) { const res = await sweep({ cursor }); n++; }`;
  const helpers = sweepHelpers(before);
  ok(helpers.includes("sweep"), "POSITIVE CONTROL: the helper finder binds `sweep` to the sweeping action");
  const bodies = loopBodies(before);
  ok(bodies.length === 1 && /\bsweep\s*\(/.test(bodies[0]),
    "POSITIVE CONTROL: …and the loop walker FINDS the hand-rolled resume loop around it");
}
{
  /* Brace balance, not a regex: a loop whose body nests objects and closures is still one body,
     and a sweep call after the loop is NOT in it. */
  const nested = `while (x) { if (y) { const s = { a: { b: 1 } }; } }\nawait sweep({ cursor });`;
  const bodies = loopBodies(nested);
  ok(bodies.length === 1 && !/\bsweep\s*\(/.test(bodies[0]),
    "POSITIVE CONTROL: the walker balances nested braces and does not swallow the call AFTER the loop");
}
ok(/\.\.\.ev\./.test("const calls = [{ call: 1, ...ev.firstReal }];"),
  "POSITIVE CONTROL: the [CIRCULAR] ban SEES the exact seeding line that erased call 1's cursor");
ok(!/\.\.\.ev\./.test("const calls = [{ call: 1, ...shape(first.json) }];"),
  "POSITIVE CONTROL: …and does not fire on a freshly built shape, which shares nothing");

/* ── 5. the hardened drivers redact in the writers themselves ──────────────────── */
for (const f of ["parity-doors-live.mjs", "knowledge-doors-editor-live.mjs", "perm-namesake-ui-live.mjs"]) {
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
