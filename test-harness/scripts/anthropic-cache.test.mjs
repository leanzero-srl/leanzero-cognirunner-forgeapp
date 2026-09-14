/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * OFFLINE unit test for the Anthropic adapter's prompt caching (F-353).
 *
 * callAnthropicChat is not exported (it is an internal arm of callAIChatRaw), so this
 * extracts it from src/index.js by source text — the same fs+eval technique
 * async-handler-helpers.test.mjs uses for the transient-error classifiers — and drives
 * it with a mocked global fetch. Three claims:
 *   1. WITH the opt-in cachePrefix: cache_control on the system block and on the last
 *      content block of the last stable message, and nowhere else (<= 4 breakpoints).
 *   2. WITHOUT it: the request body carries no cache_control at all and `system` stays
 *      a plain string — validators/codegen must not start paying a cache-write premium.
 *   3. Usage mapping: cache_read_input_tokens and cache_creation_input_tokens both
 *      reach the returned OpenAI-shaped usage, in the one shape the meter, the budget
 *      ledger and agent-runner's cacheReadTokensOf read.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeUsage, emptyState, bumpCounters, summarizeState } from "../../src/shared/usage-meter.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, "../../src/index.js"), "utf8");

let failures = 0;
const ok = (cond, msg) => {
  if (cond) { console.log(`  ok  ${msg}`); return; }
  failures++; console.log(`FAIL  ${msg}`);
};

const extract = (decl) => {
  const start = src.indexOf(decl);
  if (start < 0) throw new Error(`could not find ${decl}`);
  const end = src.indexOf("\n};", start);
  if (end < 0) throw new Error(`could not close ${decl}`);
  return src.slice(start, end + 3);
};

// Expression-bodied arrow: slice to the first statement terminator instead of "\n};".
const extractExpr = (decl) => {
  const start = src.indexOf(decl);
  if (start < 0) throw new Error(`could not find ${decl}`);
  const end = src.indexOf(";\n", start);
  if (end < 0) throw new Error(`could not close ${decl}`);
  return src.slice(start, end + 1);
};

const fnSrc = extract("const convertContentBlock = (block) =>")
  + "\n" + extractExpr("const isHoistedSystemMessage = (msg, srcIndex, prefixCount) =>")
  + "\n" + extract("const systemMessageAsUserBlock = (msg) =>")
  + "\n" + extract("const canCarryCacheBreakpoint = (msg) =>")
  + "\n" + extract("const cacheBreakpointIndices = ({ messages, boundaries")
  + "\n" + extract("const callAnthropicChat = async ({ apiKey, model, messages");

// eslint-disable-next-line no-new-func
const callAnthropicChat = new Function(`${fnSrc}\nreturn callAnthropicChat;`)();

// --- mocked fetch ---------------------------------------------------------------
let lastBody = null;
const install = (usage) => {
  globalThis.fetch = async (_url, init) => {
    lastBody = JSON.parse(init.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: "text", text: "hi" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 100, output_tokens: 20, ...usage },
      }),
    };
  };
};

const countCacheControl = (obj) => {
  let n = 0;
  const walk = (v) => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v && typeof v === "object") {
      for (const [k, val] of Object.entries(v)) { if (k === "cache_control") n++; else walk(val); }
    }
  };
  walk(obj);
  return n;
};

const baseMessages = () => ([
  { role: "system", content: "STABLE SYSTEM PROMPT" },
  { role: "user", content: "stable knowledge block" },
  { role: "user", content: "this turn's volatile question" },
]);

console.log("\n== 1. cachePrefix set: two breakpoints, in the right places ==");
install();
await callAnthropicChat({
  apiKey: "k", model: "m", messages: baseMessages(), baseUrl: "https://x", cachePrefix: 2,
});
ok(Array.isArray(lastBody.system) && lastBody.system[0].cache_control?.type === "ephemeral",
  "system is a block array with an ephemeral cache_control");
