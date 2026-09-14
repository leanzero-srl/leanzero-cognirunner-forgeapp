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
  ok(/shotMasked/.test(src), `${f}: …and it imports the mask helper rather than rolling its own`);
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
