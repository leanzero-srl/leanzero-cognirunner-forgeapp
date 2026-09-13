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
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true }); };

async function openAdmin(browser, theme = "light", standard = false, unlicensed = false) {
  const root = ensureFreshBuildShot("admin-panel"); // F-125: never serve a bundle older than src/
  const { s, port } = await serve(root);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  await ctx.addInitScript(([th, std, unl]) => { window.__SHOT__ = "admin"; window.__THEME__ = th; if (std) window.__STANDARD__ = true; if (unl) window.__UNLICENSED__ = true; }, [theme, standard, unlicensed]);
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
  /* F-091: Standard gets an explicit null — the value the backend now sends. */
  globalThis.window.__STANDARD__ = true;
  const uStd = await invoke("getAiUsage");
  ok(uStd.forgeLlm === null, `E0 getAiUsage returns forgeLlm: null on Standard (got ${JSON.stringify(uStd.forgeLlm)})`);
  globalThis.window.__STANDARD__ = false;
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
    // Cut from the DISTINCTIVE tail instead — the clause after the first em-dash, which
    // carries the eviction policy and the remedy and belongs to this sentence alone.
    // Asserted explicitly rather than defaulted, so a rewording that drops the em-dash
    // fails loudly here instead of quietly producing a needle that guards nothing.
    const emDash = expected.indexOf("—");
    ok(emDash > 0, `E0 the cap refusal still has the em-dash clause the needle is cut from (got "${expected}")`);
    const NEEDLE = expected.slice(emDash + 1).trim();
    // The floor is well above 20 now. A short needle is what made F-195 possible: a
    // 20-character phrase is a phrase several sentences in this app can legitimately
    // share, and a gate that matches more than the thing it guards flags honest code.
    ok(NEEDLE.length > 40, `E0 the retype needle is long enough to be unique (${NEEDLE.length} chars: "${NEEDLE}")`);
    // And it must be specific to THIS refusal — the byte-guard variant is a different
    // sentence with the same owner, so a needle matching both guards neither precisely.
    ok(!memoryCapRefusalMessage("bytes").includes(NEEDLE),
      "E0 the needle is unique to the row-cap refusal — it must not also match the byte-guard one");
    const files = fs.readdirSync(__dirname)
      .filter((f) => f === "bridge.js" || f.endsWith(".test.mjs"));
    const offenders = [];
    for (const f of files) {
      const lines = fs.readFileSync(path.join(__dirname, f), "utf8").split("\n");
      lines.forEach((line, i) => {
        if (!line.includes(NEEDLE)) return;
        // The sentence may only appear where it is IMPORTED/derived, never as a literal.
        if (/\bmemoryCapRefusalMessage\b/.test(line)) return;
        offenders.push(`${f}:${i + 1}`);
      });
    }
    ok(offenders.length === 0,
      `E0 no harness line retypes the cap refusal — derive it from memoryCapRefusalMessage (offenders: ${offenders.join(", ")})`);
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
      // allowance meter — only now, on Forge LLM
      ok(await page.locator(".usage-allowance").count() === 1, "E1 Forge LLM allowance row renders");
      const allowText = await page.locator(".usage-allowance .usage-prov-val").innerText();
      ok(allowText.includes("of $200"), "E1 allowance shows est of allowance");
      /* F-090: the percentage is the real one. `pct` is a fraction (0.462) and the
         panel must render 46%, not the 0% a bare Math.round produced. */
      ok(allowText.includes("46%"), `E1 allowance row renders the real percentage (got "${allowText}")`);
      ok(!/\b0%/.test(allowText), `E1 allowance row is not the 0% fraction bug (got "${allowText}")`);
      ok(await page.locator(".usage-allow-fill.lvl-ok").count() === 1, "E1 allowance bar at the ok level");
      const barW = await page.locator(".usage-allow-fill").first().evaluate((el) => el.style.width);
      ok(barW === "46%", `E1 allowance bar width matches the percentage (got ${barW})`);
      const body = await page.locator(".container").innerText();
      ok(body.includes("Sonnet 5 and Opus 5 unlocked."), "E1 unlocked notice on Coder");
      ok(body.includes("Monthly allowance: 46% used."), "E1 notice names the allowance percentage");
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
      ok(body.includes("upgrade in Jira"), "E2 notice points at Manage apps");
      ok(body.includes("is not available on this edition — using Claude Haiku"), "E2 clamped-model line");

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
      ok(body.includes("On Forge LLM the agent model is part of CogniRunner Coder"), "E2 agent-model upgrade line");
      await shot(page, `E2-standard-settings-${theme}`);
      ok(env.errors.length === 0, "E2 no page errors: " + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  ✗ E2 threw: " + e.message.split("\n")[0]); }
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
} finally {
  await browser.close();
}
console.log(`EDITIONS UI JOURNEYS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
