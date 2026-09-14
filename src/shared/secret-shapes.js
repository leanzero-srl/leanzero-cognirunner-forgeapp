/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/* ═══════════════════════════════════════════════════════════════════════════════════
 * F-803 — ONE ANSWER TO "WHAT DOES A CREDENTIAL LOOK LIKE".
 *
 * There were two, and they disagreed about THIS APP'S OWN BEARER.
 *
 *   · `src/test-hook.js` `SECRET_VALUE_RE` — the dev hook's write refusal
 *     (`findPlantedSecret`) and its read ceiling (`maskSecretFields`). It knew
 *     `gh[pousr]_`, `github_pat_`, `sk-`, `xoxb-` and the dev web-trigger host.
 *   · `test-harness/lib/redact.mjs` `SECRET_VALUE` / `CREDENTIAL_PREFIX` — the last line
 *     before a value reaches a terminal or an evidence file. F-650 added `cgr_` and
 *     `ATATT` to THAT list, after a measured leak, and nobody added them to this one.
 *
 * MEASURED on the two pre-fix regexes: `cgr_<48 hex>` (src/rules-api.js mints it as
 * `cgr_${randomBytes(24).toString("hex")}`), `ATATT…`, `glpat-…`, `AKIA…`, `xoxp-…` and a
 * `Bearer <jwt>` all escaped the DOOR while the FILE BOUNDARY caught several of them. The
 * door that exists to stop this repo's own bearer leaking did not recognise this repo's
 * own bearer, and the only net under it is a redactor a driver that prints to stdout never
 * crosses.
 *
 * So the shapes live here, dependency-free, and both sides IMPORT them. A parity test
 * (`test-harness/scripts/evidence-redaction.test.mjs`) asserts neither file carries its own
 * copy of the alternation, because the recurrence is not "a prefix was missing" — it is
 * "there were two lists".
 *
 * THE UNION IS WIDER THAN EITHER SIDE WAS, NEVER NARROWER. This file is read by a mask and
 * by a refusal: a false positive costs a driver a fingerprint instead of a value, or one
 * rename of a plant body; a false negative costs a tenant a live credential in a committed
 * file. Every disagreement is therefore resolved in favour of MATCHING.
 *
 * WHY THE TAILS ARE GREEDY (`{8,}` rather than a fixed length). `redact.mjs` uses these to
 * REPLACE, not just to test: a pattern that matched only the prefix would leave the rest of
 * the token on the line. `test-hook.js` only ever asks `.test()`, so the tail costs it
 * nothing. One shape, both jobs.
 *
 * EVERY SHAPE MUST BE LINEAR (F-815). A greedy unbounded run FOLLOWED BY A REQUIRED LITERAL
 * is quadratic: the engine extends the run to the end of the input and then backtracks to
 * every position looking for a literal that is not there - once per starting position. The
 * JWT shape was exactly that (`ey...{8,}` then a required `.`), and it is reachable from the
 * dev hook's read ceiling, which feeds it tenant-authored strings up to the 240 KiB KVS
 * value cap: a step body, a prompt, a skill or a memory. MEASURED on the shipped shape:
 * 245,760 chars of `"eyAb"` = 15,217 ms for ONE `.test()`, and the web-trigger's whole
 * budget is 55 s. `redact.mjs` ran the same shape with `g` + `.replace()`, where the
 * blow-up hangs the harness instead.
 *
 * So the JWT is a HAND SCANNER (`findJwtLike`), not a shape, and the rule for every future
 * entry in the census is: an open-ended quantifier may only appear at the END of a shape.
 * `evidence-redaction.test.mjs` asserts that property over the list AND times the
 * pathological input, so the next quadratic shape goes red instead of timing a door out.
 *
 * WHY THERE ARE NO `\b` ANCHORS, AND WHY THERE IS A LEFT ONE ANYWAY (F-814). `redact.mjs`
 * had none, and a `\b` would NARROW the redactor — `…=sk-abcdefgh` must keep matching, and
 * so must `sk-abc…` glued to the end of a longer token, because the tail is what `.replace()`
 * removes. Narrowing the last line before disk is not a trade this file is allowed to make.
 *
 * But an unanchored LEFT side was not a width, it was a false positive: `risk-assessment`,
 * `risk-register` and `risk-mitigation` all contain `sk-` followed by 8+ word characters, so
 * the shape matched ordinary English and the read ceiling (`?what=logs`, `?what=execlogs`,
 * `?what=registry`) then destroyed a validator's `reason` and a rule's `prompt` and asserted
 * `why:"value-looks-like-a-credential"` about a sentence containing no credential.
 *
 * So every PREFIX shape carries `LEFT_ANCHOR` — `(?<![A-Za-z0-9])`, a zero-width lookbehind,
 * NOT `\b`:
 *   · zero-width, so `.replace()` still removes the whole token and nothing else;
 *   · `(?<![A-Za-z0-9])` rather than `(?<!\w)`, so `_`/`-`/`=`/`"`/`:` before the prefix are
 *     still a match — `…=sk-abcdefgh`, `Bearer sk-…`, `"sk-…"`, `X_sk-…` all still redact;
 *   · nothing is added on the RIGHT: the greedy tail stays greedy, which is the property
 *     `redact.mjs` needs.
 * MEASURED: `risk-assessment`, `risk-register`, `risk-mitigation`, `disk-usage` no longer
 * match; every specimen in the F-803 census still does (pinned in `evidence-redaction.test.mjs`).
 *
 * `.atlassian-dev.net/` is the ONE shape with no left anchor, and it must stay that way: the
 * character before it is the alphanumeric tail of a hostname (`…abc123.atlassian-dev.net/`),
 * so a left anchor would turn that shape off entirely.
 *
 * WHY A CAPABILITY URL IS A SCANNER AND NOT A SHAPE (F-828). F-814 made the read ceiling
 * rewrite a credential IN PLACE — it replaces the matched SPAN and keeps the text around it.
 * That is correct for every PREFIX shape, where the span IS the token, and it was WRONG for
 * `\.atlassian-dev\.net/`, which is a FIXED LITERAL: the secret in a Forge web-trigger URL is
 * the unguessable PATH, and the subdomain identifies the app, and neither is inside the span.
 * MEASURED on the pre-fix door — a web-trigger URL inside a mixed row (`functions[].code`,
 * `pf_code:*`, `job:*`, a prompt) came back as
 * `https://abc123def<masked:35af568f67c9cdcc>x1/9f3ab7c1secretpath`: host and path in plain
 * text, `maskedWhy:"value-redacted-in-text"` asserting it had been handled, and a fingerprint
 * that is the SAME 16 hex characters for every tenant because it is the digest of the literal.
 *
 * So the URL families are `findCapabilityUrlSpans` — read a URL from `https://`/`http://` to
 * the first whitespace, quote, `<`, `>` or `)`, and if it carries a capability host family the
 * WHOLE URL is the credential span. The in-place rewrite then removes the entire URL, the
 * fingerprint is of the URL (so two different triggers no longer share one digest), and a bare
 * URL value trips `isBareCredential` and is replaced whole. The literal shape STAYS in the
 * census below: the scanner only starts at a scheme, and a scheme-less `abc.atlassian-dev.net/x1/…`
 * in prose must still be seen.
 *
 * `test-harness/lib/redact.mjs` no longer carries `DEV_URL`. It was the same rule with the same
 * width and a different owner — the F-803 defect one layer up — and the scanner subsumes it:
 * the family is matched anywhere in the URL TEXT, not just in the host, precisely so the file
 * boundary is not NARROWED by the move (a family that appears in a path was redacted before and
 * still is). The terminator set gains `)`, which only ever ends the span EARLIER.
 *
 * WHAT IS DELIBERATELY NOT A SHAPE — a bare hex or base64 blob. `maskSecretFields` walks
 * `functions[].code` and `agent.instructions`, and a rule that masked every long opaque
 * string would mask the code, which is the thing a driver reads those rows for. The
 * residual is stated at `maskSecretFields` and pinned by its own check. NOTE what
 * `redact.mjs` does and does not do with such a blob: `looksLikeCredentialValue` DOES
 * accept 20+ characters of pure hex/base64, but it is asked ONLY about the VALUE of a
 * `?key=` query parameter (F-663) — never about free text — so a 32-hex blob in prose is
 * not redacted there either. The two files agree, and they agree for a reason.
 * ═══════════════════════════════════════════════════════════════════════════════════ */

