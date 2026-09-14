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
import { maskNonCode, maskComments, callArgs, objectValue } from "../lib/js-source-scan.mjs";

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

/* ── 2c-iii. F-822 — THE EMAIL MASK IS LINEAR, AND STAYS LINEAR ──────────────────
   The rule that masked an address used to be an UNBOUNDED GREEDY RUN followed by a
   REQUIRED `@` — the same structure F-815 had just cut out of the credential half. Every
   character of a long atext run is a candidate start, each one re-scans the rest of the run
   before failing on the missing `@`, and the cost is quadratic. MEASURED on the pre-fix
   tree: `redactString` over 240 KiB of `-eyA` = 27,349 ms, while the already-linear
   credential scanner over the SAME input was 2.0 ms. A driver that hands `redactSecrets` a
   long dense evidence string — a step body, a stringified registry row, a 240 KiB kvs answer
   — reads as a DEAD DRIVER, not as a slow regex, which is what makes this worth a gate.

   THE BUDGET IS DELIBERATELY LOOSE. Post-fix these inputs measure ~3 ms and ~9 ms; 500 ms is
   two orders of magnitude of headroom, so this goes red on a REINTRODUCED QUADRATIC and not
   on a loaded CI box. The dense-email arm is here because the pathological arm alone would
   pass a mask that simply stopped matching addresses. */
{
  const KIB240 = 245760;
  const patho = "-eyA".repeat(KIB240 / 4);                       // one atext run, no `@` at all
  const oneAddr = "user.name+tag@tenant-two.co.uk, ";            // 32 chars → ~7,680 addresses
  const denseUnit = oneAddr.repeat(Math.ceil(KIB240 / oneAddr.length)).slice(0, KIB240);
  const tenK = "u@a.co ".repeat(10000);                          // 10,000 addresses exactly
  const timed = (s) => { const t = process.hrtime.bigint(); const out = redactString(s); return { ms: Number(process.hrtime.bigint() - t) / 1e6, out }; };

  const tPatho = timed(patho);
  ok(tPatho.ms < 500, `F-822: 240 KiB of dot-free atext masks in under 500 ms (took ${tPatho.ms.toFixed(1)} ms)`);
  ok(tPatho.out === patho, "…and a string with no `@` in it comes back untouched");

  const tDense = timed(denseUnit);
  ok(tDense.ms < 500, `F-822: 240 KiB of DENSE addresses masks in under 500 ms (took ${tDense.ms.toFixed(1)} ms)`);
  ok(!tDense.out.includes("user.name+tag@"), "…and the dense arm really did mask — the budget is not passing a no-op");

  const tTenK = timed(tenK);
  ok(tTenK.ms < 500, `F-822: 10,000 addresses in one string mask in under 500 ms (took ${tTenK.ms.toFixed(1)} ms)`);
  ok(tTenK.out === "u***@a.co ".repeat(10000), "…every one of the 10,000 is masked, and nothing between them moved");

  /* POSITIVE CONTROL — the deleted regex, on a SHORT pathological input so the control itself
     cannot hang the suite. 40,000 chars is 1/6 of the budgeted input; if the old rule is not
     dramatically slower than the scanner here, this gate is measuring nothing. */
  const OLD_EMAIL = /[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
  const small = "-eyA".repeat(10000);                            // 40,000 chars
  const tOld = (() => { const t = process.hrtime.bigint(); small.replace(OLD_EMAIL, maskEmail); return Number(process.hrtime.bigint() - t) / 1e6; })();
  const tNew = (() => { const t = process.hrtime.bigint(); redactString(small); return Number(process.hrtime.bigint() - t) / 1e6; })();
  ok(tOld > tNew * 20,
    `F-822 POSITIVE CONTROL: the deleted regex IS catastrophically slower on the same 40 KB (old ${tOld.toFixed(1)} ms vs new ${tNew.toFixed(1)} ms)`);
}

/* ── 2c-iv. F-822 — THE SCANNER IS THE OLD REGEX, TRANSCRIBED ───────────────────
   A faster mask that masks DIFFERENTLY is a behaviour change wearing a performance fix, and
   the F-652/F-662 contract above only pins the addresses anyone thought to write down. These
   are the grammar edges where a hand scanner drifts from the engine — each was checked
   against the deleted regex, and `a@b.cc-` is here because the first version of the scanner
   GOT IT WRONG: it required a whole label to be alphabetic, while the regex's final
   `\.[A-Za-z]{2,}` is a maximal munch of letters that can stop INSIDE the label. */
for (const [input, expected] of [
  ["a@b.co.1x",       "a***@b.co.1x"],   // `.1x` is not a TLD — the match ends at `.co`
  ["a@b.cc-",         "a***@b.cc-"],     // the TLD stops inside the label, before the `-`
  ["a@b.com-",        "a***@b.com-"],
  ["a@b-.com",        "a@b-.com"],       // a first label ending in `-` cannot be followed by `.`
  ["a@-b.com",        "a@-b.com"],       // …nor start with one
  ["a@b..com",        "a@b..com"],       // an empty label ends the domain
  ["a@b.c",           "a@b.c"],          // a one-letter TLD is not `{2,}`
  ["a@b.co",          "a***@b.co"],
  ["A@B.COM",         "A***@B.COM"],
  ["x@tenant-two.com", "x***@tenant-two.com"],
  ["a@b-c-d.e-f.com", "a***@b-c-d.e-f.com"],
  ["a@b.co.uk.info",  "a***@b.co.uk.info"],  // greedy — the LAST legal TLD wins
  ["a@b.com.",        "a***@b.com."],
  ["x@y@z.com",       "x@y***@z.com"],   // the first `@` has no legal domain; the second does
  ["a@b.com@c.org",   "a***@b.com@c.org"],  // the second `@` has no local part LEFT to consume
  ["a@@b.com",        "a@@b.com"],
  ["@tenant.com",     "@tenant.com"],    // no local part at all
  ["a@",              "a@"],
  ["-@b.com",         "-***@b.com"],     // `-` IS atext
  ["a...@b.com",      "a***@b.com"],
]) {
  ok(redactString(input) === expected,
    `F-822: the scanner matches the engine on \`${input}\` (expected \`${expected}\`, got \`${redactString(input)}\`)`);
}

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

/* ── 4c-ii-a. F-668 — THE REFUSAL IS ARMED, AND THE ANSWER IS READ ──────────────
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

/* ─── F-754 — THE MASK'S TWO FAIL-OPEN SHAPES ────────────────────────────────────────────
 * Both of these make `callArgs` return FEWER calls than the file really has, which is the
 * direction every rule above is wrong in: a leak FAIL the walker cannot see is a leak FAIL
 * the rule reads as absent, and the file reports clean. They are asserted HERE, on the real
 * `callArgs`, rather than on `maskNonCode` alone, because the mask is only ever interesting
 * through its callers.
 *
 * (a) An apostrophe left bare by a `/` the heuristic (correctly) read as DIVISION used to
 *     open a string that ran to end-of-line. (b) A postfix `++` looked like the binary `+`
 *     that expects a value, so the `/` after it opened a regex that ran to the NEXT `/`.
 * The `APOS` splice keeps this file's own source free of the unterminated quote it is
 * testing for — the suite reads its own directory. */
const APOS = String.fromCharCode(39);
const divisionLine =
  "const t = f(x) /don" + APOS + "t/.test(s); const AFTER = 1; FAIL(\"a capture was REFUSED\", { paths: p });";
ok(callArgs(divisionLine, "FAIL").length === 1,
  "POSITIVE CONTROL (F-754): a `/` after `)` is DIVISION, so the apostrophe that follows is not a quote and masks nothing past it — the FAIL call later on the SAME LINE is still read (before the fix this returned [] and the leak rule saw zero FAIL calls for the file)");
ok(leakFailNamesArtefacts(divisionLine),
  "…and the rule that consumes it grades that FAIL on its real arguments, instead of grading a file it could not read as clean");
ok(maskNonCode(divisionLine).length === divisionLine.length
  && maskNonCode(divisionLine).split("\n").length === divisionLine.split("\n").length,
  "…with the length/newline invariant intact, which is what lets every caller slice the ORIGINAL by indices balanced on the mask");
ok(maskNonCode("const r = a++ / b + c / d;") === "const r = a++ / b + c / d;",
  "POSITIVE CONTROL (F-754): a postfix `++` yields a VALUE, so the `/` after it is division — ` b + c ` is no longer masked as a regex body, which used to hide any identifier between two divisions from the RULE 2 unbound-name scan");
ok(maskNonCode("arr.filter(v => /cache|DEFECT/i.test(v));") === "arr.filter(v =>                .test(v));",
  "NEGATIVE CONTROL (F-754): `=>` still expects a VALUE, so an arrow-body regex is still masked — 174 sites in this directory are written that way, and reading their bodies as code is the original false positive the heuristic was paid for");
ok(maskNonCode("const re = /WRITE BRAKE/; const X = 1;") === "const re =              ; const X = 1;"
  && maskNonCode("if (x) return /ROTATION NOT/.test(y);") === "if (x) return               .test(y);",
  "NEGATIVE CONTROL (F-754): the other two shapes the heuristic was bought for — a bare assignment and a `return` — are untouched by the correction");
ok(/^const s = +; FAIL\( +\);$/.test(maskNonCode("const s = \"a 'quoted' b\"; FAIL(\"x\");")),
  "NEGATIVE CONTROL (F-754): a CLOSED quote still masks its body, apostrophes inside it included — the correction is about quotes that never close, which valid JS does not contain");

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
  /* F-792 — `resultExitCode({ fails, crashed })` is the OTHER spelling of "a FAIL exits
     non-zero", and it is the one a driver wired to lib/driver-report.mjs uses. The rule is
     about the PROPERTY, never about the literal `fails >`: reading only the old spelling
     would fail exactly the drivers that fixed the crash-reports-zero defect. */
  ok(/process\.exit(Code)?\s*(=|\()\s*/.test(code) && (/fails\s*(>|\?)/.test(code) || /resultExitCode\(\s*\{[^}]*\bfails\b/.test(code)),
    `${f}: …and a FAIL still drives a non-zero exit (\`fails >\` or resultExitCode({ fails })), or the run-level leak FAIL buys nothing`);
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

   THE LIMIT THAT REMAINS IS VISIBILITY (F-737, F-751). `callsMutator` is a TOKEN SCAN over
   one file. It cannot see a write made by CLICKING the product, and it cannot see a write a
   `lib/` helper makes on the driver's behalf unless the helper's name is itself in the
   list. The list is no longer a hand-list on the hook side — F-751 derives those doors from
   `src/test-hook.js` — but the RESOLVER names below are still typed here, and that half
   carries the same rot. Both halves are addressed as far as a scanner can: the shared
   writers are
   IMPORT-AWARE (lib/jira.mjs, lib/workflow.mjs, lib/rules-api.mjs), and a driver that
   drives the product UI is marked UNAUDITABLE and excused from the cry-wolf arm only —
   never from the arm that matters. What is NOT closed, and cannot be by this file: a UI
   driver that declares `[]` while clicking a write. That is F-734's shape, it is a human
   judgement, and the honest thing is to say so rather than to imply the scan covers it. */
/* ── F-751 · THE HOOK'S WRITE DOORS ARE READ FROM THE HOOK, NOT RETYPED HERE ──────────
 *
 * The test-hook half of this list was hand-written, and a hand-list of someone else's doors
 * rots the moment a door is added: it had drifted to miss FIVE writing actions, two of them
 * the PLURAL of names it already carried — `\bregisterRule\b` does not match
 * `"registerRules"`, MEASURED. A live driver that registers a workflow rule with
 * `hook({ action: "registerRules", rules })` and removes it with `"removeRules"` declared
 * `mutates: []`, `callsMutator` returned `[]`, rule 4g passed, and the run rewrote rule
 * configs on the shared tenant with no `--i-know-dev-is-shared`. Same for `setDisabled`
 * (disables a builtin doc or skill for everyone) and `setWebhookProbeSecret` (a git secret
 * write); `pipelineRow` is already used by a driver whose honest `["git"]` declaration was
 * saved only by three OTHER tokens in the same file. This is the mechanism F-737's ancestor
 * was closed for once already, producing the same defect again.
 *
 * So the door list is PARSED from `src/test-hook.js`, and what this file keeps is the
 * judgement a parser cannot make: which doors do NOT mutate. That allow-list is asserted to
 * be a SUBSET of the parsed doors, so deleting or renaming a door here goes red rather than
 * silently excusing nothing; every door NOT on it is a mutator the day it is written.
 *
 * The two families that are deliberately not mutations:
 *   · `arm*`/`disarm*`/`read*` FAULT LEVERS — a fault is declared under `faults:`, which is
 *     its own gate with its own ack; calling it a mutation too would double-count it.
 *   · the `probe*` READS — with ONE exception, `probeJsmComment`, which really COMMENTS on a
 *     real JSM issue. The prefix is not the signal, which is why these are named and not
 *     pattern-matched.
 *   · `invokeResolver` is the generic proxy door, so it is excused HERE and caught by the
 *     RESOLVER NAMES below — the driver types `saveListener` either way. A driver that
 *     proxies a write whose resolver name is not in that list is the F-737 visibility limit,
 *     restated rather than hidden.
 *   · `runCodegen` runs design-time AI and touches no tenant object the drivers restore.
 */
const HOOK_SRC = readFileSync(path.join(here, "..", "..", "src", "test-hook.js"), "utf8");
const HOOK_DOORS = [...new Set(
  [...HOOK_SRC.matchAll(/\baction\s*===\s*"([A-Za-z_$][\w$]*)"/g)].map((m) => m[1]),
)].sort();
const HOOK_READ_ONLY_DOORS = [
  "probe", "probeConfluence", "probeConfluenceFromConsumer", "probeConfluenceInstalled",
  "probeProperty", "probeRuleDelivery", "probeServiceDesk", "probeServicedeskFromConsumer",
  "readHarnessProbe", "readProbe",
  "readDeleteFault", "readGitDispatchFault", "readHookPromoteFault", "readJiraFault", "readKeyReadFault",
  "armDeleteFault", "armGitDispatchFault", "armHookPromoteFault", "armJiraFault", "armKeyReadFault",
  "disarmDeleteFault", "disarmGitDispatchFault", "disarmHookPromoteFault", "disarmJiraFault", "disarmKeyReadFault",
  "invokeResolver", "runCodegen",
];
ok(HOOK_DOORS.length >= 40,
  "F-751: the test-hook's action doors are READ from src/test-hook.js (got " + HOOK_DOORS.length + ")");
for (const d of HOOK_READ_ONLY_DOORS) {
  ok(HOOK_DOORS.includes(d),
    `F-751: the read-only allow-list entry \`${d}\` is a REAL door — the excuse list is a subset of the parsed list, so a renamed door goes red here instead of quietly excusing nothing`);
}
const HOOK_MUTATOR_DOORS = HOOK_DOORS.filter((d) => !HOOK_READ_ONLY_DOORS.includes(d));
for (const d of ["registerRules", "removeRules", "setDisabled", "pipelineRow", "setWebhookProbeSecret", "kvSet", "probeJsmComment"]) {
  ok(HOOK_MUTATOR_DOORS.includes(d),
    `F-751: \`${d}\` is a mutator BY DERIVATION — the five the hand-list had drifted to miss, plus the two it had, all arrive from the same place`);
}

const MUTATOR_CALLS = [
  /* test-hook actions that write the tenant directly — DERIVED (F-751), never retyped. */
  ...HOOK_MUTATOR_DOORS.map((d) => new RegExp(`\\b${d}\\b`)),
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
]
  /* F-751 — the derivation and the hand-written half OVERLAP on purpose: `seedSkill`,
     `deleteSkill` and `probeJsmComment` are hook doors AND were reasoned about by name
     above, and their comments are the record of why. Keeping both and de-duplicating by
     pattern is what lets those reasons survive without `callsMutator` counting one write
     twice — several controls below assert an exact hit COUNT. */
  .filter((re, i, all) => all.findIndex((o) => String(o) === String(re)) === i);

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
 *  it is matched on the whole file rather than per line — the only rule here that is.
 *
 *  F-750 — THE VERB IS THE SIGNAL; THE QUOTE AROUND IT IS NOT. The first draft matched
 *  DOUBLE quotes only, so the detector was quote-shape dependent: `campaign-sample-live.mjs`
 *  really POSTs an attachment to `/rest/api/3/issue/${state.A}/attachments` with
 *  `method: 'POST'`, and MEASURED on that file the path half was TRUE while the verb half
 *  was FALSE — `writesJira` = false on a file that writes Jira. It passes today only because
 *  it declares `["listeners","issues"]` for other reasons; a NEW driver whose ONLY mutation
 *  is that same single-quoted shape declares `[]`, rule 4g stays green, and it writes a real
 *  project unannounced. Four other scripts here already carry `method: '` at a `/rest/api/`
 *  path. Both quote styles and a template literal are now accepted, and PATCH joins the verb
 *  list — which is exactly the set its `gh -X` sibling `writesRepo` already matched, in the
 *  quote class `["']` it already used. The two halves of one question should not have
 *  disagreed about what a quote is. */
function writesJira(code) {
  return /\/rest\/(api|servicedeskapi)\//.test(code)
    && /\bmethod:\s*["'`](POST|PUT|PATCH|DELETE)["'`]/.test(code);
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
/* F-750 — THE SAME WRITE IN THE OTHER QUOTE. Lifted from `campaign-sample-live.mjs:51`, which
   really POSTs an attachment to a real issue; the detector read DOUBLE quotes only, so the
   path half was true, the verb half was false, and a file that writes Jira scanned as
   read-only. That driver survives on an unrelated declaration; the next one would not. */
ok(callsMutator("const upload = await fetch(BASE + `/rest/api/3/issue/${state.A}/attachments`, { method: 'POST', headers: h, body: form });").length === 1,
  "POSITIVE CONTROL (F-750): a SINGLE-QUOTED method beside a REST path is the same Jira write — measured FALSE before the fix on campaign-sample-live.mjs's real attachment POST");
ok(callsMutator("await jira(`/rest/api/3/issue/${k}`, { method: `PUT`, body });").length === 1,
  "POSITIVE CONTROL (F-750): …and a TEMPLATE-quoted one, so no third quote shape is left as a hole");
ok(callsMutator('await jira(`/rest/api/3/field/${id}`, { method: "PATCH", body });').length === 1,
  "POSITIVE CONTROL (F-750): PATCH is a write too — the verb set now matches its `gh -X` sibling `writesRepo`, which has always accepted it");
ok(callsMutator("const r = await fetch(BASE + '/rest/api/3/issue/X', { method: 'GET' });").length === 0,
  "NEGATIVE CONTROL (F-750): widening the QUOTE class did not widen the VERB class — a single-quoted GET at a REST path is still a read");
ok(callsMutator("const r = await fetch(HOOK, { method: 'POST', body });").length === 0,
  "NEGATIVE CONTROL (F-750): …and the harness web trigger is still not Jira in the other quote either — both halves of the two-part predicate still have to hold");
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
/* ── F-751 · THE PLURALS, AND THE FOUR OTHER DOORS THE HAND-LIST HAD DRIFTED TO MISS ──
   The plural pair is the point: `\bregisterRule\b` does NOT match `"registerRules"`, so the
   list carried a name that looked like coverage and was not. Both forms must hit, because
   both are real write doors — the singular is a resolver, the plural is a hook action. */
ok(callsMutator('await hook({ action: "registerRules", rules });').length === 1,
  "POSITIVE CONTROL (F-751): the PLURAL hook door matches — measured false before, while the singular sat in the list looking like coverage");
ok(callsMutator('await invoke("registerRule", { rule });').length === 1,
  "POSITIVE CONTROL (F-751): …and the SINGULAR resolver still matches — deriving the hook half did not cost the hand-written half");
ok(callsMutator('await hook({ action: "removeRules", ids });').length === 1,
  "POSITIVE CONTROL (F-751): `removeRules`, the other plural");
ok(callsMutator('await hook({ action: "setDisabled", id, disabled: true });').length === 1,
  "POSITIVE CONTROL (F-751): `setDisabled` disables a builtin doc or skill FOR EVERYONE on the tenant");
ok(callsMutator('await hook({ action: "setWebhookProbeSecret", secret: s });').length === 1,
  "POSITIVE CONTROL (F-751): `setWebhookProbeSecret` is a git secret write");
ok(callsMutator('await hook({ action: "pipelineRow", row });').length === 1,
  "POSITIVE CONTROL (F-751): `pipelineRow` — already used by pipeline-outdated-live.mjs, whose honest [\"git\"] declaration was saved only by three OTHER tokens in the same file");
ok(callsMutator('await hook({ action: "commit", rule, bindings });').length === 1,
  "POSITIVE CONTROL (F-751): `commit` runs commitImportCore, which writes a rule into a real workflow");
/* The allow-list is a JUDGEMENT, so it gets controls too — otherwise the derivation could be
   quietly emptied by adding names to the excuse list. */
ok(callsMutator('await hook({ action: "armJiraFault", path: P });').length === 0,
  "NEGATIVE CONTROL (F-751): a fault LEVER is declared under `faults:`, which is its own gate with its own ack — counting it as a mutation too would double-count it");
ok(callsMutator('await hook({ action: "probeRuleDelivery" });').length === 0,
  "NEGATIVE CONTROL (F-751): a probe READ is not a write…");
ok(callsMutator('await hook({ action: "probeJsmComment", issue: k });').length === 1,
  "…but `probeJsmComment` COMMENTS on a real JSM issue, which is why the allow-list names doors instead of matching the `probe` prefix");

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
  /* ── F-753 · EACH DOOR IS DETECTED BY ITS OWN CALL ──────────────────────────────
     `viaDeclare` used to be "guardedDrivers MINUS viaGuard", i.e. every file WITHOUT
     `requireEnvAck` — so the "no driver may use both doors" assertion below ran over exactly
     the files that cannot violate it and could never fire. A half-converted driver that kept
     `requireEnvAck(argv, { faults: [], mutates: [] })` for the environment AND gained
     `declareMutations(["agents"])` at module top was classified `viaGuard`, fell out of
     `viaDeclare`, was never checked — and `declaredMutations` then read the WEAKER of its two
     declarations, because it prefers the `mutates:` literal over `declareMutations([…])` via
     `||`. The two declarations disagree and rule 4g grades the file read-only while its real
     declaration says `agents`.

     The `||` preference is not the thing to fix: with the both-doors rule REACHABLE, a file
     that carries two declarations goes red before anything has to choose between them, which
     is the honest order — refuse the ambiguity rather than resolve it. */
  const usesGuardDoor = (code) => /requireEnvAck\s*\(/.test(code);
  const usesDeclareDoor = (code) => /declareMutations\s*\(/.test(code);
  /* Controlled on FIXTURE STRINGS, because the real cohort contains no violator — which is
     exactly the condition under which the old formulation looked green. */
  {
    const half = 'import { requireEnvAck, declareMutations } from "../lib/shared-env-guard.mjs";\n'
      + 'declareMutations(["agents"]);\n'
      + 'const { envName } = requireEnvAck(process.argv.slice(2), { faults: [], mutates: [] });';
    ok(usesGuardDoor(half) && usesDeclareDoor(half),
      "POSITIVE CONTROL (F-753): a HALF-CONVERTED driver carrying both doors is seen by BOTH predicates — under the old subtraction it was viaGuard only, so the both-doors assertion skipped it entirely");
    ok(declaredMutations(half).length === 0,
      "…and this is why that matters: `declaredMutations` reads the `mutates: []` half and reports NO mutation, while the file's real declaration says `agents` — the rule would grade the weaker of two disagreeing declarations");
    const declareOnly = 'import { declareMutations } from "../lib/shared-env-guard.mjs";\ndeclareMutations(["roster"]);';
    ok(usesDeclareDoor(declareOnly) && !usesGuardDoor(declareOnly),
      "NEGATIVE CONTROL (F-753): a correctly-converted dev-only driver uses ONE door and stays clean");
    const guardOnly = 'const { envName } = requireEnvAck(process.argv.slice(2), { faults: [], mutates: ["issues"] });';
    ok(usesGuardDoor(guardOnly) && !usesDeclareDoor(guardOnly),
      "NEGATIVE CONTROL (F-753): …and so does a guarded one");
  }
  const viaGuard = guardedDrivers.filter((f) => usesGuardDoor(stripComments(readFileSync(path.join(here, f), "utf8"))));
  const viaDeclare = guardedDrivers.filter((f) => usesDeclareDoor(stripComments(readFileSync(path.join(here, f), "utf8"))));
  ok(viaGuard.length >= 25, `F-733: the environment-resolving door still holds its drivers (${viaGuard.length})`);
  ok(viaDeclare.length >= 20, `F-733: …and the dev-only door holds its own (${viaDeclare.length})`);
  ok(viaGuard.length + viaDeclare.length === guardedDrivers.length,
    `F-753: the two doors PARTITION the cohort — each driver is counted once, so neither an overlap nor a gap can hide in the subtraction that used to define the second set (guard ${viaGuard.length} + declare ${viaDeclare.length} vs ${guardedDrivers.length} drivers)`);
  /* A dev-only driver must NOT resolve an environment: `declareMutations` exists precisely so
     that it does not, and a file carrying both is a conversion done twice. */
  for (const f of viaDeclare) {
    const code = stripComments(readFileSync(path.join(here, f), "utf8"));
    ok(!usesGuardDoor(code),
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
  /* F-861 — `staging` HAS TWO SENSES AND ONLY ONE OF THEM IS A TENANT. The rule matched the
     bare word anywhere inside any literal, so the VA drivers — whose product domain is the
     STAGING OF DRAFTS — could not write an ordinary sentence about their own feature:
     `"…so nothing about staging was read at all"` carries no tenant claim and failed anyway.
     The F-854 surgeon reworded the sentence rather than reporting the rule, which is the
     move the next author makes too, so the rule teaches a lie about English.

     NARROWED TO THE ENVIRONMENT SENSE rather than exempting the domain sense. The exemption
     route ("staging within 3 words of draft/item/reply/post") cannot pass the sentence that
     started this — "nothing about staging was read" has no domain noun near it — so it would
     have left the same author stuck. The environment sense, by contrast, is small and
     syntactically marked: a PREPOSITION or `-e`/`--env` in front of it, a tenant NOUN behind
     it, the SHOUTED form, or the literal opening on it as a subject ("staging starts on the
     Coder edition…"). Every F-741/F-752 positive is one of those four; the domain sense is
     none of them, except "staging of the …", which the subject rule excludes explicitly.
     `DEV` stays exactly as it was: shouted only, since lowercase `dev` was never matched. */
  const TENANT_WORD = /(?<![A-Za-z_])(?:STAGING|staging|DEV)(?![A-Za-z_])/;
  /* F-871 — A LITERAL ENDS AT ITS OWN CLOSING QUOTE, NOT AT THE FIRST APOSTROPHE. The
     extraction was a character class, so `"we didn't run on staging"` was read as the
     fragments `we didn` and `t run on staging`. The environment sense is a SHAPE — a
     preposition in front of the word, a tenant noun behind it — so a claim cut at the wrong
     place loses its marker and the rule UNDER-reports: `PASS("the staging tenant's hook
     answered")` yielded `the staging tenant` + `s hook answered`, and survived only because
     the noun phrase happened to fall left of the apostrophe. Move the apostrophe one word
     earlier and a real tenant claim walks straight through.

     A quote-aware scanner instead: the opening quote fixes the delimiter, a backslash escapes
     the next character, and only the matching UNESCAPED quote closes the literal. A template
     literal's `${...}` belongs to that one literal, brace-counted, so a quote inside an
     interpolation cannot end it early. An UNTERMINATED literal is skipped. */
  /* F-880 — …AND A TEMPLATE LITERAL IS ONE LITERAL EVEN WHEN IT SPANS LINES. F-871 made the
     scan quote-aware and left it PER-LINE, which is the same defect at a second boundary: a
     banner opened with a backtick, wrapped, and closed two lines later opens a literal that
     is UNTERMINATED on its first line — skipped by the line above — while the continuation
     carrying `on staging` has no opening quote at all, so neither line is ever read. A
     wrapped banner is the very SHAPE this rule was cut for (F-741's was one long line only
     by accident), and it walked straight through; unwrap it and the claim reappears, which
     teaches the next author to keep the wrap.

     So the scan reads the file's code as ONE text — after the same comment stripping and the
     same per-line `stripLegitimate`, rejoined so line numbers still line up — and reports the
     line of the literal's OPENING QUOTE, which is where a reader must go to fix it. A `"` or
     `'` literal still ends at a newline because in JS it must: an unescaped line break is a
     syntax error there, so letting one through would allow a single stray quote to swallow
     the rest of the file. Only a backtick may cross a line. */
  function scanLiterals(code) {
    const out = [];
    let cursor = 0, line = 1;                              // i is non-decreasing: count as we go
    for (let i = 0; i < code.length; i++) {
      const q = code[i];
      if (q !== '"' && q !== "'" && q !== "`") continue;
      let j = i + 1, closed = false;
      while (j < code.length) {
        const c = code[j];
        if (c === "\\") { j += 2; continue; }             // an escape consumes what follows
        if (c === "\n" && q !== "`") break;               // only a template may cross a line
        if (q === "`" && c === "$" && code[j + 1] === "{") {
          let depth = 1; j += 2;
          while (j < code.length && depth > 0) {
            if (code[j] === "{") depth++;
            else if (code[j] === "}") depth--;
            j++;
          }
          continue;                                        // `${...}` is inside the literal
        }
        if (c === q) { closed = true; break; }
        j++;
      }
      if (!closed) continue;              // unterminated: not a sentence this rule can read
      while (cursor < i) { if (code[cursor] === "\n") line++; cursor++; }
      out.push({ inner: code.slice(i + 1, j), line });     // the OPENING quote's line
      i = j;                              // resume AFTER the closing quote
    }
    return out;
  }
  const ENV_SENSE = [
    /* the shouted tenant name — the banner form F-741 was cut for.
       F-881 — AN ISSUE KEY IS NOT A TENANT. The boundary is "not a letter or underscore" on
       both sides, and a HYPHEN is neither, so `"DEV-123 was created"` read as the shouted
       tenant name and BLOCKED — the first sentence a seeding driver prints when its project
       key happens to be `DEV`, refused by a rule that has no opinion about issue keys. The
       issue-key SHAPE is excluded by lookahead (a hyphen then a digit); `on DEV`, `-e DEV`
       and a bare shouted `DEV` are untouched, which is everything F-741 was cut for. */
    /(?<![A-Za-z_])(?:STAGING|DEV)(?![A-Za-z_])(?!-\d)/,
    /* pointed AT an environment: "on staging", "to staging", "-e staging", "--env staging" */
    /(?:\bon|\bto|\binto|\bfrom|\bagainst|\bin|\bat|\bvia|\benvironment|\benv|-e|--env[= ])\s+staging(?![A-Za-z_])/i,
    /* used AS an environment noun phrase: "staging tenant", "staging site", "staging run" */
    /(?<![A-Za-z_])staging\s+(?:tenant|site|env|environment|instance|run|runs|trigger|logs|default|half|copy|only)(?![A-Za-z_])/i,
    /* the literal's SUBJECT — "staging starts on the Coder edition…" — but never the
       domain's own genitive, "staging of the draft", which is the feature, not a tenant. */
    /^\s*staging(?![A-Za-z_])\s+(?!of(?![A-Za-z_]))\w/i,
  ];
  const tenantSense = (inner) => ENV_SENSE.some((re) => re.test(inner));
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
    .replace(/\barg\(\s*["'][^"']*["']/g, "arg(")
    /* …and that holds wherever the flag is NAMED, not only where it is READ. The exemption
       above covered the `arg()` call site alone, so a usage line or a refusal that mentions
       `--staging-envid` tripped the rule on the flag's own name — which is the one thing
       this paragraph already says is not a claim. A long flag carrying a tenant word is an
       option name in both places, and `--env=dev|staging` directly below has always been
       stripped on exactly that reasoning. */
    .replace(/--[a-z-]*\b(?:staging|dev)\b[a-z-]*/g, "");
  function tenantLiterals(code) {
    /* `stripLegitimate` is line-oriented (its patterns are written against one statement),
       so it still runs per line — and the lines are rejoined, because the LITERALS are
       read from the whole text (F-880). Neither step adds or drops a newline, so the line
       a literal is reported at is its line in the file. */
    const scrubbed = code.split("\n").map(stripLegitimate).join("\n");
    if (!TENANT_WORD.test(scrubbed)) return [];            // cheap prefilter: the word is here at all
    return scanLiterals(scrubbed)
      .filter(({ inner }) => tenantSense(inner))
      .map(({ line }) => line);
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
  /* F-752 — the flag-name exemption covered the `arg()` CALL SITE only, so va-shadow-door's
     own refusal tripped 4h on the name of the flag it was refusing. A flag is an option
     wherever it is written. */
  ok(tenantLiterals('      "An empty --staging-envid= drops the environment id from the URL entirely.",').length === 0,
    "NEGATIVE CONTROL (F-752): a refusal that NAMES the flag it is refusing is not a tenant claim — the exemption follows the flag, not the call site that reads it");
  ok(tenantLiterals('  console.log("  node scripts/x.mjs --staging-envid=<id>");').length === 0,
    "NEGATIVE CONTROL (F-752): …and so is a usage line");
  ok(tenantLiterals('  console.log("the shadow badge never appeared on STAGING");').length === 1,
    "POSITIVE CONTROL (F-752): widening the FLAG exemption did not excuse a real tenant CLAIM — the sentence F-741 was cut for still fires");
  ok(tenantLiterals('  console.log("hook reachable on staging");').length === 1,
    "POSITIVE CONTROL (F-752): …in either case");
  /* F-861 — the two senses, side by side. The BLOCK half is the whole reason the rule
     exists; the ALLOW half is the sentence the F-854 surgeon had to reword. */
  ok(tenantLiterals('  PASS("ran on staging");').length === 1,
    "POSITIVE CONTROL (F-861): a claim about where the run went is still caught after the narrowing");
  ok(tenantLiterals('  info("re-run with -e staging to see it");').length === 1,
    "POSITIVE CONTROL (F-861): …and so is the flag form that sends an operator to a tenant");
  ok(tenantLiterals('  info("read the staging tenant logs");').length === 1,
    "POSITIVE CONTROL (F-861): …and the noun phrase, where the word is the environment itself");
  ok(tenantLiterals('  FAIL("so nothing about staging was read at all");').length === 0,
    "NEGATIVE CONTROL (F-861): the VA domain verb — a sentence ABOUT the staging of drafts claims no tenant, and this is the sentence F-854 reworded instead of reporting the rule");
  ok(tenantLiterals('  PASS("staging of the draft left the item untouched");').length === 0,
    "NEGATIVE CONTROL (F-861): …the genitive at the head of a literal is the feature, not a tenant");
  ok(tenantLiterals('  PASS("the reply was staged, not sent");').length === 0,
    "NEGATIVE CONTROL (F-861): `staged` was never the tenant name and is not one now");
  /* F-871 — AN APOSTROPHE IS NOT A LITERAL BOUNDARY. Each of these three carries a tenant
     claim whose marker sits on the FAR side of the apostrophe from the word `staging`, so
     the character-class extraction lost it at the cut and the rule stayed silent. */
  ok(tenantLiterals(`  console.log("we didn't run on staging");`).length === 1,
    "POSITIVE CONTROL (F-871): the preposition marker survives an apostrophe earlier in the sentence");
  ok(tenantLiterals(`  PASS("the staging tenant's hook answered");`).length === 1,
    "POSITIVE CONTROL (F-871): …and so does the tenant NOUN PHRASE when the apostrophe follows it");
  ok(tenantLiterals('  info(`the staging tenant\'s hook answered for ${NAME} on staging`);').length === 1,
    "POSITIVE CONTROL (F-871): …and a template literal is ONE literal — the apostrophe and the `${}` interpolation both stay inside it");
  ok(tenantLiterals(`  PASS("the draft's staging left the item untouched");`).length === 0,
    "NEGATIVE CONTROL (F-871): joining the fragments does not invent a tenant — the domain sense with an apostrophe is still allowed");
  /* F-881 — THE ISSUE KEY AND THE TENANT, side by side. The BLOCK half is the claim the
     shouted branch exists for; the ALLOW half is the sentence a seeding driver prints. */
  ok(tenantLiterals('  PASS("DEV-123 was created");').length === 0,
    "NEGATIVE CONTROL (F-881): an issue KEY whose project prefix is DEV is not a tenant claim — the hyphen is not a letter, so the old boundary let the key through as the shouted name");
  ok(tenantLiterals('  info(`seeded ${n} issues, first DEV-4012`);').length === 0,
    "NEGATIVE CONTROL (F-881): …and the same key inside a template literal");
  ok(tenantLiterals('  PASS("deployed to DEV");').length === 1,
    "POSITIVE CONTROL (F-881): the shouted tenant name with nothing behind it still BLOCKS — the exclusion is the key SHAPE, not the word");
  ok(tenantLiterals('  info("re-run with -e DEV");').length === 1,
    "POSITIVE CONTROL (F-881): …and so does the flag form that sends an operator to a tenant");
  /* F-880 — A WRAPPED BANNER. The claim sits on a CONTINUATION line: per-line, the opening
     line is unterminated (skipped) and the continuation has no opening quote, so the whole
     thing was invisible. The offender is reported at the OPENING quote's line, 1. */
  {
    const wrappedClaim = ["  console.log(`", "    the receipt copy ran on staging", "  `);"].join("\n");
    const found = tenantLiterals(wrappedClaim);
    ok(found.length === 1 && found[0] === 1,
      `POSITIVE CONTROL (F-880): a two-line template whose tenant claim is on the CONTINUATION line is ONE literal, reported at its opening quote (got: ${JSON.stringify(found)})`);
    const wrappedDomain = ["  PASS(`", "    the draft was staged and its staging changed nothing", "  `);"].join("\n");
    ok(tenantLiterals(wrappedDomain).length === 0,
      "NEGATIVE CONTROL (F-880): …and reading the whole template did not turn the VA domain sense into a tenant claim just because it wraps");
  }

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
/* F-756 — THE EXTRACTOR MAY NOT ASSUME THE CALL SITS AT COLUMN 0. The first shape of this
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
  "POSITIVE CONTROL (F-756): the call extractor reads an INDENTED call inside a function — the shape delete-fault-drain-live.mjs has, which the old `\\n})` anchor could not match at all");
ok(/faults: \[\]/.test(guardCallSource('const { envName } = requireEnvAck(process.argv.slice(2), { faults: [], mutates: [] });') || ""),
  "POSITIVE CONTROL (F-756): …and the one-line module-scope call every other driver uses");
ok(/faults: \["real"\]/.test(guardCallSource(stripComments('/* the old shape was requireEnvAck([...argv, "--env=dev"], { faults: [] }) */\nrequireEnvAck(argv, { faults: ["real"] });')) || ""),
  "NEGATIVE CONTROL (F-756/F-735): a docblock QUOTING an old call shape is prose — the extractor reads the real call, or documenting a defect would fail the rule that documents it");
ok(guardCallSource("const r = await other(1);") === null,
  "NEGATIVE CONTROL (F-756): a file with no such call yields null rather than a stray slice");
ok(!/mutates/.test(guardCallSource('requireEnvAck(a, { faults: ["x"] });\nsomethingElse({ mutates: ["roster"] });') || ""),
  "NEGATIVE CONTROL (F-756): the extractor stops at the call's OWN closing paren and does not swallow the next statement");

/* F-771 — A DRIVER THAT ARMS IN ONE MODE MAY SAY SO CONDITIONALLY.
 *
 * The predicate was `faults\s*:\s*\[\s*[^\]\s]` — a bracket IMMEDIATELY after the colon —
 * so `faults: STALE ? ["deleteFault"] : []` read as "names no fault" and the rule failed a
 * driver that names its lever more precisely than any driver it passes. That shape exists
 * because `plant-sweep-live.mjs --stale` arms `armDeleteFault` and its default run arms
 * nothing: declaring the lever unconditionally would make the ordinary run's refusal
 * describe a lever it never pulls, and a refusal that OVERSTATES is learned to be read past
 * exactly as fast as one that understates.
 *
 * So the rule reads the ternary's arms. What it still refuses is the thing it was written
 * for: a `faults:` whose every arm is empty names nothing, whatever syntax it uses. This is
 * F-756's lesson one cohort over — a rule that cannot read a legal call is not a stricter
 * rule, it is a broken one, and the maintainer's obvious reading ("soften the declaration
 * until the rule passes") is the damage.
 */
const NAMES_A_FAULT = /faults\s*:\s*(?:[^,\n{}]*\?\s*)?\[\s*[^\]\s]/;
ok(NAMES_A_FAULT.test('faults: ["deleteFault"],'), "POSITIVE CONTROL (F-771): the plain shape every other arming driver uses still passes");
ok(NAMES_A_FAULT.test('faults: STALE ? ["deleteFault"] : [],'), "POSITIVE CONTROL (F-771): a driver that arms in ONE MODE may name the lever in that arm");
ok(!NAMES_A_FAULT.test("faults: [],"), "NEGATIVE CONTROL (F-771): an empty literal still names nothing");
ok(!NAMES_A_FAULT.test("faults: STALE ? [] : [],"), "NEGATIVE CONTROL (F-771): …and so does a ternary whose every arm is empty — the syntax is not the loophole");

for (const f of armingDrivers) {
  /* PROSE IS NOT A CALL — the discriminator every scan in this file uses, and this one
     needs it too: `git-dispatch-drop-live.mjs` QUOTES its old `requireEnvAck([...argv,
     "--env=dev"], …)` shape in the docblock that explains why the pin moved to `forceEnv`
     (F-735), and an unstripped extractor picks the COMMENT up first and reads its
     `faults:` — or its absence — instead of the real call's. Documenting a defect must
     never fail the rule that documents it. */
  const src = stripComments(readFileSync(path.join(here, f), "utf8"));
  const call = guardCallSource(src);
  ok(!!call && NAMES_A_FAULT.test(call),
    `${f}: arms a fault, so its requireEnvAck call must NAME one — \`faults: []\` on an arming driver silences the refusal it exists for`);
}

/* ── 4h-2. F-702 — THE SWEEP DRAIN HAS ONE HOME, AND THE LEDGER STORES A STRING ──
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
  /* F-766 — THE BOUNDARY, because `rowsTruncated` IS NOT `truncated`. Without the lookbehind
     this pattern also matched `rowsTruncated === true`, which is a different field answering
     a different question: `truncated` says the SWEEP stopped early (finishedness, F-692's
     subject), `rowsTruncated` says the answer's courtesy row LIST hit
     HARNESS_FAULT_SWEEP_MAX_ROWS while the counters kept counting. A driver that checks the
     list cap — which F-766 requires it to, since that cap is what made a row-derived
     assertion wrong — was refused by a rule with no opinion about it. `a.truncated === true`
     is still caught: `.` is not a letter. */
  ok(!/(?<![A-Za-z])truncated\s*(?:!==|===)\s*true/.test(code),
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

/* ═══════════════════════════════════════════════════════════════════════════════════
 * ── 4i. F-769 — A DRIVER MAY NOT READ A CREDENTIAL'S `value`, NOR PLANT ONE WITHOUT
 *               THE STASH ──────────────────────────────────────────────────────────
 *
 * THE RECURRENCE THIS CLOSES. F-769 put a READ CEILING on the dev hook's `?what=kvs`: a
 * credential-family key answers `{key, present, fingerprint, masked:true}` and never
 * `value`. It was cut in `src/`, and it silently broke three live drivers in TWO different
 * directions at once, neither of which any gate could see:
 *
 *   THE VACUOUS PASS. `key-status-fault-live.mjs` and `key-status-fault-ui-live.mjs` each
 *   reduced the slot with `r.json.value` and compared before to after. With `value` gone
 *   every read reduces to "EMPTY", the comparison becomes `EMPTY === EMPTY`, and the run
 *   prints PASS under the words "the lever never went near a credential" — a guarantee it
 *   is no longer making.
 *
 *   THE DESTROYED KEY. `va-compaction-live.mjs` snapshotted `COGNIRUNNER_KEY_openai`,
 *   planted a dead key, and replayed the snapshot in its `finally`. With `value` gone the
 *   snapshot is `null`, `null` is `kvSet`'s spelling of DELETE, and the restore deletes the
 *   tenant's live BYOK key while printing "RESTORED" beside it. Strictly worse than the
 *   leak the ceiling closed.
 *
 * Fixing those three leaves the MECHANISM open: the next driver that reads or plants a
 * credential slot will be written the same way, because the old shape is what every
 * neighbouring driver looks like. So this is the rule, and it has two halves:
 *
 *   HALF A — a driver that reads a CREDENTIAL-FAMILY key through `?what=kvs` may not read
 *   `.value` off that answer. There is no `value` there; reading one is either a vacuous
 *   check or a `null` about to be written back.
 *
 *   HALF B — a driver that WRITES a credential-family key with `kvSet` must also call
 *   `kvStash` and `kvRestore`. A plant with no stash is a key the driver cannot put back,
 *   because it can no longer read the one it replaced.
 *
 * THE FAMILIES ARE PARSED FROM `src/test-hook.js`, never retyped here — that file's own
 * docblock calls `CREDENTIAL_KEY_FAMILIES` the ONE home of "is the value behind this key a
 * credential?", and a rule about second homes is the last rule that should have one. A
 * family added there is policed here the day it is added.
 *
 * AND THE MINTERS ARE DERIVED TOO. Drivers rarely type `"COGNIRUNNER_KEY_openai"`; they
 * call `providerKeySlot(provider)`. Which `src/shared/provider-slots.js` helpers mint a
 * CREDENTIAL key is not a judgement either — each is `(provider) => \`PREFIX${provider}\``,
 * so the prefix is read out of the library and tested against the families above.
 * `providerKeySlot` qualifies; `providerModelSlot` does not; `providerSlotsFor` qualifies
 * because its body returns one that does.
 *
 * WHAT IT READS. Comments are masked and STRING AND TEMPLATE BODIES ARE KEPT
 * (`maskComments`, F-769's half of lib/js-source-scan.mjs) — the exact opposite of every
 * other scan in this file, and necessarily so: the key lives inside
 * `` `COGNIRUNNER_KEY_${p}` ``, while the same words in a docblock explaining the ceiling
 * are prose. Several drivers carry that prose, and documenting a defect must never fail
 * the rule that documents it.
 *
 * WHAT IT DOES NOT DO, stated rather than hidden. It is a FILE-LEVEL rule: it cannot prove
 * that the `.value` read and the credential key are the same expression, only that a file
 * doing both is not allowed. That is deliberately coarse in the refusing direction, and it
 * is the same direction `isCredentialKey` itself chose. A driver that legitimately reads an
 * ordinary row's `value` AND a credential slot must route the credential read through
 * `lib/key-slot-witness.mjs` — which is the point, because that library is where the
 * `present`/`fingerprint`/UNREADABLE reasoning lives and is not worth re-deriving per file.
 * ═══════════════════════════════════════════════════════════════════════════════════ */
const CREDENTIAL_FAMILIES = (() => {
  const m = HOOK_SRC.match(/export const CREDENTIAL_KEY_FAMILIES\s*=\s*\[([\s\S]*?)\]/);
  return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
})();
ok(CREDENTIAL_FAMILIES.length >= 10 && CREDENTIAL_FAMILIES.includes("COGNIRUNNER_KEY_")
  && CREDENTIAL_FAMILIES.includes("git_conn_secret:") && CREDENTIAL_FAMILIES.includes("harness_stash:"),
  "F-769: the credential families are READ from src/test-hook.js's one home (got " + CREDENTIAL_FAMILIES.length + ": " + CREDENTIAL_FAMILIES.join(", ") + ")");

/* The slot helpers that MINT a credential key, derived from the prefix each one returns. */
const SLOTS_SRC = readFileSync(path.join(here, "..", "..", "src", "shared", "provider-slots.js"), "utf8");
const CREDENTIAL_MINTERS = (() => {
  const direct = new Set();
  for (const m of SLOTS_SRC.matchAll(/export const ([A-Za-z_$][\w$]*)\s*=\s*\([^)]*\)\s*=>\s*`([^`$]*)\$\{/g)) {
    if (CREDENTIAL_FAMILIES.some((f) => m[2].startsWith(f) || f.startsWith(m[2]))) direct.add(m[1]);
  }
  /* …and a helper that RETURNS one of those is one too — `providerSlotsFor` hands back the
     key slot among four, so a driver reaching for it reaches a credential key. */
  const all = new Set(direct);
  for (const m of SLOTS_SRC.matchAll(/export const ([A-Za-z_$][\w$]*)\s*=\s*\([^)]*\)\s*=>\s*(\[[\s\S]*?\]);/g)) {
    if ([...direct].some((d) => new RegExp(`\\b${d}\\b`).test(m[2]))) all.add(m[1]);
  }
  return [...all];
})();
ok(CREDENTIAL_MINTERS.includes("providerKeySlot") && CREDENTIAL_MINTERS.includes("providerSlotsFor"),
  "F-769: the credential-key MINTERS are derived from the prefix each provider-slots helper returns (got " + CREDENTIAL_MINTERS.join(", ") + ")");
ok(!CREDENTIAL_MINTERS.includes("providerModelSlot") && !CREDENTIAL_MINTERS.includes("providerAgentModelSlot"),
  "F-769: …and the model/agent-model/base-url slots are NOT credentials — the derivation discriminates, it does not sweep the module in");

/* EVERY STRING AND TEMPLATE BODY IN A FILE, derived by asking the one home BOTH ways: a
 * byte that `maskComments` keeps and `maskNonCode` blanks is a literal byte. No third
 * scanner, and the two masks are the same length by contract, so the diff is an index walk.
 *
 * WHY LITERALS HAVE TO BE SPLIT UP AT ALL. A family prefix inside a SENTENCE is prose, even
 * when the sentence is a `NV("…the kvSet allow-list is deliberately not widened to
 * git_conn_secret:*…")` message rather than a comment — `git-rotation-window-live.mjs` says
 * exactly that, about a key it never touches, and a plain `includes` reads it as a use. A
 * KEY literal, by contrast, BEGINS with its family: `"COGNIRUNNER_KEY_openai"`,
 * `` `COGNIRUNNER_KEY_${provider}` ``, `"harness_stash:" + id`. That is the discriminator,
 * and it is a property of how KVS keys are written rather than a guess about English. */
function literalRuns(src) {
  const kept = maskComments(src), code = maskNonCode(src);
  const runs = [];
  let cur = null;
  for (let i = 0; i < kept.length; i++) {
    /* A LITERAL byte: `maskNonCode` blanked it and `maskComments` did not. A SPACE inside a
       literal is indistinguishable from code whitespace byte-for-byte, so it CONTINUES an
       open run and never starts one. Getting that wrong is what made the first draft
       word-level instead of span-level — and a word-level check reads `git_conn_secret:*`
       in the middle of an NV message as a key, which is the exact prose
       `git-rotation-window-live.mjs` carries about a key it never touches. */
    const isLit = code[i] === " " && kept[i] === src[i] && src[i] !== "\n";
    const isSpace = src[i] === " " || src[i] === "\t";
    if (isLit && (!isSpace || cur !== null)) { if (cur === null) cur = i; }
    else if (cur !== null) { runs.push(kept.slice(cur, i)); cur = null; }
  }
  if (cur !== null) runs.push(kept.slice(cur));
  /* The OPENING DELIMITER is masked by `maskNonCode` too, so it rides at the front of the
     run — `` `COGNIRUNNER_KEY_ `` rather than `COGNIRUNNER_KEY_`. Drop it, or every key
     literal fails `startsWith` for the sake of one backtick. */
  return runs.map((r) => r.replace(/^[`"']+/, ""));
}
/** Does this source name a credential-family key — as a KEY literal, or via a minter? */
export function namesCredentialKey(src) {
  const code = maskComments(src);
  const hits = new Set();
  for (const run of literalRuns(src)) {
    for (const f of CREDENTIAL_FAMILIES) if (run.startsWith(f)) hits.add(f);
  }
  for (const m of CREDENTIAL_MINTERS) if (new RegExp(`\\b${m}\\s*\\(`).test(code)) hits.add(m + "()");
  return [...hits];
}
/** Every `.value` / `{ value }` read this file takes off a hook answer. */
const valueReads = (code) => {
  const reads = [];
  for (const m of code.matchAll(/(?:^|[^\w$])(?:[\w$]+|\))\s*(?:\.json|\.body)?\s*\.value\b/g)) reads.push(m[0].trim());
  for (const m of code.matchAll(/\{\s*(?:[^{}]*,\s*)?value\s*(?:[,}:])/g)) reads.push(m[0].trim());
  return reads;
};
/**
 * HALF A, stated as the property that is actually decidable from one file.
 *
 * A driver that reaches a credential-family key AND reads `?what=kvs` answers' `.value`
 * must route its credential reads through `lib/key-slot-witness.mjs`.
 *
 * WHY THE ESCAPE HATCH IS THE RULE AND NOT A HOLE. A scanner cannot follow which KEY a
 * given `.value` came from — `va-compaction-live.mjs` legitimately reads `.value` off
 * `COGNIRUNNER_AI_PROVIDER` and `va_compact_backoff:*`, ordinary rows, in the same helper,
 * and the pre-fix defect went through a `for (const k of [PROVIDER_SLOT, BROKEN_KEY_SLOT])`
 * loop where the argument is a loop variable and no expression names a credential at all.
 * Demanding the WITNESS IMPORT is the property that is both checkable and the one worth
 * having: it is where `present`/`fingerprint`/UNREADABLE live, it is the thing that must not
 * be re-derived per driver (LAW 1), and it is what the two broken drivers were missing.
 *
 * THE LIMIT, stated rather than hidden: a driver that imports the witness and ALSO reads
 * `.value` off a credential key is not caught here. Nothing in one file can catch it; what
 * makes it unlikely is that the witness is the shorter path once it is imported.
 */
export function readsCredentialValue(src) {
  const code = maskComments(src);
  if (!/\?what=kvs/.test(code)) return [];
  if (!namesCredentialKey(src).length) return [];
  if (/from\s+["'][^"']*key-slot-witness\.mjs["']/.test(code)) return [];
  return valueReads(code);
}
/** Does this file PLANT a credential-family key through `kvSet`? */
export function plantsCredentialKey(src) {
  const code = maskComments(src);
  return /\bkvSet\b/.test(code) && namesCredentialKey(src).length > 0;
}
const stashesAndRestores = (src) => {
  const code = maskComments(src);
  return /\bkvStash\b/.test(code) && /\bkvRestore\b/.test(code);
};

/* THE COHORT: every live driver and every `_probe-*`, the same one rule 4g and the scope
   suite police. A `.test.mjs` is NOT in it — the offline suites exercise the door itself
   against a mock store, and `rules-runtime-regression.test.mjs` must be free to assert that
   an ordinary row still returns its value. */
{
  const cohort = readdirSync(here).filter((f) => f.endsWith("-live.mjs") || f.startsWith("_probe-")).sort();
  ok(cohort.length > 30, "F-769: the credential rule runs over the whole live-driver cohort (" + cohort.length + " files)");
  const touches = [];
  let planters = 0;
  for (const f of cohort) {
    const src = readFileSync(path.join(here, f), "utf8");
    const bad = readsCredentialValue(src);
    if (namesCredentialKey(src).length) touches.push(f);
    ok(bad.length === 0,
      `HALF A (F-769) ${f}: reaches a credential-family key (${namesCredentialKey(src).join(", ")}) AND takes \`.value\` off a \`?what=kvs\` answer (${[...new Set(bad)].slice(0, 3).join(", ")}). The ceiling does not answer \`value\` for those rows — read \`present\`/\`fingerprint\` through lib/key-slot-witness.mjs`);
    if (plantsCredentialKey(src)) {
      planters++;
      ok(stashesAndRestores(src),
        `HALF B (F-769) ${f}: writes a credential-family key with kvSet but never calls kvStash/kvRestore — it cannot put back the key it replaced, and a \`null\` replay DELETES it`);
    }
  }
  /* ANTI-BLINDNESS. A directory rule that matches nothing passes forever, which is the same
     failure mode as the vacuous check this whole section is about. These are the three
     drivers F-769 really broke, named: if a refactor ever makes `namesCredentialKey` stop
     seeing one of them, this goes red HERE rather than going quiet everywhere. */
  for (const f of ["key-status-fault-live.mjs", "key-status-fault-ui-live.mjs", "va-compaction-live.mjs"]) {
    ok(touches.includes(f),
      `F-769: the rule SEES ${f} — one of the three drivers the read ceiling really broke (seen: ${touches.join(", ") || "NOTHING"})`);
  }
  ok(planters >= 1, "F-769: …and " + planters + " driver(s) plant a credential through kvSet, so HALF B is not an empty arm");
}

/* ── POSITIVE CONTROLS · both halves, in the shape each really shipped in ────────── */
{
  /* HALF A — `key-status-fault-live.mjs`'s reduction, verbatim as it stood before 90a22c5. */
  const halfA = [
    'import { providerKeySlot } from "../../src/shared/provider-slots.js";',
    "const keySlotFingerprint = async (provider) => {",
    "  const r = await hook(null, \"GET\", `?what=kvs&key=${encodeURIComponent(providerKeySlot(provider))}`);",
    "  const v = r.json ? r.json.value : undefined;",
    '  return v === null || v === undefined ? "EMPTY" : "PRESENT";',
    "};",
  ].join("\n");
  ok(namesCredentialKey(halfA).includes("providerKeySlot()"),
    "POSITIVE CONTROL (F-769 A): `providerKeySlot(provider)` IS a credential key, without a family string appearing anywhere in the file");
  ok(readsCredentialValue(halfA).length > 0,
    "POSITIVE CONTROL (F-769 A): the exact pre-fix reduction — `r.json.value` off a `?what=kvs` read of a provider key slot — is CAUGHT");

  const halfAfixed = [
    'import { providerKeySlot } from "../../src/shared/provider-slots.js";',
    'import { readKeySlotWitness } from "../lib/key-slot-witness.mjs";',
    "const keySlotWitness = (provider) =>",
    '  readKeySlotWitness((qs) => hook(null, "GET", qs), providerKeySlot(provider));',
  ].join("\n");
  ok(readsCredentialValue(halfAfixed).length === 0,
    "NEGATIVE CONTROL (F-769 A): the same driver reading through lib/key-slot-witness.mjs is CLEAN");

  /* The literal form, inside a template hole — the shape `maskNonCode` would have erased. */
  const literal = 'const BROKEN_KEY_SLOT = `COGNIRUNNER_KEY_${BROKEN_PROVIDER}`;\nconst r = await hook(null, "GET", `?what=kvs&key=${BROKEN_KEY_SLOT}`);\nconst v = r.body.value;';
  ok(namesCredentialKey(literal).includes("COGNIRUNNER_KEY_"),
    "POSITIVE CONTROL (F-769 A): a family prefix inside a TEMPLATE LITERAL is a use — `maskNonCode` masks template text away, which is why this rule reads `maskComments`");
  ok(readsCredentialValue(literal).length > 0,
    "POSITIVE CONTROL (F-769 A): …and `r.body.value` off it is caught, not just `r.json.value`");

  /* PROSE IS NOT A USE — the discriminator every scan in this file needs. Two real
     drivers explain the ceiling and the kvSet allow-list in their docblocks. */
  const prose = [
    "/* The kvSet allow-list is deliberately NOT widened to git_conn_secret:* — secrets are",
    "   never plantable, and COGNIRUNNER_KEY_ rows answer present+fingerprint only. */",
    '// a webtrigger_url:* row is masked too',
    'const r = await hook(null, "GET", "?what=kvs&key=app_admins");',
    "const roster = r.json.value || [];",
  ].join("\n");
  ok(namesCredentialKey(prose).length === 0,
    "NEGATIVE CONTROL (F-769): three credential families named in COMMENTS are prose, not uses — documenting the ceiling must not fail the rule that documents it");
  ok(readsCredentialValue(prose).length === 0,
    "NEGATIVE CONTROL (F-769): …so an ordinary `app_admins` row still reads its `value` freely, which is most of this directory");

  /* HALF B — `va-compaction-live.mjs`'s plant, verbatim as it stood before bfed3a3. */
  const halfB = [
    "const BROKEN_KEY_SLOT = `COGNIRUNNER_KEY_${BROKEN_PROVIDER}`;",
    "async function kvSet(key, value) { return hook({ action: \"kvSet\", key, value }); }",
    "for (const k of [PROVIDER_SLOT, BROKEN_KEY_SLOT]) { slotsBefore[k] = (await kvs(k)).value; }",
    'await kvSet(BROKEN_KEY_SLOT, "sk-harness-deliberately-dead-key-000000000000000000");',
    "for (const [k, v] of Object.entries(slotsBefore)) { await kvSet(k, v); }",
  ].join("\n");
  ok(plantsCredentialKey(halfB),
    "POSITIVE CONTROL (F-769 B): a `kvSet` onto `COGNIRUNNER_KEY_${…}` is a credential PLANT");
  ok(!stashesAndRestores(halfB),
    "POSITIVE CONTROL (F-769 B): …and with no kvStash/kvRestore it is the shape that DELETED the tenant's key on every run");

  const halfBfixed = halfB + '\nconst stash = await hook({ action: "kvStash", key: BROKEN_KEY_SLOT });\nasync function kvRestore(id) { return hook({ action: "kvRestore", stashId: id }); }\nawait kvStash(BROKEN_KEY_SLOT);';
  ok(stashesAndRestores(halfBfixed),
    "NEGATIVE CONTROL (F-769 B): the same plant with the stash door either side is CLEAN");
  ok(!plantsCredentialKey('await kvSet("COGNIRUNNER_AI_PROVIDER", "openai");\nawait kvSet(MEMORIES_KEY, rows);'),
    "NEGATIVE CONTROL (F-769 B): planting the PROVIDER slot and the memories row is not planting a credential — those are snapshot-and-replay rows and must stay so");
  ok(!plantsCredentialKey(halfB.replace(/kvSet/g, "kvSetNot")),
    "NEGATIVE CONTROL (F-769 B): the rule turns on the `kvSet` DOOR, not on the word appearing inside a longer name");

  /* And the rule must not fire on a file that names a credential but never goes near the
     kvs door — `git-rotation-window-live.mjs` is exactly that, in prose only. */
  ok(readsCredentialValue('const v = r.json.value;').length === 0,
    "NEGATIVE CONTROL (F-769 A): a `.value` read with no `?what=kvs` and no credential key anywhere is not this rule's business");
}

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

/* ── 4k. F-787 / F-799 — AN EVIDENCE FILE NAMES THE COMMIT THAT PRODUCED IT, AND A
 *              DRIVER THAT PRINTS A VERDICT LEAVES A FILE ──────────────────────
 *
 * `evidence.json` records what a run SAW. It never recorded what CODE produced it, so an
 * evidence file and the driver that wrote it could drift apart with nothing in either to
 * show it — and these files are read weeks later, beside a findings row, by someone deciding
 * whether a red is still true. `lib/driver-report.mjs` answers it in three fields
 * (`commit`, `dirty`, `at`), and `dirty` is there because evidence produced from uncommitted
 * edits is still evidence but is NOT reproducible from the commit it names.
 *
 * THIS RULE WARNS, IT DOES NOT YET DEMAND. Measured on the pass that introduced the helper:
 * 28 drivers write an evidence.json and 23 of them do not record provenance. Turning 23
 * files red at once would have made this rule the thing people delete, so it was cut as a DEBT
 * LEDGER: the named 23 permitted, the COUNT MAY NOT GROW, and any writer NOT on the list
 * must record provenance. F-793 then converted all 23 and the ledger is EMPTY — the rule now
 * DEMANDS provenance of every evidence writer, which is what it was always meant to do. That makes the rule bite on exactly the case that matters — the
 * next evidence writer somebody adds — while the existing cohort is converted by whoever
 * next has reason to touch each file. An entry that has been converted must be REMOVED from
 * the list, and the rule says so, because a warn-list nobody prunes becomes a permanent
 * exemption. */
{
  /* F-793 — THE LEDGER IS EMPTY, AND THAT IS THE POINT. All 23 named writers now call
     `runProvenance()`, so the rule below no longer permits anybody: every evidence writer
     must record the commit that produced it, and the `strangers` assertion is now the whole
     rule rather than a growth cap. The array stays, empty, because the shape it enforces
     (name the exemption, prune it when converted) is what a future debt must be written in —
     and an empty list makes "there are no exemptions" a thing the file SAYS. */
  const PROVENANCE_DEBT = [];
  /* An evidence WRITER is a file that writes an artefact a later reader will open beside a
     findings row, found the same crude textual way rule 4b's redaction check finds it.
     F-799 WIDENED IT: it used to mean the literal filename `evidence.json`, which let two
     real evidence artefacts out of the cohort on a naming technicality —
     `harness-fault-expiry-live.mjs` writes `${OUT}/${ENV_NAME}-<timestamp>.json` and
     `pipeline-scaffold-live.mjs` writes `state.json`, both under `results/`, and neither
     carried a commit. What makes a file evidence is WHERE it lands, not what it is called. */
  const writesArtefact = (s) => /writeFileSync\(/.test(s) && (/evidence\.json/.test(s) || /RESULTS_DIR|["`]\.\.\/results\//.test(s));
  ok(writesArtefact('fs.writeFileSync(`${OUT}/evidence.json`, x);\nconst OUT = new URL("../results/x", import.meta.url).pathname;'),
    "4k (F-799) POSITIVE CONTROL: the widened predicate still sees the classic evidence.json writer");
  ok(writesArtefact('const OUT = new URL("../results/harness-fault-expiry", import.meta.url).pathname;\nfs.writeFileSync(file, y);'),
    "4k (F-799) POSITIVE CONTROL: …and now also sees a differently-named artefact written under results/, which is the case it was blind to");
  ok(!writesArtefact('const s = readFileSync(p, "utf8");'),
    "4k (F-799) NEGATIVE CONTROL: a file that only READS is not an evidence writer");
  const writers = liveFiles.filter((f) => writesArtefact(readFileSync(path.join(here, f), "utf8")));
  const missing = writers.filter((f) => !/runProvenance/.test(readFileSync(path.join(here, f), "utf8")));

  ok(writers.length > 20,
    `4k (F-787): the evidence-writer cohort is found, not assumed — ${writers.length} files write an evidence.json`);
  ok(missing.length <= PROVENANCE_DEBT.length,
    `4k (F-787): the provenance debt did not GROW — ${missing.length} writers record no provenance, ledger allows ${PROVENANCE_DEBT.length}`);
  const strangers = missing.filter((f) => !PROVENANCE_DEBT.includes(f));
  ok(strangers.length === 0,
    `4k (F-787): a NEW evidence writer must record provenance — ${strangers.join(", ")} writes an evidence.json without calling runProvenance() from lib/driver-report.mjs`);
  const stale = PROVENANCE_DEBT.filter((f) => !missing.includes(f));
  ok(stale.length === 0,
    `4k (F-787): the debt list is PRUNED — ${stale.join(", ")} now records provenance (or no longer writes evidence) and must come off PROVENANCE_DEBT, because a warn-list nobody shortens is a permanent exemption`);

  /* And the helper really is in the lib, so this rule points at a home that exists. */
  ok(/export function runProvenance/.test(readFileSync(path.join(libDir, "driver-report.mjs"), "utf8")),
    "4k (F-787): lib/driver-report.mjs exports runProvenance — ONE home, so `commit`/`dirty`/`at` cannot come to mean different things in different evidence files");

  /* ── F-799 — THE COHORT THE PROVENANCE RULE COULD NOT SEE AT ALL ────────────────
   *
   * Everything above polices files that DO write evidence. It said nothing about a driver
   * that writes none, which is the worse case and the one F-799 was cut for:
   * `va-shadow-door-live.mjs` runs 23 assertions and a browser DOM read against a live
   * tenant, and every one of those verdicts lived in scrollback. A findings row resting on
   * "it passed on 2d7b8204" then has nothing behind it, and the run is not cheap to re-take
   * — it creates an agent, rewrites an instance-wide model slot and waits out real windows.
   *
   * THE COHORT IS THE ONE RULE 4j ALREADY DEFINES: a driver that prints a COUNTS SUMMARY is
   * a driver that claims a verdict, and a claimed verdict with no artefact behind it is the
   * shape this polices. The predicate is imported in spirit but re-derived here on the same
   * two regexes, because a summary-printing driver that writes nothing is exactly the file
   * whose only trace is the line rule 4j is about.
   *
   * A DEBT LEDGER, in this file's established shape, for this file's established reason: 10
   * drivers are in it today and turning ten red in one pass makes this the rule people
   * delete. The named ten are permitted, THE COUNT MAY NOT GROW, a driver NOT on the list
   * must write an artefact, and a converted entry must come OFF the list. The three F-799
   * converted (va-shadow-door, va-pinned-survival, va-purge-on-delete) are deliberately
   * absent from it — that is what "converted" looks like. */
  const ARTEFACT_DEBT = [
    "brakes-knowledge-live.mjs", "git-rotation-window-live.mjs", "issue-key-live.mjs",
    "resolvers-live.mjs", "sandbox-confluence-live.mjs", "va-capability-gate-live.mjs",
    "va-compaction-live.mjs", "va-rest-doors-live.mjs", "va-shadow-live.mjs",
    "web-search-live.mjs",
  ];
  const LEADING_NL = /console\.(?:log|error)\(\s*(?:"\\n"\s*\+\s*)?[`"']\\n/;
  const COUNTED = /(?:\$\{[^}]*\}[\s·,:.]*(?:pass|fail|not verified|N\/V)|(?:PASS|FAIL|N\/V)[\s·,:.]*\$\{)/i;
  const claimsVerdict = (s) => s.split("\n").some((l) => LEADING_NL.test(l) && (/formatResultLine/.test(l) || COUNTED.test(l)));

  ok(claimsVerdict('  console.log("\\n" + formatResultLine({ passes, fails, unproven }));'),
    "4k (F-799) POSITIVE CONTROL: a driver that prints a RESULT line is recognised as claiming a verdict — a predicate that matched nothing would make this half green by finding no drivers");
  ok(!claimsVerdict('  console.log(`  PASS  ${s}`);'),
    "4k (F-799) NEGATIVE CONTROL: a per-check line is not a claimed verdict, so a driver that prints checks and no summary is not asked for an artefact");

  const verdictDrivers = liveFiles.filter((f) => claimsVerdict(readFileSync(path.join(here, f), "utf8")));
  const noArtefact = verdictDrivers.filter((f) => !writesArtefact(readFileSync(path.join(here, f), "utf8")));
  ok(verdictDrivers.length > 20,
    `4k (F-799): the verdict-claiming cohort is found, not assumed — ${verdictDrivers.length} live drivers print a summary`);
  ok(noArtefact.length <= ARTEFACT_DEBT.length,
    `4k (F-799): the no-artefact debt did not GROW — ${noArtefact.length} drivers claim a verdict and write no file, ledger allows ${ARTEFACT_DEBT.length}`);
  const bare = noArtefact.filter((f) => !ARTEFACT_DEBT.includes(f));
  ok(bare.length === 0,
    `4k (F-799): a driver that claims a verdict must leave a machine-readable artefact — ${bare.join(", ")} prints a RESULT line and writes nothing, so the run exists only in the terminal it was run from`);
  const converted = ARTEFACT_DEBT.filter((f) => !noArtefact.includes(f));
  ok(converted.length === 0,
    `4k (F-799): the artefact debt list is PRUNED — ${converted.join(", ")} now writes an artefact and must come off ARTEFACT_DEBT, because a warn-list nobody shortens is a permanent exemption`);
  /* The three this finding converted are asserted BY NAME to be out of the ledger and in
     the writer cohort, so a revert cannot quietly put them back on the warn-list. */
  for (const f of ["va-shadow-door-live.mjs", "va-pinned-survival-live.mjs", "va-purge-on-delete-live.mjs"]) {
    ok(!ARTEFACT_DEBT.includes(f) && writers.includes(f) && !missing.includes(f),
      `4k (F-799): ${f} writes an evidence file AND records provenance — the three drivers this finding converted are named, so a revert shows up here rather than as a silent re-entry on the debt list`);
  }
}


/* ── 4j. F-792 / F-796 — EVERY SUMMARY LINE IS PRINTED THROUGH `formatResultLine`,
 *              SO A CRASH CANNOT BE REPORTED AS `0 fail` ─────────────────────────
 *
 * F-784 found one driver printing `RESULT — 2 pass, 0 fail, 0 not verified` under a
 * TypeError stack. F-792 measured how wide that shape is: fifteen drivers print their
 * summary from a `finally` — correct, because the RESTORE block must report its residue
 * AFTER the verdict — and ten of them had no catch, so the counters printed frozen at the
 * throw and the run read as clean. `lib/driver-report.mjs` is the one place that knows how
 * to say CRASHED in the FIRST WORD, which is the only part a grep or a tired reader takes.
 *
 * WHAT THIS RULE POLICES. A `*-live.mjs` that prints a COUNTS SUMMARY — a leading-newline
 * console line carrying pass/fail/N-V counters — must build it with `formatResultLine`.
 * Drivers with no summary line at all are not in scope: a driver that prints nothing on the
 * crash path tells no lie, and the rule is about lines that CLAIM a verdict.
 *
 * F-796 — IT IS NOW ABSOLUTE, AND IT IS LINE-LEVEL. Both of those were named defects of the
 * rule, not of the drivers:
 *
 *   THE DEBT LIST IS GONE, because the debt is. All 23 named drivers were wired in one pass,
 *   and a warn-list with nothing left on it is an exemption waiting to be re-used. There is
 *   no longer a permitted set: a live driver that prints a verdict prints it through the
 *   helper, full stop.
 *
 *   THE CHECK IS PER LINE, NOT PER FILE. The old form asked "does this file mention
 *   `formatResultLine` anywhere", so a converted driver could keep a SECOND hand-rolled
 *   summary — the likeliest way this defect comes back, because a driver with two arms or
 *   two phases has two verdict lines and only one of them gets touched. Each matching LINE
 *   must itself call the helper, and a failure names `file:line` so the reader goes to the
 *   one that is wrong rather than to the file that contains it.
 *
 * THE DETECTOR IS TEXTUAL, AND ITS CONTROLS ARE THE SHAPES THAT REALLY SHIPPED. A regex that
 * quietly stopped matching would turn an absolute rule green by finding nothing at all — so
 * the cohort size is asserted, the OLD shape is asserted to still be recognised AND judged
 * non-compliant, the WIRED shape to be recognised AND judged compliant, a per-check PASS/FAIL
 * line to be no summary at all, and a two-line body carrying one of each is asserted to fail
 * — which is the assertion that would have been green under the file-level form. */
{
  /* A COUNTS SUMMARY, IN THREE PARTS — and F-796 had to add the third.
     (1) it opens a console line with a NEWLINE: that leading blank line is what separates a
         run's verdict from its per-check chatter, and per-check PASS/FAIL lines (printed by
         helpers, never with a leading newline) must not be caught;
     (2) it carries a verdict WORD;
     (3) F-796 — that word sits against a COUNTER. Without (3) the detector matched every
         banner a driver prints: `console.log("\nSTEP 4 - the step-3-failure arm")` and
         `console.log(`\nF-629 — the key-status failure, on ${ENV_NAME}`)` both contain
         "fail" after a newline and neither claims a verdict. The old FILE-level rule never
         noticed, because those files also contained a real summary; grading per LINE made
         the false positives visible immediately, which is the argument for grading per line
         in one sentence. A counter is an interpolation adjacent to the word, on either side
         (`${passes} pass` and `PASS ${passes}` are both shapes that really shipped). */
  const LEADING_NEWLINE = /console\.(?:log|error)\(\s*(?:"\\n"\s*\+\s*)?[`"']\\n/;
  const COUNTED_VERDICT = /(?:\$\{[^}]*\}[\s·,:.]*(?:pass|fail|not verified|N\/V)|(?:PASS|FAIL|N\/V)[\s·,:.]*\$\{)/i;
  const SUMMARY_LINE = {
    test: (l) => LEADING_NEWLINE.test(l) && (/formatResultLine/.test(l) || COUNTED_VERDICT.test(l)),
  };
  /** Every offending LINE in a body, as `n: text` — the unit the rule now grades. */
  const unwiredLines = (src) =>
    src.split("\n")
      .map((l, i) => ({ n: i + 1, l }))
      .filter(({ l }) => SUMMARY_LINE.test(l) && !/formatResultLine/.test(l));
  const summaryLines = (src) => src.split("\n").filter((l) => SUMMARY_LINE.test(l));

  const OLD_SHAPE = 'console.log(`\\n${passes} pass, ${fails} fail, ${unproven} not verified`);';
  const WIRED_SHAPE = '  console.log("\\n" + formatResultLine({ passes, fails, unproven, crashed }));';
  ok(SUMMARY_LINE.test(OLD_SHAPE),
    "4j (F-792) POSITIVE CONTROL: the detector still recognises the OLD summary shape — a regex that matched nothing would make this rule green by finding no drivers at all");
  ok(SUMMARY_LINE.test(WIRED_SHAPE),
    "4j (F-792) POSITIVE CONTROL: the detector also recognises the WIRED shape, so 'has a summary' and 'is compliant' are two independent questions");
  ok(!SUMMARY_LINE.test('  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);'),
    "4j (F-792) NEGATIVE CONTROL: a per-check PASS/FAIL line is NOT a summary — without this the rule would demand formatResultLine of every driver that prints checks");
  for (const banner of [
    'console.log("\\nSTEP 4 - the step-3-failure arm");',
    'console.log(`\\nF-629 — the key-status failure, on ${ENV_NAME.toUpperCase()}, provider ${PROVIDER}`);',
    'if (NO_BREAK) { console.log("\\n--no-break: stopping before the failure arms."); return; }',
  ]) {
    ok(!SUMMARY_LINE.test(banner),
      `4j (F-796) NEGATIVE CONTROL: a STEP BANNER that merely contains the word "fail" is not a verdict — ${banner.slice(0, 70)}…`);
  }
  ok(unwiredLines(OLD_SHAPE).length === 1 && unwiredLines(WIRED_SHAPE).length === 0,
    "4j (F-796) POSITIVE CONTROL: the per-line grader calls the old shape offending and the wired shape clean");
  /* THE ASSERTION THE FILE-LEVEL FORM COULD NOT MAKE: one wired line does not absolve the
     hand-rolled one beside it. This is F-796's whole point, stated as a control. */
  const MIXED = `${WIRED_SHAPE}\n${OLD_SHAPE}`;
  ok(unwiredLines(MIXED).length === 1 && unwiredLines(MIXED)[0].n === 2,
    "4j (F-796) POSITIVE CONTROL: a file carrying BOTH a wired line and a hand-rolled one is RED, and the red names line 2 — under the old file-level test this body passed because `formatResultLine` appeared somewhere in it");

  const summarisers = liveFiles.filter((f) => summaryLines(readFileSync(path.join(here, f), "utf8")).length > 0);
  ok(summarisers.length > 20,
    `4j (F-792): the summary-printing cohort is found, not assumed — ${summarisers.length} live drivers print a counts summary`);

  const offenders = [];
  for (const f of summarisers) {
    for (const { n, l } of unwiredLines(readFileSync(path.join(here, f), "utf8"))) offenders.push(`${f}:${n} ${l.trim().slice(0, 90)}`);
  }
  ok(offenders.length === 0,
    `4j (F-792/F-796): EVERY line that prints a verdict prints it through formatResultLine — ${offenders.join(" | ")} hand-rolls a summary, so a crash inside it reports the counters the throw froze instead of saying the run did not finish`);

  ok(/export function formatResultLine/.test(readFileSync(path.join(libDir, "driver-report.mjs"), "utf8"))
     && /export function resultExitCode/.test(readFileSync(path.join(libDir, "driver-report.mjs"), "utf8")),
    "4j (F-792): lib/driver-report.mjs exports formatResultLine AND resultExitCode — the line and the exit code come from ONE place, because a run that says CRASHED and exits 0 is the same lie twice");

  /* THE OTHER HALF OF F-792: a driver whose summary prints from a `finally` needs a `catch`
     that records the throw, or `crashed` is never set and the wired line prints the frozen
     counters anyway — wiring the helper without the catch looks fixed and is not. */
  const wiredFromFinally = summarisers.filter((f) => {
    const s = readFileSync(path.join(here, f), "utf8");
    return /formatResultLine/.test(s) && /crashed/.test(s);
  });
  const noRecord = wiredFromFinally.filter((f) => !/crashed\s*=\s*e\b/.test(readFileSync(path.join(here, f), "utf8")));
  ok(noRecord.length === 0,
    `4j (F-792): a driver that reads \`crashed\` must also SET it in a catch — ${noRecord.join(", ")} passes crashed to formatResultLine but never assigns it, so the line can only ever print the clean shape`);
}

/* ═══════════════════════════════════════════════════════════════════════════════════
 * ── 4m. F-803 / F-830 / F-849 — ONE HOME FOR WHAT A CREDENTIAL LOOKS LIKE, AND FOR
 * ── WHAT A FIELD IS CALLED ───────────────────────────────────────────────────────
 *
 * There were two, and they disagreed about this app's OWN bearer. `src/test-hook.js`
 * (`SECRET_VALUE_RE` — the dev hook's write refusal AND its read ceiling) knew
 * `gh[pousr]_`, `github_pat_`, `sk-`, `xoxb-` and the dev web-trigger host. This file's
 * `SECRET_VALUE` knew `cgr_` and `ATATT`, added by F-650 after a measured leak, and nobody
 * added them to the door. Measured on the pre-fix pair: `cgr_<48hex>` (src/rules-api.js
 * mints exactly that), `ATATT…`, `glpat-…`, `AKIA…`, `xoxp-…` and a `Bearer <jwt>` all
 * escaped the DOOR, which is the one that stands between a tenant's row and a driver's
 * stdout — the redactor below is only crossed at the FILE boundary.
 *
 * Both now import `src/shared/secret-shapes.js`. These checks hold three properties:
 *   1. PARITY — neither file carries its own alternation any more. The defect is not "a
 *      prefix was missing"; it is "there were two lists", and only this half prevents the
 *      next divergence.
 *   2. CONTROLS — every prefix in the census is CAUGHT, by the redactor and by the door.
 *   3. THE STATED NON-CATCH — a bare 32-hex blob in free text is NOT caught, by either,
 *      and that is deliberate: masking every long opaque string would mask `functions[].code`.
 * ═══════════════════════════════════════════════════════════════════════════════════ */
{
  const shapesUrl = pathToFileURL(path.resolve(here, "../../src/shared/secret-shapes.js")).href;
  const shapes = await import(shapesUrl);
  const hookSrc = readFileSync(path.resolve(here, "../../src/test-hook.js"), "utf8");
  const redactSrc = readFileSync(path.join(libDir, "redact.mjs"), "utf8");

  // ── 1. PARITY ───────────────────────────────────────────────────────────────────
  ok(/from "\.\/shared\/secret-shapes\.js"/.test(hookSrc),
    "4m (F-803): src/test-hook.js imports the shapes from their one home");
  ok(/from "\.\.\/\.\.\/src\/shared\/secret-shapes\.js"/.test(redactSrc),
    "4m (F-803): lib/redact.mjs imports the shapes from the SAME one home");
  /* A private copy is a LITERAL credential prefix inside a regex literal. Comments may name
     a prefix — that is how the reasoning stays readable — so only non-comment source counts. */
  const hookCode = maskComments(hookSrc), redactCode = maskComments(redactSrc);
  const privateCopy = (code) => [...code.matchAll(/\/(?:[^/\\\n[]|\\.|\[(?:[^\]\\]|\\.)*\])+\/[gimsuy]*/g)]
    .map((m) => m[0])
    .filter((lit) => /(cgr_|ghp_|github_pat_|glpat-|ATATT|xox[bp]-|AKIA|sk-\[)/.test(lit));
  ok(privateCopy(hookCode).length === 0,
    `4m (F-803): src/test-hook.js may not carry its own credential-shape regex (found ${privateCopy(hookCode).join(" ")})`);
  ok(privateCopy(redactCode).length === 0,
    `4m (F-803): lib/redact.mjs may not carry its own credential-shape regex (found ${privateCopy(redactCode).join(" ")})`);
  // POSITIVE CONTROL: the scanner can still SEE a private copy — the exact pre-fix line.
  const preFix = 'const SECRET_VALUE = /(sk-[A-Za-z0-9_\\-]{8,}|ghp_[A-Za-z0-9]{16,}|cgr_[0-9a-f]{48,})/g;';
  ok(privateCopy(preFix).length === 1,
    "4m (F-803) POSITIVE CONTROL: the pre-fix `SECRET_VALUE` literal IS seen as a private copy");
  ok(privateCopy("// cgr_ is the app's own bearer — see secret-shapes.js").length === 0,
    "4m (F-803) NEGATIVE CONTROL: a COMMENT naming a prefix is not a private copy");

  /* ── 1b. F-830 — THE SAME PARITY, FOR THE OTHER HALF OF THE QUESTION ────────────
   *
   * F-803 unified what a credential LOOKS like and left what it is CALLED with two owners.
   * `src/test-hook.js` asked `SECRET_FIELD_NAME_HINTS` (`credential`, `privatekey`,
   * `cookie`, `webtrigger`, `webhookurl`, `cognirunnerkey`, `gitconnection`, …);
   * `redact.mjs` asked `SECRET_KEY`/`SECRET_KEY_PART`, which knew NONE of those. MEASURED
   * on the pre-fix file: all four of the names below came back VERBATIM from
   * `redactSecrets` — masked at the door, printed at the file boundary. The hints are one
   * list now, and this gate refuses either file a private copy of it. */
  const HINTS = shapes.SECRET_FIELD_NAME_HINTS;
  ok(Array.isArray(HINTS) && HINTS.length >= 12 && HINTS.every((h) => /^[a-z0-9]+$/.test(h)),
    "4m (F-830): the NAME hints are a flat lowercase-alphanumeric list in the one home — both sides flatten a key before asking");
  ok(/SECRET_FIELD_NAME_HINTS/.test(hookSrc) && /import[\s\S]{0,200}SECRET_FIELD_NAME_HINTS/.test(hookSrc),
    "4m (F-830): src/test-hook.js imports the NAME hints rather than declaring them");
  ok(/import[\s\S]{0,200}SECRET_FIELD_NAME_HINTS[\s\S]{0,200}secret-shapes\.js/.test(redactSrc),
    "4m (F-830): lib/redact.mjs imports the SAME name hints from the SAME one home");
  /* A private NAME list is a regex literal carrying three or more of the hints — enough to
     be a list rather than one rule that happens to mention a word. `isDevUrlKey`'s URL-key
     names and `CREDENTIAL_KEY_FAMILIES`'s KVS key PREFIXES are different questions and
     carry at most one hint each, which is what keeps this gate honest. */
  const nameListCopy = (code) => [...code.matchAll(/\/(?:[^/\\\n[]|\\.|\[(?:[^\]\\]|\\.)*\])+\/[gimsuy]*/g)]
    .map((m) => m[0])
    .filter((lit) => HINTS.filter((h) => lit.toLowerCase().includes(h)).length >= 3);
  ok(nameListCopy(hookCode).length === 0,
    `4m (F-830): src/test-hook.js may not carry its own credential-NAME list (found ${nameListCopy(hookCode).join(" ")})`);
  ok(nameListCopy(redactCode).length === 0,
    `4m (F-830): lib/redact.mjs may not carry its own credential-NAME list (found ${nameListCopy(redactCode).join(" ")})`);
  ok(nameListCopy("const SECRET_KEY = /^(token|apitoken|apikey|secret|password|authorization|bearer)$/i;").length === 1,
    "4m (F-830) POSITIVE CONTROL: the pre-fix `SECRET_KEY` literal IS seen as a private name list");
  ok(nameListCopy("const isDevUrlKey = /^(url|baseurl|href|endpoint|hookurl|webtrigger)$/i;").length === 0,
    "4m (F-830) NEGATIVE CONTROL: a URL-KEY rule that happens to mention one hint is not a second name list");

  /* ── 1c. F-849 — AND THE URL-KEY NAMES, WHICH WERE THE LAST PRIVATE LIST IN THIS FILE ──
   *
   * The NEGATIVE CONTROL directly above is the tell: `isDevUrlKey` was a hand-written
   * alternation of FIELD NAMES sitting one function below a credential-NAME rule that
   * F-830 had already moved to the one home, and it stayed private only because it carries
   * too few credential hints to trip `nameListCopy`. It is the same KIND of question —
   * "what is this field called" — so it is answered from the same module now, and this
   * block is the parity: the list is a flat lowercase-alphanumeric list, `redact.mjs`
   * IMPORTS it, and `redact.mjs` no longer carries a URL-name alternation of its own.
   *
   * The BEHAVIOUR half runs the four spellings the old regex knew plus the two it could
   * not know (`baseURL`, `base-url`), because flattening the key is what the one-home form
   * buys: a name is one entry, not three. And the value test is asserted to still be the
   * other half — a `url` field that is not the dev web trigger comes back whole, which is
   * what keeps this from becoming a rule that eats every URL in an evidence file. */
  const URL_HINTS = shapes.URL_FIELD_NAME_HINTS;
  ok(Array.isArray(URL_HINTS) && URL_HINTS.length >= 6 && URL_HINTS.every((h) => /^[a-z0-9]+$/.test(h)),
    "4m (F-849): the URL-key names are a flat lowercase-alphanumeric list in the one home");
  ok(/import[\s\S]{0,300}URL_FIELD_NAME_HINTS[\s\S]{0,300}secret-shapes\.js/.test(redactSrc),
    "4m (F-849): lib/redact.mjs imports the URL-key names rather than declaring them");
  const urlListCopy = (code) => [...code.matchAll(/\/(?:[^/\\\n[]|\\.|\[(?:[^\]\\]|\\.)*\])+\/[gimsuy]*/g)]
    .map((m) => m[0])
    .filter((lit) => URL_HINTS.filter((h) => lit.toLowerCase().includes(h)).length >= 3);
  ok(urlListCopy(redactCode).length === 0,
    `4m (F-849): lib/redact.mjs may not carry its own URL-NAME list (found ${urlListCopy(redactCode).join(" ")})`);
  ok(urlListCopy("const isDevUrlKey = /^(url|baseurl|base_url|href|endpoint|hookurl)$/i;").length === 1,
    "4m (F-849) POSITIVE CONTROL: the pre-fix `isDevUrlKey` literal IS seen as a private URL-name list");
  const DEV_URL = "https://abc123.atlassian-dev.net/x1/deadbeefcafebabe";
  for (const k of ["url", "baseUrl", "base_url", "hookUrl", "hook_url", "webTriggerUrl", "baseURL", "base-url"])
    ok(redactSecrets({ [k]: DEV_URL })[k] === REDACTED,
      `4m (F-849): a dev web-trigger URL under \`${k}\` is masked by NAME — the last two spellings the private regex could not see`);
  ok(redactSecrets({ url: "https://example.invalid/docs" }).url === "https://example.invalid/docs",
    "4m (F-849): …and the VALUE test is still the other half — an ordinary URL under `url` is not touched");
  // …and the behaviour the parity exists for, at BOTH layers.
  const FOUR = { privateKey: "-----BEGIN RSA PRIVATE KEY-----abcdefgh", cookie: "sessionid=abc123def456",
    credential: "hunter2hunter2hunter2", webhookUrl: "https://example.invalid/y/zz" };
  const atFile = redactSecrets(FOUR);
  for (const k of Object.keys(FOUR))
    ok(atFile[k] === REDACTED,
      `4m (F-830): the FILE boundary now redacts \`${k}\` — it came back verbatim before, while the door had always masked it`);
  const atFileString = redactString(JSON.stringify(FOUR));
  for (const v of Object.values(FOUR))
    ok(!atFileString.includes(v),
      "4m (F-830): …and so does the STRINGIFIED form, whose own retyped name alternation was a THIRD home");
  const { maskSecretFields } = await import(pathToFileURL(path.resolve(here, "../../src/test-hook.js")).href);
  const atDoor = await maskSecretFields(FOUR);
  ok(atDoor && Object.keys(FOUR).every((k) => atDoor.maskedFields.includes(k)),
    "4m (F-830): …and the DOOR still masks all four, which is the side that was already right");
  /* THE COUNTS SURVIVE — F-650's reason for a string-only tier, kept by the plural. */
  const counts = redactSecrets({ maxTokens: 4000, promptTokens: 812, tokens: [1, 2], usage: { tokens: 12 } });
  ok(counts.maxTokens === 4000 && counts.promptTokens === 812 && counts.tokens[0] === 1 && counts.usage.tokens === 12,
    "4m (F-830): a token COUNT is still readable — `maxtokens` ends with `tokens`, not with `token`, so it is never the any-type tier");
  ok(redactSecrets({ tokens: "ghp_abcdefghijklmnopqrstuvwxyz0123456789" }).tokens === REDACTED,
    "4m (F-830): …but the plural holding a STRING is still masked, so the exemption cannot be used to smuggle one");
  for (const [k, v] of [["apiToken", "plain"], ["api_key", "plain"], ["API-KEY", "plain"], ["harnessSecret", "plain"], ["xAuthorization", "plain"]])
    ok(redactSecrets({ [k]: v })[k] === REDACTED,
      `4m (F-830): every spelling of a hinted name is one name — \`${k}\` is flattened before it is asked`);
  ok(redactSecrets({ accessToken: { v: "deep" } }).accessToken === REDACTED,
    "4m (F-830): the any-type tier still swallows a SUBTREE under a credential name — the value's shape is not consulted");
  /* THE QUERY-PARAMETER NAMES, which were a FOURTH list. */
  for (const name of ["token", "cookie", "credential", "privateKey", "bearer", "api_key", "auth", "access_token"])
    ok(redactString(`https://x/y?${name}=plainvalue&z=1`) === `https://x/y?${name}=${REDACTED}&z=1`,
      `4m (F-830): \`?${name}=\` is masked by the SAME name rule, and the parameter name survives so the evidence says which credential was in play`);
  ok(redactString("https://x/y?what=kvs&key=COGNIRUNNER_MEMORY_SETTINGS") === "https://x/y?what=kvs&key=COGNIRUNNER_MEMORY_SETTINGS",
    "4m (F-830): F-663 survives the merge — `key=` is still decided by the VALUE's shape, and a KVS key NAME stays readable");
  ok(redactString(`https://x/y?key=${"a1b2c3d4e5f60718293a4b5c6d7e8f90"}`).includes(REDACTED),
    "4m (F-830): …and a credential-SHAPED `key=` value is still masked");
  ok(redactSecrets({ author: "Mihai", oauthClientId: "public-id-1234" }).author === "Mihai",
    "4m (F-830): `auth` is NOT a shared hint — the door asks the hints with `includes`, and `author` is a Jira field a driver reads");

  // ── 2. CONTROLS, one specimen per declared prefix ───────────────────────────────
  const SPECIMENS = {
    "cgr_":        "cgr_" + "0123456789abcdef".repeat(3),          // 48 hex — this app's Rules-API token
    "ATATT":       "ATATT3xFfGF0abcdefghijklmnop=A1B2C3D4",
    "glpat-":      "glpat-ABCdefGHIjklMNOpqr",
    "AKIA":        "AKIAIOSFODNN7EXAMPLE",
    "xoxp-":       "xoxp-1234567890-abcdefghij",
    "xoxb-":       "xoxb-1234567890-abcdefghij",
    "ghp_":        "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    "gho_":        "gho_abcdefghijklmnopqrstuvwxyz0123456789",
    "github_pat_": "github_pat_11ABCDEFG0abcdefghijklmnop",
    "sk-ant-":     "sk-ant-api03-abcdefghijklmnopqrstuv",
    "Bearer jwt":  "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk",
  };
  const { findSecretFields } = await import(pathToFileURL(path.resolve(here, "../../src/test-hook.js")).href);
  for (const [name, specimen] of Object.entries(SPECIMENS)) {
    const line = `the value is ${specimen} and that is all`;
    const redacted = redactString(line);
    ok(redacted.includes(REDACTED) && !redacted.includes(specimen.replace(/^Bearer /, "")),
      `4m (F-803): the FILE boundary redacts a ${name} credential`);
    // …and the DOOR, which is the half that was missing. `(root)` = the string itself.
    const hits = findSecretFields(line, { maxDepth: 12 });
    /* F-814 split the VALUE why in two — a bare credential is `value-looks-like-a-credential`
       and one inside a sentence is `value-redacted-in-text`. Both mean SEEN; what changed is
       the projection, not the detection. The name-based why is NOT accepted here: this line
       has no field name, so accepting it would make the check green for the wrong reason. */
    ok(hits.length === 1 && ["value-looks-like-a-credential", "value-redacted-in-text"].includes(hits[0].why),
      `4m (F-803): the ?what=kvs read ceiling SEES a ${name} credential in free text (why=${hits[0] && hits[0].why})`);
  }

  // ── 3. THE STATED NON-CATCH ─────────────────────────────────────────────────────
  const BLOB = "a1b2c3d4e5f60718293a4b5c6d7e8f90";   // 32 hex, no prefix, no shape
  ok(redactString(`const k = '${BLOB}';`).includes(BLOB),
    "4m (F-803): a bare 32-hex blob in FREE TEXT is NOT redacted — masking every long opaque string would mask the code");
  ok(findSecretFields({ code: `const k = '${BLOB}';` }, { maxDepth: 12 }).length === 0,
    "4m (F-803): …and the door does not catch it either, which is the residual stated at maskSecretFields");
  /* WHERE redact.mjs DOES catch that blob, stated so the two answers are not confused: as
     the VALUE of a `?key=` query parameter, where F-663 made the discriminator the shape
     rather than the parameter NAME. That is a different question — an already-isolated
     value — and it is unaffected by this cut. */
  ok(looksLikeCredentialValue(BLOB) === true,
    "4m (F-803): `looksLikeCredentialValue` still accepts 20+ chars of pure hex — it is asked only about an isolated ?key= value");
  ok(redactString(`https://x/y?key=${BLOB}`).includes(REDACTED),
    "4m (F-803): …so the same blob IS masked as a query value");
  ok(redactString("https://x/y?key=COGNIRUNNER_MEMORY_SETTINGS").includes("COGNIRUNNER_MEMORY_SETTINGS"),
    "4m (F-803) NEGATIVE CONTROL: a KVS key NAME is still readable (F-663)");

  // The prefix census and the shape census must describe the same list.
  for (const prefix of shapes.CREDENTIAL_PREFIXES) {
    ok(shapes.SECRET_VALUE_SHAPES.some((sh) => sh.startsWith(prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        || new RegExp("^" + sh).test(prefix + "0".repeat(64))),
      `4m (F-803): the prefix \`${prefix}\` is the head of a declared shape, not a fourteenth list`);
  }
}


/* ── 4n. F-814 — THE CREDENTIAL SHAPE MAY NOT EAT ENGLISH, AND FREE TEXT IS
 * ── REDACTED IN PLACE ─────────────────────────────────────────────────────────────
 *
 * `sk-[A-Za-z0-9_\-]{8,}` had no left anchor, so `risk-assessment`, `risk-register` and
 * `risk-mitigation` — the single most common word in a governance validator — matched. That
 * was harmless while the ceiling covered header values; F-802 hung the same rule on the log
 * and registry arms, and from then on a validator's `fieldValue`/`reason` and a rule's
 * `prompt` came back as `{masked:true, why:"value-looks-like-a-credential"}`: an OBJECT where
 * four drivers read a string, and a false CAUSE asserted about a sentence containing no
 * credential.
 *
 * TWO HALVES, and both are needed. The SHAPE gained `(?<![A-Za-z0-9])` — a zero-width
 * lookbehind, never `\b`, because `redact.mjs` must keep matching `…=sk-abcdefgh` and must
 * keep replacing the whole greedy tail. The PROJECTION gained a second answer: a credential
 * INSIDE prose replaces only the token with `<masked:fingerprint>` and records the path with
 * `maskedWhy[path] === "value-redacted-in-text"`; a whole-node mask is now reserved for a
 * FIELD-NAME hit and for a value that IS a bare credential.
 *
 * WHY THE ANCHOR ALONE WOULD NOT HAVE BEEN ENOUGH: a tenant who really does paste a `ghp_…`
 * into a prompt still trips the ceiling, and before this cut that STILL swallowed the prompt.
 * The anchor fixes the false positive; the in-place projection fixes what a true positive
 * costs the reader.
 * ═══════════════════════════════════════════════════════════════════════════════════ */
{
  const shapes = await import(pathToFileURL(path.resolve(here, "../../src/shared/secret-shapes.js")).href);
  const hookUrl = pathToFileURL(path.resolve(here, "../../src/test-hook.js")).href;
  const { findSecretFields, findPlantedSecret, readCeiling } = await import(hookUrl);

  // ── 1. THE PROSE THAT USED TO MATCH ─────────────────────────────────────────────
  for (const word of ["risk-assessment", "risk-register", "risk-mitigation", "disk-usage", "task-force", "brisk-delivery"]) {
    const line = `Please complete the ${word} section before transitioning`;
    ok(shapes.hasCredentialShape(line) === false,
      `4n (F-814): \`${word}\` is English, not a credential — the shape must not match it`);
    ok(findSecretFields(line, { maxDepth: 12 }).length === 0,
      `4n (F-814): …and the DOOR does not claim it saw a credential in \`${word}\``);
    ok(redactString(line) === line,
      `4n (F-814): …and the file boundary leaves \`${word}\` readable`);
  }

  // ── 2. THE ANCHOR IS LEFT-ONLY: every glued form still matches ──────────────────
  const TOKEN = "sk-abc123def456";
  for (const [what, line] of [["bare", TOKEN], ["spaced", `the key is ${TOKEN} ok`], ["quoted", `"${TOKEN}"`],
    ["bearer", `Bearer ${TOKEN}`], ["query", `https://x/y?k=${TOKEN}`], ["underscored", `X_${TOKEN}`],
    ["json", `{"k":"${TOKEN}"}`]]) {
    ok(shapes.hasCredentialShape(line) === true,
      `4n (F-814): a left anchor is not a \`\\b\` — the ${what} form of an sk- token still matches`);
    ok(!redactString(line).includes(TOKEN),
      `4n (F-814): …and the redactor still removes the WHOLE token from the ${what} form`);
  }
  ok(shapes.anchoredShapeSources().filter((sh) => !sh.startsWith("(?<![A-Za-z0-9])")).length === 1,
    "4n (F-814): exactly ONE shape is exempt from the left anchor — the `.atlassian-dev.net/` host, whose left neighbour is an alphanumeric hostname tail");
  ok(shapes.anchoredShapeSources().some((sh) => sh.includes("atlassian-dev") && !sh.startsWith("(?<!")),
    "4n (F-814): …and that exempt shape is the web-trigger host, named rather than inferred");
  ok(redactString("https://abc123.atlassian-dev.net/x1y2").includes(REDACTED),
    "4n (F-814) CONTROL: the unanchored host shape still redacts a dev web-trigger URL");

  // ── 3. THE BREAKER'S EXACT SCENARIO, through the door it came in by ─────────────
  const entry = { ruleId: "r1", fieldValue: "Please complete the risk-assessment section",
    reason: "Blocked: the risk-mitigation plan is missing", result: false };
  const answer = await readCeiling("log_entry:", [entry]);
  ok(typeof answer.value[0].fieldValue === "string" && typeof answer.value[0].reason === "string",
    "4n (F-814): `?what=execlogs` answers a validator's fieldValue and reason as STRINGS — four drivers read them as strings");
  ok(!("maskedFields" in answer),
    "4n (F-814): …and a row with no credential in it says NOTHING about masking (no false cause)");
  const registry = await readCeiling("config_registry", { rules: [{ id: "r1", prompt: "Reject unless the risk-register entry is linked" }] });
  ok(registry.value.rules[0].prompt.includes("risk-register") && !("maskedFields" in registry),
    "4n (F-814): `?what=registry` answers the rule's own prompt plain");

  // ── 4. A REAL TOKEN IN PROSE: the sentence survives, the token does not ─────────
  const GHP = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
  const inText = await readCeiling("log_entry:", [{ reason: `Blocked: the token ${GHP} was pasted into the summary` }]);
  const projected = inText.value[0].reason;
  ok(typeof projected === "string" && !projected.includes(GHP),
    "4n (F-814): the credential is gone from the sentence");
  ok(projected.startsWith("Blocked: the token ") && projected.endsWith(" was pasted into the summary"),
    `4n (F-814): …and the sentence AROUND it is still readable — got ${JSON.stringify(projected)}`);
  ok(/<masked:[0-9a-f]{16}>/.test(projected),
    "4n (F-814): …the token is replaced by the ONE credentialFingerprint (F-780), not a second digest");
  ok(inText.maskedFields[0] === "[0].reason" && inText.maskedWhy["[0].reason"] === "value-redacted-in-text",
    "4n (F-814): …and the PATH is still recorded, with the why that tells a caller it is a string, not a node");

  // ── 5. A BARE CREDENTIAL IS STILL SWALLOWED WHOLE ──────────────────────────────
  const bare = await readCeiling("COGNIRUNNER_AI_PROVIDER", "sk-abcdefghijklmnop");
  ok(bare.value.masked === true && bare.value.why === "value-looks-like-a-credential" && bare.maskedFields[0] === "(root)",
    "4n (F-814): a value that IS a credential and nothing else is replaced WHOLE — there is nothing else in it to read");
  const padded = await readCeiling("COGNIRUNNER_AI_PROVIDER", "  sk-abcdefghijklmnop\n");
  ok(padded.value.masked === true,
    "4n (F-814): …and surrounding whitespace does not turn a bare credential into free text");
  // The WRITE refusal is unchanged in effect: a plant body carrying a credential still refuses.
  ok(findPlantedSecret({ body: `see ${GHP} here` }) !== null,
    "4n (F-814): the write refusal still refuses a plant body carrying a credential in prose");
  ok(findPlantedSecret({ body: "see the risk-assessment here" }) === null,
    "4n (F-814): …and no longer refuses one that merely mentions a risk-assessment");
}


/* ── 4o. F-815 — EVERY CREDENTIAL SHAPE IS LINEAR, AND THE JWT IS A SCANNER ────────
 *
 * `ey[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}` is an unbounded greedy run followed by a
 * REQUIRED literal, which is the textbook quadratic: the engine runs the class to the end
 * of the input and backtracks looking for a `.` that is not there, once per starting
 * position. MEASURED on the shipped shape: 245,760 chars of `"eyAb"` = 15,217 ms for ONE
 * `.test()`. The read ceiling feeds this regex tenant-AUTHORED strings up to the 240 KiB
 * KVS value cap — a step body, a prompt, a skill, a memory — so one authored row burned the
 * whole 55 s web-trigger budget and reported as a dead door rather than a bad row; and
 * `redact.mjs` ran the same shape with `g` + `.replace()`, where it hangs the harness.
 *
 * The JWT is now `findJwtLike`, a hand scanner that walks MAXIMAL TOKEN RUNS: every `ey`
 * inside one run shares that run's end, so "is the next character a `.`" is asked once per
 * run instead of once per `ey`. Two properties are pinned here — the TIME (with a generous
 * ceiling, so a future quadratic shape goes red instead of timing a door out) and the
 * STRUCTURAL rule that produced it: an open-ended quantifier may only sit at the END of a
 * shape. The second is what survives someone rewriting the first.
 * ═══════════════════════════════════════════════════════════════════════════════════ */
{
  const shapes = await import(pathToFileURL(path.resolve(here, "../../src/shared/secret-shapes.js")).href);
  const { findSecretFields } = await import(pathToFileURL(path.resolve(here, "../../src/test-hook.js")).href);

  // ── 1. THE STRUCTURAL RULE, over the census itself ─────────────────────────────
  /* An open-ended quantifier is only safe as the LAST thing in a shape: anything required
     after it is a literal the engine backtracks to. Two of them is the same defect twice, so
     the rule is "at most one, and at the end" rather than "the last one is at the end". */
  const quadratic = (sh) => {
    const n = (sh.match(/\{\d+,\}/g) || []).length;
    return n > 1 || (n === 1 && !/\{\d+,\}$/.test(sh));
  };
  const openEnded = shapes.SECRET_VALUE_SHAPES.filter(quadratic);
  ok(openEnded.length === 0,
    `4o (F-815): an open-ended quantifier may only be the LAST thing in a shape — an unbounded run followed by a required literal is quadratic (offenders: ${openEnded.join(" ")})`);
  ok(quadratic("ey[A-Za-z0-9_\\-]{8,}\\.[A-Za-z0-9_\\-]{8,}(?:\\.[A-Za-z0-9_\\-]+)?"),
    "4o (F-815) POSITIVE CONTROL: the RETIRED jwt shape IS caught by that rule — a filter that matched nothing would be green");
  ok(quadratic("ey[A-Za-z0-9_\\-]{8,}\\.[A-Za-z0-9_\\-]{8,}"),
    "4o (F-815) POSITIVE CONTROL: …including the two-part form, whose LAST quantifier is at the end and whose FIRST one is not");
  ok(!quadratic("sk-[A-Za-z0-9_\\-]{8,}") && !quadratic("\\.atlassian-dev\\.net/"),
    "4o (F-815) NEGATIVE CONTROL: a trailing greedy tail and a bare literal are both linear and must stay allowed");
  ok(!shapes.SECRET_VALUE_SHAPES.some((sh) => sh.startsWith("ey")),
    "4o (F-815): the JWT is not a shape any more — it is `findJwtLike`, and putting it back in the alternation restores the blow-up");

  // ── 2. THE TIME, on the input that measured 15.2 s ─────────────────────────────
  const CAP = 245760;                                   // the 240 KiB KVS value cap, in chars
  const timed = (s) => { const t0 = performance.now(); shapes.findCredentialSpans(s); return performance.now() - t0; };
  const dense = timed("eyAb".repeat(CAP / 4));          // `ey`-dense, dot-free: the reported case
  const anchored = timed("-eyA".repeat(CAP / 4));       // every `ey` left-anchored AND in one token run
  const random = timed(Buffer.from(Array.from({ length: 180 * 1024 }, (_, i) => (i * 2654435761) % 256)).toString("base64").slice(0, CAP));
  const prose = timed("the risk-assessment plan is due and the key is elsewhere ".repeat(4300).slice(0, CAP));
  for (const [what, ms] of [["ey-dense dot-free", dense], ["left-anchored ey run", anchored], ["random base64", random], ["prose", prose]])
    ok(ms < 500,
      `4o (F-815): scanning 240 KiB of ${what} must stay well inside a door's budget — took ${ms.toFixed(1)}ms (the shipped regex took 15,217ms on the first of these)`);

  // ── 3. IT STILL FINDS A JWT — the scanner is not a deletion ────────────────────
  const JWT3 = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const JWT2 = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0";
  for (const [what, jwt] of [["three-part", JWT3], ["header.payload", JWT2]]) {
    const line = `Authorization: Bearer ${jwt} (captured)`;
    const spans = shapes.findJwtLike(line);
    ok(spans.length === 1 && line.slice(spans[0].start, spans[0].end) === jwt,
      `4o (F-815): the scanner spans the WHOLE ${what} JWT, because redact.mjs REPLACES it`);
    ok(!redactString(line).includes(jwt.slice(0, 24)),
      `4o (F-815): …and the file boundary still removes a ${what} JWT`);
    ok(findSecretFields(line, { maxDepth: 12 }).length === 1,
      `4o (F-815): …and the DOOR still sees it`);
  }
  ok(shapes.findJwtLike("monkeyAbcdefgh.abcdefghij").length === 0,
    "4o (F-815): the F-814 left anchor holds in the scanner too — `monkeyAbcdefgh.…` is a word, not a token");
  ok(shapes.findJwtLike("ey_abcdefgh.short").length === 0,
    "4o (F-815): a second part under 8 characters is not a JWT — the scanner describes the same language the shape did");
  ok(shapes.findJwtLike("eyAbcdefghijklmnop").length === 0,
    "4o (F-815): …and neither is a dot-free run, which is the input that used to cost 15 seconds to reject");
  // A JWT next to a prefix token: one span list, leftmost-first, nothing replaced twice.
  const mixed = `key sk-abc123def456 and bearer ${JWT3} end`;
  ok(shapes.findCredentialSpans(mixed).length === 2,
    "4o (F-815): the regex shapes and the scanner are merged into ONE span list, so no caller has to know there are two producers");
  const scrubbed = redactString(mixed);
  ok(!scrubbed.includes("sk-abc123def456") && !scrubbed.includes(JWT3) && scrubbed.startsWith("key ") && scrubbed.endsWith(" end"),
    `4o (F-815): …and both are replaced while the text between them survives — got ${JSON.stringify(scrubbed)}`);
}


/* ── 4p. F-828 — A CAPABILITY URL IS MASKED WHOLE, BECAUSE THE SECRET IS THE PATH ──
 *
 * F-814 taught the read ceiling to rewrite a credential IN PLACE, which is right for every
 * PREFIX shape — the matched span IS the token. `\.atlassian-dev\.net/` is not a prefix
 * shape, it is a FIXED LITERAL, and the secret in a Forge web-trigger URL is the unguessable
 * PATH with the app-identifying subdomain in front of it: neither is inside the span.
 * MEASURED on the pre-fix door — a web-trigger URL inside a mixed row (`functions[].code`,
 * `pf_code:*`, `job:*`, a prompt) came back as
 * `https://abc123def<masked:35af568f67c9cdcc>x1/9f3ab7c1secretpath`. Host and path plain, a
 * `maskedWhy` of `value-redacted-in-text` asserting it had been dealt with, and — because
 * the fingerprint is taken of the MATCHED TEXT, and the matched text is a constant — the
 * same 16 hex characters on every tenant for every trigger.
 *
 * The cut is a SCANNER (`findCapabilityUrlSpans`): a URL read from its scheme to the first
 * whitespace/quote/`<`/`>`/`)`, and if it carries a capability host family the WHOLE URL is
 * the span. `redact.mjs`'s `DEV_URL` — the same rule, the same family, a different width,
 * one layer up — is deleted in its favour, which is the F-803 property applied to the one
 * shape that had escaped it.
 * ═══════════════════════════════════════════════════════════════════════════════════ */
{
  const shapes = await import(pathToFileURL(path.resolve(here, "../../src/shared/secret-shapes.js")).href);
  const { readCeiling, findSecretFields } = await import(pathToFileURL(path.resolve(here, "../../src/test-hook.js")).href);
  const redactSrc = readFileSync(path.join(libDir, "redact.mjs"), "utf8");

  const HOOK = "https://abc123def.atlassian-dev.net/x1/9f3ab7c1secretpath";
  const OTHER = "https://zzz999xyz.atlassian-dev.net/x1/0011223344ffeedd";

  // ── 1. THE BREAKER'S MIXED ROW: no host, no path, no residue ───────────────────
  const row = await readCeiling("pf_code:r1:h1", { functions: [{ code: `await api.fetch("${HOOK}");` }] });
  const code = row.value.functions[0].code;
  ok(typeof code === "string" && code.startsWith('await api.fetch("') && code.endsWith('");'),
    `4p (F-828): the step body around the URL is still readable — got ${JSON.stringify(code)}`);
  for (const residue of ["abc123def", "9f3ab7c1secretpath", "atlassian-dev", "https://"])
    ok(!code.includes(residue),
      `4p (F-828): …and \`${residue}\` is NOT in the answer — the whole URL is the credential, not the literal in the middle of it`);
  ok(/^await api\.fetch\("<masked:[0-9a-f]{16}>"\);$/.test(code),
    `4p (F-828): …the entire URL is ONE <masked:fingerprint> — got ${JSON.stringify(code)}`);

  // ── 2. THE FINGERPRINT IS OF THE URL, NOT OF A CONSTANT LITERAL ────────────────
  const two = await readCeiling("pf_code:r1:h1", { a: `x ${HOOK} y`, b: `x ${OTHER} y` });
  const fp = (s) => /<masked:([0-9a-f]{16})>/.exec(s)[1];
  ok(fp(two.value.a) !== fp(two.value.b),
    "4p (F-828): two DIFFERENT web triggers no longer share one digest — the pre-fix mask hashed the fixed literal, so every trigger everywhere fingerprinted the same");
  const again = await readCeiling("pf_code:r1:h1", { a: `x ${HOOK} y` });
  ok(fp(again.value.a) === fp(two.value.a),
    "4p (F-828): …and the SAME trigger still fingerprints the same, which is what makes the handle worth printing");

  // ── 3. A BARE URL VALUE IS WHOLE-NODE MASKED ───────────────────────────────────
  const bare = await readCeiling("COGNIRUNNER_AI_PROVIDER", HOOK);
  ok(bare.value.masked === true && bare.value.why === "value-looks-like-a-credential",
    "4p (F-828): a value that IS a capability URL trips isBareCredential — there is nothing else in it to read");
  const hits = findSecretFields(HOOK, { maxDepth: 12 });
  ok(hits.length === 1 && hits[0].why === "value-looks-like-a-credential",
    `4p (F-828): …the door says so by the value-shape why, not the in-text one (got ${hits[0] && hits[0].why})`);

  // ── 4. THE FILE BOUNDARY: same width as the deleted DEV_URL, one home ──────────
  ok(!/DEV_URL/.test(maskComments(redactSrc)),
    "4p (F-828): lib/redact.mjs no longer carries its own dev web-trigger regex — the scanner in secret-shapes.js is the one home");
  /* The family is still named ONCE in this file's code, inside `isDevUrlKey` — a different
     rule (it masks a whole value because of its KEY, before the value is ever scanned). What
     may not come back is a second URL MATCHER: a `https?://` run around the family. */
  const redactCode2 = maskComments(redactSrc);
  ok((redactCode2.match(/atlassian-dev/g) || []).length === 1,
    "4p (F-828): the host family is named exactly once in this file's code — the key-name rule `isDevUrlKey`, which is not the same rule");
  ok(!/https\?:\\\/\\\//.test(redactCode2),
    "4p (F-828): …and no URL MATCHER is left here; spanning a URL is the one home's job");
  for (const [what, line] of [["prose", `see ${HOOK} now`], ["quoted", `"${HOOK}"`],
    ["parenthesised", `(${HOOK})`], ["json", `{"url":"${HOOK}"}`], ["angle", `<${HOOK}>`]]) {
    const out = redactString(line);
    ok(out.includes(REDACTED) && !out.includes("9f3ab7c1secretpath") && !out.includes("abc123def"),
      `4p (F-828): the file boundary still removes the WHOLE URL from the ${what} form — got ${JSON.stringify(out)}`);
  }
  ok(redactString(`(${HOOK})`).endsWith(")"),
    "4p (F-828): …and the `)` terminator ends the span rather than eating the bracket — a terminator can only ever end a span sooner");
  ok(redactString(`see ${HOOK} now`) === `see ${REDACTED} now`,
    "4p (F-828): …the text around it is untouched, which is the same answer DEV_URL gave");
  /* The family is matched anywhere in the URL TEXT, not just in the host: that is what
     DEV_URL did, and narrowing the last line before disk is not a trade this move is
     allowed to make. */
  const inPath = "https://evil.example.com/atlassian-dev.net/x1/abc";
  ok(redactString(inPath).includes(REDACTED) && !redactString(inPath).includes("evil.example.com"),
    "4p (F-828): a family in the PATH is still redacted at the file boundary — the move must not narrow it");

  // ── 5. THE SCHEME-LESS FORM, which the scanner cannot see, still has its shape ──
  ok(shapes.hasCredentialShape("host abc123.atlassian-dev.net/x1/tok here") === true,
    "4p (F-828): the `\\.atlassian-dev\\.net/` literal STAYS in the census — the scanner starts at a scheme and a scheme-less mention in prose must still be seen");

  // ── 6. THE FAMILY LIST, named rather than guessed ──────────────────────────────
  ok(shapes.CAPABILITY_URL_HOST_FAMILIES.includes("atlassian-dev.net"),
    "4p (F-828): the Forge dev/staging web-trigger host is a declared capability family");
  ok(!shapes.CAPABILITY_URL_HOST_FAMILIES.some((f) => f.includes("ts.net")),
    "4p (F-828) NEGATIVE CONTROL: `*.ts.net` is NOT one — an LM Studio / MCP remote is an address guarded by a separate bearer, and the bearer is what the shapes catch");
  ok(shapes.findCapabilityUrlSpans("https://example.com/a and http://x.ts.net/b").length === 0,
    "4p (F-828) NEGATIVE CONTROL: …so an ordinary URL is not a credential span, or every evidence file would lose its links");
  const urls = shapes.findUrlSpans("a https://x.example/1 b http://y.example/2) c");
  ok(urls.length === 2 && urls[0].end - urls[0].start === "https://x.example/1".length
      && urls[1].end - urls[1].start === "http://y.example/2".length,
    "4p (F-828): the URL scanner spans both schemes and stops at the terminator, not at the end of the line");

  // ── 7. LINEAR, on the 240 KiB inputs F-815 pinned ──────────────────────────────
  const CAP = 245760;
  const timed = (s) => { const t0 = performance.now(); shapes.findCredentialSpans(s); return performance.now() - t0; };
  const cases = [
    ["http-dense", "http".repeat(CAP / 4)],                                   // every position starts a scheme candidate
    ["scheme-dense", "https://a ".repeat(CAP / 10).slice(0, CAP)],            // 24k real URLs, none of them a capability
    ["one unterminated URL", "https://a.atlassian-dev.net/" + "a".repeat(CAP - 28)],
    ["capability-dense", `${HOOK} `.repeat(Math.ceil(CAP / (HOOK.length + 1))).slice(0, CAP)],
  ];
  for (const [what, s] of cases) {
    const ms = timed(s);
    ok(ms < 500,
      `4p (F-828): the URL scanner stays inside a door's budget on 240 KiB of ${what} — took ${ms.toFixed(1)}ms`);
  }
}


/* ── 4l. F-795 — EVERY RULE LABEL IN THIS FILE NAMES EXACTLY ONE RULE ───────────
 *
 * THE RECURRENCE THIS CLOSES. This file grew to 27 numbered sections, and three numbers had
 * been handed out twice: `4c-ii` was both F-660 (the PII rule covers pixels) and F-668 (the
 * refusal is armed), `4h` was both F-741 (no tenant named in a string) and F-702 (the sweep
 * drain has one home), and `4i` was both F-769 (the credential read ceiling) and F-787 (an
 * evidence file names its commit).
 *
 * WHY THAT IS A DEFECT AND NOT A TIDINESS COMPLAINT. The label is the ONLY handle a failing
 * line gives a reader: a red `4i (F-787): ...` sends someone to a rule about credentials,
 * and prose elsewhere in this file says things like "rule 4g grades the file read-only" —
 * a cross-reference that silently means two different things once the number is reused. The
 * F-number inside the parentheses is what disambiguates today, which is to say the number
 * is decoration and the reader has to know that.
 *
 * WHY IT IS PARSED FROM THE FILE AND NOT FROM A LIST. A hand-kept roster of labels is the
 * same class of artefact as the debt lists above — it goes stale the first time someone adds
 * a section without updating it, and a stale roster is green. The labels are read out of
 * THIS FILE'S OWN SOURCE, so a duplicate is caught by the act of writing it.
 *
 * THE PARSER'S CONTROLS. A regex that stopped matching would make this rule green by finding
 * nothing, so the real headers it must see are named as literals, a synthetic duplicate is
 * fed through the SAME function to prove it detects one, and a prose mention of a rule
 * number is asserted NOT to count as a declaration — otherwise the sentence explaining a
 * collision would itself be read as one.
 * ═══════════════════════════════════════════════════════════════════════════════ */
{
  const selfSrc = readFileSync(path.join(here, "evidence-redaction.test.mjs"), "utf8");

  /** Section headers only: a banner line whose label STARTS WITH A DIGIT and ends in `. `.
      `── F-730 · ...` and `── POSITIVE CONTROLS · ...` are deliberately not declarations. */
  const sectionLabels = (src) =>
    src.split("\n")
      .map((l) => /^(?:\/\*|\s\*) ── (\d[0-9A-Za-z-]*)\. /.exec(l))
      .filter(Boolean)
      .map((m) => m[1]);

  const labels = sectionLabels(selfSrc);
  const dupes = [...new Set(labels.filter((l, i) => labels.indexOf(l) !== i))];

  ok(labels.length > 20,
    `4l (F-795): the section cohort is PARSED, not assumed — ${labels.length} numbered sections found in this file`);
  for (const lit of ["1", "4c-ii", "4c-ii-a", "4c-ii-b", "4h", "4h-2", "4j", "4k", "5"]) {
    ok(labels.includes(lit),
      `4l (F-795) POSITIVE CONTROL: the parser sees the real header "${lit}." — a regex that matched nothing would make this rule green`);
  }
  ok(dupes.length === 0,
    `4l (F-795): a rule number names ONE rule — ${dupes.join(", ")} is used by more than one section, so a red line carrying that number sends the reader to the wrong rule`);

  /* The parser detects a collision when there is one, on the same code path. */
  const synthetic = sectionLabels([
    "/* ── 9z. F-001 — FIRST ────────────────────────────────────────────────────────",
    " * ── 9z. F-002 — SECOND ───────────────────────────────────────────────────────",
  ].join("\n"));
  ok(synthetic.length === 2 && synthetic[0] === "9z" && synthetic[1] === "9z",
    "4l (F-795) POSITIVE CONTROL: the SAME parser reads both banner forms (`/* ──` and ` * ──`) and reports the duplicate label twice");
  ok(sectionLabels(" * is that same single-quoted shape declares `[]`, rule 4g stays green, and it writes").length === 0,
    "4l (F-795) NEGATIVE CONTROL: a prose cross-reference to `rule 4g` is not a declaration — otherwise the sentences that EXPLAIN a collision would create one");

  /* The other half: the label a FAILING LINE prints must also bind to one rule. Assertion
     messages here open with `<label> (F-nnn)`, and that pairing is what a reader greps. */
  /* THE MESSAGE SCAN READS CODE, NOT COMMENTS — and this rule's OWN docblock is why. The
     paragraph above quotes the historical bad label verbatim (`a red 4i (F-787): ... sends
     someone to a rule about credentials`) because naming the collision is how the reason
     survives; a scan that read comments would grade that sentence as a live print site and
     turn the rule red on the text explaining it. `maskComments` keeps string literals — the
     assertion messages ARE string literals — and blanks the prose. The section-label parse
     above deliberately does the opposite: a header IS a comment. */
  const codeOnly = maskComments(selfSrc);
  const byLabel = new Map();
  for (const m of codeOnly.matchAll(/(?<![\w-])(\d[0-9A-Za-z-]*) \(F-(\d+)/g)) {
    if (!byLabel.has(m[1])) byLabel.set(m[1], new Set());
    byLabel.get(m[1]).add(m[2]);
  }
  /* THE NEEDLE IS ASSEMBLED, NOT WRITTEN. Spelling the historical label as a literal inside
     this control's own MESSAGE would put it back into the code-only view and fail the very
     assertion it makes — the scan reads source text, and an assertion message is source. */
  const HISTORIC = "4i " + "(F-787)";
  ok(selfSrc.includes("a red `" + HISTORIC) && !new RegExp("(?<![\\w-])" + HISTORIC.replace(/[()]/g, "\\$&")).test(codeOnly),
    `4l (F-795) POSITIVE CONTROL: the historical ${HISTORIC} quoted in this rule's own docblock is present in the file and ABSENT from the code-only view — the scan cannot be tripped by the sentence that explains it`);
  ok(/4j \(F-796\) POSITIVE CONTROL/.test(codeOnly),
    "4l (F-795) POSITIVE CONTROL: …and a real assertion message SURVIVES the mask, so the code-only view has not simply blanked everything");
  ok(byLabel.size > 0,
    `4l (F-795): the message-label cohort is found, not assumed — ${byLabel.size} labels appear in assertion messages`);
  /* A LABEL MAY CITE MORE THAN ONE FINDING — 4j was cut for F-792 and widened by F-796, and
     its messages name both. What may NOT happen is a message citing a finding its own SECTION
     HEADER does not, because then the header and the red line disagree about what the rule is
     for. The headers are the declaration; the messages must stay inside it. */
  const headerFindings = new Map();
  for (const l of selfSrc.split("\n")) {
    const m = /^(?:\/\*|\s\*) ── (\d[0-9A-Za-z-]*)\. (.*)$/.exec(l);
    if (m) headerFindings.set(m[1], new Set([...m[2].matchAll(/F-(\d+)/g)].map((x) => x[1])));
  }
  const outside = [];
  for (const [lab, fs] of byLabel) {
    const declared = headerFindings.get(lab);
    if (!declared) continue;                       // the undeclared-label assertion below owns this
    for (const f of fs) if (!declared.has(f)) outside.push(`${lab} prints F-${f}, header declares F-${[...declared].join("/F-")}`);
  }
  ok(outside.length === 0,
    `4l (F-795): a failing message may only cite a finding its own section header declares — ${outside.join(", ")}`);
  const undeclared = [...byLabel.keys()].filter((l) => !labels.includes(l));
  ok(undeclared.length === 0,
    `4l (F-795): a message label has a SECTION — ${undeclared.join(", ")} is printed by an assertion but no numbered section declares it, so the red line points at a rule that does not exist`);
}


console.log(`\nevidence-redaction: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
