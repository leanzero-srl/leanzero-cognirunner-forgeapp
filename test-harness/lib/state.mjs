/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Shared run-state persisted to results/testbed.json so the setup / attach /
// seed / run / report scripts hand off to each other. Contains NO secrets.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { HARNESS_ROOT } from "./env.mjs";

export const RESULTS_DIR = join(HARNESS_ROOT, "results");
const STATE_PATH = join(RESULTS_DIR, "testbed.json");

export function ensureResults() {
  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });
}

export function loadState() {
  if (!existsSync(STATE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf8"));
  } catch {
    return {};
  }
}

export function saveState(state) {
  ensureResults();
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

export function patchState(patch) {
  const s = loadState();
  const next = { ...s, ...patch };
  saveState(next);
  return next;
}

export function writeResult(name, data) {
  ensureResults();
  writeFileSync(join(RESULTS_DIR, name), JSON.stringify(data, null, 2));
}
