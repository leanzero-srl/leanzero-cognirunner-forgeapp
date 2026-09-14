/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */
/* ═══════════════════════════════════════════════════════════════════════════════
 * F-688 LIVE — THE SWEEP'S MULTI-PAGE PATH, ON A REAL TENANT, THROUGH THE REAL DOOR.
 *
 * Everything F-673/F-674/F-676/F-677/F-682/F-683 built into `sweepHarnessFaults` — the
 * base64 resume token wrapping a REAL Forge KVS cursor, the paced deletes, the progress
 * guarantee, `complete = !truncated && failed === 0` — engages only once the
 * `harness_fault:` keyspace is bigger than ONE PAGE of 100. Until `plantHarnessFaults`
 * (F-688) there was no way to get there on a tenant: the arming levers write one row per
 * path/provider. Every resume assertion in this repo was therefore offline-only, against
 * `lib/mock-kvs.mjs`, whose cursor is a plain key string — which is precisely the thing a
 * live run can disprove.
 *
 * This driver plants ballast and drains it, recording the fields an operator would act on:
 *
 *   1. PLANT 200 expired rows AS A POPULATION, WALL-CLOCKED — F-696 gave the lever the
 *      sweep's own contract (a budget, a `startIndex`, a `nextIndex`), so this is a LOOP:
 *      POST, then resume on `startIndex: nextIndex` until the rows are actually there. The
 *      total across calls must be 200 and `reason:"writes-failed"` is a FAILURE, never a
 *      resume. A fresh call is capped at `HARNESS_FAULT_PLANT_CALL_MAX` (150) and — F-710 —
 *      is clamped SILENTLY and still answered `complete:true`, so the loop counts ROWS and
 *      does not believe that flag; the clamp is recorded as N/V, not failed. If the plant
 *      cannot be reached the count is recovered through a dry-run sweep.
 *   2. A DRY-RUN sweep lists them. The two truncation flags are independent and both are
 *      recorded verbatim: `truncated` (the sweep STOPPED — budget or page cap) and
 *      `rowsTruncated` (the COUNTERS are whole, the `rows` LIST was capped at 200).
 *   3. A REAL sweep with `maxMs:15000` answers PARTIALLY under the F-677 pacing (~225
 *      deletes per call is the estimate the fix was written to). `deleted`, `failed`,
 *      `truncated`, `reason` and the cursor are recorded; the cursor is DECODED LOCALLY to
 *      prove it is our base64 token AND that its inner `c` is a real, non-null Forge cursor
 *      string rather than the offline mock's key — the one claim no offline suite can make.
 *   4. RESUME with that token until `complete:true`, THROUGH `lib/sweep-drain.mjs` — the one
 *      home of the drain (F-690 for the decision, F-702 for the loop). Finishedness is READ
 *      from `complete`, the `deletes-failing` back-off is the published 500/1000/2000, a
 *      byte-identical answer is named as the spin it is, and `deletes-failed` earns exactly
 *      one resume. The per-call counters are kept, the total `deleted` is compared against
 *      what was planted, and a final dry run must show zero planted rows left.
 *   5. `clearPlantedFaults` on an already-empty keyspace is a NO-OP: `deleted:0`,
 *      `complete:true`.
 *
 * ⚠️ BLAST RADIUS — AND WHY IT IS NOT THE ONE THE FAULT DRIVERS CARRY.
 * This driver arms NO fault. Planted rows live under the kind `plant`, and nothing in the
 * app reads that kind: every consumer names its kind exactly (`HARNESS_FAULT_KEY_READ`,
 * `HARNESS_FAULT_JIRA`, `HARNESS_FAULT_GIT_DISPATCH`, `HARNESS_FAULT_HOOK_PROMOTE`), and
 * the only enumeration anywhere is the sweep, which only DELETES. A planted row occupies
 * the keyspace and bites nothing — no admin sees a refused key read, no rule author sees an
 * empty people picker. That is what licenses 200 rows here where the dangerous levers are
 * capped at one, and it is why this file is not in `requireEnvAck`'s cohort.
 *
 * What it DOES do on a shared tenant is delete EXPIRED fault rows belonging to whoever else
 * is on it — which is the sweep's designed cleanup, not a side effect, and it never touches
 * a live lever. The plant is still capped at 200 and cleared in a `finally` on every path.
 *
 * READ-ONLY on src/ and static/. It never deploys. Every sentence and every payload —
 * console and disk alike — goes through `redactSecrets`/`redactString`, no row KEY is ever
 * recorded (a fault key carries the faulted path or provider), and the resume cursor is
 * recorded only as a length and a four-character head.
 *
 *   node scripts/plant-sweep-live.mjs --env=dev --i-know-dev-is-shared
 * ═══════════════════════════════════════════════════════════════════════════════ */
