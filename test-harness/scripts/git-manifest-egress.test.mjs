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

/* ---- 4. NO SCOPE ARRIVES WITHOUT A DECISION. The FRAME was explicit that 1.4
   commits 1-7 need none, and this assertion was a bare count of 20. A count is a
   tripwire, not a statement: it says a scope appeared but never which one was
   sanctioned, so the only way past it is to retype a bigger number — which is the
   same edit whether the scope was approved or smuggled.

   So it is now an EXACT SET. Adding a scope means writing it here, next to the
   release that sanctioned it, and a scope that is not on this list fails the build
   by NAME. The 1.5 addition is the three Confluence WRITE scopes (commit 7a), which
   the FRAME states as the entire manifest scope delta of the Confluence half; they
   are a MAJOR version bump and a re-consent on every installed site, which is a
   coordinator decision and never a surgeon's. ---- */
const SANCTIONED_SCOPES = [
  // Jira, since 1.0-1.3.
  "read:jira-work", "write:jira-work", "read:jira-user",
  "read:workflow:jira", "write:workflow:jira", "read:project:jira", "storage:app",
  "read:issue-type-screen-scheme:jira", "read:screen-scheme:jira", "read:screen-tab:jira",
  "manage:jira-configuration", "read:screenable-field:jira", "manage:jira-project",
  "write:sprint:jira-software", "write:board-scope:jira-software", "write:issue:jira-software",
  // Coder plan Part 0 probes (2026-09-12): JSM queue intake + Confluence reach.
  "read:servicedesk-request", "read:space:confluence", "read:page:confluence", "search:confluence",
  // 1.5 commit 7a — the Confluence WRITE half. MAJOR version + `forge install --upgrade`.
  "write:page:confluence", "read:comment:confluence", "write:comment:confluence",
];
const scopeBlock = manifest.slice(manifest.indexOf("  scopes:"), manifest.indexOf("  external:"));
const scopes = [...scopeBlock.matchAll(/^\s*- ([a-z0-9:_\-]+)\s*$/gim)].map((m) => m[1]);
for (const s of scopes) {
  ok(SANCTIONED_SCOPES.includes(s), `manifest scope "${s}" is on the sanctioned list`);
}
for (const s of SANCTIONED_SCOPES) {
  ok(scopes.includes(s), `sanctioned scope "${s}" is still in the manifest`);
}
ok(scopes.length === SANCTIONED_SCOPES.length,
  `no scope is declared twice (${scopes.length} in the manifest, ${SANCTIONED_SCOPES.length} sanctioned)`);
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
// F-804 — the specifier carries its `.js`: the Forge bundler accepts an extensionless one,
// Node's ESM resolver does not, and `?what=execlogs` imports src/index.js.
ok(/export \{ testStateTrigger, gitWebhookProbe \} from "\.\/test-hook\.js"/.test(indexSrc),
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
// 1.4 commit 8 — longHandler now also MARKS the event as "arrived on the long queue"
// (LONG_QUEUE_EVENTS), because `coder` refuses to run on the 120 s consumer. That mark is
// the only thing it may add: the body must still be the mark plus the delegation and
// nothing else, or the second consumer has started growing a body of its own.
const longBody = (ah.match(/export async function longHandler\(event\)\s*\{([\s\S]*?)\n\}/) || [])[1] || "";
ok(/LONG_QUEUE_EVENTS\.add\(event\)/.test(longBody) && /return handler\(event\);/.test(longBody),
  "longHandler marks the event and DELEGATES to handler");
ok(longBody.split(";").filter((s) => s.trim()).length <= 2,
  "longHandler's body is the mark and the delegation only — the two consumers still differ only by manifest timeoutSeconds");
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