ok(countCacheControl(lastBody) === 2, `exactly 2 cache_control breakpoints (<= 4 cap), got ${countCacheControl(lastBody)}`);
{
  const msgs = lastBody.messages;
  const stable = msgs[0];
  const volatile_ = msgs[msgs.length - 1];
  ok(Array.isArray(stable.content) && stable.content[stable.content.length - 1].cache_control?.type === "ephemeral",
    "the last content block of the last STABLE message carries the breakpoint");
  ok(countCacheControl(volatile_) === 0, "the volatile trailing message carries no breakpoint");
}

console.log("\n== 2. no flag: byte-compatible with the pre-F-353 request ==");
install();
await callAnthropicChat({ apiKey: "k", model: "m", messages: baseMessages(), baseUrl: "https://x" });
ok(typeof lastBody.system === "string", "system stays a plain string when caching is off");
ok(countCacheControl(lastBody) === 0, "no cache_control anywhere without the opt-in");

console.log("\n== 3. usage mapping of both cache fields ==");
install({ cache_read_input_tokens: 900, cache_creation_input_tokens: 50 });
{
  const res = await callAnthropicChat({ apiKey: "k", model: "m", messages: baseMessages(), baseUrl: "https://x", cachePrefix: 2 });
  const u = res.data.usage;
  ok(u.cache_read_tokens === 900, "cache_read_input_tokens -> usage.cache_read_tokens");
  ok(u.cache_creation_tokens === 50, "cache_creation_input_tokens -> usage.cache_creation_tokens");
  ok(u.prompt_tokens_details?.cached_tokens === 900, "cache reads also land on prompt_tokens_details.cached_tokens (OpenAI shape)");
  ok(u.prompt_tokens === 150, `cache WRITES are billed input, so they join prompt_tokens (100+50), got ${u.prompt_tokens}`);
  ok(u.total_tokens === 170, `total_tokens = prompt + completion, cache reads excluded, got ${u.total_tokens}`);
  // The shape agent-runner reads, verbatim.
  const cacheReadTokensOf = (usage) => Number((usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens) || usage.cache_read_input_tokens || 0) || 0;
  ok(cacheReadTokensOf(u) === 900, "agent-runner's cacheReadTokensOf now sees a non-zero cache read");
}

console.log("\n== 3b. F-366: the usage METER counts cache reads in their own counter ==");
install({ cache_read_input_tokens: 900, cache_creation_input_tokens: 50 });
{
  const res = await callAnthropicChat({ apiKey: "k", model: "m", messages: baseMessages(), baseUrl: "https://x", cachePrefix: 2 });
  const u = normalizeUsage(res.data.usage);
  ok(u.cacheRead === 900 && u.cacheCreation === 50, "normalizeUsage lifts both cache figures off the mapped usage");
  ok(u.prompt === 150 && u.total === 170, "the TPM-paced figures stay cache-read free");
  const m = summarizeState(bumpCounters(emptyState(), { provider: "anthropic", usage: u, nowMs: Date.UTC(2026, 8, 13) }), Date.UTC(2026, 8, 13)).month;
  ok(m.cacheReadTokens === 900 && m.cacheCreationTokens === 50, "the month meter records them separately, so a cost view can price them at ~0.1x");
  ok(m.prompt === 150, "…and caching does NOT read as a drop in the meter's prompt line");
}

console.log("\n== 4. zero-cache response keeps the fields at 0, never undefined ==");
install();
{
  const res = await callAnthropicChat({ apiKey: "k", model: "m", messages: baseMessages(), baseUrl: "https://x" });
  const u = res.data.usage;
  ok(u.cache_read_tokens === 0 && u.cache_creation_tokens === 0, "both cache counters are 0");
  ok(u.prompt_tokens === 100 && u.total_tokens === 120, "uncached totals unchanged from before F-353");
}

