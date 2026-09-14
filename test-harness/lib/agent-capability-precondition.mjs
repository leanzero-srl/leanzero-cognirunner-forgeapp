/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/* ═══════════════════════════════════════════════════════════════════════════════
 * F-767 — A MISSING PRECONDITION IS NOT A DEFECT IN THE THING IT BLOCKS.
 *
 * Since F-485 an instance whose agent capability is off cannot hold a Virtual Administrator
 * at all, and DEV's is off. Every VA driver therefore opens with the same two moves: flip the
 * agent model slot at a frontier model for the run (`--flip-model`, replayed in the finally),
 * then read `getAgentCapability`.
 *
 * And every one of them graded the second move the same wrong way:
 *
 *     if (cap.enabled !== true) { FAIL(`the instance cannot hold an agent (${cap.reason})`); return; }
 *
 * FAIL. So running the command the driver's own usage block documents — without `--flip-model`,
 * which is the shape anyone reads off the first line — exits 1 in five seconds with a red that
 * says the SHADOW DOOR is broken, when what is actually true is that the provider slot was
 * never pointed anywhere. A precondition the operator can fix in one flag is reported as a
 * product defect, the F-508/F-514 evidence is never produced, and the red is indistinguishable
 * from a genuine one.
 *
 * TWO CHANGES, AND THE SECOND IS THE ONE THAT MATTERS:
 *
 *  1. THE VERDICT IS N/V, AND IT NAMES THE REMEDY. Nothing below the gate ran, so nothing
 *     below it is proven — that is the definition of not-verified, not of failure. And an
 *     unproven result whose sentence does not say how to prove it costs the next reader the
 *     same hour it cost this one, so the sentence names `--flip-model` in full.
 *
 *  2. IT DEFAULTS ON WHERE IT IS ALWAYS NEEDED. Staging is the only tenant these drivers'
 *     browser halves can be pointed at and the only one whose capability needs the flip, so
 *     requiring the flag there made the documented command wrong BY DEFAULT. The driver
 *     already declares `providerSlot` in its `mutates` list and already replays the slot in
 *     its finally, so defaulting the flip on broadens NOTHING an operator acknowledged — it
 *     performs a mutation that was declared, guarded and restored either way. `--no-flip-model`
 *     stays, explicitly, because a default that cannot be turned off is not a default.
 *
 * WHY THIS IS A LIB AND NOT A BLOCK IN ONE DRIVER. The gate above is copied verbatim into
 * va-shadow-door-live, va-compaction-live, va-rest-doors-live, va-capability-gate-live,
 * va-pinned-survival-live and va-recreate-settle-live. Six copies of one rule is six chances
 * for them to disagree, and they already do. This file is the one home; converging the
 * remaining callers onto it is tracked as its own finding.
 * ═══════════════════════════════════════════════════════════════════════════════ */

/** The environment on which the agent capability needs the model flip to be on at all. */
export const FLIP_MODEL_DEFAULT_ENVS = Object.freeze(["staging"]);

/**
 * Should this run flip the agent model slot?
 *
 * `--flip-model` turns it on anywhere. `--no-flip-model` turns it off anywhere, and WINS over
 * both the default and an explicit `--flip-model`: an opt-out that can be overridden by the
 * thing it opts out of is not an opt-out, and the safe reading of a contradictory command line
 * is the one that mutates less.
 *
 * @returns {{flipModel: boolean, reason: string}} — `reason` is printed, so it is a sentence.
 */
