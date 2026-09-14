/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * THE ONE HOME OF THE DEV-ONLY FAULT LEVER (F-335 live proof).
 *
 * WHY IT EXISTS: F-335 made a git delivery whose dispatch THROWS fail closed — the
 * `git_delivery` claim is released, the attempt counter advances, and the throw is
 * rethrown so the platform redelivers, up to GIT_DISPATCH_MAX_ATTEMPTS. None of that
 * could ever be proven on a live tenant: every envelope `gitWebhook` accepts dispatches
 * cleanly, and there is no sanctioned way to make `dispatchGitEvent` fail. An invariant
 * about failure that can only be exercised by breaking the app for real is an invariant
 * that stays unproven — so the failure gets a LEVER, with one home and one gate.
 *
 * THE GATE IS `process.env.HARNESS_SECRET`, exactly like src/test-hook.js: development
 * and staging builds carry it, PRODUCTION NEVER DOES. It has ONE home in this file,
 * `harnessEnabled()`, and ALL NINE storage-touching exports ask it on their FIRST
 * statement, before any storage call: `harnessFaultArmed` returns false,
 * `armHarnessFault`, `disarmHarnessFault`, `armKeyReadFault` (F-629), `armJiraFault`
 * (F-655), `sweepHarnessFaults` (F-667), `plantHarnessFaults` and `clearPlantedFaults`
 * (F-688) return `{ ok: false, reason: "harness-off" }`,
 * and `readHarnessFault` returns `null`. So on a production deployment this module performs no KVS read and no KVS
 * write, and cannot change any outcome, no matter who imports it. (`keyReadFaultMode` and
 * `jiraFaultStatus` touch storage only THROUGH `readHarnessFault`, so they inherit the
 * gate rather than restating it — which is the shape any further consuming side copies.)
 *
 * THAT SENTENCE WAS FALSE TWICE. F-517 gated the arming side and the docblock went on
 * claiming the whole-module property while `disarmHarnessFault` still issued an ungated
 * DELETE and `readHarnessFault` an ungated GET — two of four exports, one of them a write.
 * F-522 closed them. A file whose premise is "one home, one gate" cannot satisfy it in
 * half its exports and say so in prose. Asserted offline by stubbing the env
 * (async-handler-helpers.test.mjs counts every KVS operation on the fault key across all
 * six exports and expects zero).
 *
 * SHAPE: `harness_fault:<kind>:<part>:<part>…`, value `{ count, armedAt, until }` — plus
 * `mode` or `status` for the two window kinds. `until` (F-664) is the row's OWN deadline
 * and it is what actually ends a lever: the platform TTL that rides alongside it is a
 * lazy cleanup guarantee, not a read-time one, so an armed lever that is never consumed
 * disarms itself on the first READ after `until`, not whenever KVS gets round to it. Ten
 * minutes is the family ceiling (`HARNESS_FAULT_TTL_SECONDS`); the two window kinds clamp
 * themselves to five. Every key part goes through `safeKeyPart`/`assertKvsKey` (F-334): a
 * delivery id is a clamped but otherwise raw provider header and must never shape a key.
 *
 * Each ARMED read consumes one unit: the row is decremented and deleted at zero, so a
 * count of N produces exactly N failures and the (N+1)-th attempt runs for real. The
 * consumer, not the arming call, is what decrements — that is what makes the counter a
 * measurement of real dispatch attempts.
 */
import { kvs as storage } from "@forge/kvs";
import { safeKeyPart, assertKvsKey } from "./shared/kvs-keys.js";

/** Never let a test arm more failures than the delivery could survive. */
export const HARNESS_FAULT_MAX_COUNT = 5;

/**
 * TTL of an armed lever, IN SECONDS, because seconds is the unit every caller of this
 * module thinks in and the one `setFaultRow` writes. Short on purpose: a forgotten arm
 * must not outlive the test. It is also the CEILING `setFaultRow` clamps to, so no lever
 * in this family — whatever a caller asks for — can be armed for longer than ten minutes.
 */
export const HARNESS_FAULT_TTL_SECONDS = 600;

/** A forced throw at the git-event dispatch seam (F-335). */
export const HARNESS_FAULT_GIT_DISPATCH = "git-dispatch";

/**
 * F-504 — the SECOND kind. SAME home, SAME env gate, SAME one-shot semantics; a fault
 * kind that grew its own arming/consuming code elsewhere would be the defect this file
 * exists to prevent.
 *
 * WHY IT EXISTS: `rotateGitHookSecret` step 3 (the PROMOTE write) is the failure F-481
 * was built for — the provider already signs the new secret while the store still holds
 * the old one, so the row must keep BOTH (`getHookSecretCandidates` returns two) and the
 * connection must be stamped `hookState:"rotation-failed"`. Offline that state is reached
 * by failing a mock KVS write; LIVE there was no way to reach it at all, so F-481's
 * pending-secret acceptance window and F-491's reconcile-on-retry were unobservable on a
 * real tenant — an invariant about failure that nothing could exercise.
 *
 * Keyed by `<connId>:<repoId>`: the repo id is normalised by the caller and sanitised by
 * `harnessFaultKey`, never embedded raw (F-334/F-346 — a "/" is not a legal key part).
 * Consumed INSIDE step 3's own try block, so a planted throw takes exactly the path a
 * real storage refusal takes: same catch, same `rotation-failed` stamp, same refusal
 * string, no side effect the real failure would not have had. One armed unit == one
 * failed promote; the retry the banner invites then runs for real.
 */
export const HARNESS_FAULT_HOOK_PROMOTE = "hook-promote";

/**
 * F-629 — THE THIRD KIND, and the one that is NOT a one-shot.
 *
 * WHY IT EXISTS: F-603 is about what the provider settings card does when
 * `getOpenAIKey` FAILS — a stale `noKeyNeeded` painting a BYOK provider as "Managed by
 * LeanZero, nothing to paste here", with no key input rendered at all. The resolver is a
 * KVS read plus a provider switch, so nothing a tester can do from outside makes it
 * answer `{success:false}` or throw, and the fix could only ever be exercised against a
 * mocked resolver. Same shape of problem as the two kinds above, same answer: the failure
 * gets a lever, with one home and one gate.
 *
 * IT IS A WINDOW, NOT A COUNT. The panel's load calls `getOpenAIKey` more than once (a
 * mount, then a provider switch), and an N-shot lever would fail an arbitrary subset of
 * them — which is a different test every run. So the row carries a MODE and lives for a
 * caller-chosen TTL up to `HARNESS_KEY_READ_FAULT_MAX_TTL_SECONDS`, and the consuming
 * side reads it with `readHarnessFault`, which does not decrement. The two modes are the
 * two shapes F-603 names: `refuse` is the resolver's own `{success:false}` catch body,
 * `throw` is an invoke that rejects.
 *
 * Keyed by PROVIDER id alone. Arming it for one provider cannot affect another, which is
 * what makes the F-603 scenario — managed loads fine, openai fails — expressible at all.
 */
export const HARNESS_FAULT_KEY_READ = "key-read";

/** The two failure shapes F-603 is about. Anything else is refused at the door. */
export const KEY_READ_FAULT_MODES = Object.freeze(["refuse", "throw"]);

/** Five minutes. Long enough for an admin to open a tab, short enough to forget safely. */
export const HARNESS_KEY_READ_FAULT_MAX_TTL_SECONDS = 300;

/**
 * F-655 — THE FOURTH KIND: a planted HTTP failure at ONE named Jira endpoint.
 *
 * WHY IT EXISTS: F-648 made `searchUsers` fail CLOSED for the whole transport class — a
 * 403/429/500 from `/rest/api/3/user/search` is `{success:false, reason:"jira_unavailable"}`
 * and no longer an empty success the admin reads as "that person is not on this site".
 * That arm, and the ORDER it sits in behind the admin gate, had no live door at all:
 * nothing a tester can do from outside makes Jira's user search fail, and the resolver was
 * not even on the hook's `invokeResolver` allow-list (both halves of F-655). Same shape of
 * problem as the three kinds above, same answer: the failure gets a lever, one home, one
 * gate.
 *
 * IT IS A WINDOW, NOT A COUNT — the Permissions tab fires a search on every 400 ms of
 * typing, so an N-shot lever would fail an arbitrary subset of them and be a different
 * test every run. The row carries a STATUS and lives for a caller-chosen TTL up to
 * `HARNESS_JIRA_FAULT_MAX_TTL_SECONDS`; the consuming side reads it with
 * `readHarnessFault`, which does not decrement.
 *
 * KEYED BY THE EXACT PATH, AND ONLY A PATH ON `JIRA_FAULT_PATHS` IS ACCEPTED. There is no
 * wildcard, no prefix match and no regex: a lever that could fault "every Jira call whose
 * path starts with /rest" is a lever that can break an arbitrary product path on a real
 * tenant, and the whole point of this family is that a fault is narrow enough to name.
 * Widening this list is a decision, not a convenience — each entry needs a consumer that
 * asks for it BY THAT CONSTANT.
 */
export const HARNESS_FAULT_JIRA = "jira";

/**
 * THE one home of the path string the F-648 consumers and this lever must agree on.
 *
 * F-661 — "one home" became a MECHANISM here rather than a promise: this constant is what
 * `userSearchRoute()` in src/jira-routes.js BUILDS the URL from, so the fault key and the
 * bytes on the wire cannot drift apart. Nothing may re-type this path in a `route` literal;
 * if the endpoint ever moves, this line moves and both consumers follow it.
 */
export const JIRA_FAULT_USER_SEARCH_PATH = "/rest/api/3/user/search";

/** The ONLY faultable paths. Exact equality — never a prefix, never a pattern. */
export const JIRA_FAULT_PATHS = Object.freeze([JIRA_FAULT_USER_SEARCH_PATH]);

/**
 * Same five minutes, and deliberately the SAME NUMBER rather than a second literal: a
 * forgotten arm must not outlive the test, whichever lever it is.
 */
export const HARNESS_JIRA_FAULT_MAX_TTL_SECONDS = HARNESS_KEY_READ_FAULT_MAX_TTL_SECONDS;

/**
 * A planted fault is a FAILURE. 400-599 only, so nobody can arm a "200" and have the
 * consumer's `!ok` arm quietly not fire — that would be a lever that lies about what it
 * did. Clamped here, with the thing it bounds, never at the web trigger.
 */
export const jiraFaultStatusValid = (status) => {
  const n = Math.floor(Number(status));
  return Number.isFinite(n) && n >= 400 && n <= 599 ? n : null;
};

/** THE key shape. Parts are sanitised here, never at the call sites. */
export const harnessFaultKey = (kind, ...parts) =>
  assertKvsKey(`harness_fault:${safeKeyPart(kind)}:${parts.map((p) => safeKeyPart(p == null ? "none" : p)).join(":")}`);

/**
 * A fault the lever injected. NAMED so a log reader can tell a planted failure from a
 * real one at a glance, and so nothing downstream can mistake it for a product error.
 */
export class HarnessFault extends Error {
  constructor(message) {
    super(message);
    this.name = "HarnessFault";
    this.harnessFault = true;
  }
}

