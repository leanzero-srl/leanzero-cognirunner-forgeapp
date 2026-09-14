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
  "ey[A-Za-z0-9_\\-]{8,}\\.[A-Za-z0-9_\\-]{8,}(?:\\.[A-Za-z0-9_\\-]+)?", // a JWT, which is how `Bearer <jwt>` arrives
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
  const out = [];
  let m;
  while ((m = re.exec(s)) !== null) {
    if (m[0] === "") { re.lastIndex++; continue; }
    out.push({ start: m.index, end: m.index + m[0].length });
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
