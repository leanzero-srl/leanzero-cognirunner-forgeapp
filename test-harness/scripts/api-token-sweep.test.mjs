/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * THE SWEEP FILTER, OFFLINE — F-812.
 *
 * `scripts/api-token-sweep.mjs` revokes live REST bearers on a shared tenant. The one
 * thing that decides WHICH rows it touches is `staleTokens(rows, pattern)`, and that
 * decision is testable without a live run: the input is `getApiTokens().tokens`, whose
 * shape is fixed by `publicRow` in `src/rules-api.js`. So it is tested here, against a
 * RECORDED list, and the live tool is never run to find out what it would do.
 *
 * WHAT THE FIXTURE IS. A transcription of the staging shape F-812 describes: the seven
 * `shadow-door <epoch-ms>` rows the broken driver left, a couple of other drivers'
 * generated names, an already-revoked row of the same shape, and — the rows that matter —
 * two tokens a HUMAN would have made, one of which deliberately contains the words
 * "shadow door". The `hash` field is absent because `publicRow` does not return it; the
 * `prefix` IS present, because the resolver returns it, and the test below proves the
 * printer drops it.
 *
 * WHY THE HUMAN ROWS ARE THE POINT. Everything in this file is one question: can a sweep
 * written to clean up after a harness bug take away a key somebody's integration is using
 * right now. The pattern is anchored at BOTH ends and demands digits precisely so that
 * "shadow door notes" and "Shadow-Door prod" are not candidates, and those two rows are
 * in the fixture to keep that true.
 */

import {
  staleTokens, SHADOW_DOOR_NAME, namePrefixPattern, sweepRow, SWEEP_FIELDS,
  answerOf, createTokenLease, withApiToken, MINT_RESOLVER, REVOKE_RESOLVER,
} from "../lib/api-token-lease.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

/* ── THE RECORDED LIST ────────────────────────────────────────────────────────────
   `getApiTokens().tokens`, i.e. `publicRow` rows. Named times, so a reader can tell the
   leak (seven runs of one driver) from the rest. */
const RECORDED = [
  { id: "tok_a1", name: "shadow-door 1757000000001", prefix: "cgr_aaaaaa", createdAt: "2026-09-01T10:00:00.000Z", createdBy: "acc1", role: "admin", lastUsedAt: null, revokedAt: null },
  { id: "tok_a2", name: "shadow-door 1757000000002", prefix: "cgr_bbbbbb", createdAt: "2026-09-02T10:00:00.000Z", createdBy: "acc1", role: "admin", lastUsedAt: null, revokedAt: null },
  { id: "tok_a3", name: "shadow-door 1757000000003", prefix: "cgr_cccccc", createdAt: "2026-09-03T10:00:00.000Z", createdBy: "acc1", role: "admin", lastUsedAt: null, revokedAt: null },
  { id: "tok_a4", name: "shadow-door 1757000000004", prefix: "cgr_dddddd", createdAt: "2026-09-04T10:00:00.000Z", createdBy: "acc1", role: "admin", lastUsedAt: null, revokedAt: null },
  { id: "tok_a5", name: "shadow-door 1757000000005", prefix: "cgr_eeeeee", createdAt: "2026-09-05T10:00:00.000Z", createdBy: "acc1", role: "admin", lastUsedAt: null, revokedAt: null },
  { id: "tok_a6", name: "shadow-door 1757000000006", prefix: "cgr_ffffff", createdAt: "2026-09-06T10:00:00.000Z", createdBy: "acc1", role: "admin", lastUsedAt: null, revokedAt: null },
  { id: "tok_a7", name: "shadow-door 1757000000007", prefix: "cgr_111111", createdAt: "2026-09-07T10:00:00.000Z", createdBy: "acc1", role: "admin", lastUsedAt: null, revokedAt: null },
  /* the SAME shape, already revoked — a sweep that "revokes" it again reports work it
     did not do, and the second read cannot tell the two apart */
  { id: "tok_a0", name: "shadow-door 1756000000000", prefix: "cgr_222222", createdAt: "2026-08-20T10:00:00.000Z", createdBy: "acc1", role: "admin", lastUsedAt: null, revokedAt: "2026-08-20T11:00:00.000Z" },
  /* other drivers' generated names — NOT the default cohort */
  { id: "tok_b1", name: "parity-editor-l8x2k1", prefix: "cgr_333333", createdAt: "2026-09-08T10:00:00.000Z", createdBy: "acc1", role: "editor", lastUsedAt: null, revokedAt: null },
  { id: "tok_b2", name: "parity-admin-l8x2k2", prefix: "cgr_444444", createdAt: "2026-09-08T10:00:01.000Z", createdBy: "acc1", role: "admin", lastUsedAt: null, revokedAt: null },
  /* THE ROWS THIS WHOLE FILE EXISTS FOR */
  { id: "tok_h1", name: "shadow door notes", prefix: "cgr_555555", createdAt: "2026-07-01T10:00:00.000Z", createdBy: "acc9", role: "editor", lastUsedAt: "2026-09-10T08:00:00.000Z", revokedAt: null },
  { id: "tok_h2", name: "Shadow-Door prod integration", prefix: "cgr_666666", createdAt: "2026-06-01T10:00:00.000Z", createdBy: "acc9", role: "admin", lastUsedAt: "2026-09-13T08:00:00.000Z", revokedAt: null },
];