/**
 * THE gate, in ONE home. `process.env.HARNESS_SECRET` is set in development and staging
 * builds and NEVER in production, exactly as in src/test-hook.js. EVERY export that touches
 * storage asks this, as its FIRST statement, before any storage call, so a production
 * deployment performs no KVS access through this module at all. WHICH exports those are is
 * not prose: it is `HARNESS_GATED_EXPORTS` below (F-694), and the offline suites assert the
 * count, the names and the first statement against that list. Adding a storage-touching
 * export means adding this line to it AND adding its name there; a new one that forgets the
 * line shows up as a non-zero operation count rather than as a comment nobody read.
 * (`keyReadFaultMode` and `jiraFaultStatus` are not ones: they touch storage only through
 * `readHarnessFault` and so inherit the gate instead of restating it.)
 */
export const harnessEnabled = () => Boolean(process.env.HARNESS_SECRET);

/*
 * F-694 — THE LIST OF WHO MUST ASK IS DATA, NOT A MAGIC NUMBER IN TWO TEST FILES.
 *
 * The rule above ("every storage-touching export opens with the gate") was enforced by a
 * hard-coded COUNT in `harness-fault-ttl.test.mjs` and again in `async-handler-helpers.test.mjs`
 * — two copies, one of them outside the surgeon's own territory — plus a third hand-written
 * list of names that F-688 forgot to extend when it added two exports. So adding a gated
 * export turned two suites red in a way that was fixed by editing the number rather than by
 * reading the rule, which is the opposite of what a gate is for.
 *
 * The list lives HERE, next to the gate it describes, and the tests assert AGAINST IT: the
 * count, the names, and that each named export's source really does open with the gate. A
 * new storage-touching export that is not added here is still caught — by the count of
 * `if (!harnessEnabled())` occurrences in the file, which the tests take from this list's
 * length rather than from a literal.
 */
export const HARNESS_GATED_EXPORTS = Object.freeze([
  "harnessFaultArmed",   // consume (F-517)
  "armHarnessFault",     // F-517
  "disarmHarnessFault",  // F-522
  "readHarnessFault",    // F-522
  "armKeyReadFault",     // F-629
  "armJiraFault",        // F-655
  "sweepHarnessFaults",  // F-667
  "plantHarnessFaults",  // F-688
  "clearPlantedFaults",  // F-688
  "armDeleteFault",      // F-706
]);

/*
 * F-704 — A LIST OF WHO MUST ASK IS ONLY A GATE IF IT IS CHECKED AGAINST WHO IS THERE.
 *
 * F-694 moved the gated-export rule out of two test files and into `HARNESS_GATED_EXPORTS`
 * above — but the only completeness check was `occurrences of "if (!harnessEnabled())" ===
 * HARNESS_GATED_EXPORTS.length`, and BOTH SIDES OF THAT ARE THE GATED SET. An export added
 * WITHOUT the gate line AND without joining the list moves neither number: 9 === 9, the
 * per-name loop iterates the list and so never visits it, and a KVS-touching export ships
 * reachable with no `HARNESS_SECRET` — the exact production-silence property the gate exists
 * for. The docblock above claimed that case was covered. It caught only the GATED-but-
 * unlisted one (count 10 vs length 9).
 *
 * The missing half is the COMPLEMENT, so the complement is data too. These three lists
 * PARTITION `Object.keys(await import("./harness-fault.js"))` — every export is on exactly
 * one, and nothing is on none — which is what turns "the list is right" from a claim into an
 * assertion. Adding an export to this module now fails the offline suites until its author
 * has said, in this file, which of the three it is:
 *
 *  · `HARNESS_GATED_EXPORTS`          — touches storage; opens with `if (!harnessEnabled())`.
 *  · `HARNESS_INHERITED_GATE_EXPORTS` — touches storage ONLY through a gated export, so it
 *    inherits the gate instead of restating it. This pair used to be a hand-written denylist
 *    inside `harness-fault-ttl.test.mjs` — a THIRD home of the rule, which is why it is here.
 *  · `HARNESS_UNGATED_EXPORTS`        — pure: constants, key builders, clamps, predicates,
 *    encoders and the error class. None of them names `storage.` at all, and the shared
 *    contract asserts that of every one of them, so "pure" is checked and not asserted.
 *
 * The contract itself has ONE home — `test-harness/lib/gated-export-contract.mjs` — asked by
 * both suites, with a fake extra export as its negative control.
 */
export const HARNESS_INHERITED_GATE_EXPORTS = Object.freeze([
  "keyReadFaultMode",  // reads through readHarnessFault (F-629)
  "jiraFaultStatus",   // reads through readHarnessFault (F-655)
]);

export const HARNESS_UNGATED_EXPORTS = Object.freeze([
  // The lists themselves, and the predicate the gate is made of.
  "HARNESS_GATED_EXPORTS",
  "HARNESS_INHERITED_GATE_EXPORTS",
  "HARNESS_UNGATED_EXPORTS",
  "harnessEnabled",
  "HarnessFault",
  // Kinds, key shapes and the caps every lever is clamped to.
  "HARNESS_FAULT_MAX_COUNT",
  "HARNESS_FAULT_TTL_SECONDS",
  "HARNESS_FAULT_GIT_DISPATCH",
  "HARNESS_FAULT_HOOK_PROMOTE",
  "HARNESS_FAULT_KEY_READ",
  "HARNESS_FAULT_JIRA",
  "HARNESS_FAULT_KEY_PREFIX",
  "KEY_READ_FAULT_MODES",
  "HARNESS_KEY_READ_FAULT_MAX_TTL_SECONDS",
  "JIRA_FAULT_USER_SEARCH_PATH",
  "JIRA_FAULT_PATHS",
  "HARNESS_JIRA_FAULT_MAX_TTL_SECONDS",
  "jiraFaultStatusValid",
  "harnessFaultKey",
  "faultTtlOption",
  "faultRowDeadline",
  "faultRowExpired",
  // The sweep's constants, cursor grammar and answer tail — all pure.
  "HARNESS_FAULT_SWEEP_PAGE_SIZE",
  "HARNESS_FAULT_SWEEP_MAX_PAGES",
  "HARNESS_FAULT_SWEEP_DEFAULT_MS",
  "HARNESS_FAULT_SWEEP_MAX_MS",
  "HARNESS_FAULT_SWEEP_MAX_ROWS",
  "KVS_DELETE_BATCH",
  "KVS_DELETE_PAUSE_MS",
  "HARNESS_FAULT_SWEEP_DELETE_CONCURRENCY",
  "encodeSweepCursor",
  "SWEEP_CURSOR_MAX_BYTES",
  "sweepCursorWellFormed",
  "BAD_SWEEP_CURSOR_CODE",
  "decodeSweepToken",
  "decodeSweepCursor",
  "sweepAnswerTail",
  "sweepBudgetMs",
  // The plant's constants and clamps.
  "HARNESS_FAULT_PLANT",
  "HARNESS_FAULT_PLANT_PREFIX",
  "HARNESS_FAULT_PLANT_MAX",
  "HARNESS_FAULT_PLANT_MS_PER_ROW",
  "HARNESS_FAULT_PLANT_CALL_MAX",
  "HARNESS_FAULT_PLANT_TTL_SECONDS",
  "HARNESS_FAULT_PLANT_BACKDATE_SECONDS",
  "plantCountClamped",
  "plantStartIndexClamped",
  "plantMaxForCall",
  "plantTtlSeconds",
  "plantedFaultKey",
  // The delete fault's kind, modes, caps and code mapping (F-706).
  "HARNESS_FAULT_DELETE",
  "DELETE_FAULT_MODES",
  "HARNESS_DELETE_FAULT_MAX_COUNT",
  "HARNESS_DELETE_FAULT_MAX_TTL_SECONDS",
  "HARNESS_DELETE_FAULT_CODE",
  "DELETE_FAULT_THROTTLE_CODE",
  "deleteFaultCode",
]);

/*
 * F-664 — THE ONE WRITE AND THE ONE READ OF A FAULT ROW, AND WHY THE PLATFORM TTL IS NOT
 * ENOUGH ON ITS OWN.
 *
 * MEASURED: a Jira fault armed with `ttlSeconds: 5` was STILL BITING at 615 s on a live
 * dev tenant — past its own five-second window, past the 300 s cap and past the ten-minute
 * family ceiling. The option shape was never the bug (`{ ttl: { value, unit } }` IS the
 * shape `@forge/kvs` takes, and `SECONDS` is a legal unit — both arming levers already
 * passed it): Forge KVS deletes expired keys LAZILY, the same fact src/index.js:1206
 * already records for the claim keys ("KVS deletes expired keys lazily (up to 48h)"). A
 * platform TTL is therefore a CLEANUP guarantee, never a read-time one, and a module whose
 * only bound on a lever was that TTL had in practice no bound at all: only an explicit
 * disarm ended a fault, so a driver that crashed before its `finally` left every admin on
 * that tenant faulted indefinitely.
 *
 * THE BOUND IS NOW ON THE ROW AND ENFORCED ON THE READ, exactly like the attachment
 * capability tokens (src/index.js mints `expiresAt` on the record AND passes the platform
 * TTL, then `serveAttachment` re-checks `expiresAt` "in case the KVS backend's TTL is
 * fuzzy"). Here: the row carries `until` (ISO), `setFaultRow` is the only thing that writes
 * one, `getFaultRow` is the only thing that reads one, and a row whose `until` has passed
 * is answered as ABSENT and DELETED on the way out. The platform TTL stays — it is what
 * removes the row nobody ever reads again — but it is now defence in depth, not the story.
 *
 * F-667 — A ROW WITH NO `until` IS BOUNDED BY `armedAt` + THE FAMILY CEILING, NOT LEFT
 * IMMORTAL. F-664's read-time bound shipped answering "no stamp == nothing to judge it by
 * == not expired", which is exactly the row that CAUSED F-664: every fault armed by a build
 * before d4896af carries `armedAt` and no `until`, so the new bound did not reach one of
 * them and a crashed driver's lever stayed live forever. So there is ONE deadline function,
 * `faultRowDeadline`: the stored `until` when it parses, else `armedAt` + ten minutes (no
 * lever in this family may outlive that ceiling anyway), else NOTHING — and a row with
 * neither stamp is EXPIRED, because a row this module cannot date is a row it cannot bound.
 * Every row this module writes carries both stamps; the offline suites that plant rows by
 * hand carry `armedAt`, which is what keeps them readable.
 *
 * AND THE DECREMENT NEVER EXTENDS A WINDOW. `harnessFaultArmed` re-writes a counted row, and
 * before F-667 it recomputed the deadline from NOW for any row with no `until` — stamping a
 * FRESH ten minutes onto the legacy row it had just failed to expire. The existing deadline
 * is now carried THROUGH the write (`setFaultRow`'s `keepUntil`), never recomputed.
 *
 * THE LAST RESORT IS `sweepHarnessFaults` (F-667): one gated call that enumerates the whole
 * `harness_fault:` keyspace with each row's deadline and deletes the expired ones, so a
 * crashed driver's leftovers are clearable without knowing which keys it armed.
 */

