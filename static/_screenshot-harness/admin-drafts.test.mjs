/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 *
 * F-990 — UNFINISHED ADMIN WORK SURVIVES A RELOAD, AND CREDENTIALS DO NOT.
 *
 * Same shape as code-tab.test.mjs: the REAL admin-panel build with @forge/bridge aliased
 * to bridge.js, driven against canned resolver responses. What is different is that this
 * suite asserts on `localStorage` as well as on the DOM, because the defect this feature
 * can introduce is not visible on screen at all.
 *
 * The five journeys:
 *   D1  a draft survives page.reload() and Continue restores the values - INCLUDING with
 *       a deliberately slow admin check, because accountId arrives with that answer and
 *       a hook that keyed on null would key every admin on the machine to one row.
 *   D2  NO SECRET ANYWHERE. Sentinels are typed into the connection token and email, then
 *       the WHOLE of localStorage is read and searched. The non-secret siblings are
 *       asserted PRESENT in the same breath, because "nothing was saved at all" would
 *       pass a secrets check trivially and is the failure most likely to hide here.
 *   D3  Discard removes the key, removes the card, and a reload comes back clean.
 *   D4  a successful save clears, so the card never offers work that already exists.
 *   D5  the vocabulary is CLOSED: a source scan of both apps for `cr-draft:` literals and
 *       for useDraft( calls with a form id draft-state.js does not know.
 *   D6  the static-PF step case: save mid-generation, reload, restore, and the block is
 *       IDLE with its code present and nothing polling.
 *   D7  both copies of the hook and the card are byte-identical (duplication convention).
 *
 * Both themes for the card, because a new hue without a dark override is the standing
 * rule and only the eye catches it.
 *
 * Run:  node static/_screenshot-harness/admin-drafts.test.mjs   (add --shots for PNGs)
 */
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureFreshBuildShot } from "./lib/build-shot.mjs";
import { DRAFT_FORM_IDS, DRAFT_KEY_PREFIX } from "../../src/shared/draft-state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..", "..");
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
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log("  x " + msg); } };
const shot = async (page, name) => {
  if (!SHOTS) return;
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
};

const root = ensureFreshBuildShot("admin-panel");
const { s: server, port } = await serve(root);
const BASE = `http://127.0.0.1:${port}/`;

async function openAdmin(browser, theme = "light", extraInit = null) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await ctx.addInitScript(([th, extra]) => { window.__SHOT__ = "admin"; window.__THEME__ = th; if (extra) for (const k in extra) window[k] = extra[k]; }, [theme, extraInit]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e && e.message)));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!document.querySelector(".container") && !document.querySelector(".container .sk"), { timeout: 20000 }).catch(() => {});
  return { page, ctx, errors };
}
async function close(env) { await env.ctx.close(); }
const tab = (page, label) => page.locator(".tab-btn", { hasText: new RegExp(`^\\s*${label}\\s*$`) }).first().click();

/** The ENTIRE localStorage, keys and values, as one searchable blob. */
const wholeStorage = (page) => page.evaluate(() => {
  const out = {};
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    out[k] = window.localStorage.getItem(k);
  }
  return out;
});
const draftKeys = async (page) => Object.keys(await wholeStorage(page)).filter((k) => k.startsWith(DRAFT_KEY_PREFIX));
/* The hook debounces at 500 ms. Waiting 900 is the difference between asserting on the
   feature and asserting on a race. */
const settleWrite = (page) => page.waitForTimeout(900);

/* Open the Code tab and the add-connection form. Four journeys need exactly this, and a
   fifth copy of it is a fifth place a renamed button silently stops being clicked. */
async function openAddConnection(page) {
  await tab(page, "Code");
  await page.locator(".code-tab").waitFor({ timeout: 20000 });
  const addBtn = page.locator(".code-tab button", { hasText: /^\s*\+ Add connection\s*$/ }).first();
  await addBtn.waitFor({ timeout: 20000 });
  await addBtn.click();
  await page.locator("#code-label").waitFor({ timeout: 20000 });
}

