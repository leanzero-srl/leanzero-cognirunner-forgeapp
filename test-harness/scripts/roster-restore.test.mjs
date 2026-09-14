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
  rosterRowRole, normaliseRosterRow, isReproducibleRosterRow,
} from "../lib/roster-restore.mjs";
import { DEFAULT_ROSTER_SCOPE } from "../../src/shared/roster-roles.js";

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
     different stored VALUE, and the verdict NAMES it — but it is not a permission state,
     so it is a PASS (F-659). It used to be `ok:false`, which made every re-add a
     permanent red and sent an operator to hand-repair a correct tenant. */
  const v = rosterRestoreVerdict(snapshot, rebuilt);
  ok(v.ok === true && v.verdict === "same set, different order", `an order-only residue is a PASS that still names itself (got: ${v.verdict})`);
  ok(/ORDER/.test(String(v.info)), "...and the info line explains why no click can fix it");
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

/* ── 8. F-658 — THE ROLE OF A LEGACY ROW IS ADMIN, BECAUSE THE PRODUCT SAYS SO ──
   `app_admins` still holds bare strings and role-less objects, and every product read
   (src/index.js:480-481, removeAppAdmin's and updateUserRole's last-admin guards) treats
   both as ADMIN. The restore used to re-add them with `row.role || "viewer"`, and the
   `changed` path fell through to `ROLE_LABEL[role] || ROLE_LABEL.editor` — so restoring a
   legacy row DEMOTED a real site admin. Both legacy shapes are asserted. */
{
  const LEGACY_STRING = ADMIN;
  const LEGACY_OBJECT = { accountId: ADMIN, displayName: "Mihai Perdum" };            // no role, no scope
  const LEGACY_ROLELESS_WITH_SCOPE = { accountId: ADMIN, scope: "own" };              // scope is ignored for an admin

  eq(rosterRowRole(LEGACY_STRING), { role: "admin", scope: "all" }, "a BARE STRING row is an admin with scope all");
  eq(rosterRowRole(LEGACY_OBJECT), { role: "admin", scope: "all" }, "a role-less OBJECT row is an admin with scope all");
  eq(rosterRowRole(LEGACY_ROLELESS_WITH_SCOPE), { role: "admin", scope: "all" },
    "...and an admin's scope is forced to all, exactly as addAppAdmin/updateUserRole do");
  eq(rosterRowRole({ accountId: ADMIN, role: "editor" }), { role: "editor", scope: DEFAULT_ROSTER_SCOPE },
    "F-840: a non-admin row with NO scope defaults to `own` — ONE default, shared by the product read AND addAppAdmin");
  eq(rosterRowRole({ accountId: ADMIN, role: "editor", scope: "own" }), { role: "editor", scope: "own" },
    "an explicit role/scope pair is carried through untouched");
  eq(rosterRowRole({ accountId: ADMIN, role: "viewer", scope: "own" }), { role: "viewer", scope: "own" },
    "...for a viewer too");

  /* POSITIVE CONTROL — the two defaults the restore actually used, so the assertions
     above are evidence of a change and not of a rule that always agreed. */
  const OLD_MISSING_DEFAULT = (row) => ({ role: row.role || "viewer", scope: row.scope || "all" });
  const OLD_CHANGED_DEFAULT = (row) => (["viewer", "editor", "admin"].includes(row.role) ? row.role : "editor");
  ok(OLD_MISSING_DEFAULT(LEGACY_OBJECT).role === "viewer" && rosterRowRole(LEGACY_OBJECT).role === "admin",
    "POSITIVE CONTROL: the old re-add default turned a legacy ADMIN into a VIEWER");
  ok(OLD_CHANGED_DEFAULT(LEGACY_OBJECT) === "editor" && rosterRowRole(LEGACY_OBJECT).role === "admin",
    "POSITIVE CONTROL: ...and the `changed` path's fallback clicked EDITOR for the same row");
  ok(typeof LEGACY_STRING === "string" && rosterRowRole(LEGACY_STRING).role === "admin",
    "POSITIVE CONTROL: the bare-string row cannot even be given to `row.role || …` — it has no `.role`");

  /* The re-add must REFUSE what the UI cannot express, rather than click a neighbour. */
  eq(isReproducibleRosterRow({ accountId: ADMIN, role: "editor", scope: "own" }), { ok: true, role: "editor", scope: "own" },
    "a reproducible row reports the exact role/scope to click");
  eq(isReproducibleRosterRow(LEGACY_STRING), { ok: true, role: "admin", scope: "all" },
    "a legacy string row IS reproducible — as the admin the product reads it as");
  ok(isReproducibleRosterRow({ accountId: ADMIN, role: "owner" }).ok === false,
    "a role outside the product's enum is REFUSED, not rounded to the nearest label");
  ok(/owner/.test(isReproducibleRosterRow({ accountId: ADMIN, role: "owner" }).reason), "...and the reason names it");
  ok(isReproducibleRosterRow({ accountId: ADMIN, role: "editor", scope: "project" }).ok === false,
    "a scope outside the product's enum is REFUSED too");
  ok(isReproducibleRosterRow({ displayName: "no id" }).ok === false, "a row with no account id is refused");

  /* And the whole point, end to end: a run that loses a legacy admin row plans to put an
     ADMIN back, not a viewer. */
  const snapshot = [LEGACY_STRING, { accountId: NAMESAKE_B, role: "editor", scope: "own" }];
  const plan = planRosterRestore(snapshot, [{ accountId: NAMESAKE_B, role: "editor", scope: "own" }]);
  eq(plan.missing, [LEGACY_STRING], "the lost legacy row is planned for re-add");
  eq(isReproducibleRosterRow(plan.missing[0]), { ok: true, role: "admin", scope: "all" },
    "...and it is re-added as an ADMIN — the demotion is gone");
}