/** THE one place a fault TTL becomes a platform option. Seconds, because Forge takes a unit. */
export const faultTtlOption = (seconds) => ({ ttl: { value: seconds, unit: "SECONDS" } });

/**
 * F-667 — THE ONE DEADLINE OF A ROW, in ms, or `null` when the row carries no date at all.
 *
 * `until` is the row's own stamp and wins whenever it parses. A row with no usable `until`
 * is a row written by a build before the F-664 deploy (or hand-planted by an offline suite),
 * and it is bounded by `armedAt` + `HARNESS_FAULT_TTL_SECONDS`: ten minutes is the ceiling
 * NO lever in this family may exceed, so applying it to an undated row takes nothing from a
 * legitimate one and ends an abandoned one. Both `faultRowExpired` and `remainingSeconds`
 * ask THIS — two functions deriving "when does this row end" separately is how F-667 got its
 * second half (the predicate said "never" while the decrement said "600 seconds from now").
 */
export const faultRowDeadline = (row) => {
  if (!row || typeof row !== "object") return null;
  const until = typeof row.until === "string" ? Date.parse(row.until) : NaN;
  if (Number.isFinite(until)) return until;
  const armedAt = typeof row.armedAt === "string" ? Date.parse(row.armedAt) : NaN;
  if (Number.isFinite(armedAt)) return armedAt + HARNESS_FAULT_TTL_SECONDS * 1000;
  return null;
};

/**
 * Has this row's window passed? A row with NEITHER stamp is EXPIRED (F-667): a lever nobody
 * can date is a lever nothing can end, and this family's whole premise is that a forgotten
 * arm dies on its own. A non-row is not expired — it is absent, which `getFaultRow` already
 * answers separately.
 */
export const faultRowExpired = (row, now = Date.now()) => {
  if (!row || typeof row !== "object") return false;
  const deadline = faultRowDeadline(row);
  return deadline === null ? true : now >= deadline;
};

/**
 * THE one write. Clamps to `HARNESS_FAULT_TTL_SECONDS`, stamps `until`, and passes the
 * platform TTL in the SECONDS shape. Callers with a tighter cap of their own (the key-read
 * and Jira levers clamp to 300 s) clamp first; this is the family ceiling nobody escapes.
 *
 * NOT EXPORTED, deliberately. It touches storage and carries no env gate of its own — it is
 * reachable only THROUGH the six gated exports, which is what keeps "all SIX storage-touching
 * exports ask `harnessEnabled()` first" true rather than becoming "all eight, two of which
 * nobody remembered". A caller outside this file that wants to write a fault row arms a lever.
 */
const setFaultRow = async (key, row, ttlSeconds, keepUntil = null) => {
  const seconds = Math.max(1, Math.min(HARNESS_FAULT_TTL_SECONDS, Math.floor(Number(ttlSeconds) || HARNESS_FAULT_TTL_SECONDS)));
  // F-667 — `keepUntil` is a RE-WRITE of a row that already has a deadline (the decrement).
  // It is carried through verbatim rather than recomputed from now, which is the only way a
  // repeated consumption cannot walk a lever forward. A fresh arm passes none and gets one.
  const until = typeof keepUntil === "string" && Number.isFinite(Date.parse(keepUntil))
    ? keepUntil
    : new Date(Date.now() + seconds * 1000).toISOString();
  const stored = { ...row, until };
  await storage.set(key, stored, faultTtlOption(seconds));
  return { value: stored, until, ttlSeconds: seconds };
};

/**
 * THE one read. Answers `{ row, until, expired }`; an expired row reads as `row: null` and
 * is deleted on the way out, so the next reader need not repeat the judgement. Best-effort
 * on the delete: failing to clean up must never turn a read into a throw.
 */
const getFaultRow = async (key) => {
  const row = (await storage.get(key)) || null;
  const until = (row && typeof row.until === "string" && row.until) || null;
  if (row && faultRowExpired(row)) {
    try { await storage.delete(key); } catch { /* the read is the contract, not the sweep */ }
    return { row: null, until, expired: true };
  }
  return { row, until, expired: false };
};

/**
 * What is LEFT of a row's window, so a re-write preserves it rather than restarting it.
 *
 * F-667 — it asks `faultRowDeadline`, so an undated row yields what is left of
 * `armedAt` + the ceiling instead of a fresh ten minutes. A row with no deadline at all is
 * already expired and never reaches this (`getFaultRow` answers it as absent); the one
 * second here is a floor, never a window.
 */
const remainingSeconds = (row) => {
  const deadline = faultRowDeadline(row);
  if (deadline === null) return 1;
  return Math.max(1, Math.ceil((deadline - Date.now()) / 1000));
};

/**
 * Is a fault armed for this key — and if so, consume one unit of it?
 *
 * Returns false, with NO storage access at all, whenever HARNESS_SECRET is absent (i.e.
 * in production). Best-effort on every storage error: a lever that cannot be read is a
 * lever that is not armed. It must never be able to fail a delivery by accident.
 */
export const harnessFaultArmed = async (kind, ...parts) => {
  if (!harnessEnabled()) return false;
  try {
    const key = harnessFaultKey(kind, ...parts);
    const { row } = await getFaultRow(key);
    const count = Number(row && row.count) || 0;
    if (count <= 0) return false;
    if (count <= 1) await storage.delete(key);
    // F-664/F-667 — a decrement must not RE-ARM the window. The row's EXISTING deadline is
    // carried through the write (never recomputed from now), and for a legacy row with no
    // `until` that deadline is `armedAt` + the ceiling — so a consumption BACKFILLS the stamp
    // rather than granting a fresh TTL, and N consumptions cannot walk a lever forward.
    else {
      const deadline = faultRowDeadline(row);
      await setFaultRow(key, { ...row, count: count - 1 }, remainingSeconds(row), new Date(deadline).toISOString());
    }
    return true;
  } catch {
    return false;
  }
};

/**
 * Arm `count` consecutive faults.
 *
 * F-517 — the ARMING side carries the SAME env gate as the consuming side, on its FIRST
 * statement, and writes NOTHING when it refuses. The Bearer check in src/test-hook.js is
 * still the authorization for the one caller that exists today, but a gate that lives only
 * in the caller is a gate the NEXT caller does not inherit, and this file's whole premise is
 * one home and one gate — `harnessFaultArmed` already refuses here rather than trusting its
 * callers. Refusal shape is `{ ok: false, reason: "harness-off" }`: the web trigger spreads
 * this return into a `{ ok: true, ... }` body, so the refusal overrides the optimistic ok.
 */
export const armHarnessFault = async (kind, parts, count) => {
  if (!harnessEnabled()) return { ok: false, reason: "harness-off" };
  const n = Math.max(1, Math.min(HARNESS_FAULT_MAX_COUNT, Math.floor(Number(count) || 1)));
  const key = harnessFaultKey(kind, ...parts);
  const { until, ttlSeconds } = await setFaultRow(key, { count: n, armedAt: new Date().toISOString() }, HARNESS_FAULT_TTL_SECONDS);
  return { key, count: n, until, ttlSeconds };
};

/**
 * Disarm. Idempotent: removing a lever that was never armed is a success.
 *
 * F-522 — GATED, like the other three. F-517 gated the arming side and left this one
 * ungated, which made the docblock's "no KVS access through this module at all" false by
 * two of four exports — and this one is a WRITE (a delete). The gap is the same
 * defence-in-depth class F-517 named and its own scenario predicted: the "admin
 * diagnostics" resolver that imports a lever to self-test it. Four exports, one
 * predicate, asked first, before any storage call.
 */
export const disarmHarnessFault = async (kind, parts) => {
  if (!harnessEnabled()) return { ok: false, reason: "harness-off" };
  const key = harnessFaultKey(kind, ...parts);
  await storage.delete(key);
  return { key, disarmed: true };
};

/**
 * What is left on the lever (the live driver polls this to prove consumption).
 *
 * F-522 — GATED. `null` is the refusal, and it is the same answer the callers already
 * handle: with no lever there is nothing on it. A production build reads nothing.
 */
export const readHarnessFault = async (kind, parts) => {
  if (!harnessEnabled()) return null;
  const key = harnessFaultKey(kind, ...parts);
  // F-664 — the expiry judgement lives in `getFaultRow`, so every consumer that reads
  // THROUGH this one inherits it (`keyReadFaultMode`, `jiraFaultStatus`, and the hook's
  // three read actions). `expired` is reported rather than swallowed: a driver that polls
  // this is entitled to know the row it armed ended on its own window.
  const { row, until, expired } = await getFaultRow(key);
  return { key, value: row, until, expired };
};

/**
 * F-629 — arm the key-read fault for ONE provider, for a bounded window.
 *
 * GATED FIRST, like the other four, and for the same reason: a gate that lives only in
 * the caller is a gate the next caller does not inherit. A production deployment performs
 * no KVS access through this export at all.
 *
 * The mode is checked against `KEY_READ_FAULT_MODES` and the TTL clamped to
 * `HARNESS_KEY_READ_FAULT_MAX_TTL_SECONDS` HERE, not at the web trigger — the clamp
 * belongs with the thing it bounds. Disarming and reading use the generic
 * `disarmHarnessFault` / `readHarnessFault` with `HARNESS_FAULT_KEY_READ`; a second pair
 * of kind-specific exports would be two homes for one rule.
 */
export const armKeyReadFault = async (provider, mode, ttlSeconds) => {
  if (!harnessEnabled()) return { ok: false, reason: "harness-off" };
  if (!KEY_READ_FAULT_MODES.includes(mode)) return { ok: false, reason: "bad-mode", modes: KEY_READ_FAULT_MODES };
  const seconds = Math.max(1, Math.min(HARNESS_KEY_READ_FAULT_MAX_TTL_SECONDS, Math.floor(Number(ttlSeconds) || HARNESS_KEY_READ_FAULT_MAX_TTL_SECONDS)));
  const key = harnessFaultKey(HARNESS_FAULT_KEY_READ, provider);
  const { until } = await setFaultRow(key, { mode, armedAt: new Date().toISOString() }, seconds);
  return { key, mode, ttlSeconds: seconds, until };
};

/**
 * F-629 — the CONSUMING side, asked by `getOpenAIKey` (src/index.js) and nothing else.
 *
 * `"refuse"`, `"throw"` or `null`. NON-CONSUMING: the window, not a count, is what bounds
 * it (see `HARNESS_FAULT_KEY_READ`). Best-effort on every storage error, exactly like
 * `harnessFaultArmed`: a lever that cannot be read is a lever that is not armed, so this
 * can never break a provider read by accident. The env gate is inside `readHarnessFault`,
 * which is why this function performs no KVS access in production either.
 */
export const keyReadFaultMode = async (provider) => {
  try {
    const row = await readHarnessFault(HARNESS_FAULT_KEY_READ, [provider]);
    const mode = row && row.value && row.value.mode;
    return KEY_READ_FAULT_MODES.includes(mode) ? mode : null;
  } catch {
    return null;
  }
};

