/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * Rule-registry scale limits — the SINGLE SOURCE for the caps that guard the
 * `config_registry` KVS value, plus the pure pressure math behind the admin
 * panel's meter. Pure and dependency-free. Imported by the backend only
 * (registerConfig / registerPostFunction / registerDiscoveredRulesCore /
 * commitImportCore / getConfigs); the admin-panel frontend renders the
 * pressure object the getConfigs resolver returns without importing anything.
 * Several frontend components DO import this module directly across the bundle
 * boundary (AgentConfig.jsx, JobsTab.jsx, FunctionBlock.jsx, DocRepository.jsx),
 * so a cap those cite needs a frontend REBUILD to reach the UI; a cap that only
 * rides the getConfigs pressure object does not.
 *
 * Why these numbers exist at all: the whole registry lives in ONE KVS value
 * with a hard ~240KiB platform ceiling. There is no eviction — the caps are a
 * refusal, and the escape valve is deleting rules from the admin panel's Rules
 * tab. Before these constants existed the literals were duplicated across six
 * call sites and the two byte thresholds silently disagreed.
 *
 * The two byte thresholds are deliberately DIFFERENT, not an oversight:
 * minting a brand-new rule earns less headroom than claiming a rule that is
 * already attached and already running (refusing the claim doesn't stop the
 * rule, it just leaves it unmanageable). Keep them named rather than merged —
 * collapsing them is a cap change, which CORE_CONTRACT §1.7 puts behind
 * explicit human approval.
 */

import { utf8ByteLength } from "./text-clamp.js";

/** Hard row cap for the registry. A create/claim at or above this is refused. */
export const REGISTRY_MAX_ROWS = 500;

/**
 * Byte threshold above which the REGISTRY COPY of a static post-function's
 * step code moves to its own `pf_code:` KVS entry. Deliberately far below
 * PF_FUNCTIONS_OFFLOAD_BYTES (24576, src/index.js) — that constant decides
 * when the WORKFLOW-embedded config goes slim (a runtime behaviour change:
 * execution then depends on the bundle fetch), while this one only decides
 * what the shared 240KiB registry value carries. Offloading the registry copy
 * costs nothing at runtime and nothing in the editor: the workflow config
 * stays inline, and the row keeps codeRef + functionsMeta for display.
 */
export const REGISTRY_FUNCTIONS_OFFLOAD_BYTES = 2048;

/**
 * The real ceiling: Forge stores one KVS value up to 240KiB. Crossing this is
 * not a policy choice, it is data corruption. Everything below is headroom
 * management beneath it.
 */
export const REGISTRY_HARD_MAX_BYTES = 240 * 1024;

/** Serialized-byte ceiling for MINTING a new rule (create paths). */
export const REGISTRY_CREATE_MAX_BYTES = 200000;

/**
 * UTF-8 byte length of a string, in BOTH runtimes.
 *
 * `TextEncoder` is a global in Node 22 (the Forge runtime) and in every browser
 * that runs the Custom UI iframes, so backend and frontend measure a document
 * with the SAME function, not merely with the same intent. This is the whole
 * point: F-836 was a gate in characters guarding a ceiling in bytes.
 *
 * F-885 — THE IMPLEMENTATION IS NOT HERE ANY MORE. It used to be a second body
 * of the same measure: `utf8ByteLength` in src/shared/text-clamp.js is the home
 * F-874 consolidated on, and it must be, because the measure and the CLAMP that
 * enforces the same budget (`clampUtf8Bytes`, next to it) have to agree exactly
 * — two encoders that merely look alike are how a gate passes a string the
 * clamp then cuts. `utf8Bytes` stays as the public NAME because the doc cap's
 * callers (saveContextDoc, both DocRepository copies, the F-836 tests) speak it
 * and renaming them would be a wider edit than the defect. Both modules are
 * dependency-free, so importing one into the other keeps every bundle valid.
 */
export const utf8Bytes = utf8ByteLength;

/**
 * Content ceiling for ONE Documentation Library document (`saveContextDoc`).
 *
 * BYTES of UTF-8, and the name says so. It used to be CHARACTERS (`.length` on
 * a JavaScript string, UTF-16 code units) with a docblock claiming that "sits
 * well under" the platform ceiling. That was false by up to 3x: CJK and emoji
 * prose costs 3-4 bytes per code unit, so a 150,000-character CJK document
 * measured 150,000 against this cap, passed every gate, and then arrived at
 * `storage.set` as roughly 450KB - past the 240KiB KVS value ceiling. The
 * platform refused, and the catch handed back the platform's own sentence,
 * which names no size and no remedy.
 *
 * Now the relationship to the ceiling is real: 200,000 bytes is 195.3KiB, and
 * REGISTRY_HARD_MAX_BYTES is 245,760. The ~44KiB of headroom is not decoration
 * either - the stored value is `{ ...doc, content }` (id, title, category,
 * contentLength, createdBy, createdAt plus JSON punctuation), and the same
 * document also adds an index row to `doc_repo_index`.
 *
 * Every gate on this cap measures with `utf8Bytes` - the backend in
 * `saveContextDoc`, and both DocRepository copies. One unit, one function.
 *
 * It coincides with REGISTRY_CREATE_MAX_BYTES and is NOT the same rule: that one
 * bounds the whole shared registry value, this one bounds a single `doc_repo:{id}`
 * entry. Keep them separate - moving one must not move the other.
 */
export const DOC_CONTENT_MAX_BYTES = 200000;

/** How the doc cap is spoken to a user. Derived, never retyped. */
export const DOC_CONTENT_MAX_LABEL = `${Math.round(DOC_CONTENT_MAX_BYTES / 1000)} KB`;

/** The refusal `saveContextDoc` returns, and the hint the editor shows. */
export const DOC_TOO_LARGE_MESSAGE = `Document too large (max ~${DOC_CONTENT_MAX_LABEL})`;

/** Serialized-byte ceiling for CLAIMING an already-attached rule (scan paths). */
export const REGISTRY_CLAIM_MAX_BYTES = 230000;

/**
 * Serialized-byte ceiling for UPDATING an existing row. Updates were entirely
 * unguarded (both create checks gate on "is this a new row"), so edits could
 * grow rows from the 200KB refusal line straight to the platform ceiling.
 * Deliberately ABOVE the claim threshold: an update that shrinks or barely
 * grows a row must never be refused near the line — slimming and deleting are
 * how a full registry recovers — so this only stops updates that would push
 * the whole value within a hair of corruption.
 */
export const REGISTRY_UPDATE_MAX_BYTES = 235000;

/** Shown when the row cap is hit. Must name the actual escape route. */
export const REGISTRY_FULL_MESSAGE =
  `Rule registry is full (${REGISTRY_MAX_ROWS} rules). Delete rules you no longer need from the admin panel's Rules tab, then try again.`;

/** Shown when the byte ceiling is hit before the row cap (PF-heavy installs). */
export const REGISTRY_SIZE_MESSAGE =
  "Rule registry has reached its storage size limit. Delete rules you no longer need from the admin panel's Rules tab (static post-function code is the usual culprit), then try again.";

