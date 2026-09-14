/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/* ═══════════════════════════════════════════════════════════════════════════════
 * F-767 — THE OFFLINE CONTROL ON THE VA CAPABILITY PRECONDITION.
 *
 * Two decisions, both pure, both asserted on BOTH arms: does this run flip the agent model
 * slot, and what verdict does a capability that came back off deserve.
 *
 * The live drivers cannot be imported — they acquire their environment, their secret and
 * their Playwright pinning at module scope, on purpose — which is exactly why the decision
 * was extracted to `lib/agent-capability-precondition.mjs` instead of being left inline in
 * the six drivers that each hold a copy of it.
 *
 * WHAT THIS FILE CANNOT PROVE: that the live driver reaches these functions with the right
 * arguments, and that `--flip-model` actually makes the staging capability come back enabled.
 * Both are live questions, owed to the run.
 * ═══════════════════════════════════════════════════════════════════════════════ */

import {
  resolveFlipModel, judgeAgentCapability, FLIP_MODEL_DEFAULT_ENVS,
  decideInstanceFlip, FLIPPABLE_REASON, applyVerdict, VERDICT_REPORTERS,
} from "../lib/agent-capability-precondition.mjs";

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) { pass++; console.log(`  ok   ${what}`); } else { fail++; console.log(`  FAIL ${what}`); } };

console.log("\n1 · resolveFlipModel — THE DEFAULT IS THE DOCUMENTED COMMAND");
{
  const bare = resolveFlipModel({ envName: "staging", argv: ["--env=staging"] });
  ok(bare.flipModel === true,
    "the BARE documented command on staging flips the model — the run that used to exit 1 in five seconds now proceeds (F-767)");
  ok(/ON BY DEFAULT on staging/.test(bare.reason) && /--no-flip-model/.test(bare.reason),
    "…and the printed reason says both why it is on and how to turn it off, so a default nobody asked for is never silent");

  ok(resolveFlipModel({ envName: "staging", argv: ["--flip-model"] }).flipModel === true,
    "the explicit --flip-model still means what it always meant — every command line already in a runbook keeps working");
  ok(resolveFlipModel({ envName: "dev", argv: [] }).flipModel === false,
    "…and it stays OFF everywhere else: the default is scoped to the tenant whose capability gate needs it, not applied globally");
  ok(/--flip-model/.test(resolveFlipModel({ envName: "dev", argv: [] }).reason),
    "…with the flag named there too, because 'off by default' is only useful next to how to turn it on");
}

console.log("\n2 · resolveFlipModel — THE OPT-OUT, AND THE CONTRADICTION");
{
  const off = resolveFlipModel({ envName: "staging", argv: ["--no-flip-model"] });
  ok(off.flipModel === false,
    "--no-flip-model beats the staging default — a default that cannot be turned off is not a default");
  const both = resolveFlipModel({ envName: "staging", argv: ["--flip-model", "--no-flip-model"] });
  ok(both.flipModel === false && /mutates less/.test(both.reason),
    "…and it beats an explicit --flip-model too: the safe reading of a contradictory command line is the one that mutates less, and it SAYS so rather than silently picking");
  ok(resolveFlipModel({ envName: "dev", argv: ["--no-flip-model"] }).flipModel === false,
    "the opt-out is not staging-only either — it means the same thing on every tenant");
}

console.log("\n3 · resolveFlipModel — THE ARGV IS MATCHED WHOLE");
{
  ok(resolveFlipModel({ envName: "dev", argv: ["--flip-model=false"] }).flipModel === false,
    "`--flip-model=false` is NOT `--flip-model`: a value-shaped argument does not switch a boolean flag on, which is how a 'disable' turns into an 'enable'");
  ok(resolveFlipModel({ envName: "dev", argv: ["--no-flip-modelling"] }).flipModel === false
      && resolveFlipModel({ envName: "staging", argv: ["--no-flip-modelling"] }).flipModel === true,
    "…and a flag that merely STARTS with the opt-out's name is not the opt-out — the staging default survives it");
  ok(FLIP_MODEL_DEFAULT_ENVS.includes("staging") && FLIP_MODEL_DEFAULT_ENVS.length === 1,
    "the environment list is one exported frozen home, so 'which tenants default on' is answerable without reading six drivers");
}

