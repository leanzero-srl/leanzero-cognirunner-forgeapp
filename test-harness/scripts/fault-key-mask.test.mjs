/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */
/* ═══════════════════════════════════════════════════════════════════════════════
 * F-775 — A HARNESS FAULT KEY IS PRINTED AS ITS FAMILY, NEVER AS ITS SUBJECT.
 *
 * `armHarnessFault` / `readHarnessFault` answer `{ key, ... }`, and for several families
 * the key IS the subject the fault was armed on. `harness_fault:hook-promote:<connectionId>:
 * <owner/name>` names a Git connection and a repository path, and
 * `git-rotation-window-live.mjs` stringified those answers whole at seven places — so the
 * pair accumulated in terminal scrollback across runs, against the convention its siblings
 * state in a comment and keep (`plant-sweep-live`'s `shape()`, `delete-fault-drain-live`'s
 * `armFacts`: neither records a key at all).
 *
 * There is no SECRET in a fault key, which is exactly why the answer is a MASK and not a
 * deletion: a reader comparing two runs has to be able to tell they faulted the same
 * subject. So the family survives — it is a constant of the source, not a fact about a
 * tenant — and the subject becomes a stable digest of itself.
 *
 * The assertions below are in three groups, and the middle one is the point:
 *   1. the shape is right;
 *   2. NEITHER identifier survives, in any part of the output — a mask asserted only by
 *      "it looks different now" is a mask nobody has checked;
 *   3. it is STABLE and DISCRIMINATING, because a handle that changes per run cannot
 *      correlate anything and one that collides cannot distinguish anything.
 * ═══════════════════════════════════════════════════════════════════════════════ */
import assert from "node:assert/strict";
import { maskFaultKey, redactSecrets, redactString } from "../lib/redact.mjs";

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) { pass++; } else { fail++; console.log(`  FAIL ${what}`); } };

/* The real key shape, built the way `harnessFaultKey(kind, ...parts)` builds it. */
const CONN = "conn-9f14c4dd67d3c";
const REPO = "leanzero-srl/cognirunner-forge-offshoot";
const KEY = `harness_fault:hook-promote:${CONN}:${REPO}`;

/* ── 1 · THE SHAPE ──────────────────────────────────────────────────────────── */
{
  const masked = maskFaultKey(KEY);
  ok(/^harness_fault:hook-promote:[0-9a-f]{16}$/.test(masked),
    `F-775: the mask is family + sha256-16 and nothing else (got ${masked})`);
  ok(masked.startsWith("harness_fault:hook-promote:"),
    "F-775: the FAMILY survives — it is a constant of src/harness-fault.js, not a fact about a tenant, and a reader needs it to know which lever this was");

  /* Other families in the same keyspace mask the same way — the helper keys off the
     grammar, not off a list of kinds that the next lever would have to be added to. */
  ok(/^harness_fault:key-read:[0-9a-f]{16}$/.test(maskFaultKey("harness_fault:key-read:openai")),
    "F-775: the key-read family masks too");
  ok(/^harness_fault:delete:[0-9a-f]{16}$/.test(maskFaultKey("harness_fault:delete:harness_fault:plant:")),
    "F-775: …and so does the delete lever, whose subject is itself a colon-bearing prefix — the subject is everything after the KIND, not the next colon");
}

/* ── 2 · NEITHER IDENTIFIER SURVIVES ────────────────────────────────────────── */
{
  const masked = maskFaultKey(KEY);
  ok(!masked.includes(CONN), "F-775: the connection id is gone");
  ok(!masked.includes(REPO), "F-775: the repository path is gone");
  ok(!masked.includes("leanzero-srl") && !masked.includes("cognirunner-forge-offshoot"),
    "F-775: …including each HALF of the repo path on its own — `owner/name` is two facts, and masking only the pair would leak both");
  ok(!masked.includes("/"), "F-775: no path separator survives, so nothing downstream can be parsed back into an owner and a name");

  /* THE DRIVER'S OWN CALL SITE, in miniature: it masks the key INSIDE the answer and
     prints the rest, so the counts and the window — which are the assertions — are kept. */
  const armAnswer = { ok: true, key: KEY, count: 1, until: "2026-09-14T12:00:00.000Z", ttlSeconds: 300 };
  const printed = JSON.stringify({ ...armAnswer, key: maskFaultKey(armAnswer.key) });
  ok(!printed.includes(CONN) && !printed.includes(REPO),
    "F-775: the printed answer carries neither identifier");
  ok(printed.includes('"count":1') && printed.includes('"ttlSeconds":300'),
    "F-775: …while the facts the driver ASSERTS on — the unit count and the window — are untouched, which is why this is a mask and not a deletion");
}