/** Warn/full thresholds for the meter, as fractions of the caps. */
export const REGISTRY_WARN_AT = 0.7;
export const REGISTRY_FULL_AT = 0.9;

/**
 * Pure pressure math for the admin-panel meter.
 *
 * Accepts either the registry array or a precomputed `{ count, bytes }` so the
 * caller can avoid a second JSON.stringify on a hot path.
 *
 * Two different numbers, and conflating them produced a meter that read
 * "219 / 200 KB" — a usage bar reporting a value past its own maximum, which
 * tells a user nothing except that the number is wrong:
 *
 *   CAPACITY  = REGISTRY_HARD_MAX_BYTES. What the meter measures against. Going
 *               past it corrupts the registry, so it is the only honest "out of".
 *   REFUSAL   = REGISTRY_CREATE_MAX_BYTES. Where the app stops accepting NEW
 *               rules, deliberately below capacity so there is room to
 *               re-save and delete existing ones. Being past it is normal and
 *               recoverable — it is a state to report, not a maximum breached.
 *
 * Returns { count, bytes, max, maxBytes, refuseAtBytes, rowPct, bytePct, pct,
 * level, refusing } where `pct` is the binding constraint and `level` is
 * "ok" | "warn" | "full".
 */
/**
 * Slim one registry row for storage. Pure, synchronous, idempotent — applied
 * to EVERY row on EVERY registry write (saveRegistry in src/index.js), so the
 * stored shape converges without a per-row migration sweep.
 *
 * What it removes is exactly what every reader already treats as absent:
 *   - null/undefined values, and "" (all row readers — backend and both
 *     frontends — test these fields with truthiness, never with `in`).
 *   - `false` for the known boolean flags below. Their absence already means
 *     false to every reader. Keep this an EXPLICIT list: a future boolean
 *     whose false differs from absent must not be added here.
 *   - empty arrays, EXCEPT `functions` next to a codeRef (there, [] is the
 *     offload signal and stays).
 *   - `ruleKind: "ai"` — the default every reader assumes.
 *   - `workflow.siteUrl` — identical on every row of a site; both frontends
 *     already fall back to their own context siteUrl (admin App.js ~6235).
 *
 * And what it rewrites:
 *   - createdAt/updatedAt/claimedAt ISO strings → epoch-ms numbers (half the
 *     bytes at 500 rows). Readers were made tolerant of both forms:
 *     `new Date(x)` (frontends) and rowTimeMs (backend orphan check) accept a
 *     number or a string; rows may hold either form mid-migration.
 *
 * Measured on the wolfaenpak dev registry (498 rows): 219,040 → ~188,500
 * bytes (-14%), which moves the site back below REGISTRY_CREATE_MAX_BYTES.
 */
/**
 * Serialized size of registry content in UTF-8 BYTES — the unit the 240KiB
 * Forge KVS ceiling is measured in. JSON.stringify(...).length counts UTF-16
 * code units, which under-reports any non-ASCII content (a prompt written in
 * Greek or with emoji counts 1 per char but stores 2-4 bytes) — so guards
 * measuring .length can pass a write the platform then refuses. The repo
 * already establishes bytes as the platform truth (memories.js, index.js
 * attachment paths); every registry cap check and the meter go through here.
 * TextEncoder exists in Node ≥11 and every browser, keeping this module
 * dependency-free and isomorphic.
 */
export function registrySerializedBytes(value) {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return 0; // never let size math throw on a read path
  }
}

const SLIM_FALSE_FLAGS = new Set([
  "disabled", "discovered", "crossCheckClaims", "attachComment", "autoSelectResearchDoc",
]);
const SLIM_EPOCH_FIELDS = new Set(["createdAt", "updatedAt", "claimedAt"]);
export function slimRegistryRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return row;
  // Ownership invariant, enforced at EVERY write: a scan-claimed row
  // (discovered:true) never carries authorship — claiming is not authoring.
  // The one-shot getConfigs repair fixed the historical rows, but a one-shot
  // guarded by a flag is only as strong as its worst race: a concurrent writer
  // holding a pre-repair snapshot could save the mis-stamped rows back AFTER
  // the flag was set, permanently. With the invariant here, any later write
  // re-heals — the clobber can survive at most until the next save.
  if (row.discovered === true && row.createdBy) {
    row = { ...row, claimedBy: row.claimedBy || row.createdBy, createdBy: null };
  }
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined || v === "") continue;
    if (v === false && SLIM_FALSE_FLAGS.has(k)) continue;
    if (Array.isArray(v) && v.length === 0 && !(k === "functions" && row.codeRef)) continue;
    // F-801 — the ONE clamp for step provenance on the registry side. Every other
    // step field arrives from a resolver that already substring()s or types it;
    // `generationMeta` arrived WHOLESALE from the config-ui / admin-panel save, so
    // nested caller JSON (a credential included) could land in the shared
    // `config_registry` value. It sits here because saveRegistry (src/index.js
    // ~296) slims EVERY row on EVERY write — no write site can reintroduce the
    // unbounded shape. The pf_code offload writes `functions` to its own KVS key
    // and therefore calls normalizeFunctionsForStorage directly.
    if (k === "functions" && Array.isArray(v)) { out[k] = normalizeFunctionsForStorage(v); continue; }
    if (k === "ruleKind" && v === "ai") continue;
    if (SLIM_EPOCH_FIELDS.has(k) && typeof v === "string") {
      const ms = Date.parse(v);
      out[k] = Number.isFinite(ms) ? ms : v;
      continue;
    }
    if (k === "workflow" && v && typeof v === "object" && !Array.isArray(v)) {
      const wf = {};
      for (const [wk, wv] of Object.entries(v)) {
        if (wk === "siteUrl") continue;
        if (wv === null || wv === undefined || wv === "") continue;
        wf[wk] = wv;
      }
      if (Object.keys(wf).length > 0) out.workflow = wf;
      continue;
    }
    out[k] = v;
  }
  return out;
}

export function registryPressure(input) {
  let count = 0;
  let bytes = 0;
  if (Array.isArray(input)) {
    count = input.length;
    bytes = registrySerializedBytes(input); // UTF-8 bytes — the platform's unit
  } else if (input && typeof input === "object") {
    count = Number(input.count) || 0;
    bytes = Number(input.bytes) || 0;
  }
  const rowPct = REGISTRY_MAX_ROWS > 0 ? count / REGISTRY_MAX_ROWS : 0;
  // Measured against CAPACITY, so the fraction can never exceed 1 in normal use.
  const bytePct = REGISTRY_HARD_MAX_BYTES > 0 ? bytes / REGISTRY_HARD_MAX_BYTES : 0;
  const pct = Math.max(rowPct, bytePct);
  // Refusing is a fact about the app's behaviour, not a percentage — a user at
  // 201 KB is refused just as firmly as one at 239 KB, and needs to be told so.
  const refusing = count >= REGISTRY_MAX_ROWS || bytes > REGISTRY_CREATE_MAX_BYTES;
  const level = refusing || pct >= REGISTRY_FULL_AT ? "full"
    : pct >= REGISTRY_WARN_AT ? "warn"
      : "ok";
  return {
    count,
    bytes,
    max: REGISTRY_MAX_ROWS,
    maxBytes: REGISTRY_HARD_MAX_BYTES,
    refuseAtBytes: REGISTRY_CREATE_MAX_BYTES,
    rowPct,
    bytePct,
    pct,
    level,
    refusing,
  };
}

