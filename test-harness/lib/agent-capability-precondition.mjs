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
export function judgeAgentCapability({ cap, flipModel, envName, frontier } = {}) {
  const c = cap || {};
  if (c.enabled === true) {
    return {
      proceed: true,
      verdict: "PASS",
      what: `the instance can hold an agent: enabled=true, edition=${c.edition}, provider=${c.provider}, agentModel=${c.agentModel}`,
    };
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
