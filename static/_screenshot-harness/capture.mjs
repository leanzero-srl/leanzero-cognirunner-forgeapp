/*
 * UNTRACKED screenshot harness — drives the standalone (mocked-bridge) builds
 * and captures crisp PNGs of each CogniRunner screen in light + dark.
 *   node capture.mjs            # all
 *   node capture.mjs config-ui  # one app
 */
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC = path.resolve(__dirname, "..");
const OUT = path.resolve(__dirname, "out");

const THEMES = ["light", "dark"];
const BODY_BG = { light: "#f1f2f4", dark: "#1d2125" };
const VIEWPORT = { width: Number(process.env.SHOT_WIDTH) || 1440, height: Number(process.env.SHOT_HEIGHT) || 1000 };

const MATRIX = [
  { app: "admin-panel", shots: [
    { name: "admin-rules", shot: "admin", tab: "Rules", wait: "table.table" },
    { name: "admin-portability-export", shot: "admin", tab: "Rules", openPortability: true, wait: ".port-dialog" },
    { name: "admin-portability-import", shot: "admin", tab: "Rules", openPortability: true, portabilityImport: true, wait: ".port-plan-row" },
    { name: "admin-rules-explain", shot: "admin", tab: "Rules", clickExplainRows: true, wait: ".rule-explain-card" },
    // The three surfaces the rules-table review touched. Each is a MODAL portalled to
    // <body> (see DeleteRulesDialog) or the table toolbar, and each needs eyes on it
    // in both themes.
    { name: "admin-rules-selected", shot: "admin", tab: "Rules", selectFirstRule: true, wait: ".rules-bulkbar button" },
    { name: "admin-delete-dialog", shot: "admin", tab: "Rules", openDeleteDialog: true, wait: ".del-dialog .del-option" },
    { name: "admin-add-rule-wizard", shot: "admin", tab: "Rules", openAddWizard: true, wait: ".wiz-dialog .wizard-breadcrumb" },
    { name: "admin-logs", shot: "admin", tab: "Execution Logs", showLogs: true, wait: ".log-entry" },
    { name: "admin-docs", shot: "admin", tab: "Documentation", wait: ".docs-tab" },
    { name: "admin-permissions", shot: "admin", tab: "Permissions", wait: ".perm-admin-card" },
    { name: "admin-settings", shot: "admin", tab: "Settings", wait: ".openai-status" },
    { name: "admin-skills-error", shot: "admin", tab: "Skills", failInvokes: ["getSkills"], wait: ".load-error" },
  ]},
  { app: "config-ui", shots: [
    { name: "config-validator", shot: "cfg-validator", wait: ".container .card" },
    { name: "config-condition", shot: "cfg-condition", wait: ".container .card" },
    { name: "config-semantic-pf", shot: "cfg-semantic", wait: ".semantic-config" },
    { name: "config-static-pf", shot: "cfg-static", wait: ".cm-content" },
    { name: "config-nl-rule", shot: "cfg-validator", buildNlRule: true, wait: ".br-card" },
    { name: "config-static-narrate", shot: "cfg-static", runTestNarrate: true, wait: ".ndr-card" },
    { name: "config-premade-lists-error", shot: "cfg-premade", failInvokes: ["getRuleLists"], wait: ".btn-retry" },
    { name: "config-validator-nokey", shot: "cfg-validator", noKey: true, wait: ".provider-warning" },
    { name: "config-semantic-nokey", shot: "cfg-semantic", noKey: true, wait: ".provider-warning" },
    // A searchable select, OPEN. The trigger itself is the search box (combobox) —
    // there must be exactly one input here, not a dead "Select a field…" bar sitting
    // on top of a live "Search fields…" one.
    { name: "config-field-combobox", shot: "cfg-semantic", openFieldPicker: true, wait: ".dropdown-combobox-input" },
  ]},
  { app: "config-view", shots: [
    { name: "view-summary-active", shot: "view-active", wait: ".config-item" },
    { name: "view-explain", shot: "view-active", clickExplain: true, wait: ".cv-explain-card" },
    { name: "view-summary-disabled", shot: "view-disabled", wait: ".config-item" },
    { name: "view-agentic-log", shot: "view-active", showLogs: true, openTrace: true, wait: ".log-entry" },
  ]},
  { app: "issue-glance", rootSel: ".glance", shots: [
    { name: "glance-ready", shot: "issue-glance", wait: ".glance-list" },
    { name: "glance-empty", shot: "issue-glance-empty", wait: ".glance-empty" },
    { name: "glance-error", shot: "issue-glance", failInvokes: ["getIssueActivity"], wait: ".glance-err" },
    { name: "glance-loading", shot: "issue-glance-loading", wait: ".glance-spinner" },
  ]},
];

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };

