/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * F-769 — THE BEFORE/AFTER CREDENTIAL CHECK, AND WHY IT HAD TO STOP BEING VACUOUS.
 *
 * `key-status-fault-live.mjs` and `key-status-fault-ui-live.mjs` both ended their run with
 * a check whose whole purpose is to say "this run never went near the tenant's credential".
 * Both computed it the same way, in their own private copy of the same eight lines:
 *
 *     const r = await hook(null, "GET", `?what=kvs&key=${slot}`);
 *     const v = r.json ? r.json.value : undefined;
 *     return v === null || v === undefined ? "EMPTY" : "PRESENT";
 *
 * F-769 put a READ CEILING on `?what=kvs`: a credential-family key now answers
 * `{key, present, fingerprint, masked:true}` and there IS no `value`. So after the ceiling
 * `v` is `undefined` on every read, every slot reduces to `"EMPTY"`, and the final
 * assertion compares `"EMPTY" === "EMPTY"` — a check that can no longer fail, printing
 * PASS with the words "the lever never went near a credential" under it. A green check
 * that cannot go red is worse than no check, because a run reports a guarantee it is not
 * making. That is the defect this file is the control for.
 *
 * The witness (lib/key-slot-witness.mjs, ONE home for both drivers) is built from what the
 * ceiling DOES answer — `present` for the state, `fingerprint` for the IDENTITY — and
 * every way of not getting an answer is `UNREADABLE`, which `sameKeySlot` refuses.
 *
 * THE CONTROLS BELOW ARE THE POINT, not the happy path:
 *   · a fingerprint that CHANGES must FAIL (the assertion is not vacuous);
 *   · the pre-ceiling `{key, value}` body must FAIL (a driver pointed at a build without
 *     the ceiling gets a red check, not a comfortable one);
 *   · a non-200, unparsed, unmasked or fingerprint-less answer must FAIL.
 *
 * The transport is a stub: this file opens no sockets and knows no secret.
 *
 * Run: node scripts/key-slot-witness.test.mjs (auto-discovered by run-offline.mjs)
 */

import { readKeySlotWitness, describeKeySlot, sameKeySlot } from "../lib/key-slot-witness.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const SLOT = "COGNIRUNNER_KEY_openai";
/** A stub `?what=kvs` GET: answers one canned body, and records what it was asked. */
const reader = (status, json) => {
  const seen = [];
  const fn = async (qs) => { seen.push(qs); return { status, json }; };
  fn.seen = seen;
  return fn;
};
/** The shape the F-769 ceiling really answers for a credential row. */
const masked = (present, fingerprint) => ({ key: SLOT, present, fingerprint, masked: true });

/* ── 1. THE HAPPY PATH, both states ────────────────────────────────────────────── */
{
  const r = reader(200, masked(true, "0123456789abcdef"));
  const w = await readKeySlotWitness(r, SLOT);
  ok(w.state === "PRESENT", "a masked present:true row is PRESENT (got " + w.state + ")");
  ok(w.fingerprint === "0123456789abcdef", "…and carries the row's sha256-16 identity");
  ok(w.why === null, "…with no reason-it-is-unreadable");
  ok(describeKeySlot(w) === "PRESENT#0123456789abcdef", "the printable form carries the identity, never the value");
  ok(r.seen[0] === `?what=kvs&key=${encodeURIComponent(SLOT)}`,
    "the witness asks the ceiling's own door, with the key encoded (got " + r.seen[0] + ")");

  const e = await readKeySlotWitness(reader(200, masked(false, null)), SLOT);
  ok(e.state === "EMPTY" && e.fingerprint === null, "a masked present:false row is EMPTY with no identity");
  ok(describeKeySlot(e) === "EMPTY", "…and prints as EMPTY");
}

/* ── 2. THE ASSERTION THE DRIVERS MAKE ─────────────────────────────────────────── */
{
  const same = sameKeySlot(
    { key: SLOT, state: "PRESENT", fingerprint: "aaaaaaaaaaaaaaaa", why: null },
    { key: SLOT, state: "PRESENT", fingerprint: "aaaaaaaaaaaaaaaa", why: null },
  );
  ok(same.same === true, "the same row before and after is UNCHANGED — the restore is proven");

  const bothEmpty = sameKeySlot(
    { key: SLOT, state: "EMPTY", fingerprint: null, why: null },
    { key: SLOT, state: "EMPTY", fingerprint: null, why: null },
  );
  ok(bothEmpty.same === true, "EMPTY -> EMPTY is a real yes: the ceiling answered present:false twice, on the same key");
}

