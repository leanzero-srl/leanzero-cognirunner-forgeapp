/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * F-991 — WHICH MODEL SLOT EACH SURFACE RUNS ON, AND THE MECHANISM THAT KEEPS IT TRUE.
 *
 * THE DEFECT THIS GUARDS. The choice of model slot was being made at seven scattered call
 * sites, and four of them made it wrongly: the Coder turn (src/coder-engine.js), the
 * pull-request review (src/async-handler.js) and the listener/scheduled-job agent run
 * (src/agent-runner.js) each dispatched `getOpenAIModel()` — the ORDINARY rules model —
 * while the capability gate standing in front of them judged the AGENT model. Only the
 * Virtual Administrator was right. So an instance could be refused `needs-frontier-model`
 * for an agent model it had set correctly, or pass the gate and then be handed the cheap
 * rules model to do the work the gate had just approved.
 *
 * Fixing the four sites does not stop a fifth being written. What stops it is that the
 * slot chain now comes from ONE frozen table (MODEL_SLOT_FOR_SURFACE, in
 * src/shared/agent-actions.js) and that this file FAILS THE BUILD when an agent-bearing
 * dispatch site reaches for the rules model again. The scan is the durable half; the
 * behavioural checks below it prove the table and the chain actually mean what they say.
 *
 * Four properties:
 *   (a) SOURCE SCAN — no agent-bearing dispatch site calls bare `getOpenAIModel(`.
 *   (b) BEHAVIOURAL — coder → agent → ordinary fallthrough against a fake slot reader.
 *   (c) THE GATE — a Coder gate on Forge LLM judges the CODER model, not the agent model:
 *       coderModel=haiku + agentModel=opus REFUSES; the reverse ALLOWS.
 *   (d) THE REVIEW — a coder-slot model the vendor 404s ends the review as FAILED, never
 *       as a clean zero-finding approval (git-review rule 7 / F-284).
 *
 * Run: node scripts/model-slots.test.mjs   (auto-discovered by run-offline.mjs)
 */

import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const rawSrc = (f) => readFileSync(path.join(here, "../../src", f), "utf8");

/**
 * COMMENTS ARE STRIPPED BEFORE ANY SCAN, and that is not a detail: every one of these
 * dispatch sites now carries a comment explaining that it used to call `getOpenAIModel()`
 * and why it must not. A scan over raw text matches those explanations and fails on the
 * very files it is meant to certify — which teaches the next person to delete the
 * explanation rather than keep the code right. Blank the comments, keep the offsets.
 */
const stripComments = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
  .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, p) => p + " ".repeat(m.length - p.length));
