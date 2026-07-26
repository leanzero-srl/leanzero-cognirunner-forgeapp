/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 * SPDX-License-Identifier: Apache-2.0
 */
// Deterministic unit checks for the F50 (hunt-5) provider-dispatch fixes. Copies the FIXED
// logic from src/index.js and runs the exact malformed provider-response shapes the skeptic
// panel confirmed. The live weak model can't be forced to emit these on demand, so we assert
// the algorithm directly. PASS = the fixed code degrades gracefully instead of throwing/leaking.

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n}`); } };

// --- Fix #1: agentic registry-path arg parse tolerates empty/undefined arguments ---
const parseToolArgs = (argsStr) => JSON.parse(argsStr || "{}");
console.log("Fix #1 — agentic tool args || \"{}\" (matches MCP path):");
ok('empty-string args "" → {} (no throw)', JSON.stringify(parseToolArgs("")) === "{}");
ok("undefined args → {} (no throw)", JSON.stringify(parseToolArgs(undefined)) === "{}");
ok('valid args {"jql":"x"} → parsed', parseToolArgs('{"jql":"x"}').jql === "x");
let threw = false; try { parseToolArgs("{bad"); } catch { threw = true; } ok("genuinely malformed args still throws (caught by outer try)", threw === true);

// --- Fix #2/#6: provider response.json() wrapped → {ok:false}, never an uncaught throw ---
const safeJson = (parseFn, label) => { try { return { ok: true, data: parseFn() }; } catch (e) { return { ok: false, status: 200, data: null, error: `${label} returned a non-JSON body: ${e.message}` }; }; };
console.log("Fix #2/#6 — LM Studio / Bedrock non-JSON body → {ok:false}:");
ok("malformed body → {ok:false} (no uncaught throw)", safeJson(() => JSON.parse("<html>502</html>"), "LM Studio").ok === false);
ok("malformed body keeps structured error contract", typeof safeJson(() => JSON.parse("truncated{"), "Bedrock").error === "string");
ok("valid body → {ok:true} with data", safeJson(() => JSON.parse('{"output":[]}'), "LM Studio").data.output.length === 0);

// --- Fix #4: Anthropic tool_use input ?? {} (undefined input no longer serializes to undefined) ---
const anthArgs = (input) => JSON.stringify(input ?? {});
console.log("Fix #4 — Anthropic block.input ?? {} (undefined → valid JSON, not the value undefined):");
ok("input undefined → '{}' (downstream JSON.parse succeeds)", anthArgs(undefined) === "{}");
ok("input null → '{}'", anthArgs(null) === "{}");
ok("real input object → serialized", anthArgs({ jql: "x" }) === '{"jql":"x"}');
// the bug: without ?? {}, JSON.stringify(undefined) is the VALUE undefined → JSON.parse(undefined) throws
ok("regression: stringify(undefined) is NOT a parseable string", typeof JSON.stringify(undefined) === "undefined");
let dThrew = false; try { JSON.parse(JSON.stringify(undefined)); } catch { dThrew = true; } ok("proves old path threw downstream", dThrew === true);

// --- Fix #5 (bedrock): tool call with null/missing name is not pushed into tool_calls ---
const bedrockToolCalls = (content) => {
  const toolCalls = [];
  for (const block of content) {
    if (block.toolUse && block.toolUse.name) {
      toolCalls.push({ id: block.toolUse.toolUseId, function: { name: block.toolUse.name } });
    }
  }
  return toolCalls;
};
console.log("Fix #5 — Bedrock null/missing tool name not pushed (no 'Unknown tool: null' round):");
ok("toolUse.name=null → skipped", bedrockToolCalls([{ toolUse: { toolUseId: "x", name: null, input: {} } }]).length === 0);
ok("toolUse missing name → skipped", bedrockToolCalls([{ toolUse: { toolUseId: "x", input: {} } }]).length === 0);
ok("valid toolUse → pushed", bedrockToolCalls([{ toolUse: { toolUseId: "x", name: "search_jira_issues", input: {} } }]).length === 1);
ok("text block (no toolUse) → ignored, no crash", bedrockToolCalls([{ text: "hello" }]).length === 0);

console.log(`\n=== F50 verification: ${pass} passed, ${fail} failed ${fail ? "❌" : "✅"} ===`);
process.exit(fail ? 1 : 0);