/**
 * Credential VALUE shapes, as regex source fragments. Order is leftmost-first for a
 * `.replace()` caller, so the more specific literal comes before the family that could
 * swallow a shorter part of it.
 *
 * Each entry names where the shape came from, because a shape nobody can source is a shape
 * nobody can retire.
 */
export const SECRET_VALUE_SHAPES = [
  "cgr_[0-9a-f]{48,}",                    // THIS APP: src/rules-api.js, `cgr_` + randomBytes(24).toString("hex").
                                          // 48, not 16: a mint answer also carries `row.prefix` (`cgr_`+6 hex),
                                          // the non-secret HANDLE the UI lists tokens by (F-650).
  "github_pat_[A-Za-z0-9_]{8,}",          // GitHub fine-grained PAT
  "gh[pousr]_[A-Za-z0-9]{8,}",            // GitHub classic PAT / OAuth / user / server / refresh
  "glpat-[A-Za-z0-9_\\-]{8,}",            // GitLab personal access token
  "sk-[A-Za-z0-9_\\-]{8,}",               // OpenAI / Anthropic (`sk-ant-…`) / OpenRouter
  "ATATT[A-Za-z0-9_\\-+=/]{8,}",          // Atlassian API token
  "xox[bpasre]-[A-Za-z0-9-]{8,}",         // Slack bot/user/app/… tokens — `xoxp-` was missing from BOTH lists
  "AKIA[0-9A-Z]{12,}",                    // AWS access key id
  // A JWT - `Bearer <jwt>` - is NOT a regex shape. It is `findJwtLike` below, a hand
  // scanner, because as a regex it was QUADRATIC (F-815). See the rule above the scanner.
  "\\.atlassian-dev\\.net/",              // a Forge dev web-trigger URL: bearer-less, and itself a capability
];

