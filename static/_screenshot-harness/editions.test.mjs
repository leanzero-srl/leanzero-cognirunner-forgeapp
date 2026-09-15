/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 *
 * EDITIONS (1.3) browser journeys — the admin-panel edition chip, the edition-aware
 * Forge LLM model picker (locked rows + Coder badges), the agent-model selector and
 * the Forge LLM monthly allowance meter, in BOTH editions and BOTH themes.
 *
 * The edition comes from the mock bridge: window.__STANDARD__ = true flips every
 * edition surface to Standard (locked Sonnet/Opus rows, upgrade copy, no allowance).
 *
 * No prereq build: the suite rebuilds admin-panel's build-shot itself when it is
 * missing or older than src/ (lib/build-shot.mjs, F-125).
 * Run:    node static/_screenshot-harness/editions.test.mjs   (add --shots to save PNGs to out/)
 */
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureFreshBuildShot } from "./lib/build-shot.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC = path.resolve(__dirname, "..");
const SHOTS = process.argv.includes("--shots");
const OUT = path.join(__dirname, "out"); if (SHOTS) fs.mkdirSync(OUT, { recursive: true });

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
function serve(root) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split("?")[0]); if (p === "/") p = "/index.html";
      const f = path.join(root, p);
      if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end("x"); }
      res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
    });
    s.listen(0, "127.0.0.1", () => resolve({ s, port: s.address().port }));
  });
}

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log("  ✗ " + msg); } };
/* F-914 - settle before the shutter: the panel's entry animations run on mount, so an
   instant screenshot catches every solid chip at partial opacity and reads as a wash the
   CSS does not contain. The assertions use getComputedStyle and never saw it. */
const shot = async (page, name) => {
  if (!SHOTS) return;
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
};

/* `extra` is a plain bag of window.__FLAG__ values set before mount (the managed-engine
   knobs: __MANAGED_MISSING__, __MANAGED_DISABLED__, __MANAGED_SPEND__). Keeping it a bag
   rather than more positional booleans is what stopped this signature growing a fifth and
   sixth flag nobody can read at the call site. */
/* F-957 - `viewport` is an explicit optional argument so a journey can measure the tab
   strip at a REAL Jira content width (the defect only appears below ~1300px). Every
   existing call keeps the 1440 it always had. */
async function openAdmin(browser, theme = "light", standard = false, unlicensed = false, extra = {}, viewport = { width: 1440, height: 1200 }) {
  const root = ensureFreshBuildShot("admin-panel"); // F-125: never serve a bundle older than src/
  const { s, port } = await serve(root);
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(([th, std, unl, ex]) => {
    window.__SHOT__ = "admin"; window.__THEME__ = th;
    if (std) window.__STANDARD__ = true; if (unl) window.__UNLICENSED__ = true;
    for (const [k, v] of Object.entries(ex || {})) window[k] = v;
  }, [theme, standard, unlicensed, extra]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e && e.message)));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!document.querySelector(".container") && !document.querySelector(".container .sk"), { timeout: 15000 }).catch(() => {});
  return { page, ctx, s, errors };
}
async function close(env) { await env.ctx.close(); await new Promise((r) => env.s.close(r)); }
const tab = (page, label) => page.locator(".tab-btn", { hasText: new RegExp(`^\\s*${label}\\s*$`) }).first().click();

/* F-955 - THE MONTH BOUNDARY IS IMPORTED, NEVER RETYPED. The panel derives "resets
   <day>" from `usage.month.key` through the shared helper; a journey that hard-coded a
   date would pass against a panel computing the WRONG one, which is the only failure
   worth catching here. Both come from src/shared/usage-meter.js, the one home. */
const { allowanceResetLabel, monthKey } = await import("../../src/shared/usage-meter.js");

/* F-955 - the agent model is a PICKER now; typing an id is the last row. Every journey
   that needs the text box walks the same two clicks, so the path is written once. */
/* F-991 - and now there are TWO such pickers, so the walk takes the slot's aria label.
   It defaults to the agent slot, which is what every journey written before the Coder
   slot existed means. The label comes from MODEL_SLOT_COPY below, never retyped. */
async function openAgentTypingBox(page, label = "Agent model") {
  await page.locator(`[aria-label="${label}"]`).first().click();
  await page.waitForTimeout(200);
  /* `.last()` on purpose: both pickers render an "Other (type an id)" row, and only the
     OPEN panel's row is clickable - but a `.first()` here matched the agent panel's row
     in the DOM even while the coder panel was the one showing. Scope to the open panel. */
  await page.locator(".dropdown-panel .dropdown-item", { hasText: "Other (type an id)" }).first().click();
  await page.waitForTimeout(200);
}

/* F-991 - THE SLOT COPY THE PANEL ITSELF READS. Imported rather than retyped so a
   journey can never pin a label the panel has stopped using - the failure mode this file
   already met once when the agent block described itself in a comment. */
const { MODEL_SLOT_COPY } = await import("../admin-panel/src/components/productNames.js");
/* The two slots that own a model picker of their own, as the journeys walk them. */
const AGENT_AND_CODER = [MODEL_SLOT_COPY.agent, MODEL_SLOT_COPY.coder];

// Switch the provider picker to Forge LLM — that is where the edition rules bite.
async function pickForgeLlm(page) {
  await page.locator(".dropdown-trigger").first().click();
  await page.locator(".dropdown-item", { hasText: "Atlassian (Forge LLM)" }).first().click();
  await page.waitForTimeout(500);
}

/* ---------------- E0 — mock/shared-module parity (F-085) ----------------------
   The mock bridge must not carry its own copy of the edition facts. If it does,
   the harness stops being able to see a drift between the UI and the ONE home
   for those facts (src/shared/edition.js) and simply agrees with itself. */
{
  console.log("E0 mock ↔ src/shared/edition.js parity");
  const { ADVANCED_FEATURES, FORGE_LLM_FRONTIER, FORGE_LLM_DEFAULT } = await import("../../src/shared/edition.js");
  globalThis.window = globalThis.window || {};
  const { invoke } = await import("./bridge.js");
  const lic = await invoke("checkLicense");
  const mockIds = (lic.features || []).map((f) => f.id);
  ok(JSON.stringify(mockIds) === JSON.stringify(ADVANCED_FEATURES.map((f) => f.id)),
    `E0 mock feature ids equal ADVANCED_FEATURES ids (got ${JSON.stringify(mockIds)})`);
  ok(mockIds.length > 0, "E0 mock actually emits features");
  // F-077: seats and forgeLlm are SIBLINGS of usage on the resolver result.
  /* F-545: the allowance only EXISTS for a vendor-billed ACTIVE provider, so the shape
     assertions below have to ask as one. The default mock tenant is Anthropic BYOK and
     correctly gets `null` - which is asserted separately, right after. */
  globalThis.window.__PROVIDER__ = "atlassian";
  const u = await invoke("getAiUsage");
  ok(u.seats !== undefined, "E0 getAiUsage mock puts seats at the result root");
  ok(u.forgeLlm !== undefined, "E0 getAiUsage mock puts forgeLlm at the result root");
  ok(u.usage && u.usage.seats === undefined && u.usage.forgeLlm === undefined,
    "E0 getAiUsage mock does NOT nest seats/forgeLlm inside usage");
  /* F-090: the allowance block must be the REAL shape, computed by the app's own
     forgeLlmAllowanceStatus — pct is a 0-1 FRACTION. The mock used to hand-write
     `pct: 46` and the harness photographed a meter that read 0% on every tenant. */
  const { emptyState, monthKey, allowanceUsdForSeats, forgeLlmAllowanceStatus } =
    await import("../../src/shared/usage-meter.js");
  ok(typeof u.forgeLlm.pct === "number" && u.forgeLlm.pct > 0 && u.forgeLlm.pct <= 1,
    `E0 allowance pct is a 0-1 fraction, not a percentage (got ${u.forgeLlm.pct})`);
  {
    const st = emptyState();
    st.month.key = monthKey(Date.now());
    st.month.forgeLlm.estUsd = u.forgeLlm.estUsd;
    const real = forgeLlmAllowanceStatus(st, allowanceUsdForSeats(u.seats), Date.now());
    ok(JSON.stringify(real) === JSON.stringify(u.forgeLlm),
      `E0 allowance block equals forgeLlmAllowanceStatus(seats=${u.seats}) (got ${JSON.stringify(u.forgeLlm)})`);
    ok(real.allowanceUsd === allowanceUsdForSeats(u.seats),
      "E0 mock seats and allowance agree via the shared seat rule");
  }
  /* F-545: `vendorAllowance` is the honest name for the SAME object and is what a new
     surface reads. Both keys must carry it, or a reader picks the one that is dead. */
  ok(JSON.stringify(u.vendorAllowance) === JSON.stringify(u.forgeLlm),
    "E0 vendorAllowance and forgeLlm are the same allowance object");
  ok(u.vendorAllowance && typeof u.vendorAllowance.byEngine === "object",
    "E0 the allowance carries byEngine so a panel can say where the money went");
  /* F-091: Standard gets an explicit null — the value the backend now sends. */
  globalThis.window.__STANDARD__ = true;
  const uStd = await invoke("getAiUsage");
  ok(uStd.forgeLlm === null, `E0 getAiUsage returns forgeLlm: null on Standard (got ${JSON.stringify(uStd.forgeLlm)})`);
  ok(uStd.vendorAllowance === null, "E0 vendorAllowance is null on Standard too");
  globalThis.window.__STANDARD__ = false;
  /* F-545: a BYOK-active Coder tenant pays its own bill and gets an explicit null on
     BOTH keys — this is the case whose client-side literal gate the fix removed. */
  globalThis.window.__PROVIDER__ = "anthropic";
  const uByok = await invoke("getAiUsage");
  ok(uByok.vendorAllowance === null && uByok.forgeLlm === null,
    "E0 a BYOK-active Coder tenant gets no allowance from the backend");
  /* ...and the managed engine, being vendor-billed, DOES get one. */
  globalThis.window.__PROVIDER__ = "managed";
  const uMgd = await invoke("getAiUsage");
  ok(uMgd.vendorAllowance !== null, "E0 the managed engine is vendor-billed and gets an allowance");
  globalThis.window.__PROVIDER__ = undefined;
  // The frontier/default ids the mock serves are the shared ones, not a copy.
  const m = await invoke("getOpenAIModels", { provider: "atlassian" });
  ok((m.models || []).includes(FORGE_LLM_DEFAULT) && m.currentModel === FORGE_LLM_DEFAULT,
    "E0 mock Forge LLM model list carries the shared default (not a copy)");
  ok(JSON.stringify((m.models || []).slice(1)) === JSON.stringify(FORGE_LLM_FRONTIER),
    "E0 mock frontier ids are the shared FORGE_LLM_FRONTIER");
  ok(FORGE_LLM_FRONTIER.length === 2, "E0 shared frontier list still has two ids");

  /* F-175 — the MEMORY CAP facts have the same parity duty as the edition facts.
     The Memories tabs render addMemory's `error` verbatim, so a mock that invents its
     own refusal sentence photographs and asserts words no tenant ever sees. Two real
     defects lived here: the __MEMORY_CAP__ branch returned no `error` at all, and the
     __MEMORY_FULL__ branch hand-typed "...prune in the Memories tab." while the backend
     said "...archive or delete some in the Memories tab to make room."
     Both branches must now equal memoryCapRefusalMessage("cap") EXACTLY. */
  {
    const { MAX_MEMORIES, MEMORY_CONTENT_MAX, MEMORY_MAX_SERIALIZED_BYTES, memoryCapRefusalMessage } =
      await import("../../src/shared/registry-limits.js");
    const expected = memoryCapRefusalMessage("cap");

    for (const flag of ["__MEMORY_CAP__", "__MEMORY_FULL__"]) {
      globalThis.window[flag] = true;
      const r = await invoke("addMemory", { content: "x" });
      ok(r.error === expected,
        `E0 ${flag} addMemory error is memoryCapRefusalMessage("cap") verbatim (got ${JSON.stringify(r.error)})`);
      ok(r.success === false && r.stored === false && r.reason === "cap",
        `E0 ${flag} addMemory keeps the refusal shape { success:false, stored:false, reason:"cap" }`);
      globalThis.window[flag] = false;
    }

    /* The at-cap counts fixture must MOVE with the cap, not sit on a typed 200. */
    globalThis.window.__MEMORY_FULL__ = true;
    const kc = await invoke("getKnowledgeCounts");
    ok(kc.memoryCap === MAX_MEMORIES && kc.memories === MAX_MEMORIES,
      `E0 getKnowledgeCounts at cap is derived from MAX_MEMORIES=${MAX_MEMORIES} (got ${kc.memories}/${kc.memoryCap})`);
    globalThis.window.__MEMORY_FULL__ = false;

    /* The shared module really is the only home: sanity-check the numbers exist and are
       the sort of thing the sentence interpolates, so a null/undefined export cannot make
       the equality assertions above pass vacuously. */
    ok(Number.isInteger(MAX_MEMORIES) && MAX_MEMORIES > 0, "E0 MAX_MEMORIES is a real cap");
    ok(Number.isInteger(MEMORY_CONTENT_MAX) && MEMORY_CONTENT_MAX > 0, "E0 MEMORY_CONTENT_MAX is a real clamp");
    ok(Number.isInteger(MEMORY_MAX_SERIALIZED_BYTES) && MEMORY_MAX_SERIALIZED_BYTES > 0,
      "E0 MEMORY_MAX_SERIALIZED_BYTES is a real byte guard");
    ok(expected.includes(String(MAX_MEMORIES)),
      "E0 the refusal sentence interpolates MAX_MEMORIES rather than a typed number");

    /* The RECURRENCE GATE. A future edit that retypes the sentence into bridge.js or any
       suite re-creates the exact defect this parity block was written for, and every
       assertion above would still pass because the copy would be identical ON THE DAY IT
       WAS TYPED. So: scan the harness sources and allow the phrase ONLY on a line that
       imports it. Checked against the source text, not the running module. */
    // The needle is CUT FROM the real sentence, never typed — otherwise this very line
    // would be its own first offender, and a reworded refusal would silently stop being
    // guarded.
    //
    // F-195 — it used to be cut from the HEAD: everything before the "(N max)" clause.
    // The F-179 rewording made that head exactly "Memory store is full" — 20 characters,
    // which failed the `> 20` floor, and worse, a phrase the app uses somewhere else
    // entirely. It is the TITLE of MemoryFullBanner (memoryStoreFullCopy, a different
    // one-home sentence with a different owner), so the scan reported three legitimate
    // banner assertions as retype offenders. A needle that matches a DIFFERENT sentence
    // is not a weak gate, it is a wrong one: it fails honest code and teaches the next
    // person to delete it.
    //
    // Cut from the DISTINCTIVE tail — the clause after the first sentence break, which
    // carries the eviction policy and the remedy and belongs to this sentence alone.
    // F-827 — that break USED TO BE AN EM DASH, and this line asserted the em dash was
    // still there. The owner's standing rule is that no UI copy carries one, so the
    // refusal now ends its first clause with a full stop and the needle is cut there
    // instead. The assertion below is unchanged in spirit: a rewording that removes the
    // break fails loudly here instead of quietly producing a needle that guards nothing.
    //
    // F-204 — but the tail ALONE is the wrong gate, because it threw away the only half of
    // the sentence that can carry a stale number. The whole reason this scan exists
    // (F-168/F-172) is that a hand-typed cap drifts when MAX_MEMORIES changes, and the only
    // substring that can carry a typed cap number is the HEAD — the clause ending in
    // "(N max)". (Spelling that clause out here would make this comment the scan's own first
    // offender, which is the proof that the gate below actually bites.)
    // F-195 was right that the bare head "Memory store is full" is a wrong needle (it
    // is also MemoryFullBanner's title and flagged three honest banner assertions); the fix
    // for that was never to stop scanning the head, it was to include the `(N max)` clause
    // so the needle stops matching the banner title. So: scan BOTH. The head guards the
    // interpolated constant, the tail guards the wording.
    const split = expected.indexOf(". ");
    ok(split > 0, `E0 the cap refusal still has the sentence break the needle is cut from (got "${expected}")`);
    ok(!expected.includes("—") && !expected.includes("–"),
      "E0 and it carries no em dash or en dash (the owner rule ui-copy-dashes.test.mjs gates)");
    const TAIL_NEEDLE = expected.slice(split + 1).trim();
    const HEAD_NEEDLE = expected.slice(0, split).trim();
    // The floor is well above 20 now. A short needle is what made F-195 possible: a
    // 20-character phrase is a phrase several sentences in this app can legitimately
    // share, and a gate that matches more than the thing it guards flags honest code.
    ok(TAIL_NEEDLE.length > 40, `E0 the tail needle is long enough to be unique (${TAIL_NEEDLE.length} chars: "${TAIL_NEEDLE}")`);
    // The head's uniqueness comes from the interpolated cap, not from its length — assert
    // that directly. Without the "(N max)" clause this needle is the banner title again and
    // the F-195 false positives come straight back.
    ok(HEAD_NEEDLE.includes(`(${MAX_MEMORIES} max)`),
      `E0 the head needle carries the interpolated cap — that is the ONLY part a retype can make stale (got "${HEAD_NEEDLE}")`);
    ok(HEAD_NEEDLE.includes(String(MAX_MEMORIES)),
      "E0 the head needle contains MAX_MEMORIES itself, so a drifted literal cannot match it");
    // And they must be specific to THIS refusal — the byte-guard variant is a different
    // sentence with the same owner, so a needle matching both guards neither precisely.
    ok(!memoryCapRefusalMessage("bytes").includes(TAIL_NEEDLE),
      "E0 the tail needle is unique to the row-cap refusal — it must not also match the byte-guard one");
    ok(!memoryCapRefusalMessage("bytes").includes(HEAD_NEEDLE),
      "E0 the head needle is unique to the row-cap refusal — it must not also match the byte-guard one");
    const files = fs.readdirSync(__dirname)
      .filter((f) => f === "bridge.js" || f.endsWith(".test.mjs"));
    const offenders = [];
    for (const f of files) {
      const lines = fs.readFileSync(path.join(__dirname, f), "utf8").split("\n");
      lines.forEach((line, i) => {
        if (!line.includes(TAIL_NEEDLE) && !line.includes(HEAD_NEEDLE)) return;
        // The sentence may only appear where it is IMPORTED/derived, never as a literal.
        // Two exemptions, both of which are how a line legitimately carries the text:
        //   - the builder call itself (`memoryCapRefusalMessage(...)`), and
        //   - this file's own import of the shared module, which names it in a destructure.
        if (/\bmemoryCapRefusalMessage\b/.test(line)) return;
        if (/registry-limits\.js/.test(line)) return;
        offenders.push(`${f}:${i + 1}`);
      });
    }
    ok(offenders.length === 0,
      `E0 no harness line retypes the cap refusal — derive it from memoryCapRefusalMessage (offenders: ${offenders.join(", ")})`);
    // F-204 — prove the head needle actually BITES. A hand-typed copy of the head is the
    // exact defect the scan exists for, so construct one here and confirm the predicate
    // the loop above uses would flag it. Built by concatenation so this line is not itself
    // a literal of the sentence (it would then be its own first offender).
    const handTyped = "Memory store is full (" + MAX_MEMORIES + " max)";
    ok(handTyped.includes(HEAD_NEEDLE) || HEAD_NEEDLE.includes(handTyped),
      `E0 a hand-typed "(${MAX_MEMORIES} max)" head is caught by the head needle (needle "${HEAD_NEEDLE}")`);
    ok(!/\bmemoryCapRefusalMessage\b/.test(handTyped) && !/registry-limits\.js/.test(handTyped),
      "E0 the hand-typed head claims neither exemption — it would be reported as an offender");
    ok(files.includes("bridge.js") && files.length > 1,
      `E0 the retype scan actually read the harness sources (${files.length} files)`);
  }
}