import { requireEnvAck } from "../lib/shared-env-guard.mjs";
import fs from "node:fs";
import { loadEnv, requireEnv } from "../lib/env.mjs";
import { redactString, redactSecrets } from "../lib/redact.mjs";
import { drainSweep, answerComplete } from "../lib/sweep-drain.mjs";

const argv = process.argv.slice(2);
const arg = (n, d) => { const h = argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
/* This driver arms NO fault — it plants inert ballast and sweeps EXPIRED rows, never a
 * live lever — so `faults` is empty and the harm sentences do not apply. It does WRITE,
 * though: `plantHarnessFaults` puts rows in the shared app store and the sweep deletes
 * them again, which is `mutates: ["kvs"]` and is now what earns the refusal on its own
 * (F-718). It used to ask with `requireAck: true` while drivers that DELETED a virtual
 * agent asked for nothing — the ack was drawn at arming instead of at mutating, and this
 * file was the exception that made the rule look wrong. The refusal text has never lived
 * here: an inline `console.error` was the second home F-686 was cut for. */
const { envName: ENV_NAME, hookUrl: HOOK_URL } = requireEnvAck(argv, {
  faults: [],
  mutates: ["kvs"],
  defaultEnv: "staging",
  script: "plant-sweep-live.mjs",
});
const env = loadEnv();
const SECRET = requireEnv("HARNESS_SECRET");

/** The plant size. 200 = two full sweep pages, inside the 25 s trigger, under the 500 cap. */
const N = Math.max(1, Math.min(200, Number(arg("n", "200")) || 200));
/** The bound on the resume loop. A drain that needs more than this is a finding, not a retry. */
const MAX_RESUME_CALLS = 10;
/** The bound on the PLANT resume loop (F-696). 200 rows at a 150-row call cap is two calls. */
const MAX_PLANT_CALLS = 10;
const PLANT_PREFIX = "harness_fault:plant:";

const OUT = new URL("../results/plant-sweep", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passes = 0, fails = 0, unproven = 0;
const ev = { at: new Date().toISOString(), env: ENV_NAME, n: N, checks: [] };
const R = (d) => redactSecrets(d);
const J = (d) => JSON.stringify(R(d));
const say = (v, s, d) => { ev.checks.push({ v, s: redactString(String(s)), ...(d ? { d: R(d) } : {}) }); console.log(`  ${v.padEnd(5)} ${redactString(String(s))}${d ? " " + J(d) : ""}`); };
const PASS = (s, d) => { passes++; say("PASS", s, d); };
const FAIL = (s, d) => { fails++; say("FAIL", s, d); };
const NV = (s, d) => { unproven++; say("N/V", s, d); };
const step = (s) => console.log(`\n── ${s}`);

const readRes = async (res) => { let t = ""; try { t = await res.text(); } catch { return { status: 0, json: null }; } let j = null; try { j = JSON.parse(t); } catch {} return { status: res.status, json: j, text: t }; };
const hook = async (body) => readRes(await fetch(HOOK_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + SECRET }, body: JSON.stringify(body) }));

const plant = (n, expired, startIndex) => hook({ action: "plantHarnessFaults", n, expired, ...(startIndex ? { startIndex } : {}) });
const sweep = (body) => hook({ action: "sweepHarnessFaults", ...body });
const clear = (cursor) => hook({ action: "clearPlantedFaults", ...(cursor ? { cursor } : {}) });

