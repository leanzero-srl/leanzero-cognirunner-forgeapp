/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * F-242 — THE PERMISSION CONTRACT IS A FLAG, NOT A SENTENCE.
 *
 * A source scan, not a browser test, because the defect it guards is invisible at runtime:
 * a frontend that detects refusals by regexing the backend's English still WORKS, right up
 * until someone rewords a sentence in src/index.js and every refusal silently turns back
 * into a "Couldn't load X." with a Retry button. Nothing fails, nothing logs, and the only
 * symptom is a user being told a lie. That is precisely the class of bug a journey test
 * cannot catch — it passes against both the correct and the broken build, because the
 * fixture and the app agree on a string that the real backend has since changed.
 *
 * So we assert the RULE instead: no frontend source may match on refusal prose. The one
 * legitimate way to ask "was I refused" is `isPermissionRefusal(result)`, which reads
 * `reason === "no-permission"` — set by permissionDenied() in src/index.js.
 *
 * Also checks the duplication convention for the helper itself (config-ui ↔ admin-panel
 * byte-identical; config-view carries its own copy) — a shared helper that has drifted is
 * how "one home" quietly becomes three.
 *
 * Run: node refusal-contract.test.mjs
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const STATIC = join(HERE, "..");
const ROOT = join(STATIC, "..");

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log("  ✓ " + msg); } else { fail++; console.log("  ✗ " + msg); } };

/** Every .js/.jsx under the FOUR apps' src/, excluding build output.
    1.4 commit 9b added issue-glance to this list: the Coder panel is the first surface in
    that app that can be refused, so it carries a refusal.js of its own and must therefore
    be inside every scan below - the prose-matching scan, the flag-reader count and the
    code-identity comparison. An app with a copy of the helper that no test looks at is the
    "one home quietly becomes four" shape this file exists to prevent. */
function sources() {
  const out = [];
  for (const app of ["config-ui", "config-view", "admin-panel", "issue-glance"]) {
    const base = join(STATIC, app, "src");
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (/\.(js|jsx)$/.test(name)) out.push(full);
      }
    };
    try { walk(base); } catch { /* app missing — other tests will say so */ }
  }
  return out;
}

/**
 * Blank out comments so the scan sees CODE only.
 *
 * This is not a nicety. Several of the files below now quote the deleted regex verbatim in a
 * comment, because "here is the contract we used to have and why it was wrong" is the single
 * most useful thing those comments can say — and a line-prefix check (`startsWith("//")`)
 * cannot see that a line sits inside a /* ... *\/ block, so the first version of this test
 * failed on its own documentation. A scanner that cannot tell code from commentary either
 * produces false alarms (and gets deleted) or gets loosened until it catches nothing.
 *
 * Deliberately crude — no string/regex-literal awareness — because it only ever needs to
 * make the file SAFE to grep, and blanking a comment can never hide a live call.
 */
function stripComments(src) {
  let out = "", i = 0, n = src.length;
  while (i < n) {
    if (src[i] === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      // Keep newlines so line numbers and the line-by-line loop stay aligned.
      out += src.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
    } else if (src[i] === "/" && src[i + 1] === "/") {
      const end = src.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      out += " ".repeat(stop - i);
      i = stop;
    } else {
      out += src[i++];
    }
  }
  return out;
}

/* The prose a frontend must never match on. These are the shapes the backend's refusals
   actually take (noPerm / requireRole / requireAdmin literals, src/index.js), i.e. exactly
   what a well-meaning developer would reach for when they need to spot a refusal and do not
   know the flag exists. */