/* ── 3 · STABLE, AND DISCRIMINATING ─────────────────────────────────────────── */
{
  ok(maskFaultKey(KEY) === maskFaultKey(KEY),
    "F-775: the same subject yields the same handle — a per-run value could correlate nothing and the key would not have been worth keeping");
  ok(maskFaultKey(KEY) !== maskFaultKey(`harness_fault:hook-promote:${CONN}:leanzero-srl/other-repo`),
    "F-775: a different REPO on the same connection is a different handle");
  ok(maskFaultKey(KEY) !== maskFaultKey(`harness_fault:hook-promote:conn-other:${REPO}`),
    "F-775: …and a different CONNECTION on the same repo is too — both halves are in the digest");
  ok(maskFaultKey(KEY) !== maskFaultKey(`harness_fault:key-read:${CONN}:${REPO}`),
    "F-775: the same subject under a different FAMILY is a different string, because the family is printed and not hashed");

  /* IDEMPOTENCE, the property `maskEmail` next door documents and this shares: an already
     masked key must pass through a second writer unchanged, or a value that crosses two
     boundaries would be hashed twice and stop correlating with its own first print. */
  const once = maskFaultKey(KEY);
  ok(maskFaultKey(once) === once,
    "F-775: masking an already-masked key yields itself — a digest is [0-9a-f]{16}, hashing it again would produce a THIRD value for one subject");

  /* THE COST OF THAT GUARD, ASSERTED SO IT IS NOT A SURPRISE. Idempotence is recognised by
     SHAPE, so a real subject of exactly 16 lowercase hex would pass through unmasked. No
     family in src/harness-fault.js can produce one — every real subject below carries a
     colon, a slash, or a non-hex letter — and this is the assertion that would go red if a
     new lever were keyed on a bare hex id. */
  const REAL_SUBJECTS = [
    `${CONN}:${REPO}`,            // hook-promote
    "openai",                     // key-read
    "anthropic",                  // key-read
    "harness_fault:plant:",       // delete
    "/rest/api/3/user/search",    // jira
  ];
  ok(REAL_SUBJECTS.every((s) => !/^[0-9a-f]{16}$/.test(s)),
    "F-775: no REAL fault subject has the shape of a digest, so the idempotence guard cannot swallow a live one — a new lever keyed on a bare hex id would fail here and need a different marker");
  ok(REAL_SUBJECTS.every((s) => maskFaultKey(`harness_fault:kind:${s}`) !== `harness_fault:kind:${s}`),
    "F-775: …and each of them is in fact masked");
}

/* ── 4 · IT IS NOT PART OF THE SECRET BOUNDARY, AND MUST NOT BECOME IT ──────── */
{
  /* `redactString`/`redactSecrets` apply themselves to EVERY string that passes. Folding a
     fault-key rule into them would rewrite assertions that legitimately print a PREFIX —
     `harness_fault:plant:` is the entire subject of `armDeleteFault`'s `bad-prefix`
     refusal, and `plant-sweep-live` counts rows by testing `startsWith` on it. */
  ok(redactString(KEY) === KEY,
    "F-775: the deep-redact leaves a fault key ALONE — it is the secret boundary, and a fault key is a convention breach, not a credential");
  ok(JSON.stringify(redactSecrets({ key: KEY })).includes(KEY),
    "F-775: …the same through redactSecrets, so masking stays a DELIBERATE call at the site that prints, which is also what keeps it greppable");
  ok(redactString("harness_fault:plant:") === "harness_fault:plant:",
    "F-775: …and the plant PREFIX, which two drivers assert on by name, is untouched — this is the regression an automatic rule would have caused");
}

/* ── 5 · IT REFUSES NOTHING AND THROWS ON NOTHING ───────────────────────────── */
{
  ok(maskFaultKey("not-a-fault-key") === "not-a-fault-key",
    "F-775: a string that is not a fault key is returned unchanged rather than mangled — the helper is applied inside an answer-printer that sees other shapes");
  ok(maskFaultKey("") === "", "F-775: the empty string survives");
  ok(maskFaultKey(null) === "" && maskFaultKey(undefined) === "",
    "F-775: null/undefined answer the empty string rather than throwing — a print helper that can throw turns a reported failure into a stack trace");
  ok(maskFaultKey("harness_fault:hook-promote:") === "harness_fault:hook-promote:",
    "F-775: a key with an EMPTY subject is not a key to mask — there is nothing in it to hide, and a digest of '' would read as a real handle");
}

console.log(`fault-key-mask (F-775): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