const src = (f) => stripComments(rawSrc(f));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)}, expected ${JSON.stringify(b)})`);

const {
  MODEL_SLOT_FOR_SURFACE, modelSlotChainForSurface, AGENT_SURFACES, buildAgentGateContext,
} = await import("../../src/shared/agent-actions.js");
const { resolveModelForProvider } = await import("../../src/shared/model-resolution.js");
const { providerAgentModelSlot, providerCoderModelSlot, providerModelSlot } = await import("../../src/shared/provider-slots.js");
const { FORGE_LLM_DEFAULT, EDITION_IDS } = await import("../../src/shared/edition.js");

/* ═════════════════════════════════════════════════════════════════════════════
 * (0) THE TABLE ITSELF — one home, frozen, and it covers every surface there is.
 * ═══════════════════════════════════════════════════════════════════════════ */
{
  const ids = Object.values(AGENT_SURFACES);
  for (const s of ids) {
    ok(Array.isArray(MODEL_SLOT_FOR_SURFACE[s]) && MODEL_SLOT_FOR_SURFACE[s].length > 0,
      `every surface has a slot chain: ${s}`);
  }
  // FROZEN PER ROW. A consumer that could push onto a shared row would change what
  // ANOTHER surface resolves — the chains are handed out by reference.
  ok(Object.isFrozen(MODEL_SLOT_FOR_SURFACE), "the surface table is frozen");
  for (const s of ids) ok(Object.isFrozen(MODEL_SLOT_FOR_SURFACE[s]), `…and so is the ${s} row`);

  // THE COMPATIBILITY RULE, stated as a test: the Coder falls back to the AGENT slot, so
  // an instance that never sets a coder model keeps exactly the behaviour it had.
  eq(MODEL_SLOT_FOR_SURFACE[AGENT_SURFACES.CODER].join(","), "coder,agent",
    "the CODER reads the coder slot, then falls back to the agent slot");
  for (const s of [AGENT_SURFACES.VA, AGENT_SURFACES.LISTENER, AGENT_SURFACES.JOB]) {
    eq(MODEL_SLOT_FOR_SURFACE[s].join(","), "agent", `the ${s} surface reads the agent slot`);
  }
  // An UNKNOWN surface answers the AGENT chain, never an empty one: every caller is an
  // agent-bearing dispatch site, so "I do not know this surface" must not silently demote
  // a frontier turn to the rules model.
  eq(modelSlotChainForSurface("no-such-surface").join(","), "agent",
    "an unknown surface falls back to the AGENT chain, not to the rules model");
  eq(modelSlotChainForSurface(null).join(","), "agent", "…and so does a null surface");
}

/* ═════════════════════════════════════════════════════════════════════════════
 * (a) THE SOURCE SCAN — the durable half.
 *
 * An AGENT-BEARING DISPATCH SITE is a place that resolves a model for a surface that runs
 * behind the capability gate. None of them may call bare `getOpenAIModel(`. The scan is
 * per-FUNCTION-BODY rather than per-file, because these files legitimately contain other
 * readers: src/async-handler.js resolves the rules model for codegen/fix/distill, and
 * src/virtual-admin.js does so for the F-494 memory summariser. Both are named below with
 * the reason they are exempt, so an exemption cannot be added silently.
 * ═══════════════════════════════════════════════════════════════════════════ */
{
  /** The body of a function/handler, from a unique opening anchor to a closing line. */
  const bodyFrom = (text, anchor, endRe) => {
    const i = text.indexOf(anchor);
    if (i < 0) return null;
    const rest = text.slice(i);
    const m = rest.match(endRe);
    return m ? rest.slice(0, m.index + m[0].length) : rest;
  };

  const sites = [
    {
      label: "the Coder turn (src/coder-engine.js runCoderTurn)",
      body: bodyFrom(src("coder-engine.js"), "const apiKey = await m.getOpenAIKey();", /\n  const dispatch = /),
      expect: "m.getCoderModel(",
    },
    {
      // ANCHORED PAST `evaluateAiCondition`, which is the FIRST getOpenAIKey in this file
      // and legitimately stays on the rules model (a per-event yes/no over a field is not
      // an agent turn). Anchoring on the first match would scan that function instead and
      // certify the wrong one.
      label: "the listener/job agent run (src/agent-runner.js runAgentTask)",
      body: bodyFrom(src("agent-runner.js").slice(src("agent-runner.js").indexOf("webRunBudget = null,")),
        "const apiKey = await m.getOpenAIKey();", /\n  const rounds = /),
      expect: "m.getAgentModel(",
    },
    {
      label: "the PR review (src/async-handler.js)",
      body: bodyFrom(src("async-handler.js"), "const { provider: aiProvider, baseUrl } = await getProviderConfig();", /\n  let connection = null;/),
      expect: "getCoderModel(aiProvider)",
    },
    {
      // The VA's `runLoop` dep ONLY — deliberately NOT the whole deps object, because the
      // F-494 memory summariser sits a few lines below it and calls the rules model on
      // purpose (mechanical compaction of the agent's own notes, no tools, cheapest tier).
      // The VA was the ONE site that was already right; it is scanned because it is the
      // reference behaviour and a regression here would be the least visible of all.
      label: "the Virtual Administrator loop (src/virtual-admin.js runLoop)",
      body: bodyFrom(src("virtual-admin.js"), "runLoop: async (args) => {", /\n  \},\n/),
      expect: "m.getAgentModel(",
    },
  ];

  for (const s of sites) {
    ok(!!s.body, `found ${s.label}`);
    if (!s.body) continue;
    // `getOpenAIModel(` BARE — the rules model. `m.getOpenAIModel(` counts too: the
    // namespace prefix does not make it a different function.
    const bare = [...s.body.matchAll(/(?:\bm\.)?getOpenAIModel\(/g)];
    // The VA's memory summariser (F-494) is the ONE deliberate rules-model call in these
    // bodies, and it is OUTSIDE the loop body scanned here. If this ever trips, read the
    // comment above the call before touching the scan.
    eq(bare.length, 0, `${s.label} does NOT dispatch the ordinary rules model`);
    if (s.expect) ok(s.body.includes(s.expect), `${s.label} dispatches ${s.expect}`);
  }

  // …and the readers it must call exist, with the chain taken FROM THE TABLE. A site
  // calling a correctly-named function that itself types a literal chain would pass the
  // scan above and still be the bug.
  const idx = src("index.js");
  ok(/export const getCoderModelFor = async \(provider\) => resolveModelForProvider\(provider, \{\s*\n\s*slotChain: MODEL_SLOT_FOR_SURFACE\[AGENT_SURFACES\.CODER\]/.test(idx),
    "getCoderModelFor takes its chain from the surface table");
  ok(/slotChain: MODEL_SLOT_FOR_SURFACE\[AGENT_SURFACES\.VA\]/.test(idx),
    "getAgentModelFor takes its chain from the surface table");
  ok(!/slotChain: \[\s*"/.test(idx) && !/slotChain: \['/.test(idx),
    "no LITERAL slot chain is typed anywhere in src/index.js");
  ok(!/slotChain: \[\s*"/.test(src("async-handler.js")),
    "…nor in the consumer");

  /* ═══ F-993 — NO GATE IN src/ ASKS THE PREDICATE WITHOUT NAMING ITS SURFACE ═══
   *
   * The scan above stops a DISPATCH site reaching for the wrong model. This one stops a
   * GATE judging the wrong model, which is the same defect one layer up and it shipped:
   * the Coder's ENTRY gate (`coderGate`) called `agentCapability(facts)` directly and so
   * judged `facts.agentModel`, while every ACTION gate on that same surface rode
   * `buildAgentGateContext({surface:"coder"})` and judged the CODER model. Forge LLM +
   * frontier agent slot + Haiku coder slot = the turn STARTS, every git action inside it
   * is refused, and the dispatch runs Haiku.
   *
   * `agentCapability` stays the ONE predicate; what must be single-homed is the hop that
   * decides WHICH MODEL it is handed, and that home is `capabilityForSurface`
   * (src/shared/agent-actions.js). So: no file under src/ may call the bare predicate
   * except the two that legitimately own it — `edition.js`, where it is defined, and
   * `agent-actions.js`, which is the one home of the hop. Comments are stripped first
   * (see stripComments), so the explanations at the two former call sites do not trip it.
   */
  {
    const gateFiles = ["index.js", "virtual-admin.js", "coder-engine.js", "async-handler.js", "agent-runner.js", "rules-api.js", "listeners.js", "va-admin.js", "jobs.js"];
    for (const f of gateFiles) {
      let body;
      try { body = src(f); } catch (e) { continue; }
      const bare = [...body.matchAll(/(?<![A-Za-z0-9_.])agentCapability\s*\(/g)];
      eq(bare.length, 0, `F-993: src/${f} never calls the bare predicate — it rides capabilityForSurface or buildAgentGateContext`);
    }
    // …and the one home really is one: the hop that chooses the model lives in exactly one
    // function, and the gate-context builder calls IT rather than carrying a second copy.
    const aa = src("shared/agent-actions.js");
    eq([...aa.matchAll(/const modelForSurface = /g)].length, 1,
      "F-993: the surface→model hop is declared exactly once");
    ok(/export const capabilityForSurface = /.test(aa),
      "F-993: …and is exported to every gate as capabilityForSurface");
    ok(/capability: \{ git: provider \? capabilityForSurface\(/.test(aa),
      "F-993: buildAgentGateContext rides that same function — one implementation, not two");
    eq([...aa.matchAll(/(?<![A-Za-z0-9_.])agentCapability\s*\(/g)].length, 1,
      "F-993: …so the predicate itself is called from exactly ONE place in the shared module");
  }
  // THE BINDER MUST FORWARD IT. Measured while cutting F-991: index.js's binder drops any
  // option it does not name, and a dropped slot chain does not fail loudly — it falls
  // through to the ORDINARY model slot, which is the very defect being fixed.
  const binder = idx.match(/const resolveModelForProvider = async \(provider, \{[\s\S]*?\n\}\);/);
  ok(!!binder && /^\s*slotChain,$/m.test(binder[0]),
    "the sync binder FORWARDS slotChain (an unforwarded chain silently resolves the rules model)");
}

/* ═════════════════════════════════════════════════════════════════════════════
 * (b) BEHAVIOURAL — the chain itself, against a fake slot reader.
 * ═══════════════════════════════════════════════════════════════════════════ */
{
  const P = "openai";
  const run = async (slots, surface) => {
    const reads = [];
    const readSlot = async (k) => { reads.push(k); return slots[k] ?? null; };
    const model = await resolveModelForProvider({
      provider: P, readSlot, slotChain: modelSlotChainForSurface(surface), migrate: false,
      log: { error() {}, log() {} },
    });
    return { model, reads };
  };

  const CODER = providerCoderModelSlot(P), AGENT = providerAgentModelSlot(P), ORD = providerModelSlot(P);

  // The whole ladder, one rung at a time.
  eq((await run({ [CODER]: "opus", [AGENT]: "sonnet", [ORD]: "haiku" }, AGENT_SURFACES.CODER)).model, "opus",
    "CODER: the coder slot wins when it is set");
  eq((await run({ [AGENT]: "sonnet", [ORD]: "haiku" }, AGENT_SURFACES.CODER)).model, "sonnet",
    "CODER: an UNSET coder slot falls through to the agent slot — the compatibility rule");
  eq((await run({ [ORD]: "haiku" }, AGENT_SURFACES.CODER)).model, "haiku",
    "CODER: with neither set it falls through to the ordinary model slot");
  eq((await run({ [CODER]: "opus", [AGENT]: "sonnet", [ORD]: "haiku" }, AGENT_SURFACES.LISTENER)).model, "sonnet",
    "LISTENER: reads the AGENT slot and NEVER the coder slot — setting a coder model must not raise a listener's bill");
  eq((await run({ [CODER]: "opus", [ORD]: "haiku" }, AGENT_SURFACES.JOB)).model, "haiku",
    "JOB: a coder model is invisible to it; it falls through to the ordinary slot");

  // …and the listener really does not even LOOK at the coder slot. Reading a slot it must
  // not honour would be harmless today and the seed of the next "N copies" defect.
  const listenerReads = (await run({ [CODER]: "opus", [AGENT]: "sonnet" }, AGENT_SURFACES.LISTENER)).reads;
  ok(!listenerReads.includes(CODER), "LISTENER: the coder slot is never even read");

  // THE ORDINARY PATH IS UNTOUCHED: no chain at all means the rules model, whatever the
  // surface slots hold. A validator must never be served an agent's or a coder's pick.
  const plain = await resolveModelForProvider({
    provider: P, readSlot: async (k) => ({ [CODER]: "opus", [AGENT]: "sonnet", [ORD]: "haiku" })[k] ?? null,
    migrate: false, log: { error() {}, log() {} },
  });
  eq(plain, "haiku", "the ORDINARY path still resolves the rules model with both surface slots set");

  // The DEPRECATED boolean resolves exactly what it always did.
  const legacy = await resolveModelForProvider({
    provider: P, readSlot: async (k) => ({ [CODER]: "opus", [AGENT]: "sonnet" })[k] ?? null,
    agentSlot: true, migrate: false, log: { error() {}, log() {} },
  });
  eq(legacy, "sonnet", "agentSlot:true is still exactly slotChain:['agent']");

  // An unknown slot NAME is skipped, not thrown on — a vocabulary typo must not take an
  // instance offline, and the tail still answers.
  const typo = await resolveModelForProvider({
    provider: P, readSlot: async (k) => ({ [ORD]: "haiku" })[k] ?? null,
    slotChain: ["codr", "agent"], migrate: false, log: { error() {}, log() {} },
  });
  eq(typo, "haiku", "an unknown slot name is skipped and the tail still answers");
}

/* ═════════════════════════════════════════════════════════════════════════════
 * (c) THE GATE JUDGES THE MODEL THE SURFACE WILL RUN.
 *
 * On Forge LLM, `agentCapability` refuses anything off the frontier list. Before F-991
 * the Coder's gate read the AGENT model, so an admin could put Haiku in the coder slot,
 * leave Opus in the agent slot, be ALLOWED — and then dispatch a model that cannot drive
 * an agent at all. The gate must follow the dispatch.
 * ═══════════════════════════════════════════════════════════════════════════ */
{
  const gateFor = (surface, { agentModel, coderModel }) => buildAgentGateContext({
    provider: "atlassian", edition: EDITION_IDS.ADVANCED, agentModel, coderModel, allowanceLevel: null, surface,
  }).capability.git;

  const HAIKU = FORGE_LLM_DEFAULT, OPUS = "claude-opus-5";

  const refused = gateFor(AGENT_SURFACES.CODER, { agentModel: OPUS, coderModel: HAIKU });
  eq(refused.enabled, false, "CODER gate: coderModel=haiku REFUSES even though the agent model is opus");
  eq(refused.reason, "needs-frontier-model", "…and names the real cause");

  const allowed = gateFor(AGENT_SURFACES.CODER, { agentModel: HAIKU, coderModel: OPUS });
  eq(allowed.enabled, true, "CODER gate: the reverse ALLOWS — the coder model is the one that will run");

  // The other surfaces are unmoved by a coder model: they do not run it.
  eq(gateFor(AGENT_SURFACES.LISTENER, { agentModel: HAIKU, coderModel: OPUS }).enabled, false,
    "LISTENER gate: a frontier CODER model does not unlock a listener running haiku");
  eq(gateFor(AGENT_SURFACES.VA, { agentModel: OPUS, coderModel: HAIKU }).enabled, true,
    "VA gate: a haiku coder slot does not lock out a VA running opus");

  // NOT ASKED means NOT CHANGED: every caller that has not been taught about the coder
  // slot keeps its old verdict, because `coderModel` undefined falls back to agentModel —
  // which is what an instance with no coder slot resolves anyway.
  eq(gateFor(AGENT_SURFACES.CODER, { agentModel: OPUS, coderModel: undefined }).enabled, true,
    "CODER gate: an unsupplied coderModel falls back to the agent model (no existing verdict moves)");
  eq(gateFor(AGENT_SURFACES.CODER, { agentModel: HAIKU, coderModel: undefined }).enabled, false,
    "…in both directions");

  // THE FAIL-CLOSED DIRECTION, stated. agentGateFacts resolves coderModel inside a
  // try/catch that leaves it NULL on a read fault, and null is not on the frontier list,
  // so a fault REFUSES. A capability gate is the one place in this app that does not fail
  // open, and this is the check that says so.
  eq(gateFor(AGENT_SURFACES.CODER, { agentModel: OPUS, coderModel: null }).enabled, false,
    "CODER gate FAILS CLOSED: a coderModel that could not be read refuses, it does not inherit the agent's");
}

/* ═════════════════════════════════════════════════════════════════════════════
 * (d) A CODER-SLOT MODEL THE VENDOR 404s ENDS THE REVIEW AS FAILED.
 *
 * The coder slot is the one an admin is most likely to fill with an id their provider
 * does not actually serve (it is the "put the big model here" box). The review must then
 * FAIL — `model_failed`, F-284 — and must never come back as a clean approval with zero
 * findings, which is the outcome that would silently rubber-stamp pull requests.
 * ═══════════════════════════════════════════════════════════════════════════ */
{
  const gr = src("git-review.js");
  const i = gr.indexOf("answer = await callModel(prompt);");
  ok(i > 0, "found the review's model call");
  const after = gr.slice(i, i + 600);
  ok(/return fail\("model_failed"/.test(after),
    "a throwing model call ends the review as model_failed, never as zero findings (F-284)");
  // …and the JSON gate right behind it, for a 404 body that arrives as text rather than
  // as a throw. Both roads out of a bad model end in `fail`, not in an empty review.
  ok(/if \(!parsed\) return fail\("bad_model_output"/.test(after),
    "…and unparseable output likewise fails rather than approving with no findings");
  // The failure must precede the clamp/post section: a review that reached the write
  // stage with an empty finding list is exactly the silent approval this guards.
  ok(gr.indexOf('return fail("bad_model_output"') < gr.indexOf("const review = clampReview(parsed);"),
    "…and both refusals precede any side effect");
}

/* ═════════════════════════════════════════════════════════════════════════════
 * (e) THE FORGE LLM BILLING CLAMP IS ON THE CODER DISPATCH PATH.
 *
 * The coder slot is the "put the big model here" box, so it is the most likely place for
 * an id the tenant's EDITION does not entitle. Resolution deliberately does not judge
 * that — the Atlassian belt in the chain only keeps the id inside Forge LLM's vocabulary,
 * and `clampForgeLlmModel` runs at DISPATCH, where Standard vs Coder is known. This asserts
 * the coder id really does reach that clamp: a Standard tenant with `claude-opus-5` in the
 * coder slot resolves opus and is DISPATCHED Haiku. If this ever fails, the clamp has been
 * bypassed by the coder path and a Standard tenant is buying frontier tokens.
 *
 * Imported last, and in a child process: pulling src/index.js in requires the Forge mocks
 * and stamps a 30 s provider memo that the pure checks above must not run inside.
 * ═══════════════════════════════════════════════════════════════════════════ */
{
  const { spawnSync } = await import("node:child_process");
  if (process.env.CR_F991_CLAMP === "1") {
    await import("../lib/register-mocks-index.mjs");
    const storage = (await import("../lib/mock-kvs.mjs")).default;
    await storage.set("COGNIRUNNER_AI_PROVIDER", "atlassian");
    await storage.set("COGNIRUNNER_EDITION_SNAPSHOT", { active: true, edition: EDITION_IDS.STANDARD, at: new Date().toISOString() });
    await storage.set("COGNIRUNNER_SEAT_SNAPSHOT", { seats: 5, at: new Date().toISOString() });
    await storage.set(providerCoderModelSlot("atlassian"), "claude-opus-5");
    const idx = await import("../../src/index.js");

    eq(await idx.getCoderModel(), "claude-opus-5",
      "CLAMP: the coder slot resolves the frontier id — resolution does NOT judge the edition");

    // The clamp announces itself on console.warn from inside callForgeLlmChat. Capturing
    // that is what proves the DISPATCH clamped, rather than the resolver having quietly
    // answered Haiku (which would pass a naive assertion on the outgoing id and hide a
    // resolver that had started making a billing decision it must not make).
    const warnings = [];
    const realWarn = console.warn;
    console.warn = (...a) => { warnings.push(a.join(" ")); };
    try {
      await idx.callAIChat({ apiKey: "atlassian-forge-llm", model: "claude-opus-5", messages: [{ role: "user", content: "hi" }] });
    } catch (e) { /* the mock provider has no backend; the clamp runs before it */ }
    console.warn = realWarn;
    const clamp = warnings.find((w) => /not permitted \(edition\)/.test(w));
    ok(!!clamp, "CLAMP: the Forge LLM adapter clamped the coder-slot model by edition at DISPATCH");
    ok(!!clamp && clamp.includes(FORGE_LLM_DEFAULT),
      `CLAMP: …down to ${FORGE_LLM_DEFAULT} (got: ${clamp || "no clamp"})`);
    console.log(`model-slots clamp arm: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    encoding: "utf8", timeout: 120000, env: { ...process.env, CR_F991_CLAMP: "1" },
  });
  ok(r.status === 0, `the Forge LLM clamp arm passes${r.status === 0 ? "" : `\n${r.stdout}${r.stderr}`}`);
}

console.log(`model-slots (F-991): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