/*
 * A sweep answer, reduced to what may be recorded. NEVER the rows themselves: a
 * `harness_fault:` key carries the faulted PATH or PROVIDER in its tail. The planted rows
 * are counted by PREFIX so "did my ballast go" is answerable without naming a key.
 */
const shape = (j) => ({
  scanned: j?.scanned ?? null, deleted: j?.deleted ?? null, failed: j?.failed ?? null,
  truncated: j?.truncated ?? null, reason: j?.reason ?? null, complete: j?.complete ?? null,
  budgetMs: j?.budgetMs ?? null, rowsTruncated: j?.rowsTruncated ?? null,
  rowsListed: (j?.rows || []).length,
  plantedRows: (j?.rows || []).filter((r) => String(r.key || "").startsWith(PLANT_PREFIX)).length,
  plantedExpired: (j?.rows || []).filter((r) => String(r.key || "").startsWith(PLANT_PREFIX) && r.expired === true).length,
  otherRows: (j?.rows || []).filter((r) => !String(r.key || "").startsWith(PLANT_PREFIX)).length,
  otherExpired: (j?.rows || []).filter((r) => !String(r.key || "").startsWith(PLANT_PREFIX) && r.expired === true).length,
  hasCursor: typeof j?.cursor === "string" && j.cursor.length > 0,
});

/*
 * THE CLAIM NO OFFLINE SUITE CAN MAKE. `encodeSweepCursor` wraps the KVS cursor as
 * base64(`{"c": <cursor|null>}`); the offline mock's cursor is a plain key string, so only a
 * live run can say whether a REAL Forge cursor round-trips through that token. Decoded here,
 * locally, and recorded MASKED — length plus a four-character head — because an opaque KVS
 * cursor may encode a key and the keys here carry faulted paths.
 */
const decodeCursor = (token) => {
  if (typeof token !== "string" || !token) return { present: false };
  const grammar = /^[A-Za-z0-9+/=_-]+$/.test(token) && !token.includes("..") && token.length <= 2048;
  let inner, parsed = null;
  try { parsed = JSON.parse(Buffer.from(token, "base64").toString("utf8")); } catch { return { present: true, grammar, decodable: false }; }
  inner = parsed && typeof parsed === "object" && "c" in parsed ? parsed.c : undefined;
  return {
    present: true, grammar, decodable: true,
    tokenLength: token.length,
    hasCKey: parsed && typeof parsed === "object" && "c" in parsed,
    innerType: inner === null ? "null" : typeof inner,
    innerIsRealCursor: typeof inner === "string" && inner.length > 0,
    innerLength: typeof inner === "string" ? inner.length : null,
    innerHead: typeof inner === "string" ? inner.slice(0, 4) : null,
  };
};

/*
 * F-702 — THE DRAIN LEDGER STORES A STRING, NEVER THE DECODED OBJECT.
 *
 * The per-call ledger used to be seeded with `{ call: 1, ...ev.firstReal }`, commented as
 * "a COPY". A spread is SHALLOW: `cursor` stayed the very same object that
 * `ev.firstReal.cursor` already referenced, so `redactSecrets` — which is cycle-safe by
 * WeakSet — met it a second time and wrote `[CIRCULAR]` into the evidence file. Call 1's
 * cursor, the one field this driver exists to prove, was erased from the drain ledger by the
 * guard against cycles.
 *
 * So the ledger records a freshly built SENTENCE instead. It carries the same masked facts
 * (a length and a four-character head — an opaque KVS cursor may encode a key, and the keys
 * here carry faulted paths) and it is a new primitive every time, so no two entries can
 * share a reference.
 */
const cursorNote = (rcur) => {
  if (!rcur || rcur.present !== true) return "none";
  if (rcur.decodable !== true) return `opaque, not decodable (grammar ${rcur.grammar})`;
  const head = rcur.innerHead ? `, head "${rcur.innerHead}"` : "";
  const innerLen = rcur.innerLength === null || rcur.innerLength === undefined ? "" : ` len ${rcur.innerLength}`;
  return `token len ${rcur.tokenLength}, c:${rcur.innerType}${innerLen}${head}`;
};