/**
 * F-655 — arm a Jira transport fault for ONE exact path, for a bounded window.
 *
 * GATED FIRST, like the other five, and for the same reason: a gate that lives only in the
 * caller is a gate the next caller does not inherit. A production deployment performs no
 * KVS access through this export at all.
 *
 * The path is checked against `JIRA_FAULT_PATHS` by EXACT EQUALITY and the status against
 * `jiraFaultStatusValid`, both HERE rather than at the web trigger, and the TTL is clamped
 * to `HARNESS_JIRA_FAULT_MAX_TTL_SECONDS`. Disarming and reading use the generic
 * `disarmHarnessFault` / `readHarnessFault` with `HARNESS_FAULT_JIRA` and the same path; a
 * second pair of kind-specific exports would be two homes for one rule.
 */
export const armJiraFault = async (path, status, ttlSeconds) => {
  if (!harnessEnabled()) return { ok: false, reason: "harness-off" };
  if (!JIRA_FAULT_PATHS.includes(path)) return { ok: false, reason: "bad-path", paths: JIRA_FAULT_PATHS };
  const code = jiraFaultStatusValid(status);
  if (code === null) return { ok: false, reason: "bad-status", range: "400-599" };
  const seconds = Math.max(1, Math.min(HARNESS_JIRA_FAULT_MAX_TTL_SECONDS, Math.floor(Number(ttlSeconds) || HARNESS_JIRA_FAULT_MAX_TTL_SECONDS)));
  const key = harnessFaultKey(HARNESS_FAULT_JIRA, path);
  const { until } = await setFaultRow(key, { status: code, armedAt: new Date().toISOString() }, seconds);
  return { key, path, status: code, ttlSeconds: seconds, until };
};

/**
 * F-655 / F-661 — the CONSUMING side, asked through the ONE seam `jiraFetchWithFault`
 * (src/jira-routes.js) and nothing else. That seam serves BOTH consumers of the endpoint:
 * `searchUsers` (the admin picker) and `resolveUserToAccountId` (the semantic-PF assignee
 * WRITE path). It used to be asked by `searchUsers` alone, which made arming the lever a
 * proof of one of two call sites while reading as a proof of the endpoint.
 *
 * The armed HTTP status, or `null`. NON-CONSUMING: the window, not a count, is what bounds
 * it. Best-effort on every storage error, exactly like `harnessFaultArmed`: a lever that
 * cannot be read is a lever that is not armed, so this can never break a Jira call by
 * accident. The env gate is inside `readHarnessFault`, which is why this function performs
 * no KVS access in production either. The stored status is re-validated on the way out —
 * a row is data, and a lever must not be able to hand its consumer a 200.
 */
export const jiraFaultStatus = async (path) => {
  try {
    if (!JIRA_FAULT_PATHS.includes(path)) return null;
    const row = await readHarnessFault(HARNESS_FAULT_JIRA, [path]);
    return jiraFaultStatusValid(row && row.value && row.value.status);
  } catch {
    return null;
  }
};

/**
 * F-667 — THE SWEEP: clear what a crashed driver left behind, without knowing its keys.
 *
 * F-664 put the bound on the row and enforced it on the READ, which ends a lever the moment
 * anything looks at it. That is enough for a lever someone still polls; it is NOT enough for
 * the rows that caused F-664 in the first place — a driver that died before its `finally`
 * leaves a row NOBODY will read again, on a key only that dead process knew, and Forge KVS
 * deletes expired keys lazily (up to 48 h, the fact src/index.js:1206 already records). So
 * there is one call that enumerates the whole `harness_fault:` keyspace, reports each row's
 * deadline and whether it has passed, and DELETES the ones that have.
 *
 * IT DELETES ONLY EXPIRED ROWS. A live lever is listed and left alone — this is a sweep, not
 * a disarm-everything, and a harness action that could cancel a running driver's fault mid-run
 * would make every suite's result depend on who else pressed it. `disarmHarnessFault` is still
 * the way to end a lever you armed. `dryRun: true` — the literal `true`, nothing else (F-673)
 * — lists without deleting.
 *
 * GATED FIRST, like the other six: a production deployment performs no KVS access here either,
 * and the enumeration in particular must never run on a real tenant.
 *
 * BEST-EFFORT ON EACH DELETE, like every other cleanup in this module: a key that refuses to
 * go is counted in `failed`, never thrown out of a sweep that cleaned up everything else.
 * But best-effort is about not THROWING, not about calling the result finished (F-683): any
 * `failed > 0` makes the answer `truncated: true, reason: "deletes-failed"` with a cursor to
 * retry from, and `complete: false`. `complete = !truncated && !unresolved` - where
 * `unresolved` is a failed delete from ANY call of this drain, carried across calls in the
 * resume token (F-691) - is the ONLY definition of a finished drain, and it is computed in
 * `sweepAnswerTail` and nowhere else. Re-deriving it from `truncated` alone reads a per-CALL
 * fact as if it were a per-DRAIN one.
 */
export const HARNESS_FAULT_KEY_PREFIX = "harness_fault:";

/*
 * F-673 — THE STATED BOUND IS NOW THE ENFORCED ONE.
 *
 * This block used to say "bounded on purpose: one 25 s resolver budget" while enforcing no
 * time bound at all. What it actually enforced was 1000 ROWS and up to 1000 SEQUENTIAL
 * awaited KVS deletes, inside a web trigger the platform kills at 25 s — and because the
 * answer was assembled only after every page, a sweep killed mid-loop reported NOTHING: not
 * the rows it had listed, not the count it had already deleted. The caller could not tell
 * whether the keyspace was clean, half clean or untouched. A cap expressed in PAGES is not a
 * cap on TIME; only a clock is one.
 *
 * So there are three bounds now, and all three are CHECKED rather than narrated:
 *  · TIME — `maxMs` (default 15 s, never above 20 s, so the answer still fits inside the
 *    25 s trigger) is checked BEFORE every page and BEFORE every delete batch. On exceeding
 *    it the sweep STOPS and returns the PARTIAL answer it already holds: real `scanned` /
 *    `deleted` / `failed`, `truncated: true`, `reason: "budget"`, and the `cursor` to resume
 *    from (which the call also ACCEPTS, so continuing is the same call again). That cursor is
 *    the one that RE-FETCHES the page being worked — KVS cursors are opaque tokens and a key
 *    is not a cursor — so a resumed sweep may re-list rows it already cleaned. Deliberate:
 *    every delete here is idempotent and only ever lands on an expired row, so the price of
 *    resuming is a repeated listing, never a lost row or a live lever destroyed twice.
 *  · WORK PER ROUND TRIP — a page's expired keys go out in `Promise.allSettled` batches of
 *    `HARNESS_FAULT_SWEEP_DELETE_CONCURRENCY`, each outcome counted into `deleted`/`failed`,
 *    still best-effort per key like every other cleanup in this module. Bounded concurrency
 *    and not "all of them at once": a diagnostic sweep must not be the thing that throttles
 *    the tenant it is cleaning.
 *  · ANSWER SIZE — the row LIST stops at `HARNESS_FAULT_SWEEP_MAX_ROWS` and sets
 *    `rowsTruncated`, while the COUNTERS keep counting. The counters are what an operator
 *    acts on; the list is a courtesy, and a courtesy must not be the thing that makes the
 *    response too large to return.
 *
 * `dryRun` ACCEPTS ONLY THE LITERAL `true`. It was `Boolean(dryRun)`, under which the string
 * `"false"` — the shape a query string or a hand-written curl produces — means "do not
 * delete". A lever whose safe mode can be entered by accident is a lever whose dangerous mode
 * is one typo away from being entered by accident too, so the safe mode now demands the exact
 * value and every other value sweeps for real.
 */

/** One page of the enumeration, and the page cap that still bounds a runaway cursor. */
export const HARNESS_FAULT_SWEEP_PAGE_SIZE = 100;
export const HARNESS_FAULT_SWEEP_MAX_PAGES = 10;
/** THE TIME BOUND (F-673), in ms: the default, and the ceiling no caller may raise. */
export const HARNESS_FAULT_SWEEP_DEFAULT_MS = 15_000;
export const HARNESS_FAULT_SWEEP_MAX_MS = 20_000;
/** The cap on the returned row LIST (the counters keep counting past it). */
export const HARNESS_FAULT_SWEEP_MAX_ROWS = 200;

/*
 * F-677 - THE DELETE RATE IS THE ONE THIS APP ALREADY PUBLISHES.
 *
 * The sweep fired TEN concurrent deletes per round with no pause between rounds, while
 * `src/shared/knowledge-packs/forge-app-builder.js` (the FaaS-limits pack entry, ~line 395)
 * - the guidance THIS APP SHIPS TO ITS OWN USERS - says: "Deletes: batches of ~3 with
 * ~200 ms pauses between rounds - deletes are heavier and a tight loop trips
 * `RATE_LIMIT_EXCEEDED` fast." Three times the documented concurrency and none of the
 * documented pacing, in the one call whose whole job is to delete a few hundred rows back
 * to back. A throttled delete is counted `failed` and the row SURVIVES, so the sweep
 * answers `ok: true, deleted: 137, failed: 63` and leaves behind the mess it was called to
 * clear - with no instruction to the operator about what to do next.
 *
 * So there is ONE pair of constants for both halves of the rate, the pack line is named
 * right here so the two cannot drift apart silently, and the historical constant name is
 * now an alias of the same value rather than a second opinion about it.
 *
 * THE PAUSE IS INSIDE THE BUDGET. `overBudget()` is checked immediately before the pause
 * and again immediately after it, exactly as it is before every batch - so pacing makes a
 * sweep do LESS work per call, and never makes it overrun the 25 s trigger. Fewer rows per
 * call is what the resume cursor (F-674) is for.
 */
export const KVS_DELETE_BATCH = 3;
export const KVS_DELETE_PAUSE_MS = 200;
/** The historical name for the batch size. Same constant: the rate has exactly one home. */
export const HARNESS_FAULT_SWEEP_DELETE_CONCURRENCY = KVS_DELETE_BATCH;

const sweepPause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/*
 * F-674 - THE RESUME TOKEN IS OURS, NOT THE RAW KVS CURSOR.
 *
 * The budget break used to answer with `resume`, the KVS cursor captured at the TOP of the
 * page being worked - and on page 0 of any call that cursor is the caller's own start
 * cursor, which is `null` on a fresh sweep. So the one case the budget exists for answered
 * `truncated: true, reason: "budget", cursor: null`, and a caller looping `while (r.cursor)`
 * read that as "finished" with hundreds of rows still in the keyspace. Measured: 400 expired
 * rows, 30 ms latency on ALL of them, `maxMs: 60` -> `deleted: 20, cursor: null`, 370 left.
 *
 * A raw KVS cursor cannot express "the beginning of the keyspace" - only `null` can, and
 * `null` is already spoken for as "finished". So the token the sweep RETURNS and ACCEPTS is
 * its own: base64 JSON carrying the KVS cursor, which may legitimately be `null`. The token
 * is therefore ALWAYS a non-empty string while work remains, and `cursor === null` means
 * finished and nothing else. (F-685: raw KVS cursors from a pre-token caller were accepted
 * verbatim for one deploy and are NOT any more - the grammar below admits our token only.)
 */
