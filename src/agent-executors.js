/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * THE EXECUTOR ASSEMBLER (F-852) — one function that answers "which namespace modules
 * does THIS headless rule's run hold, and why not the others?".
 *
 * WHY IT EXISTS. Until this module there was no such function, and three private maps
 * had each answered a slice of the question for their own surface: the Coder builds a
 * git executor from its thread record (src/coder-engine.js), the Virtual Administrator
 * builds ledger/confluence/git/web from its ticked powers (src/virtual-admin.js), and
 * the agent runner installs `web` for every surface because the credential is the
 * bridge's (src/agent-runner.js). The listener and scheduled-job seam had NO map at
 * all: `executors = {}` was the default through all four of its doors (the queue
 * consumer, the resolver test, the REST test and the hook probe), so an admin-saved
 * rule whose git action had just survived the whole save-time and run-time gate reached
 * the dispatcher and was told `"commit_files" needs a git connection, and none is
 * configured for this rule.` — a sentence that was not merely unhelpful but FALSE: the
 * instance's connection was configured; the rule had no way to name it and there was no
 * code to build an executor from it.
 *
 * WHAT IT WILL NOT DO.
 *   · `ledger` is the Virtual Administrator's and only the VA's. Staged speech, human
 *     questions and change proposals are that product's whole safety model (no tool call
 *     ever speaks); a listener or a job that could stage a reply would be a second,
 *     ungoverned VA. Not built here, ever — a named refusal instead.
 *   · `web` is installed by the RUNNER (src/agent-runner.js), because nobody supplies
 *     its credential: the hosted MCP's key lives in the bridge. Building it here as well
 *     would be a fourth copy of one rule and would put the run's search ceiling in two
 *     places.
 *
 * THE REFUSAL REASONS TRAVEL WITH THE MAP. `refusals` is a plain object on the returned
 * map, keyed by namespace, holding the sentence the MODEL should read when it calls an
 * action of a namespace this run could not build. The dispatcher prefers it over its own
 * generic sentence. `refusals` is not a namespace id and can never become one — the
 * offline parity gate asserts exactly that.
 */

import { createGitActionExecutor } from "./git-actions.js";
import { createConfluenceActionExecutor } from "./confluence-actions.js";
import { listConnections } from "./git-connections.js";
import { getAgentAction, agentActionNamespace, AGENT_ACTION_NAMESPACE_IDS } from "./shared/agent-actions.js";

/**
 * The namespaces THIS assembler can build. The COMPLEMENT is the contract, and it is
 * asserted offline against AGENT_ACTION_NAMESPACE_IDS: `jira` is executed inline by the
 * dispatcher, `web` by the runner, `ledger` by the VA. A new namespace therefore cannot
 * land without somebody deciding, in writing, which of these four lists it joins.
 * (`control` is a `kind`, not a namespace key — `agentActionNamespace` resolves a
 * control action to "control" ahead of its declared namespace, which is how `finish`
 * stays inline on every surface.)
 */
export const ASSEMBLED_NAMESPACE_IDS = Object.freeze(["git", "confluence"]);
export const RUNNER_OWNED_NAMESPACE_IDS = Object.freeze(["web"]);
export const VA_ONLY_NAMESPACE_IDS = Object.freeze(["ledger"]);
export const INLINE_NAMESPACE_IDS = Object.freeze(["jira"]);

/** A listener or a job may never stage speech. One sentence, one home. */
export const LEDGER_NOT_ON_THIS_SURFACE =
  "the agent ledger belongs to the Virtual Administrator — a listener or a scheduled job cannot stage a reply, ask a human or file a proposal. Do what the instructions ask with the tools you have, then finish and say what you could not do.";

/**
 * THE NAMED REFUSAL that replaces "none is configured for this rule".
 *
 * `count` is how many Git connections the INSTANCE has, and the number is the difference
 * between "somebody must connect a provider" and "somebody must pick which one". Those
 * are two different jobs for two different people; one sentence covering both teaches
 * neither. `null` (the count could not be read) gets the sentence that names no number.
 */
export const gitNoConnectionReason = (count) => {
  const n = Number.isFinite(Number(count)) && count !== null ? Math.max(0, Math.trunc(Number(count))) : null;
  if (n === null) return "this rule does not name a Git connection — open the rule and choose the Git connection it acts as.";
  if (n === 0) return "this rule does not name a Git connection, and this instance has none — an administrator connects a Git provider in CogniRunner Settings before this action can run.";
  if (n === 1) return "this rule does not name a Git connection. The instance has one; open the rule and choose it, so the rule says which account it acts as.";
  return `this rule does not name a Git connection. The instance has ${n}; open the rule and choose which one it acts as — that choice cannot be guessed from ${n} of them.`;
};