/* ── 8b. F-840 — ONE SCOPE DEFAULT, AND IT IS THE NARROW ONE ───────────────────
   THE DEFECT. The product's READ of an `app_admins` row (`getUserPermissions`,
   src/index.js) answered `scope: "all"` for a row that stated a non-admin role but no
   scope, while the WRITES (`addAppAdmin`, `updateUserRole`) clamped a missing scope to
   `"own"`. Two copies of one rule, disagreeing — and this harness mirror copied the
   WIDER read, so restoring a scope-less editor row re-granted reach over EVERY rule on
   the instance to an account that had never been given it.

   THE CUT. `DEFAULT_ROSTER_SCOPE` in `src/shared/roster-roles.js` is the only answer,
   and it is `"own"`: an editor whose scope was never stated must not gain site-wide
   reach. The read, both writes and this mirror all import it. The ADMIN role is
   untouched — `role === "admin"` forces `"all"` by construction in the resolvers and in
   the UI — so a LEGACY row (bare string, or an object with no `role`) still reads
   admin/all, exactly as block 8 asserts.

   BLOCK / ALLOW, stated as such:
     BLOCK — a scope-less EDITOR row must not read, nor be re-granted, as `all`;
     ALLOW — an EXPLICIT `scope: "all"` editor row survives untouched. This is a
             DEFAULT, never a clamp: it must not narrow a scope somebody stated. */
{
  const EDITOR = "557058:88888888-8888-8888-8888-888888888888";
  const NO_SCOPE = { accountId: EDITOR, displayName: "Scopeless Editor", role: "editor" };
  const EXPLICIT_ALL = { accountId: EDITOR, displayName: "Wide Editor", role: "editor", scope: "all" };

  ok(DEFAULT_ROSTER_SCOPE === "own",
    "the shared default is `own` — the narrow value; widening it is a permission change, not a refactor");

  /* The READ side: what the product's own rule says a row confers. */
  eq(rosterRowRole(NO_SCOPE), { role: "editor", scope: "own" },
    "BLOCK: a scope-less EDITOR row READS as `own`, never `all`");
  /* The WRITE side, mirrored: `isReproducibleRosterRow` reports the exact role/scope a
     re-grant hands to `addAppAdmin`, whose clamp is now the same constant. */
  eq(isReproducibleRosterRow(NO_SCOPE), { ok: true, role: "editor", scope: "own" },
    "BLOCK: ...and a re-GRANT of that row WRITES `own` too — read and write agree");

  eq(rosterRowRole(EXPLICIT_ALL), { role: "editor", scope: "all" },
    "ALLOW: an EXPLICIT `all` editor row survives — the default never narrows a stated scope");
  eq(rosterRowRole({ accountId: EDITOR, role: "admin" }), { role: "admin", scope: "all" },
    "ALLOW: an ADMIN row still reads `all` by construction, default or no default");

  /* POSITIVE CONTROL — the old read default, so the assertions above are evidence of a
     CHANGE and not of a rule that already agreed. */
  const OLD_READ_SCOPE = (row) => (row.role === "admin" ? "all" : (row.scope ? row.scope : "all"));
  ok(OLD_READ_SCOPE(NO_SCOPE) === "all" && rosterRowRole(NO_SCOPE).scope === "own",
    "POSITIVE CONTROL: the old read handed the scope-less editor `all`; the shared default hands it `own`");
  ok(OLD_READ_SCOPE(EXPLICIT_ALL) === rosterRowRole(EXPLICIT_ALL).scope,
    "POSITIVE CONTROL: ...and it changed NOTHING for a row that stated its scope");

  /* The restore PLAN for a snapshot row with no scope: a re-grant carrying `own`. */
  const plan = planRosterRestore([NO_SCOPE], []);
  ok(plan.missing.length === 1 && rosterIdOf(plan.missing[0]) === EDITOR,
    "a scope-less snapshot row that is gone now is planned for re-add");
  eq(normaliseRosterRow(plan.missing[0]), { accountId: EDITOR, role: "editor", scope: "own" },
    "BLOCK: the re-grant planned from a scope-less snapshot row carries `own`");
}


