/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */
/* ═══════════════════════════════════════════════════════════════════════════════
 * F-628 / F-608 — THE PURGE SECTION IN A REAL BROWSER, ON REAL ENGINE DATA.
 *
 * va-purge-carrier-live.mjs proves the RESOLVER and the REST twin answer a populated
 * purge. It never opens the Agents tab, so the one thing an admin actually sees — the
 * "recently deleted agents that wrote during deletion" section — stayed render-proven
 * only (screenshot harness A17, mocked bridge). This script closes that: it plants the
 * tombstone through the engine's own writer, opens the STAGING admin panel in the
 * persistent admin profile, and reads the section out of the live DOM.
 *
 * THEME: the panel follows Jira's theme, which is an account preference, not something
 * a URL or a Playwright media emulation can set. The script measures which theme it got
 * (from the iframe's computed background) and reports the other one as NOT VERIFIED
 * rather than pretending. Both themes ARE covered at render level by A17.
 *
 * Restores the tombstone and the carrier job, and proves the restore by a second read
 * through the same resolver AND the same DOM.
 * ═══════════════════════════════════════════════════════════════════════════════ */
import { requireEnvAck } from "../lib/shared-env-guard.mjs";
import fs from "fs";
import { loadEnv, requireEnv } from "../lib/env.mjs";
import { formatResultLine, resultExitCode } from "../lib/driver-report.mjs";
const { envName: ENV_NAME, hookUrl: HOOK_URL, envId: ENV_ID_DEFAULT } = requireEnvAck(process.argv.slice(2), { faults: [], mutates: ["agents", "jobs"], defaultEnv: "staging" });
const env = loadEnv();

const arg = (n, d) => { const p = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`)); return p ? p.slice(n.length + 3) : d; };
const flag = (n) => process.argv.slice(2).includes(`--${n}`);
const SECRET = requireEnv("HARNESS_SECRET");
const ADMIN = requireEnv("HARNESS_ADMIN_ACCOUNT_ID");
const PROJECT = arg("project", "LZPT");
const KEEP = flag("keep");
const BASE = "https://wolfaenpak.atlassian.net";
const APP = "36415848-6868-4697-9554-3c3ad87b8da9";
const ENV_ID = arg("envid", ENV_ID_DEFAULT);
const PROFILE = "/Users/mihaiperdum/Projects/forge-live-harness/.auth/profile";
const OUT = new URL("../results/va-purge-panel-ui", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

let passes = 0, fails = 0, unproven = 0;
let crashed = null;   /* F-792 — set by main()'s catch; the RESULT line reads it */
const ev = { at: new Date().toISOString(), env: ENV_NAME, checks: [] };
const PASS = (s, d) => { passes++; ev.checks.push({ v: "PASS", s, ...(d ? { d } : {}) }); console.log(`  PASS  ${s}${d ? " " + JSON.stringify(d) : ""}`); };
const FAIL = (s, d) => { fails++; ev.checks.push({ v: "FAIL", s, ...(d ? { d } : {}) }); console.log(`  FAIL  ${s}${d ? " " + JSON.stringify(d) : ""}`); };
const NV = (s, d) => { unproven++; ev.checks.push({ v: "N/V", s, ...(d ? { d } : {}) }); console.log(`  N/V   ${s}${d ? " " + JSON.stringify(d) : ""}`); };
const info = (s) => console.log(`        ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const readRes = async (res) => {
  let text = ""; try { text = await res.text(); } catch (e) { return { status: 0, json: null, raw: e.message }; }
  let json = null; try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, json, raw: json ? null : text.slice(0, 300) };
};
async function hook(body, method = "POST", qs = "") {
  if (!HOOK_URL) throw new Error(`no web-trigger URL for environment "${ENV_NAME}"`);
  return readRes(await fetch(HOOK_URL + qs, {
    method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + SECRET },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  }));
}
const invoke = (functionKey, payload = {}, accountId = ADMIN) => hook({ action: "invokeResolver", functionKey, payload, accountId });
const tombstone = (op, agent, extra = {}) => hook({ action: "vaTombstone", op, agent, ...extra });
const mine = (body, agent) => ((body && body.purges) || []).find((p) => p.agent === agent) || null;