const PROSE_PATTERNS = [
  { re: /\/[^\n]*do\(\?:n\[|\/[^\n]*don['’\\]*t[^\n]*have permission[^\n]*\//i, what: `a regex over "don't have permission"` },
  { re: /\/[^\n]*have permission[^\n]*\/[gimsuy]*\.test/i, what: `a .test() over "have permission"` },
  { re: /\/[^\n]*[Aa]ccess required[^\n]*\/[gimsuy]*\.test/i, what: `a .test() over "access required"` },
  { re: /\.(?:error|message)[^\n]{0,40}\.includes\(\s*["'][^"']*permission/i, what: `an .includes() over a permission sentence` },
  { re: /\.(?:error|message)[^\n]{0,40}\.includes\(\s*["'][^"']*[Aa]ccess required/i, what: `an .includes() over "access required"` },
];

console.log("F-242 refusal contract — frontends branch on reason, never on prose");
{
  const offenders = [];
  for (const file of sources()) {
    // Comments are allowed to QUOTE the dead regex — several now do, deliberately, to
    // record what was removed and why. Only live code counts.
    const text = stripComments(readFileSync(file, "utf8"));
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      for (const p of PROSE_PATTERNS) {
        if (p.re.test(line)) offenders.push(`${relative(ROOT, file)}: ${p.what} — ${t.slice(0, 120)}`);
      }
    }
  }
  ok(offenders.length === 0,
    offenders.length === 0
      ? "no frontend source detects a permission refusal by matching its sentence"
      : `${offenders.length} prose-matched refusal(s):\n      ` + offenders.join("\n      "));
}

console.log("F-242 the flag itself is the one that IS read");
{
  const readers = sources().filter((f) => /reason\s*===\s*["']no-permission["']/.test(stripComments(readFileSync(f, "utf8"))));
  /* Exactly the helper homes: config-ui + admin-panel components/refusal.js (the
     byte-identical pair), config-view's copy, and issue-glance's copy (1.4 commit 9b). */
  ok(readers.length === 4,
    `the "no-permission" literal lives in exactly 4 files (the helper homes) — found ${readers.length}: ${readers.map((f) => relative(ROOT, f)).join(", ")}`);
  ok(readers.every((f) => /refusal\.js$/.test(f)),
    "every file that reads the flag IS a refusal.js helper — no call site re-implements the test");
}

console.log("F-242 the helper obeys the duplication convention");
{
  const cu = join(STATIC, "config-ui/src/components/refusal.js");
  const ap = join(STATIC, "admin-panel/src/components/refusal.js");
  const cv = join(STATIC, "config-view/src/refusal.js");
  const ig = join(STATIC, "issue-glance/src/refusal.js");
  const a = readFileSync(cu, "utf8"), b = readFileSync(ap, "utf8"), c = readFileSync(cv, "utf8"), d = readFileSync(ig, "utf8");
  ok(a === b, "config-ui and admin-panel copies of refusal.js are byte-identical");
  /* config-view's copy carries its own, shorter docblock by design — it is a different app
     with a different reason to exist, and forcing the two to share prose would be a rule
     about paragraphs rather than about behaviour. What must NOT drift is the code: same flag,
     same sentence builder, same fallbacks. So the comparison strips comments first. */
  /* F-273 — and it normalises the DEPTH of the src/shared import, because config-view's
     copy sits one directory higher than the components/ pair, so the same module is reached
     by "../../../" there and "../../../../" here. That is a filesystem fact, not drift.
     Only the leading ../ run is collapsed — the module PATH, the imported names and every
     other character still have to match, so importing a different module, or a different
     symbol from it, still fails this assertion. */
  const body = (src) => stripComments(src)
    .replace(/(?:\.\.\/)+src\/shared\//g, "«shared»/")
    .replace(/\s+/g, " ").trim();
  ok(body(a).includes('reason === "no-permission"') && body(c).includes('reason === "no-permission"'),
    "config-view's copy tests the same flag");
  ok(body(a) === body(c), "config-view's copy is code-identical to the shared pair (comments aside)");
  /* 1.4 commit 9b - issue-glance's copy. It was taken BYTE-for-byte from config-view's,
     because both sit at src/refusal.js (the same import depth) and neither app has a
     components/ directory to share with the pair. Asserting the BYTES as well as the
     normalised code says which file to copy when this one needs a change, and makes a
     "small tweak" to one of the two impossible to land quietly. */
  ok(d === c, "issue-glance's copy is byte-identical to config-view's (the file it was taken from)");
  ok(body(a) === body(d), "issue-glance's copy is code-identical to the shared pair (comments aside)");
}

/* F-436 — THE SECOND HELPER OF THE SAME KIND. capability.js turns one getAgentCapability
   read into {loading|unknown|verdict} + retry, so that a transport failure stops being
   stored as an OFF verdict. It lives beside refusal.js in all three apps that ask the
   question — components/ in the pair, src/ in issue-glance — and is gated here for the same
   reason refusal.js is: a helper whose copies drift is how "one home" becomes three. The
   files import only React, so there is no import-depth difference to normalise and the
   comparison is BYTES. */
console.log("F-436 the capability helper obeys the duplication convention");
{
  const homes = [
    join(STATIC, "config-ui/src/components/capability.js"),
    join(STATIC, "admin-panel/src/components/capability.js"),
    join(STATIC, "issue-glance/src/capability.js"),
  ];
  const bodies = homes.map((p) => readFileSync(p, "utf8"));
  ok(bodies.every((b) => b === bodies[0]),
    `all ${homes.length} copies of capability.js are byte-identical (${homes.map((p) => relative(ROOT, p)).join(", ")})`);

  /* The WORDING is the other half of the finding: the refusal on an unanswered read must
     say the read failed, and must never assert the Coder is off. Asserted on the constant,
     not on a rendered sentence, so a surface that re-words it locally fails the scan below
     rather than shipping a second vocabulary. */
  const { CAPABILITY_UNKNOWN_TITLE, CAPABILITY_UNKNOWN_TEXT, capabilityAnswer, CAPABILITY_RETRY_DELAYS_MS } =
    await import("../config-ui/src/components/capability.js");
  ok(CAPABILITY_UNKNOWN_TITLE === "Could not check whether the Coder is available",
    "F-436 the unknown headline is about the CHECK, not about the Coder");
  ok(!/is off|turned off|not available on this/i.test(CAPABILITY_UNKNOWN_TITLE + " " + CAPABILITY_UNKNOWN_TEXT),
    "F-436 the unknown copy never claims the Coder is off");
  ok(CAPABILITY_RETRY_DELAYS_MS.join(",") === "2000,4000,8000",
    "F-436 the retry ladder is 2 s / 4 s / 8 s");

  // The classification: an answer is an answer even when it is a no; transport is not.
  ok(capabilityAnswer({ success: true, enabled: false, reason: "needs-coder-edition" }) !== null,
    "F-436 an enabled:false VERDICT is an answer (it is not retried)");
  ok(capabilityAnswer({ success: false, reason: "no-permission", error: "x" }) !== null,
    "F-436 a permission refusal is an answer (it is not retried)");
  ok(capabilityAnswer(undefined) === null && capabilityAnswer(null) === null,
    "F-436 a missing body is transport");
  ok(capabilityAnswer({}) === null, "F-436 a body with no success field is transport");
}

/* F-572 — THE THIRD HELPER OF THE SAME KIND. FieldGuideChip.jsx names the baked field-guide
   sections a record was generated with, and its whole reason for being one FILE is the rule
   that a section id the index cannot name is DROPPED rather than printed — a raw id like
   `forge-app-builder/forge-app-builder/9c1f/core-forge-concepts-3` leaking into the UI is
   exactly what a copy that forked would do. It has FOUR homes: components/ in config-ui,
   admin-panel and issue-glance, and — since F-572 — config-view, which is the READ-ONLY
   review surface and the one place a reviewer reads provenance after the fact. All four sit
   at the same import depth, so the comparison is BYTES. */
console.log("F-572 the field-guide chip obeys the duplication convention across FOUR homes");
{
  const homes = [
    join(STATIC, "config-ui/src/components/FieldGuideChip.jsx"),
    join(STATIC, "admin-panel/src/components/FieldGuideChip.jsx"),
    join(STATIC, "issue-glance/src/components/FieldGuideChip.jsx"),
    join(STATIC, "config-view/src/components/FieldGuideChip.jsx"),
  ];
  ok(homes.every((p) => existsSync(p)),
    `all ${homes.length} homes of FieldGuideChip.jsx exist (${homes.map((p) => relative(ROOT, p)).join(", ")})`);
  const bodies = homes.filter((p) => existsSync(p)).map((p) => readFileSync(p, "utf8"));
  ok(bodies.length === homes.length && bodies.every((b) => b === bodies[0]),
    `all ${homes.length} copies of FieldGuideChip.jsx are byte-identical`);

  /* The rule the shared file carries, asserted on the SOURCE rather than on a rendered chip,
     so a copy that grew an id fallback fails here instead of in a tenant's rule view. */
  ok(/titleFor\(id\)/.test(bodies[0]) && !/\|\|\s*id\b/.test(bodies[0]),
    "F-572 the chip resolves a title and never falls back to printing the raw section id");
}

/* F-555 — THE PROVIDER-READINESS PREDICATE, pinned here rather than only in a browser
   journey. The defect was that a surface derived readiness from ONE field of getOpenAIKey
   (`hasKey !== false`), which is wrong for every engine whose credential is not a KVS slot.
   Each case below is a real arm of src/index.js's getOpenAIKey, so a backend change that
   adds a vendor-billed engine without `noKeyNeeded` fails here instead of in a tenant's
   editor. */
console.log("F-555 provider readiness is one predicate over noKeyNeeded + hasKey");
{
  const { providerReady } = await import("../config-ui/src/components/capability.js");

  // The finding itself: the managed arm reports no key AND no key needed.
  ok(providerReady({ success: true, provider: "managed", hasKey: false, isByok: false, managed: true, noKeyNeeded: true }) === true,
    "F-555 the managed engine (hasKey:false + noKeyNeeded) is READY — no key warning");
  // Forge LLM: already fine under the old test, must stay fine under the new one.
  ok(providerReady({ success: true, provider: "atlassian", hasKey: true, isByok: true, noKeyNeeded: true }) === true,
    "F-555 Forge LLM is READY");
  // The direction of the gate does not change: a BYOK tenant with no key still warns.
  ok(providerReady({ success: true, provider: "anthropic", hasKey: false, isByok: false }) === false,
    "F-555 a BYOK provider with no key is NOT ready — the warning is preserved");
  ok(providerReady({ success: true, provider: "anthropic", hasKey: true, isByok: true }) === true,
    "F-555 a BYOK provider with a key is READY");
  // A non-answer must never flash a warning (the fetch has not resolved, or the call threw).
  ok(providerReady(null) === true && providerReady(undefined) === true,
    "F-555 a missing body is not a 'no key' claim");
  // Explicitly NOT folded in: a resolved failure body keeps today's behaviour.
  ok(providerReady({ success: false, hasKey: false, isByok: false }) === false,
    "F-555 a getOpenAIKey failure body still warns (unchanged — a different question)");
}

/* F-252/F-254/F-255 — THE VOCABULARY, asserted on the helper directly.
   A pure function with a branch per refusal shape is exactly the thing to unit-test: the
   browser journeys can only reach the shapes some surface happens to render today, and the
   whole risk here is a shape nobody wired up yet being handled wrongly the first time it
   arrives. Imported from the config-ui home; the scan above already proved the other two
   copies are code-identical, so testing one tests all three. */
console.log("F-252/F-254/F-255 refusal vocabulary");
{
  const { isPermissionRefusal, isUpgradeRequired, permissionRefusalText } =
    await import("../config-ui/src/components/refusal.js");

  // F-254 — role floor: name the level, point at the admin who can grant it.
  const floor = { success: false, error: "Viewer access required", reason: "no-permission", hint: "ask-app-admin", needsRole: "viewer" };
  ok(isPermissionRefusal(floor), "a role-floor refusal IS a permission refusal");
  ok(permissionRefusalText(floor, "memories") === "You need CogniRunner viewer access to see memories. Ask a CogniRunner admin under Permissions.",
    "F-254 a role-floor refusal names the level and the admin who grants it");

  /* F-252 — OWNERSHIP. The reader may already be an admin, so the role sentence would be
     false AND unactionable. The backend signals this by OMITTING needsRole; the assertion
     below is the one that matters, because the failure mode is silently falling through to
     the role sentence. */
  const owned = { success: false, error: "You don't have permission to modify this rule.", reason: "no-permission", hint: "not-owner" };
  ok(isPermissionRefusal(owned), "an ownership refusal IS still a permission refusal");
  ok(permissionRefusalText(owned, "this rule") === "This rule belongs to another editor; only its author or an admin can change it.",
    "F-252 an ownership refusal names the AUTHOR and the admin override");
  ok(!/Ask a CogniRunner admin under Permissions/.test(permissionRefusalText(owned, "this rule")),
    "F-252 an ownership refusal does NOT send the reader to ask for a role");
  ok(!/You need CogniRunner/.test(permissionRefusalText(owned, "this rule")),
    "F-252 an ownership refusal never claims a role level is missing");
  /* The hint WINS over a stray needsRole. If the backend ever sends both, the ownership
     statement is the true one — a role the reader could be granted would not unlock someone
     else's rule. Pinning the precedence here stops a future edit from reordering the branches
     and quietly resurrecting the wrong sentence. */
  ok(permissionRefusalText({ ...owned, needsRole: "admin" }, "this rule") === "This rule belongs to another editor; only its author or an admin can change it.",
    "F-252 hint:not-owner outranks a needsRole if both arrive");

  // F-255 — an edition denial is a DIFFERENT product statement and must not be absorbed.
  const upgrade = { success: false, error: "This feature requires the Coder edition.", reason: "upgrade-required", featureId: "static-post-function" };
  ok(!isPermissionRefusal(upgrade), "F-255 an edition denial is NOT a permission refusal");
  ok(isUpgradeRequired(upgrade), "F-255 an edition denial is recognised as its own thing");
  ok(!isUpgradeRequired(floor) && !isUpgradeRequired(owned), "F-255 the two vocabularies do not overlap");

  /* An UNKNOWN reason must fall through both helpers rather than be absorbed by the nearest
     one. That is the property that makes adding a third vocabulary safe later. */
  const unknown = { success: false, error: "Something else", reason: "rate-limited" };
  ok(!isPermissionRefusal(unknown) && !isUpgradeRequired(unknown),
    "an unrecognised refusal reason matches neither helper");
  // And success is never a refusal, whatever else it carries.
  ok(!isPermissionRefusal({ success: true, reason: "no-permission" }),
    "a success:true result is never a refusal, even carrying the flag");
}

/* F-273 — THE EDITION ARM ON THE KNOWLEDGE SURFACES.
   F-255 taught the helper to tell an edition denial apart from a permission refusal, and
   stopped there. The four knowledge surfaces each branched on isPermissionRefusal and then
   fell through to their OUTAGE arm, so a Standard tenant reading a Coder-gated store was
   told "Couldn't load documents." and handed a Retry — a false claim plus a control that
   cannot succeed, because no retry buys a licence.

   Asserted on the SOURCE for the same reason the prose scan above is: the defect is a
   MISSING branch, and a journey test only sees a missing branch if the fixture happens to
   produce the shape that needs it. A surface that quietly loses its arm in a later refactor
   would keep passing every screenshot while telling the lie again. */
console.log("\nF-273 the edition arm on the knowledge surfaces");
{
  const SURFACES = ["DocRepository.jsx", "SkillsTab.jsx", "MemoriesTab.jsx", "KnowledgePanel.jsx"];
  for (const app of ["config-ui", "admin-panel"]) {
    for (const file of SURFACES) {
      const src = readFileSync(join(STATIC, app, "src", "components", file), "utf8");
      ok(/isUpgradeRequired\s*\(/.test(src),
        `${app}/${file} branches on isUpgradeRequired`);
      /* The ORDER is the whole fix: the upgrade arm must be reached before the fault arm,
         exactly as the permission arm already is. Both refusal arms appearing textually
         before the loadError/em-dash arm is what stops the outage from shadowing them. */
      const iUp = src.search(/isUpgradeRequired\s*\(/);
      const iErr = src.search(/setLoadError\(result\.error/);
      ok(iErr === -1 || iUp < iErr,
        `${app}/${file} routes the edition answer before the generic failure arm`);
    }
  }
}

/* F-274 — A THROWN checkIsAdmin IS "UNKNOWN", NOT "VIEWER".
   admin-panel's catch only logged. It happened to behave correctly because F-230 had
   initialised `roleIsUnknown = true` and nothing cleared it on that path — an invariant
   held up by a default three dozen lines away, with no statement of intent at the site that
   depends on it. Move the assignment, add a line after it, or "tidy" the initialiser to
   false, and the page starts telling a user whose role could not be verified that they are
   a viewer. config-ui states it explicitly in its own catch (F-243); this pins the pair. */
console.log("\nF-274 a thrown role check is unknown, not a verdict");
{
  const adminSrc = readFileSync(join(STATIC, "admin-panel", "src", "App.js"), "utf8");
  const i = adminSrc.indexOf('await invoke("checkIsAdmin")');
  ok(i !== -1, "admin-panel still calls checkIsAdmin");
  const cat = adminSrc.indexOf("} catch (e) {", i);
  const body = adminSrc.slice(cat, cat + 900);
  ok(/roleIsUnknown\s*=\s*true/.test(body),
    "F-274 the catch around checkIsAdmin sets roleIsUnknown true explicitly");
  ok(!/roleIsUnknown\s*=\s*false/.test(body),
    "F-274 the catch never asserts a verdict it did not receive");

  const uiSrc = readFileSync(join(STATIC, "config-ui", "src", "App.js"), "utf8");
  const j = uiSrc.indexOf('await invoke("checkIsAdmin")');
  const jcat = uiSrc.indexOf("} catch (e) {", j);
  ok(/setRoleUnknown\(true\)/.test(uiSrc.slice(jcat, jcat + 900)),
    "F-274 config-ui's catch does the same — the two apps agree");
}

/* F-273 — THE COPY, from the one home, with the label taken from the one table.
   A second hardcoded list of what Coder sells is the drift this codebase keeps paying for,
   so the label is asserted to come from src/shared/edition.js's ADVANCED_FEATURES rather
   than from a string in the frontend. */
console.log("\nF-273 the upgrade copy");
{
  const { upgradeRequiredText, UPGRADE_REQUIRED_HEADLINE } =
    await import("../config-ui/src/components/refusal.js");
  const { ADVANCED_FEATURES } = await import("../../src/shared/edition.js");

  ok(UPGRADE_REQUIRED_HEADLINE === "This needs CogniRunner Coder.",
    "F-273 the headline names the edition by its PRODUCT name (Coder), not its id (advanced)");

  const known = ADVANCED_FEATURES[0];
  const text = upgradeRequiredText({ success: false, reason: "upgrade-required", featureId: known.id });
  ok(text === `Upgrade CogniRunner under Apps, Manage apps to unlock ${known.label}. CogniRunner Settings changes the AI provider, not the edition.`,
    "F-273 a known featureId renders its label from ADVANCED_FEATURES and names the remedy");
  ok(text.includes(known.label),
    "F-273 the label comes from the shared table, not a frontend copy of it");
  ok(/Upgrade CogniRunner under Apps, Manage apps/.test(text) && !/Retry|Ask a CogniRunner admin/.test(text),
    "F-273 the remedy is an upgrade — never a retry and never a role request");
  /* F-915 — THE PAGE THE REMEDY NAMES HAS TO BE THE PAGE THAT CARRIES IT. "Upgrade in
     Settings" sent a paying admin to the provider picker over a billing question; the
     edition is a Marketplace subscription and lives under Apps, Manage apps. Both places
     are named, each with its own subject, and the gate is on BOTH halves: dropping either
     one re-creates the defect in the opposite direction. */
  ok(!/Upgrade in Settings/.test(text),
    "F-915 the remedy no longer claims the edition is changed in Settings");
  ok(/Manage apps/.test(text) && /Settings changes the AI provider/.test(text),
    "F-915 the sentence names Manage apps for the edition AND Settings for the provider");

  /* Unknown / absent featureId degrades rather than guessing, the same discipline the
     unnamed-role case follows. A wrong confident claim about what someone must buy is
     worse than a vague true one. */
  ok(upgradeRequiredText({ featureId: "no-such-feature" }) === "Upgrade CogniRunner under Apps, Manage apps to unlock this feature. CogniRunner Settings changes the AI provider, not the edition.",
    "F-273 an unknown featureId degrades to 'this feature' instead of guessing");
  ok(upgradeRequiredText({}) === "Upgrade CogniRunner under Apps, Manage apps to unlock this feature. CogniRunner Settings changes the AI provider, not the edition.",
    "F-273 a missing featureId degrades the same way");

  /* F-330 — the body sentence must read as a sentence for EVERY row of the table, not just
     the one that happens to start with a capital. ADVANCED_FEATURES labels are noun phrases
     and one of them is deliberately lowercase (the backend embeds it mid-sentence, F-297),
     so the render site — not the table — is what must guarantee the opener. It must also not
     repeat the edition name that the headline directly above it already carries. */
  for (const f of ADVANCED_FEATURES) {
    const body = upgradeRequiredText({ featureId: f.id });
    ok(/^[A-Z]/.test(body), `F-330 the body opens with a capital for "${f.id}" (got "${body.slice(0, 24)}…")`);
    /* F-915 moved the label off the END of the string (a second clause now names where
       Settings fits), so the assertion is that the label is used VERBATIM and closes its
       OWN clause. Re-casing it or rewording it still fails, which is what F-330 was for. */
    ok(body.includes(`to unlock ${f.label}.`),
      `F-330 the label is used VERBATIM as a noun phrase for "${f.id}", never re-cased or re-worded`);
    ok(!/Coder edition|CogniRunner Coder/.test(body),
      `F-330 the body does not repeat the edition name for "${f.id}" — the headline names it once`);
  }
  ok(!/—/.test(upgradeRequiredText({ featureId: "coder" })),
    "F-330 the em-dash sentence is gone");
}

/* F-915 — THE ACTION VOCABULARY, AND THE ONE PROSE PARSE THIS REPO ALLOWS.
 *
 * The Coder panel printed the engine's identifiers to the person authorising a write:
 * `open_pull_request`, `sourceBranch`, `draft false`, "ended by final". The words now come
 * from src/shared/agent-actions.js, which is also where the ids live, so a new action
 * arrives with its own sentence instead of arriving as an identifier on a screen.
 *
 * The DECISION ROW is the delicate half. `confirmCoderTicket` writes a model-facing line
 * into the thread ("DECISION: the user CONFIRMED open_pull_request and it was performed.")
 * and the panel used to render it verbatim. It is now parsed — the one place in this repo
 * where matching on prose is allowed, and it is allowed because the sentence has exactly
 * ONE writer, in code, with a fixed grammar. What makes that safe rather than lucky is
 * THIS block: the four templates are read out of src/coder-engine.js and pushed through
 * the parser, so rewording one of them there without teaching the parser fails the build
 * instead of silently turning a decision row back into engine prose in somebody's panel.
 */
console.log("\nF-915 the action vocabulary and the decision grammar");
{
  const {
    agentActionLabel, agentActionPhrase, describeAgentAction, previewKeyLabel,
    agentEndingText, parseDecisionRow, decisionRowSentence,
  } = await import("../../src/shared/agent-actions.js");

  // The finding's own sentence, field for field, from the preview the engine really sends.
  ok(describeAgentAction("open_pull_request", {
    repo: "acme/web", title: "Retry guard", sourceBranch: "proj-42-retry-guard", targetBranch: "main", draft: false,
  }) === "Open a pull request on acme/web from proj-42-retry-guard into main (draft: no)",
    "F-915 a consent preview becomes one sentence naming repo, both branches and the draft flag");
  // The two blast-radius arguments F-363 put in the preview keep their own words.
  ok(/visible to everyone/.test(describeAgentAction("create_repo", { name: "acme-internal", org: "acme", private: false })),
    "F-915 private:false is spelled out as a visibility statement, never dropped");
  ok(/environment: production/.test(describeAgentAction("trigger_deploy", { repo: "acme/web", workflow: "deploy.yml", ref: "main", inputs: { environment: "production" } })),
    "F-915 a nested deploy input reaches the sentence");
  // Degrading: an id this file has never heard of must read as words, never as an id.
  ok(!/_/.test(describeAgentAction("some_new_action", { issueKey: "PROJ-42" })),
    "F-915 an unknown action id humanises instead of printing an identifier");
  ok(describeAgentAction("open_pull_request", null) === "Open a pull request",
    "F-915 a ticket with no arguments degrades to the action's own name");

  ok(agentActionLabel("open_pull_request") === "Open a pull request"
    && agentActionPhrase("open_pull_request") === "open a pull request",
    "F-915 the heading and the mid-sentence form come from the catalogue's own label");
  ok(previewKeyLabel("sourceBranch") === "Source branch" && previewKeyLabel("inputs.environment") === "Inputs, environment",
    "F-915 a preview key reads as words and a nested leaf keeps its path");

  /* The endings are `runAgentLoop`'s own `endedBy` values and nothing else. "final" was
     never one of them — the mock bridge invented it and the panel printed it raw. */
  ok(agentEndingText("finish") === "finished" && agentEndingText("rounds") === "stopped at the round limit"
    && agentEndingText("halt") === "waiting for you",
    "F-915 each real ending has one word");
  ok(agentEndingText("final") === "" && agentEndingText("") === "",
    "F-915 an ending with no word is left unsaid, never printed as a token");

  /* THE GRAMMAR GATE. Read the four templates from the engine and run the sentences the
     engine would really write through the parser. */
  const engine = readFileSync(join(ROOT, "src", "coder-engine.js"), "utf8");
  for (const needle of [
    "DECISION: the user CONFIRMED ${ticket.action}",
    "DECISION: the user SKIPPED ${ticket.action}",
    "DECISION: the user asked to CHANGE ${ticket.action}",
    "was REFUSED at confirmation time and NOT performed",
  ]) {
    ok(engine.includes(needle), `F-915 src/coder-engine.js still writes "${needle.slice(0, 44)}…" (reword it and the parser must move with it)`);
  }

  const rows = [
    ["DECISION: the user CONFIRMED open_pull_request and it was performed.",
      "You confirmed: open a pull request. Done."],
    ["DECISION: the user CONFIRMED open_pull_request but it failed. Reason: the branch is gone",
      "You confirmed: open a pull request. It failed: the branch is gone"],
    ["DECISION: the user SKIPPED open_pull_request. It was not performed and must not be retried unless they ask again.",
      "You skipped: open a pull request. Nothing ran."],
    ["DECISION: the user asked to CHANGE open_pull_request before it runs. Their words: target develop instead",
      "You asked for a change to: open a pull request. Your words: target develop instead"],
    [`DECISION: trigger_deploy was REFUSED at confirmation time and NOT performed ${String.fromCharCode(0x2014)} this site cannot run it.`,
      "Trigger a deployment could no longer be confirmed: this site cannot run it. Nothing ran."],
  ];
  for (const [raw, want] of rows) {
    ok(decisionRowSentence(raw) === want, `F-915 "${raw.slice(9, 40)}…" reads as "${want}" (got "${decisionRowSentence(raw)}")`);
    ok(!/[a-z]+_[a-z]+/.test(decisionRowSentence(raw)), "F-915 no action id survives into the decision sentence");
  }
  /* A row the parser does not recognise answers "" so the panel prints the row as it
     stands. Degrading to the engine's own sentence is honest; inventing one is not. */
  ok(parseDecisionRow("something else entirely") === null && decisionRowSentence("something else entirely") === "",
    "F-915 an unparseable decision row is handed back untouched, never guessed at");
}


console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