/*
 * F-691 — THE TOKEN CARRIES THE UNRESOLVED FAILURE TOO, NOT JUST THE PLACE TO RESUME.
 *
 * `failedResume` — the page a delete first refused on — used to be a LOCAL of one call,
 * written on the failing page and read only at the end and only when nothing else had
 * already set `truncated`. So a budget or pages break AFTER a failed page dropped it on the
 * floor: the caller resumed at the later page, walked to the end with `failed: 0`, and was
 * answered `truncated: false, cursor: null, complete: true` over rows the sweep had itself
 * condemned two calls earlier. `complete` is a property of a DRAIN, and a drain spans calls,
 * so the only thing that survives a call boundary — the resume token — has to carry it.
 *
 * The token is therefore `{ "c": <kvs cursor|null>, "f": <kvs cursor|null> }`, where the `f`
 * KEY IS PRESENT ONLY WHILE A FAILURE IS STILL UNRESOLVED. Presence, not value: the earliest
 * failing page may legitimately be the BEGINNING of the keyspace, whose KVS cursor is `null`
 * — exactly the ambiguity F-674 introduced this token to end.
 *
 * `f` is DROPPED when the answer's own cursor points AT the failure (the retry starts there,
 * so there is nothing left to remind the caller of) and carried whenever the answer resumes
 * somewhere AHEAD of it.
 */
export const encodeSweepCursor = (kvsCursor, failedResume = undefined) => {
  const payload = { c: kvsCursor === undefined ? null : kvsCursor };
  // `undefined` means "no unresolved failure"; an explicit `null` means "unresolved, at the
  // beginning of the keyspace" — which is why this tests the ARGUMENT, not its truthiness.
  if (failedResume !== undefined) payload.f = failedResume;
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
};

/*
 * F-685 - THE CURSOR GRAMMAR HAS ONE HOME, AND IT IS THIS ONE.
 *
 * There were two readings of "what a resume cursor may be": the web trigger admitted
 * `[A-Za-z0-9+/=_.:-]+` under 2 KB with no doubled dot, while `decodeSweepCursor` accepted
 * ANY non-empty string verbatim as a legacy raw KVS cursor. The narrow one sat at the door,
 * so the library's back-compat path could never be reached through the only caller there is
 * - and a raw cursor carrying a space or a `#` (both legal in a KVS key) was refused
 * `bad-cursor` at the door by the same build that went out of its way to support it.
 *
 * LEGACY RAW CURSORS ARE NO LONGER ACCEPTED. The base64 token has shipped for exactly one
 * deploy, the only callers are this repo's own drivers, and a raw KVS cursor presented today
 * is refused as `bad-cursor` like any other string that is not one of our tokens. That is a
 * deliberate narrowing of an input, not of a fail-open: the grammar admits our own token and
 * nothing else needs admitting, and every refusal is a 400 with a reason.
 *
 * The 2 KB ceiling stays (an unbounded string is a body no door has reason to accept) and so
 * does the doubled-dot refusal: `.` and `/` are both in base64's neighbourhood, our tokens
 * never contain `..`, and defence-in-depth on a value bound for a storage API is free.
 */
export const SWEEP_CURSOR_MAX_BYTES = 2048;
const SWEEP_CURSOR_PATTERN = /^[A-Za-z0-9+/=_-]+$/;
export const sweepCursorWellFormed = (value) =>
  typeof value === "string" && value.length > 0 && value.length <= SWEEP_CURSOR_MAX_BYTES
  && SWEEP_CURSOR_PATTERN.test(value) && !value.includes("..");

/*
 * F-684 - A REFUSAL THE DOOR CAN TELL APART FROM A DEAD TENANT.
 *
 * `decodeSweepCursor` REFUSES by throwing this, and it does so synchronously, before the
 * sweep has touched KVS at all. That ordering is the whole point: the door names
 * `bad-cursor` only for an error that could not possibly have come from the platform, and
 * every other throw - a rejected query, a throttle, an outage - is `sweep-failed`.
 */
export const BAD_SWEEP_CURSOR_CODE = "BAD_SWEEP_CURSOR";
const badSweepCursor = (detail) => {
  const error = new Error(`bad sweep cursor: ${detail}`);
  error.code = BAD_SWEEP_CURSOR_CODE;
  return error;
};

/**
 * A caller's token -> the KVS cursor inside it. `null`/`undefined`/absent is a FRESH sweep
 * (and so is our own token for "the beginning of the keyspace", which is the value a raw KVS
 * cursor cannot express). Anything else that is not one of our tokens THROWS
 * `BAD_SWEEP_CURSOR_CODE` - it never silently becomes a fresh sweep, because a resume loop
 * that quietly restarts from the top is the failure this token was introduced to end.
 */
export const decodeSweepToken = (token) => {
  if (token === null || token === undefined) return { cursor: null, unresolved: false, failedResume: null };
  if (!sweepCursorWellFormed(token)) throw badSweepCursor("outside the token grammar");
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(token, "base64").toString("utf8"));
  } catch {
    throw badSweepCursor("not a decodable token");
  }
  if (!parsed || typeof parsed !== "object" || !("c" in parsed)) throw badSweepCursor("not one of ours");
  const kvsCursor = (v) => (typeof v === "string" && v ? v : null);
  return {
    cursor: kvsCursor(parsed.c),
    /* PRESENCE, not truthiness (F-691): `"f": null` is a real unresolved failure at the
     * beginning of the keyspace, and a token minted before F-691 simply has no `f` at all —
     * which decodes as "nothing unresolved", the pre-F-691 behaviour, for a token that at
     * worst is one sweep old. */
    unresolved: "f" in parsed,
    failedResume: kvsCursor(parsed.f),
  };
};

/** The cursor half of the token, for callers that only ever wanted that. ONE grammar. */
export const decodeSweepCursor = (token) => decodeSweepToken(token).cursor;

/*
 * F-691 — THE ONE PLACE A DRAIN'S ANSWER IS ASSEMBLED, for the sweep and the clear alike.
 *
 * `truncated` / `reason` / `cursor` / `complete` used to be finished off by two byte-similar
 * tails, one at the end of `sweepHarnessFaults` and one at the end of `clearPlantedFaults`,
 * so "what does a finished drain look like" had two homes and F-683's rule had to be applied
 * twice. It has one now, and the rules it holds are:
 *
 *  · AN UNRESOLVED FAILURE IS A STOP. If the walk otherwise reached the end, say
 *    `deletes-failed` and hand back the failing page, so a retry lands on the mess rather
 *    than re-walking the keyspace. A break that already has a reason (budget, pages,
 *    deletes-failing) keeps it — it is the more specific answer.
 *  · `complete` IS `!truncated && !unresolved`, where `unresolved` SPANS CALLS. This is the
 *    ONLY definition of a finished drain and it is computed here and nowhere else. A caller
 *    that re-derives finishedness from `truncated` alone reads a per-CALL fact as if it were
 *    a per-DRAIN one, which is the defect F-691 names.
 *  · `failedResume` IS ALWAYS REPORTED while a failure is unresolved, however the call ended,
 *    and always as a TOKEN (never a bare cursor, so `null` means "none" and nothing else).
 *    POSTing it back as `cursor` is how a caller goes and finishes the job.
 *
 * F-696 — `unresolvedReason` EXISTS SO THE PLANT CAN SHARE THIS TAIL. The plant breaks on the
 * same budget and owes the same `complete`, but the thing that can fail there is a WRITE, not
 * a delete, and an answer that says "deletes-failed" over refused writes is a sentence no
 * reader can act on. It is a parameter with the sweep's own word as its default, so the two
 * drains are untouched and there is still exactly ONE place `complete` is decided.
 */
export const sweepAnswerTail = ({ truncated, reason, cursor, unresolved, failedResume, unresolvedReason = "deletes-failed" }) => {
  let stopped = truncated === true, why = reason, at = cursor;
  if (unresolved && !stopped) { stopped = true; why = unresolvedReason; at = failedResume; }
  // Resuming AT the failure IS the retry: the cursor already says everything `f` would.
  const carry = unresolved && !(stopped && at === failedResume);
  return {
    truncated: stopped,
    reason: why,
    complete: !stopped && !unresolved,
    failedResume: unresolved ? encodeSweepCursor(failedResume) : null,
    cursor: stopped ? (carry ? encodeSweepCursor(at, failedResume) : encodeSweepCursor(at)) : null,
  };
};

/**
 * THE one place a caller's `maxMs` becomes a budget. Anything that is not a finite number is
 * the default; anything above the ceiling is the ceiling (the trigger's 25 s is the real
 * constraint and no option gets to argue with it); anything below 1 ms is 1 ms, so a caller
 * asking for zero gets "check, stop, report" rather than a loop that never checks at all.
 */
export const sweepBudgetMs = (maxMs) => {
  if (typeof maxMs !== "number" || !Number.isFinite(maxMs)) return HARNESS_FAULT_SWEEP_DEFAULT_MS;
  return Math.min(Math.max(Math.floor(maxMs), 1), HARNESS_FAULT_SWEEP_MAX_MS);
};

/*
 * F-674 - PROGRESS PER CALL IS GUARANTEED, and that is what makes the loop terminate.
 *
 * The budget is honoured only once this call has actually MOVED: at least one delete batch
 * has landed, or at least one page has been advanced. Before that, `overBudget()` is not
 * allowed to stop anything - a `maxMs` so small that the very first check trips would
 * otherwise produce a call that scans a page, deletes nothing, and hands back a cursor
 * identical to the one it was given, forever. `progressed` is that gate, and it is the
 * whole termination argument: every call either deletes rows (the page shrinks) or advances
 * the cursor (the page moves), so a `while (r.cursor)` caller strictly converges.
 *
 * The resume point on a mid-page break is THIS page's own cursor, deliberately: the rows it
 * already deleted are GONE, so re-fetching the same page returns the remainder and nothing
 * is re-deleted. No skip count is needed and none is kept - the deletes themselves are the
 * progress the cursor does not have to encode.
 *
 * F-682 - A BATCH THAT LANDED NOTHING IS NOT PROGRESS.
 *
 * `progressed` was set after `Promise.allSettled` regardless of outcome, so a batch in which
 * EVERY delete was rejected armed the gate the termination argument rests on. Under
 * throttling - the exact condition the pacing above exists for - batch 0 of a page failed
 * three times, set `progressed`, and the budget was then free to break MID-PAGE with
 * `cursor = resume`: the page's own token. The resumed call re-fetched the identical page,
 * built the identical `doomed` list, failed identically, and answered with the identical
 * token, forever, burning a trigger per turn and deleting nothing. Only a FULFILLED delete
 * or an advanced page counts now.
 *
 * And an all-failed batch ENDS THE CALL, with `reason: "deletes-failing"` and the same
 * cursor: a caller that sees a byte-identical answer has no way to tell a converging sweep
 * from a stuck one, but `deletes-failing` beside `failed > 0` says outright "this is not
 * converging, back off". That is what makes a `while (cursor)` loop against a permanently
 * refusing store terminate instead of spin.
 *
 * F-683 - `cursor === null` MEANS SWEPT *AND* CLEARED.
 *
 * A sweep whose deletes failed still advanced its cursor and, at the end of the keyspace,
 * answered `truncated: false, cursor: null, ok: true, failed: 63` - the "finished" signal,
 * for a call that left 63 rows it had itself condemned. F-677 changed the RATE; it did not
 * change the ANSWER. There is now ONE definition of finished, computed here and nowhere
 * else: `complete`, computed by `sweepAnswerTail` and returned as a field so no caller has to
 * re-derive it. When any delete failed, the answer is `truncated: true,
 * reason: "deletes-failed"` carrying the cursor of the FIRST page whose deletes failed, so
 * retrying resumes where the mess is rather than at the top.
 *
 * F-691 - COMPLETENESS BELONGS TO THE DRAIN, NOT TO THE CALL.
 *
 * `failed === 0` was read per CALL, and the failing page's resume point was thrown away the
 * moment a budget or pages break had already set `truncated`. Page 0 fails two deletes; the
 * budget trips at page 4; the caller resumes at page 4, walks to the end with `failed: 0`
 * and is told `complete: true, cursor: null` - over two armed rows this very drain
 * condemned. So the unresolved failure now RIDES THE RESUME TOKEN (`f`, see
 * `encodeSweepCursor`), is inherited by the resumed call, and `complete` is
 * `!truncated && !unresolved` where `unresolved` spans the whole drain. `failedResume` is
 * additionally returned as its own token field on EVERY call that carries one, however that
 * call ended, so a caller never has to reconstruct where the mess was.
 */