export function resolveFlipModel({ envName, argv = [], defaultEnvs = FLIP_MODEL_DEFAULT_ENVS } = {}) {
  const has = (n) => argv.includes(`--${n}`);
  const on = has("flip-model");
  const off = has("no-flip-model");

  if (off) {
    return {
      flipModel: false,
      reason: on
        ? "--no-flip-model AND --flip-model were both given; the opt-out wins, because the safe reading of a contradictory command line is the one that mutates less"
        : "--no-flip-model: the agent model slot is left exactly as the tenant holds it",
    };
  }
  if (on) return { flipModel: true, reason: "--flip-model was given explicitly" };
  if (defaultEnvs.includes(envName)) {
    return {
      flipModel: true,
      reason: `ON BY DEFAULT on ${envName} — the capability gate needs a frontier model there, and the provider slot is already declared in this run's mutates list and replayed in its finally (F-767). Pass --no-flip-model to opt out`,
    };
  }
  return { flipModel: false, reason: `off by default on ${envName} — pass --flip-model to point the agent model at a frontier model for the run` };
}

/**
 * The capability gate, judged. Returns ONE row `{verdict, what}` plus `proceed`, which is the
 * only thing the caller branches on.
 *
 * `enabled !== true` is NEVER a FAIL here. Whether the capability resolver is right about an
 * incapable instance is va-capability-gate-live's question, asked deliberately and with a
 * positive control; here it is a precondition, and a precondition that did not hold leaves
 * everything below it UNPROVEN rather than broken.
 */