const browser = await chromium.launch();
try {
  /* ───────────────── D1 — a draft survives a reload, Continue restores ──────────────── */
  for (const slow of [false, true]) {
    const label = slow ? "slow admin check" : "fast admin check";
    console.log(`D1 wizard draft survives a reload (${label})`);
    const env = await openAdmin(browser, "light", slow ? { __SLOW_ADMIN_MS__: 1500 } : null);
    const { page } = env;
    try {
      await tab(page, "Rules");
      await page.locator("button", { hasText: /\+ Add Rule/ }).first().click();
      await page.locator(".wizard-body").waitFor({ timeout: 15000 });
      /* With a slow check the panel is up but accountId is not: the hook must be inert. */
      if (slow) {
        ok((await draftKeys(page)).length === 0, `D1 ${label} nothing is written before accountId arrives`);
      }
      /* Walk to the configure step. The step cards are inline-styled buttons with no
         class of their own, so each hop is addressed by the FIXTURE's own name; a renamed
         fixture then fails this run instead of silently clicking the wrong card. */
      const pick = async (name) => {
        const b = page.locator(".wizard-body button", { hasText: new RegExp(name) }).first();
        await b.waitFor({ timeout: 15000 });
        await b.click();
        await page.waitForTimeout(500);
      };
      await pick("Demo Project");
      await pick("Software Simplified Workflow");
      await pick("Submit for Review");
      await pick("^\\s*Validator");
      const ta = page.locator(".wizard-body textarea").first();
      await ta.waitFor({ timeout: 15000 });
      const TYPED = "DRAFT-SENTINEL the summary must name the customer impact";
      await ta.fill(TYPED);
      await settleWrite(page);

      const keys = await draftKeys(page);
      ok(keys.length === 1, `D1 ${label} exactly one draft key is written, got ${JSON.stringify(keys)}`);
      ok(keys[0] && keys[0].endsWith(":" + DRAFT_FORM_IDS.ADD_RULE_WIZARD), `D1 ${label} it is the wizard's key: ${keys[0]}`);
      ok(keys[0] && keys[0].split(":").length === 3, `D1 ${label} the key has exactly three segments`);

      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => !!document.querySelector(".container"), { timeout: 20000 });
      await tab(page, "Rules");
      await page.locator("button", { hasText: /\+ Add Rule/ }).first().click();
      await page.locator(".wizard-body").waitFor({ timeout: 15000 });
      const card = page.locator(".draft-resume");
      await card.waitFor({ timeout: 15000 });
      ok(await card.count() === 1, `D1 ${label} the resume card is offered after the reload`);
      const cardText = await card.first().innerText();
      ok(/You have an unfinished rule from/.test(cardText), `D1 ${label} the card says what and when, got: ${cardText}`);
      ok(!/[–—]/.test(cardText), `D1 ${label} no em or en dashes in the card copy`);
      /* NOT automatic: before Continue, the form must still be empty. */
      ok(await page.locator(`.wizard-body textarea`).count() === 0
        || !(await page.locator(".wizard-body textarea").first().inputValue()).includes("DRAFT-SENTINEL"),
        `D1 ${label} nothing is restored until Continue is clicked`);
      await shot(page, `d1-resume-card-${slow ? "slow" : "fast"}`);
      await page.locator(".draft-resume-continue").click();
      await page.waitForTimeout(800);
      const restored = await page.locator(".wizard-body textarea").first().inputValue();
      ok(restored === TYPED, `D1 ${label} Continue restores the typed value, got: ${restored}`);
      ok(await page.locator(".draft-resume").count() === 0, `D1 ${label} and the card goes away`);
      ok(env.errors.length === 0, `D1 ${label} no page errors: ${env.errors.join(" | ")}`);
    } finally { await close(env); }
  }

  /* ───────────── D1b — the card in BOTH themes, a solid block with white text ───────── */
  for (const theme of ["light", "dark"]) {
    console.log(`D1b resume card hue (${theme})`);
    const env = await openAdmin(browser, theme);
    const { page } = env;
    try {
      await openAddConnection(page);
      await page.locator("#code-label").fill("Acme engineering");
      await settleWrite(page);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => !!document.querySelector(".container"), { timeout: 20000 });
      await openAddConnection(page);
      const card = page.locator(".draft-resume").first();
      await card.waitFor({ timeout: 15000 });
      const styles = await card.evaluate((el) => {
        const cs = getComputedStyle(el);
        const t = el.querySelector(".draft-resume-title");
        const ts = getComputedStyle(t);
        const cont = getComputedStyle(el.querySelector(".draft-resume-continue"));
        return {
          bg: cs.backgroundColor, color: ts.color, weight: ts.fontWeight,
          bl: cs.borderLeftWidth, contBg: cont.backgroundColor, contColor: cont.color,
        };
      });
      const expected = theme === "dark" ? "rgb(59, 130, 246)" : "rgb(37, 99, 235)";
      ok(styles.bg === expected, `D1b ${theme} the card is the solid hue ${expected}, got ${styles.bg}`);
      ok(styles.color === "rgb(255, 255, 255)", `D1b ${theme} white text, got ${styles.color}`);
      ok(Number(styles.weight) >= 600, `D1b ${theme} 600 or heavier, got ${styles.weight}`);
      ok(styles.bl === "0px", `D1b ${theme} NO left rail, got border-left ${styles.bl}`);
      ok(styles.contBg === "rgb(255, 255, 255)", `D1b ${theme} Continue is a solid white button, got ${styles.contBg}`);
      ok(!/rgba\(.*0\.\d/.test(styles.bg), `D1b ${theme} the block is not a low-alpha tint`);
      await shot(page, `d1b-card-${theme}`);
      ok(env.errors.length === 0, `D1b ${theme} no page errors: ${env.errors.join(" | ")}`);
    } finally { await close(env); }
  }

  /* ─────────── D2 — NO SECRET ANYWHERE, and the siblings really are there ───────────── */
  {
    console.log("D2 secrets never reach storage");
    const env = await openAdmin(browser, "light");
    const { page } = env;
    try {
      await openAddConnection(page);
      /* Bitbucket, because that is the kind whose form ALSO shows the paired email; the
         email is a second thing that must never be written down and it does not exist on
         the GitHub form at all. */
      await page.locator(".code-form .dropdown-trigger").first().click();
      await page.locator(".dropdown-item", { hasText: /Bitbucket/i }).first().click();
      await page.locator("#code-email").waitFor({ timeout: 10000 });
      await page.locator("#code-label").fill("Acme engineering");
      await page.locator("#code-repos").fill("acme/api, acme/web");
      await page.locator("#code-token").fill("ghp_SENTINELTOKEN0123456789abcdef");
      await page.locator("#code-email").fill("sentinel-email@example.com");
      await page.locator("#code-label").click();   // blur, so the repo list normalises
      await settleWrite(page);

      const store = await wholeStorage(page);
      const blob = JSON.stringify(store);
      ok(!/SENTINELTOKEN/.test(blob), "D2 the connection token appears NOWHERE in localStorage");
      ok(!/ghp_/.test(blob), "D2 and neither does its prefix");
      ok(!/sentinel-email@example\.com/.test(blob), "D2 the paired email appears nowhere either");
      // and the whole point: the harmless part IS kept.
      ok(/Acme engineering/.test(blob), "D2 the label IS saved");
      ok(/acme\/api/.test(blob), "D2 the repo allowlist IS saved");
      const dk = Object.keys(store).filter((k) => k.startsWith(DRAFT_KEY_PREFIX));
      ok(dk.length >= 1, "D2 a draft was actually written (a no-op would pass the secret check trivially)");
      const parsed = JSON.parse(store[dk.find((k) => k.endsWith(DRAFT_FORM_IDS.CODE_CONNECTION))]);
      ok(!("token" in parsed.data) && !("email" in parsed.data), "D2 neither field name is even present in the payload");
      ok(parsed.data.kind === "bitbucket", `D2 the provider kind is kept, got ${parsed.data.kind}`);
      ok(typeof parsed.v === "number" && typeof parsed.savedAt === "number", "D2 the payload carries a version and a timestamp");
      await shot(page, "d2-no-secrets");
      ok(env.errors.length === 0, `D2 no page errors: ${env.errors.join(" | ")}`);
    } finally { await close(env); }
  }

  /* ─────────────────── D3 — Discard clears the key, the card and the reload ─────────── */
  {
    console.log("D3 Discard clears");
    const env = await openAdmin(browser, "light");
    const { page } = env;
    try {
      await openAddConnection(page);
      await page.locator("#code-label").fill("To be discarded");
      await settleWrite(page);
      ok((await draftKeys(page)).length === 1, "D3 a draft exists before the discard");

      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => !!document.querySelector(".container"), { timeout: 20000 });
      await openAddConnection(page);
      await page.locator(".draft-resume").first().waitFor({ timeout: 15000 });
      /* No native confirm may appear. If one did, this handler would fire and the count
         would be non-zero; without a handler Playwright auto-dismisses and the assert on
         the key would still pass, so the dialog itself is what is counted. */
      let dialogs = 0;
      page.on("dialog", async (d) => { dialogs++; await d.dismiss(); });
      await page.locator(".draft-resume-discard").click();
      await page.waitForTimeout(400);
      ok(dialogs === 0, "D3 Discard reaches for NO native confirm");
      ok(await page.locator(".draft-resume").count() === 0, "D3 the card is gone at once");
      ok((await draftKeys(page)).length === 0, "D3 and the key is gone from storage");

      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => !!document.querySelector(".container"), { timeout: 20000 });
      await openAddConnection(page);
      await page.waitForTimeout(700);
      ok(await page.locator(".draft-resume").count() === 0, "D3 the reload comes back clean");
      ok((await draftKeys(page)).length === 0, "D3 and nothing was re-written by the pristine form");
      ok(env.errors.length === 0, `D3 no page errors: ${env.errors.join(" | ")}`);
    } finally { await close(env); }
  }

  /* ───────────────── D4 — a successful save clears the draft ────────────────────────── */
  {
    console.log("D4 save clears the draft");
    const env = await openAdmin(browser, "light");
    const { page } = env;
    try {
      await openAddConnection(page);
      await page.locator("#code-label").fill("Saved connection");
      await page.locator("#code-token").fill("ghp_realenoughtoken0123456789");
      await settleWrite(page);
      ok((await draftKeys(page)).length === 1, "D4 a draft exists before the save");
      await page.locator(".code-save-conn").click();
      await page.waitForTimeout(1200);
      ok((await draftKeys(page)).length === 0, "D4 the successful save cleared the draft");

      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => !!document.querySelector(".container"), { timeout: 20000 });
      await openAddConnection(page);
      await page.waitForTimeout(700);
      ok(await page.locator(".draft-resume").count() === 0, "D4 and the reload offers no card for work that already exists");
      ok(env.errors.length === 0, `D4 no page errors: ${env.errors.join(" | ")}`);
    } finally { await close(env); }
  }

  /* ─── D6 — the static-PF step: mid-generation is not a thing a draft can restore ───── */
  {
    console.log("D6 a static PF step restores idle, with its code, and polls nothing");
    const env = await openAdmin(browser, "light");
    const { page } = env;
    try {
      const openWizardTo = async (p) => {
        await tab(p, "Rules");
        await p.locator("button", { hasText: /\+ Add Rule/ }).first().click();
        await p.locator(".wizard-body").waitFor({ timeout: 20000 });
        const pick = async (name) => {
          const b = p.locator(".wizard-body button", { hasText: new RegExp(name) }).first();
          await b.waitFor({ timeout: 20000 }); await b.click(); await p.waitForTimeout(500);
        };
        await pick("Demo Project");
        await pick("Software Simplified Workflow");
        await pick("Submit for Review");
        await pick("Static Post Function");
      };
      await openWizardTo(page);
      const describe = page.locator(".wizard-body textarea.textarea").first();
      await describe.waitFor({ timeout: 20000 });
      await describe.fill("Comment on every duplicate summary in this project");
      await page.locator(".btn-generate").first().click();
      /* The mock answers synchronously, so the code lands and the debounce then writes a
         draft that HAS it. That is the half worth keeping. */
      await page.locator(".cm-content, .code-editor").first().waitFor({ timeout: 20000 });
      await settleWrite(page);
      const stored = await wholeStorage(page);
      const blob = JSON.stringify(stored);
      /* Read the PAYLOAD, not the blob: the values in localStorage are themselves JSON, so
         a naive /"functions"/ over the stringified store never matches its own escaping. */
      const wizKey = Object.keys(stored).find((k) => k.endsWith(DRAFT_FORM_IDS.ADD_RULE_WIZARD));
      ok(!!wizKey, "D6 the wizard wrote a draft");
      const wizData = JSON.parse(stored[wizKey]).data;
      ok(Array.isArray(wizData.functions) && wizData.functions.length === 1, "D6 the step array is in the draft");
      const step = wizData.functions[0];
      ok(/duplicate summary/.test(step.operationPrompt || ""), "D6 with the description that was typed");
      ok(/api\./.test(step.code || ""), "D6 and the code that was generated");
      ok(!/taskId/i.test(blob), "D6 no task id of any kind is in the draft");
      ok(!/isGenerating|generating|polling/i.test(blob), "D6 and no in-flight or polling flag either");
      for (const k of Object.keys(step)) {
        ok(!/token|taskid|secret|bearer/i.test(k), `D6 the step carries no in-flight or secret-shaped field: ${k}`);
      }

      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => !!document.querySelector(".container"), { timeout: 20000 });
      await openWizardTo(page);
      await page.locator(".draft-resume").first().waitFor({ timeout: 20000 });
      await page.evaluate(() => { window.__CALLS__ = []; });   // count only what the RESTORE does
      await page.locator(".draft-resume-continue").click();
      await page.waitForTimeout(2500);

      const restoredPrompt = await page.locator(".wizard-body textarea.textarea").first().inputValue();
      ok(restoredPrompt.includes("duplicate summary"), `D6 the description came back, got: ${restoredPrompt}`);
      ok(await page.locator(".cm-content, .code-editor").count() > 0, "D6 the generated code came back with it");
      /* IDLE: the AI loading state is what a block in flight renders, and a restored block
         must never render it. This is the orphan-poll symptom a reader would actually see. */
      ok(await page.locator(".ai-loading, .aen-retry").count() === 0, "D6 the block is IDLE, with no AI loading state");
      ok(await page.locator(".btn-generate").first().isEnabled(), "D6 and Generate is live again rather than stuck busy");
      const polls = await page.evaluate(() => (window.__CALLS__ || []).filter((c) => c.name === "getAsyncTaskResult").length);
      ok(polls === 0, `D6 NOTHING polls getAsyncTaskResult after a restore, got ${polls} calls`);
      const gens = await page.evaluate(() => (window.__CALLS__ || []).filter((c) => c.name === "generatePostFunctionCode").length);
      ok(gens === 0, `D6 and the restore does not silently re-generate, got ${gens} calls`);
      await shot(page, "d6-static-pf-restored");
      ok(env.errors.length === 0, `D6 no page errors: ${env.errors.join(" | ")}`);
    } finally { await close(env); }
  }
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}

