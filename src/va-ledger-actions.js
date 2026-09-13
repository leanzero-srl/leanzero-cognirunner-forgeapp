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
 */

/**
 * EXECUTOR for the `ledger` agent-action namespace (src/shared/agent-actions.js).
 *
 * One module per namespace; `src/agent-runner.js` delegates by namespace and never
 * learns a ledger action id. These bodies were MOVED here from `oneItemTurn`'s inline
 * switch in src/virtual-admin.js (1.5 commit 4a) — not copied. The engine is now a
 * CALLER: it builds this executor with the item's context and hands it to
 * `createAgentActionDispatcher`, exactly as the Coder hands it a git executor.
 *
 * WHY IT IS A SEPARATE MODULE FROM `src/va-ledger.js`. That file is the ledger STORE:
 * rows, claims, fingerprints, TTLs, compaction. This one is the TOOL SURFACE over it.
 * The split is the same one git already has (`git-connections.js` store,
 * `git-actions.js` executor), and the namespace table names THIS module.
 *
 * WHAT THIS EXECUTOR CANNOT DO, BY CONSTRUCTION:
 *   · post anything. There is no branch here that writes a Jira comment. The staged
 *     reply becomes a row; the POST PHASE (src/virtual-admin.js `runVaPost`) is what
 *     eventually speaks, and it is not reachable from a tool call.
 *   · reach a project the model names. `ask_human` and `propose_change` file into the
 *     approval inbox from the RECORD (`guardrails.approvalProjectKey`), validated at
 *     save time. The model has no argument that can change the target, which is why
 *     these two creates do not go through the write-scope gate: there is nothing for
 *     the gate to check.
 *   · change any configuration. No scheme, workflow, permission, role or field action
 *     exists anywhere in the catalogue, so `propose_change` is the only route rather
 *     than the approved one.
 *
 * EVERY DEPENDENCY IS INJECTED. The engine owns the issue read, the audience decision,
 * the fingerprint and the issue create; this module owns only the ledger writes and the
 * sentences the model reads back. That keeps the import graph acyclic
 * (virtual-admin.js → va-ledger-actions.js → va-ledger.js, never back) and lets the
 * offline suite drive every branch with no Forge runtime at all.
 */
import { saveItem, writeMemory } from "./va-ledger.js";
import { clampChars } from "./shared/text-clamp.js";

const isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);
const asArray = (v) => (Array.isArray(v) ? v : []);
const str = (v) => String(v == null ? "" : v);
const nowIso = (ms) => new Date(ms == null ? Date.now() : ms).toISOString();

/** The ids this executor handles, in catalogue order. `finish` is NOT one of them. */
export const VA_LEDGER_ACTION_IDS = Object.freeze([
  "stage_reply", "ask_human", "propose_change", "ledger_note", "memory_note",
]);

/**
 * Build the ledger executor for ONE item turn.
 *
 * `outcome` is the accumulator the engine reads after the loop to decide whether the
 * turn produced anything (F-414's attempt counter). It is exposed on the returned
 * object rather than returned separately so that there is exactly one of it and the
 * engine cannot end up counting a different set of events than the executor recorded.
 *
 * @param {object}   ctx
 * @param {object}   ctx.store         the KVS-shaped store the ledger writes through
 * @param {string}   ctx.agentId       the VA job id
 * @param {string}   ctx.issueKey      the item
 * @param {object}   ctx.va            the normalised VA record
 * @param {object}   ctx.issue         the issue as read this turn
 * @param {string}   ctx.tickId        the tick that staged (the post floor's 2nd condition)
 * @param {object}   ctx.memory        the agent memory object, MUTATED in place on write
 * @param {Function} ctx.now           () => epoch ms
 * @param {Function} ctx.createIssue   (fields) => created issue, for the approval inbox
 * @param {Function} ctx.decideAudience  the engine's audience gate
 * @param {Function} ctx.fingerprintOf   the ledger's fingerprint builder
 * @param {string|null} [ctx.addresseeAccountId] who the reply answers, read from the issue
 * @param {string|null} [ctx.selfAccountId] the app's own account — the baseline ignores our own comments
 * @param {Function} [ctx.log]
 */
