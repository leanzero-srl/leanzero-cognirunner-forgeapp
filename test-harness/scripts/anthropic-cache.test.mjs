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

console.log("\n== 4. zero-cache response keeps the fields at 0, never undefined ==");
install();
{
  const res = await callAnthropicChat({ apiKey: "k", model: "m", messages: baseMessages(), baseUrl: "https://x" });
  const u = res.data.usage;
  ok(u.cache_read_tokens === 0 && u.cache_creation_tokens === 0, "both cache counters are 0");
  ok(u.prompt_tokens === 100 && u.total_tokens === 120, "uncached totals unchanged from before F-353");
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
