/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 *
 * ONE home for "the event-picker row called X" (F-389).
 *
 * Why this exists: `.evp-row` filtered by `hasText: "Comment added"` is a SUBSTRING
 * match, so it silently went from 1 row to 2 the moment the git event
 * "Pull request comment added" joined `src/shared/jira-events.js` (1.4) — a Playwright
 * strict-mode violation that killed `editor-races` at its first assertion.
 * `listeners-jobs` had patched its own copy with `hasNotText: "Pull request"`; this
 * helper is that fix with one home, and it matches the row LABEL exactly, so a future
 * label that contains another label as a substring cannot resurrect the bug.
 */
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function pickEventRow(page, label) {
  return page
    .locator(".evp-row")
    .filter({ has: page.locator(".evp-row-label", { hasText: new RegExp(`^${esc(label)}$`) }) });
}
