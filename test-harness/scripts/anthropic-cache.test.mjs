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

const fnSrc = extract("const convertContentBlock = (block) =>")
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
  // source 2,3,5 -> anthropic 0,1,2 (the addition is hoisted into `system`).
  ok(marked(lastBody).includes(1),
    `F-636 STILL HOLDS: a mark lands INSIDE the history, the span the next turn has to match, got ${JSON.stringify(marked(lastBody))}`);
  ok(marked(lastBody).includes(2), "...and the within-turn mark is on the user's own words");
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

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