/* ───────────────── D5 — the vocabulary is closed (a source scan) ───────────────────── */
console.log("D5 the draft vocabulary is closed");
{
  const KNOWN = new Set(Object.values(DRAFT_FORM_IDS));
  const APPS = ["config-ui", "admin-panel", "config-view", "issue-glance"];
  const files = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) { if (!["node_modules", "build", "build-shot"].includes(e.name)) walk(path.join(dir, e.name)); continue; }
      if (/\.(js|jsx)$/.test(e.name)) files.push(path.join(dir, e.name));
    }
  };
  for (const app of APPS) walk(path.join(REPO, "static", app, "src"));
  ok(files.length > 50, `D5 the scan actually found sources (${files.length} files) - an empty scan passes everything`);

  let literalHomes = [];
  let badIds = [];
  let hookCalls = 0;
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    if (src.includes(`"${DRAFT_KEY_PREFIX}`) || src.includes(`'${DRAFT_KEY_PREFIX}`) || src.includes(`\`${DRAFT_KEY_PREFIX}`)) literalHomes.push(path.relative(REPO, f));
    for (const m of src.matchAll(/useDraft\(\s*("([^"]*)"|'([^']*)')/g)) {
      hookCalls++;
      const id = m[2] !== undefined ? m[2] : m[3];
      if (!KNOWN.has(id)) badIds.push(`${path.relative(REPO, f)}: ${JSON.stringify(id)}`);
    }
  }
  ok(literalHomes.length === 0,
    `D5 no frontend retypes the "${DRAFT_KEY_PREFIX}" prefix; draftKey is the one home. Offenders: ${literalHomes.join(", ")}`);
  ok(badIds.length === 0, `D5 every useDraft() literal is in DRAFT_FORM_IDS. Offenders: ${badIds.join(", ")}`);
  // Every wiring in the repo goes through the enum, so a bare literal is itself the smell.
  ok(hookCalls === 0, `D5 no useDraft() call passes a bare string literal at all; they all read DRAFT_FORM_IDS (${hookCalls} found)`);
}