/* ── 9. F-659 — THE VERDICT IS A SET, BECAUSE `addAppAdmin` APPENDS ─────────────
   `addAppAdmin` does `users.push`, so ANY restore that re-adds a row lands it at the
   tail; an order-sensitive byte compare therefore makes a correct restore a PERMANENT
   red, and the loudest assertion in the suite trains its reader to ignore it. The
   verdict now compares the permission-bearing SET. Missing/extra/changed stay FAIL. */
{
  const snapshot = [
    { accountId: ADMIN, displayName: "Mihai Perdum", emailAddress: "mihai@wolfaenpak.com", role: "admin", scope: "all" },
    { accountId: NAMESAKE_A, displayName: "Mihai Perdum", role: "editor", scope: "own" },
    { accountId: NAMESAKE_B, displayName: "Mihai Perdum", role: "viewer", scope: "own" },
  ];
  /* The shape a real restore produces: the re-added row is at the TAIL. */
  const reordered = [snapshot[0], snapshot[2], snapshot[1]];
  const v = rosterRestoreVerdict(snapshot, reordered);
  ok(v.ok === true, `an order-only residue PASSES (got: ${v.verdict})`);
  ok(/order/i.test(v.verdict), `...and the verdict says so rather than claiming byte-identity (got: ${v.verdict})`);
  ok(typeof v.info === "string" && v.info.length > 0, "...with an info line the operator can read");
  ok(v.plan.clean === false, "...while the plan still records honestly that the stored bytes differ");
  ok(rosterRestoreVerdict(snapshot, snapshot).verdict === "byte-identical",
    "an untouched roster is still reported as byte-identical, not merely set-identical");

  /* POSITIVE CONTROL — the old verdict on the very same input. */
  ok(JSON.stringify(reordered) !== JSON.stringify(snapshot),
    "POSITIVE CONTROL: the old byte compare DID fail on this roster — the pass above is a change");

  /* THE SET IS SHAPE-NORMALISED: addAppAdmin always pushes a full object, so a legacy
     bare-string row can never be reproduced byte-for-byte. Re-adding it correctly must
     pass, or the restore is red forever. */
  const legacySnap = [ADMIN, { accountId: NAMESAKE_A, role: "editor", scope: "own" }];
  const reAdded = [{ accountId: NAMESAKE_A, role: "editor", scope: "own" }, { accountId: ADMIN, displayName: "Mihai Perdum", role: "admin", scope: "all" }];
  ok(rosterRestoreVerdict(legacySnap, reAdded).ok === true,
    "a legacy bare-string row re-added as the object the product reads it as is a PASS");
  eq(normaliseRosterRow(ADMIN), { accountId: ADMIN, role: "admin", scope: "all" }, "...because the compare normalises the shape first");

  /* …AND IT IS STILL A FAIL FOR EVERYTHING THAT MATTERS. */
  const demoted = [snapshot[0], { ...snapshot[1], role: "viewer" }, snapshot[2]];
  ok(rosterRestoreVerdict(snapshot, demoted).ok === false, "a CHANGED role is still a FAIL");
  ok(rosterRestoreVerdict(snapshot, [snapshot[0], { ...snapshot[1], scope: "all" }, snapshot[2]]).ok === false,
    "a CHANGED scope is still a FAIL");
  ok(rosterRestoreVerdict(snapshot, [...snapshot, { accountId: TARGET, role: "editor", scope: "own" }]).ok === false,
    "a STRAY grant is still a FAIL");
  ok(rosterRestoreVerdict(snapshot, [snapshot[0], snapshot[1]]).ok === false, "a MISSING row is still a FAIL");
  ok(rosterRestoreVerdict(snapshot, [snapshot[0], snapshot[1], snapshot[2], snapshot[2]]).ok === false,
    "a DUPLICATED row is a FAIL — the set compare counts, it does not dedupe");
  ok(rosterRestoreVerdict(snapshot, []).ok === false, "an emptied roster is a FAIL");

  /* A legacy row that is silently REWRITTEN to a lesser role is the F-658 damage, and the
     set compare must catch it even though both shapes are "legacy-ish". */
  ok(rosterRestoreVerdict([ADMIN], [{ accountId: ADMIN, role: "viewer", scope: "own" }]).ok === false,
    "F-658 + F-659: a legacy admin row demoted to viewer is a FAIL, not a shape difference");
}

console.log(`roster-restore.test.mjs: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