/* ------------------------------------------------------------------------
 * MEMORY-STORE limits (F-175).
 *
 * These live HERE rather than in src/memories.js because that module imports
 * @forge/kvs at load time, so nothing outside the Forge backend can import it:
 * the screenshot-harness bridge mock had to RETYPE the cap sentence and the
 * cap number, which is exactly the N-copies-of-one-rule defect this file was
 * created to end. src/memories.js re-exports every name below, so existing
 * backend/test imports from "./memories.js" keep working unchanged.
 *
 * Same storage reality as the registry: one KVS array value under
 * `pf_memories`, one hard ~240KiB platform ceiling, and no automatic eviction
 * of anything a human wrote: the app evicts only NON-ARCHIVED auto-captured
 * rows (F-176/F-177), so archiving — the non-destructive action — keeps its
 * slot and still counts toward the cap. The cap is therefore a REFUSAL whose
 * one escape valve is DELETING in the Memories tab.
 * ---------------------------------------------------------------------- */

/** Hard row cap for the memory store. */
export const MAX_MEMORIES = 200;

/**
 * Serialized-byte guard for the `pf_memories` value. Measured in real UTF-8
 * BYTES, not UTF-16 chars — the KVS value cap is 240KiB (245760 bytes) and
 * multibyte content (emoji, CJK) runs ~3-4 bytes/char, so a char count would
 * let the value blow past the platform cap and throw. Safety margin included.
 */
export const MEMORY_MAX_SERIALIZED_BYTES = 230000;

/**
 * The PLATFORM ceiling for one KVS value: 240 KiB. This is not our guard — it is the
 * point at which KVS rejects the write outright and the caller gets an exception instead
 * of an answer (F-183). It exists here as a named constant because F-189 showed the two
 * limits are not interchangeable: a store that is already OVER this number (any 1.2.0
 * instance that ran the pre-F-183 merge/reinforce path) cannot be repaired one row at a
 * time — every single-row delete still writes an oversized array and throws. The app
 * therefore measures against THIS number before it writes, refuses with reason
 * "platform-cap" and says how many bytes have to go, and offers a BULK delete so enough
 * can go in one write.
 */
export const MEMORY_PLATFORM_MAX_SERIALIZED_BYTES = 245760;

/**
 * The ONE memory-content clamp (F-168). Every caller that trims memory text —
 * saveMemoryCandidate in src/memories.js, the addMemory/updateMemory resolvers
 * in src/index.js — imports THIS constant; do not retype the number.
 * (async-handler's distill task clamps model-emitted text tighter on purpose,
 * with its own named constant.)
 */
export const MEMORY_CONTENT_MAX = 400;

/**
 * The ONE user-facing refusal sentence for a store that will not take a lesson
 * (F-174). THREE surfaces say it: the addMemory resolver (src/index.js), the
 * Memories tabs which render its `error`, and the screenshot harness's bridge
 * mock — which can import it from here. Every number in it is interpolated
 * from the constants above; a retyped "200" is the defect class F-168/F-172
 * were filed for. Pure: no storage, no I/O.
 */
export const memoryCapRefusalMessage = (reason) => (reason === "bytes"
  ? "Memory store has reached its size limit: delete or shorten some memories in the Memories tab."
  : `Memory store is full (${MAX_MEMORIES} max). No memory you wrote is ever evicted automatically, and archived memories still count toward the cap, so delete some in the Memories tab to make room.`);

/**
 * The refusal for a store that is already OVER the PLATFORM ceiling (F-189) — a different
 * sentence from the two above because the ACTION is different: the store cannot accept any
 * write at all, not even a one-row delete, until enough rows go in a SINGLE delete. It
 * names the deficit because "delete some" is useless advice when the admin cannot tell
 * whether that means one row or forty. Pure: no storage, no I/O.
 */
/**
 * The refusal for a write the PLATFORM threw on after our own measurement said it would
 * fit (F-197). A different sentence again, because the action is different a third time:
 * nothing is too big, nothing needs deleting, the write simply did not land — so the
 * honest advice is to try again. It carries NO byte number on purpose: the old code
 * reported this case as "platform-cap" with a fabricated 1-byte deficit, which sent an
 * admin to bulk-delete memories over a transient KVS fault on a 1.4 KB write. Pure: no
 * storage, no I/O.
 */
export const memoryWriteFaultMessage = () => "Could not save: Jira storage refused the write; try again.";

export const memoryPlatformCapMessage = (bytesOver) => {
  const over = Math.max(1, Math.round(Number(bytesOver) || 0));
  return `Memory store is ${over} bytes over Jira's ${MEMORY_PLATFORM_MAX_SERIALIZED_BYTES}-byte storage limit, so no change to it can be saved, not even deleting one memory. Freeing at least ${over} bytes means selecting several memories in the Memories tab and deleting them together.`;
};