export const createVaLedgerExecutor = ({
  store, agentId, issueKey, va, issue, tickId, memory,
  now = () => Date.now(), createIssue, decideAudience, fingerprintOf,
  // THE ADDRESSEE IS COMPUTED BY THE ENGINE FROM THE ISSUE, NEVER BY THE MODEL.
  // It decides whether a customer-visible reply is even possible, so taking it from a
  // tool argument would let the model name the reporter and talk its own way onto the
  // portal. It arrives here as a fact about the issue, not as an argument.
  addresseeAccountId = null,
  // THE APP'S OWN ACCOUNT (F-453). The staged draft's freshness BASELINE is "the last
  // thing somebody else said", and the post phase's `gateFreshness` asks the same
  // question of the same function. Without it the two disagree on every issue where we
  // spoke last, and every draft is dropped as "the thread moved" — for ever.
  selfAccountId = null,
  log = () => {},
} = {}) => {
  const outcome = { staged: null, asked: false, proposed: false, notes: 0, memories: 0 };
  const persona = isObj(va && va.persona) ? va.persona : {};
  const guardrails = isObj(va && va.guardrails) ? va.guardrails : {};
  const inboxKey = () => str(guardrails.approvalProjectKey);

  /**
   * The anti-pile-up window doubles as the "chase a human no sooner than" clock. It is
   * REUSED rather than a second number invented: it is already exactly "how long before
   * this agent may speak on this issue again", so asking again sooner would break the
   * agent's own quiet rule with a constant nobody configured.
   */
  const dueDate = () => nowIso(now() + Math.max(1, Number(guardrails.antiPileUpDays) || 1) * 86400000);

  /** The freshness baseline: the last comment id visible when the draft was written. */
  const baselineOf = () => {
    const fp = fingerprintOf(issue, { selfAccountId });
    return fp.lastCommentId == null ? "" : String(fp.lastCommentId);
  };

  const stage = async (staged, patch) => saveItem(store, agentId, issueKey, {
    state: "staged",
    staged: { baseline: baselineOf(), tickId, stagedAt: nowIso(now()), ...staged },
    ...patch,
  }, { now: now() });

  const PLANS = {
    stage_reply: async (a) => {
      const decided = decideAudience({
        requested: a.audience === "customer" ? "public" : "internal",
        va, issue, addresseeAccountId,
      });
      const fp = fingerprintOf(issue, { selfAccountId });
      const saved = await saveItem(store, agentId, issueKey, {
        state: "staged",
        staged: {
          audience: decided.audience,
          body: str(a.body),
          reason: str(a.reason),
          baseline: fp.lastCommentId == null ? "" : String(fp.lastCommentId),
          tickId,
          stagedAt: nowIso(now()),
        },
        fingerprint: fp,
        event: "staged",
        reason: `${decided.audience} (${decided.reason})`,
      }, { now: now() });
      if (!saved.ok) return { success: false, code: "ledger_write", error: `The reply could not be staged: ${saved.reason}.` };
      outcome.staged = { audience: decided.audience, reason: decided.reason };
      return {
        staged: true, audience: decided.audience, audienceReason: decided.reason,
        // A DOWNGRADE MUST CLOSE THE DOOR, not just report itself. A model told only
        // "it was staged internally" reasonably looks for another way to reach the
        // customer; told there is no other way, it stops looking. There genuinely is
        // none — this is the sentence matching the code.
        note: decided.audience === "internal" && a.audience === "customer"
          ? "You asked for a customer reply and it was staged as an internal note instead. The reason is above. Do not try to send it another way; there is no other way."
          : "Staged. It goes out on a later run if every check passes.",
      };
    },

    ask_human: async (a) => {
      const summary = str(a.summary);
      const needs = str(a.needs);
      const dueAt = dueDate();
      const inbox = inboxKey();
      if (inbox) {
        try {
          const created = await createIssue({
            project: { key: inbox }, issuetype: { name: "Task" },
            summary: clampChars(`${persona.name || "Agent"} needs a decision on ${issueKey}`, 250),
            description: `${summary}\n\nWhat would unblock it: ${needs}\n\nIssue: ${issueKey}`,
          });
          await saveItem(store, agentId, issueKey, { state: "waiting_on_human", dueAt, event: "asked", reason: clampChars(summary, 200) }, { now: now() });
          outcome.asked = true;
          return { asked: true, where: `${inbox} (${created && created.key})`, note: "A human has been asked. This item now waits; you will not work it again until they answer or it falls due." };
        } catch (e) {
          return { success: false, code: "inbox_write", error: `The approval inbox ${inbox} could not be written to: ${str(e && e.message || e).slice(0, 160)}. Ask again as an internal note instead.` };
        }
      }
      // NO INBOX: the question is STAGED as an internal note, so it still goes through
      // every post gate. It does NOT bypass the two-phase clock just because it is
      // addressed to a colleague — a question posted three times is as bad as a reply
      // posted three times.
      const saved = await stage(
        { audience: "internal", kind: "ask", body: `${summary}\n\nWhat would unblock this: ${needs}`, reason: "asking a human" },
        { dueAt, event: "asked", reason: clampChars(summary, 200) },
      );
      if (!saved.ok) return { success: false, code: "ledger_write", error: `The question could not be staged: ${saved.reason}.` };
      outcome.asked = true;
      outcome.staged = { audience: "internal", reason: "ask_human" };
      return { asked: true, where: "an internal note on this issue", note: "Staged as an internal note. It goes out on a later run." };
    },

    propose_change: async (a) => {
      // IT NEVER EXECUTES. Not "it executes after approval" — this branch's entire
      // implementation writes text. There is no code path from here to a scheme, a
      // workflow, a permission or a bulk edit, because no such action exists at all.
      const text = [
        `Proposed ${str(a.kind) || "change"} on ${str(a.target) || "?"}`,
        `Blast radius: ${str(a.blastRadius) || "unknown"}`,
        `Steps: ${str(a.steps)}`,
        `Raised from ${issueKey}.`,
      ].join("\n");
      const inbox = inboxKey();
      outcome.proposed = true;
      if (inbox) {
        try {
          const created = await createIssue({
            project: { key: inbox }, issuetype: { name: "Task" },
            summary: clampChars(`Proposal: ${str(a.kind) || "change"} on ${str(a.target) || "?"}`, 250),
            description: text,
          });
          await saveItem(store, agentId, issueKey, { event: "proposed", reason: clampChars(str(a.kind) || "change", 200) }, { now: now() });
          return { proposed: true, executed: false, where: `${inbox} (${created && created.key})`, note: "Filed for a human to decide. Nothing was changed." };
        } catch (e) {
          return { success: false, code: "inbox_write", error: `The proposal could not be filed in ${inbox}: ${str(e && e.message || e).slice(0, 160)}.` };
        }
      }
      const saved = await stage(
        { audience: "internal", kind: "proposal", body: text, reason: "proposing a change" },
        { event: "proposed", reason: clampChars(str(a.kind) || "change", 200) },
      );
      if (!saved.ok) return { success: false, code: "ledger_write", error: `The proposal could not be staged: ${saved.reason}.` };
      outcome.staged = { audience: "internal", reason: "proposal" };
      return { proposed: true, executed: false, where: "an internal note on this issue", note: "Staged as an internal note. Nothing was changed." };
    },

    ledger_note: async (a) => {
      const saved = await saveItem(store, agentId, issueKey, { notes: str(a.note), event: "note" }, { now: now() });
      if (!saved.ok) return { success: false, code: "ledger_write", error: `The note could not be saved: ${saved.reason}.` };
      outcome.notes++;
      return { saved: true };
    },

    memory_note: async (a) => {
      // DEFANGED AND CLAMPED AT WRITE TIME by `writeMemory` (F-423) — not here, and not
      // at injection. One row that cannot contain a fence marker is safe at every
      // injection site, including the ones that do not exist yet.
      const constraints = asArray(memory && memory.constraints).slice();
      let text = (memory && memory.text) || "";
      if (a.constraint === true) constraints.push(str(a.note));
      else text = `${text}${text ? "\n" : ""}${str(a.note)}`;
      const wrote = await writeMemory(store, agentId, { text, constraints }, { now: now() });
      if (!wrote.ok) return { success: false, code: "ledger_write", error: `That could not be remembered: ${wrote.reason}.` };
      // The engine's `memory` object is the one injected into the NEXT round's prompt in
      // this same turn, so it is updated in place rather than re-read.
      if (isObj(memory)) { memory.text = wrote.memory.text; memory.constraints = wrote.memory.constraints; }
      outcome.memories++;
      return { remembered: true, constraint: a.constraint === true };
    },
  };

  return {
    namespace: "ledger",
    actionIds: [...VA_LEDGER_ACTION_IDS],
    outcome,
    handles: (id) => Object.prototype.hasOwnProperty.call(PLANS, str(id)),

    /**
     * Execute one ledger action. NEVER throws: every failure is a
     * `{ success:false, code, error }` the runner hands straight back to the model, the
     * same contract `git-actions.js` settled on. A ledger action that threw would end
     * the turn on an exception and lose the rest of it, for a KVS wobble.
     */
    async execute(actionId, args = {}) {
      const id = str(actionId);
      const plan = PLANS[id];
      if (!plan) return { success: false, code: "unknown_action", error: `"${id}" is not a ledger action.` };
      if (!args || typeof args !== "object" || Array.isArray(args)) {
        return { success: false, code: "invalid_args", error: `${id}: tool arguments must be a JSON object.` };
      }
      try {
        return await plan(args);
      } catch (e) {
        log(`ledger ${id} failed: ${str(e && e.message || e).slice(0, 200)}`);
        return { success: false, code: "unknown", error: str(e && e.message || e).slice(0, 300) };
      }
    },
  };
};

export default createVaLedgerExecutor;