/* ═══════════════════════════════════════════════════════════════════════════════
 * F-706 — THE FAILING-DELETE HALF OF THE SWEEP CONTRACT HAD NO LIVE DOOR.
 *
 * F-682 (`deletes-failing`), F-683 (`deletes-failed` + `failedResume`), F-690 (the drain's
 * back-off) and F-691 (the unresolved failure riding the resume token) are ALL about what
 * the sweep does when a KVS delete REFUSES. Nothing a tester can do on a real tenant makes
 * one refuse: plant-sweep-live on 2026-09-14 saw `failed: 0` and zero RATE_LIMIT throughout,
 * so four rows of the sweep's answer contract were proven against the offline mock only —
 * the same "offline-only" state F-688 built `plantHarnessFaults` to end for the multi-page
 * path.
 *
 * `armDeleteFault` is that door, and it is the SEVENTH member of the `armHarnessFault`
 * family — same gate, same row shape, same `until`, same clamps-live-with-the-lever rule,
 * same generic `disarmHarnessFault` / `readHarnessFault` for the other two verbs (a
 * kind-specific pair would be two homes for one rule). What keeps it from being a lever that
 * can break a real tenant:
 *
 *  · THE PREFIX IS EXACT, AND IT IS THE PLANT'S. `armDeleteFault` accepts one value —
 *    `HARNESS_FAULT_PLANT_PREFIX` — by equality, exactly as `armJiraFault` accepts one path.
 *    There is no wildcard and no caller-chosen prefix, because a lever that can fail "any
 *    delete under harness_fault:" can strand another driver's lever row, and one that can
 *    fail an arbitrary key can strand app data. Planted rows are inert ballast nothing reads
 *    (F-688), so refusing to delete them costs nothing but the row's own 60 s TTL.
 *  · IT IS CONSULTED IN ONE PLACE: `settleDeletes`, the single delete-batch helper both the
 *    sweep and the clear now call. Nothing else in this module — and nothing outside it —
 *    can reach it. In particular the lever's OWN row is not under the plant prefix, so
 *    arming one can never make it undisarmable.
 *  · IT IS COUNTED, AND THE COUNT IS SPENT THROUGH THE EXISTING CONSUMPTION HOME.
 *    `harnessFaultArmed` is what decrements it: it preserves the row's `until` (F-667, a
 *    decrement must never re-arm a window) and deletes the row at zero. Consumption is
 *    SEQUENTIAL, before the parallel deletes, so three concurrent deletes cannot read-modify-
 *    write the same counter into an unknown value — the batch is 3, the cost is 3 awaits.
 *  · IT ENDS BY ITSELF, twice over: `count` ≤ 50 faults and `ttlSeconds` ≤ 120 s, both
 *    clamped here rather than at the door.
 *
 * `refuse` is the synthetic failure — a `HarnessFault` carrying `HARNESS_DELETE_FAULT`, a
 * code no platform ever emits, so a log reader can never mistake a planted failure for a
 * real one. `throttle` carries `RATE_LIMIT_EXCEEDED`, the code F-677 and F-682 were written
 * about, so a drain can be driven down the exact path the pacing exists for. The sweep does
 * not discriminate between them — a rejected delete is `failed`, whatever the reason — which
 * is the point: the lever produces the CONDITION, and the contract already says what the
 * answer must be.
 */
export const HARNESS_FAULT_DELETE = "delete";
export const DELETE_FAULT_MODES = Object.freeze(["refuse", "throttle"]);
export const HARNESS_DELETE_FAULT_MAX_COUNT = 50;
export const HARNESS_DELETE_FAULT_MAX_TTL_SECONDS = 120;
/** A code no platform emits: a planted refusal is never mistaken for a real one. */
export const HARNESS_DELETE_FAULT_CODE = "HARNESS_DELETE_FAULT";
/** The code F-677/F-682 are about, so `throttle` reproduces the real condition verbatim. */
export const DELETE_FAULT_THROTTLE_CODE = "RATE_LIMIT_EXCEEDED";

/** Which code a mode rejects with. Pure, and the ONE place the mapping lives. */
export const deleteFaultCode = (mode) =>
  mode === "throttle" ? DELETE_FAULT_THROTTLE_CODE : HARNESS_DELETE_FAULT_CODE;

/**
 * F-706 — arm the delete fault for the PLANT prefix, for a bounded count and window.
 *
 * GATED FIRST, like the other six. The prefix allow-list, the mode allow-list, the count cap
 * and the TTL cap all live HERE, not at the web trigger: the clamp belongs with the thing it
 * bounds. Disarm and read are the generic `disarmHarnessFault` / `readHarnessFault` with
 * `HARNESS_FAULT_DELETE` and the same prefix.
 */
export const armDeleteFault = async ({ prefix, mode, count, ttlSeconds } = {}) => {
  if (!harnessEnabled()) return { ok: false, reason: "harness-off" };
  // EXACT equality against the one prefix this lever may touch — never a prefix test.
  if (prefix !== HARNESS_FAULT_PLANT_PREFIX) {
    return { ok: false, reason: "bad-prefix", prefix: HARNESS_FAULT_PLANT_PREFIX };
  }
  if (!DELETE_FAULT_MODES.includes(mode)) return { ok: false, reason: "bad-mode", modes: DELETE_FAULT_MODES };
  const n = Math.max(1, Math.min(HARNESS_DELETE_FAULT_MAX_COUNT, Math.floor(Number(count) || 1)));
  const seconds = Math.max(1, Math.min(HARNESS_DELETE_FAULT_MAX_TTL_SECONDS, Math.floor(Number(ttlSeconds) || HARNESS_DELETE_FAULT_MAX_TTL_SECONDS)));
  const key = harnessFaultKey(HARNESS_FAULT_DELETE, prefix);
  const { until } = await setFaultRow(key, { mode, count: n, armedAt: new Date().toISOString() }, seconds);
  return { key, prefix, mode, count: n, ttlSeconds: seconds, until };
};

/**
 * What the lever says RIGHT NOW, or `null` for "not armed".
 *
 * Reads THROUGH `readHarnessFault`, so it inherits the gate and F-664's read-time expiry
 * judgement exactly as `keyReadFaultMode` and `jiraFaultStatus` do — a row past its `until`
 * is answered absent and deleted, and a lever this cannot read is a lever that is not armed.
 * Best-effort, like every consuming side in this module: a fault must never be able to fail
 * a sweep by accident.
 */
const loadDeleteFault = async () => {
  try {
    const row = await readHarnessFault(HARNESS_FAULT_DELETE, [HARNESS_FAULT_PLANT_PREFIX]);
    const value = (row && row.value) || null;
    if (!value || !DELETE_FAULT_MODES.includes(value.mode) || !(Number(value.count) > 0)) return null;
    return { prefix: HARNESS_FAULT_PLANT_PREFIX, mode: value.mode, spent: false };
  } catch {
    return null;
  }
};

/**
 * THE delete batch — for the sweep AND for the clear, which ran two byte-identical copies of
 * it. One home is what lets the F-706 lever be consulted in exactly one place instead of two.
 *
 * Consumption is sequential and happens BEFORE the parallel deletes: `harnessFaultArmed` is a
 * read-modify-write on one row, and three of them racing inside `Promise.allSettled` would
 * spend an unknowable number of units. When the count runs out mid-batch the lever is marked
 * `spent` for the rest of the call and every remaining key is deleted for real — which is the
 * transition a drain test needs (`deletes-failing` → resume → `complete`).
 */
const settleDeletes = async (batch, fault) => {
  const faulted = new Map();
  if (fault && !fault.spent) {
    for (const key of batch) {
      if (!String(key).startsWith(fault.prefix)) continue;
      // The ONE consumption home (F-667): decrements, carries `until` through, deletes at zero.
      if (!(await harnessFaultArmed(HARNESS_FAULT_DELETE, fault.prefix))) { fault.spent = true; break; }
      faulted.set(key, fault.mode);
    }
  }
  return Promise.allSettled(batch.map((key) => {
    if (!faulted.has(key)) return storage.delete(key);
    const code = deleteFaultCode(faulted.get(key));
    const err = new HarnessFault(`planted delete fault (${code}) on ${key}`);
    err.code = code;
    return Promise.reject(err);
  }));
};