const ok200 = (res) => res.status === 200 && res.json?.ok === true;

/*
 * THE PLANT, AS A POPULATION RATHER THAN A CALL (F-696 / F-710).
 *
 * `plantHarnessFaults` cannot write its documented 500-row maximum inside the web trigger:
 * at `KVS_DELETE_BATCH`=3 / `KVS_DELETE_PAUSE_MS`=200 that is 33.2 s of pure sleep in a 25 s
 * invocation. F-696 gave the lever the sweep's contract — a budget, a `startIndex` and a
 * `nextIndex` — so REACHING a population is a loop, exactly as draining one is. This driver
 * asked for its 200 rows in a single call and asserted `planted === 200`, which is why it is
 * red on `main` today.
 *
 * TWO TRAPS THIS LOOP IS WRITTEN AROUND:
 *   · `complete: true` DOES NOT MEAN "the population you asked for exists" (F-710). A fresh
 *     call asking for more than `HARNESS_FAULT_PLANT_CALL_MAX` (150) is clamped SILENTLY and
 *     answered `complete: true, n: 150, nextIndex: 150`. A loop that trusts `complete` stops
 *     at 150 believing it planted 200. So the loop runs until THE ROWS ARE THERE —
 *     `totalPlanted >= n` — and `complete` is permission to stop only once they are. The
 *     clamp is RECORDED against F-710 (which is filed against the answer's silence, not
 *     against this driver) and is explicitly NOT a failure here.
 *   · `reason: "writes-failed"` is a FAILURE, not a resume. The store refused writes, the
 *     population is short by an amount nothing will make up, and every assertion downstream
 *     would be measuring a keyspace nobody planted.
 */
const plantPopulation = async (n, expired) => {
  const calls = [];
  let startIndex = 0, totalPlanted = 0, totalFailed = 0;
  let planted = false, stopReason = null, clamped = null;
  while (calls.length < MAX_PLANT_CALLS) {
    const res = await plant(n, expired, startIndex);
    const nth = calls.length + 1;
    if (!ok200(res)) { stopReason = `plant call ${nth} did not answer 200/ok (HTTP ${res.status})`; break; }
    const j = res.json;
    calls.push({
      call: nth, n: j.n ?? null, startIndex: j.startIndex ?? null, planted: j.planted ?? null,
      failed: j.failed ?? null, nextIndex: j.nextIndex ?? null, truncated: j.truncated ?? null,
      reason: j.reason ?? null, complete: j.complete ?? null, expired: j.expired ?? null,
      ttlSeconds: j.ttlSeconds ?? null, budgetMs: j.budgetMs ?? null,
      keysReturned: (j.keys || []).length,
    });
    totalPlanted += Number(j.planted || 0);
    totalFailed += Number(j.failed || 0);
    /* F-710 — the ONLY way a caller can see the silent clamp is to compare its own request
       against the `n` it was answered back. Neither shipped helper made that comparison. */
    if (nth === 1 && Number(j.n) < n) {
      clamped = { requested: n, answered: Number(j.n), nextIndex: j.nextIndex ?? null, complete: j.complete ?? null };
    }
    if (j.reason === "writes-failed") {
      stopReason = `plant call ${nth} answered reason:"writes-failed" (planted ${j.planted}, failed ${j.failed}) — the store refused writes, so the population is short and nothing downstream may be asserted over it`;
      break;
    }
    if (totalPlanted >= n) { planted = true; break; }
    const next = Number(j.nextIndex);
    if (!Number.isFinite(next) || next <= startIndex) {
      stopReason = `plant call ${nth} answered complete=${j.complete} with only ${totalPlanted}/${n} row(s) planted and no advancing nextIndex (${JSON.stringify(j.nextIndex ?? null)}) — the population cannot be reached`;
      break;
    }
    startIndex = next;
  }
  if (!planted && !stopReason) stopReason = `the plant was still ${totalPlanted}/${n} after the ${MAX_PLANT_CALLS}-call bound`;
  return { planted, stopReason, calls, totalPlanted, totalFailed, clamped };
};