/* ===================================================================================
 * F-641 - TWO BOUNDARIES, TWO MARKS. F-636 narrowed the declared prefix to the
 * CROSS-TURN boundary (the end of the stored history) and the adapter then emitted one
 * message mark instead of two. On a thread's FIRST turn it emitted NONE inside the
 * messages at all: with no history the cross-turn prefix is system messages only, every
 * one of them is hoisted into `system`, and the single markable message - the user turn
 * carrying the fenced issue context - sat outside the boundary, so rounds 2..8 re-billed
 * it at full input price. The loop now declares BOTH boundaries and each one gets a mark.
 *
 * `marked(body)` reports WHERE the marks are, because "how many" was exactly the
 * question that could not tell these cases apart.
 * =================================================================================== */
const marked = (body) => (body.messages || []).map((m, i) => (
  Array.isArray(m.content) && m.content.some((p) => p && p.cache_control) ? i : -1
)).filter((i) => i >= 0);

console.log("\n== 5. F-641 turn 1 (system + knowledge + user): the user turn keeps a mark ==");
install();
{
  const turn1 = [
    { role: "system", content: "STABLE SYSTEM PROMPT" },
    { role: "system", content: "<<<SKILLS>>> knowledge <<<SKILLS>>>" },
    { role: "user", content: "## ISSUE CONTEXT ... plus the user's words" },
  ];
  // cachePrefix = system + knowledge (history is empty); turnPrefix = the whole seed.
  await callAnthropicChat({ apiKey: "k", model: "m", messages: turn1, baseUrl: "https://x", cachePrefix: 2, turnPrefix: 3 });
  ok(Array.isArray(lastBody.system) && lastBody.system[0].cache_control?.type === "ephemeral",
    "the hoisted system block still carries its breakpoint");
  ok(JSON.stringify(marked(lastBody)) === "[0]",
    `THE FINDING: the user turn (the only markable message) carries the within-turn mark, got ${JSON.stringify(marked(lastBody))}`);
  ok(countCacheControl(lastBody) === 2, `two breakpoints on turn 1, got ${countCacheControl(lastBody)}`);
}

console.log("\n== 6. F-641 turn N with history and no additions: both boundaries marked ==");
install();
{
  const turnN = [
    { role: "system", content: "STABLE SYSTEM PROMPT" },
    { role: "system", content: "knowledge" },
    { role: "user", content: "turn 1 words" },
    { role: "assistant", content: "turn 1 answer" },
    { role: "user", content: "turn 2 words" },
  ];
  await callAnthropicChat({ apiKey: "k", model: "m", messages: turnN, baseUrl: "https://x", cachePrefix: 4, turnPrefix: 5 });
  // filteredMessages drops the two system messages, so source 2,3,4 -> anthropic 0,1,2.
  ok(JSON.stringify(marked(lastBody)) === "[1,2]",
    `the cross-turn mark sits at the end of the history and the within-turn mark on this turn's words, got ${JSON.stringify(marked(lastBody))}`);
  ok(countCacheControl(lastBody) === 3, `three breakpoints, inside the cap of four, got ${countCacheControl(lastBody)}`);
}

console.log("\n== 7. F-641 turn N with a post-history addition (F-636 must still hold) ==");
install();
{
  const withAddition = [
    { role: "system", content: "STABLE SYSTEM PROMPT" },
    { role: "system", content: "knowledge" },
    { role: "user", content: "turn 1 words" },
    { role: "assistant", content: "turn 1 answer" },
    { role: "system", content: "<<<LEARNED_MEMORIES>>> added this turn <<<LEARNED_MEMORIES>>>" },
    { role: "user", content: "turn 2 words" },
  ];
  await callAnthropicChat({ apiKey: "k", model: "m", messages: withAddition, baseUrl: "https://x", cachePrefix: 4, turnPrefix: 6 });
  // F-640: source 2,3,4,5 -> anthropic 0,1,2,3. The post-prefix addition is NO LONGER
  // hoisted into `system` — it rides as anthropic message 2, a labelled user block — so
  // the within-turn mark now sits on anthropic 3, the user's own words.
  ok(marked(lastBody).includes(1),
    `F-636 STILL HOLDS: a mark lands INSIDE the history, the span the next turn has to match, got ${JSON.stringify(marked(lastBody))}`);
  ok(marked(lastBody).includes(3), "...and the within-turn mark is on the user's own words");
  ok(countCacheControl(lastBody) === 3, `three breakpoints, got ${countCacheControl(lastBody)}`);
}