/* ------------------------------------------------------------------------
 * KNOWLEDGE-INJECTION budgets, PER AUDIENCE (1.4 commit 13b).
 *
 * Until 1.4 there was ONE number — `fetchSkillsBlock`'s `capBytes = 24576` default,
 * written as a literal in src/skills.js — because there was ONE audience: the codegen
 * and fix prompts, which are one-shot, have no tool transcript to grow into, and can
 * afford 24 KB of instructions.
 *
 * 1.4 gives the same blocks to AGENTS, and an agent's prompt is not one-shot: it is
 * re-sent every round, alongside a tool transcript that grows by up to
 * TOOL_RESULT_MAX_CHARS per call. A 24 KB skills block on an 8-round agent is 24 KB
 * paid eight times, and it crowds out the transcript the agent actually reasons over.
 * So the budget becomes a function of WHO is reading, and the table lives HERE — one
 * home, dependency-free, next to the other caps — rather than as a number retyped at
 * each of the four call sites.
 *
 *   codegen   — the pre-1.4 numbers, DELIBERATELY UNCHANGED. Changing them would be a
 *               silent quality change to a shipped feature.
 *   agentRun  — a listener or scheduled-job agent run (8 KB of skills). Short
 *               instructions, up to 8 rounds, the tightest transcript pressure.
 *   coderTurn — the in-issue Coder (16 KB). Longer, code-shaped skills genuinely help,
 *               and the 900 s consumer affords the tokens.
 *   prReview  — a pull-request review (6 KB). The DIFF is the content; knowledge is
 *               there to shape the voice and the house rules, not to compete with it.
 *
 * `memories` is smaller than `skills` in every row on purpose: a memory is one advisory
 * line, and 4 KB is already ~40 of them — past that the block stops being a reminder
 * and becomes a second instruction set.
 *
 * F-873 — TWO MORE AUDIENCES, because two callers were typing their memory budget as a
 * literal at the call site instead of naming it here:
 *
 *   endpointAssistant — `suggestEndpoint` (src/index.js): the editor's one-shot "which
 *               REST endpoint do I need" helper. It runs inline inside the 25 s resolver
 *               cap, already carries the whole endpoint catalogue in its prompt, and the
 *               memories are there to warn about THIS instance's quirks — 2 KB, the
 *               tightest row, because the catalogue is the content.
 *   configReview — the async `review` task (src/async-handler.js), and only for a static
 *               post-function config. The memories often explain why a step that looks
 *               fine keeps failing on this instance, so it gets twice the assistant's
 *               room (4 KB) on the 120 s consumer, but not codegen's 8 KB: it is
 *               reviewing steps, not writing them.
 *
 * NEITHER OF THOSE TWO INJECTS SKILLS. Their `skills` number is therefore not a figure
 * anyone chose — it carries the SMALLEST row's value so that `knowledgeBudget()` always
 * answers a whole budget, for the same reason an unknown audience falls to the smallest
 * row rather than the largest. If one of them ever grows a skills block, that number is
 * a decision to make, not a default to inherit.
 *
 *   runtime — F-886. The PER-TRANSITION surfaces: validators, conditions and semantic
 *               post-functions, via `getRuntimeMemorySection` in src/index.js. 4 KB of
 *               memories was a function-DEFAULT PARAMETER there (`capBytes = 4096`), which
 *               is a fourth typed budget in exactly the shape F-868/F-873 removed from the
 *               call sites — a default is a home too, and this one could drift from the
 *               table without any caller changing. The number is unchanged: this audience
 *               is doubly opt-in (`runtimeInjection`) and pays its tokens on EVERY
 *               transition inside the 25 s resolver budget, so it sits at the async
 *               review's 4 KB rather than codegen's 8 KB. Its `skills` column is the
 *               SMALLEST row's value for the same reason `endpointAssistant` and
 *               `configReview` carry one — runtime injects no skills at all, and a whole
 *               row keeps `knowledgeBudget()` total.
 */
export const KNOWLEDGE_BUDGET_BYTES = Object.freeze({
  codegen: Object.freeze({ skills: 24576, memories: 8192 }),
  agentRun: Object.freeze({ skills: 8192, memories: 4096 }),
  coderTurn: Object.freeze({ skills: 16384, memories: 8192 }),
  prReview: Object.freeze({ skills: 6144, memories: 2048 }),
  endpointAssistant: Object.freeze({ skills: 6144, memories: 2048 }),
  configReview: Object.freeze({ skills: 6144, memories: 4096 }),
  runtime: Object.freeze({ skills: 6144, memories: 4096 }),
});

/**
 * The budget for one audience. An UNKNOWN audience gets the SMALLEST row, not the
 * largest: a caller that forgot to name itself must not be handed the codegen budget by
 * accident, for the same reason the action gate's default context is the restrictive one.
 */
export const knowledgeBudget = (audience) => KNOWLEDGE_BUDGET_BYTES[audience] || KNOWLEDGE_BUDGET_BYTES.prReview;

/* ------------------------------------------------------------------------
 * FIELD-GUIDE BUDGETS (1.4 commit 14a) — ONE home for the per-audience byte caps.
 *
 * The field guide (src/shared/knowledge-select.js, packs under
 * src/shared/knowledge-packs/) is a THIRD knowledge layer alongside skills and memories,
 * and it needs its own row per audience for the same reason they do: a validator running
 * on every transition and a Coder turn on the 900 s consumer do not have the same token
 * economy, and a single constant would be wrong for both. This is the same mistake
 * `fetchSkillsBlock` made with one 24,576-byte number for every caller.
 *
 * The numbers are the plan's (§3.15) and they are deliberately SMALLER than the skills
 * budgets: a skill is instruction the author chose, the field guide is background the
 * selector chose. Background that outweighs the instruction is how a model ends up
 * answering the reference material instead of the request.
 *
 *   codegen / fix  12 KB — the generous rows. Generation is the surface the guide was
 *                          built for, and a wrong answer here is saved and re-run forever.
 *   validator       6 KB — runs on EVERY transition, inline, inside the 25 s budget and
 *                          under the token-per-minute ceiling validators cannot defer.
 *   agent           8 KB — a listener/job agent run: several rounds, each resending the
 *                          prefix, so every kilobyte is paid per round.
 *   va              8 KB — one Virtual Administrator item turn, same shape as an agent run.
 *   coder          16 KB — the in-issue Coder. Longer, code-shaped background genuinely
 *                          helps and the 900 s consumer affords the tokens.
 *   review          6 KB — a PR review. The DIFF is the content; background is there to
 *                          shape the house rules, not to compete with it.
 *
 * THE PINNED SHARE IS NOT ONE OF THESE NUMBERS, DELIBERATELY (F-576). Pins may spend
 * `PINNED_BUDGET_SHARE` (40 %, src/shared/knowledge-select.js) of whichever row applies,
 * and that share is a single scalar rather than a second column here. `va` is the tight
 * audience — 3061 B of pins against a 3276 B share, 215 B of headroom — and a per-audience
 * share was considered and rejected there, with the arithmetic, rather than here: these
 * rows differ because the CALLERS differ, while the share states a policy ("most of the
 * guide answers the question asked") that is true of every caller. If this table ever
 * grows a second column, read that comment first.
 * ---------------------------------------------------------------------- */
export const FIELD_GUIDE_BUDGET_BYTES = Object.freeze({
  codegen: 12288,
  fix: 12288,
  validator: 6144,
  agent: 8192,
  va: 8192,
  coder: 16384,
  review: 6144,
});

/**
 * The field-guide budget for one audience. An UNKNOWN audience gets the SMALLEST row, not
 * the largest — the same rule `knowledgeBudget` follows, and for the same reason: a caller
 * that forgot to name itself must not be handed the biggest budget by accident.
 */
export const fieldGuideBudget = (audience) =>
  FIELD_GUIDE_BUDGET_BYTES[audience]
  || Math.min(...Object.values(FIELD_GUIDE_BUDGET_BYTES));

/**
 * THE TWO AUDIENCE VOCABULARIES, RECONCILED IN ONE PLACE (1.4 commit 14b).
 *
 * `KNOWLEDGE_BUDGET_BYTES` (skills + memories) names its rows `agentRun` / `coderTurn` /
 * `prReview`; the field guide's rows are `agent` / `coder` / `review`, because the bake
 * tags each SECTION with the audiences it serves and those tags are written by hand into
 * knowledge/sources.json, where a reviewer wants `agent`, not `agentRun`.
 *
 * Two vocabularies for the same set of readers is a translation, and a translation always
 * gets a home or it gets retyped. `buildAgentKnowledge` takes the skills/memories name and
 * needs the field-guide one, so the map lives HERE, beside both tables it reconciles,
 * rather than as a ternary in listeners.js and another in async-handler.js.
 *
 * An unmapped name passes through unchanged, so a caller that already speaks the field
 * guide's vocabulary ("validator", "va", "fix") needs no entry — and an unknown name
 * still lands on `fieldGuideBudget`'s smallest-row rule rather than on a default budget
 * invented here.
 */