const browser = await chromium.launch();
try {
  /* ---------------- E1 — Coder edition, light ---------------- */
  for (const theme of ["light", "dark"]) {
    console.log(`E1 Coder edition (${theme})`);
    const env = await openAdmin(browser, theme, false);
    const { page } = env;
    try {
      const chip = page.locator(".edition-chip");
      ok(await chip.count() === 1, "E1 exactly one edition chip in the header");
      ok((await chip.first().innerText()).trim().toLowerCase() === "coder", "E1 chip reads Coder");
      ok(await page.locator(".edition-chip.edition-advanced").count() === 1, "E1 chip carries the advanced class");
      const bg = await chip.first().evaluate((el) => getComputedStyle(el).backgroundColor);
      const fg = await chip.first().evaluate((el) => getComputedStyle(el).color);
      /* F-957 - one fill in BOTH themes. The dark theme used to lighten it to #f97316 and
         darken the ink to near-black to stay legible; white is the rule, so the FILL stopped
         moving instead. E7 measures the contrast that forced it. */
      ok(bg === "rgb(194, 65, 12)", `E1 chip solid hue per theme (got ${bg})`);
      ok(/^rgba?\(255,\s*255,\s*255/.test(fg), `E1 chip ink is white (got ${fg})`);
      ok(/^rgba?\(/.test(fg) && !/, 0\.\d+\)$/.test(bg), "E1 chip fill is opaque (no faded tint)");

      await tab(page, "Settings");
      await page.locator(".usage-card").waitFor({ timeout: 10000 });
      /* F-091: the allowance is a FORGE LLM meter. The mock tenant lands on the
         Anthropic BYOK provider first, and a BYOK tenant pays their own tokens —
         they must never be shown the vendor's allowance, on either edition. */
      ok(await page.locator(".usage-allowance").count() === 0, "E1 no allowance row while the provider is BYOK");

      await pickForgeLlm(page);
      /* F-545: the allowance follows the ACTIVE provider, because that is what the
         getAiUsage resolver reads. BROWSING Forge LLM in the picker does not refetch
         usage and must NOT conjure a meter - this tenant is still Anthropic-active and
         still pays its own bill. The meter's own assertions moved to E1b, which opens
         the panel as a genuinely Forge-LLM-active tenant. */
      ok(await page.locator(".usage-allowance").count() === 0,
        "E1 browsing Forge LLM does not show an allowance to a BYOK-ACTIVE tenant");
      const body = await page.locator(".container").innerText();
      ok(body.includes("Sonnet 5 and Opus 5 unlocked."), "E1 unlocked notice on Coder");
      /* F-991 - this used to pin "Used by Coder and Virtual Administrators.", which was
         the agent slot describing work it no longer does. Both slots are read from
         MODEL_SLOT_COPY now, so the journey follows a rename instead of failing on one. */
      for (const slot of AGENT_AND_CODER) {
        ok(body.includes(slot.drives), `E1 ${slot.label} help text, from MODEL_SLOT_COPY`);
      }
      ok(!body.includes("Used by Coder and Virtual Administrators."),
        "E1 the retired one-slot sentence is gone from the card");
      ok(!body.includes("upgrade in Jira"), "E1 no upgrade prompt on Coder");
      ok(await page.locator(".dropdown-item-locked").count() === 0, "E1 no locked rows on Coder (panel closed)");
      await shot(page, `E1-coder-settings-${theme}`);
      ok(env.errors.length === 0, "E1 no page errors: " + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  ✗ E1 threw: " + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ---------------- E2 — Standard edition: locked rows, upgrade copy, clamp ---------------- */
  for (const theme of ["light", "dark"]) {
    console.log(`E2 Standard edition (${theme})`);
    const env = await openAdmin(browser, theme, true);
    const { page } = env;
    try {
      const chip = page.locator(".edition-chip");
      ok(await chip.count() === 1 && (await chip.first().innerText()).trim().toLowerCase() === "standard", "E2 chip reads Standard");
      ok(await page.locator(".edition-chip.edition-standard").count() === 1, "E2 chip carries the standard class");
      const bg = await chip.first().evaluate((el) => getComputedStyle(el).backgroundColor);
      ok(bg === (theme === "dark" ? "rgb(100, 116, 139)" : "rgb(71, 85, 105)"), `E2 chip slate hue per theme (got ${bg})`);

      await tab(page, "Settings");
      await page.locator(".usage-card").waitFor({ timeout: 10000 });
      ok(await page.locator(".usage-allowance").count() === 0, "E2 no allowance row on Standard");

      await pickForgeLlm(page);
      /* F-091: the real test. On Forge LLM the provider gate no longer hides the
         meter, so the ONLY thing keeping it off a Standard tenant is the backend's
         `forgeLlm: null` — which the mock now sends. A Standard tenant must never
         see a vendor allowance, nor the "Sonnet 5 / Opus 5 paused" copy. */
      ok(await page.locator(".usage-allowance").count() === 0, "E2 still no allowance row on Standard with Forge LLM selected");
      const body = await page.locator(".container").innerText();
      ok(body.includes("Claude Sonnet 5 and Opus 5 are part of CogniRunner Coder"), "E2 upgrade notice on Standard");
      /* F-914 - the notice used to POINT at Manage apps in primary-blue bold text that
         was not a link. It now carries a real href, and it names the frontier requirement
         so a tenant that upgrades is not refused a second time by the model gate. */
      const upgradeLinks = page.locator(".openai-status .agent-off a.agent-off-link");
      ok(await upgradeLinks.count() === 1, "E2 the notice carries exactly one real upgrade link");
      ok(await upgradeLinks.first().getAttribute("href") === "https://your-site.atlassian.net/jira/settings/apps/manage",
        "E2 and its href is this site's Manage apps page");
      ok(body.includes("Coder edition AND Claude Sonnet 5 or Opus 5"), "E2 the frontier requirement is named before the upgrade");
      ok(await page.locator(".openai-status .agent-off .agent-off-btn").count() === 0,
        "E2 no Open the Settings tab button on the Settings tab itself");
      const offLinkBg = await upgradeLinks.first().evaluate((el) => getComputedStyle(el).backgroundColor);
      /* F-966 - ONE shade per hue, in BOTH themes. The dark theme used to lighten every
         chip fill and pay for it with near-black ink; white is the rule, so the fills
         stopped moving instead. chip-contrast.test.mjs measures all of them. */
      ok(offLinkBg === "rgb(194, 65, 12)",
        `E2 the upgrade link is the solid Coder orange per theme (got ${offLinkBg})`);
      ok(body.includes("is not available on this edition, using Claude Haiku"), "E2 clamped-model line");

      // open the model picker: Sonnet/Opus render as LOCKED rows with a Coder badge
      await page.locator(".dropdown-trigger").nth(1).click();
      await page.locator(".dropdown-panel").waitFor({ timeout: 5000 });
      const locked = page.locator(".dropdown-item-locked");
      ok(await locked.count() === 2, "E2 two locked model rows (Sonnet 5, Opus 5)");
      ok(await page.locator(".dropdown-item-locked .dib-edition").count() === 2, "E2 locked rows carry the Coder badge");
      ok((await locked.first().getAttribute("aria-disabled")) === "true", "E2 locked row is aria-disabled");
      const badgeBg = await page.locator(".dib-edition").first().evaluate((el) => getComputedStyle(el).backgroundColor);
      /* F-957 - the badge is #c2410c in BOTH themes now. The dark theme used to lighten it
         to #f97316 and pay for that with near-black ink; white on #f97316 is 2.80:1, and no
         orange light enough to read as "one shade lighter" clears AA with white, so the
         fill stopped moving instead of the text. */
      ok(badgeBg === "rgb(194, 65, 12)", `E2 Coder badge solid hue per theme (got ${badgeBg})`);
      const lockedOpacity = await locked.first().evaluate((el) => getComputedStyle(el).opacity);
      ok(lockedOpacity === "1", "E2 locked row is NOT faded (opacity 1 — solid colour instead)");
      const lockedCursor = await locked.first().evaluate((el) => getComputedStyle(el).cursor);
      ok(lockedCursor === "not-allowed", "E2 locked row shows a not-allowed cursor");
      await shot(page, `E2-standard-locked-models-${theme}`);

      // Clicking a locked row must NOT change the selection. Playwright's own
      // actionability check already REFUSES a normal click on aria-disabled, which is
      // the accessibility half of the contract; dispatchEvent bypasses it so we also
      // prove the component's own click handler no-ops.
      const before = await page.locator(".dropdown-trigger").nth(1).innerText();
      await locked.first().dispatchEvent("click");
      await page.waitForTimeout(200);
      const stillOpen = await page.locator(".dropdown-panel").count();
      const after = await page.locator(".dropdown-trigger").nth(1).innerText();
      ok(stillOpen === 1, "E2 clicking a locked row does not close the panel");
      ok(before === after, "E2 clicking a locked row does not change the selection");
      await page.keyboard.press("Escape");

      // agent model: locked on Forge LLM + Standard, Save disabled
      ok(body.includes("On Atlassian Forge LLM the agent model needs the Coder edition AND Claude Sonnet 5 or Opus 5"), "E2 agent-model upgrade line names BOTH requirements");
      // ...and it says it ONCE. The same fact repeated three times on one screen is what
      // the walk called noise; the status card carries the long form, this slot the short.
      /* F-991 - the count is DERIVED from the number of off states on the screen, not
         pinned at two. There are now three (key status, agent model, coder model) and the
         rule being asserted is unchanged: ONCE per off state, never repeated within one. */
      const OFF_STATES = 1 + AGENT_AND_CODER.length;
      ok((body.match(/needs the Coder edition AND Claude Sonnet 5 or Opus 5/g) || []).length === OFF_STATES,
        `E2 the frontier requirement is stated once per off state (want ${OFF_STATES}, got ${(body.match(/needs the Coder edition AND Claude Sonnet 5 or Opus 5/g) || []).length})`);
      /* ...and each slot names ITSELF in that sentence, so an admin reading three of them
         can tell which control each one is about. */
      for (const slot of AGENT_AND_CODER) {
        ok(body.includes(slot.forgeOffSentence), `E2 the ${slot.label} off state names its own slot`);
      }
      // Every off state on this screen carries its own real link.
      ok(await page.locator(".agent-off a.agent-off-link").count() === OFF_STATES,
        "E2 each model slot's note has a real link too");
      ok(!/[\u2013\u2014]/.test(body), "E2 no em dash or en dash anywhere on the Standard settings screen");
      await shot(page, `E2-standard-settings-${theme}`);
      ok(env.errors.length === 0, "E2 no page errors: " + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  ✗ E2 threw: " + e.message.split("\n")[0]); }
    await close(env);
  }
  /* ---------------- E1b — a Forge-LLM-ACTIVE Coder tenant: the meter ------------
     F-090's numbers (the 0-1 fraction rendered as 46%, the bar width, the notice copy)
     and F-091's "only a vendor-billed engine gets a meter" both live here, because
     after F-545 the meter follows the ACTIVE provider rather than the browsed one. */
  for (const theme of ["light", "dark"]) {
    console.log(`E1b Forge-LLM-active Coder tenant (${theme})`);
    const env = await openAdmin(browser, theme, false, false, { __PROVIDER__: "atlassian" });
    const { page } = env;
    try {
      await tab(page, "Settings");
      await page.locator(".usage-card").waitFor({ timeout: 10000 });
      ok(await page.locator(".usage-allowance").count() === 1, "E1b the Forge LLM allowance row renders");
      const allowText = await page.locator(".usage-allowance .usage-prov-val").innerText();
      ok(allowText.includes("of $200"), "E1b allowance shows est of allowance");
      /* F-090: `pct` is a fraction (0.462) and the panel must render 46%, not the 0%
         a bare Math.round produced. */
      ok(allowText.includes("46%"), `E1b allowance renders the real percentage (got "${allowText}")`);
      ok(!/\b0%/.test(allowText), `E1b allowance is not the 0% fraction bug (got "${allowText}")`);
      ok(await page.locator(".usage-allow-fill.lvl-ok").count() === 1, "E1b allowance bar at the ok level");
      const barW = await page.locator(".usage-allow-fill").first().evaluate((el) => el.style.width);
      ok(barW === "46%", `E1b allowance bar width matches the percentage (got ${barW})`);
      /* Forge LLM alone: one engine spent, so there is NO per-engine split. A 0-width
         bar for an engine the tenant never used is noise, not information. */
      ok(await page.locator(".usage-byengine").count() === 0,
        "E1b no per-engine split when only one engine spent");
      const body = await page.locator(".container").innerText();
      ok(body.includes("Monthly allowance: 46% used."), "E1b notice names the allowance percentage");
      await shot(page, `E1b-forge-active-${theme}`);
      ok(env.errors.length === 0, "E1b no page errors: " + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  \u2717 E1b threw: " + e.message.split("\n")[0]); }
    await close(env);
  }
  /* ---------------- E3 — UNLICENSED install: the chip must still say STANDARD ----
     F-106. A live install with no license object returns
     checkLicense -> { isActive: null, edition: "standard", label: "Standard", source: "none" }.
     Every app used to gate the chip on `licenseActive !== null`, so this tenant —
     the DEFAULT state of a development or unlisted install — saw no edition chip at
     all and could not tell which CogniRunner it was running. The chip gates on the
     EDITION now (always a real string); `isActive` is kept only for the license
     banner copy, which correctly stays silent when the license state is unknown. */
  for (const theme of ["light", "dark"]) {
    console.log(`E3 unlicensed install (${theme})`);
    const env = await openAdmin(browser, theme, false, true);
    const { page } = env;
    try {
      const chip = page.locator(".edition-chip");
      await chip.first().waitFor({ timeout: 10000 });
      ok(await chip.count() === 1, "E3 the unlicensed install still renders exactly one edition chip");
      ok((await chip.first().innerText()).trim().toLowerCase() === "standard", "E3 unlicensed chip reads Standard");
      ok(await page.locator(".edition-chip.edition-standard").count() === 1, "E3 unlicensed chip carries the standard class");
      const bg = await chip.first().evaluate((el) => getComputedStyle(el).backgroundColor);
      ok(bg === (theme === "dark" ? "rgb(100, 116, 139)" : "rgb(71, 85, 105)"), `E3 unlicensed chip slate hue per theme (got ${bg})`);
      ok(await chip.first().evaluate((el) => getComputedStyle(el).opacity) === "1", "E3 unlicensed chip is solid, not faded");
      /* isActive: null is UNKNOWN, not inactive. The banner makes a claim about the
         licence and must not make one here — neither "active" nor "inactive". */
      ok(await page.locator(".license-banner.license-inactive").count() === 0, "E3 no 'license inactive' banner on an unknown license");
      ok(await page.locator(".license-banner.license-active").count() === 0, "E3 no 'license active' banner on an unknown license");
      await shot(page, `E3-unlicensed-${theme}`);
      ok(env.errors.length === 0, "E3 no page errors: " + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  ✗ E3 threw: " + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ================= E4 — CogniRunner Cloud AI, the MANAGED engine ==============
     Plan 2.3/3.17. The managed engine is a Coder entitlement with no key and no URL:
     LeanZero runs it and pays the provider bill. Four things must hold, and each one
     is a defect this suite has to be able to see:
       a) Standard NEVER sees the row at all (not even as a locked upsell row).
       b) Coder + available: the row is selectable, there is NO key field and NO URL
          field, and the model picker offers exactly MANAGED_MODELS with the default
          marked.
       c) Coder + the deployment has no engine: the row is present but NON-SELECTABLE
          and carries the EXACT sentence from agentCapabilityCopy(reason) - imported
          from the one home, never retyped here, so a reworded remedy fails loudly
          instead of drifting.
       d) The allowance card is "Monthly allowance" (F-955) and splits into two SOLID bars when
          both vendor-billed engines spent. Colours are read COMPUTED, per theme.
       e) F-556: at level "hard" the note states the consequence of the ACTIVE engine -
          Forge LLM downgrades, the managed engine STOPS - and never the other one's. */
  {
    const {
      MANAGED_PROVIDER_ID, MANAGED_PROVIDER_LABEL, MANAGED_MODELS, MANAGED_DEFAULT_MODEL,
      agentCapabilityCopy, allowanceConsequenceCopy, allowanceApproachingCopy,
    } = await import("../../src/shared/edition.js");

    const openProviderPicker = async (page) => {
      await page.locator(".dropdown-trigger").first().click();
      await page.waitForTimeout(200);
    };
    const managedRow = (page) => page.locator(".dropdown-item", { hasText: MANAGED_PROVIDER_LABEL }).first();

    // ---- E4a Standard: the row does not exist -----------------------------
    for (const theme of ["light", "dark"]) {
      console.log(`E4a managed row absent on Standard (${theme})`);
      const env = await openAdmin(browser, theme, true);
      const { page } = env;
      try {
        await tab(page, "Settings");
        await page.waitForTimeout(400);
        await openProviderPicker(page);
        ok(await page.locator(".dropdown-item", { hasText: MANAGED_PROVIDER_LABEL }).count() === 0,
          "E4a Standard is offered no CogniRunner Cloud AI row");
        // and not as a locked/disabled upsell row either
        ok(await page.locator(".dropdown-item.dropdown-item-locked", { hasText: MANAGED_PROVIDER_LABEL }).count() === 0,
          "E4a Standard is not shown a locked managed row");
        await page.keyboard.press("Escape");
        await shot(page, `E4a-standard-no-managed-${theme}`);
        ok(env.errors.length === 0, "E4a no page errors: " + env.errors.join(" | "));
      } catch (e) { fail++; console.log("  ✗ E4a threw: " + e.message.split("\n")[0]); }
      await close(env);
    }

    // ---- E4b Coder + available: selectable, no key, no URL, models listed --
    for (const theme of ["light", "dark"]) {
      console.log(`E4b managed selectable on Coder (${theme})`);
      const env = await openAdmin(browser, theme, false);
      const { page } = env;
      try {
        await tab(page, "Settings");
        await page.waitForTimeout(400);
        await openProviderPicker(page);
        const row = managedRow(page);
        ok(await row.count() === 1, "E4b Coder is offered the CogniRunner Cloud AI row");
        ok(await page.locator(".dropdown-item.dropdown-item-locked", { hasText: MANAGED_PROVIDER_LABEL }).count() === 0,
          "E4b an available managed row is not disabled");
        await row.click();
        await page.waitForTimeout(600);

        // NO key field and NO URL field on this provider.
        ok(await page.locator("input[type=password]").count() === 0,
          "E4b the managed engine shows no API key field");
        const body = await page.locator(".container").innerText();
        ok(!/Azure Endpoint|LM Studio Public URL/.test(body),
          "E4b the managed engine shows no endpoint/URL field");

        /* F-591 — THE CONTRADICTION ARM. The managed panel used to render the correct
           "no API key and no endpoint to configure" line and, a few lines below it, the
           generic BYOK empty-key block: "No key configured" / "Provide your CogniRunner
           Cloud AI API key to get started" — asking for the one thing saveOpenAIKey refuses
           server-side. Both blocks now read the SAME `noKeyNeeded` predicate, so neither
           can come back alone. */
        ok(!/No key configured/i.test(body),
          "E4b the managed engine is never told 'No key configured'");
        ok(!/API key configured\. Provide your/i.test(body),
          "E4b the managed engine is never asked to provide an API key");
        ok(/no key needed/i.test(body),
          "E4b the managed status line says the engine needs no key");
        ok(await page.locator("input[placeholder*='sk-']").count() === 0,
          "E4b no key input of any placeholder on the managed engine");
        const dotIsError = await page.locator(".openai-status .status-dot").first().evaluate((el) => {
          const cs = getComputedStyle(el);
          const err = getComputedStyle(document.documentElement).getPropertyValue("--error-color").trim();
          // Resolve the token through a throwaway element so both sides are computed rgb().
          const probe = document.createElement("span");
          probe.style.color = err; document.body.appendChild(probe);
          const errRgb = getComputedStyle(probe).color; probe.remove();
          return cs.backgroundColor === errRgb;
        });
        ok(!dotIsError, "E4b the managed status dot is not the no-key error red");

        // The one-line data note.
        ok(/processed by\s+OpenRouter and Anthropic under LeanZero/i.test(body.replace(/\s+/g, " ")),
          "E4b the data note names OpenRouter and Anthropic under LeanZero's account");

        // Solid violet chip, per theme, read COMPUTED — never a faded tint.
        const chip = page.locator(".mg-note.mg-ok .mg-chip").first();
        ok(await chip.count() === 1, "E4b the available managed note carries a solid chip");
        const chipBg = await chip.evaluate((el) => getComputedStyle(el).backgroundColor);
        ok(chipBg === "rgb(124, 58, 237)",   // F-966: one violet, both themes
          `E4b managed chip violet per theme (got ${chipBg})`);
        ok(await chip.evaluate((el) => getComputedStyle(el).opacity) === "1",
          "E4b managed chip is solid, not faded");
        // The mandate: no left accent rail anywhere on this note.
        const rail = await page.locator(".mg-note").first().evaluate((el) => {
          const cs = getComputedStyle(el);
          return { l: cs.borderLeftWidth, t: cs.borderTopWidth };
        });
        ok(rail.l === rail.t, `E4b the managed note has no left accent rail (l=${rail.l} t=${rail.t})`);

        // Model picker: exactly MANAGED_MODELS, with the default marked.
        await page.locator(".dropdown-trigger").nth(1).click();
        await page.waitForTimeout(250);
        const items = await page.locator(".dropdown-panel .dropdown-item .dropdown-item-name").allInnerTexts();
        ok(JSON.stringify(items.map((t) => t.trim())) === JSON.stringify(MANAGED_MODELS),
          `E4b the model picker lists exactly MANAGED_MODELS (got ${JSON.stringify(items)})`);
        const dflt = page.locator(".dropdown-panel .dropdown-item", { hasText: MANAGED_DEFAULT_MODEL }).first();
        ok((await dflt.locator(".dropdown-item-badge").count()) === 1,
          "E4b the default managed model is marked with a badge");
        ok((await dflt.locator(".dropdown-item-badge").innerText()).trim().toLowerCase() === "default",
          "E4b the badge on the default managed model reads 'default'");
        await page.keyboard.press("Escape");
        await page.waitForTimeout(200);

        /* Agent AND Coder models on this provider: a CustomSelect with the SAME list,
           not free text. F-991 - the Coder slot is asserted as the agent slot's twin
           rather than trusted to have inherited the rule. */
        for (const slot of AGENT_AND_CODER) {
          const sel = page.locator(`[aria-label="${slot.ariaLabel}"]`);
          ok(await sel.count() >= 1, `E4b a ${slot.label} control exists on the managed engine`);
          const isInput = await page.locator(`input[aria-label="${slot.ariaLabel}"]`).count();
          ok(isInput === 0, `E4b the managed ${slot.label} is a CustomSelect, never a free-text input`);
        }
        await shot(page, `E4b-managed-available-${theme}`);
        ok(env.errors.length === 0, "E4b no page errors: " + env.errors.join(" | "));
      } catch (e) { fail++; console.log("  ✗ E4b threw: " + e.message.split("\n")[0]); }
      await close(env);
    }

    /* ---- E4b2 F-591 — THE OTHER SIDE OF THE SAME PREDICATE. Routing the key block through
       `noKeyNeeded` must leave a BYOK provider exactly as it was: a stored key still reads
       "Using your <provider> key" with the masked field and Remove Key, and a tenant with NO
       key still gets the nag AND the input to act on it. A gate that hides the key form for
       everyone would pass the managed arm above and break every paying tenant. */
    for (const [name, extra, wantNag] of [["byok-key", {}, false], ["byok-nokey", { __NOKEY__: true }, true]]) {
      console.log(`E4b2 BYOK unchanged (${name})`);
      const env = await openAdmin(browser, "light", false, false, extra);
      const { page } = env;
      try {
        await tab(page, "Settings");
        await page.waitForTimeout(500);
        const body = await page.locator(".container").innerText();
        if (wantNag) {
          ok(/No key configured/i.test(body), "E4b2 a keyless BYOK tenant is still told so");
          ok(await page.locator("input[type=password]").count() >= 1,
            "E4b2 a keyless BYOK tenant still gets a key input");
        } else {
          ok(/Using your .* key/i.test(body), "E4b2 a BYOK tenant with a key still reads 'Using your … key'");
          ok(!/No key configured/i.test(body), "E4b2 a BYOK tenant with a key is not nagged");
          ok(/Remove Key/.test(body), "E4b2 the stored-key form still offers Remove Key");
        }
        ok(env.errors.length === 0, "E4b2 no page errors: " + env.errors.join(" | "));
      } catch (e) { fail++; console.log("  ✗ E4b2 threw: " + e.message.split("\n")[0]); }
      await close(env);
    }

    /* ---- E4b3 F-603 - A FAILED KEY READ MUST NOT INHERIT THE LAST PROVIDER'S READINESS.
       The regression this pins: F-591 moved the key form's gate off the `isManaged` provider
       literal (recomputed every render, cannot go stale) and onto `noKeyNeeded` STATE written
       only inside `if (keyResult.success)`. So the managed engine's `noKeyNeeded:true` survived
       a failed load on the NEXT provider, and OpenAI rendered a green dot, "Managed by LeanZero
       - ready, no key needed", and NO key input at all - a failure reported as readiness, with
       no way to configure the provider the admin just picked short of a reload.
       The journey loads the managed engine FIRST (so the flag is genuinely set), then switches
       to OpenAI whose `getOpenAIKey` answers the real `{success:false}` refusal body. */
    for (const theme of ["light", "dark"]) {
      console.log(`E4b3 failed key read after a managed load (${theme})`);
      const env = await openAdmin(browser, theme, false, false,
        { __PROVIDER__: MANAGED_PROVIDER_ID, __KEYREAD_FAIL__: "openai" });
      const { page } = env;
      try {
        await tab(page, "Settings");
        await page.waitForTimeout(500);
        // Precondition: the managed engine really is in the "ready, no key needed" state.
        const before = await page.locator(".container").innerText();
        ok(/ready, no key needed/i.test(before),
          "E4b3 precondition - the managed engine loaded as ready with no key needed");
        ok(await page.locator("input[type=password]").count() === 0,
          "E4b3 precondition - the managed engine shows no key input");

        // Now switch to OpenAI, whose key read fails.
        await openProviderPicker(page);
        await page.locator(".dropdown-item", { hasText: /^\s*OpenAI\s*$/ }).first().click();
        await page.waitForTimeout(600);

        const body = await page.locator(".container").innerText();
        ok(!/Managed by LeanZero/i.test(body),
          "E4b3 OpenAI is NOT described as managed by LeanZero after a failed read");
        ok(!/ready, no key needed/i.test(body),
          "E4b3 a failed read never claims 'ready, no key needed'");
        ok(!/nothing to paste here/i.test(body),
          "E4b3 the managed 'nothing to paste here' copy does not survive the switch");
        // The whole point: the admin can still act.
        ok(await page.locator("input[type=password]").count() >= 1,
          "E4b3 the API key input IS rendered so the admin can configure OpenAI");
        // And the card says plainly that the status is unread, rather than asserting "no key".
        ok(/Couldn.t read key status/i.test(body),
          "E4b3 the status names the failed read");
        ok(!/No key configured/i.test(body),
          "E4b3 an unread status is never reported as the measurement 'No key configured'");
        const chip = page.locator("span", { hasText: /^STATUS UNREAD$/ }).first();
        ok(await chip.count() === 1, "E4b3 a solid failure chip is rendered");
        const chipBg = await chip.evaluate((el) => getComputedStyle(el).backgroundColor);
        ok(/^rgb\(/.test(chipBg) && !/rgba/.test(chipBg),
          `E4b3 the STATUS UNREAD chip is solid, not a faded tint (got ${chipBg})`);
        ok((await chip.evaluate((el) => getComputedStyle(el).color)) === "rgb(255, 255, 255)",
          "E4b3 the STATUS UNREAD chip carries white text");
        const rail = await chip.evaluate((el) => {
          const c = getComputedStyle(el);
          return { l: c.borderLeftWidth, t: c.borderTopWidth };
        });
        ok(rail.l === rail.t, `E4b3 the failure chip has no left accent rail (l=${rail.l} t=${rail.t})`);
        // The dot must be the error colour, not the success green it was a moment ago.
        const dotBg = await page.locator(".status-dot").first().evaluate((el) => getComputedStyle(el).backgroundColor);
        const okBg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--success-color").trim());
        ok(dotBg !== okBg, `E4b3 the status dot is not the ready green after a failed read (got ${dotBg})`);
        await shot(page, `E4b3-key-read-failed-${theme}`);
        ok(env.errors.length === 0, "E4b3 no page errors: " + env.errors.join(" | "));
      } catch (e) { fail++; console.log("  x E4b3 threw: " + e.message.split("\n")[0]); }
      await close(env);
    }

    // ---- E4c Coder + no engine on the deployment: disabled + EXACT copy ----
    for (const reasonFlag of ["__MANAGED_MISSING__", "__MANAGED_DISABLED__"]) {
      const reason = reasonFlag === "__MANAGED_MISSING__" ? "managed-key-missing" : "managed-disabled";
      const copy = agentCapabilityCopy(reason);
      for (const theme of ["light", "dark"]) {
        console.log(`E4c managed unavailable (${reason}, ${theme})`);
        const env = await openAdmin(browser, theme, false, false, { [reasonFlag]: true });
        const { page } = env;
        try {
          await tab(page, "Settings");
          await page.waitForTimeout(400);
          await openProviderPicker(page);
          const row = managedRow(page);
          ok(await row.count() === 1, `E4c the managed row is still shown when ${reason}`);
          ok(await row.evaluate((el) => el.classList.contains("dropdown-item-locked")),
            `E4c the managed row is NON-selectable when ${reason}`);
          ok(await row.getAttribute("aria-disabled") === "true",
            `E4c the managed row is aria-disabled when ${reason}`);
          // THE EXACT sentence, from the one copy home.
          const meta = (await row.locator(".dropdown-item-meta").innerText()).trim();
          ok(meta === copy.remedy,
            `E4c the disabled managed row carries the exact ${reason} remedy (got "${meta.slice(0, 60)}…")`);
          // Solid red "Unavailable" badge, computed, per theme.
          const badge = row.locator(".dropdown-item-badge").first();
          const bBg = await badge.evaluate((el) => getComputedStyle(el).backgroundColor);
          /* F-971 - ONE SHADE IN BOTH THEMES. This used to require the dark theme to
             LIGHTEN the fill to #ef4444, which is the pre-F-966 pattern: a lighter fill
             forces darker ink to stay legible, and the ink here had duly become #2a0707.
             F-966 settled that the chip hues do not move between themes and the ink is
             always white; this asserts that rule instead of the shade it replaced. */
          ok(bBg === "rgb(220, 38, 38)",
            `E4c the unavailable badge is the F-966 solid red, same in both themes (got ${bBg})`);
          const bFg = await badge.evaluate((el) => getComputedStyle(el).color);
          ok(/^rgba?\(255,\s*255,\s*255/.test(bFg),
            `E4c the unavailable badge ink is white in ${theme} (got ${bFg})`);
          ok(!/, 0\.\d+\)$/.test(bBg), "E4c the unavailable badge fill is opaque, never a tint");
          // Clicking it changes nothing.
          const before = await page.locator(".dropdown-trigger").first().innerText();
          await row.dispatchEvent("click");
          await page.waitForTimeout(200);
          ok(before === await page.locator(".dropdown-trigger").first().innerText(),
            `E4c clicking the disabled managed row does not switch provider (${reason})`);
          await page.keyboard.press("Escape");
          await shot(page, `E4c-managed-${reason}-${theme}`);
          ok(env.errors.length === 0, "E4c no page errors: " + env.errors.join(" | "));
        } catch (e) { fail++; console.log("  ✗ E4c threw: " + e.message.split("\n")[0]); }
        await close(env);
      }
    }

    // ---- E4d the allowance card: "Monthly allowance" + two solid bars ------
    for (const theme of ["light", "dark"]) {
      console.log(`E4d vendor allowance, both engines (${theme})`);
      /* F-545's actual defect shape: a Coder tenant whose ACTIVE provider IS the managed
         engine. That tenant used to see no meter at all and could ride to level "hard"
         with the only surface that explains the pause off screen. */
      const env = await openAdmin(browser, theme, false, false, { __PROVIDER__: "managed", __MANAGED_SPEND__: 48.6 });
      const { page } = env;
      try {
        await tab(page, "Settings");
        await page.locator(".usage-card").waitFor({ timeout: 10000 });

        const card = page.locator(".usage-allowance").first();
        ok(await card.count() === 1, "E4d the allowance card is shown on the managed engine");
        /* innerText, not textContent: `.usage-prov-name` carries text-transform:capitalize,
           so the rendered string is "Vendor Allowance". Compare case-insensitively rather
           than asserting the CSS-transformed casing, which is a styling choice. */
        /* F-955 renamed this row: "Vendor" is LeanZero's word for its own bill and
           appears nowhere the admin bought anything. The row is what they pay for. */
        ok((await card.locator(".usage-prov-name").first().innerText()).trim().toLowerCase() === "monthly allowance",
          "E4d the allowance card is titled 'Monthly allowance'");

        const split = page.locator(".usage-byengine").first();
        ok(await split.count() === 1, "E4d the per-engine split is rendered when both engines spent");
        const names = await split.locator(".usage-prov-name").allInnerTexts();
        ok(JSON.stringify(names.map((n) => n.trim())) === JSON.stringify(["Atlassian Forge LLM", "CogniRunner Cloud AI"]),
          `E4d both engines are named (got ${JSON.stringify(names)})`);
        ok(await split.locator(".usage-engine-fill").count() === 2, "E4d exactly two engine bars");

        const fBg = await split.locator(".eng-forge").evaluate((el) => getComputedStyle(el).backgroundColor);
        const mBg = await split.locator(".eng-managed").evaluate((el) => getComputedStyle(el).backgroundColor);
        ok(fBg === "rgb(37, 99, 235)", `E4d Forge LLM bar hue, one shade both themes (got ${fBg})`);   // F-966
        ok(mBg === "rgb(124, 58, 237)", `E4d managed bar hue, one shade both themes (got ${mBg})`);   // F-966
        for (const [nm, sel] of [["forge", ".eng-forge"], ["managed", ".eng-managed"]]) {
          ok(await split.locator(sel).evaluate((el) => getComputedStyle(el).opacity) === "1",
            `E4d the ${nm} bar is solid, not faded`);
          const w = await split.locator(sel).evaluate((el) => parseFloat(getComputedStyle(el).width));
          ok(w > 0, `E4d the ${nm} bar has a real width (got ${w})`);
        }
        await shot(page, `E4d-vendor-allowance-${theme}`);
        ok(env.errors.length === 0, "E4d no page errors: " + env.errors.join(" | "));
      } catch (e) { fail++; console.log("  ✗ E4d threw: " + e.message.split("\n")[0]); }
      await close(env);
    }

    /* ---- E4e F-556: the EXHAUSTED note states the consequence of the ACTIVE engine ----
       One ceiling covers both vendor-billed engines, but hitting it does not mean the
       same thing on each. Forge LLM DOWNGRADES to Haiku; the managed engine STOPS, and
       the panel used to promise the Haiku fallback to a managed tenant whose app had
       silently stopped validating anything. The sentences come from the one copy home,
       so they are compared against it rather than retyped here.
       $200 allowance (100 seats) against $92.40 forge + $120 managed = level "hard". */
    for (const theme of ["light", "dark"]) {
      for (const [engine, key] of [["managed", MANAGED_PROVIDER_ID], ["atlassian", "atlassian"]]) {
        console.log(`E4e exhausted allowance on ${engine} (${theme})`);
        const env = await openAdmin(browser, theme, false, false,
          { __PROVIDER__: key, __MANAGED_SPEND__: 120 });
        const { page } = env;
        try {
          await tab(page, "Settings");
          await page.locator(".usage-card").waitFor({ timeout: 10000 });
          const note = page.locator(".usage-allow-note.lvl-hard").first();
          ok(await note.count() === 1, `E4e the exhausted note is shown on ${engine}`);
          const txt = (await note.innerText()).trim();
          /* F-955 - the sentence now carries the DAY the allowance lifts where "next
             month" used to stand. Still compared against the one copy home, with the
             date the panel itself derives - NOT a date retyped here, which would pass
             against a panel that computed the wrong one. */
          const resetsOn = allowanceResetLabel(monthKey(Date.now()));
          ok(txt === allowanceConsequenceCopy(key, resetsOn),
            `E4e the ${engine} note is the exact sentence from the one copy home (got "${txt.slice(0, 70)}…")`);
          ok(txt.includes(resetsOn), `E4e ...and it names the reset day (${resetsOn})`);
          ok(!/until next month/.test(txt), "E4e ...so it never falls back to the dateless wording");
          ok(txt !== allowanceConsequenceCopy(engine === "managed" ? "atlassian" : MANAGED_PROVIDER_ID, resetsOn),
            `E4e ...and NOT the other engine's sentence (${engine})`);
          ok(!txt.includes("—"), `E4e no em-dash in the exhausted note (${engine})`);
          if (engine === "managed") {
            ok(!/fall back|Haiku/i.test(txt),
              "E4e the managed note never promises a Haiku fallback - there is none");
          } else {
            ok(/Haiku/.test(txt), "E4e the Forge LLM note still names the Haiku fallback, which is real");
          }
          /* Solid, not a faded tint, in BOTH themes - the note is the only surface that
             explains the pause, so it must read as a statement and not a whisper. */
          ok(await note.evaluate((el) => getComputedStyle(el).opacity) === "1",
            `E4e the exhausted note is solid, not faded (${engine}, ${theme})`);
          await shot(page, `E4e-allowance-hard-${engine}-${theme}`);
          ok(env.errors.length === 0, "E4e no page errors: " + env.errors.join(" | "));
        } catch (e) { fail++; console.log("  ✗ E4e threw: " + e.message.split("\n")[0]); }
        await close(env);
      }
    }

    /* ---- E4f F-895: THE AGENT PICKER NAMES THE RESOLVED MODEL, NEVER THE PLACEHOLDER ----
       Standard + Forge LLM. `getAgentModel` resolves FORGE_LLM_DEFAULT (Haiku) because no
       agent slot is saved and the chain's Forge LLM tail lands there. Haiku is deliberately
       absent from FORGE_LLM_FRONTIER, which the picker used as its whole option list - so
       CustomSelect matched nothing and rendered "Select an agent model...", and the admin
       concluded nothing was configured while every Coder and VA refusal named Haiku by name.
       Measured live in dev, light and dark.
       The fixture that makes this visible is in bridge.js: the mock used to answer "" here,
       which is an id the real resolver cannot produce. */
    {
      const { FORGE_LLM_DEFAULT } = await import("../../src/shared/edition.js");
      const expectedCopy = agentCapabilityCopy("needs-coder-edition");
      /* F-991 - BOTH SLOTS. The Coder picker resolves through the same chain and can
         land on the same out-of-frontier id, so the same defect - a placeholder painted
         over a model that is already running - is available to it verbatim. */
      for (const theme of ["light", "dark"]) {
       for (const slot of AGENT_AND_CODER) {
        console.log(`E4f Standard + Forge LLM ${slot.label.toLowerCase()} (${theme})`);
        const env = await openAdmin(browser, theme, true, false, { __PROVIDER__: "atlassian" });
        const { page } = env;
        try {
          await tab(page, "Settings");
          await page.waitForTimeout(600);
          const trigger = page.locator(`button.dropdown-trigger[aria-label="${slot.ariaLabel}"]`).first();
          ok(await trigger.count() === 1, `E4f the ${slot.label.toLowerCase()} picker is a CustomSelect trigger`);
          const label = (await trigger.innerText()).trim();
          ok(label.includes(FORGE_LLM_DEFAULT),
            `E4f the trigger shows the RESOLVED model (want ${FORGE_LLM_DEFAULT}, got "${label}")`);
          ok(label !== slot.select,
            `E4f the trigger is NOT the placeholder over a resolved model (got "${label}")`);

          // The reason, readable without opening the dropdown.
          const note = page.locator(`.${slot.fallbackNoteClass}`).first();
          ok(await note.count() === 1, "E4f the fallback reason note is rendered");
          const noteTxt = (await note.innerText()).trim();
          ok(noteTxt.startsWith(expectedCopy.title),
            `E4f the note opens with the ONE sentence from src/shared/edition.js (got "${noteTxt.slice(0, 70)}")`);
          ok(noteTxt.includes(FORGE_LLM_DEFAULT),
            `E4f the note names the resolved model (got "${noteTxt}")`);
          ok(!noteTxt.includes("—") && !noteTxt.includes("–"),
            "E4f no em/en dash in the fallback note");
          ok(await note.evaluate((el) => getComputedStyle(el).opacity) === "1",
            `E4f the fallback note is solid, not faded (${theme})`);
          /* The owner's standing refusal, asserted where a "status" note is exactly the
             shape someone reaches for a left rail to decorate. */
          const rail = await note.evaluate((el) => {
            const cs = getComputedStyle(el);
            return { l: cs.borderLeftWidth, t: cs.borderTopWidth };
          });
          ok(rail.l === rail.t, `E4f the fallback note has no left accent rail (l=${rail.l} t=${rail.t})`);
          await shot(page, `E4f-${slot.ariaLabel.toLowerCase().split(" ").join("-")}-fallback-${theme}`);

          // Open it: the resolved id is a row, and a LOCKED one - named, never offered.
          await trigger.click();
          await page.waitForTimeout(250);
          const row = page.locator(".dropdown-panel .dropdown-item", { hasText: FORGE_LLM_DEFAULT }).first();
          ok(await row.count() === 1, "E4f the resolved model is a row in the list");
          const cls = await row.getAttribute("class");
          ok(/dropdown-item-locked/.test(cls || ""),
            "E4f the resolved-but-unusable model row is LOCKED, not selectable");
          /* The sentence is NOT in the row's meta slot: that slot is a single-line
             ellipsised one and this panel is 320px, so it rendered as "Cod…" (measured).
             The row must therefore not carry one at all - the readable sentence is the
             note above, asserted while the dropdown was still shut. */
          ok(await row.locator(".dropdown-item-meta").count() === 0,
            "E4f the locked row carries no truncated sentence in the meta slot");
          const badge = row.locator(".dropdown-item-badge").first();
          ok(await badge.count() === 1, "E4f the locked row carries a badge");
          const badgeBg = await badge.evaluate((el) => getComputedStyle(el).backgroundColor);
          ok(/^rgb\(/.test(badgeBg) && !/rgba/.test(badgeBg),
            `E4f the badge fill is solid, not a faded tint (${theme}, got ${badgeBg})`);
          /* The panel is PORTALLED to document.body and fixed-positioned, so a fullPage
             shot does not contain it. Photograph the element itself. */
          if (SHOTS) {
            await page.locator(".dropdown-panel").first()
              .screenshot({ path: path.join(OUT, `E4f-${slot.ariaLabel.toLowerCase().split(" ").join("-")}-locked-row-${theme}.png`) });
          }
          await page.keyboard.press("Escape");
          ok(env.errors.length === 0, "E4f no page errors: " + env.errors.join(" | "));
        } catch (e) { fail++; console.log("  ✗ E4f threw: " + e.message.split("\n")[0]); }
        await close(env);
       }
      }
    }
  }
  /* ---------------- E5 - F-914: PRODUCT NAMES, and the Haiku-on-BYOK sentence -----------
     The usage rows printed the ids the backend stores, and a CSS capitalize turned
     "openai" into "Openai" - a name that exists nowhere except this screen. */
  for (const theme of ["light", "dark"]) {
    console.log(`E5 product names on the usage rows (${theme})`);
    const env = await openAdmin(browser, theme);
    const { page } = env;
    try {
      await tab(page, "Settings");
      await page.locator(".usage-card").waitFor({ timeout: 10000 });
      const names = (await page.locator(".usage-prov-name").allInnerTexts()).map((t) => t.trim());
      ok(names.includes("Anthropic") && names.includes("OpenAI") && names.includes("Atlassian (Forge LLM)"),
        `E5 ${theme} the usage rows name products, got ${JSON.stringify(names)}`);
      ok(!names.some((n) => /^Openai$|^openai$|^anthropic$|^atlassian$/.test(n)),
        `E5 ${theme} and no raw provider id survives, got ${JSON.stringify(names)}`);
      // The capitalize that produced "Openai" must not now mangle "OpenAI".
      const tt = await page.locator(".usage-prov-name").first().evaluate((el) => getComputedStyle(el).textTransform);
      ok(tt === "none", `E5 ${theme} the row no longer transforms its own text (got ${tt})`);
      await shot(page, `E5-product-names-${theme}`);
      ok(env.errors.length === 0, `E5 ${theme} no page errors: ` + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  x E5 threw: " + e.message.split("\n")[0]); }
    await close(env);
  }
  {
    /* E5b - the sentence that stops a pointless model change. Checked against
       agentCapability() in src/shared/edition.js, which returns `enabled: true` for any
       provider that is not Forge LLM WITHOUT looking at the model: Haiku really does
       drive an agent on a customer's own key. The negative control is the same screen
       with a frontier agent model, where the sentence must not appear. */
    const { agentCapability } = await import("../../src/shared/edition.js");
    const byokHaiku = agentCapability({ provider: "anthropic", edition: "standard", agentModel: "claude-haiku-4-5-20251001" });
    ok(byokHaiku.enabled === true && byokHaiku.reason === "byok",
      "E5b the CLAIM is true at its source: Haiku on a BYOK provider is enabled");

    console.log("E5b the Haiku-on-BYOK sentence");
    const env = await openAdmin(browser, "light", false, false, { __AGENT_MODEL__: "claude-haiku-4-5-20251001" });
    const { page } = env;
    try {
      await tab(page, "Settings");
      await page.locator(".usage-card").waitFor({ timeout: 10000 });
      await page.locator(".agent-haiku-note").first().waitFor({ timeout: 8000 });
      const note = (await page.locator(".agent-haiku-note").first().innerText()).trim();
      /* F-971 - this used to pin the sentence's exact words, which is the very defect
         the sentence exists to fix: one claim, spelled in two places. It now reads the
         one home and asserts the PROPERTY that matters - that the refusal names the
         engine it applies to, rather than stating a flat "Haiku never drives an agent"
         that is false on every BYOK provider. */
      const { HAIKU_ON_BYOK_SENTENCE: e5bWant } =
        await import("../admin-panel/src/components/productNames.js");
      ok(note === e5bWant.trim(), `E5b the note is the one home's sentence, got: ${note}`);
      ok(/Atlassian Forge LLM/.test(note), `E5b it names WHERE Haiku is refused, got: ${note}`);
      ok(!/Haiku never drives an agent/.test(note),
        "E5b ...and never the unqualified claim, which is false on a BYOK key");
      ok(!/[\u2013\u2014]/.test(note), "E5b no em dash or en dash in it");
      await shot(page, "E5b-haiku-byok");
      ok(env.errors.length === 0, "E5b no page errors: " + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  x E5b threw: " + e.message.split("\n")[0]); }
    await close(env);
  }
  {
    console.log("E5c negative control: a frontier BYOK agent model gets no Haiku sentence");
    const env = await openAdmin(browser, "light");
    const { page } = env;
    try {
      await tab(page, "Settings");
      await page.locator(".usage-card").waitFor({ timeout: 10000 });
      await page.waitForTimeout(600);
      ok(await page.locator(".agent-haiku-note").count() === 0, "E5c no Haiku sentence when the agent model is not Haiku");
      ok(env.errors.length === 0, "E5c no page errors: " + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  x E5c threw: " + e.message.split("\n")[0]); }
    await close(env);
  }
  /* ---------------- E6 - F-914: the model controls on the ACTIVE BYOK provider ----------
     The walk found a Model picker reading "Select a model..." with Save disabled while
     every rule on the site ran on a model. That pair is what a dead control looks like:
     nothing to read, nothing to press. It happens whenever the SAVED id is not in the
     live list the key returns, which is F-895's finding one picker higher up. */
  for (const theme of ["light", "dark"]) {
    console.log(`E6 a saved model outside the live list (${theme})`);
    const env = await openAdmin(browser, theme, false, false, { __SAVED_MODEL__: "claude-sonnet-5-20261101" });
    const { page } = env;
    try {
      await tab(page, "Settings");
      await page.locator(".usage-card").waitFor({ timeout: 10000 });
      const trigger = page.locator(".dropdown-trigger").nth(1);
      const shown = (await trigger.innerText()).trim();
      ok(shown.includes("claude-sonnet-5-20261101"), `E6 ${theme} the trigger shows the model in use, got: ${shown}`);
      ok(!/Select a model/.test(shown), `E6 ${theme} and never the placeholder over a live model`);
      const note = page.locator(".model-out-of-list-note");
      ok(await note.count() === 1, `E6 ${theme} the reason is readable without opening the dropdown`);
      ok((await note.first().innerText()).includes("Anthropic"), `E6 ${theme} and it names the provider by its product name`);
      ok(!/[\u2013\u2014]/.test(await note.first().innerText()), `E6 ${theme} no em dash or en dash in it`);
      // The row is LOCKED: it is already saved, so there is nothing to select or re-save.
      await trigger.click();
      await page.locator(".dropdown-panel").waitFor({ timeout: 5000 });
      const first = page.locator(".dropdown-panel .dropdown-item").first();
      ok((await first.innerText()).includes("claude-sonnet-5-20261101"), `E6 ${theme} the in-use model is the FIRST row`);
      ok((await first.getAttribute("aria-disabled")) === "true", `E6 ${theme} and it is locked, not offered`);
      const badgeBg = await page.locator(".dropdown-panel .dib-info").first().evaluate((el) => getComputedStyle(el).backgroundColor);
      ok(badgeBg === "rgb(15, 118, 110)", `E6 ${theme} its badge is the solid memories teal (one shade, both themes; got ${badgeBg})`);   // F-966
      await shot(page, `E6-model-out-of-list-${theme}`);
      await page.keyboard.press("Escape");
      ok(env.errors.length === 0, `E6 ${theme} no page errors: ` + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  x E6 threw: " + e.message.split("\n")[0]); }
    await close(env);
  }
  {
    console.log("E6b negative control: a saved model IN the list gets no extra row");
    const env = await openAdmin(browser, "light");
    const { page } = env;
    try {
      await tab(page, "Settings");
      await page.locator(".usage-card").waitFor({ timeout: 10000 });
      ok(await page.locator(".model-out-of-list-note").count() === 0, "E6b no out-of-list note when the saved model is listed");
      const shown = (await page.locator(".dropdown-trigger").nth(1).innerText()).trim();
      ok(shown.includes("claude-haiku-4-5-20251001"), `E6b the trigger still shows the saved model, got: ${shown}`);
      ok(env.errors.length === 0, "E6b no page errors: " + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  x E6b threw: " + e.message.split("\n")[0]); }
    await close(env);
  }
  {
    /* E6c - the agent-model placeholder is PER PROVIDER. It shipped as an OpenRouter id
       on every BYOK provider, including Anthropic, whose API rejects that format. */
    console.log("E6c per-provider agent-model placeholder");
    const env = await openAdmin(browser, "light");
    const { page } = env;
    try {
      await tab(page, "Settings");
      await page.locator(".usage-card").waitFor({ timeout: 10000 });
      /* F-955 - the box is now REACHED, not rendered by default: the agent model is a
         picker over the provider's live list and typing is the last row. The
         placeholder rule it is testing is unchanged, so the journey walks to it. */
      /* F-991 - BOTH typeable slots, ONE placeholder table. The Coder box is asserted
         here rather than trusted: a second placeholder table is exactly the shape the
         original defect had, and it would be invisible on the agent box alone. */
      for (const slot of AGENT_AND_CODER) {
        await openAgentTypingBox(page, slot.ariaLabel);
        const ph = await page.locator(`input[aria-label="${slot.ariaLabel}"]`).first().getAttribute("placeholder");
        ok(ph === "e.g. claude-sonnet-5", `E6c ${slot.label}: Anthropic gets an Anthropic id, got: ${ph}`);
        ok(!/anthropic\//.test(String(ph)), `E6c ${slot.label}: and never the OpenRouter namespaced form`);
      }
      ok(env.errors.length === 0, "E6c no page errors: " + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  x E6c threw: " + e.message.split("\n")[0]); }
    await close(env);
  }
  {
    /* ═══ E7 (F-957) — the seven amber/orange chips carry WHITE ink in BOTH themes ═══
       They used to paint near-black #2a1602 on a solid orange, two lines under a comment
       promising "solid saturated fill + white text". The assertion reads the LIVE CSSOM
       rather than one rendered chip, because five of the seven live behind a tab, a
       dropdown or a stalled job and a journey that only photographs the reachable ones
       would call the rest fixed without looking. Contrast is measured, not assumed. */
    console.log("E7 (F-957) amber/orange chips: white ink + AA contrast, both themes");
    const SELECTORS = [
      ".edition-chip.edition-advanced",
      ".port-status-needs-rebind",
      ".log-src-test",
      ".log-flag-capped",
      ".job-status.stalled",
      /* The probe must carry the class pair the DOM really uses: CustomSelect renders
         `dropdown-item-badge dib-<tone>`, and the white ink lives on the base class. */
      ".dropdown-item-badge.dib-edition",
    ];
    for (const theme of ["light", "dark"]) {
      const env = await openAdmin(browser, theme);
      const { page } = env;
      try {
        /* A PROBE ELEMENT, not a hand-rolled cascade: each selector is mounted as a real
           span carrying its classes and read with getComputedStyle, so the browser resolves
           the base rule, the variant rule and the dark override exactly as it does on the
           live chip. Five of these six live behind a tab, a dropdown or a stalled job, and
           a journey that only photographed the reachable ones would call the rest fixed. */
        const res = await page.evaluate((sels) => {
          const host = document.querySelector(".container") || document.body;
          const out = [];
          for (const sel of sels) {
            const el = document.createElement("span");
            el.className = sel.split(".").filter(Boolean).join(" ");
            el.textContent = "Ag";
            host.appendChild(el);
            const cs = getComputedStyle(el);
            out.push({ sel, bg: cs.backgroundColor, fg: cs.color });
            el.remove();
          }
          return out;
        }, SELECTORS);
        const rgb = (c) => { const m = String(c).match(/\d+/g); return m ? m.slice(0, 3).map(Number) : null; };
        const lum = (c) => { const v = c.map((x) => x / 255).map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4))); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
        for (const r of res) {
          const f = rgb(r.fg), b = rgb(r.bg);
          ok(!!f && !!b, `E7 ${theme} ${r.sel} resolves a fill and an ink (got ${r.bg} / ${r.fg})`);
          if (!f || !b) continue;
          ok(f[0] === 255 && f[1] === 255 && f[2] === 255, `E7 ${theme} ${r.sel} ink is WHITE, got ${r.fg}`);
          const L1 = Math.max(lum(f), lum(b)), L2 = Math.min(lum(f), lum(b));
          const ratio = (L1 + 0.05) / (L2 + 0.05);
          ok(ratio >= 4.5, `E7 ${theme} ${r.sel} white-on-fill is AA (${ratio.toFixed(2)}:1 on ${r.bg})`);
        }
        // ...and the one chip that is on screen without navigating really renders white.
        const live = await page.locator(".edition-chip").first().evaluate((el) => getComputedStyle(el).color);
        ok(/^rgba?\(255,\s*255,\s*255/.test(live), `E7 ${theme} the rendered edition chip is white, got ${live}`);
        /* A SHOT OF THE REAL CHIPS, not only of the header: the log source and flag chips
           live on the Execution Logs tab, which is where a reader meets the amber. */
        await tab(page, "Execution Logs");
        await page.locator(".tab-panel").first().waitFor({ timeout: 10000 });
        await shot(page, `f957-chips-${theme}`);
        ok(env.errors.length === 0, `E7 ${theme} no page errors: ` + env.errors.join(" | "));
      } catch (e) { fail++; console.log("  x E7 threw: " + e.message.split("\n")[0]); }
      await close(env);
    }
  }
  {
    /* ═══ E8 (F-957) — the tab strip never clips a label ═══
       F-916 made the strip one scrolling row. On macOS the scrollbar is an overlay and is
       not painted until something scrolls, so at a real Jira width the strip cut
       "Listeners" to "ners" with no visible affordance at all. It now wraps between
       GROUPS. The assertion is geometric: every button's box must sit inside the bar's
       box and must be wide enough for its own text, at the two widths where it broke. */
    console.log("E8 (F-957) tab strip: no clipped label at 1100 and 1280");
    for (const width of [1100, 1280]) {
      for (const theme of ["light", "dark"]) {
        const env = await openAdmin(browser, theme, false, false, {}, { width, height: 1200 });
        const { page } = env;
        try {
          await page.locator(".tab-bar").waitFor({ timeout: 10000 });
          const m = await page.evaluate(() => {
            const bar = document.querySelector(".tab-bar");
            const bb = bar.getBoundingClientRect();
            const btns = Array.from(bar.querySelectorAll(".tab-btn")).map((b) => {
              const r = b.getBoundingClientRect();
              return { label: b.textContent.trim(), left: r.left, right: r.right, w: r.width, sw: b.scrollWidth, cw: b.clientWidth };
            });
            return {
              barLeft: bb.left, barRight: bb.right, barScroll: bar.scrollWidth, barClient: bar.clientWidth,
              groups: bar.querySelectorAll(".tab-group").length, rows: new Set(Array.from(bar.querySelectorAll(".tab-btn")).map((b) => Math.round(b.getBoundingClientRect().top))).size,
              btns,
            };
          });
          ok(m.groups === 4, `E8 ${width} ${theme} the strip renders four groups, got ${m.groups}`);
          ok(m.barScroll <= m.barClient + 1, `E8 ${width} ${theme} the bar itself does not overflow (${m.barScroll} vs ${m.barClient})`);
          ok(m.rows <= 2, `E8 ${width} ${theme} at most two rows, got ${m.rows}`);
          for (const b of m.btns) {
            ok(b.sw <= b.cw + 1, `E8 ${width} ${theme} "${b.label}" is not clipped inside its button (${b.sw} vs ${b.cw})`);
            ok(b.left >= m.barLeft - 1 && b.right <= m.barRight + 1, `E8 ${width} ${theme} "${b.label}" sits inside the bar`);
          }
          const labels = m.btns.map((b) => b.label);
          ok(labels.includes("Listeners") && labels.includes("Rules"), `E8 ${width} ${theme} the clipped tabs are present in full, got ${JSON.stringify(labels)}`);
          await shot(page, `f957-tabstrip-${width}-${theme}`);
          ok(env.errors.length === 0, `E8 ${width} ${theme} no page errors: ` + env.errors.join(" | "));
        } catch (e) { fail++; console.log("  x E8 threw: " + e.message.split("\n")[0]); }
        await close(env);
      }
    }
  }
  {
    /* E9 (F-957) - the tab eyebrow lost its "§" glyph. */
    console.log("E9 (F-957) tab eyebrow carries no section glyph");
    const env = await openAdmin(browser, "light");
    const { page } = env;
    try {
      await tab(page, "Code");
      await page.locator(".tab-intro-eyebrow").first().waitFor({ timeout: 10000 });
      const t = (await page.locator(".tab-intro-eyebrow").first().innerText()).trim();
      ok(!t.includes("§"), `E9 no section sign in the eyebrow, got: ${t}`);
      ok(t.length > 0, "E9 the eyebrow still says something");
    } catch (e) { fail++; console.log("  x E9 threw: " + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ==================================================================
     E8 (F-955) - THE AGENT MODEL IS A PICKER, NOT A FREE-TEXT BOX.
     `Model` directly above has always been a CustomSelect over the list the
     provider's own key returns; the agent slot beside it was a text input, so a
     typo saved silently and surfaced hours later as a Coder turn refusing a model
     the admin believed they had configured. The control is now the same list plus
     a last row that reveals the box, and an id the list does not carry is SAID so
     - it is still accepted, because the list can be stale, invisible to a
     fine-grained key, or simply not carry an inference-profile id.
     ================================================================== */
  /* F-991 - AND THE SAME JOURNEY FOR THE CODER SLOT. Every assertion below is a rule
     about a model picker, not about the agent slot in particular, so the walk is taken
     TWICE with the slot's own aria label and its own "Pick from list" handle. A Coder
     picker that quietly shared the agent's state, lost the "Other" row, or offered a
     different list for the same key fails here and nowhere else. */
  for (const theme of ["light", "dark"]) {
   for (const slot of AGENT_AND_CODER) {
    console.log(`E7 ${slot.label.toLowerCase()} picker over the live list (${theme})`);
    const env = await openAdmin(browser, theme);
    const { page } = env;
    try {
      await tab(page, "Settings");
      await page.locator(".usage-card").waitFor({ timeout: 10000 });

      // (a) it is the app's own primitive, never a native <select> (owner mandate).
      const control = page.locator(`[aria-label="${slot.ariaLabel}"]`).first();
      const tagName = await control.evaluate((el) => el.tagName);
      ok(tagName !== "SELECT", `E7 the ${slot.label.toLowerCase()} is never a native select (got ${tagName})`);
      ok(await control.evaluate((el) => el.classList.contains("dropdown-trigger")),
        "E7 ...it is the app's CustomSelect trigger");

      // (b) the options ARE the provider's live list - the same array the rule-model
      //     picker renders - plus exactly one "Other" row, and nothing invented.
      await control.click();
      await page.waitForTimeout(200);
      /* Scoped to the OPEN panel: with two model pickers on this card an unscoped
         `.dropdown-item` sweeps rows belonging to the other one. */
      const labels = (await page.locator(".dropdown-panel .dropdown-item").allTextContents()).map((t) => t.trim());
      const { invoke: e7invoke } = await import("./bridge.js");
      const live = (await e7invoke("getOpenAIModels", { provider: "anthropic" })).models || [];
      for (const id of live) {
        ok(labels.some((l) => l.includes(id)), `E7 the live model ${id} is offered`);
      }
      ok(labels.filter((l) => l === "Other (type an id)").length === 1,
        `E7 exactly one "Other" row (got ${JSON.stringify(labels)})`);
      ok(labels[labels.length - 1] === "Other (type an id)", "E7 ...and it is the LAST row");
      await page.keyboard.press("Escape");

      // (c) the escape hatch still accepts any id - the earlier decision to allow
      //     typing is preserved, it just stopped being silent.
      await openAgentTypingBox(page, slot.ariaLabel);
      const box = page.locator(`input[aria-label="${slot.ariaLabel}"]`).first();
      ok(await box.count() === 1, "E7 the Other row reveals a text input");
      await box.fill("some-model-nobody-lists");
      await page.waitForTimeout(250);
      /* Scoped to THIS slot's block: the other slot carries a note of its own from the
         fixture, and an unscoped locator read it instead - which is how the negative
         control below passed against the wrong element on the first cut. */
      const note = page.locator(`.${slot.blockClass} .model-unlisted-note`).first();
      ok(await note.count() === 1, "E7 an unlisted id is called out");
      const noteTxt = (await note.innerText()).trim();
      ok(/not in the list your provider returned/.test(noteTxt),
        `E7 ...in the sentence that says why (got "${noteTxt}")`);
      ok(/refuse the first turn/.test(noteTxt), "E7 ...and what it will cost");
      ok(!noteTxt.includes("—"), "E7 no em-dash in the unlisted note");
      /* Solid and saturated in BOTH themes, never a faded tint (owner mandate). The
         hue is the map's caution amber, one shade lighter in dark. */
      ok(await note.evaluate((el) => getComputedStyle(el).opacity) === "1",
        `E7 the unlisted note is solid, not faded (${theme})`);
      const weight = await note.evaluate((el) => getComputedStyle(el).fontWeight);
      ok(Number(weight) >= 600, `E7 ...and 600+ weight (got ${weight})`);
      const colour = await note.evaluate((el) => getComputedStyle(el).color);
      ok(colour === (theme === "dark" ? "rgb(251, 191, 36)" : "rgb(180, 83, 9)"),
        `E7 ...in this theme's own amber (${theme}, got ${colour})`);

      // (d) SAVE IS NOT BLOCKED. The note is a warning, not a refusal.
      /* The Save beside the control, reached from the one element only this branch
         renders. `..` because "Pick from list" sits INSIDE the input's own wrapper
         and Save is the wrapper's sibling - an anchor on the button alone finds
         nothing, which is how this locator was wrong the first time. */
      const saveBtn = page.locator(`.${slot.pickBackClass}`)
        .locator("xpath=../following-sibling::button[1]").first();
      ok(await saveBtn.count() === 1, "E7 the Save button is beside the typed id");
      ok(!(await saveBtn.isDisabled()), "E7 an unlisted id can still be saved");

      // (e) NEGATIVE CONTROL: an id that IS in the live list draws no note at all.
      await box.fill(live[0]);
      await page.waitForTimeout(250);
      ok(await page.locator(`.${slot.blockClass} .model-unlisted-note`).count() === 0,
        `E7 a listed id (${live[0]}) draws no note in the ${slot.label}`);

      // (f) "Pick from list" returns to the picker and restores the SAVED id, never
      //     leaving a half-typed string standing where a resolved model belongs.
      await box.fill("half-typed-");
      await page.locator(`.${slot.pickBackClass}`).first().click();
      await page.waitForTimeout(250);
      ok(await page.locator(`input[aria-label="${slot.ariaLabel}"]`).count() === 0, "E7 the box closes");
      const back = (await page.locator(`[aria-label="${slot.ariaLabel}"]`).first().innerText()).trim();
      ok(!back.includes("half-typed-"), `E7 ...and the abandoned text is gone (got "${back}")`);

      /* F-991 - THE TWO SLOTS ARE NOT ONE PIECE OF STATE. The cheapest way to wire a
         second picker wrongly is to hand it the first one's value, and every assertion
         above would still pass. So: type into THIS slot and read the OTHER one back. */
      const other = AGENT_AND_CODER.find((o) => o !== slot);
      await openAgentTypingBox(page, slot.ariaLabel);
      await page.locator(`input[aria-label="${slot.ariaLabel}"]`).first().fill("only-this-slot");
      await page.waitForTimeout(250);
      const otherTxt = (await page.locator(`[aria-label="${other.ariaLabel}"]`).first().inputValue().catch(async () =>
        (await page.locator(`[aria-label="${other.ariaLabel}"]`).first().innerText()))).trim();
      ok(!otherTxt.includes("only-this-slot"),
        `E7 typing in the ${slot.label} does not change the ${other.label} (got "${otherTxt}")`);

      await shot(page, `E7-${slot.ariaLabel.toLowerCase().split(" ").join("-")}-picker-${theme}`);
      ok(env.errors.length === 0, "E7 no page errors: " + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  x E7 threw: " + e.message.split("\n")[0]); }
    await close(env);
   }
  }

  /* ==================================================================
     E8 (F-955) - THE ALLOWANCE SAYS WHEN IT COMES BACK.
     The meter read "Vendor allowance - $141 of $200 - 71%": LeanZero's word for
     its own bill, and no date at all, so an admin at 80% could not tell whether to
     wait a day or pay their way out. The 80% note had no consequence either.
     The date is DERIVED from `usage.month.key` through the shared helper, so this
     journey computes it the same way rather than hard-coding a day - a pinned date
     would pass against a panel computing the wrong one.
     ================================================================== */
  {
    const { MANAGED_PROVIDER_ID: E8_MANAGED, allowanceApproachingCopy: e8Approaching } =
      await import("../../src/shared/edition.js");
    for (const theme of ["light", "dark"]) {
      const resetsOn = allowanceResetLabel(monthKey(Date.now()));
      {
        console.log(`E8 allowance meter names its reset day (${theme})`);
        const env = await openAdmin(browser, theme, false, false, { __PROVIDER__: "atlassian" });
        const { page } = env;
        try {
          await tab(page, "Settings");
          await page.locator(".usage-card").waitFor({ timeout: 10000 });
          const row = page.locator(".usage-allowance .usage-prov-row").first();
          const txt = (await row.innerText()).trim();
          ok(/Monthly allowance/.test(txt), `E8 the row is named in the admin's words (got "${txt}")`);
          ok(!/Vendor allowance/.test(txt), "E8 ...never LeanZero's internal word for its own bill");
          ok(/used/.test(txt), "E8 the figures say what they ARE");
          ok(txt.includes(`resets ${resetsOn}`), `E8 ...and it names the reset day (${resetsOn}, got "${txt}")`);
          ok(!txt.includes("—"), "E8 no em-dash in the allowance row");
          const d = page.locator(".usage-allow-reset").first();
          ok(Number(await d.evaluate((el) => getComputedStyle(el).fontWeight)) >= 700,
            "E8 the date is emphasised, not buried");
          await shot(page, `E8-allowance-reset-${theme}`);
          ok(env.errors.length === 0, "E8 no page errors: " + env.errors.join(" | "));
        } catch (e) { fail++; console.log("  x E8 threw: " + e.message.split("\n")[0]); }
        await close(env);
      }
      /* E8b - the 80% note gains the date AND the consequence, in the SAME words the
         100% note uses. The distinction matters MORE here than at 100% because there
         is still time to act: on Forge LLM the app degrades to Haiku, on the managed
         engine it STOPS. Compared against the one copy home, never retyped. */
      for (const [engine, key] of [["atlassian", "atlassian"], ["managed", E8_MANAGED]]) {
        console.log(`E8b the 80% note states the consequence on ${engine} (${theme})`);
        const env = await openAdmin(browser, theme, false, false,
          { __PROVIDER__: key, __MANAGED_SPEND__: 75 });   // 92.40 + 75 of 200 = 84%, "soft"
        const { page } = env;
        try {
          await tab(page, "Settings");
          await page.locator(".usage-card").waitFor({ timeout: 10000 });
          const note = page.locator(".usage-allow-note.lvl-soft").first();
          ok(await note.count() === 1, `E8b the 80% note is shown on ${engine}`);
          const txt = (await note.innerText()).trim();
          ok(txt.includes(resetsOn), `E8b it names the reset day (${resetsOn}, got "${txt}")`);
          ok(!/vendor allowance/i.test(txt), "E8b ...and drops LeanZero's word");
          const consequence = e8Approaching(key, resetsOn);
          ok(txt.includes(consequence),
            `E8b ...and carries the consequence from the one copy home (want "${consequence}")`);
          ok(!txt.includes(e8Approaching(engine === "managed" ? "atlassian" : E8_MANAGED, resetsOn)),
            `E8b ...and NOT the other engine's consequence (${engine})`);
          if (engine === "managed") {
            ok(!/fall back|Haiku/i.test(txt),
              "E8b the managed 80% note never promises a Haiku fallback - there is none");
          } else {
            ok(/Haiku/.test(txt), "E8b the Forge LLM 80% note names the real Haiku fallback");
          }
          ok(!txt.includes("—"), "E8b no em-dash in the 80% note");
          ok(await note.evaluate((el) => getComputedStyle(el).opacity) === "1",
            `E8b the note is solid, not faded (${engine}, ${theme})`);
          await shot(page, `E8b-allowance-soft-${engine}-${theme}`);
          ok(env.errors.length === 0, "E8b no page errors: " + env.errors.join(" | "));
        } catch (e) { fail++; console.log("  x E8b threw: " + e.message.split("\n")[0]); }
        await close(env);
      }
    }
  }

  /* ==================================================================
     E9 (F-955) - THE PROVIDER CARD PAINTS ITS FRAME BEFORE THE VENDOR ANSWERS.
     MEASURED in this harness: with the vendor catalogue call held for 4.3 s (the
     staging figure), the card's section existed at ~60 ms and its first real
     control did not appear until ~4.38 s - seconds of skeleton bars over a layout
     that was already known. Only ONE mount read leaves Forge (getOpenAIModels asks
     the vendor for a catalogue); every other is a KVS get, which is why the REST
     card below never behaves this way. The frame now paints immediately and the
     app's own veil covers the value cells while the vendor answers.
     ================================================================== */
  for (const theme of ["light", "dark"]) {
    console.log(`E9 provider card frame-first under a slow vendor list (${theme})`);
    const env = await openAdmin(browser, theme, false, false, { __MODELS_DELAY_MS__: 4300 });
    const { page } = env;
    try {
      await tab(page, "Settings");
      const seen = await page.evaluate(async () => {
        const t0 = Date.now();
        const sec = () => [...document.querySelectorAll(".section")]
          .find((n) => /AI Provider Configuration/.test(n.textContent || ""));
        const m = { skeleton: false };
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
          const n = sec();
          if (n) {
            if (n.querySelector(".sk")) m.skeleton = true;
            if (m.veil === undefined && n.querySelector(".veil")) m.veil = Date.now() - t0;
            if (n.querySelector(".dropdown-trigger")) { m.frame = Date.now() - t0; break; }
          }
          await new Promise((r) => setTimeout(r, 20));
        }
        return m;
      });
      /* The number that matters: the frame arrives in a fraction of the vendor's
         4.3 s, not after it. Generous bound - this asserts "did not WAIT for the
         call", not a performance budget that would flake on a loaded machine. */
      ok(typeof seen.frame === "number" && seen.frame < 2000,
        `E9 the provider card's frame paints without waiting for the vendor (got ${seen.frame}ms of 4300)`);
      ok(seen.skeleton === false,
        "E9 ...so the card never falls back to skeleton bars for the vendor call");
      ok(typeof seen.veil === "number",
        `E9 ...and the value cells are veiled while it answers (got ${seen.veil})`);
      /* NEGATIVE CONTROL: the veil is not permanent - it lifts when the call lands,
         and the real values arrive. A frame that painted and never filled would
         satisfy every assertion above. */
      await page.waitForFunction(() => {
        const n = [...document.querySelectorAll(".section")]
          .find((x) => /AI Provider Configuration/.test(x.textContent || ""));
        return n && !n.querySelector(".veil");
      }, { timeout: 15000 });
      const shown = (await page.locator(".dropdown-trigger").nth(1).innerText()).trim();
      ok(shown.includes("claude-haiku-4-5-20251001"),
        `E9 the veil lifts onto the real model list (got "${shown}")`);
      await shot(page, `E9-provider-frame-first-${theme}`);
      ok(env.errors.length === 0, "E9 no page errors: " + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  x E9 threw: " + e.message.split("\n")[0]); }
    await close(env);
  }
  /* ---------------- E10 - F-971: the four things this card would not tell you ------
     A cold reviewer read this panel on staging and could not answer, from the screen:
     which model is running (the control was blank while calls were being booked), how
     far over the allowance the tenant was (a percentage clamped to 100 sat beside
     unclamped dollars and the two contradicted each other), why Haiku was locked
     (badged "Coder", promising an upgrade that would not open it), and how many calls
     "1 calls today" meant. Each assertion below reads the app's OWN one home for the
     expected value rather than a pinned string, so a correction in the home moves the
     test with it instead of failing for the right change.
     ================================================================== */
  {
    const { defaultModelForProvider } =
      await import("../../src/shared/model-resolution.js");
    const {
      agentModelLockReason, AGENT_MODEL_LOCK_BADGE, EDITION_IDS: E10_ED,
      FORGE_LLM_DEFAULT, FORGE_LLM_FRONTIER,
    } = await import("../../src/shared/edition.js");

    for (const theme of ["light", "dark"]) {
      /* --- E10a: NOTHING SAVED. The blank Model control, on a BYOK provider that is
         active and answering. The mock tenant is Anthropic-active, so the model the
         chain would pick is PROVIDER_DEFAULT_MODELS.anthropic - computed here through
         the same function the panel calls, never spelled out. */
      {
        console.log(`E10a blank model control names the fallback in effect (${theme})`);
        const env = await openAdmin(browser, theme, false, false, { __NO_SAVED_MODEL__: true });
        const { page } = env;
        try {
          await tab(page, "Settings");
          await page.locator(".usage-card").waitFor({ timeout: 10000 });
          const want = defaultModelForProvider("anthropic");
          ok(typeof want === "string" && want.length > 0,
            `E10a the shared chain names a default for the active provider (got ${want})`);

          const note = page.locator(".model-fallback-note").first();
          ok(await note.count() === 1, "E10a the blank-model note renders when nothing is saved");
          const noteTxt = (await note.innerText()).trim();
          ok(noteTxt.includes("No model chosen."),
            `E10a the note says nothing is chosen (got "${noteTxt}")`);
          ok(noteTxt.includes(want),
            `E10a ...and NAMES the model rules actually run on (want ${want}, got "${noteTxt}")`);
          ok(/until you pick one/.test(noteTxt),
            "E10a ...and says it is running NOW, not waiting on a choice");
          /* THE POINT of the note: the model id must be somewhere a reader can see it.
             Before F-971 no element on this card contained it at all. */
          const cardTxt = await page.locator(".section").filter({ hasText: "AI Provider Configuration" }).first().innerText();
          ok(cardTxt.includes(want),
            `E10a the running model appears on the provider card (want ${want})`);
          /* The picker's PLACEHOLDER names it too, so the control itself stops reading
             as "unconfigured" without the reader having to find the note. */
          const trigger = (await page.locator(".dropdown-trigger").nth(1).innerText()).trim();
          ok(trigger.includes(want),
            `E10a the Model control itself shows the fallback (got "${trigger}")`);

          /* SOLID SATURATED, WHITE INK, BOTH THEMES - the owner's standing rule, and the
             reason this note is a chip and not a faded tint. */
          const bg = await note.evaluate((el) => getComputedStyle(el).backgroundColor);
          const fg = await note.evaluate((el) => getComputedStyle(el).color);
          ok(bg === "rgb(180, 83, 9)", `E10a note is the F-966 solid amber (got ${bg})`);
          ok(/^rgba?\(255,\s*255,\s*255/.test(fg), `E10a note ink is white (got ${fg})`);
          ok(!/, 0\.\d+\)$/.test(bg), "E10a note fill is opaque, never a low-alpha tint");
          ok(Number(await note.evaluate((el) => getComputedStyle(el).fontWeight)) >= 600,
            "E10a note carries the weight of the labels around it");
          /* NEGATIVE CONTROL: no left accent rail, ever. */
          const lb = await note.evaluate((el) => getComputedStyle(el).borderLeftWidth);
          ok(lb === "0px", `E10a no left accent rail on the note (got ${lb})`);

          /* THE LABEL SAYS WHAT THE MODEL DRIVES (F-971 #7), so it cannot be read as a
             global default that the Agent model overrides. */
          ok(cardTxt.includes(MODEL_SLOT_COPY.model.label),
            "E10a the Model label names what it drives");

          /* F-991 - THREE SLOTS, THREE HONEST DESCRIPTIONS, ONE HOME. The card is read
             as a whole because the defect this replaces was a TRUE sentence in the wrong
             place: the agent block claimed the Coder turn, which was correct until the
             Coder got a slot of its own and then quietly was not. */
          for (const slot of AGENT_AND_CODER) {
            ok(cardTxt.includes(slot.label), `E10a the ${slot.label} control is on the card`);
            ok(cardTxt.includes(slot.drives), `E10a ...and says what it drives, from MODEL_SLOT_COPY`);
          }
          /* The retired claim, as a PROPERTY of the card: no surface may tell an admin
             that the agent model runs the Coder any more. */
          ok(!/[Aa]gent model[^.]*\bCoder\b[^.]*run/.test(cardTxt),
            "E10a nothing on the card still says the agent model runs the Coder");
          ok(MODEL_SLOT_COPY.agent.drives !== MODEL_SLOT_COPY.coder.drives,
            "E10a ...and the two slots do not share one description");
          /* POSITIVE CONTROL for the scan above, so a green result means "absent". */
          ok(/[Aa]gent model[^.]*\bCoder\b[^.]*run/.test("The agent model is the slot Coder and the Virtual Administrators run on"),
            "E10a ...and the scan can see that claim when it is present");

          /* F-971 - NO UNQUALIFIED HAIKU CLAIM ANYWHERE ON THIS CARD. Three surfaces in
             this repo asserted the Haiku limit and one of them (the Forge-LLM agent note)
             said "Haiku never does", which reads as a universal rule and contradicts the
             BYOK note a few lines above it. Scanned as a PROPERTY of the whole card, so a
             fourth surface growing the same sentence is caught too. */
          ok(!/Haiku never (drives|does)/.test(cardTxt),
            "E10a no unqualified \"Haiku never drives an agent\" claim on the provider card");
          /* POSITIVE CONTROL: the regex above really does match the sentence it is
             meant to forbid, so a green result means "absent", not "unmatchable". */
          ok(/Haiku never (drives|does)/.test("Only Sonnet 5 and Opus 5 can drive agents. Haiku never does."),
            "E10a ...and the scan can actually see that sentence when it is present");

          await shot(page, `E10a-blank-model-${theme}`);
          ok(env.errors.length === 0, "E10a no page errors: " + env.errors.join(" | "));
        } catch (e) { fail++; console.log("  x E10a threw: " + e.message.split("\n")[0]); }
        await close(env);
      }

      /* --- E10b: OVER THE CAP. 92.40 + 120.00 = 212.40 against a $200 ceiling: the
         reviewer's exact figure. The percentage must NOT appear (it clamps to 100 and
         would contradict the dollars); the overage must, in dollars, to two decimals. */
      {
        console.log(`E10b over-cap allowance states the overage, not 100% (${theme})`);
        const env = await openAdmin(browser, theme, false, false,
          { __PROVIDER__: "atlassian", __MANAGED_SPEND__: 120 });
        const { page } = env;
        try {
          await tab(page, "Settings");
          await page.locator(".usage-card").waitFor({ timeout: 10000 });
          const txt = (await page.locator(".usage-allowance .usage-prov-val").first().innerText()).trim();

          ok(txt.includes("$212.40"),
            `E10b the REAL dollars are shown, unclamped (got "${txt}")`);
          /* F-967 + F-971: two decimals, always. "$212.4" was the shipped defect. */
          ok(!/\$212\.4(?!\d)/.test(txt),
            `E10b money prints two decimals, never one (got "${txt}")`);
          ok(txt.includes("$200.00"),
            `E10b the ceiling prints two decimals too (got "${txt}")`);
          /* THE CONTRADICTION IS GONE: no percentage at all over cap. */
          ok(!/\(\d+%\)/.test(txt),
            `E10b no percentage beside unclamped dollars over cap (got "${txt}")`);
          ok(!/100%/.test(txt),
            `E10b specifically never "(100%)" next to $212.40 (got "${txt}")`);
          ok(/over by \$12\.40/.test(txt),
            `E10b ...the overage is stated in the same units instead (got "${txt}")`);

          const over = page.locator(".usage-allow-over").first();
          ok(await over.count() === 1, "E10b the overage is its own element");
          const obg = await over.evaluate((el) => getComputedStyle(el).backgroundColor);
          const ofg = await over.evaluate((el) => getComputedStyle(el).color);
          ok(obg === "rgb(220, 38, 38)", `E10b overage is the F-966 solid red (got ${obg})`);
          ok(/^rgba?\(255,\s*255,\s*255/.test(ofg), `E10b overage ink is white (got ${ofg})`);
          ok(Number(await over.evaluate((el) => getComputedStyle(el).fontWeight)) >= 700,
            "E10b the overage is the emphasised figure in the row");

          /* NEGATIVE CONTROL: the UNDER-cap row still shows its percentage. Removing the
             percentage everywhere would satisfy every assertion above and be a worse
             panel, so the clamped-but-honest case must be proved to still work. */
          ok(true, "E10b (see E1b: the under-cap row still renders 46%)");

          /* Two engines spent here, so the split renders - and each bar must NAME its
             denominator rather than showing a bare figure beside a bar. */
          ok(await page.locator(".usage-byengine").count() === 1,
            "E10b both engines spent, so the per-engine split renders");
          const engTxt = (await page.locator(".usage-byengine .usage-prov-val").first().innerText()).trim();
          ok(/of \$212\.40 spent/.test(engTxt),
            `E10b each engine bar names its denominator (got "${engTxt}")`);

          await shot(page, `E10b-over-cap-${theme}`);
          ok(env.errors.length === 0, "E10b no page errors: " + env.errors.join(" | "));
        } catch (e) { fail++; console.log("  x E10b threw: " + e.message.split("\n")[0]); }
        await close(env);
      }

      /* --- E10c: THE HAIKU BADGE. On Forge LLM + STANDARD the picker shows the resolved
         Haiku as a locked row plus the two locked frontier rows. Haiku is locked for a
         DIFFERENT reason from the other two, and before F-971 all three said "Coder".
         The expected words come from AGENT_MODEL_LOCK_BADGE, so this asserts the UI
         agrees with the policy rather than pinning a wording. */
      for (const slot of AGENT_AND_CODER) {
        /* F-991 - MEASURED ON BOTH PICKERS. The 320px constraint that clipped
           "Not an agent model" (src/shared/edition.js:520-534) is a property of the row,
           and the Coder picker is the same 320px row with the same badges - so the clip
           check is taken there too rather than inferred from the agent's result. */
        console.log(`E10c ${slot.label.toLowerCase()} rows are badged by REASON, not all "Coder" (${theme})`);
        /* Forge-LLM-ACTIVE and Standard, the same fixture E4f uses - browsing to Forge
           LLM from a BYOK-active tenant leaves other controls mid-transition and the
           agent picker is the one this journey needs settled. */
        const env = await openAdmin(browser, theme, true, false, { __PROVIDER__: "atlassian" });
        const { page } = env;
        try {
          await tab(page, "Settings");
          await page.waitForTimeout(600);

          /* The POLICY's own answers, for the three ids this picker renders. */
          const haikuLock = agentModelLockReason({ provider: "atlassian", edition: E10_ED.STANDARD, model: FORGE_LLM_DEFAULT });
          const sonnetLock = agentModelLockReason({ provider: "atlassian", edition: E10_ED.STANDARD, model: FORGE_LLM_FRONTIER[0] });
          ok(haikuLock === "not-agent-model",
            `E10c the policy locks Haiku as a NON-AGENT model, at any edition (got ${haikuLock})`);
          ok(sonnetLock === "needs-coder-edition",
            `E10c ...and locks Sonnet on the EDITION, which an upgrade does open (got ${sonnetLock})`);
          ok(AGENT_MODEL_LOCK_BADGE[haikuLock].text !== AGENT_MODEL_LOCK_BADGE[sonnetLock].text,
            "E10c the two reasons carry DIFFERENT words, which is the whole point");

          /* Open the AGENT picker (not the rule-model one above it) by its aria label,
             the same handle E4f uses for the trigger. */
          await page.locator(`button.dropdown-trigger[aria-label="${slot.ariaLabel}"]`).first().click();
          await page.waitForTimeout(400);
          /* Read the rows as TEXT rather than through per-row locators: on Standard the
             rows are disabled, and a disabled row is not a stable locator target. */
          const rows = await page.locator(".dropdown-panel .dropdown-item")
            .evaluateAll((els) => els.map((el) => (el.innerText || "").trim()));
          ok(rows.length > 0, `E10c the ${slot.label.toLowerCase()} picker opened with rows (got ${rows.length})`);
          const rowText = (id) => rows.find((r) => r.includes(id)) || "";

          const haikuTxt = rowText(FORGE_LLM_DEFAULT);
          ok(haikuTxt.length > 0, `E10c the Haiku row is rendered (rows: ${JSON.stringify(rows)})`);
          ok(haikuTxt.includes(AGENT_MODEL_LOCK_BADGE[haikuLock].text),
            `E10c the Haiku row is badged "${AGENT_MODEL_LOCK_BADGE[haikuLock].text}" (got "${haikuTxt}")`);
          ok(!/\bCoder\b/.test(haikuTxt),
            `E10c ...and NOT "Coder", which would promise an upgrade that does not open it (got "${haikuTxt}")`);

          const sonnetTxt = rowText(FORGE_LLM_FRONTIER[0]);
          ok(sonnetTxt.length > 0, `E10c the Sonnet row is rendered (rows: ${JSON.stringify(rows)})`);
          ok(sonnetTxt.includes(AGENT_MODEL_LOCK_BADGE[sonnetLock].text),
            `E10c the Sonnet row still reads "Coder", because an upgrade DOES open it (got "${sonnetTxt}")`);

          /* The badge TONES differ too, not just the words: the `tone` travels from
             AGENT_MODEL_LOCK_BADGE into the chip's class, so a future edit that
             re-unified the two reasons would show up here even if the text survived. */
          const badgeClasses = await page.locator(".dropdown-panel .dropdown-item-badge")
            .evaluateAll((els) => els.map((el) => el.className));
          ok(badgeClasses.some((c) => /dib-unavailable/.test(c)),
            `E10c the non-agent reason carries its own tone (got ${JSON.stringify(badgeClasses)})`);
          ok(badgeClasses.some((c) => /dib-edition/.test(c)),
            `E10c the edition reason keeps the edition tone (got ${JSON.stringify(badgeClasses)})`);
          /* SOLID SATURATED, WHITE INK - the badge is a chip and the owner's rule applies
             to it exactly as it does to the notes above. */
          const bChip = page.locator(".dropdown-panel .dropdown-item-badge").first();
          const bbg = await bChip.evaluate((el) => getComputedStyle(el).backgroundColor);
          const bfg = await bChip.evaluate((el) => getComputedStyle(el).color);
          ok(!/, 0\.\d+\)$/.test(bbg), `E10c badge fill is opaque, not a tint (got ${bbg})`);
          ok(/^rgba?\(255,\s*255,\s*255/.test(bfg), `E10c badge ink is white (got ${bfg})`);

          /* F-971 - NO CLIPPED BADGE. The first cut of this used "Not an agent model"
             and it rendered as "Not an agent mode" in a 320px row that already carries a
             26-character model id: a truncated word reads as a rendering fault and tells
             the admin nothing, which is worse than the wrong-but-whole "Coder" it
             replaced. Measured, not eyeballed, and in BOTH themes - the dark theme's
             font stack is the same but the selected row adds a state dot. */
          const clipped = await page.locator(".dropdown-panel .dropdown-item-badge")
            .evaluateAll((els) => els
              .filter((el) => el.scrollWidth > el.clientWidth + 1)
              .map((el) => `${el.textContent} (${el.scrollWidth}>${el.clientWidth})`));
          ok(clipped.length === 0,
            `E10c no ${slot.label.toLowerCase()} badge is clipped in ${theme} (got ${JSON.stringify(clipped)})`);

          await shot(page, `E10c-${slot.ariaLabel.toLowerCase().split(" ").join("-")}-badges-${theme}`);
          ok(env.errors.length === 0, "E10c no page errors: " + env.errors.join(" | "));
        } catch (e) { fail++; console.log("  x E10c threw: " + e.message.split("\n")[0]); }
        await close(env);
      }
    }

    /* --- E10d: THE PLURAL. One theme is enough - this is a copy rule, not a paint
       rule. The mock's usage counts are whatever the fixture holds, so the assertion
       is the RULE ("1" is followed by a singular noun, anything else by a plural),
       checked against every count the card prints, rather than a pinned sentence. */
    {
      console.log("E10d counts and their nouns agree");
      const env = await openAdmin(browser, "light", false);
      const { page } = env;
      try {
        await tab(page, "Settings");
        await page.locator(".usage-card").waitFor({ timeout: 10000 });
        const stats = await page.locator(".usage-stat").evaluateAll((els) =>
          els.map((el) => ({
            num: (el.querySelector(".usage-num") || {}).textContent || "",
            lbl: (el.querySelector(".usage-lbl") || {}).textContent || "",
          })));
        ok(stats.length === 4, `E10d the card prints four counts (got ${stats.length})`);
        for (const s of stats) {
          const n = Number(String(s.num).replace(/,/g, ""));
          const singular = /\b(call|token)\b/.test(s.lbl);
          if (n === 1) ok(singular, `E10d "1 ${s.lbl.trim()}" uses the singular noun`);
          else ok(!singular, `E10d "${s.num} ${s.lbl.trim()}" uses the plural noun`);
        }
        /* POSITIVE CONTROL for the helper itself: the rule is only worth asserting if a
           count of exactly 1 really does reach this card. The fixture's `today.calls` is
           the one that motivated the finding ("1 calls today"), so prove the shape is
           reachable rather than assuming the loop above saw it. */
        const todayCalls = stats[2] && Number(String(stats[2].num).replace(/,/g, ""));
        ok(Number.isFinite(todayCalls),
          `E10d the today-calls count is a number the rule was applied to (got ${stats[2] && stats[2].num})`);
        ok(!/\b1 calls\b/.test(await page.locator(".usage-card").innerText()),
          "E10d the card nowhere reads \"1 calls\"");
        await shot(page, "E10d-plurals-light");
        ok(env.errors.length === 0, "E10d no page errors: " + env.errors.join(" | "));
      } catch (e) { fail++; console.log("  x E10d threw: " + e.message.split("\n")[0]); }
      await close(env);
    }
  }
} finally {
  await browser.close();
}
console.log(`EDITIONS UI JOURNEYS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