console.log("\n== 8. F-641 a caller that declares ONE boundary is byte-unchanged ==");
install();
{
  await callAnthropicChat({ apiKey: "k", model: "m", messages: baseMessages(), baseUrl: "https://x", cachePrefix: 2 });
  const legacy = JSON.stringify(lastBody);
  install();
  await callAnthropicChat({ apiKey: "k", model: "m", messages: baseMessages(), baseUrl: "https://x", cachePrefix: 2, turnPrefix: 2 });
  ok(JSON.stringify(lastBody) === legacy, "two coinciding boundaries emit exactly what the one-boundary caller emitted");
  ok(countCacheControl(lastBody) === 2, "...still two breakpoints, at the same places");
}

/* ===================================================================================
 * F-643 - ONE DEFINITION OF "MARKABLE". The placement helper chose the boundary message
 * by ROLE; the emitter then applied a SECOND test the helper knew nothing about (empty
 * content) and, when it failed, DROPPED the mark instead of walking back. A thread whose
 * stored history ends on an empty assistant turn therefore sent its CROSS-TURN boundary
 * with no breakpoint at all, and every later turn re-billed the whole history.
 * Reproduced before the cut: marks at [2] only, against [1,2] for a non-empty tail.
 * =================================================================================== */
console.log("\n== 9. F-643 an EMPTY assistant tail: the cross-turn boundary walks back and is marked ==");
install();
{
  const emptyTail = [
    { role: "system", content: "STABLE SYSTEM PROMPT" },
    { role: "system", content: "knowledge" },
    { role: "user", content: "turn 1 words" },
    { role: "assistant", content: "" },
    { role: "user", content: "turn 2 words" },
  ];
  const res = await callAnthropicChat({ apiKey: "k", model: "m", messages: emptyTail, baseUrl: "https://x", cachePrefix: 4, turnPrefix: 5 });
  // filteredMessages: source 2,3,4 -> anthropic 0,1,2. Index 1 is the empty assistant, which
  // cannot carry a marker, so the cross-turn boundary belongs on anthropic 0 (turn 1 words).
  ok(JSON.stringify(marked(lastBody)) === "[0,2]",
    `THE FINDING: the cross-turn mark walks back to the last markable message instead of vanishing, got ${JSON.stringify(marked(lastBody))}`);
  ok(countCacheControl(lastBody) === 3, `three breakpoints (system + both boundaries), got ${countCacheControl(lastBody)}`);
  ok(res.cacheMarks === 2, `the adapter reports the 2 MESSAGE marks it emitted, got ${res.cacheMarks}`);
}

console.log("\n== 9b. F-643 control: a non-empty tail is unchanged by the cut ==");
install();
{
  const nonEmptyTail = [
    { role: "system", content: "STABLE SYSTEM PROMPT" },
    { role: "system", content: "knowledge" },
    { role: "user", content: "turn 1 words" },
    { role: "assistant", content: "turn 1 answer" },
    { role: "user", content: "turn 2 words" },
  ];
  await callAnthropicChat({ apiKey: "k", model: "m", messages: nonEmptyTail, baseUrl: "https://x", cachePrefix: 4, turnPrefix: 5 });
  ok(JSON.stringify(marked(lastBody)) === "[1,2]",
    `the control still marks the end of the history, got ${JSON.stringify(marked(lastBody))}`);
}