const LEFT_ANCHOR = "(?<![A-Za-z0-9])";

/**
 * The ONE shape that must NOT be left-anchored — see the header. Listed by its exact source
 * so a shape added to the census is anchored by default and an exemption has to be written
 * down on purpose.
 */
const NO_LEFT_ANCHOR = new Set(["\\.atlassian-dev\\.net/"]);

/**
 * The census as it is actually MATCHED: every prefix shape with `LEFT_ANCHOR` in front.
 * `SECRET_VALUE_SHAPES` stays the bare census — it is what the parity test reads to check
 * that every declared prefix is the head of a declared shape — and this is the derived
 * form. Two views, one list.
 */
export const anchoredShapeSources = () => SECRET_VALUE_SHAPES.map((sh) => (NO_LEFT_ANCHOR.has(sh) ? sh : LEFT_ANCHOR + sh));

/**
 * Build the value regex. A FACTORY, never a shared instance: a `g` regex carries
 * `lastIndex` between calls, so two callers sharing one object answer differently
 * depending on who asked last. `redact.mjs` wants `g`, `test-hook.js` wants none.
 */
export const credentialValueRegex = (flags = "") => new RegExp("(" + anchoredShapeSources().join("|") + ")", flags);

/* ═══════════════════════════════════════════════════════════════════════════════════
 * F-815 — THE JWT IS SCANNED, NOT MATCHED.
 *
 * `ey[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}` is quadratic on dot-free input, and the door
 * that calls it reads tenant-authored rows. The scanner below answers the SAME question in
 * one left-to-right pass, and it stays linear by walking MAXIMAL TOKEN RUNS rather than
 * candidate start positions: every `ey` inside one run shares that run's END, so the
 * "is the next character a `.`" question is asked ONCE PER RUN, not once per `ey`.
 *
 * What counts as a JWT here — deliberately the same language the old shape described:
 *   · `ey` with a non-alphanumeric character (or the start of the string) before it — the
 *     F-814 left anchor, so `keyAbcdefgh.something` is not a token;
 *   · at least 8 more base64url characters (`A-Za-z0-9_-`) before the run ends;
 *   · a `.` IMMEDIATELY after that run, then a second run of at least 8;
 *   · optionally a second `.` and a third run of at least 1 (the signature).
 * The span returned is the WHOLE thing, because `redact.mjs` replaces it, and the leftmost
 * `ey` in a run wins, which is what the regex did.
 * ═══════════════════════════════════════════════════════════════════════════════════ */
const isTokenChar = (c) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 45;
const isAlnum = (c) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);

/** Every JWT-shaped span in `s`, leftmost-first. One pass, no backtracking. */
export const findJwtLike = (s) => {
  if (typeof s !== "string" || s.length < 19) return [];
  const out = [];
  const n = s.length;
  const runEndFrom = (from) => { let j = from; while (j < n && isTokenChar(s.charCodeAt(j))) j++; return j; };
  let i = 0;
  while (i < n) {
    if (!isTokenChar(s.charCodeAt(i))) { i++; continue; }
    const runStart = i, runEnd = runEndFrom(i);
    // The cheap rejection FIRST, once per run: with no `.` after it, no candidate inside
    // this run can start a JWT, whatever it looks like. This is the line that makes the
    // scanner linear where the regex was quadratic.
    if (s[runEnd] !== ".") { i = runEnd; continue; }
    let start = -1;
    for (let p = runStart; p + 10 <= runEnd; p++) {
      if (s.charCodeAt(p) !== 101 /* e */ || s.charCodeAt(p + 1) !== 121 /* y */) continue;
      if (p > 0 && isAlnum(s.charCodeAt(p - 1))) continue;      // F-814: the left anchor
      start = p; break;
    }
    if (start < 0) { i = runEnd; continue; }
    const secondStart = runEnd + 1, secondEnd = runEndFrom(secondStart);
    if (secondEnd - secondStart < 8) { i = runEnd; continue; }
    let end = secondEnd;
    if (s[secondEnd] === ".") {
      const thirdEnd = runEndFrom(secondEnd + 1);
      if (thirdEnd > secondEnd + 1) end = thirdEnd;
    }
    out.push({ start, end });
    i = end;
  }
  return out;
};

