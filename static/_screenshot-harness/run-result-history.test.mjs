/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Scoped job outcomes must survive reopening Recent executions. Uses the real
 * admin app and its mock bridge; build webpack.screenshot.js first.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../admin-panel/build-shot");
const outcomes = [
  { key: "JT-101", success: true, reason: "First issue updated" },
  { key: "JT-102", success: false, reason: "J06 intentional middle-issue failure" },
  { key: "JT-103", success: true, reason: "Third issue updated after the failure" },
];
const stored = {
  id: "j06-history", type: "scheduled-job", fieldId: "J06 mixed scoped outcomes",
  timestamp: "2026-09-05T12:00:00Z", issueKey: "3 issue(s)", isValid: false,
  reason: "2/3 issue(s) processed OK, 2 change(s), 1 failed", perIssue: outcomes,
};
const server = http.createServer((req, res) => {
  const name = req.url.split("?")[0] === "/" ? "/index.html" : req.url.split("?")[0];
  const file = path.resolve(root, `.${decodeURIComponent(name)}`);
  if (!file.startsWith(`${root}/`) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.setHeader("Content-Type", path.extname(file) === ".js" ? "text/javascript" : "text/html");
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch();
let assertions = 0;
async function checkOutcomes(card, theme) {
  assert.equal(await card.locator(".runres-badge.err").textContent(), "FAILED"); assertions++;
  const chips = await card.locator(".runres-issue").evaluateAll((nodes) => nodes.map((node) => ({
    key: node.textContent, failed: node.classList.contains("err"), reason: node.title,
    color: getComputedStyle(node).color, background: getComputedStyle(node).backgroundColor,
  })));
  assert.deepEqual(chips.map(({ key, failed, reason }) => ({ key, failed, reason })),
    outcomes.map(({ key, success, reason }) => ({ key, failed: !success, reason }))); assertions++;
  assert(chips.every((chip) => chip.color === "rgb(255, 255, 255)")); assertions++;
  assert.equal(chips[1].background, theme === "dark" ? "rgb(239, 68, 68)" : "rgb(220, 38, 38)"); assertions++;
}
try {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    try {
      await context.addInitScript(({ theme, stored, outcomes }) => {
        window.__SHOT__ = "admin"; window.__THEME__ = theme;
        window.__RESPONSES__ = {
          getLogs: { success: true, logs: [stored] },
          getAsyncTaskResult: { success: true, status: "done", result: {
            success: false, reason: stored.reason, issues: outcomes,
          } },
        };
      }, { theme, stored, outcomes });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.locator(".tab-btn", { hasText: /^\s*Scheduled Jobs\s*$/ }).click();
      const row = page.locator("tr", { hasText: "Nudge stale" });
      await row.locator(".rule-expand-btn").click();
      const history = page.locator(".recent-logs .runres");
      await history.locator(".runres-badge.err").waitFor();
      await checkOutcomes(history, theme);
      await row.locator(".rule-expand-btn").click();
      await row.locator(".rule-expand-btn").click();
      await history.locator(".runres-badge.err").waitFor();
      await checkOutcomes(history, theme);
      await row.getByRole("button", { name: "Run now" }).click();
      const manual = page.locator(".lst-test .runres");
      await manual.locator(".runres-badge.err").waitFor({ timeout: 10000 });
      await checkOutcomes(manual, theme);
      assert.deepEqual(errors, []); assertions++;
      if (process.argv.includes("--shots")) {
        const out = path.join(here, "out"); fs.mkdirSync(out, { recursive: true });
        await page.screenshot({ path: path.join(out, `scoped-history-${theme}.png`), fullPage: true, animations: "disabled" });
      }
    } finally { await context.close(); }
  }
  console.log(`SCOPED JOB HISTORY: ${assertions} assertions passed (light and dark)`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