export const sweepHarnessFaults = async ({ dryRun = false, maxMs, cursor: startCursor = null } = {}) => {
  if (!harnessEnabled()) return { ok: false, reason: "harness-off" };
  const dry = dryRun === true;
  const budgetMs = sweepBudgetMs(maxMs);
  const t0 = Date.now();
  const overBudget = () => Date.now() - t0 >= budgetMs;
  const now = t0;
  const rows = [];
  let scanned = 0, deleted = 0, failed = 0, rowsTruncated = false;
  let truncated = false, reason = null;
  /* Our token, or nothing at all. VALIDATED FIRST, SYNCHRONOUSLY (F-684): this throws
   * `BAD_SWEEP_CURSOR_CODE` before a single KVS call is made, which is what lets the door
   * name `bad-cursor` from the error itself instead of from "a cursor was supplied". */
  const startToken = decodeSweepToken(startCursor === undefined ? null : startCursor);
  let cursor = startToken.cursor;
  let progressed = false;
  /* The resume point of the EARLIEST page a delete failed on, and whether that failure is
   * still outstanding - INHERITED FROM THE TOKEN (F-691), because a drain spans calls and a
   * failure two calls back is still a row this drain condemned and did not delete. */
  let unresolved = startToken.unresolved;
  let failedResume = startToken.failedResume;
  /* F-706 — the planted delete fault, read ONCE per call (never per batch: a per-batch read
   * would double the KVS traffic of the one call whose whole job is to be cheap). A dry run
   * deletes nothing and so consumes nothing. */
  const deleteFault = dry ? null : await loadDeleteFault();
  for (let page = 0; page < HARNESS_FAULT_SWEEP_MAX_PAGES; page++) {
    // The cursor that re-fetches THIS page - the resume point for anything that stops inside it.
    const resume = cursor;
    if (progressed && overBudget()) { truncated = true; reason = "budget"; cursor = resume; break; }
    let query = storage.query()
      .where("key", { condition: "BEGINS_WITH", values: [HARNESS_FAULT_KEY_PREFIX] })
      .limit(HARNESS_FAULT_SWEEP_PAGE_SIZE);
    if (cursor) query = query.cursor(cursor);
    const result = await query.getMany();
    const doomed = [];
    for (const entry of (result && result.results) || []) {
      const key = String(entry && entry.key);
      const row = (entry && entry.value) || null;
      const deadline = faultRowDeadline(row);
      const expired = faultRowExpired(row, now);
      scanned++;
      // `until` is what the ROW says; `deadline` is what BOUNDS it - they differ exactly for
      // the legacy no-`until` row this sweep exists to reach, and a reader is owed both.
      if (rows.length < HARNESS_FAULT_SWEEP_MAX_ROWS) {
        rows.push({
          key,
          until: (row && typeof row.until === "string" && row.until) || null,
          deadline: deadline === null ? null : new Date(deadline).toISOString(),
          expired,
        });
      } else {
        rowsTruncated = true;
      }
      if (expired) doomed.push(key);
    }
    if (!dry) {
      for (let i = 0; i < doomed.length; i += KVS_DELETE_BATCH) {
        // PACED (F-677) at the app's own published rate, and the pause sits INSIDE the
        // budget: checked before it, and again after it, like every other batch boundary.
        if (i > 0) {
          if (progressed && overBudget()) { truncated = true; reason = "budget"; cursor = resume; break; }
          await sweepPause(KVS_DELETE_PAUSE_MS);
        }
        if (progressed && overBudget()) { truncated = true; reason = "budget"; cursor = resume; break; }
        const batch = doomed.slice(i, i + KVS_DELETE_BATCH);
        // F-706: the ONE delete batch, shared with the clear — and the only consult site of
        // the planted delete fault.
        const settled = await settleDeletes(batch, deleteFault);
        let landed = 0;
        for (const outcome of settled) { if (outcome.status === "fulfilled") { deleted++; landed++; } else failed++; }
        // F-691: the EARLIEST unresolved failure wins, and "none yet" is `!unresolved` - never
        // `failedResume === null`, which is also a legitimate failing page (the keyspace start).
        if (landed < settled.length && !unresolved) { unresolved = true; failedResume = resume; }
        // F-682: ONLY a delete that actually landed is progress. A batch of pure rejections
        // shrinks nothing, so it must not license a mid-page break with this page's cursor.
        if (landed > 0) progressed = true;
        else if (settled.length > 0) {
          // Nothing landed: this call is not converging. Stop HERE, with this page's cursor
          // and a reason that says so, rather than pacing on into a budget break that would
          // be indistinguishable from a healthy partial sweep.
          truncated = true; reason = "deletes-failing"; cursor = resume; break;
        }
      }
      if (truncated) break;
    }
    cursor = (result && result.nextCursor) || null;
    // The page MOVED, which is the other half of the progress guarantee (F-682): a page
    // that deleted nothing because there was nothing to delete has still gone forward.
    progressed = true;
    if (!cursor) break;
    if (page === HARNESS_FAULT_SWEEP_MAX_PAGES - 1) { truncated = true; reason = "pages"; }
  }
  /* F-683 + F-691: `truncated` / `reason` / `cursor` / `complete` / `failedResume` are
   * assembled by `sweepAnswerTail` and NOWHERE ELSE - the same tail the clear uses - so the
   * definition of a finished DRAIN has one home across both levers and across calls. The
   * `cursor` it returns is ALWAYS a token while work remains (F-674) and null only when the
   * drain is genuinely done. */
  return {
    ok: true, dryRun: dry, scanned, deleted, failed,
    budgetMs, rows, rowsTruncated,
    ...sweepAnswerTail({ truncated, reason, cursor, unresolved, failedResume }),
  };
};

/* ═══════════════════════════════════════════════════════════════════════════════
 * F-688 — THE SWEEP'S MULTI-PAGE PATH HAD NO LIVE DOOR.
 *
 * Everything F-673/F-674/F-677/F-682/F-683 built — the resume token, the real KVS cursor
 * round-trip, the paced deletes, the progress guarantee, `complete` — only engages once the
 * `harness_fault:` keyspace is bigger than ONE PAGE. And the only way to put a row in that
 * keyspace was to arm a lever: one row per exact path, one per provider, a handful per
 * connection. A tester on a real tenant could not reach a second page, so every resume
 * assertion in this repo was offline-only, against a mock whose cursor is a plain key.
 *
 * `plantHarnessFaults` is that door, and it is built so that the ONLY thing it can do is
 * make the keyspace big:
 *
 *  · IT WRITES UNDER ITS OWN KIND, `plant`, and NOTHING READS THAT KIND. Every consumer of
 *    a fault row names its kind EXACTLY — `harnessFaultArmed(HARNESS_FAULT_GIT_DISPATCH, …)`
 *    in src/async-handler.js and `(HARNESS_FAULT_HOOK_PROMOTE, …)` in src/git-connections.js,
 *    `readHarnessFault(HARNESS_FAULT_KEY_READ, …)` inside `keyReadFaultMode`,
 *    `readHarnessFault(HARNESS_FAULT_JIRA, …)` inside `jiraFaultStatus`, and the four hook
 *    read actions, which pass those same four constants. Grep the callers: there is no
 *    wildcard read, no prefix read and no enumeration anywhere except `sweepHarnessFaults`,
 *    which only ever DELETES. `harnessFaultKey` puts the kind in the second segment, so a
 *    `plant` row cannot collide with one of the four either.
 *    A planted row is therefore INERT: it occupies the keyspace and bites nothing. That is
 *    the whole reason this lever is allowed to write five hundred rows when the dangerous
 *    ones are capped at one.
 *  · IT IS GATED LIKE EVERY OTHER LEVER. `harnessEnabled()` first, before any storage call,
 *    so a production deployment (where HARNESS_SECRET is never set) plants nothing and reads
 *    nothing. The door in src/test-hook.js is 404 there for the same reason.
 *  · IT WRITES THROUGH THE ONE WRITE. `setFaultRow` stamps the row and passes the platform
 *    TTL in the SECONDS shape, so a planted row expires on its own exactly like an armed one
 *    even if nobody ever calls `clearPlantedFaults`. Sixty seconds, not ten minutes: this is
 *    ballast for a sweep, not a lever anybody is waiting on.
 *  · `expired: true` DATES THE ROWS IN THE PAST, which is the only shape the sweep will
 *    actually delete — that is the population a drain test needs. `expired: false` plants
 *    LIVE rows instead, which the sweep must list and leave alone.
 */
export const HARNESS_FAULT_PLANT = "plant";
/** The sub-prefix `clearPlantedFaults` is bound to. Derived, never retyped. */
export const HARNESS_FAULT_PLANT_PREFIX = `${HARNESS_FAULT_KEY_PREFIX}${HARNESS_FAULT_PLANT}:`;
/** How big a planted POPULATION may get. Five pages of `HARNESS_FAULT_SWEEP_PAGE_SIZE`. */
export const HARNESS_FAULT_PLANT_MAX = 500;
/*
 * F-696 — WHAT ONE CALL MAY ATTEMPT IS NOT WHAT THE KEYSPACE MAY HOLD.
 *
 * MEASURED LIVE: 200 rows planted in 17–18 s, i.e. ~90 ms a row — the published pace
 * (`KVS_DELETE_BATCH` per `KVS_DELETE_PAUSE_MS`, 66.7 ms a row) plus real KVS write latency.
 * Five hundred rows is therefore ~45 s of one web trigger that is killed at 25 s, and the old
 * plant assembled its answer only after the last write, so a plant that timed out reported
 * NOTHING — not `planted`, not `failed`, not `keys` — having already written an unknown
 * number of rows under `i`-derived keys a re-POST silently overwrites.
 *
 * So a FRESH call may ask for at most what fits inside the DEFAULT budget at the measured
 * rate, and the 500-row population is reached the way the sweep's is: by RESUMING. A call
 * that passes a `startIndex` has proved it implements the loop and may name the full target.
 */
export const HARNESS_FAULT_PLANT_MS_PER_ROW = 90;
/** ≈ `HARNESS_FAULT_SWEEP_DEFAULT_MS / HARNESS_FAULT_PLANT_MS_PER_ROW`, rounded down for headroom. */
export const HARNESS_FAULT_PLANT_CALL_MAX = 150;
/** A planted row's own FLOOR window. Short on purpose — ballast, not a lever. See `plantTtlSeconds`. */
export const HARNESS_FAULT_PLANT_TTL_SECONDS = 60;
/** How far in the past an `expired: true` row is dated. Past any reader's clock skew. */
export const HARNESS_FAULT_PLANT_BACKDATE_SECONDS = 3_600;

/**
 * THE clamp on `n`, here with the constant it bounds and never at the web trigger. Anything
 * that is not a finite number is ONE — a body with a missing or junk `n` plants the smallest
 * possible population rather than the largest.
 */
export const plantCountClamped = (n, startIndex = 0) => {
  const parsed = Math.floor(Number(n));
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(plantMaxForCall(startIndex), parsed));
};

/**
 * WHERE THIS CALL STARTS WRITING (F-696). Anything that is not a finite number is ZERO — a
 * body with a missing or junk `startIndex` is a FRESH plant, never a mystery offset — and the
 * ceiling is the last index the population may hold.
 */
export const plantStartIndexClamped = (startIndex) => {
  const parsed = Math.floor(Number(startIndex));
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(HARNESS_FAULT_PLANT_MAX - 1, parsed));
};

/**
 * THE ceiling on `n` for a given call, in one place, so the lever and the door advertise the
 * same number: `HARNESS_FAULT_PLANT_CALL_MAX` for a fresh plant (what fits inside the default
 * budget at the measured rate), `HARNESS_FAULT_PLANT_MAX` for a resumed one.
 */
export const plantMaxForCall = (startIndex) =>
  plantStartIndexClamped(startIndex) > 0 ? HARNESS_FAULT_PLANT_MAX : HARNESS_FAULT_PLANT_CALL_MAX;

/**
 * F-697 — THE TTL SCALES WITH THE PLANT, because the plant takes TIME.
 *
 * A flat sixty seconds is shorter than the plant that writes it: at ~90 ms a row the head of
 * a 400-row population was written ~36 s before the tail, so by the time the caller got its
 * answer and POSTed the sweep, rows the `expired: false` contract promises the sweep "must
 * list and leave alone" had crossed their own `until` and were DELETED — evidence of a broken
 * expiry predicate, manufactured entirely by the plant's own clock.
 *
 * The window is therefore `max(60 s, expected plant time + 60 s)`: every row still gets a full
 * minute of life AFTER the last row lands, whatever `n` was. The family ceiling
 * (`HARNESS_FAULT_TTL_SECONDS`) still binds — `setFaultRow` would clamp anyway, and clamping
 * here too keeps the number this function reports equal to the number that is written.
 */