/* ── THE DEFAULT COHORT ───────────────────────────────────────────────────────── */
{
  const hit = staleTokens(RECORDED, SHADOW_DOOR_NAME);
  ok(hit.length === 7, `the default pattern finds the SEVEN leaked rows and no more (${hit.length}): ${hit.map((t) => t.id).join(", ")}`);
  ok(hit.every((t) => /^shadow-door \d+$/.test(t.name)), "…and every one of them is the generated shape");
  ok(!hit.some((t) => t.id === "tok_a0"), "the already-revoked row of the SAME name shape is NOT a candidate — a re-revoke is work reported that was not done, and the second read could not tell it apart");
  ok(!hit.some((t) => t.id === "tok_h1"), 'a human token called "shadow door notes" is NOT swept — the pattern demands the hyphen and the digits');
  ok(!hit.some((t) => t.id === "tok_h2"), 'nor is "Shadow-Door prod integration" — the pattern is case-sensitive and anchored at BOTH ends');
  ok(!hit.some((t) => t.id.startsWith("tok_b")), "nor is another driver's cohort — a sweep aimed at one leak does not clean the directory");
}

/* THE ANCHORS, one at a time, because each end was a decision. */
{
  const rows = [
    { id: "x1", name: "shadow-door 123", revokedAt: null },
    { id: "x2", name: "a shadow-door 123", revokedAt: null },
    { id: "x3", name: "shadow-door 123 (keep)", revokedAt: null },
    { id: "x4", name: "shadow-door", revokedAt: null },
    { id: "x5", name: "shadow-door abc", revokedAt: null },
    { id: "x6", name: "shadow-door 123456789012345", revokedAt: null },
  ];
  const got = staleTokens(rows, SHADOW_DOOR_NAME).map((t) => t.id);
  ok(got.join(",") === "x1,x6", `only the exact generated shape matches (got ${got.join(",") || "none"}) — a LEADING word, a TRAILING word, a missing timestamp and a non-numeric one are all excluded`);
}

/* A row with no name, a null row, a non-array: the list comes off the wire and the filter
   is the last thing standing between a malformed answer and a revoke. */
{
  ok(staleTokens(null).length === 0, "a non-array list sweeps NOTHING rather than throwing halfway through a revoke loop");
  ok(staleTokens([null, undefined, {}, { id: "z", name: null, revokedAt: null }]).length === 0,
    "a row with no name is not a candidate — `undefined` must never be pattern-matched into one");
  ok(staleTokens([{ id: "z", name: "shadow-door 1", revokedAt: undefined }]).length === 1,
    "…while an ABSENT revokedAt is live, which is how a freshly minted row reads");
}