export const FIELD_GUIDE_AUDIENCE_FOR = Object.freeze({
  agentRun: "agent",
  coderTurn: "coder",
  prReview: "review",
});

/** Translate a skills/memories audience name into the field guide's. One home. */
export const fieldGuideAudience = (audience) => FIELD_GUIDE_AUDIENCE_FOR[audience] || audience;

/** Skills a rule may bind. Small on purpose: a rule picks a VOICE, not a library. */
export const MAX_RULE_SKILL_IDS = 4;

/* ------------------------------------------------------------------------
 * RUN BRAKES (1.4 commit 13d) — ONE home for the numbers.
 *
 * Listeners have had brakes since 1.2 (`lst_brake:*`: 30 runs per object and 120 per
 * listener, per 5 minutes), because a listener whose own write re-fires its own event is
 * the failure that surface fears most. SCHEDULED JOBS had none: a job is started by the
 * app's own clock, so it cannot loop on itself — but it can still hold a 100-issue scope
 * and an agent that writes on every one of them, and until now nothing counted that.
 *
 * Two different brakes, because they answer two different questions:
 *
 *   maxWritesPerRun — "how much may ONE run change?" Per job, author-set, clamped here.
 *       Counted on the run's CHANGE LEDGER (`session.changes` in createSandboxSession),
 *       which is the one write counter both execution modes and both rule kinds already
 *       share. Counting anything else would be a second counter that drifts.
 *   agent-run brake — "how much AI may the WHOLE INSTALLATION start in 5 minutes?"
 *       Tenant-wide, fixed, in the same `<prefix>:<bucket>` shape as `lst_brake`. This is
 *       the cost ceiling: a per-rule brake cannot see forty rules each behaving.
 * ---------------------------------------------------------------------- */

/**
 * Writes ONE job run may make before it stops, when the job does not say otherwise.
 *
 * DERIVED, not guessed: the largest scope a job may hold is MAX_SCOPE_ISSUES (100,
 * src/scheduled-jobs.js), and an escalation sweep that sets a field and adds a comment on
 * every one of them is the ORDINARY use of this feature, not an abuse — so the default
 * must clear twice the biggest legal scope. A brake that trips on correct work teaches
 * every author to raise it, which is how a brake becomes a formality (and there is a
 * cross-check in the scheduled-jobs suite so the two numbers cannot drift apart).
 *
 * It is still decisive for the case it exists for: a runaway agent looping on one issue
 * has no scope at all and hits 200 in one run.
 */
export const JOB_DEFAULT_MAX_WRITES_PER_RUN = 200;
/** The ceiling an author may raise it to. Above this, use several jobs with tighter scopes. */
export const JOB_MAX_WRITES_PER_RUN = 1000;
/** A job may also brake HARD at 0 writes — the value is meaningful, so 0 is not "unset". */
export const JOB_MIN_WRITES_PER_RUN = 0;

/**
 * Tenant-wide AI agent runs per 5-minute bucket. Sized against the platform's own
 * ceilings rather than a guess: the 120-per-listener brake times a handful of busy rules
 * lands here, and past this the token budget (`src/shared/ai-budget.js`) would be
 * deferring almost everything anyway — so this brake's job is to make the runaway VISIBLE
 * and CHEAP rather than to be the first thing that notices it.
 */
export const AGENT_RUN_BRAKE_MAX_PER_BUCKET = 200;

/**
 * WEB SEARCHES ONE RUN MAY MAKE (F-407).
 *
 * The per-TURN budget (3, src/web-search-tool.js) is per `runAgentTask` call, and a scoped
 * job calls that once PER ISSUE — so a 100-issue sweep could make 300 searches and nothing
 * in the product said otherwise. A run is the unit an operator configures and reads about,
 * so the run is where the ceiling belongs. Ten leaves a scoped job room to check a claim
 * on a handful of issues and stops the sweep that searches on every one of them.
 */
export const WEB_SEARCH_MAX_PER_RUN = 10;

/**
 * WEB SEARCHES THE WHOLE INSTALLATION MAY MAKE IN ONE 5-MINUTE BUCKET (F-407).
 *
 * Same mechanism and same 5-minute bucket as AGENT_RUN_BRAKE_MAX_PER_BUCKET, for the same
 * reason: the per-run ceiling is per RUN, and forty rules each behaving is only visible at
 * the installation. Set above the agent-run brake's own reach for ordinary traffic (most
 * agent runs search zero times) so that this trips on a genuine storm rather than on a
 * busy afternoon, and it is a hosted third-party service being spent, not just tokens.
 */
export const WEB_SEARCH_BRAKE_MAX_PER_BUCKET = 300;

/** The refusal sentence for each brake. ONE home: the log, the job row and the REST answer share it. */
export const brakeRefusalText = (kind, max) => {
  if (kind === "job-writes") return `Write brake: this run reached its limit of ${max} change${max === 1 ? "" : "s"}. The remaining work was not done. Raise the job's "maximum writes per run", narrow its scope JQL, or split it into several jobs.`;
  if (kind === "agent-runs") return `Agent brake: this installation started more than ${max} AI agent runs in 5 minutes, so this run was skipped. Something is firing far more often than intended, check the listeners and jobs that ran in the last few minutes.`;
  if (kind === "web-searches-run") return `Search brake: this run has already made ${max} web searches. Work with what those returned, or say plainly that you could not check.`;
  if (kind === "web-searches") return `Search brake: this installation made more than ${max} web searches in 5 minutes, so this one was refused. Something is searching far more often than intended, check the listeners and jobs that ran in the last few minutes.`;
  return "Run brake tripped.";
};

/* ------------------------------------------------------------------------
 * VIRTUAL ADMINISTRATOR BRAKES (1.5 commit 1) — the numbers a GATE enforces.
 *
 * THE SPLIT, stated once so it is not re-decided per constant:
 *   - A number a RUNTIME GATE enforces (how often the agent may speak, how many
 *     items a tick may open, how long the wall-clock floor is, when an item parks,
 *     when a row expires, when the banner turns red) lives HERE, beside the job and
 *     agent-run brakes, because those gates run in `src/virtual-admin.js` and
 *     `src/va-ledger.js` — files the admin panel cannot import, and because a brake
 *     number without its refusal sentence is how a brake becomes a formality.
 *   - A number that only bounds the RECORD'S SHAPE (string lengths, list lengths, the
 *     persona charset) lives in `src/shared/va-config.js` next to the clamp that
 *     applies it, because nothing outside `normalizeVa` ever reads it.
 * `src/shared/va-config.js` imports this block and exposes it as `VA_LIMITS`; it
 * declares none of these literals itself, and `shared-imports.test.mjs` asserts that.
 *
 * WRITE VOCABULARY (F-425): a Virtual Administrator's per-run write brake IS the job
 * brake — `JOB_DEFAULT_MAX_WRITES_PER_RUN` / `JOB_MAX_WRITES_PER_RUN` above. There is
 * no `maxBulkTargets` and there is no second write number. A VA is a scheduled job
 * with `mode:"va"`, so a second vocabulary would mean two counters for one question.
 * ---------------------------------------------------------------------- */