/* ═══════════════════════════════════════════════════════════════════════════════════
 * F-828 — A CAPABILITY URL IS SCANNED WHOLE, BECAUSE THE SECRET IS THE PATH.
 *
 * The host families whose URLs are THEMSELVES a credential — no bearer, the unguessable
 * path token IS the authentication. `atlassian-dev.net` is the Forge dev/staging
 * web-trigger host: `hookUrlFor(env)` in `test-harness/lib/shared-env-guard.mjs` reads
 * those URLs out of `.env` (`TESTSTATE_URL` / `STAGING_TESTSTATE_URL`) and they are the
 * only host family this repo treats that way — `redact.mjs`'s `DEV_URL` and `isDevUrlKey`
 * named the same one, which is why this list has exactly one entry rather than a guess at
 * more. `*.ts.net` (LM Studio / the MCP remotes) is deliberately NOT here: those are
 * addresses guarded by a SEPARATE bearer, and the bearer is what the shapes above catch.
 *
 * A family is matched against the whole URL TEXT, not just the host. That is wider than
 * "the host ends in the family", and it is wider ON PURPOSE: `redact.mjs` matched the
 * family anywhere in the URL before this cut, and the F-803 header forbids this file
 * narrowing the last line before disk in order to tidy a rule up.
 * ═══════════════════════════════════════════════════════════════════════════════════ */
export const CAPABILITY_URL_HOST_FAMILIES = ["atlassian-dev.net"];

/* A URL ends at the first character that cannot be in one: whitespace, a quote, `<`, `>`
   or `)`. Same class `redact.mjs`'s `DEV_URL` used, plus `)` so a URL in parentheses or in
   a markdown link does not swallow the bracket — a terminator can only ever END the span
   sooner, never leave more of it readable. */
const isUrlTerminator = (c) => c === 32 || (c >= 9 && c <= 13) || c === 34 || c === 39 || c === 60 || c === 62 || c === 41;

/**
 * Every `http://` / `https://` URL span in `s`, leftmost-first. One left-to-right pass:
 * `indexOf` never rescans, and the cursor only moves forward, so this is linear in `s`
 * — the F-815 rule applies to a scanner exactly as it applies to a shape.
 */
export const findUrlSpans = (s) => {
  if (typeof s !== "string" || s.length < 8) return [];
  const lower = s.toLowerCase();
  const n = s.length;
  const out = [];
  let i = 0;
  while (i < n) {
    const h = lower.indexOf("http", i);
    if (h < 0) break;
    const schemeLen = lower.startsWith("https://", h) ? 8 : lower.startsWith("http://", h) ? 7 : 0;
    if (schemeLen === 0) { i = h + 4; continue; }
    let j = h + schemeLen;
    while (j < n && !isUrlTerminator(s.charCodeAt(j))) j++;
    if (j > h + schemeLen) out.push({ start: h, end: j });
    i = Math.max(j, h + schemeLen);
  }
  return out;
};

/** The URL spans that are themselves a credential — see the header above. */
export const findCapabilityUrlSpans = (s) => {
  if (typeof s !== "string" || s === "") return [];
  const lower = s.toLowerCase();
  return findUrlSpans(s).filter(({ start, end }) => {
    const url = lower.slice(start, end);
    return CAPABILITY_URL_HOST_FAMILIES.some((f) => url.includes(f));
  });
};

/**
 * EVERY credential-shaped SPAN in a string, `[{start, end}]`, leftmost-first and
 * non-overlapping.
 *
 * This exists because two callers need the POSITIONS, not just a yes/no: `redact.mjs`
 * replaces each span with `[REDACTED]`, and the read ceiling (F-814) replaces each span
 * inside a free-text field with `<masked:…>` instead of destroying the whole sentence.
 * One scanner, so a shape can never be redacted by one of them and missed by the other.
 */