async function main() {
  console.log(`\nPLANT + SWEEP — env=${ENV_NAME}  n=${N}`);

  /* ── 0 · BASELINE. An empty result proves nothing until the query is shown to see rows at
   *      all, and the sweep deletes EXPIRED rows that are not mine — so the arithmetic in
   *      step 4 needs to know how many of those were there before I started. */
  step("0 · BASELINE — the fault keyspace before anything is planted");
  const base = await sweep({ dryRun: true });
  if (!ok200(base)) {
    FAIL(`baseline dry-run sweep did not answer 200/ok (HTTP ${base.status})`, { reason: base.json?.reason ?? null });
    return;
  }
  const baseShape = shape(base.json);
  ev.baseline = baseShape;
  PASS(`baseline dry-run sweep answered: ${baseShape.scanned} row(s) scanned`, baseShape);
  if (baseShape.plantedRows > 0) NV(`${baseShape.plantedRows} planted row(s) were ALREADY present — someone else's ballast, or a previous run's; the totals below are read against this baseline`, { plantedRows: baseShape.plantedRows });

  /* ── 1 · THE PLANT, RESUMED TO A POPULATION AND WALL-CLOCKED (F-696 / F-710). */
  step(`1 · PLANT ${N} expired rows, resuming on startIndex until the rows are there`);
  const t0 = Date.now();
  const p = await plantPopulation(N, true);
  const plantMs = Date.now() - t0;
  const lastPlant = p.calls[p.calls.length - 1] || null;
  ev.plant = {
    ms: plantMs, calls: p.calls.length, totalPlanted: p.totalPlanted, totalFailed: p.totalFailed,
    perCall: p.calls, ...(p.clamped ? { clampedFirstCall: p.clamped } : {}),
    ...(p.stopReason ? { stopReason: p.stopReason } : {}),
  };
  if (!p.planted) {
    FAIL(`the plant did not reach ${N} rows — ${p.stopReason}`, ev.plant);
    /* An unreached population is still a population: recover the count by a SECOND READ so
     * the operator is not left with the "unknown number of rows" F-696 is about. */
    const recover = await sweep({ dryRun: true });
    if (ok200(recover)) NV(`count recovered by dry-run sweep instead: ${shape(recover.json).plantedRows} planted row(s) visible`, shape(recover.json));
    return;
  }
  /* THE ASSERTION IS THE TOTAL ACROSS CALLS, not one call's `planted` — that is the whole
   * F-696 contract, and asserting a single call's count is what made this driver red. */
  if (p.totalPlanted === N && p.totalFailed === 0) {
    PASS(`planted ${p.totalPlanted}/${N} rows across ${p.calls.length} call(s), 0 failed, in ${plantMs} ms`, { ms: plantMs, calls: p.calls.length, totalPlanted: p.totalPlanted });
  } else if (p.totalFailed > 0) {
    FAIL(`the plant totalled ${p.totalPlanted}/${N} rows with ${p.totalFailed} failed write(s) across ${p.calls.length} call(s)`, ev.plant);
  } else {
    /* Over-planting is not possible (the keys are `i`-derived and idempotent), so this is
       only reachable as an under-count that the loop somehow called done. */
    FAIL(`the plant totalled ${p.totalPlanted} rows for n=${N}`, ev.plant);
  }
  /* F-710, RECORDED AND NOT FAILED. The clamp is the lever's silence, not this driver's bug:
   * a fresh call over `HARNESS_FAULT_PLANT_CALL_MAX` is cut to 150 and still answered
   * `complete: true`. The loop above survives it by counting rows instead of trusting the
   * flag; the row stays filed because a caller who does trust the flag still gets 150. */
  if (p.clamped) {
    NV(`the first plant call was CLAMPED SILENTLY: asked for n=${p.clamped.requested}, answered n=${p.clamped.answered} with complete=${p.clamped.complete} (F-710) — this run reached ${N} only by resuming on startIndex and counting rows rather than believing \`complete\``, p.clamped);
  }
  if (lastPlant && lastPlant.expired !== true) FAIL("the plant did not report expired:true — the rows are LIVE and the sweep will not delete them", ev.plant);

  /* ── 2 · THE DRY RUN. Both truncation flags, recorded verbatim. */
  step("2 · DRY-RUN sweep — does it list the ballast, and what does it say about its own limits");
  const dry = await sweep({ dryRun: true });
  if (!ok200(dry)) { FAIL(`dry-run sweep did not answer 200/ok (HTTP ${dry.status})`, { reason: dry.json?.reason ?? null }); }
  else {
    const d = shape(dry.json);
    ev.dryRun = { ...d, cursor: decodeCursor(dry.json.cursor) };
    const expectedPlanted = baseShape.plantedRows + N;
    if (d.scanned >= expectedPlanted) PASS(`dry run scanned ${d.scanned} row(s), at least the ${expectedPlanted} expected`, d);
    else FAIL(`dry run scanned only ${d.scanned} row(s) — fewer than the ${expectedPlanted} that should exist`, d);
    if (d.deleted === 0) PASS("dry run deleted nothing, as a dry run must", { deleted: d.deleted });
    else FAIL(`dry run DELETED ${d.deleted} row(s)`, d);
    if (d.plantedRows > 0 && d.plantedExpired === d.plantedRows) PASS(`every planted row in the list carries expired:true (${d.plantedExpired}/${d.plantedRows})`, d);
    else FAIL(`planted rows in the list: ${d.plantedRows}, of which expired:true: ${d.plantedExpired}`, d);
    /* The row LIST caps at 200 while the COUNTERS keep counting — the two flags are
     * independent and an assertion derived from `rows` is only whole when rowsTruncated
     * is false. Recorded either way rather than asserted into a shape it may not have. */
    const listCapHonest = d.rowsListed <= 200 && (d.rowsTruncated === true) === (d.scanned > d.rowsListed);
    if (listCapHonest) PASS(`both flags reported honestly: rowsListed=${d.rowsListed} rowsTruncated=${d.rowsTruncated} against counters scanned=${d.scanned}; truncated=${d.truncated} reason=${d.reason}`, d);
    else FAIL(`the list cap and the counters disagree: rowsListed=${d.rowsListed} rowsTruncated=${d.rowsTruncated} scanned=${d.scanned}`, d);
  }

  /* ── 3 · THE REAL SWEEP, ONE CALL, 15 s. Expected to be PARTIAL under the F-677 pacing. */
  step("3 · REAL sweep, maxMs:15000 — the partial answer and the resume token");
  const first = await sweep({ maxMs: 15000 });
  if (!ok200(first)) { FAIL(`real sweep did not answer 200/ok (HTTP ${first.status})`, { reason: first.json?.reason ?? null, code: first.json?.code ?? null }); }
  else {
    const s = shape(first.json);
    const rcur = decodeCursor(first.json.cursor);
    ev.firstReal = { ...s, cursor: rcur };
    PASS(`real sweep call 1: deleted=${s.deleted} failed=${s.failed} truncated=${s.truncated} reason=${s.reason} complete=${s.complete} budgetMs=${s.budgetMs}`, ev.firstReal);
    if (s.failed > 0) NV(`${s.failed} delete(s) FAILED on call 1 — this is the F-677 pacing evidence; forge logs must carry the matching RATE_LIMIT lines`, s);
    /* F-702 — "is there more to do" is READ from the library's `complete`, never re-derived
     * from `truncated` here. The two coincide on every answer the current library can emit
     * (`failed > 0` implies `truncated`), which is exactly why a private derivation is
     * dangerous: it agrees right up until the answer is reshaped, and then this driver's
     * verdict moves and the other drain driver's does not. */
    if (!answerComplete(first.json)) {
      if (rcur.present && rcur.decodable && rcur.hasCKey) PASS("the partial answer carries OUR base64 token, decodable, with a `c` key (F-674: never null while work remains)", rcur);
      else FAIL("the partial answer's cursor is not a decodable token of ours", rcur);
      if (rcur.innerIsRealCursor) PASS(`and its inner \`c\` is a REAL non-null Forge cursor string (len ${rcur.innerLength}, head "${rcur.innerHead}") — the claim no offline suite can make`, rcur);
      else NV(`its inner \`c\` is ${rcur.innerType}, not a cursor string — the sweep stopped at a page boundary with nothing more to fetch`, rcur);
    } else {
      NV(`the sweep FINISHED in one call (complete:${s.complete}, truncated:${s.truncated}) — ${N} rows fitted inside the 15 s budget, so the multi-call resume path is not exercised by this run`, s);
    }
  }

  /* ── 4 · THE DRAIN. Bounded, and it backs off on the one reason that says "not converging". */
  step(`4 · RESUME until complete — bounded at ${MAX_RESUME_CALLS} calls`);
  /* F-702 — THE DRAIN IS `lib/sweep-drain.mjs`'s, NOT THIS FILE'S. This loop used to be hand
   * rolled beside the pure function it ignored: it re-derived finishedness from `truncated`
   * (the derivation F-692 deprecates now that `complete` exists), backed off a flat 1 s
   * instead of the published 500/1000/2000, and had neither byte-identical detection nor the
   * `deletes-failed`-resumed-once rule — so the SAME refusing store answered "still not
   * complete after 10 resume call(s)" here and a named `not-converging` in
   * `harness-fault-expiry-live.mjs`. Call 1 is handed to the library as `first` so it is
   * decided and counted exactly like the resumes it seeds. */
  const calls = [];
  let totalDeleted = 0, totalFailed = 0;
  const d = await drainSweep((cursor) => sweep({ maxMs: 15000, cursor }), {
    maxCalls: MAX_RESUME_CALLS + 1,   // + the call step 3 already made
    first: ok200(first) ? first.json : null,
    onAnswer: (json, call) => {
      const s = shape(json);
      /* The token as a STRING, built fresh here: a shallow spread of the decoded object put
         the same reference in twice and the redactor wrote `[CIRCULAR]` over it. */
      calls.push({ call, ...s, cursor: cursorNote(decodeCursor(json.cursor)) });
      totalDeleted += Number(s.deleted || 0);
      totalFailed += Number(s.failed || 0);
    },
  });
  ev.drain = {
    calls, sweepCalls: d.calls, resumeCalls: Math.max(0, d.calls - 1), pausedMs: d.pausedMs,
    totalDeleted, totalFailed, complete: d.drained, ...(d.stopReason ? { stopReason: d.stopReason } : {}),
  };
  if (d.drained) PASS(`drained to complete:true in ${d.calls} sweep call(s), ${d.pausedMs} ms of back-off: deleted=${totalDeleted} failed=${totalFailed}`, { calls: d.calls, pausedMs: d.pausedMs, totalDeleted, totalFailed });
  else FAIL(`drain did not reach complete:true — ${d.stopReason}`, ev.drain);
  /* The sweep deletes EVERY expired row, not only mine, so the baseline's own expired rows
   * are part of the expected total. A resumed sweep may re-LIST a page it already cleaned
   * but never re-deletes a gone row, so this total cannot over-count. */
  const expectedDeleted = N + baseShape.otherExpired + baseShape.plantedRows;
  if (totalDeleted === expectedDeleted) PASS(`total deleted ${totalDeleted} == ${N} planted + ${baseShape.otherExpired} pre-existing expired + ${baseShape.plantedRows} pre-existing planted`, { totalDeleted, expectedDeleted });
  else if (totalDeleted >= N) NV(`total deleted ${totalDeleted} vs ${expectedDeleted} expected — the planted 200 are covered, the difference is the shared tenant's own rows moving under the run (the 60 s platform TTL reaps planted rows lazily too)`, { totalDeleted, expectedDeleted, baselineOtherExpired: baseShape.otherExpired });
  else FAIL(`total deleted ${totalDeleted} is FEWER than the ${N} rows planted`, { totalDeleted, expectedDeleted });

  step("4b · SECOND READ — a dry run must now show no planted row and nothing expired");
  const after = await sweep({ dryRun: true });
  if (!ok200(after)) FAIL(`post-drain dry run did not answer 200/ok (HTTP ${after.status})`, { reason: after.json?.reason ?? null });
  else {
    const a = shape(after.json);
    ev.afterDrain = a;
    if (a.plantedRows === 0) PASS("no planted row remains in the keyspace", a);
    else FAIL(`${a.plantedRows} planted row(s) still present after the drain`, a);
    if (a.plantedExpired === 0 && a.otherExpired === 0) PASS("and no expired row of any kind remains", a);
    else NV(`${a.otherExpired} expired row(s) not mine remain — armed by another driver between the sweep and this read`, a);
  }

  /* ── 5 · THE NO-OP. A clear against an empty keyspace answers complete, deletes nothing. */
  step("5 · clearPlantedFaults on an ALREADY-EMPTY planted keyspace");
  const noop = await clear(null);
  if (!ok200(noop)) FAIL(`clearPlantedFaults did not answer 200/ok (HTTP ${noop.status})`, { reason: noop.json?.reason ?? null });
  else {
    const c = { scanned: noop.json.scanned, deleted: noop.json.deleted, failed: noop.json.failed, truncated: noop.json.truncated, reason: noop.json.reason, complete: noop.json.complete, hasCursor: Boolean(noop.json.cursor) };
    ev.clearNoop = c;
    if (c.deleted === 0 && c.failed === 0 && c.complete === true && c.hasCursor === false) PASS("no-op: deleted=0 failed=0 complete=true cursor=null", c);
    else FAIL(`clear on an empty keyspace answered deleted=${c.deleted} failed=${c.failed} complete=${c.complete}`, c);
  }
}