console.log("\n4 · judgeAgentCapability — A PRECONDITION IS NEVER THE DEFECT IT BLOCKS");
{
  const good = judgeAgentCapability({ cap: { enabled: true, edition: "coder", provider: "atlassian", agentModel: "claude-sonnet-5" }, flipModel: true, envName: "staging", frontier: "claude-sonnet-5" });
  ok(good.proceed === true && good.verdict === "PASS",
    "an enabled capability is a PASS and the run proceeds — the arm that must not have changed");
  ok(/claude-sonnet-5/.test(good.what) && /atlassian/.test(good.what),
    "…and it records the model and provider it proceeded ON, so a later surprise is attributable");

  const noFlip = judgeAgentCapability({ cap: { enabled: false, reason: "needs-frontier-model" }, flipModel: false, envName: "staging", frontier: "claude-sonnet-5" });
  ok(noFlip.verdict === "N/V" && noFlip.proceed === false,
    "a capability that is off WITHOUT the flip is NOT VERIFIED, not FAILED — nothing below the gate ran, which is the definition of unproven (F-767)");
  ok(/REMEDY/.test(noFlip.what) && /--flip-model/.test(noFlip.what),
    "…and the sentence names --flip-model in full, so the next reader does not spend the hour this finding cost");
  ok(/needs-frontier-model/.test(noFlip.what),
    "…carrying the instance's OWN reason, so the remedy can be checked against the cause instead of assumed");

  const flipped = judgeAgentCapability({ cap: { enabled: false, reason: "needs-frontier-model" }, flipModel: true, envName: "staging", frontier: "claude-sonnet-5" });
  ok(flipped.verdict === "N/V" && flipped.proceed === false,
    "a capability STILL off after the flip is also N/V — the door under test was never reached, so it cannot be the thing that failed");
  ok(/va-capability-gate-live/.test(flipped.what) && /claude-sonnet-5/.test(flipped.what),
    "…but it says so LOUDLY: it names the model that was set and the driver where a disagreeing capability resolver is argued, so the N/V is a lead and not a shrug");
  ok(flipped.what !== noFlip.what,
    "the two off arms do not share a sentence — 'you did not flip' and 'you flipped and it did not help' are different situations with different next steps");
}

console.log("\n5 · judgeAgentCapability — THE MISSING AND MALFORMED ANSWER");
{
  ok(judgeAgentCapability({ cap: null, flipModel: true, envName: "staging" }).verdict === "N/V",
    "no capability answer at all is N/V, not a crash — a resolver that did not answer is unproven, and the driver must still reach its cleanup");
  ok(judgeAgentCapability({}).proceed === false,
    "…and an entirely empty call does not proceed: `enabled === true` is the ONLY thing that opens the gate");
  ok(judgeAgentCapability({ cap: { enabled: "true" }, flipModel: true }).proceed === false,
    "the STRING \"true\" does not open it either — the shape a query string or a hand-written hook answer produces must not be the shape that licenses the run");
  ok(/no reason given/.test(judgeAgentCapability({ cap: { enabled: false }, flipModel: false }).what),
    "…and a refusal with no reason says 'no reason given' rather than 'undefined', because the missing field is itself the thing to chase");
}

console.log("\n6 · decideInstanceFlip (F-782) — THE FLIP DECIDED FROM THE INSTANCE, NOT FROM ARGV");
{
  const need = decideInstanceFlip({ cap: { enabled: false, reason: "needs-frontier-model" }, frontier: "claude-sonnet-5", envName: "staging" });
  ok(need.flip === true && need.blocked === false,
    "the one reason a driver may fix itself DOES flip the slot — this is the shape five flag-less drivers carried inline (F-782)");
  ok(/replays the recorded value/.test(need.reason) && /claude-sonnet-5/.test(need.reason),
    "…and the printed reason promises the restore and names the model, so a mutation nobody passed a flag for is never silent");

  const on = decideInstanceFlip({ cap: { enabled: true, edition: "coder", agentModel: "claude-sonnet-5" }, frontier: "claude-sonnet-5", envName: "staging" });
  ok(on.flip === false && on.blocked === false && /nothing to restore/.test(on.reason),
    "an instance that ALREADY holds the capability is not flipped — the probe and the receipt driver used to point the slot unconditionally and then delete it, which mutates a tenant that needed nothing");

  const other = decideInstanceFlip({ cap: { enabled: false, reason: "needs-coder-edition" }, frontier: "claude-sonnet-5", envName: "dev" });
  ok(other.flip === false && other.blocked === true,
    "a reason a model flip CANNOT fix does not flip anything — `blocked` is the DEV arm, where the script must change nothing");
  ok(/needs-coder-edition/.test(other.reason) && /cannot fix/.test(other.reason),
    "…and it says which reason stopped it, so the operator is not left to guess which of the two arms they are in");

  ok(decideInstanceFlip({ cap: { enabled: "true" } }).flip === false && decideInstanceFlip({}).blocked === true,
    "the STRING \"true\" is not enabled, and an empty call is blocked — the same `enabled === true` gate as the verdict, so the two halves cannot disagree about what 'on' means");
  ok(FLIPPABLE_REASON === "needs-frontier-model",
    "the flippable reason is ONE exported constant: four drivers each spelled this literal in a `!==`, which is how a rename would have silently changed four decisions");
}