/** Posts per rolling hour when the agent's config does not say otherwise. */
export const VA_CAPS_PER_HOUR_DEFAULT = 6;
/** The ceiling an author may raise the hourly cap to. */
export const VA_CAPS_PER_HOUR_MAX = 60;
/** Posts per rolling day, default and ceiling. */
export const VA_CAPS_PER_DAY_DEFAULT = 40;
export const VA_CAPS_PER_DAY_MAX = 400;

/**
 * OWED replies get their OWN hourly cap — they are not uncapped (F-412).
 *
 * The plan carried `owedUncapped: true`: a human replied, so the agent may always
 * answer. That is a cap with an off switch, and the failure mode of a queue worker is
 * exactly the loop where its own reply provokes a reply. `owedPerHour` (12, twice the
 * ordinary hourly cap) keeps the "answer the waiting human first" behaviour and still
 * has a ceiling. `normalizeVa` REFUSES the old field BY NAME rather than ignoring it,
 * so an operator who set it learns it is gone instead of believing it still holds.
 */
export const VA_OWED_PER_HOUR_DEFAULT = 12;
export const VA_OWED_PER_HOUR_MAX = 60;

/** Items one PREPARE tick may fan out. Each is a model turn, so this is a cost gate. */
export const VA_MAX_ITEMS_PER_TICK_DEFAULT = 5;
export const VA_MAX_ITEMS_PER_TICK_MAX = 20;

/** Candidates one sweep may consider before it stops looking (plan 3.11 step 1). */
export const VA_MAX_CANDIDATES_PER_TICK = 50;

/** Ticks a new or just-reconfigured agent spends staging without posting (shadow mode). */
export const VA_SHADOW_TICKS_DEFAULT = 3;
export const VA_SHADOW_TICKS_MAX = 50;
/**
 * THE ABSOLUTE CEILING ON `status.shadowUntilTick` ITSELF (F-508).
 *
 * `shadowTicks` above is how many ticks a SAVE adds; this is how far into the agent's
 * own future the stored watch may point, and until F-508 it was the one VA number with
 * no bound at the door at all (`Number.MAX_SAFE_INTEGER`). An unbounded value was then
 * silently replaced three steps later by the save path's re-arm, which shortened a
 * deliberately armed long watch to `watched + shadowTicks` and answered 200 with nothing
 * in `refused[]`.
 *
 * 500 OF THE AGENT'S OWN PREPARE TICKS. At the five-minute cadence floor that is close
 * to two days of continuous supervised staging, which is the longest watch that is still
 * a watch — past that an admin does not want an agent staging unread, they want it
 * paused, and `status.paused` is the control that says so.
 *
 * IT IS ALSO WHAT REPAIRS THE F-484 LEFTOVERS — but only because F-514 gave it a second
 * consumer. This docblock used to claim the repair outright, and it was not true: the
 * ceiling was applied at the SAVE door alone (`normalizeVa`), which never runs on a
 * record nobody edits, while the runtime reader (`shadowStateOf`) took the stored number
 * raw. A pre-F-484 agent carrying a wall-clock-derived ~8640 therefore sat in shadow
 * mode for about a year, and the constant said in prose that it had fixed exactly that.
 * The clamp now has ONE home, `clampShadowUntilTick` in `src/shared/va-config.js`, used
 * by the door (which reports what it cut) and by the reader (which does not need to,
 * because nobody asked for the stored value). Read that helper for why the read side's
 * ceiling is anchored rather than flat.
 *
 * AND THE CEILING ITSELF IS `shadowReachableCeiling`, one function asked by BOTH (F-519).
 * The two clamps stayed, because only the door reports; the ARITHMETIC did not. The door
 * was still applying this constant flat, ahead of the shared clamp, so an agent with 600
 * prepare receipts armed to 603 was cut to 500 by its next save — in the PERMISSIVE
 * direction, releasing it from shadow mode 103 ticks early. Where the watch count cannot
 * be read at all, the door keeps what is stored and says `shadow-watch-unknown`.
 */
export const VA_SHADOW_UNTIL_TICK_MAX = 500;

/** The wall-clock half of the two-phase speech floor, in minutes (the tick-id half is code). */
export const VA_MIN_POST_GAP_MINUTES_DEFAULT = 15;
export const VA_MIN_POST_GAP_MINUTES_MIN = 5;
export const VA_MIN_POST_GAP_MINUTES_MAX = 1440;

/** "We spoke last within N days" suppresses a non-owed reply (anti-pile-up). */
export const VA_ANTI_PILE_UP_DAYS_DEFAULT = 4;
export const VA_ANTI_PILE_UP_DAYS_MAX = 30;

/** Quiet period after somebody who is not us wrote on the issue, in minutes. */
export const VA_OTHER_WRITER_QUIET_MINUTES_DEFAULT = 15;
export const VA_OTHER_WRITER_QUIET_MINUTES_MAX = 1440;

/**
 * Attempts one ledger item gets before it PARKS (F-414). A turn that stages nothing,
 * or whose draft the voice lint rejects, increments it. Three is not a guess: the
 * rewrite turn SEES the previous rejection reason, so a fourth identical failure is a
 * model that cannot do this item, and every further attempt costs tokens plus a queue
 * slot a workable item could have had.
 */
export const VA_ITEM_ATTEMPTS_MAX = 3;

/** Ledger item rows one agent may hold before the oldest-touched are parked (LRU, F-413). */
export const VA_ITEM_ROW_CAP = 400;
/** Item-row TTL in days, refreshed on every touch (F-413). */
export const VA_ITEM_TTL_DAYS = 90;
/** Tick-receipt TTL, and effects-row TTL. A receipt is evidence; an effect is history. */
export const VA_TICK_TTL_DAYS = 7;
export const VA_EFFECT_TTL_DAYS = 30;
/**
 * How long a HALF-FINISHED setup interview waits at `va_wizard:{accountId}` (1.5 commit 5b).
 *
 * Seven days, because the thing it protects is a closed browser tab: an admin who was
 * interrupted mid-interview comes back the same week or starts again anyway. It is
 * deliberately SHORTER than the item TTL and equal to the tick receipt's — a stale
 * interview is cheap to lose and expensive to resume wrongly, since the catalogue it was
 * answered against (projects, desks, queues) may no longer exist. `resumeWizard` already
 * refuses a state from another version; this TTL is the same refusal applied to age.
 */