/* ── THE PREFIX ARM ───────────────────────────────────────────────────────────── */
{
  const hit = staleTokens(RECORDED, namePrefixPattern("parity-"));
  ok(hit.map((t) => t.id).join(",") === "tok_b1,tok_b2", `--name-prefix=parity- selects that cohort and only it (${hit.map((t) => t.id).join(",")})`);
  ok(staleTokens(RECORDED, namePrefixPattern("shadow-door ")).length === 7,
    "…and a prefix can also express the default cohort, though less precisely — this is why the DEFAULT is the anchored pattern and not a prefix");
  let threw = null;
  try { namePrefixPattern(""); } catch (e) { threw = e; }
  ok(threw !== null, "an EMPTY --name-prefix= is REFUSED — the one input that would match every token on the tenant is the one that must not be silently obeyed");
  try { namePrefixPattern(null); threw = null; } catch (e) { threw = e; }
  ok(threw !== null, "…and so is a missing one");
  /* A prefix is a LITERAL, not a pattern: an operator typing a dot or a star must not
     widen the match. `.` would otherwise match any character. */
  const rows = [{ id: "p1", name: "a-b", revokedAt: null }, { id: "p2", name: "axb", revokedAt: null }];
  ok(staleTokens(rows, namePrefixPattern("a.b")).length === 0,
    "a regex metacharacter in the prefix is ESCAPED — `a.b` does not match `axb`, and `.*` does not match the tenant");
}

/* ── WHAT MAY BE PRINTED ──────────────────────────────────────────────────────── */
{
  const row = sweepRow(RECORDED[0]);
  ok(Object.keys(row).join(",") === "id,name,role,createdAt,revokedAt", `the printed row is exactly the five agreed fields (${Object.keys(row).join(",")})`);
  ok(!("prefix" in row), "the PREFIX is dropped — it is the first ten characters of a live bearer, it is what a reader pastes into a ticket, and the id identifies the row just as well");
  ok(!("hash" in row) && !("token" in row), "and there is no token or hash anywhere in a printed row");
  ok(!JSON.stringify(row).includes("cgr_"), "no `cgr_` string survives into the printed line — the cheap net over all of the above");
  ok(SWEEP_FIELDS.length === 5 && Object.isFrozen(SWEEP_FIELDS), "the field list is frozen, so a print site cannot widen it in place");
  ok(sweepRow(undefined).id === null, "a missing row prints nulls rather than throwing inside the loop that reports the sweep");
}