console.log("\n7 · judgeAgentCapability — THE FLAG-LESS ARM, BOTH WAYS (F-782)");
{
  const blocked = judgeAgentCapability({ cap: { enabled: false, reason: "needs-coder-edition" }, flipped: false, envName: "dev", frontier: "claude-sonnet-5" });
  ok(blocked.verdict === "N/V" && blocked.proceed === false,
    "a flag-less driver that did NOT flip grades the precondition N/V — va-purge-on-delete and va-settling-carrier used to grade this FAIL and N/V respectively, about the same situation");
  ok(/REMEDY/.test(blocked.what) && /needs-coder-edition/.test(blocked.what),
    "…and the sentence carries the instance's own reason AND a remedy, which is the whole of F-767's claim restated for the flag-less shape");
  ok(!/--flip-model/.test(blocked.what),
    "…but it does NOT name --flip-model: these drivers have no such flag, and a remedy naming an argument the file does not read is worse than none");

  const still = judgeAgentCapability({ cap: { enabled: false, reason: "needs-frontier-model" }, flipped: true, envName: "staging", frontier: "claude-sonnet-5" });
  ok(still.verdict === "N/V" && still.proceed === false,
    "a flag-less driver that DID flip and still got nothing is also N/V, never FAIL — the door under test was never reached, so it cannot be the thing that broke");
  ok(/claude-sonnet-5/.test(still.what) && /va-capability-gate-live/.test(still.what),
    "…naming the model it set and the driver where a disagreeing capability resolver is argued, so the N/V is a lead");
  ok(/~30s/.test(still.what),
    "…and naming the ~30s provider/model cache, which is the most likely reason a freshly-written slot reads back as the old model — the trap this arm exists to explain");
  ok(still.what !== blocked.what,
    "the two flag-less arms do not share a sentence: 'no flip was possible' and 'the flip did not help' have different next steps");

  ok(judgeAgentCapability({ cap: { enabled: true, edition: "coder", provider: "atlassian", agentModel: "m" }, flipped: false }).verdict === "PASS",
    "an enabled capability is a PASS on the flag-less arm too — `enabled === true` is judged before either arm, so there is ONE gate and not two");

  const flagged = judgeAgentCapability({ cap: { enabled: false, reason: "needs-frontier-model" }, flipModel: false, flipped: true, envName: "staging", frontier: "m" });
  ok(/--flip-model/.test(flagged.what),
    "a caller that passes flipModel gets the FLAGGED sentence even with `flipped` set — the operator-flag drivers are unchanged by F-782, which is the arm that must not have moved");
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * 8 · applyVerdict — THE DISPATCH IS EXECUTED, NOT READ (F-784)
 *
 * Everything above this line asserted STRINGS: that the lib says "N/V", that a driver's call
 * line contains the right words. Both were true the whole time F-784 was live, because the
 * defect was not in either string — it was in the TRANSLATION between them. The lib returned
 * `"N/V"`, every driver looked it up in a map whose third key was `NV`, and `undefined(...)`
 * threw on every incapable instance.
 *
 * So this section RUNS the dispatch, for every verdict the lib can produce, with reporters
 * that count. Nothing here reads a source file.
 * ═══════════════════════════════════════════════════════════════════════════════ */
console.log("\n8 · applyVerdict — EVERY VERDICT DISPATCHES TO EXACTLY ONE REPORTER (F-784)");
{
  const spy = () => {
    const n = { PASS: 0, FAIL: 0, NV: 0 };
    const seen = { PASS: [], FAIL: [], NV: [] };
    const mk = (k) => (s, d) => { n[k] += 1; seen[k].push([s, d]); };
    return { n, seen, reporters: { PASS: mk("PASS"), FAIL: mk("FAIL"), NV: mk("NV") } };
  };
  const total = (n) => n.PASS + n.FAIL + n.NV;

  /* THE VERDICTS THE LIB REALLY RETURNS, harvested from judgeAgentCapability itself rather
     than typed out here: a verdict this test does not know about is exactly the verdict that
     would crash a driver, so the list must come from the code under test. */
  const produced = new Set([
    judgeAgentCapability({ cap: { enabled: true, edition: "coder", provider: "atlassian", agentModel: "m" }, flipModel: true }).verdict,
    judgeAgentCapability({ cap: { enabled: false, reason: "needs-frontier-model" }, flipModel: false, envName: "dev", frontier: "m" }).verdict,
    judgeAgentCapability({ cap: { enabled: false, reason: "needs-frontier-model" }, flipModel: true, envName: "staging", frontier: "m" }).verdict,
    judgeAgentCapability({ cap: { enabled: false, reason: "needs-coder-edition" }, flipped: false, envName: "dev", frontier: "m" }).verdict,
    judgeAgentCapability({ cap: { enabled: false, reason: "needs-frontier-model" }, flipped: true, envName: "staging", frontier: "m" }).verdict,
  ]);
  for (const v of produced) {
    ok(Object.prototype.hasOwnProperty.call(VERDICT_REPORTERS, v),
      `the verdict ${JSON.stringify(v)} that judgeAgentCapability really returns has a reporter in VERDICT_REPORTERS — this is the F-784 assertion: the lib produced "N/V" and nothing in the codebase mapped it`);
  }
  ok(produced.has("N/V") && produced.has("PASS"),
    "…and the harvest really did reach both the PASS arm and the N/V arm, so the loop above is not vacuously green over a one-element set");

  /* Every verdict in the vocabulary, dispatched. */
  for (const verdict of Object.keys(VERDICT_REPORTERS)) {
    const expected = VERDICT_REPORTERS[verdict];
    const s = spy();
    const fired = applyVerdict({ verdict, what: `the ${verdict} sentence` }, s.reporters);
    ok(fired === expected && s.n[expected] === 1,
      `applyVerdict(${JSON.stringify(verdict)}) fires ${expected}() — the lookup is EXECUTED here, which is the one thing the old string assertions could not do`);
    ok(total(s.n) === 1,
      `…and fires it EXACTLY ONCE, nothing else: ${JSON.stringify(s.n)}`);
    ok(s.seen[expected][0][0] === `the ${verdict} sentence`,
      "…and hands the reporter the row's `what`, so the remedy sentence survives the dispatch");
    ok(s.seen[expected][0][1] === undefined,
      "…with NO second argument when no detail was passed, because three drivers push a truthy second argument straight into evidence.json");
  }

  /* The N/V row specifically, end to end from judge to reporter — the exact run F-784 killed. */
  {
    const s = spy();
    const row = judgeAgentCapability({ cap: { enabled: false, reason: "needs-frontier-model" }, flipModel: false, envName: "staging", frontier: "m" });
    applyVerdict(row, s.reporters);
    ok(s.n.NV === 1 && s.n.FAIL === 0 && s.n.PASS === 0,
      "the WHOLE F-784 path: an incapable instance goes judgeAgentCapability -> applyVerdict -> NV() without throwing, and is not counted as a failure");
  }

  /* The detail arm the three evidence-writing drivers use. */
  {
    const s = spy();
    applyVerdict({ verdict: "N/V", what: "w" }, s.reporters, { cap: { enabled: false } });
    ok(s.seen.NV[0][1] && s.seen.NV[0][1].cap.enabled === false,
      "a detail argument reaches the reporter unchanged — va-receipt-copy and va-settling-carrier put it in evidence.json");
  }

  /* The two refusals. Both must NAME the problem: a dispatch that silently does nothing is
     how a verdict goes unreported, and an unreported verdict still leaves a 0-fail line. */
  {
    let threw = null;
    try { applyVerdict({ verdict: "NV", what: "w" }, spy().reporters); } catch (e) { threw = e; }
    ok(threw && /unknown verdict/.test(threw.message) && /"N\/V"/.test(threw.message),
      'an UNKNOWN verdict throws by name and lists the real vocabulary — "NV" is the spelling the eight driver maps used, so the nearest miss is the one asserted');
    let threw2 = null;
    try { applyVerdict({ verdict: "N/V", what: "w" }, { PASS: () => {}, FAIL: () => {} }); } catch (e) { threw2 = e; }
    ok(threw2 && /needs a NV\(\) reporter/.test(threw2.message),
      "a MISSING reporter throws naming the one it wanted, instead of the bare TypeError that made F-784 read as a product crash");
  }
}

console.log(`\nagent-capability-precondition: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
