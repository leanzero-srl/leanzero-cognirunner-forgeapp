/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Real admin UI at the 624px iframe width observed inside 1024px Jira.
 * Build admin webpack.screenshot.js, then run this script (optional --shots).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../admin-panel/build-shot");
const server = http.createServer((req, res) => {
  const name = req.url.split("?")[0] === "/" ? "/index.html" : req.url.split("?")[0];
  const file = path.resolve(root, `.${decodeURIComponent(name)}`);
  if (!file.startsWith(`${root}/`) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.setHeader("Content-Type", path.extname(file) === ".js" ? "text/javascript" : "text/html");
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch();
const measurements = [];
let checks = 0;
try {
  for (const theme of ["light", "dark"]) {
    for (const label of ["Listeners", "Scheduled Jobs"]) {
      const ctx = await browser.newContext({ viewport: { width: 624, height: 972 } });
      try {
        await ctx.addInitScript(({ theme, label }) => {
          window.__SHOT__ = "admin"; window.__THEME__ = theme;
          const common = { name: `Campaign ${"x".repeat(100)}`, enabled: false, mode: "script",
            stats: { runCount: 22, lastRunAt: "2026-09-05T12:00:00Z", lastStatus: "ok" } };
          window.__RESPONSES__ = label === "Listeners"
            ? { getListeners: { success: true, listeners: [{ ...common, id: "lst_b2", events: ["avi:jira:created:issue"], projectKeys: ["LZPT", "JT"] }] } }
            : { getScheduledJobs: { success: true, jobs: [{ ...common, id: "job_b2", schedule: { cron: "0 9 * * 1-5", timeZone: "Europe/Bucharest" }, scoped: true }] } };
        }, { theme, label });
        const page = await ctx.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.locator(".tab-btn", { hasText: new RegExp(`^\\s*${label}\\s*$`) }).click();
        const table = page.locator(".lst-table");
        await table.waitFor();
        const geometry = await table.evaluate((el) => {
          const wrapper = el.closest(".card");
          const section = wrapper.closest(".section");
          return { wrapperWidth: wrapper.clientWidth, tableWidth: el.scrollWidth,
            overflow: getComputedStyle(wrapper).overflowX, sectionWidth: section.clientWidth,
            sectionScrollWidth: section.scrollWidth };
        });
        assert.equal(geometry.overflow, "auto"); checks++;
        assert(geometry.tableWidth > geometry.wrapperWidth, "fixture must exercise horizontal overflow"); checks++;
        assert(geometry.sectionScrollWidth <= geometry.sectionWidth + 1, "table must not widen its section"); checks++;
        // A normal pointer click must scroll the inner card, not move the page.
        await table.getByRole("button", { name: "Enable", exact: true }).click();
        await page.locator(".mls-toast", { hasText: label === "Listeners" ? "Listener enabled" : "Job enabled" }).waitFor();
        const after = await table.evaluate((el) => ({ scrollLeft: el.closest(".card").scrollLeft, pageX: window.scrollX }));
        assert(after.scrollLeft > 0, "action access must scroll inside the card"); checks++;
        assert.equal(after.pageX, 0, "accessing table actions must not scroll the page horizontally"); checks++;
        const call = await page.evaluate((label) => window.__CALLS__.filter((c) => c.name === (label === "Listeners" ? "setListenerEnabled" : "setScheduledJobEnabled")).at(-1), label);
        assert.deepEqual(call.payload, { id: label === "Listeners" ? "lst_b2" : "job_b2", enabled: true }); checks++;
        await table.getByRole("button", { name: "Delete", exact: true }).click();
        await page.locator(".cr-confirm").waitFor();
        await page.getByRole("button", { name: "Cancel", exact: true }).click();
        assert.equal(await page.locator(".cr-confirm").count(), 0); checks++;
        if (label === "Scheduled Jobs") {
          await table.getByRole("button", { name: "Run now" }).click();
          await page.locator(".lst-test .runres").waitFor({ timeout: 10000 });
          assert.equal(await page.locator(".lst-test .runres-badge.ok").count(), 1); checks++;
        }
        assert.deepEqual(errors, []); checks++;
        const navigation = await page.locator(".tab-bar").evaluate((el) => ({
          width: el.clientWidth, scrollWidth: el.scrollWidth, wrap: getComputedStyle(el).flexWrap,
          documentWidth: document.documentElement.clientWidth, documentScrollWidth: document.documentElement.scrollWidth,
        }));
        assert.equal(navigation.documentScrollWidth, navigation.documentWidth, "listener/job page must fit its iframe"); checks++;
        assert.equal(navigation.scrollWidth, navigation.width, "all navigation tabs must fit inside their bar"); checks++;
        const tabBounds = await page.locator(".tab-btn").evaluateAll((buttons) => buttons.map((button) => {
          const rect = button.getBoundingClientRect(); return { left: rect.left, right: rect.right };
        }));
        assert(tabBounds.every((rect) => rect.left >= 0 && rect.right <= 624), "every tab must be reachable without horizontal page scrolling"); checks++;
        await page.locator(".tab-btn", { hasText: /^Settings$/ }).click();
        assert.equal(await page.locator(".tab-active").textContent(), "Settings"); checks++;
        await page.locator(".tab-btn", { hasText: new RegExp(`^\\s*${label}\\s*$`) }).click();
        await page.locator(".lst-table").waitFor();
        assert.equal(await page.evaluate(() => window.scrollX), 0); checks++;
        measurements.push({ theme, label, geometry, after, navigation });
        if (process.argv.includes("--shots")) {
          await table.getByRole("button", { name: "Enable", exact: true }).click();
          const out = path.join(here, "out"); fs.mkdirSync(out, { recursive: true });
          await page.screenshot({ path: path.join(out, `rule-table-${label.replaceAll(" ", "-")}-${theme}.png`), fullPage: true, animations: "disabled" });
        }
      } finally { await ctx.close(); }
    }
  }
  console.log(JSON.stringify(measurements, null, 2));
  console.log(`RULE TABLE WIDTH: ${checks} assertions passed (624px, light and dark)`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
