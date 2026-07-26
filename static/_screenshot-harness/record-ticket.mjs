import { chromium } from "playwright";
import path from "node:path"; import fs from "node:fs";
const SM = "/Users/mihaiperdum/Projects/CogniRunner/static/submission-material/video-src";
const CLIPS = path.join(SM, "clips");
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: CLIPS, size: { width: 1920, height: 1080 } } });
const page = await ctx.newPage();
await page.goto("file://" + path.join(SM, "jira-ticket.html"), { waitUntil: "domcontentloaded" });
await page.evaluate(async () => { try { await document.fonts.ready; } catch (e) {} });
await new Promise((r) => setTimeout(r, 11600));
const v = page.video(); await ctx.close();
if (v) { fs.renameSync(await v.path(), path.join(CLIPS, "06-ticket.webm")); }
await browser.close(); console.log("recorded 06-ticket");
