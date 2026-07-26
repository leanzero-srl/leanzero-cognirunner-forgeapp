/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Premade-rule parity lint. Keeps the premade catalog and the executor in lockstep:
 *   - every `available` catalog rule MUST have an executor branch in premade-rules.js
 *   - every executor branch MUST correspond to an `available` catalog rule (no orphans)
 *
 * Because the catalog also drives the config-ui/admin-panel forms, this single lint
 * keeps form ⇄ executor aligned (form drift = a rule that can't run; executor drift =
 * an orphan branch). Run manually / pre-deploy:  node test-harness/scripts/premade-parity.mjs
 * Exits 1 on any mismatch.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { PREMADE_VALIDATORS, PREMADE_CONDITIONS } from "../../src/shared/premade-rules-catalog.js";

const here = dirname(fileURLToPath(import.meta.url));
const executorSrc = readFileSync(resolve(here, "../../src/premade-rules.js"), "utf8");

// Executor branch keys: `case "x":` (the switches) + `cfg.ruleType === "x"` (issue-level guards).
const executorKeys = new Set();
for (const m of executorSrc.matchAll(/(?:case\s+|cfg\.ruleType\s*===\s*)"([a-z][a-z-]+)"/g)) {
  executorKeys.add(m[1]);
}

const allCatalog = [...PREMADE_VALIDATORS, ...PREMADE_CONDITIONS];
const availableKeys = new Set(allCatalog.filter((r) => r.availability !== "unavailable").map((r) => r.key));
const catalogKeys = new Set(allCatalog.map((r) => r.key));

const problems = [];

// 1. Every available catalog rule has an executor branch.
for (const key of availableKeys) {
  if (!executorKeys.has(key)) {
    problems.push(`Catalog rule "${key}" is available but has NO executor branch in premade-rules.js`);
  }
}

// 2. No orphan executor branch — every executor key must be an available catalog rule.
for (const key of executorKeys) {
  if (!catalogKeys.has(key)) {
    problems.push(`Executor branch "${key}" has no catalog entry`);
  } else if (!availableKeys.has(key)) {
    problems.push(`Executor branch "${key}" exists for a rule marked UNAVAILABLE in the catalog`);
  }
}

const validatorCount = PREMADE_VALIDATORS.filter((r) => r.availability !== "unavailable").length;
const conditionCount = PREMADE_CONDITIONS.filter((r) => r.availability !== "unavailable").length;
const unavailableCount = allCatalog.length - availableKeys.size;

if (problems.length) {
  console.error("✗ Premade-rule parity FAILED:");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}

console.log(
  `✓ Premade-rule parity OK — ${validatorCount} validators + ${conditionCount} conditions wired ` +
  `(${executorKeys.size} executor branches; ${unavailableCount} catalog rules marked unavailable).`,
);