console.log("\n== 9c. F-643 nothing markable before the boundary: no mark, and cacheMarks says so ==");
install();
{
  const allEmpty = [
    { role: "system", content: "STABLE SYSTEM PROMPT" },
    { role: "assistant", content: "" },
    { role: "user", content: "" },
  ];
  const res = await callAnthropicChat({ apiKey: "k", model: "m", messages: allEmpty, baseUrl: "https://x", cachePrefix: 2, turnPrefix: 3 });
  ok(marked(lastBody).length === 0, "no message mark is invented on a message with no block to carry it");
  ok(res.cacheMarks === 0, `cacheMarks is 0, which is the cause reportPromptCacheDefect names, got ${res.cacheMarks}`);
}

/* ===================================================================================
 * F-640 - THE HOISTED `system` MUST NOT MOVE WHEN A TURN ADDS KNOWLEDGE. The adapter
 * merged EVERY system message into one `systemText`, so the Coder's post-history
 * `extraKnowledge` message (buildKnowledgeMessages, placed deliberately AFTER the stable
 * prefix) landed in the HEAD of the prompt. `system` then differed from the previous
 * turn's and the cross-turn cache missed at block 0, whatever the breakpoints did.
 * =================================================================================== */
console.log("\n== 10. F-640 two turns of one thread: `system` is byte-identical, the addition rides at the end ==");
{
  const threadPrefix = [
    { role: "system", content: "STABLE SYSTEM PROMPT" },
    { role: "system", content: "<<<SKILLS\npinned knowledge\nSKILLS>>>" },
    { role: "user", content: "turn 1 words" },
    { role: "assistant", content: "turn 1 answer" },
  ];
  install();
  await callAnthropicChat({
    apiKey: "k", model: "m", baseUrl: "https://x",
    messages: [...threadPrefix, { role: "user", content: "turn 2 words" }],
    cachePrefix: 4, turnPrefix: 5,
  });
  const systemTurn1 = JSON.stringify(lastBody.system);

  install();
  await callAnthropicChat({
    apiKey: "k", model: "m", baseUrl: "https://x",
    messages: [
      ...threadPrefix,
      { role: "user", content: "turn 2 words" },
      { role: "assistant", content: "turn 2 answer" },
      // THE ADDITION this turn: after the history, before the user's words.
      { role: "system", content: "<<<LEARNED_MEMORIES\nlearned since turn 1\nLEARNED_MEMORIES>>>" },
      { role: "user", content: "turn 3 words" },
    ],
    cachePrefix: 6, turnPrefix: 8,
  });
  const systemTurn2 = JSON.stringify(lastBody.system);

  ok(systemTurn2 === systemTurn1,
    "THE FINDING: the hoisted `system` is byte-identical across the two turns, so the cached prefix still matches");
  ok(!systemTurn2.includes("learned since turn 1"), "the per-turn knowledge addition is NOT in the system field");
  {
    const msgs = lastBody.messages;
    const extra = msgs[msgs.length - 2];
    ok(extra.role === "user", "the addition rides as a USER-role block");
    const text = typeof extra.content === "string" ? extra.content : JSON.stringify(extra.content);
    ok(text.includes("learned since turn 1") && text.includes("ADDITIONAL INSTRUCTIONS FROM THE APPLICATION"),
      "...labelled as the application speaking, carrying its own knowledge fence verbatim");
    ok(!text.includes("<<<CONTEXT"), "...and it does NOT borrow the UNTRUSTED <<<CONTEXT>>> marker");
    const lastText = JSON.stringify(msgs[msgs.length - 1].content);
    ok(msgs[msgs.length - 1].role === "user" && lastText.includes("turn 3 words"),
      "the user's own words still come last");
    ok(marked(lastBody).includes(msgs.length - 1),
      `the within-turn mark is on the user's own words, not on the addition, got ${JSON.stringify(marked(lastBody))}`);
  }
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
