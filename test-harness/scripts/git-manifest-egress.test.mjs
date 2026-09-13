/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline: the 1.4 manifest bump, asserted against the code that depends on it.
//
// Why a test and not a review: a manifest egress list and a hostname constant in
// JavaScript are the same rule written twice, and this repo's most expensive
// defect class is exactly that — two copies that drift. A git host added to
// src/git-providers.js without the manifest line is a call that fails at runtime
// on a customer's site with an opaque egress error; a host in the manifest with
// no code behind it is an unexplained permission on a consent screen. So the
// list has ONE home (GIT_PROVIDER_HOSTS) and this file reads manifest.yml as
// TEXT and asserts the two agree, in order.
//
// It also asserts the three other items of the single bump exist and are wired
// to the handlers that back them, and — the one that matters most — that the
// 900 s consumer does NOT carry a second copy of the token-budget gate.
//
// Run: node scripts/git-manifest-egress.test.mjs   (auto-discovered by run-offline.mjs)

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const manifest = readFileSync(path.join(root, "manifest.yml"), "utf8");

const { GIT_PROVIDER_HOSTS, GIT_PROVIDER_HOST_NAMES } = await import(
  path.join(root, "src", "git-providers.js")
);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

/* ---- split the manifest's two egress blocks ---- */
const backendIdx = manifest.indexOf("      backend:");
const clientIdx = manifest.indexOf("      client:");
ok(clientIdx > -1 && backendIdx > clientIdx, "manifest has client then backend egress blocks");
const clientBlock = manifest.slice(clientIdx, backendIdx);
const backendBlock = manifest.slice(backendIdx, manifest.indexOf("\napp:"));

const addresses = (block) =>
  [...block.matchAll(/^\s*- address:\s*"?([^"\n]+)"?\s*$/gm)].map((m) => m[1].trim());
const backendAddrs = addresses(backendBlock);
const clientAddrs = addresses(clientBlock);