/** The namespaces the rule's allowed ids actually reach, in the order they are held. */
export const namespacesHeld = (allowedActions) => {
  const out = [];
  for (const raw of Array.isArray(allowedActions) ? allowedActions : []) {
    const a = getAgentAction(String(raw));
    if (!a) continue;
    const ns = agentActionNamespace(a);
    if (ns === "jira" || ns === "control") continue;
    if (!out.includes(ns)) out.push(ns);
  }
  return out;
};

/**
 * How many Git connections the instance has — read ONLY in order to phrase a refusal,
 * and only on a path that is already refusing, so the common run pays nothing. A fault
 * answers `null`: failing to count is not a reason to fail the run, and it is certainly
 * not a reason to invent a count.
 */
const countGitConnections = async (deps) => {
  try {
    const list = await ((deps && deps.listConnections) || listConnections)();
    return Array.isArray(list) ? list.length : null;
  } catch (e) { return null; }
};

/**
 * Assemble the executor map for ONE run of ONE headless rule (a listener or a job).
 *
 * @param {object}  opts
 * @param {"listener"|"job"} [opts.surface]  which rule kind is running (for the log line)
 * @param {object}  opts.rule       the STORED, normalised rule row. `rule.agent.connectionId`
 *                                  is the rule's own Git connection; it is validated LAZILY,
 *                                  by `getConnection` inside the executor, so a connection
 *                                  deleted after the rule was saved refuses with the store's
 *                                  own sentence instead of being pre-checked here as well.
 * @param {object}  [opts.ctx]      the delivery. A GIT-TRIGGERED delivery carries
 *                                  `ctx.connectionId` — the connection whose webhook
 *                                  delivered the event — and it WINS over the rule's,
 *                                  because a run started by connection A acts on A.
 * @param {boolean} [opts.simulation] the run's simulation verdict, ALREADY computed by the
 *                                  caller (`forceSimulation || rule.simulationMode === true`).
 *                                  Passed in rather than re-derived: two readings of "is
 *                                  this simulated" is how a simulated run makes a real commit.
 * @param {Function}[opts.log]
 * @param {object}  [opts.deps]     test seams only.
 * @returns {Promise<object>} `{ [namespace]: executor, refusals: { [namespace]: sentence } }`
 */
export const assembleAgentExecutors = async ({ surface = "listener", rule = null, ctx = null, simulation = false, log = () => {}, deps = {} } = {}) => {
  const makeGit = (deps && deps.createGitActionExecutor) || createGitActionExecutor;
  const makeConfluence = (deps && deps.createConfluenceActionExecutor) || createConfluenceActionExecutor;
  const executors = {};
  const refusals = {};
  const agent = (rule && rule.agent && typeof rule.agent === "object") ? rule.agent : {};

  for (const ns of namespacesHeld(agent.allowedActions)) {
    if (ns === "ledger") { refusals.ledger = LEDGER_NOT_ON_THIS_SURFACE; continue; }
    // `web` is the RUNNER's (see the header). Deliberately NOT ours and deliberately
    // without a refusal reason: a reason here would contradict an executor that the
    // runner is about to install two frames further down.
    if (ns === "web") continue;
    if (ns === "git") {
      // ORDER IS THE RULE: the delivery's connection, then the rule's, then nothing.
      // There is deliberately NO "the instance has exactly one, so use it" fallback in
      // the RUNTIME — a rule that acts as an account nobody named is a rule whose blast
      // radius is a deployment detail, and it would change meaning the day a second
      // connection is added. The sole-connection case is a PRE-SELECTION in the editor
      // (a later cut), so that the record still carries the name it acts as.
      const connectionId = (ctx && ctx.connectionId) || agent.connectionId || null;
      if (!connectionId) {
        refusals.git = gitNoConnectionReason(await countGitConnections(deps));
        log(`${surface}: no Git executor — ${refusals.git}`);
        continue;
      }
      executors.git = makeGit({ simulation: simulation === true, log, connectionId });
      continue;
    }
    if (ns === "confluence") {
      // READ-ONLY UNTIL A RULE CARRIES SPACES. `spaces: []` is passed EXPLICITLY: the
      // executor reads an empty allow-list as "no writes at all" (its own sentence, the
      // same one a read-only VA gets), while search and read still work. Omitting the
      // argument means the same thing today and would stop meaning it the day the
      // default changes — the explicit value is the decision, written down.
      executors.confluence = makeConfluence({ simulation: simulation === true, spaces: [], log });
      continue;
    }
  }
  executors.refusals = refusals;
  return executors;
};

/** The four lists, for the offline parity gate. */
export const ASSEMBLER_NAMESPACE_CONTRACT = Object.freeze({
  assembled: ASSEMBLED_NAMESPACE_IDS, runner: RUNNER_OWNED_NAMESPACE_IDS,
  va: VA_ONLY_NAMESPACE_IDS, inline: INLINE_NAMESPACE_IDS, all: AGENT_ACTION_NAMESPACE_IDS,
});

export default assembleAgentExecutors;