/* ── THE LEASE ITSELF ─────────────────────────────────────────────────────────────
   The other half of F-812. These are pure-function tests over a fake `invoke`, so the
   mint/revoke pair is exercised without a tenant. */
{
  ok(answerOf({ body: { success: true } }).success === true, "answerOf reads the `{body}` transport shape (va-shadow-door)");
  ok(answerOf({ json: { success: true } }).success === true, "…and the `{json}` one (parity-doors), which is why adopting the lease does not mean rewriting a driver's transport");
  ok(answerOf({ status: 500, body: null }) === null, "…and a transport whose payload did not parse is null, not a crash");
  ok(answerOf(null) === null && answerOf("x") === null, "…as is a non-object answer");
}
{
  /* A fake tenant: mint hands out ids, revoke records them. */
  const made = [], revoked = [];
  const invoke = async (fn, payload) => {
    if (fn === MINT_RESOLVER) {
      const id = `tok_${made.length + 1}`;
      made.push(id);
      return { body: { success: true, token: "cgr_" + "0".repeat(48), row: { id, name: payload.name, role: payload.role || null } } };
    }
    if (fn === REVOKE_RESOLVER) { revoked.push(payload.id); return { body: { success: true, revoked: true } }; }
    throw new Error("unexpected resolver " + fn);
  };
  const r = await withApiToken(invoke, { name: "x", role: "admin" }, async ({ token }) => {
    ok(token.startsWith("cgr_"), "withApiToken hands the plaintext to the callback, and to nobody else");
    return 42;
  });
  ok(r.value === 42, "…returns the callback's value");
  ok(r.revoke.revoked === true && r.revoke.id === "tok_1", "…and RETURNS THE REVOKE ANSWER, so the caller can assert the release instead of assuming it");
  ok(revoked.join(",") === "tok_1", "…having actually called the revoke door");

  /* THE ARM THAT F-812 IS: the callback THROWS and the token is still released. */
  let caught = null;
  try {
    await withApiToken(invoke, { name: "y" }, async () => { throw new Error("STEP 3 blew up"); });
  } catch (e) { caught = e; }
  ok(caught && /STEP 3 blew up/.test(caught.message), "a throw inside the scope is RETHROWN — the driver still fails");
  ok(revoked.join(",") === "tok_1,tok_2", "…and the token was revoked anyway, which is the whole finding: a crashed run must not leave a live admin bearer");
  ok(caught && caught.tokenRevoke && caught.tokenRevoke.revoked === true, "…with the revoke row attached to the error, so a crash report can still say what was released");

  const lease = createTokenLease(invoke);
  await lease.mint({ name: "a" });
  lease.track("tok_external");
  await lease.mint({ name: "b" });
  ok(lease.ids.join(",") === "tok_3,tok_external,tok_4", "the lease register holds minted AND tracked ids in order (a hook-minted token is tracked, not minted, through it)");
  const answers = await lease.revokeAll();
  ok(answers.length === 3 && answers.every((a) => a.revoked), "revokeAll releases every one and returns a graded row per token");
  ok(answers.map((a) => a.id).join(",") === "tok_4,tok_external,tok_3", "…newest first, so the most recent mint is the first thing released");
}
{
  /* The release path must survive a tenant that says no — a restore block cannot be
     allowed to throw past the rest of its own cleanup (parity-doors' bare `await invoke`
     could, and the residue assertion after it would never have run). */
  const angry = async (fn) => { if (fn === REVOKE_RESOLVER) throw new Error("ECONNRESET"); throw new Error("unexpected " + fn); };
  const lease = createTokenLease(angry);
  lease.track("tok_x");
  const answers = await lease.revokeAll();
  ok(answers.length === 1 && answers[0].revoked === false && /ECONNRESET/.test(answers[0].error),
    "a transport failure comes back as a GRADED row, never as a throw out of the finally");
  const refusing = async () => ({ body: { success: false, error: "not an admin" } });
  const l2 = createTokenLease(refusing);
  l2.track("tok_y");
  const a2 = await l2.revokeAll();
  ok(a2[0].revoked === false && /not an admin/.test(a2[0].error), "…and a REFUSAL is reported with the door's own reason");
  const missing = async () => ({ body: { success: true, revoked: false } });
  const l3 = createTokenLease(missing);
  l3.track("tok_z");
  ok((await l3.revokeAll())[0].revoked === false,
    "…and `revoked: false` — the resolver's word for \"no such row\" — is NOT read as success: a token the driver believes it minted and the app has never heard of is a finding");
}
{
  /* A refused MINT must not leak the body: on the success path `createApiToken` puts the
     plaintext at the TOP LEVEL of that same body (F-646). */
  const leaky = async () => ({ body: { success: false, error: "Token limit reached (25). Revoke unused tokens first.", token: "cgr_" + "9".repeat(48) } });
  const lease = createTokenLease(leaky);
  let caught = null;
  try { await lease.mint({ name: "x", role: "admin" }); } catch (e) { caught = e; }
  ok(caught !== null, "a refused mint THROWS rather than returning a half-token the driver would then use");
  ok(caught && /Token limit reached/.test(caught.message), "…naming the door's own reason");
  ok(caught && !caught.message.includes("cgr_"), "…and NEVER the body: the mint answer is exactly where a plaintext bearer lives");
  ok(lease.ids.length === 0, "…and a mint that failed registers nothing to revoke");
}

console.log(`api-token-sweep.test.mjs: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
