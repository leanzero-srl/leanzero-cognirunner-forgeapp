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
 * `harnessEnabled()`, and ALL FIVE storage-touching exports ask it on their FIRST
 * statement, before any storage call: `harnessFaultArmed` returns false,
 * `armHarnessFault`, `disarmHarnessFault` and `armKeyReadFault` (F-629) return
 * `{ ok: false, reason: "harness-off" }`, and `readHarnessFault` returns `null`. So on a
 * production deployment this module performs no KVS read and no KVS write, and cannot
 * change any outcome, no matter who imports it. (`keyReadFaultMode` touches storage only
 * THROUGH `readHarnessFault`, so it inherits the gate rather than restating it — which is
 * the shape any sixth export should copy.)
 *
 * THAT SENTENCE WAS FALSE TWICE. F-517 gated the arming side and the docblock went on
 * claiming the whole-module property while `disarmHarnessFault` still issued an ungated
 * DELETE and `readHarnessFault` an ungated GET — two of four exports, one of them a write.
 * F-522 closed them. A file whose premise is "one home, one gate" cannot satisfy it in
 * half its exports and say so in prose. Asserted offline by stubbing the env
 * (async-handler-helpers.test.mjs counts every KVS operation on the fault key across all
 * four exports and expects zero).
 *
 * SHAPE: `harness_fault:<kind>:<part>:<part>…`, value `{ count, armedAt }`, TTL 10 min so
 * an armed lever that is never consumed disarms itself. Every part goes through
 * `safeKeyPart`/`assertKvsKey` (F-334): a delivery id is a clamped but otherwise raw
 * provider header and must never shape a key.
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

/** TTL of an armed lever. Short on purpose: a forgotten arm must not outlive the test. */
export const HARNESS_FAULT_TTL = { value: 10, unit: "MINUTES" };

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
 * builds and NEVER in production, exactly as in src/test-hook.js. ALL FIVE exports that
 * touch storage ask this — `harnessFaultArmed` (consume), `armHarnessFault` (F-517),
 * `disarmHarnessFault` and `readHarnessFault` (F-522), `armKeyReadFault` (F-629) — and
 * each asks it as its FIRST statement, before any storage call, so a production
 * deployment performs no KVS access through this module at all. Adding a SIXTH
 * storage-touching export means adding this line to it; the offline test counts
 * operations, so a new one that forgets shows up as a non-zero count rather than as a
 * comment nobody read. (`keyReadFaultMode` is not one: it touches storage only through
 * `readHarnessFault` and so inherits the gate instead of restating it.)
 */
export const harnessEnabled = () => Boolean(process.env.HARNESS_SECRET);

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
    const row = (await storage.get(key)) || null;
    const count = Number(row && row.count) || 0;
    if (count <= 0) return false;
    if (count <= 1) await storage.delete(key);
    else await storage.set(key, { ...row, count: count - 1 }, { ttl: HARNESS_FAULT_TTL });
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
  await storage.set(key, { count: n, armedAt: new Date().toISOString() }, { ttl: HARNESS_FAULT_TTL });
  return { key, count: n };
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
  return { key, value: (await storage.get(key)) || null };
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
  await storage.set(key, { mode, armedAt: new Date().toISOString() }, { ttl: { value: seconds, unit: "SECONDS" } });
  return { key, mode, ttlSeconds: seconds };
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