/* CLEANUP IS PART OF THE PROOF. The clear is bound to `harness_fault:plant:` in the library —
 * no caller names the keyspace an unconditional delete walks — so this can never reach a live
 * lever, and it runs on every path including the throw. */
const cleanup = async () => {
  step("CLEANUP · clear the ballast, whatever happened above");
  /* F-702 — the SECOND hand-rolled loop in this file, and the one that read `complete === true
   * || truncated !== true`: an OR whose right arm calls a `deletes-failing` page finished the
   * moment the library stops setting `truncated`. `clearPlantedFaults` answers through the
   * same `sweepAnswerTail` as the sweep, so it obeys the same drain. */
  let deleted = 0;
  const d = await drainSweep((cursor) => clear(cursor), {
    maxCalls: MAX_RESUME_CALLS,
    onAnswer: (json) => { deleted += Number(json.deleted || 0); },
  });
  if (!d.drained && d.calls === 0) {
    FAIL(`cleanup clear did not answer 200/ok — PLANTED ROWS MAY REMAIN (their own 60 s TTL is then the only bound): ${d.stopReason}`, { stopReason: d.stopReason });
    return;
  }
  const verify = await sweep({ dryRun: true });
  const left = ok200(verify) ? shape(verify.json).plantedRows : null;
  ev.cleanup = { calls: d.calls, deleted, done: d.drained, pausedMs: d.pausedMs, plantedRowsLeft: left, ...(d.stopReason ? { stopReason: d.stopReason } : {}) };
  if (d.drained && left === 0) PASS(`cleanup: ${deleted} row(s) cleared in ${d.calls} call(s); a second read shows 0 planted rows left`, ev.cleanup);
  else FAIL(`cleanup incomplete: done=${d.drained}${d.stopReason ? ` (${d.stopReason})` : ""}, planted rows still visible: ${left}`, ev.cleanup);
};

main()
  .catch((e) => { FAIL(`driver threw: ${String((e && e.message) || e).slice(0, 300)}`); })
  .then(cleanup)
  .catch((e) => { FAIL(`cleanup threw: ${String((e && e.message) || e).slice(0, 300)}`); })
  .finally(() => {
    ev.summary = { passes, fails, unproven };
    fs.writeFileSync(`${OUT}/evidence.json`, JSON.stringify(redactSecrets(ev), null, 2));
    console.log(`\nPASS ${passes}  FAIL ${fails}  N/V ${unproven}  →  results/plant-sweep/evidence.json`);
    process.exit(fails > 0 ? 1 : 0);
  });