/* ── 3. POSITIVE CONTROL · A FINGERPRINT THAT CHANGES MUST FAIL ────────────────────
   THE control this file exists for. A slot that still holds A key but no longer THE key
   is exactly the damage the check is about, and `PRESENT === PRESENT` — all the old
   present/absent reduction could ever have said — reports it as untouched. */
{
  const before = { key: SLOT, state: "PRESENT", fingerprint: "aaaaaaaaaaaaaaaa", why: null };
  const after = { key: SLOT, state: "PRESENT", fingerprint: "bbbbbbbbbbbbbbbb", why: null };
  const v = sameKeySlot(before, after);
  ok(v.same === false, "POSITIVE CONTROL: a CHANGED fingerprint, both states PRESENT, FAILS — the assertion is not vacuous");
  ok(/NOT the same one/.test(v.why || ""), "…and says the slot holds a different key, not merely that something differs");
  ok(!String(v.why).includes("aaaaaaaaaaaaaaaa".repeat(2)), "…and the reason carries fingerprints, which are not values");

  ok(sameKeySlot(before, { key: SLOT, state: "EMPTY", fingerprint: null, why: null }).same === false,
    "POSITIVE CONTROL: a slot EMPTIED across the run FAILS — the `kvSet(k, null)` deletion this whole cut is about");
  ok(sameKeySlot({ key: SLOT, state: "EMPTY", fingerprint: null, why: null }, before).same === false,
    "POSITIVE CONTROL: a slot that GAINED a key across the run FAILS too");
  ok(sameKeySlot(before, { key: "COGNIRUNNER_KEY_azure", state: "PRESENT", fingerprint: "aaaaaaaaaaaaaaaa", why: null }).same === false,
    "POSITIVE CONTROL: two DIFFERENT keys compared is not an answer about either of them");
}

/* ── 4. POSITIVE CONTROL · THE PRE-CEILING BODY, WHICH IS THE BUG ITSELF ───────────
   The exact shape `?what=kvs` returned before F-769. A driver run against a build without
   the ceiling must go RED here rather than quietly reading the value it was given. */
{
  const w = await readKeySlotWitness(reader(200, { key: SLOT, value: "sk-the-tenants-real-key" }), SLOT);
  ok(w.state === "UNREADABLE", "POSITIVE CONTROL: the pre-F-769 `{key, value}` body is UNREADABLE, not PRESENT");
  ok(w.fingerprint === null, "…and yields no identity to compare");
  ok(!JSON.stringify(w).includes("sk-the-tenants-real-key"),
    "…and the VALUE it was handed is nowhere in the witness — the library never carries one, whatever it is given");
  ok(/read ceiling is NOT in place/.test(w.why), "…and names the cause an operator can act on: " + w.why);
  ok(sameKeySlot(w, w).same === false,
    "POSITIVE CONTROL: two UNREADABLE reads do NOT compare equal — this is the vacuous PASS, refused");
}

/* ── 5. EVERY OTHER WAY OF NOT GETTING AN ANSWER ──────────────────────────────────── */
{
  const cases = [
    ["a non-200", reader(404, null), /answered 404/],
    ["a body that did not parse", reader(200, null), /not JSON/],
    ["an answer not marked masked", reader(200, { key: SLOT, present: true, fingerprint: "0123456789abcdef" }), /not marked masked/],
    ["present:true with no fingerprint", reader(200, { key: SLOT, present: true, fingerprint: null, masked: true }), /no sha256-16 fingerprint/],
    ["present:true with a short fingerprint", reader(200, masked(true, "abc")), /no sha256-16 fingerprint/],
    ["present:true with a non-hex fingerprint", reader(200, masked(true, "ZZZZZZZZZZZZZZZZ")), /no sha256-16 fingerprint/],
  ];
  for (const [name, r, why] of cases) {
    const w = await readKeySlotWitness(r, SLOT);
    ok(w.state === "UNREADABLE", `${name} is UNREADABLE (got ${w.state})`);
    ok(why.test(w.why || ""), `…and says why: ${name} -> ${w.why}`);
    ok(sameKeySlot(w, { key: SLOT, state: "PRESENT", fingerprint: "aaaaaaaaaaaaaaaa", why: null }).same === false,
      `…and never compares equal to anything: ${name}`);
  }
  /* A transport that THROWS is an answer too, not a crashed driver: the witness is read
     inside a `finally`, and an exception there would swallow the run's real verdict. */
  const boom = async () => { throw new Error("socket hang up"); };
  const w = await readKeySlotWitness(boom, SLOT);
  ok(w.state === "UNREADABLE" && /socket hang up/.test(w.why),
    "a throwing transport is UNREADABLE with its message, not an exception out of a finally block");
}

/* ── 6. NEITHER DRIVER MAY GROW A SECOND COPY (LAW 1) ───────────────────────────────
   Two copies of this reduction is how the defect shipped twice at once — the two files
   below, byte for byte. Asserted against the DUPLICATION, not against today's behaviour.
   (The WIDER rule — that no driver anywhere reads `.value` off a credential answer, and
   that no driver plants a credential without the stash — is section 4i of
   `evidence-redaction.test.mjs`, which parses the whole directory.) */
{
  const { readFileSync } = await import("node:fs");
  for (const f of ["key-status-fault-live.mjs", "key-status-fault-ui-live.mjs"]) {
    const src = readFileSync(new URL(`./${f}`, import.meta.url), "utf8");
    ok(/from\s+["']\.\.\/lib\/key-slot-witness\.mjs["']/.test(src),
      `${f} reads its credential slot through the ONE home, lib/key-slot-witness.mjs`);
    ok(!/const\s+keySlotFingerprint\s*=/.test(src),
      `${f} does not carry its own copy of the reduction — that is the shape that broke`);
  }
}

console.log("key-slot-witness.test.mjs: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