export function judgeAgentCapability({ cap, flipModel, flipped, envName, frontier, slot } = {}) {
  const c = cap || {};
  if (c.enabled === true) {
    return {
      proceed: true,
      verdict: "PASS",
      what: `the instance can hold an agent: enabled=true, edition=${c.edition}, provider=${c.provider}, agentModel=${c.agentModel}`,
    };
  }
  /* F-782 — the flag-less arm. A driver that decided the flip from the INSTANCE (see
     `decideInstanceFlip` below) passes what HAPPENED, not what was asked for, and gets the
     same grading rule: a precondition that did not hold is N/V with the remedy named. */
  if (flipModel === undefined && typeof flipped === "boolean") {
    return judgeFlagless({ c, flipped, envName, frontier, slot });
  }
  const reason = c.reason === undefined ? "no reason given" : c.reason;
  if (!flipModel) {
    return {
      proceed: false,
      verdict: "N/V",
      what: `the instance cannot hold an agent (${reason}), so NOTHING below this point ran and nothing below it is proven — this is a provider-slot precondition, not a defect in the door under test. REMEDY: re-run with --flip-model, which points the agent model at a frontier model for the run and replays the slot afterwards.`,
    };
  }
  return {
    proceed: false,
    verdict: "N/V",
    what: `the instance STILL cannot hold an agent (${reason}) after --flip-model pointed the agent model at "${frontier}" on ${envName}, so nothing below this point ran. Not graded FAIL because the door under test was never reached: if the slot really does hold that model, the capability resolver disagreeing with it is a finding in its own right, and va-capability-gate-live is where it is argued.`,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * F-782 — THE SAME PRECONDITION, DECIDED WITHOUT AN OPERATOR FLAG.
 *
 * `resolveFlipModel` answers "did the operator ask for the flip?". Five more drivers never
 * ask that question: `_probe-shadow-badge`, `coder-skills-live`, `va-purge-on-delete-live`,
 * `va-receipt-copy-live` and `va-settling-carrier-live` decide the flip from the INSTANCE —
 * "the capability is off and the reason is `needs-frontier-model`, therefore point the slot
 * at a frontier model for the run and put it back in the finally". That is a legitimate
 * second shape (they are agent-model-mutating drivers whose `mutates` list already declares
 * the slot), and forcing them onto a flag they do not have would only teach the next author
 * to route around the rule.
 *
 * What was NOT legitimate is that each of them also re-spelled the F-767 VERDICT in its own
 * words — "capability is still off", "capability did not come on", `capability is off for
 * "<reason>"` — and two graded it FAIL. Same defect as F-767: a provider slot that never came
 * on is a missing precondition, so everything below it is UNPROVEN rather than broken, and
 * the sentence must carry the remedy. RULE 4b in `live-driver-scope.test.mjs` policed the
 * F-767 WORDS, so five paraphrases of one verdict walked straight past it; it now polices the
 * CLASS, and these two functions are that class's one home.
 *
 * `decideInstanceFlip` owns the DECISION (including the `needs-frontier-model` comparison —
 * the one reason a driver may fix by itself); `judgeAgentCapability`'s flag-less arm owns the
 * VERDICT. A driver calls both and grades neither itself.
 * ═══════════════════════════════════════════════════════════════════════════════ */

/** The one capability reason a driver may fix on its own, by pointing the slot at a frontier model. */
export const FLIPPABLE_REASON = "needs-frontier-model";

/**
 * Should THIS RUN flip the agent model slot, judged from the instance rather than from argv?
 *
 * @returns {{flip: boolean, blocked: boolean, reason: string}} — `flip` is the only thing to
 * branch on; `blocked` says the capability is off for something a flip cannot fix (a caller may
 * stop early on it, but need not: `judgeAgentCapability` reaches the same verdict either way).
 * `reason` is printed, so it is a sentence.
 */
export function decideInstanceFlip({ cap, frontier, envName } = {}) {
  const c = cap || {};
  if (c.enabled === true) {
    return {
      flip: false,
      blocked: false,
      reason: `the instance already holds the capability (edition=${c.edition} agentModel=${c.agentModel}), so the agent model slot is not touched and there is nothing to restore`,
    };
  }
  const reason = c.reason === undefined ? "no reason given" : c.reason;
  if (reason === FLIPPABLE_REASON) {
    return {
      flip: true,
      blocked: false,
      reason: `the capability is off for "${FLIPPABLE_REASON}" — the one reason this run may fix itself: it records the agent model slot, points it at "${frontier}" on ${envName} for the run, and replays the recorded value in its finally`,
    };
  }
  return {
    flip: false,
    blocked: true,
    reason: `the capability is off for "${reason}", which pointing the agent model at "${frontier}" cannot fix, so this run changes NOTHING on ${envName}`,
  };
}

/**
 * The flag-less arm of the verdict, reached through `judgeAgentCapability({ cap, flipped })`:
 * `flipped` is what HAPPENED, where `flipModel` is what the operator ASKED FOR. Same grading
 * rule on both arms — a capability that is off is N/V with the remedy named, never FAIL.
 *
 * F-783 — `slot` NAMES THE SLOT THAT WAS FLIPPED, and defaults to the agent model because that
 * is what every F-767/F-782 caller flips. The coder drivers converged in F-783 flip the
 * PROVIDER slot (`COGNIRUNNER_AI_PROVIDER` → "managed") instead, and an N/V sentence whose
 * REMEDY names the wrong slot costs the next reader exactly the hour these findings exist to
 * save. Omitting it reproduces the previous sentence byte for byte, so no existing caller moves.
 */
function judgeFlagless({ c, flipped, envName, frontier, slot }) {
  const what = slot || "agent model";
  const reason = c.reason === undefined ? "no reason given" : c.reason;
  if (!flipped) {
    return {
      proceed: false,
      verdict: "N/V",
      what: `the instance cannot hold an agent (${reason}) and no agent-model flip was attempted, because "${reason}" is not "${FLIPPABLE_REASON}" — the one reason a driver may fix by itself. NOTHING below this point ran and nothing below it is proven: this is a provider-slot precondition, not a defect in the door under test. REMEDY: put the instance on an edition/provider that satisfies "${reason}" and re-run.`,
    };
  }
  return {
    proceed: false,
    verdict: "N/V",
    what: `the instance STILL cannot hold an agent (${reason}) after this run pointed the ${what} at "${frontier}" on ${envName}, so nothing below this point ran. Not graded FAIL because the door under test was never reached. REMEDY: confirm the slot really holds that model — the provider/model config is TTL-cached ~30s, so a capability read taken sooner than 35s after the write still answers with the OLD model; a slot that does hold it beside a capability that still says no is a finding in its own right, and va-capability-gate-live is where it is argued.`,
  };
}
