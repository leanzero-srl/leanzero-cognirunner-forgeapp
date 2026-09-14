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
async function openAdmin(browser, theme = "light", standard = false, unlicensed = false, extra = {}) {
  const root = ensureFreshBuildShot("admin-panel"); // F-125: never serve a bundle older than src/
  const { s, port } = await serve(root);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
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
      ok(bg === (theme === "dark" ? "rgb(249, 115, 22)" : "rgb(194, 65, 12)"), `E1 chip solid hue per theme (got ${bg})`);
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
      ok(body.includes("Used by Coder and Virtual Administrators."), "E1 agent-model help text");
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
      ok(offLinkBg === (theme === "dark" ? "rgb(249, 115, 22)" : "rgb(194, 65, 12)"),
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
      ok(badgeBg === (theme === "dark" ? "rgb(249, 115, 22)" : "rgb(194, 65, 12)"), `E2 Coder badge solid hue per theme (got ${badgeBg})`);
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
      ok((body.match(/needs the Coder edition AND Claude Sonnet 5 or Opus 5/g) || []).length === 2,
        "E2 the frontier requirement is stated once per off state, not three times");
      // Two off states on this screen (key status + agent model), each with its own link.
      ok(await page.locator(".agent-off a.agent-off-link").count() === 2, "E2 the agent-model note has a real link too");
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
       d) The allowance card is "Vendor allowance" and splits into two SOLID bars when
          both vendor-billed engines spent. Colours are read COMPUTED, per theme.
       e) F-556: at level "hard" the note states the consequence of the ACTIVE engine -
          Forge LLM downgrades, the managed engine STOPS - and never the other one's. */
  {
    const {
      MANAGED_PROVIDER_ID, MANAGED_PROVIDER_LABEL, MANAGED_MODELS, MANAGED_DEFAULT_MODEL,
      agentCapabilityCopy, allowanceConsequenceCopy,
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
        ok(chipBg === (theme === "dark" ? "rgb(139, 92, 246)" : "rgb(124, 58, 237)"),
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

        // Agent model on this provider: a CustomSelect with the SAME list, not free text.
        const agentSel = page.locator('[aria-label="Agent model"]');
        ok(await agentSel.count() >= 1, "E4b an agent model control exists on the managed engine");
        const agentIsInput = await page.locator('input[aria-label="Agent model"]').count();
        ok(agentIsInput === 0, "E4b the managed agent model is a CustomSelect, never a free-text input");
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
          ok(bBg === (theme === "dark" ? "rgb(239, 68, 68)" : "rgb(220, 38, 38)"),
            `E4c the unavailable badge is solid red per theme (got ${bBg})`);
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

    // ---- E4d the allowance card: "Vendor allowance" + two solid bars -------
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
        ok((await card.locator(".usage-prov-name").first().innerText()).trim().toLowerCase() === "vendor allowance",
          "E4d the allowance card is titled 'Vendor allowance'");

        const split = page.locator(".usage-byengine").first();
        ok(await split.count() === 1, "E4d the per-engine split is rendered when both engines spent");
        const names = await split.locator(".usage-prov-name").allInnerTexts();
        ok(JSON.stringify(names.map((n) => n.trim())) === JSON.stringify(["Atlassian Forge LLM", "CogniRunner Cloud AI"]),
          `E4d both engines are named (got ${JSON.stringify(names)})`);
        ok(await split.locator(".usage-engine-fill").count() === 2, "E4d exactly two engine bars");

        const fBg = await split.locator(".eng-forge").evaluate((el) => getComputedStyle(el).backgroundColor);
        const mBg = await split.locator(".eng-managed").evaluate((el) => getComputedStyle(el).backgroundColor);
        ok(fBg === (theme === "dark" ? "rgb(59, 130, 246)" : "rgb(37, 99, 235)"), `E4d Forge LLM bar hue per theme (got ${fBg})`);
        ok(mBg === (theme === "dark" ? "rgb(139, 92, 246)" : "rgb(124, 58, 237)"), `E4d managed bar hue per theme (got ${mBg})`);
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
          ok(txt === allowanceConsequenceCopy(key),
            `E4e the ${engine} note is the exact sentence from the one copy home (got "${txt.slice(0, 70)}…")`);
          ok(txt !== allowanceConsequenceCopy(engine === "managed" ? "atlassian" : MANAGED_PROVIDER_ID),
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
      for (const theme of ["light", "dark"]) {
        console.log(`E4f Standard + Forge LLM agent model (${theme})`);
        const env = await openAdmin(browser, theme, true, false, { __PROVIDER__: "atlassian" });
        const { page } = env;
        try {
          await tab(page, "Settings");
          await page.waitForTimeout(600);
          const trigger = page.locator('button.dropdown-trigger[aria-label="Agent model"]').first();
          ok(await trigger.count() === 1, "E4f the agent model picker is a CustomSelect trigger");
          const label = (await trigger.innerText()).trim();
          ok(label.includes(FORGE_LLM_DEFAULT),
            `E4f the trigger shows the RESOLVED agent model (want ${FORGE_LLM_DEFAULT}, got "${label}")`);
          ok(!/Select an agent model/i.test(label),
            `E4f the trigger is NOT the placeholder over a resolved model (got "${label}")`);

          // The reason, readable without opening the dropdown.
          const note = page.locator(".agent-model-fallback-note").first();
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
          await shot(page, `E4f-agent-model-fallback-${theme}`);

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
              .screenshot({ path: path.join(OUT, `E4f-agent-model-locked-row-${theme}.png`) });
          }
          await page.keyboard.press("Escape");
          ok(env.errors.length === 0, "E4f no page errors: " + env.errors.join(" | "));
        } catch (e) { fail++; console.log("  ✗ E4f threw: " + e.message.split("\n")[0]); }
        await close(env);
      }
    }
  }
} finally {
  await browser.close();
}
console.log(`EDITIONS UI JOURNEYS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
