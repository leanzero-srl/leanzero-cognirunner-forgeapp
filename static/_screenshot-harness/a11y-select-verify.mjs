/*
 * CogniRunner — functional a11y verification for the CustomSelect ARIA fix.
 * Asserts (not just screenshots) that the custom dropdown exposes the WAI-ARIA
 * combobox/listbox pattern: trigger has aria-haspopup + aria-expanded that toggles,
 * the panel is role=listbox, options are role=option with aria-selected, and
 * aria-activedescendant tracks the keyboard highlight; Escape closes. Both themes.
 * Local harness tooling — untracked. Run from this dir: node a11y-select-verify.mjs
 */
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
const serve = (root) => new Promise((resolve) => {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]); if (p === "/") p = "/index.html";
    const file = path.join(root, p);
    if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); return res.end("404"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
});

const root = path.join(process.cwd(), "..", "config-ui", "build-shot");
if (!fs.existsSync(path.join(root, "index.html"))) { console.error("no config-ui build-shot — build it first"); process.exit(2); }
const { server, port } = await serve(root);
const url = `http://127.0.0.1:${port}/`;
const browser = await chromium.launch();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log("  FAIL:", m); } };

for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 1400 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.addInitScript((th) => { window.__SHOT__ = "cfg-validator"; window.__THEME__ = th; document.documentElement.setAttribute("data-color-mode", th); }, theme);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!document.querySelector(".container") && !document.querySelector(".container .sk"), { timeout: 15000 }).catch(() => {});

  const trigger = page.locator(String.raw`.dropdown-trigger[aria-haspopup="listbox"]`).first();
  ok(await page.locator(String.raw`.dropdown-trigger[aria-haspopup="listbox"]`).count() > 0, "found a CustomSelect trigger");

  // 1. static ARIA on the trigger + collapsed state
  ok(await trigger.getAttribute("aria-haspopup") === "listbox", "trigger aria-haspopup=listbox");
  ok(await trigger.getAttribute("aria-expanded") === "false", "trigger aria-expanded=false when closed");

  // 2. open → expanded + a real listbox with options
  await trigger.click();
  await page.waitForTimeout(200);
  ok(await trigger.getAttribute("aria-expanded") === "true", "aria-expanded flips true on open");
  ok(await page.locator('[role="listbox"]').count() > 0, "panel exposes role=listbox");
  const optCount = await page.locator('[role="option"]').count();
  ok(optCount > 0, `options expose role=option (${optCount})`);
  ok(await page.locator('[role="option"][aria-selected="true"]').count() >= 1 || await page.locator('[role="option"]').first().getAttribute("aria-selected") !== null, "options carry aria-selected");

  // 3. aria-activedescendant points at a real option id (non-search select → on the trigger)
  const searchBox = page.locator('.dropdown-search input[role="combobox"]');
  const active = (await searchBox.count()) ? searchBox : trigger;
  const ad1 = await active.getAttribute("aria-activedescendant");
  ok(!!ad1 && await page.locator(`#${ad1}[role="option"]`).count() === 1, `aria-activedescendant references a real option (${ad1})`);

  // 4. keyboard moves the active option
  await active.press("ArrowDown");
  await page.waitForTimeout(80);
  const ad2 = await active.getAttribute("aria-activedescendant");
  ok(!!ad2 && ad2 !== ad1, `ArrowDown moves aria-activedescendant (${ad1} → ${ad2})`);
  await active.press("Home");
  await page.waitForTimeout(80);
  ok((await active.getAttribute("aria-activedescendant")) === ad1, "Home returns to the first option");

  // 5. Escape closes
  await active.press("Escape");
  await page.waitForTimeout(120);
  ok(await trigger.getAttribute("aria-expanded") === "false", "Escape closes (aria-expanded=false)");
  ok(await page.locator('[role="listbox"]').count() === 0, "listbox removed on close");

  console.log(`${theme}: checked`);
  await ctx.close();
}
await browser.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
