/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * F-654 — THE SELECTION AND THE RESTORE, ON A MOCK ROSTER.
 *
 * WHAT THIS PROVES, AND WHY IT IS A UNIT TEST. The defect it guards is a LIVE one: the
 * knowledge-doors driver granted an app role to a namesake by POSITION and only learned
 * afterwards that it had missed. You cannot regression-test that on the tenant — the
 * failing path IS the damage. So the two decisions are pulled into `lib/roster-restore.mjs`
 * as pure functions and asserted here against a roster built to be exactly as nasty as
 * wolfaenpak's: THREE rows whose display name is identical, in an unstable order, where
 * the only thing that tells them apart is the F-647 `.perm-ident-id` title.
 *
 * The five things asserted:
 *   1. the target is found by its discriminator, at whatever index it happens to sit;
 *   2. reordering the rows changes the INDEX and not the CHOICE — this is the whole cut;
 *   3. a roster with no discriminator, or with no matching row, returns index -1 with a
 *      reason (the caller's N/V), and NEVER a fallback click on a namesake;
 *   4. a STRAY grant that a run left behind is planned for removal even though nothing
 *      in the run "remembers" adding it;
 *   5. a row the run DELETED is planned for re-add — the arm the old `finally` had no
 *      concept of at all.
 *
 * Run: node scripts/roster-restore.test.mjs (auto-discovered by run-offline.mjs)
 */

import {
  rosterIdOf, idTail, selectByDiscriminator, planRosterRestore, rosterRestoreVerdict, describePlan,
} from "../lib/roster-restore.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

/* The three namesakes. TARGET is the one under test; the other two are REAL accounts that
   a positional click would hit, which is precisely what happened live. */
const TARGET = "557058:653160a5-6112-470d-baea-333ac760364e";
const NAMESAKE_A = "557058:aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const NAMESAKE_B = "712020:bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const ADMIN = "557058:ffffffff-9999-4999-8999-ffffffffffff";

const row = (id, extra = {}) => ({
  i: extra.i,
  name: "Mihai Perdum",
  idShown: idTail(id),
  idTitle: id,
  disabled: false,
  ...extra,
});
const searchRows = (ids, extra = {}) => ids.map((id, i) => row(id, { i, ...(extra[id] || {}) }));

/* ── 1. the discriminator finds the target wherever it sits ──────────────────── */
{
  const rows = searchRows([NAMESAKE_A, TARGET, NAMESAKE_B]);
  const s = selectByDiscriminator(rows, TARGET);
  eq([s.index, s.how], [1, "idTitle"], "the target is selected at its real index by idTitle");
  eq(s.row.idTitle, TARGET, "the selected row IS the target");
}

/* ── 2. THE CUT: reorder the rows, the index moves, the choice does not ──────── */
{
  const orders = [
    [TARGET, NAMESAKE_A, NAMESAKE_B],
    [NAMESAKE_A, NAMESAKE_B, TARGET],
    [NAMESAKE_B, TARGET, NAMESAKE_A],
  ];
  const chosen = orders.map((o) => {
    const s = selectByDiscriminator(searchRows(o), TARGET);
    return { index: s.index, id: s.row && s.row.idTitle };
  });
  eq(chosen.map((c) => c.id), [TARGET, TARGET, TARGET], "every row order selects the SAME account");
  eq(chosen.map((c) => c.index), [0, 2, 1], "...at a DIFFERENT index each time — which is why position could never be the key");
  /* The old loop's behaviour, stated so the regression is visible: "the first enabled
     row" is a different account in two of these three orders. */
  ok(searchRows(orders[1])[0].idTitle !== TARGET, "positional selection ('first enabled row') would have hit a namesake in order 2");
}

/* ── 3. no discriminator / no match / ambiguity => N/V, never a click ────────── */
{
  const noChip = searchRows([NAMESAKE_A, TARGET, NAMESAKE_B]).map((r) => ({ i: r.i, name: r.name, idShown: null, idTitle: null }));
  const s1 = selectByDiscriminator(noChip, TARGET);
  ok(s1.index === -1, "a build without the F-647 chip yields index -1, not a guess");
  ok(/discriminator/.test(s1.reason), `...and names the reason (got: ${s1.reason})`);

  const absent = selectByDiscriminator(searchRows([NAMESAKE_A, NAMESAKE_B]), TARGET);
  ok(absent.index === -1, "a search that does not contain the target yields index -1");
  ok(!/Mihai/.test(String(absent.reason)) || absent.index === -1, "...and never falls back to the shared display name");

  const dup = selectByDiscriminator(searchRows([TARGET, TARGET]), TARGET);
  ok(dup.index === -1 && dup.ambiguous === true, "two rows carrying the same full id is AMBIGUOUS, not 'take the first'");

  const already = selectByDiscriminator(searchRows([NAMESAKE_A, TARGET], { [TARGET]: { disabled: true } }), TARGET);
  ok(already.index === -1 && already.disabledHit === true, "a target already on the roster is not clickable and is reported as such");
  ok(selectByDiscriminator(searchRows([NAMESAKE_A, TARGET], { [TARGET]: { disabled: true } }), TARGET, { allowDisabled: true }).index === 1,
    "...but a REMOVE, which wants the on-roster card, opts in with allowDisabled");

  ok(selectByDiscriminator([], TARGET).index === -1, "an empty search is N/V");
  ok(selectByDiscriminator(searchRows([TARGET]), null).index === -1, "a missing target id is N/V");
}

/* ── 3b. the chip fallback is used only when it is UNIQUE ────────────────────── */
{
  const titleless = searchRows([NAMESAKE_A, TARGET]).map((r) => ({ ...r, idTitle: null }));
  const s = selectByDiscriminator(titleless, TARGET);
  eq([s.index, s.how], [1, "idShown"], "with no title, the unique visible id segment selects the row");
  const collide = [
    { i: 0, idTitle: null, idShown: idTail(TARGET) },
    { i: 1, idTitle: null, idShown: idTail(TARGET) },
  ];
  ok(selectByDiscriminator(collide, TARGET).ambiguous === true, "a colliding segment is ambiguous, not a coin flip");
}

/* ── 4. THE STRAY: a wrong grant nobody remembers making ─────────────────────── */
{
  const snapshot = [
    { accountId: ADMIN, displayName: "Mihai Perdum", emailAddress: "mihai@wolfaenpak.com", role: "admin", scope: "all" },
    { accountId: NAMESAKE_B, displayName: "Mihai Perdum", role: "editor", scope: "all" },
  ];
  /* The tenant as a crashed run leaves it: the intended grant AND a mis-clicked namesake. */
  const current = [
    ...snapshot,
    { accountId: NAMESAKE_A, displayName: "Mihai Perdum", role: "editor", scope: "own" },
    { accountId: TARGET, displayName: "Mihai Perdum", role: "editor", scope: "own" },
  ];
  const plan = planRosterRestore(snapshot, current);
  eq(plan.strays.map(rosterIdOf).sort(), [TARGET, NAMESAKE_A].sort(), "BOTH the intended grant and the STRAY namesake are planned for removal");
  eq(plan.missing, [], "nothing is missing in this arm");
  ok(plan.clean === false, "the roster is not clean");
  ok(rosterRestoreVerdict(snapshot, current).ok === false, "the second-read verdict refuses this roster");

  /* Apply the plan the way the driver does — remove every stray — and re-read. */
  const strayIds = new Set(plan.strays.map(rosterIdOf));
  const after = current.filter((r) => !strayIds.has(rosterIdOf(r)));
  const v = rosterRestoreVerdict(snapshot, after);
  ok(v.ok === true && v.verdict === "byte-identical", `applying the plan restores the roster byte-for-byte (got: ${v.verdict})`);
}

/* ── 5. THE DELETION: a snapshot row the run removed must be RE-ADDED ────────── */
{
  const snapshot = [
    { accountId: ADMIN, displayName: "Mihai Perdum", emailAddress: "mihai@wolfaenpak.com", role: "admin", scope: "all" },
    { accountId: NAMESAKE_A, displayName: "Mihai Perdum", role: "editor", scope: "own" },
    { accountId: NAMESAKE_B, displayName: "Mihai Perdum", role: "editor", scope: "all" },
  ];
  /* A positional remove took out the wrong card, and a stray grant is still sitting there. */
  const current = [
    snapshot[0],
    snapshot[2],
    { accountId: TARGET, displayName: "Mihai Perdum", role: "editor", scope: "own" },
  ];
  const plan = planRosterRestore(snapshot, current);
  eq(plan.missing.map(rosterIdOf), [NAMESAKE_A], "the row the run DELETED is planned for re-add");
  eq(plan.strays.map(rosterIdOf), [TARGET], "...and the stray grant is planned for removal in the same plan");
  eq(plan.missing[0].role + "/" + plan.missing[0].scope, "editor/own", "the re-add carries the ROLE AND SCOPE the snapshot held, not a default");

  const strayIds = new Set(plan.strays.map(rosterIdOf));
  const rebuilt = current.filter((r) => !strayIds.has(rosterIdOf(r))).concat(plan.missing);
  const p2 = planRosterRestore(snapshot, rebuilt);
  eq([p2.strays.length, p2.missing.length, p2.changed.length], [0, 0, 0], "after apply, no account is stray, missing or changed");
  /* Honest about the residue: the UI appends, so the re-added row lands last. That is a
     different stored VALUE and the verdict says so rather than calling it a pass. */
  const v = rosterRestoreVerdict(snapshot, rebuilt);
  ok(v.ok === false && v.verdict === "same rows, different order", `an order-only residue is reported, not swallowed (got: ${v.verdict})`);
  const v2 = rosterRestoreVerdict(snapshot, [snapshot[0], plan.missing[0], snapshot[2]]);
  ok(v2.ok === true, "re-inserting at the snapshot position is byte-identical and passes");
}

/* ── 6. a CHANGED row: same account, different role ──────────────────────────── */
{
  const snapshot = [{ accountId: TARGET, role: "editor", scope: "all" }];
  const current = [{ accountId: TARGET, role: "editor", scope: "own" }];
  const plan = planRosterRestore(snapshot, current);
  eq(plan.changed.map((c) => c.accountId), [TARGET], "a scope change on an existing row is caught");
  eq(plan.changed[0].before.scope, "all", "...and the plan carries the snapshot value to restore");
  ok(plan.strays.length === 0 && plan.missing.length === 0, "a changed row is not double-counted as stray+missing");
}

/* ── 7. shapes: bare-string rows, and the printable plan carries NO PII ──────── */
{
  ok(rosterIdOf(TARGET) === TARGET, "a bare string row yields its own id");
  ok(rosterIdOf({ accountId: TARGET }) === TARGET, "an object row yields accountId");
  ok(rosterIdOf(null) === null && rosterIdOf({}) === null, "a shapeless row yields null rather than throwing");
  const legacy = planRosterRestore([TARGET], [TARGET, NAMESAKE_A]);
  eq(legacy.strays, [NAMESAKE_A], "string-shaped rosters diff the same way");

  const plan = planRosterRestore(
    [{ accountId: ADMIN, displayName: "Mihai Perdum", emailAddress: "mihai@wolfaenpak.com", role: "admin" }],
    [{ accountId: NAMESAKE_A, displayName: "Mihai Perdum", emailAddress: "mihai@wolfaenpak.com", role: "editor" }],
  );
  const printable = JSON.stringify(describePlan(plan));
  ok(!/@/.test(printable), "F-652: the printable plan carries NO email address");
  ok(!/Perdum/.test(printable), "F-652: ...and no display name");
  ok(printable.includes(idTail(NAMESAKE_A)), "...but it still names the account by its id tail, so the operator can act on it");
  ok(!printable.includes(NAMESAKE_A), "...as the TAIL, not the full account id");
}

console.log(`roster-restore.test.mjs: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