export const VA_WIZARD_TTL_DAYS = 7;
/**
 * How long an UNFINISHED ADMIN FORM waits in this browser's localStorage (F-990).
 *
 * The sibling above is the same idea one storey up: `VA_WIZARD_TTL_DAYS` protects a
 * closed tab mid-interview SERVER side, and this protects a closed tab mid-FORM on the
 * CLIENT. They share the number deliberately, because they share the argument — an admin
 * who was interrupted comes back the same week or starts again, and a draft answered
 * against a catalogue (projects, repos, fields, models) that has since moved is expensive
 * to resume wrongly and cheap to lose.
 *
 * It lives HERE rather than in `draft-state.js` for the same reason every other number
 * does: caps have one home, and the file that owns the KEY owns the shape, not the value.
 * `draft-state.js` re-exports it so a frontend importing the rule never has to know that
 * the number came from somewhere else.
 */
export const DRAFT_TTL_DAYS = 7;
/**
 * HELD WRITES: how many a shadow-mode turn may stage on one item row, and how many
 * characters of each call's arguments are kept (F-910).
 *
 * A shadow turn does not write to Jira, Confluence or the approval inbox; it records what
 * it WOULD have done so a human can read it in the Agents tab. Twenty is the same order as
 * `JOB_DEFAULT_MAX_WRITES_PER_RUN`, so a turn cannot propose more than it could have
 * performed, and 300 characters of arguments is enough to say which issue and which value
 * without letting one field edit carry a 30 KB description into a row KVS must accept.
 */
export const VA_HELD_WRITES_MAX = 20;
export const VA_HELD_WRITE_ARGS_MAX_CHARS = 300;
/** Per-item bounds: `history[]` entries, `notes` characters, and a staged draft body. */
export const VA_HISTORY_MAX = 10;
export const VA_NOTES_MAX_CHARS = 600;
export const VA_STAGED_BODY_MAX_CHARS = 2000;
/**
 * Pinned constraints in the agent memory: how many, and how big each may be (F-423).
 *
 * THE BUDGET IS BYTES, NOT CHARACTERS (F-498). The memory cap below is measured in UTF-8
 * bytes of the stored JSON envelope, so a CHARACTER cap on the pinned half is a cap in a
 * different unit than the one that is enforced: 20 x 300 CJK characters weigh ~18 KB, more
 * than twice `VA_MEMORY_MAX_BYTES`, and after F-494 (`writeMemory` refuses `memory-full`
 * rather than cut human-pinned text) such a tenant could never write memory again.
 *
 * The arithmetic this number is chosen by: 20 x 280 = 5600 bytes of pinned content, plus
 * the array's own commas and brackets and the `text`/`constraints`/`updatedAt` key names
 * (~100 bytes) = ~5700. That is below `VA_MEMORY_COMPACT_BYTES` (6144), so a fully pinned
 * agent is not permanently in compaction, and ~2.4 KB below `VA_MEMORY_MAX_BYTES` (8192),
 * which is the prose's guaranteed room. Pinned text alone can therefore never fill the cap.
 */
export const VA_CONSTRAINTS_MAX = 20;
export const VA_CONSTRAINT_MAX_BYTES = 280;

/** Agent memory: compaction triggers at 6 KB and the compacted result is capped at 8 KB. */
export const VA_MEMORY_COMPACT_BYTES = 6144;
export const VA_MEMORY_MAX_BYTES = 8192;

/**
 * Consecutive failed ticks that turn the Agents-tab banner solid red (F-426). The
 * counter lives in its own `va_health:{agent}` row — never reconstructed by scanning
 * TTL'd receipts, which is how a banner silently stops appearing.
 */
export const VA_HEALTH_BANNER_FAILED_TICKS = 3;

/** The refusal sentence for each VA brake. ONE home, like `brakeRefusalText` above. */
export const vaRefusalText = (kind, max) => {
  if (kind === "caps-hour") return `Speech cap: this agent already posted ${max} time${max === 1 ? "" : "s"} in the last hour, so the reply stays staged. It goes out on a later tick, or you can raise "posts per hour".`;
  if (kind === "caps-day") return `Speech cap: this agent already posted ${max} time${max === 1 ? "" : "s"} today, so the reply stays staged. It goes out tomorrow, or you can raise "posts per day".`;
  if (kind === "caps-owed") return `Owed-reply cap: this agent already answered ${max} waiting human${max === 1 ? "" : "s"} in the last hour, so this answer stays staged. Owed replies have their own cap; they are not uncapped.`;
  if (kind === "items") return `Tick budget: this tick already opened ${max} item${max === 1 ? "" : "s"}. The rest stay queued for the next tick.`;
  if (kind === "attempts") return `Item parked: this item failed ${max} attempts (nothing staged, or a draft that never passed the voice rules). It stops consuming ticks until somebody looks at it.`;
  return "Virtual Administrator brake tripped.";
};

/* ------------------------------------------------------------------------
 * GENERATION META ALLOW-LIST (F-800) — ONE home for the shape of `generationMeta`.
 *
 * `generationMeta` is the PROVENANCE stamp on a static-PF step: which docs, skills,
 * memories and baked field-guide sections a generation was shown, or which recipe a
 * deterministic step came from. It is written ONLY by the rule editor (`compactMeta`
 * and the Insert-recipe button in FunctionBlock.jsx) and read ONLY for display
 * (config-view's GENERATED WITH row, the FunctionBlock provenance chips).
 *
 * Why an allow-list and not a typeof check: `normalizeStep` (src/listeners.js) is a
 * field-by-field normaliser — `endpoint` is a 500-char string, `code` is length-capped,
 * ids and names are clamped, unknown keys are dropped — and `generationMeta` was the one
 * field assigned WHOLESALE from caller JSON behind `typeof === "object"`. That is the
 * hole in the bound that makes a `listener:*` / `job:*` row reviewable: "what can be in
 * this row is a closed list somebody wrote" was true of every field except this one, and
 * the Rules REST API lets a caller fill it with arbitrary nested JSON up to the KVS value
 * cap — including a bearer token or a provider key, under a field name no ceiling
 * inspects. Provenance is DISPLAY data; it never needs nesting, so it does not get any.
 *
 * The shape below is DERIVED from the two writers, not invented, so a real editor-saved
 * step survives byte-identical (the emit order matches `compactMeta`'s object literal):
 *   codegen/fix — { appliedDocs[{id,title}], appliedSkills[{id,name,auto}],
 *                   appliedMemories:number, truncatedDocs[{title}], fieldGuide[ids] }
 *   recipe      — { source:"recipe", recipeKey, recipeLabel, recipeParams{flat} }
 * `appliedDocs[].id` is NULLABLE on purpose: the "(inline context)" pseudo-doc the
 * backend appends carries `id: null`, and dropping it would change a real shape.
 *
 * Anything not named here is DROPPED — including every nested object or array, which is
 * what makes "a credential cannot ride in here" a property of the code rather than a
 * hope about field names. Callers: `normalizeStep` (listeners + scheduled jobs, one
 * home). `src/shared/rule-portability.js` does not carry generationMeta at all; keep it
 * that way rather than adding a second copy of this list.
 * ---------------------------------------------------------------------- */

