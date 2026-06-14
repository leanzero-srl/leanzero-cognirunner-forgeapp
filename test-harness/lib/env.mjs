/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Zero-dependency .env loader so the REST scripts run without `npm install`.
// Splits on the FIRST '=' only — the Atlassian API token itself contains '='.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
export const HARNESS_ROOT = join(HERE, "..");

function parseEnv(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

let loaded = null;
export function loadEnv() {
  if (loaded) return loaded;
  const envPath = join(HARNESS_ROOT, ".env");
  if (!existsSync(envPath)) {
    throw new Error(
      `Missing ${envPath}. Copy .env.example to .env and fill it in.`
    );
  }
  const parsed = parseEnv(readFileSync(envPath, "utf8"));
  for (const [k, v] of Object.entries(parsed)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
  loaded = { ...parsed, ...process.env };
  return loaded;
}

export function requireEnv(name) {
  const env = loadEnv();
  const v = env[name];
  if (!v) throw new Error(`Required env var ${name} is not set in .env`);
  return v;
}