function serve(root) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split("?")[0]);
      if (p === "/") p = "/index.html";
      const file = path.join(root, p);
      if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); return res.end("404"); }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

const NO_ANIM = `*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
/* expand internal scroll boxes so full content is captured */
.logs-list, .doc-list, .log-trace-content, .st-value, .doc-preview-content { max-height: none !important; overflow: visible !important; }`;

async function run(only) {
  fs.mkdirSync(OUT, { recursive: true });
  for (const t of THEMES) fs.mkdirSync(path.join(OUT, t), { recursive: true });
  const browser = await chromium.launch();
  let ok = 0, fail = 0;

  for (const { app, shots, rootSel = ".container" } of MATRIX) {
    if (only && app !== only) continue;
    const root = path.join(STATIC, app, "build-shot");
    if (!fs.existsSync(path.join(root, "index.html"))) { console.log(`SKIP ${app}: no build-shot`); continue; }
    const { server, port } = await serve(root);
    const url = `http://127.0.0.1:${port}/`;

    for (const s of shots) {
      for (const theme of THEMES) {
        const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, reducedMotion: "reduce" });
        const page = await ctx.newPage();
        const label = `${theme}/${s.name}`;
        try {
          await page.addInitScript(([shot, th]) => { window.__SHOT__ = shot; window.__THEME__ = th; document.documentElement.setAttribute("data-color-mode", th); }, [s.shot, theme]);
          if (s.failInvokes) await page.addInitScript((names) => { window.__FAIL__ = names; }, s.failInvokes);
          if (s.noKey) await page.addInitScript(() => { window.__NOKEY__ = true; });
          await page.goto(url, { waitUntil: "domcontentloaded" });
          await page.addStyleTag({ content: NO_ANIM });
          await page.evaluate((bg) => { document.documentElement.style.background = bg; document.body.style.background = bg; }, BODY_BG[theme]);
          // wait for the app root to mount (and, for skeleton apps, leave the skeleton)
          await page.waitForFunction((rs) => !!document.querySelector(rs) && !document.querySelector(rs + " .sk"), { timeout: 15000 }, rootSel).catch(() => {});
          if (s.tab) {
            await page.locator(".tab-bar button", { hasText: s.tab }).first().click({ timeout: 8000 }).catch(() => {});
          }
          if (s.showLogs) {
            await page.getByRole("button", { name: /show logs/i }).first().click({ timeout: 4000 }).catch(() => {});
          }
          if (s.clickExplain) {
            await page.locator(".cv-explain-btn").first().click({ timeout: 4000 }).catch(() => {});
          }
          if (s.runTestNarrate) {
            await page.getByRole("button", { name: /^Test Run$/ }).first().click({ timeout: 6000 }).catch(() => {});
            await page.locator(".btn-run-test").first().click({ timeout: 6000 }).catch(() => {});
            await page.locator(".ndr-btn").first().click({ timeout: 6000 }).catch(() => {});
          }
          if (s.buildNlRule) {
            await page.locator(".rulekind-opt", { hasText: "Premade rule" }).first().click({ timeout: 6000 }).catch(() => {});
            await page.locator(".br-toggle").first().click({ timeout: 4000 }).catch(() => {});
            await page.locator(".br-input").first().fill("require the description field before this transition").catch(() => {});
            await page.locator(".br-btn").first().click({ timeout: 6000 }).catch(() => {});
          }
          if (s.clickExplainRows) {
            // Row 0 (validator → success card) and the premade-condition row (→ degraded note).
            await page.locator(".rule-explain-btn").nth(0).click({ timeout: 6000 }).catch(() => {});
            await page.locator(".rule-explain-btn").nth(5).click({ timeout: 6000 }).catch(() => {});
          }
          if (s.openFieldPicker) {
            // The Target Field picker on the semantic-PF form.
            await page.locator(".dropdown-trigger").last().click({ timeout: 6000 }).catch(() => {});
          }
          if (s.selectFirstRule) {
            await page.locator("table.rules-table tbody input[type=checkbox]").first().check({ timeout: 6000 }).catch(() => {});
          }
          if (s.openDeleteDialog) {
            // Pick a Delete button clear of the sticky toolbar + header, otherwise the
            // click is intercepted by the bar sitting over the topmost rows.
            await page.locator("table.rules-table .row-actions button", { hasText: /^Delete$/ }).nth(1)
              .click({ timeout: 6000 }).catch(() => {});
          }
          if (s.openAddWizard) {
            await page.getByRole("button", { name: /^\+ Add Rule$/ }).first().click({ timeout: 6000 }).catch(() => {});
          }
          if (s.openPortability) {
            await page.getByRole("button", { name: /Export \/ Import/ }).first().click({ timeout: 6000 }).catch(() => {});
            if (s.portabilityImport) {
              await page.locator(".port-tab", { hasText: "Import" }).first().click({ timeout: 4000 }).catch(() => {});
              await page.locator(".port-textarea").first().fill('{"kind":"cognirunner-rules-export","schemaVersion":1,"rules":[{}]}').catch(() => {});
              await page.getByRole("button", { name: /Preview import/ }).first().click({ timeout: 4000 }).catch(() => {});
            }
          }
          if (s.wait) await page.waitForSelector(s.wait, { timeout: 12000 }).catch(() => console.log(`   (wait '${s.wait}' missed for ${label})`));
          if (s.openTrace) await page.evaluate(() => document.querySelectorAll("details.log-trace").forEach((d) => { d.open = true; }));
          await page.waitForTimeout(500); // settle codemirror / layout
          const target = (await page.$(rootSel)) || page;
          const file = path.join(OUT, theme, `${s.name}.png`);
          await target.screenshot({ path: file });
          const { size } = fs.statSync(file);
          console.log(`OK  ${label}  (${Math.round(size / 1024)} KB)`);
          // Objective horizontal-overflow check + worst offending element.
          const of = await page.evaluate(() => {
            const iw = window.innerWidth;
            const sw = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
            let worst = null, max = 0;
            for (const el of document.querySelectorAll("*")) {
              const r = el.getBoundingClientRect();
              if (r.width === 0) continue;
              if (r.right > iw + 2 && (r.right - iw) > max) { max = r.right - iw; worst = el; }
            }
            return { iw, sw, over: sw - iw, worst: worst ? { tag: worst.tagName, cls: String(worst.className || "").slice(0, 70), px: Math.round(max) } : null };
          });
          if (of.over > 4) console.log(`   ⚠ OVERFLOW ${label}: page ${of.sw}px > viewport ${of.iw}px (+${of.over}px)` + (of.worst ? ` — worst: <${of.worst.tag} class="${of.worst.cls}"> +${of.worst.px}px` : ""));
          ok++;
        } catch (e) {
          console.log(`ERR ${label}: ${e.message.split("\n")[0]}`);
          fail++;
        } finally {
          await ctx.close();
        }
      }
    }
    await new Promise((r) => server.close(r));
  }
  await browser.close();
  console.log(`\nDone. ${ok} ok, ${fail} failed. Output: ${OUT}`);
}

run(process.argv[2]);