export const plantTtlSeconds = (rows) => {
  const expectedSeconds = Math.round((Math.max(0, Math.floor(Number(rows) || 0)) * HARNESS_FAULT_PLANT_MS_PER_ROW) / 1000);
  return Math.min(HARNESS_FAULT_TTL_SECONDS,
    Math.max(HARNESS_FAULT_PLANT_TTL_SECONDS, expectedSeconds + HARNESS_FAULT_PLANT_TTL_SECONDS));
};

/** The key of planted row `i`, zero-padded so the keyspace sorts the way it was written. */
export const plantedFaultKey = (i) =>
  harnessFaultKey(HARNESS_FAULT_PLANT, String(i).padStart(3, "0"));

/**
 * Plant INERT rows under `harness_fault:plant:`, so the sweep's multi-page path can be
 * exercised on a real tenant. Returns
 * `{ ok, planted, failed, n, startIndex, nextIndex, expired, ttlSeconds, budgetMs, keys,
 *    truncated, reason, complete }`.
 *
 * `n` IS THE POPULATION, NOT THE BATCH: this call writes rows `startIndex .. n-1`, whose keys
 * are `i`-derived (`plantedFaultKey`), so resuming is idempotent and two calls over the same
 * indices produce one population, not two. A caller that is answered `truncated: true,
 * reason: "budget", nextIndex: k` POSTs the SAME `n` back with `startIndex: k` and keeps going
 * until `complete: true`.
 *
 * Writes are paced at the app's own published KVS rate (`KVS_DELETE_BATCH` /
 * `KVS_DELETE_PAUSE_MS` — the same pair the sweep's deletes use, because it is the same
 * store and the same guidance), so planting a large population cannot be the thing that
 * throttles the tenant the sweep is about to walk. A write that refuses is counted in
 * `failed`, never thrown out of a plant that placed everything else — and `failed > 0` is
 * never `complete`, by the same `sweepAnswerTail` the sweep and the clear answer through.
 *
 * F-696 — THE BUDGET IS THE SWEEP'S, CHECKED BEFORE EVERY BATCH (`sweepBudgetMs`: default
 * 15 s, ceiling 20 s, under the trigger's 25 s) and honoured only once the call has actually
 * written something, so a tiny `maxMs` cannot produce a call that places nothing and asks to
 * be resumed at the index it was given.
 *
 * THERE IS NO CURSOR HERE, DELIBERATELY. The plant's resume point is an INDEX, because its
 * keys are the index; `nextIndex` is that handle and the answer carries no `cursor` field for
 * a drain loop to mistake for one.
 */
export const plantHarnessFaults = async ({ n, expired = false, maxMs, startIndex } = {}) => {
  if (!harnessEnabled()) return { ok: false, reason: "harness-off" };
  const from = plantStartIndexClamped(startIndex);
  const count = plantCountClamped(n, from);
  const past = expired === true;
  const budgetMs = sweepBudgetMs(maxMs);
  const t0 = Date.now();
  const overBudget = () => Date.now() - t0 >= budgetMs;
  /* F-697: the window covers the whole POPULATION's planting plus a full minute after it —
   * `count`, not `count - from`. A resumed call must not hand its rows a SHORTER life than
   * the head already got: the drain that is coming walks the whole keyspace, so every row
   * has to outlive the whole plant, not just the part of it that wrote that row. */
  const ttlSeconds = plantTtlSeconds(count);
  const keys = [];
  let planted = 0, failed = 0, truncated = false, reason = null, progressed = false;
  let i = from;
  for (; i < count; i += KVS_DELETE_BATCH) {
    if (i > from) {
      if (progressed && overBudget()) { truncated = true; reason = "budget"; break; }
      await sweepPause(KVS_DELETE_PAUSE_MS);
    }
    if (progressed && overBudget()) { truncated = true; reason = "budget"; break; }
    /* F-697 — STAMPED PER BATCH, AT WRITE TIME. One `armedAt` computed before the loop dated
     * every row from the START of a plant that takes tens of seconds, so the head's window was
     * already closing while the tail was still being written. Each batch is dated when it is
     * written, so every row's life begins when the row does. */
    const nowMs = Date.now();
    const armedAt = new Date(nowMs - (past ? HARNESS_FAULT_PLANT_BACKDATE_SECONDS * 1000 : 0)).toISOString();
    /* An expired row carries a deadline already gone; a live one gets `armedAt + ttlSeconds`.
     * BOTH are derived from the SAME clock read as `armedAt`, and both are passed explicitly
     * rather than left to `setFaultRow`'s own `Date.now()`: a row whose two stamps come from
     * two clock reads is a row whose window is not exactly the window this lever reports. */
    const keepUntil = new Date(past
      ? nowMs - (HARNESS_FAULT_PLANT_BACKDATE_SECONDS - ttlSeconds) * 1000
      : nowMs + ttlSeconds * 1000).toISOString();
    const batch = [];
    for (let j = i; j < Math.min(i + KVS_DELETE_BATCH, count); j++) batch.push(plantedFaultKey(j));
    const settled = await Promise.allSettled(batch.map((key) =>
      setFaultRow(key, { count: 1, armedAt, plantedBy: "harness" }, ttlSeconds, keepUntil)));
    for (let k = 0; k < settled.length; k++) {
      if (settled[k].status === "fulfilled") { planted++; keys.push(batch[k]); } else failed++;
    }
    progressed = true;
  }
  /* The ONE definition of a finished drain, borrowed whole (F-683/F-691/F-696): `complete` is
   * `!truncated && failed === 0` and it is decided in `sweepAnswerTail` and nowhere else. The
   * tail's cursor half is not used — this lever resumes by index — so only the three fields
   * that describe FINISHEDNESS are taken from it. */
  const tail = sweepAnswerTail({
    truncated, reason, cursor: null,
    unresolved: failed > 0, failedResume: null, unresolvedReason: "writes-failed",
  });
  return {
    ok: true, planted, failed, n: count, startIndex: from,
    nextIndex: truncated ? i : count,
    expired: past, ttlSeconds, budgetMs, keys,
    truncated: tail.truncated, reason: tail.reason, complete: tail.complete,
  };
};

/**
 * Delete the planted ballast — and ONLY the planted ballast.
 *
 * This is deliberately NOT `sweepHarnessFaults` with a widened predicate. The sweep deletes
 * expired rows and nothing else, precisely so it can never cancel a running driver's lever;
 * a clear must remove LIVE planted rows too, and the only safe way to hold both rules is to
 * bind the unconditional delete to a prefix nothing else can write into. The prefix is
 * `HARNESS_FAULT_PLANT_PREFIX` and it is NOT a parameter: no caller gets to say which
 * keyspace is cleared unconditionally.
 *
 * Everything else is the sweep's own vocabulary, in its one home: `sweepBudgetMs` for the
 * budget, `KVS_DELETE_BATCH`/`KVS_DELETE_PAUSE_MS` for the rate, `encodeSweepCursor` /
 * `decodeSweepToken` for the resume token, the F-682 progress gate, and `sweepAnswerTail`
 * for the finished signal — including F-691's cross-call carry of an unresolved failed
 * delete — so a caller drains this exactly as it drains the sweep.
 */
export const clearPlantedFaults = async ({ maxMs, cursor: startCursor = null } = {}) => {
  if (!harnessEnabled()) return { ok: false, reason: "harness-off" };
  const budgetMs = sweepBudgetMs(maxMs);
  const t0 = Date.now();
  const overBudget = () => Date.now() - t0 >= budgetMs;
  let scanned = 0, deleted = 0, failed = 0;
  let truncated = false, reason = null;
  // Validated synchronously, before any KVS call, so the door can name `bad-cursor` from the
  // error itself (F-684) rather than from "a cursor was supplied".
  const startToken = decodeSweepToken(startCursor === undefined ? null : startCursor);
  let cursor = startToken.cursor;
  let progressed = false;
  // Inherited across calls (F-691), exactly as in the sweep: completeness is a DRAIN's.
  let unresolved = startToken.unresolved;
  let failedResume = startToken.failedResume;
  // F-706: the same lever the sweep reads, read once per call, consulted in the same helper.
  const deleteFault = await loadDeleteFault();
  for (let page = 0; page < HARNESS_FAULT_SWEEP_MAX_PAGES; page++) {
    const resume = cursor;
    if (progressed && overBudget()) { truncated = true; reason = "budget"; cursor = resume; break; }
    let query = storage.query()
      .where("key", { condition: "BEGINS_WITH", values: [HARNESS_FAULT_PLANT_PREFIX] })
      .limit(HARNESS_FAULT_SWEEP_PAGE_SIZE);
    if (cursor) query = query.cursor(cursor);
    const result = await query.getMany();
    const doomed = [];
    for (const entry of (result && result.results) || []) { scanned++; doomed.push(String(entry && entry.key)); }
    for (let i = 0; i < doomed.length; i += KVS_DELETE_BATCH) {
      if (i > 0) {
        if (progressed && overBudget()) { truncated = true; reason = "budget"; cursor = resume; break; }
        await sweepPause(KVS_DELETE_PAUSE_MS);
      }
      if (progressed && overBudget()) { truncated = true; reason = "budget"; cursor = resume; break; }
      const batch = doomed.slice(i, i + KVS_DELETE_BATCH);
      // F-706: the shared delete batch — the sweep's copy of this loop and this one had drifted
      // into two homes of the same six lines; the fault has to be consulted in exactly one.
      const settled = await settleDeletes(batch, deleteFault);
      let landed = 0;
      for (const outcome of settled) { if (outcome.status === "fulfilled") { deleted++; landed++; } else failed++; }
      // F-691: the EARLIEST unresolved failure wins, and "none yet" is `!unresolved` - never
      // `failedResume === null`, which is also a legitimate failing page (the keyspace start).
      if (landed < settled.length && !unresolved) { unresolved = true; failedResume = resume; }
      // F-682: only a delete that LANDED is progress; a batch of pure rejections shrinks
      // nothing and must not license a mid-page break with this page's own cursor.
      if (landed > 0) progressed = true;
      else if (settled.length > 0) { truncated = true; reason = "deletes-failing"; cursor = resume; break; }
    }
    if (truncated) break;
    cursor = (result && result.nextCursor) || null;
    progressed = true;
    if (!cursor) break;
    if (page === HARNESS_FAULT_SWEEP_MAX_PAGES - 1) { truncated = true; reason = "pages"; }
  }
  // F-683 + F-691: the same tail as the sweep, because it is the same answer contract.
  return {
    ok: true, prefix: HARNESS_FAULT_PLANT_PREFIX, scanned, deleted, failed, budgetMs,
    ...sweepAnswerTail({ truncated, reason, cursor, unresolved, failedResume }),
  };
};