/* ---- 1. LOCKSTEP: every GIT_PROVIDER_HOSTS entry is in backend egress ---- */
ok(GIT_PROVIDER_HOST_NAMES.length === 3, `GIT_PROVIDER_HOSTS has 3 entries (${GIT_PROVIDER_HOST_NAMES.join(", ")})`);
for (const host of GIT_PROVIDER_HOST_NAMES) {
  ok(backendAddrs.includes(`https://${host}`), `backend egress declares https://${host}`);
}
/* ---- and the ORDER matches, so a reviewer can diff the two side by side ---- */
const gitInManifest = backendAddrs
  .filter((a) => GIT_PROVIDER_HOST_NAMES.some((h) => a === `https://${h}`))
  .map((a) => a.replace(/^https:\/\//, ""));
ok(JSON.stringify(gitInManifest) === JSON.stringify(GIT_PROVIDER_HOST_NAMES),
  `manifest git hosts are in GIT_PROVIDER_HOSTS order (manifest: ${gitInManifest.join(",")})`);

/* ---- 2. NOT in client egress. Every git call is a backend fetch; a Custom UI
   iframe that could reach api.github.com would be a token-free but very real
   SSRF-ish surface, and it would show on the consent screen for no reason. ---- */
for (const host of GIT_PROVIDER_HOST_NAMES) {
  ok(!clientAddrs.includes(`https://${host}`), `client egress does NOT declare https://${host}`);
}

/* ---- 3. each git host is declared exactly once as an address (not two lines
   that disagree, and not a leftover from an earlier attempt). Matched on the
   WHOLE address, because "bitbucket.org" is a substring of "api.bitbucket.org"
   and a substring count would read 3 where the truth is 1. ---- */
for (const host of GIT_PROVIDER_HOST_NAMES) {
  const exact = backendAddrs.filter((a) => a === `https://${host}`).length;
  ok(exact === 1, `${host} is declared exactly once in backend egress (${exact})`);
}

/* ---- 4. NO NEW SCOPES. The FRAME is explicit: 1.4 commits 1-7 need none. A
   scope added here is a re-consent on every installed site, and it would be a
   coordinator decision, never a surgeon's. ---- */
const scopeBlock = manifest.slice(manifest.indexOf("  scopes:"), manifest.indexOf("  external:"));
const scopes = [...scopeBlock.matchAll(/^\s*- ([a-z0-9:_\-]+)\s*$/gim)].map((m) => m[1]);
ok(scopes.length === 20, `scope count is unchanged at 20 (got ${scopes.length}: ${scopes.join(" ")})`);
for (const s of ["read:jira-work", "write:jira-work", "storage:app"]) {
  ok(scopes.includes(s), `scope ${s} still present`);
}

/* ---- 5. the production git webhook exists, is SEPARATE from the probe, and is
   backed by a function that is not the probe's. ---- */
ok(/- key: git-webhook\n/.test(manifest), "webtrigger git-webhook is declared");
ok(/- key: git-webhook-probe\n/.test(manifest), "the DEV probe webtrigger still exists, separately");
ok(/- key: git-webhook\n\s+function: gitWebhookFn/.test(manifest), "git-webhook is backed by gitWebhookFn");
ok(/- key: gitWebhookFn\n\s+handler: index\.gitWebhook\n/.test(manifest), "gitWebhookFn maps to index.gitWebhook");
ok(!/- key: git-webhook\n\s+function: gitWebhookProbeFn/.test(manifest),
  "the production webtrigger is NOT wired to the unauthenticated probe handler");

const indexSrc = readFileSync(path.join(root, "src", "index.js"), "utf8");
ok(/export async function gitWebhook\s*\(/.test(indexSrc), "index.js exports gitWebhook");
ok(/export \{ testStateTrigger, gitWebhookProbe \} from "\.\/test-hook"/.test(indexSrc),
  "the probe is still its own, separately exported, handler");

/* ---- 6. the 900 s consumer, and THE ONE GATE ---- */
ok(/- key: long-consumer\n\s+queue: long-queue\n\s+function: long-ai-handler/.test(manifest),
  "consumer long-consumer is declared on long-queue");
ok(/- key: long-ai-handler\n\s+handler: async-handler\.longHandler\n\s+timeoutSeconds: 900/.test(manifest),
  "long-ai-handler is async-handler.longHandler at 900 s");
ok(/- key: async-ai-handler\n\s+handler: async-handler\.handler\n\s+timeoutSeconds: 120/.test(manifest),
  "the original consumer is unchanged at 120 s");

const ah = readFileSync(path.join(root, "src", "async-handler.js"), "utf8");
// THE assertion of §3.17(3): one gate, executed by both entry points. The gate
// is `aiBudgetGate` — if a second consumer ever grows its own copy, the count
// of call sites goes above one and this fails.
const gateCalls = ah.split("aiBudgetGate(").length - 1;
ok(gateCalls === 1, `aiBudgetGate is CALLED exactly once in async-handler.js (${gateCalls}) — no second copy of the governor`);
ok(/export async function longHandler\(event\)\s*\{\s*return handler\(event\);\s*\}/.test(ah),
  "longHandler DELEGATES to handler — the two consumers differ only by manifest timeoutSeconds");
const budgetGateMarkers = ah.split("TOKEN-BUDGET GATE").length - 1;
ok(budgetGateMarkers === 1, `there is exactly one TOKEN-BUDGET GATE section (${budgetGateMarkers})`);
// 1.4 commit 4b — and that section IS the extracted function, not a region inlined in
// one consumer. Both entry points reach it: `handler` calls it, `longHandler` delegates
// to `handler` (asserted just above).
ok(/export async function runGatedTask\(event, deps = \{\}\)/.test(ah), "the gate is the exported runGatedTask");
ok(ah.indexOf("TOKEN-BUDGET GATE") < ah.indexOf("export async function runGatedTask")
  && ah.indexOf("export async function runGatedTask") < ah.indexOf("aiBudgetGate("),
  "the one marker and the one aiBudgetGate call both belong to runGatedTask");
ok((ah.split("await runGatedTask(").length - 1) === 1, "runGatedTask is called from exactly one place");

/* ---- 7. the Coder issue panel, on the EXISTING resource ---- */
ok(/jira:issuePanel:\n\s+- key: coder-panel/.test(manifest), "jira:issuePanel coder-panel is declared");
ok(/- key: coder-panel\n\s+resource: issue-glance-resource/.test(manifest),
  "coder-panel reuses the EXISTING issue-glance-resource (one resource may back several modules)");
ok(/- key: coder-panel\n(\s+.*\n)*?\s+title: CogniRunner Coder/.test(manifest), "its title is 'CogniRunner Coder'");
const resourceKeys = [...manifest.matchAll(/^  - key: ([a-z0-9\-]+)\n    path: /gim)].map((m) => m[1]);
ok(resourceKeys.includes("issue-glance-resource") && !resourceKeys.includes("coder-panel-resource"),
  "no new resource was added for the panel");

/* ---- 8. exactly the four bump items, and nothing else new ---- */
ok((manifest.match(/^  consumer:$/gm) || []).length === 1, "there is still ONE consumer section");
ok((manifest.match(/- key: /g) || []).length > 0, "manifest parsed");

console.log(`git-manifest-egress: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