export const findCredentialSpans = (s) => {
  if (typeof s !== "string" || s === "") return [];
  const re = credentialValueRegex("g");
  const spans = [];
  let m;
  while ((m = re.exec(s)) !== null) {
    if (m[0] === "") { re.lastIndex++; continue; }
    spans.push({ start: m.index, end: m.index + m[0].length });
  }
  // The JWT is not in the alternation (F-815) — it is the scanner above. Merged HERE so no
  // caller has to know there are two producers: one span list, leftmost-first, with an
  // overlap absorbed into the span that started first rather than replaced twice.
  for (const j of findJwtLike(s)) spans.push(j);
  /* F-828 — and a capability URL is a THIRD producer, merged in the same place and for the
     same reason. It always starts at or before the `.atlassian-dev.net/` literal inside it,
     so the merge below absorbs that literal into the whole-URL span rather than masking the
     middle of the URL and leaving the host and the path token in plain text. */
  for (const u of findCapabilityUrlSpans(s)) spans.push(u);
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  for (const sp of spans) {
    const last = out[out.length - 1];
    if (last && sp.start < last.end) { if (sp.end > last.end) last.end = sp.end; continue; }
    out.push({ ...sp });
  }
  return out;
};

/** Replace every credential span with `fn(matchedText)`. The text between spans is untouched. */
export const replaceCredentialSpans = (s, fn) => {
  const spans = findCredentialSpans(s);
  if (spans.length === 0) return s;
  let out = "", at = 0;
  for (const { start, end } of spans) { out += s.slice(at, start) + fn(s.slice(start, end)); at = end; }
  return out + s.slice(at);
};

/** Does the string carry a credential shape anywhere? The `.test()` half of the same scanner. */
export const hasCredentialShape = (s) => findCredentialSpans(s).length > 0;

/**
 * The literal PREFIXES of the shapes above, for a caller that must decide whether an
 * already-isolated value (a `?key=` query parameter) is a credential rather than scan text
 * for one. Derived by hand from the same census and kept in the same order; the parity test
 * asserts every prefix here is also the head of a shape above.
 */
export const CREDENTIAL_PREFIXES = ["cgr_", "github_pat_", "ghp_", "gho_", "ghu_", "ghs_", "ghr_", "glpat-", "sk-", "ATATT", "xoxb-", "xoxp-", "xoxa-", "xoxs-", "xoxr-", "xoxe-", "AKIA"];

/** `^`-anchored form of the prefixes, for `looksLikeCredentialValue`-style checks. */
export const credentialPrefixRegex = () => new RegExp("^(?:" + CREDENTIAL_PREFIXES.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")");

/**
 * FIELD NAMES that make a value a credential whatever it looks like. The read ceiling and
 * the write refusal both walk objects and ask this of every key; `redact.mjs` asks a
 * narrower, anchored version of the same question about evidence keys.
 *
 * `key` alone is NOT here and must not be: it is a legitimate harness word (a KVS key), and
 * F-663 records what happened the last time a rule confused the two.
 */
export const SECRET_FIELD_NAME_HINTS = [
  "token", "secret", "password", "credential", "apikey", "privatekey", "bearer",
  "authorization", "cookie", "webtrigger", "webhookurl", "cognirunnerkey", "gitconnection",
];

/**
 * F-849 — FIELD NAMES THAT MAKE A VALUE A URL, beside the names that make it a credential,
 * because they are the same KIND of question and the harness kept its own answer.
 *
 * `isDevUrlKey` in `test-harness/lib/redact.mjs` masks a whole value because of its KEY —
 * the name half of that file's contract — and it did it from a hand-written alternation
 * (`url|baseurl|base_url|href|endpoint|hookurl|hook_url|webtrigger|webtriggerurl`). That is
 * the second home this module exists to remove: a repo that starts writing `callbackUrl` or
 * `requestUrl` teaches one list and not the other, and the list that does not learn is the
 * one standing between a capability URL and a committed evidence file.
 *
 * FLAT, like `SECRET_FIELD_NAME_HINTS`, and asked the same way: the caller lowercases the
 * key and strips non-alphanumerics before looking it up, so `base_url`, `baseURL` and
 * `base-url` are one entry and cannot be spelled differently on the two sides. Unlike the
 * secret hints this is an EXACT list, not a substring rule: a URL key is masked whole, and
 * `substring` semantics would claim every field whose name merely ends in `url`, including
 * ones that carry prose.
 *
 * Naming a value a URL is not by itself a reason to mask it — `isDevUrlKey` also requires
 * the value to look like the dev web trigger. This list answers only "is this field a URL".
 */
export const URL_FIELD_NAME_HINTS = [
  "url", "baseurl", "href", "endpoint", "hookurl", "webtrigger", "webtriggerurl",
];