const TURNS = [
  { at: new Date(Date.now() - 4 * 60 * 1000).toISOString(), issueKey: `${PROJECT}-1`, writes: ["add_comment", "transition to Done"] },
  { at: new Date(Date.now() - 2 * 60 * 1000).toISOString(), issueKey: `${PROJECT}-2`, writes: ["add_comment"] },
];
const EXPECTED_WRITES = TURNS.reduce((n, t) => n + t.writes.length, 0);

/** Open the admin panel's Agents tab and read the purge section out of the live DOM. */
async function readPurgeSection(colorScheme, expectAgent, shot) {
  const { chromium } = await import("../../static/_screenshot-harness/node_modules/playwright/index.mjs");
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: true, viewport: { width: 1500, height: 1400 }, colorScheme,
  });
  try {
    const page = ctx.pages()[0] || (await ctx.newPage());
    await page.emulateMedia({ colorScheme }).catch(() => {});
    await page.goto(`${BASE}/jira/apps/${APP}/${ENV_ID}`, { waitUntil: "domcontentloaded" });
    let frame = null;
    for (let i = 0; i < 90; i++) {
      frame = page.frames().find((f) => f.url().includes("cdn.prod.atlassian-dev.net"));
      if (frame && (await frame.locator(".tab-btn").count()) > 0) break;
      await sleep(1000);
    }
    if (!frame) return { error: "the admin panel iframe never appeared — is the persistent profile still signed in?" };
    await frame.locator(".tab-btn", { hasText: /^\s*Agents\s*$/ }).click();
    /* The section renders from its own getVaRecentPurges fetch, which lands after the
       agent list. Wait for the row we planted (or, when proving the restore, for the
       agent list to settle) rather than sleeping blind. */
    const section = frame.locator(".va-purges");
    for (let i = 0; i < 60; i++) {
      const n = await frame.locator(".va-purge").filter({ hasText: expectAgent }).count().catch(() => 0);
      if (expectAgent && n > 0) break;
      if (!expectAgent && (await frame.locator(".va-agent, .empty-state").count()) > 0 && i > 8) break;
      await sleep(1000);
    }
    const out = { present: (await section.count()) > 0 };
    /* THE THEME PROBE MUST READ A PAINTED SURFACE. Reading document.body gave
       rgba(0,0,0,0) — transparent — on both passes, which a luminance test happily
       called "dark" twice and turned into a false dark-theme PASS. The app's own card
       is painted from the theme tokens, so it is the only honest witness. */
    const theme = await frame.evaluate(() => {
      const el = document.querySelector(".card") || document.querySelector(".app") || document.body;
      const bg = getComputedStyle(el).backgroundColor;
      const fg = getComputedStyle(el).color;
      const m = /rgba?\((\d+), ?(\d+), ?(\d+)(?:, ?([\d.]+))?/.exec(bg);
      const alpha = m && m[4] !== undefined ? Number(m[4]) : 1;
      const lum = m && alpha > 0 ? (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3 : null;
      return { bg, fg, dark: lum === null ? null : lum < 110 };
    }).catch(() => ({ bg: null, fg: null, dark: null }));
    out.theme = theme;
    if (out.present) {
      out.title = (await section.locator(".label").first().innerText().catch(() => "")).trim();
      out.sectionText = (await section.innerText().catch(() => "")).slice(0, 800);
      const row = frame.locator(".va-purge").filter({ hasText: expectAgent || /./ }).first();
      out.rowCount = await frame.locator(".va-purge").count();
      if (await row.count()) {
        out.rowText = (await row.innerText()).replace(/\s+/g, " ").trim();
        out.turnsBefore = await row.locator(".va-purge-turn").count();
        await row.locator(".va-purge-head").click();
        await sleep(600);
        out.turns = await row.locator(".va-purge-turn").allInnerTexts();
        out.writeChips = await row.locator(".va-purge-write").allInnerTexts();
        out.count = await row.locator(".va-purge-count").first().evaluate((el) => {
          const cs = getComputedStyle(el);
          return { bg: cs.backgroundColor, fg: cs.color, bl: cs.borderLeftWidth };
        }).catch(() => null);
      }
    }
    if (shot) await page.screenshot({ path: `${OUT}/${shot}.png` }).catch(() => {});
    out.pageErrors = [];
    return out;
  } catch (e) {
    return { error: String((e && e.message) || e).slice(0, 300) };
  } finally { await ctx.close(); }
}

async function main() {
  console.log(`\nF-628 — the purge SECTION in a real browser, on ${ENV_NAME.toUpperCase()}\n`);
  const ping = await hook(null, "GET");
  if (ping.status !== 200) throw new Error(`the hook is not reachable on ${ENV_NAME} (GET -> ${ping.status})`);
  PASS(`hook reachable on ${ENV_NAME}, secret accepted`);

  let jobId = null;
  try {
    console.log("STEP 1 - a DISABLED script job to hang the tombstone on");
    const created = await invoke("saveScheduledJob", {
      job: {
        name: `F-628 purge panel UI ${Date.now()}`, mode: "script", enabled: false,
        schedule: { cron: "0 4 * * *", timeZone: "UTC" },
        functions: [{ name: "noop", code: "api.log('f628 ui carrier - never runs');" }],
      },
    });
    if (!(created.json && created.json.success)) throw new Error(`saveScheduledJob refused: ${JSON.stringify(created.json).slice(0, 300)}`);
    jobId = created.json.job.id;
    PASS(`job ${jobId} created, disabled`);

    console.log("\nSTEP 2 - the CONTROL: the section is not on the tab before the plant");
    const before = await readPurgeSection("light", null, "01-before");
    ev.before = before;
    if (before.error) { FAIL("the admin panel could not be opened", { error: before.error }); return; }
    info(`page background ${before.theme.bg} (dark=${before.theme.dark})`);
    if (!before.present || !/purge-ui/.test(before.sectionText || "")) {
      PASS("the Agents tab carries no purge row for this agent yet - the browser read is a real control", { sectionPresent: before.present, rows: before.rowCount || 0 });
    } else FAIL("the tab already shows this agent's purge before anything was planted", { text: before.sectionText });

    console.log("\nSTEP 3 - plant the tombstone through the engine's own writer");
    const planted = await tombstone("plant", jobId, { turns: TURNS });
    if (!(planted.json && planted.json.ok)) { FAIL("the plant was refused", { body: JSON.stringify(planted.json).slice(0, 300) }); return; }
    PASS(`va_purged:${jobId} planted with ${TURNS.length} turns`, { at: planted.json.row.at });
    const res = await invoke("getVaRecentPurges");
    if (mine(res.json, jobId)) PASS("the resolver the tab reads returns the row - so anything missing below is the UI, not the data");
    else { FAIL("getVaRecentPurges does not carry the planted row", { body: JSON.stringify(res.json).slice(0, 300) }); return; }

    console.log("\nSTEP 4 - THE TAB. What the admin actually sees.");
    const seen = await readPurgeSection("light", jobId, "02-populated");
    ev.populated = seen;
    if (seen.error) { FAIL("the admin panel could not be opened", { error: seen.error }); return; }
    info(`page background ${seen.theme.bg} (dark=${seen.theme.dark})`);
    if (seen.present) PASS("the 'recently deleted agents' section RENDERS on the live tab");
    else { FAIL("the section is absent from the tab although the resolver answers it", { text: (seen.sectionText || "").slice(0, 200) }); return; }
    if (/deleted agents that wrote during deletion/i.test(seen.title || seen.sectionText || "")) PASS("…the section says what it is", { title: seen.title });
    else FAIL("the section title is not the copy the ledger names", { title: seen.title });
    if (new RegExp(jobId).test(seen.rowText || "")) PASS("…the row names THIS agent", { row: (seen.rowText || "").slice(0, 120) });
    else FAIL("the row does not name the planted agent", { row: seen.rowText });
    if (new RegExp(`${EXPECTED_WRITES} writes stayed`, "i").test(seen.rowText || "")) PASS(`…and prints the engine's write count ("${EXPECTED_WRITES} writes stayed")`);
    else FAIL("the write count sentence is not on the row", { row: seen.rowText });
    if (!/not known yet/i.test(seen.rowText || "")) PASS("…with a real purge time, not 'not known yet'");
    else FAIL("the purge time renders as 'not known yet'", { row: seen.rowText });
    if (seen.turnsBefore === 0) PASS("…turns start COLLAPSED (the section does not shout write strings at a reader)");
    else FAIL("the turns were already expanded", { turnsBefore: seen.turnsBefore });
    const turns = seen.turns || [];
    if (turns.length === TURNS.length) PASS("…and expanding the row renders both turns", { turns: turns.length });
    else FAIL("the expanded row does not carry both turns", { turns });
    if (turns.join(" ").includes(`${PROJECT}-1`) && turns.join(" ").includes(`${PROJECT}-2`)) PASS("…each turn names its issue", { keys: [`${PROJECT}-1`, `${PROJECT}-2`] });
    else FAIL("the turns do not name the planted issue keys", { turns });
    const chips = (seen.writeChips || []).map((s) => s.trim());
    if (chips.includes("add_comment") && chips.includes("transition to Done")) PASS("…and the REAL write strings render as chips", { chips });
    else FAIL("the write strings are not on the tab", { chips });
    if (seen.count && seen.count.fg === "rgb(255, 255, 255)" && seen.count.bl === "0px") {
      PASS("…the count chip is white ink with NO left rail (the owner's UI law)", seen.count);
    } else FAIL("the count chip breaks the UI law", { count: seen.count });

    console.log("\nSTEP 5 - the OTHER theme");
    const dark = await readPurgeSection("dark", jobId, "03-dark");
    ev.dark = dark;
    const flipped = !dark.error && dark.theme && seen.theme && dark.theme.dark !== null
      && dark.theme.dark !== seen.theme.dark;
    if (dark.error) { NV("the dark pass could not open the panel", { error: dark.error }); }
    else if (flipped && dark.present) {
      PASS(`the section renders in the OTHER theme too (card ${seen.theme.bg} -> ${dark.theme.bg})`);
      if (dark.count && dark.count.fg === "rgb(255, 255, 255)" && dark.count.bl === "0px") PASS("…count chip still white ink, no left rail there", dark.count);
      else FAIL("the count chip breaks the UI law in the other theme", { count: dark.count });
    } else {
      NV("the theme did not flip: Jira's theme is an ACCOUNT preference, and a Playwright colorScheme emulation does not move it, so this pass repainted the same theme. Dark is covered at render level by static/_screenshot-harness/agents-tab.test.mjs A17.",
        { firstPass: seen.theme, secondPass: dark.theme });
    }
  } catch (e) {
    /* F-792 — the RESULT line below prints from the `finally`, so the RESTORE block can report
       its own residue after it. That also means it prints on the CRASH path, with the counters
       frozen wherever the throw left them — which is how a dead run says "0 fail". Catching
       here is what lets the line SAY it crashed. Deliberately no rethrow: the finally's restore
       and its residue assertions must still run and still be the last word. */
    crashed = e;
    console.error("\nDRIVER ERROR:", e && e.stack);
  } finally {
    console.log("\nRESTORE");
    if (jobId && !KEEP) {
      await tombstone("clear", jobId);
      const t = await tombstone("read", jobId);
      if (t.json && t.json.row === null) PASS(`the planted tombstone va_purged:${jobId} is GONE`);
      else FAIL("the tombstone is still there", { row: t.json && t.json.row });
      const gone = await invoke("getVaRecentPurges");
      if (!mine(gone.json, jobId)) PASS("…and the resolver no longer lists it");
      else FAIL("the resolver still lists the agent after the clear");
      const domAfter = await readPurgeSection("light", null, "04-after");
      ev.after = domAfter;
      if (!domAfter.error && !new RegExp(jobId).test(domAfter.sectionText || "")) {
        PASS("…and the TAB no longer shows the row - the same browser read that saw it above now does not");
      } else if (domAfter.error) NV("the restore DOM read could not open the panel", { error: domAfter.error });
      else FAIL("the tab still shows the purge row after the clear", { text: (domAfter.sectionText || "").slice(0, 200) });
      await invoke("deleteScheduledJob", { id: jobId });
      const row = await hook(null, "GET", `?what=kvs&key=${encodeURIComponent("job:" + jobId)}`);
      if (row.json && (row.json.value ?? null) === null) PASS(`the job row job:${jobId} is GONE`);
      else FAIL("the job row survives the delete");
    } else if (jobId) NV("--keep: the tombstone and the job were left in place");
    fs.writeFileSync(OUT + "/evidence.json", JSON.stringify(ev, null, 2));
    console.log("\n" + formatResultLine({ passes, fails, unproven, crashed, suffix: `. Evidence: ${OUT}/evidence.json` }));
  }
}

await main();
process.exit(resultExitCode({ fails, crashed }));