/** Every cap the generationMeta allow-list applies. Named so a change is reviewable. */
export const GENERATION_META_LIMITS = Object.freeze({
  maxAppliedDocs: 16,      // selectedDocIds caps at 10, +auto-match, +the inline pseudo-doc
  maxAppliedSkills: 16,    // manual <=4 + auto <=2 today; headroom without being unbounded
  maxTruncatedDocs: 16,    // a subset of appliedDocs, so the same ceiling
  maxFieldGuide: 12,       // the one home: FunctionBlock's compactMeta imports this (F-816)
  maxIdChars: 100,         // doc/skill ids are ~30 chars; this is a bound, not a fit
  maxTitleChars: 200,      // the CEILING on caller/legacy titles. The editor writes far
                           // shorter (EDITOR_TITLE_CHARS=40 in FunctionBlock, held under
                           // this by Math.min) — two numbers on purpose, not drift.
  maxSourceChars: 40,
  maxRecipeKeyChars: 120,
  maxRecipeLabelChars: 200,
  maxRecipeParams: 20,     // the largest premade recipe's param list, with headroom
  maxRecipeParamKeyChars: 60,
  maxRecipeParamValueChars: 500,
  maxAppliedMemories: 10000, // a count, not an id — clamped so it cannot be Infinity/NaN
});

const gmStr = (v, max) => (typeof v === "string" ? v.slice(0, max) : undefined);

/** A scalar that may ride in recipeParams. Objects/arrays/null are NOT scalars — dropped. */
const gmScalar = (v, maxChars) => {
  if (typeof v === "string") return v.slice(0, maxChars);
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "boolean") return v;
  return undefined;
};

/**
 * Clamp a caller-supplied `generationMeta` down to the allow-list above.
 *
 * Returns `null` when the input is not a plain object or when NOTHING known survives —
 * so a step whose meta was pure junk carries no `generationMeta` key at all, rather than
 * an empty object that reads like real-but-empty provenance. Never throws: a bad
 * provenance stamp must not fail a save of an otherwise valid rule (the code, the
 * events and the brakes are the load-bearing parts; this is a display chip).
 */
export function normalizeGenerationMeta(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const L = GENERATION_META_LIMITS;
  const out = {};

  // --- recipe provenance (emit order matches the Insert-recipe writer) ---
  const source = gmStr(input.source, L.maxSourceChars);
  if (source !== undefined) out.source = source;
  const recipeKey = gmStr(input.recipeKey, L.maxRecipeKeyChars);
  if (recipeKey !== undefined) out.recipeKey = recipeKey;
  const recipeLabel = gmStr(input.recipeLabel, L.maxRecipeLabelChars);
  if (recipeLabel !== undefined) out.recipeLabel = recipeLabel;
  if (input.recipeParams && typeof input.recipeParams === "object" && !Array.isArray(input.recipeParams)) {
    const params = {};
    let n = 0;
    for (const [k, v] of Object.entries(input.recipeParams)) {
      if (n >= L.maxRecipeParams) break;
      const val = gmScalar(v, L.maxRecipeParamValueChars);
      if (val === undefined) continue; // a nested object under a param name never lands
      params[String(k).slice(0, L.maxRecipeParamKeyChars)] = val;
      n++;
    }
    if (n > 0) out.recipeParams = params;
  }

  // --- codegen/fix provenance (emit order matches compactMeta's literal) ---
  if (Array.isArray(input.appliedDocs)) {
    out.appliedDocs = input.appliedDocs.slice(0, L.maxAppliedDocs).map((d) => {
      const e = {};
      if (d && typeof d === "object" && !Array.isArray(d)) {
        // `id: null` is the "(inline context)" pseudo-doc — a real shape, kept as null.
        if (typeof d.id === "string") e.id = d.id.slice(0, L.maxIdChars);
        else if (d.id === null) e.id = null;
        const t = gmStr(d.title, L.maxTitleChars);
        if (t !== undefined) e.title = t;
      }
      return e;
    });
  }
  if (Array.isArray(input.appliedSkills)) {
    out.appliedSkills = input.appliedSkills.slice(0, L.maxAppliedSkills).map((s) => {
      const e = {};
      if (s && typeof s === "object" && !Array.isArray(s)) {
        if (typeof s.id === "string") e.id = s.id.slice(0, L.maxIdChars);
        else if (s.id === null) e.id = null;
        const n = gmStr(s.name, L.maxTitleChars);
        if (n !== undefined) e.name = n;
        // compactMeta always emits a boolean here, so the clamped shape does too.
        e.auto = s.auto === true;
      }
      return e;
    });
  }
  if (typeof input.appliedMemories === "number" && Number.isFinite(input.appliedMemories)) {
    out.appliedMemories = Math.min(L.maxAppliedMemories, Math.max(0, Math.floor(input.appliedMemories)));
  }
  if (Array.isArray(input.truncatedDocs)) {
    // Title only — compactMeta drops the id here, so carrying one would be inventing a field.
    out.truncatedDocs = input.truncatedDocs.slice(0, L.maxTruncatedDocs).map((d) => {
      const e = {};
      const t = gmStr(d && typeof d === "object" && !Array.isArray(d) ? d.title : undefined, L.maxTitleChars);
      if (t !== undefined) e.title = t;
      return e;
    });
  }
  if (Array.isArray(input.fieldGuide)) {
    const ids = [];
    for (const id of input.fieldGuide) {
      if (ids.length >= L.maxFieldGuide) break;
      if (typeof id === "string" || typeof id === "number") ids.push(String(id).slice(0, L.maxIdChars));
    }
    out.fieldGuide = ids;
  }

  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Clamp the `generationMeta` of every step in a `functions` array — F-801.
 *
 * Pure, idempotent and byte-stable: a step whose meta already has the shape the
 * UI's compactMeta emits comes back with the same keys in the same order, and a
 * step carrying no `generationMeta` key is returned as the SAME object, so this
 * can sit on a hot write path without rewriting clean rows.
 *
 * Nothing else about a step is touched here. Code, endpoint and names are
 * clamped by their own owners (the register resolvers for workflow rules,
 * normalizeStep in src/listeners.js for job/listener steps).
 */
export function normalizeFunctionsForStorage(functions) {
  if (!Array.isArray(functions)) return functions;
  return functions.map((f) => {
    if (!f || typeof f !== "object" || Array.isArray(f)) return f;
    if (f.generationMeta === undefined) return f;
    const gm = normalizeGenerationMeta(f.generationMeta);
    // Assigning an EXISTING key keeps its original position in the object, so a
    // clean step re-serialises byte-identically.
    const out = { ...f, generationMeta: gm };
    if (gm === null) delete out.generationMeta;
    return out;
  });
}
