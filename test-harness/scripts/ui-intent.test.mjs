/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Offline unit test for sanitizeUiIntent (src/index.js) — the pure guard behind the one-shot
// config-view → admin UI-intent handoff (setUiIntent/takeUiIntent). fs+eval extraction (index.js
// has Forge deps that can't load offline). Covers: tab whitelist, ruleId clamp/null, junk rejection.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, "../../src/index.js"), "utf8");
// sanitizeUiIntent references the module-level UI_INTENT_TABS Set — eval that first so the closure resolves it.
const tabsM = src.match(/const UI_INTENT_TABS = new Set\(\[[^\]]*\]\);/);
const fnM = src.match(/export const sanitizeUiIntent = \(payload\) => \{[\s\S]*?\n\};/);
if (!tabsM || !fnM) { console.log("FAIL: could not extract sanitizeUiIntent / UI_INTENT_TABS"); process.exit(1); }
// eslint-disable-next-line no-eval
const UI_INTENT_TABS = eval("(" + tabsM[0].replace("const UI_INTENT_TABS = ", "").replace(/;\s*$/, "") + ")");
void UI_INTENT_TABS;
// eslint-disable-next-line no-eval
const sanitizeUiIntent = eval("(" + fnM[0].replace("export const sanitizeUiIntent = ", "").replace(/;\s*$/, "") + ")");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// valid tabs pass, carrying an optional ruleId
ok(eq(sanitizeUiIntent({ tab: "rules", ruleId: "validator::abc" }), { tab: "rules", ruleId: "validator::abc" }), "rules + ruleId passes through");
ok(eq(sanitizeUiIntent({ tab: "logs" }), { tab: "logs", ruleId: null }), "tab with no ruleId → ruleId null");
for (const t of ["rules", "logs", "docs", "skills", "memories", "settings", "permissions"]) {
  ok(sanitizeUiIntent({ tab: t })?.tab === t, `whitelisted tab "${t}" accepted`);
}

// junk / unknown tabs are rejected (null)
ok(sanitizeUiIntent({ tab: "evil" }) === null, "unknown tab rejected");
ok(sanitizeUiIntent({ tab: "" }) === null, "empty tab rejected");
ok(sanitizeUiIntent({}) === null, "missing tab rejected");
ok(sanitizeUiIntent(null) === null, "null payload rejected");
ok(sanitizeUiIntent({ tab: "  rules  " })?.tab === "rules", "tab is trimmed before whitelist check");

// ruleId is coerced to string + clamped to 200 chars
ok(sanitizeUiIntent({ tab: "rules", ruleId: 12345 })?.ruleId === "12345", "numeric ruleId coerced to string");
ok(sanitizeUiIntent({ tab: "rules", ruleId: "x".repeat(500) })?.ruleId.length === 200, "long ruleId clamped to 200 chars");

console.log(`\nui-intent: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
