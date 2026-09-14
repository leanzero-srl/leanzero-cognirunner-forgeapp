/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * F-909 - THE CODER GATE ASKS THE CAPABILITY, NOT THE EDITION.
 *
 * `coderGate` in src/index.js ran `requireAdvanced(context, "coder")` FIRST, and
 * `isFeatureAllowed(edition, "coder")` decides on EDITION ALONE. So a Standard tenant
 * on a BYOK provider - which pays for its own tokens and whose listeners, jobs and
 * Git-aware rules all run - was refused every issue-panel turn with "The Coder toolset
 * ... is part of CogniRunner Coder", while `getAgentCapability` answered `byok` on the
 * very same instance. Two doors, one tenant, opposite answers, and the refusing one was
 * the one the reader could see.
 *
 * The plan's decision 1 is that advanced agent features are a CAPABILITY, not an
 * edition, so this suite pins the four corners of `agentCapability`'s answer as the
 * gate now renders them, and pins that an edition refusal never comes back from this
 * door again (`upgradeRequired` carries `upgradeRequired:true` - its absence is the
 * regression assertion).
 *
 * Run: node scripts/coder-gate-capability-f909.test.mjs (auto-discovered by run-offline.mjs)
 */

import "../lib/register-mocks-index.mjs";
import storage from "../lib/mock-kvs.mjs";
import { FORGE_LLM_DEFAULT } from "../../src/shared/edition.js";
const { default: forgeApi } = await import("@forge/api");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const OWNER = "acct-owner";
await storage.set("app_admins", [{ accountId: OWNER, role: "admin", scope: "all" }]);
forgeApi.__respond(() => forgeApi.__response(200, {}));

const { handler } = await import("../../src/index.js");

const CODER_LICENSE = { isActive: true, capabilitySet: "CAPABILITYADVANCED" };
const STANDARD_LICENSE = { isActive: true, capabilitySet: "CAPABILITYSTANDARD" };

const call = (functionKey, payload, license) =>
  handler({ call: { functionKey, payload }, context: { license } }, { principal: { accountId: OWNER } });

/* The four facts the gate decides from, set the way the instance would carry them. The
 * gate reads the provider FRESH (readProviderConfigFresh), so the 30 s memo cannot pin
 * one world for the whole process and all four cases run in this one. */
const world = async ({ provider, agentModel }) => {
  await storage.set("COGNIRUNNER_AI_PROVIDER", provider);
  await storage.set("COGNIRUNNER_OPENAI_KEY_openai", "sk-test");
  if (agentModel) await storage.set(`COGNIRUNNER_AGENT_MODEL_${provider}`, agentModel);
};

let turn = 0;
const startTurn = (license) =>
  call("startCoderTurn", { issueKey: "LZPT-909", threadId: `t_f909_${++turn}`, message: "have a look", simulation: true }, license);

/* BLOCK: Standard + Forge LLM - the edition really is the missing thing */
await world({ provider: "atlassian", agentModel: "claude-sonnet-5" });
{
  const r = await startTurn(STANDARD_LICENSE);
  ok(r && r.success === false, "Standard + Forge LLM is refused");
  ok(r && r.agentDisabled === true, `the refusal is the CAPABILITY family (got ${JSON.stringify(r).slice(0, 220)})`);
  ok(r && r.reason === "needs-coder-edition", `and names the edition as the reason (got ${r && r.reason})`);
  ok(r && typeof r.error === "string" && /Standard/.test(r.error), "the sentence still tells them the site is on Standard");
}

/* BLOCK: Coder + Haiku - the edition is there, the model is not */
await world({ provider: "atlassian", agentModel: FORGE_LLM_DEFAULT });
{
  const r = await startTurn(CODER_LICENSE);
  ok(r && r.success === false && r.agentDisabled === true, `Coder + Haiku is refused as a capability (got ${JSON.stringify(r).slice(0, 220)})`);
  ok(r && r.reason === "needs-frontier-model", `and names the MODEL as the reason (got ${r && r.reason})`);
}

/* ALLOW: Standard + OpenAI - F-909 itself */
await world({ provider: "openai", agentModel: "gpt-5.4" });
{
  const r = await startTurn(STANDARD_LICENSE);
  ok(!(r && r.agentDisabled), `a BYOK tenant on Standard is NOT capability-refused (got ${JSON.stringify(r).slice(0, 220)})`);
  ok(!(r && r.upgradeRequired), "and is NOT told to upgrade the edition - F-909's regression pin");
}

/* ALLOW: Coder + Sonnet 5 on Forge LLM */
await world({ provider: "atlassian", agentModel: "claude-sonnet-5" });
{
  const r = await startTurn(CODER_LICENSE);
  ok(!(r && r.agentDisabled), `Coder + a frontier model runs (got ${JSON.stringify(r).slice(0, 220)})`);
  ok(!(r && r.upgradeRequired), "and no edition refusal");
}

console.log(`\ncoder-gate-capability-f909: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