/* ───────────────── D7 — the duplication convention holds ──────────────────────────── */
console.log("D7 the copied files are byte-identical");
for (const rel of ["components/useDraft.js", "components/DraftResumeCard.jsx"]) {
  const a = fs.readFileSync(path.join(REPO, "static", "config-ui", "src", rel));
  const b = fs.readFileSync(path.join(REPO, "static", "admin-panel", "src", rel));
  ok(a.equals(b), `D7 ${rel} is byte-identical between config-ui and admin-panel`);
}
/* The card's CSS must exist in BOTH live style homes, or one app renders an unstyled
   block. config-ui carries it in injectStyles; admin-panel in the copied-component
   injector, because the card is a copied component. styles.css does not exist any more. */
{
  const cui = fs.readFileSync(path.join(REPO, "static", "config-ui", "src", "App.js"), "utf8");
  const adm = fs.readFileSync(path.join(REPO, "static", "admin-panel", "src", "App.js"), "utf8");
  ok(/\.draft-resume \{/.test(cui), "D7 config-ui's injectStyles carries the card CSS");
  ok(/\.draft-resume \{/.test(adm), "D7 admin-panel carries the card CSS too");
  for (const [name, src] of [["config-ui", cui], ["admin-panel", adm]]) {
    ok(/html\[data-color-mode="dark"\] \.draft-resume \{/.test(src), `D7 ${name} gives the new hue a dark override`);
    ok(!/\.draft-resume \{[^}]*border-left/.test(src), `D7 ${name} the card has no left rail`);
  }
}

console.log(`\nadmin-drafts: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
