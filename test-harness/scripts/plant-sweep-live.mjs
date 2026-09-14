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
 *   1. PLANT 200 expired rows in one call, WALL-CLOCKED. The lever has no `maxMs` and no
 *      resume (F-696, filed, not cut): at `KVS_DELETE_BATCH`=3 / `KVS_DELETE_PAUSE_MS`=200
 *      that is 67 batches and 66 mandatory pauses = 13.2 s of pure sleep before any KVS
 *      latency, inside a web trigger the platform kills at 25 s. 200 is chosen to sit
 *      inside that budget AND to leave the tenant well under the plant lever's own 500 cap.
 *      If it times out, the count is recovered through a dry-run sweep and NOTHING is filed
 *      — F-696 already covers it.
 *   2. A DRY-RUN sweep lists them. The two truncation flags are independent and both are
 *      recorded verbatim: `truncated` (the sweep STOPPED — budget or page cap) and
 *      `rowsTruncated` (the COUNTERS are whole, the `rows` LIST was capped at 200).
 *   3. A REAL sweep with `maxMs:15000` answers PARTIALLY under the F-677 pacing (~225
 *      deletes per call is the estimate the fix was written to). `deleted`, `failed`,
 *      `truncated`, `reason` and the cursor are recorded; the cursor is DECODED LOCALLY to
 *      prove it is our base64 token AND that its inner `c` is a real, non-null Forge cursor
 *      string rather than the offline mock's key — the one claim no offline suite can make.
 *   4. RESUME with that token until `complete:true` (bounded at 10 calls, backing off 1 s on
 *      `deletes-failing`, which says outright "this is not converging"). The per-call
 *      counters are kept, the total `deleted` is compared against what was planted, and a
 *      final dry run must show zero planted rows left.
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

const argv = process.argv.slice(2);
const arg = (n, d) => { const h = argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
/* This driver arms NO fault — it plants inert ballast and sweeps EXPIRED rows, never a
 * live lever — so `faults` is empty and the harm sentences do not apply. The shared tenant
 * still deserves a deliberate act, so `requireAck: true` asks the guard for the refusal
 * anyway. It used to be an inline `console.error` here: one sentence of the F-679 text
 * living in a second home, which is the whole shape F-686 was cut for. */
const { envName: ENV_NAME, hookUrl: HOOK_URL } = requireEnvAck(argv, {
  faults: [],
  requireAck: true,
  defaultEnv: "staging",
  script: "plant-sweep-live.mjs",
});
const env = loadEnv();
const SECRET = requireEnv("HARNESS_SECRET");

/** The plant size. 200 = two full sweep pages, inside the 25 s trigger, under the 500 cap. */
const N = Math.max(1, Math.min(200, Number(arg("n", "200")) || 200));
/** The bound on the resume loop. A drain that needs more than this is a finding, not a retry. */
const MAX_RESUME_CALLS = 10;
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

const plant = (n, expired) => hook({ action: "plantHarnessFaults", n, expired });
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

const ok200 = (res) => res.status === 200 && res.json?.ok === true;

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

  /* ── 1 · THE PLANT, WALL-CLOCKED (F-696 is about exactly this number). */
  step(`1 · PLANT ${N} expired rows in ONE call — wall-clocked against the 25 s trigger`);
  const t0 = Date.now();
  const planted = await plant(N, true);
  const plantMs = Date.now() - t0;
  ev.plant = { ms: plantMs, status: planted.status, planted: planted.json?.planted ?? null, failed: planted.json?.failed ?? null, expired: planted.json?.expired ?? null, ttlSeconds: planted.json?.ttlSeconds ?? null, keysReturned: (planted.json?.keys || []).length };
  if (!ok200(planted)) {
    FAIL(`plant did not answer 200/ok in ${plantMs} ms (HTTP ${planted.status}) — the lever has no partial answer, so the row count is now UNKNOWN from the response alone (F-696, already filed)`, { ms: plantMs, reason: planted.json?.reason ?? null });
    const recover = await sweep({ dryRun: true });
    if (ok200(recover)) NV(`count recovered by dry-run sweep instead: ${shape(recover.json).plantedRows} planted row(s) visible`, shape(recover.json));
    return;
  }
  if (planted.json.planted === N && planted.json.failed === 0) PASS(`planted ${planted.json.planted}/${N} rows, 0 failed, in ${plantMs} ms (inside the trigger budget)`, ev.plant);
  else FAIL(`plant returned planted=${planted.json.planted} failed=${planted.json.failed} for n=${N}`, ev.plant);
  if (planted.json.expired !== true) FAIL("the plant did not report expired:true — the rows are LIVE and the sweep will not delete them", ev.plant);

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
    if (s.truncated === true) {
      if (rcur.present && rcur.decodable && rcur.hasCKey) PASS("the partial answer carries OUR base64 token, decodable, with a `c` key (F-674: never null while work remains)", rcur);
      else FAIL("the partial answer's cursor is not a decodable token of ours", rcur);
      if (rcur.innerIsRealCursor) PASS(`and its inner \`c\` is a REAL non-null Forge cursor string (len ${rcur.innerLength}, head "${rcur.innerHead}") — the claim no offline suite can make`, rcur);
      else NV(`its inner \`c\` is ${rcur.innerType}, not a cursor string — the sweep stopped at a page boundary with nothing more to fetch`, rcur);
    } else {
      NV(`the sweep FINISHED in one call (truncated:false, complete:${s.complete}) — ${N} rows fitted inside the 15 s budget, so the multi-call resume path is not exercised by this run`, s);
    }
  }

  /* ── 4 · THE DRAIN. Bounded, and it backs off on the one reason that says "not converging". */
  step(`4 · RESUME until complete — bounded at ${MAX_RESUME_CALLS} calls`);
  const calls = ev.firstReal ? [{ call: 1, ...ev.firstReal }] : [];   // a COPY: the redactor marks a second reference to the same object [CIRCULAR], which would erase call 1 from the drain ledger
  let totalDeleted = ev.firstReal?.deleted || 0, totalFailed = ev.firstReal?.failed || 0;
  let cursor = first.json?.cursor || null;
  let complete = first.json?.complete === true, stopReason = null;
  let n = 0;
  while (!complete && typeof cursor === "string" && cursor && n < MAX_RESUME_CALLS) {
    const res = await sweep({ maxMs: 15000, cursor });
    n++;
    if (!ok200(res)) { stopReason = `resume call ${n} did not answer 200/ok (HTTP ${res.status})`; break; }
    const s = shape(res.json);
    const rcur = decodeCursor(res.json.cursor);
    calls.push({ call: n + 1, ...s, cursor: rcur });
    totalDeleted += Number(s.deleted || 0); totalFailed += Number(s.failed || 0);
    if (s.complete === true) { complete = true; break; }
    if (s.truncated !== true) { complete = s.failed === 0; stopReason = s.failed > 0 ? `call ${n + 1} answered truncated:false with failed=${s.failed}` : null; break; }
    if (s.reason === "deletes-failing") { await sleep(1000); }   // the answer that says "back off"
    cursor = res.json.cursor;
    if (typeof cursor !== "string" || !cursor) { stopReason = `call ${n + 1} answered truncated:true (reason "${s.reason}") with NO resumable cursor — the rest of the keyspace is unreachable`; break; }
  }
  if (!complete && !stopReason) stopReason = `still not complete after ${n} resume call(s)`;
  ev.drain = { calls, resumeCalls: n, totalDeleted, totalFailed, complete, ...(stopReason ? { stopReason } : {}) };
  if (complete) PASS(`drained to complete:true in ${calls.length} sweep call(s): deleted=${totalDeleted} failed=${totalFailed}`, { calls: calls.length, totalDeleted, totalFailed });
  else FAIL(`drain did not reach complete:true — ${stopReason}`, ev.drain);
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
  let cursor = null, guard = 0, deleted = 0, done = false;
  while (guard < MAX_RESUME_CALLS) {
    const res = await clear(cursor);
    guard++;
    if (!ok200(res)) { FAIL(`cleanup clear call ${guard} did not answer 200/ok (HTTP ${res.status}) — PLANTED ROWS MAY REMAIN (their own 60 s TTL is then the only bound)`, { reason: res.json?.reason ?? null }); return; }
    deleted += Number(res.json.deleted || 0);
    if (res.json.complete === true || res.json.truncated !== true) { done = true; break; }
    cursor = res.json.cursor;
    if (typeof cursor !== "string" || !cursor) break;
  }
  const verify = await sweep({ dryRun: true });
  const left = ok200(verify) ? shape(verify.json).plantedRows : null;
  ev.cleanup = { calls: guard, deleted, done, plantedRowsLeft: left };
  if (done && left === 0) PASS(`cleanup: ${deleted} row(s) cleared in ${guard} call(s); a second read shows 0 planted rows left`, ev.cleanup);
  else FAIL(`cleanup incomplete: done=${done}, planted rows still visible: ${left}`, ev.cleanup);
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
