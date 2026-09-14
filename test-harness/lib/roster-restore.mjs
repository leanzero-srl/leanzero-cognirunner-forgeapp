/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * F-654 — SELECT THE ACCOUNT BY ITS DISCRIMINATOR, AND PUT THE ROSTER BACK WHOLE.
 *
 * THE DEFECT THIS EXISTS TO KILL. `knowledge-doors-editor-live.mjs` used to grant an app
 * ROLE to a namesake BY POSITION and learn afterwards whether it had hit the target
 * (`attempts:[{hitTarget:false},{hitTarget:true}]` — measured live on wolfaenpak dev
 * 2026-09-14). Three site accounts read "Mihai Perdum"; the search order is not stable;
 * so every run put {role:"editor",scope:"own"} on a REAL WRONG ACCOUNT before finding the
 * right one, and the driver's `finally` restored only the INTENDED account — a crash
 * between the stray grant and its removal left the stray on the tenant.
 *
 * THE TWO RULES THIS MODULE ENFORCES.
 *
 * 1. SELECTION IS BY DISCRIMINATOR, NEVER BY INDEX. F-647 shipped `.perm-ident-id` on
 *    both the search row and the roster card, whose `title` is the FULL `557058:<uuid>`.
 *    `selectByDiscriminator` matches that title exactly; it falls back to the visible chip
 *    (the id's last segment) ONLY when that segment identifies exactly one row. It never
 *    returns a "best guess" and never defaults to index 0: a target it cannot identify
 *    comes back as `{index:-1}` with a reason, and the CALLER'S CONTRACT is that this is
 *    NOT VERIFIED — never a click, because a click here is a real grant on a real tenant.
 *
 * 2. RESTORE IS A DIFF AGAINST THE RAW SNAPSHOT, NOT AN UNDO OF WHAT WE THINK WE DID.
 *    `planRosterRestore` compares the roster as it is NOW against the byte snapshot taken
 *    before the run and returns everything needed to make them identical again: every
 *    STRAY row (present now, absent from the snapshot — whoever added it, including a
 *    mis-click), every MISSING row (in the snapshot, gone now), and every CHANGED row
 *    (same account, different role/scope). Driving the plan rather than a remembered
 *    action list is what makes the restore correct after a path nobody anticipated.
 *
 * PII (F-652). Nothing here logs, prints or writes. Roster rows carry real
 * `emailAddress` values since F-647; callers hold the raw rows in memory for the byte
 * compare and must pass every copy that reaches a terminal or a file through
 * `lib/redact.mjs`. This module returns rows unchanged — redaction is the caller's
 * boundary, deliberately, so the byte compare is never done against a mask. Use
 * `describePlan` for anything printable: it emits id TAILS only, no names, no addresses.
 *
 * Pure: no I/O, no Playwright, no network. Unit-tested by
 * `scripts/roster-restore.test.mjs` (auto-discovered by `run-offline.mjs`).
 */

/** The account id of a roster row, which may be a bare string or a `{accountId,…}` object. */
export function rosterIdOf(row) {
  if (typeof row === "string") return row;
  if (row && typeof row === "object" && typeof row.accountId === "string") return row.accountId;
  return null;
}

/**
 * F-658 — THE ROLE A ROSTER ROW ACTUALLY CARRIES, read by the PRODUCT'S OWN RULE.
 *
 * `app_admins` still holds legacy rows: bare strings, and objects with no `role`. The
 * product treats BOTH as ADMIN — `src/index.js:480-481` (getUserPermissions) and
 * `removeAppAdmin`/`updateUserRole`'s last-admin guards all read
 * `typeof entry === "object" && entry.role ? entry.role : "admin"`. The restore used to
 * re-add a lost row with `row.role || "viewer"` (and the `changed` path fell through to
 * `ROLE_LABEL[role] || ROLE_LABEL.editor`, clicking **Editor** for an undefined role), so
 * restoring a legacy row DEMOTED a real site admin to viewer or editor and left the run's
 * own second read telling an operator to repair it by hand.
 *
 * THE SCOPE DEFAULT IS THE PRODUCT'S TOO, AND IT IS NOT `addAppAdmin`'s. `addAppAdmin`
 * clamps a missing scope to "own", but the READ at :481 defaults a role-less object to
 * "all" (and forces "all" for an admin). The restore must reproduce the EFFECTIVE
 * permission the row conferred, which is what the read says, so this mirrors the read.
 *
 * @returns {{role: "viewer"|"editor"|"admin", scope: "own"|"all"}}
 */
export function rosterRowRole(row) {
  const isObject = row !== null && typeof row === "object";
  const role = isObject && row.role ? row.role : "admin";
  const scope = role === "admin" ? "all" : (isObject && row.scope ? row.scope : "all");
  return { role, scope };
}

const VALID_ROLES = ["viewer", "editor", "admin"];
const VALID_SCOPES = ["own", "all"];

/**
 * The permission-bearing shape of a roster row: a bare string becomes the object the
 * product reads it as. This is the ONLY shape a restore verdict may compare (F-659),
 * because `addAppAdmin` always pushes a full object and can therefore never reproduce a
 * bare-string row byte-for-byte — comparing raw shapes makes a correct restore a
 * permanent red.
 */
export function normaliseRosterRow(row) {
  return { accountId: rosterIdOf(row), ...rosterRowRole(row) };
}

/**
 * Can `addAppAdmin` reproduce the permission this row confers? It cannot express a role
 * or scope outside the product's own enums, and a caller must REFUSE rather than click a
 * default — the F-658 defect was exactly a default click.
 */
export function isReproducibleRosterRow(row) {
  const { role, scope } = rosterRowRole(row);
  if (!rosterIdOf(row)) return { ok: false, reason: "the row carries no account id" };
  if (!VALID_ROLES.includes(role)) return { ok: false, reason: `role "${role}" is not one of ${VALID_ROLES.join("/")}` };
  if (!VALID_SCOPES.includes(scope)) return { ok: false, reason: `scope "${scope}" is not one of ${VALID_SCOPES.join("/")}` };
  return { ok: true, role, scope };
}

/** The last segment of an account id — what the `.perm-ident-id` chip renders. */
export function idTail(accountId) {
  const s = String(accountId || "");
  const i = s.lastIndexOf(":");
  return i >= 0 ? s.slice(i + 1) : s;
}

/**
 * Pick the ONE search row (or roster card) that belongs to `targetId`.
 *
 * @param rows  [{ i, idTitle, idShown, disabled?, name? }] — as read from the DOM.
 * @param targetId  the full `557058:<uuid>`.
 * @param opts.allowDisabled  when false (the default, and what a GRANT wants), a row
 *   already on the roster is not selectable: clicking it is a no-op the caller would
 *   misread as a failed grant. A REMOVE passes true.
 * @returns { index, row, how } on a unique identification, else { index:-1, reason, ... }.
 */
export function selectByDiscriminator(rows, targetId, opts = {}) {
  const allowDisabled = opts.allowDisabled === true;
  const list = Array.isArray(rows) ? rows : [];
  if (!targetId || typeof targetId !== "string") return { index: -1, reason: "no target account id was given" };
  if (list.length === 0) return { index: -1, reason: "the search returned no rows" };

  const at = (r) => (Number.isInteger(r && r.i) ? r.i : list.indexOf(r));
  const usable = (r) => allowDisabled || !r.disabled;

  // 1. The full id in the chip's title - the F-647 discriminator, exact.
  const exact = list.filter((r) => typeof r.idTitle === "string" && r.idTitle === targetId);
  if (exact.length === 1) {
    const r = exact[0], i = at(r);
    if (!usable(r)) return { index: -1, reason: "the target row is already on the roster (disabled) at index " + i, disabledHit: true, row: r };
    return { index: i, row: r, how: "idTitle" };
  }
  if (exact.length > 1) return { index: -1, reason: exact.length + " rows carry the same full account id - the DOM is ambiguous", ambiguous: true };

  // 2. The visible chip (the id's last segment) - ONLY when it is unique among the rows.
  const tail = idTail(targetId);
  const byTail = list.filter((r) => typeof r.idShown === "string" && r.idShown.trim() === tail);
  if (byTail.length === 1) {
    const r = byTail[0], i = at(r);
    if (!usable(r)) return { index: -1, reason: "the target row is already on the roster (disabled) at index " + i, disabledHit: true, row: r };
    return { index: i, row: r, how: "idShown" };
  }
  if (byTail.length > 1) return { index: -1, reason: byTail.length + ' rows show the same id segment "' + tail + '"', ambiguous: true };

  // 3. Nothing else. A NAME match is exactly the defect F-654 records - never do it.
  const withChip = list.filter((r) => r.idTitle || r.idShown).length;
  return {
    index: -1,
    ambiguous: false,
    reason: withChip === 0
      ? "none of the " + list.length + " rows carries a .perm-ident-id discriminator - F-647 is not on this build, so the target cannot be identified"
      : "no row matches the target account id (" + list.length + " rows read, " + withChip + " carry a discriminator)",
  };
}

/**
 * What it takes to make `current` identical to `snapshot` again.
 *
 * strays:  rows present now and absent from the snapshot   -> REMOVE every one
 * missing: rows in the snapshot and absent now             -> RE-ADD every one
 * changed: [{accountId, before, after}] same account, different row -> restore `before`
 * clean:   true when the roster is already byte-identical to the snapshot
 * sameSet: true when the same accounts carry the same rows but in a different ORDER
 */
export function planRosterRestore(snapshot, current) {
  const snap = Array.isArray(snapshot) ? snapshot : [];
  const now = Array.isArray(current) ? current : [];
  const key = (r) => rosterIdOf(r);
  const snapById = new Map(snap.map((r) => [key(r), r]));
  const nowById = new Map(now.map((r) => [key(r), r]));

  const strays = now.filter((r) => !snapById.has(key(r)));
  const missing = snap.filter((r) => !nowById.has(key(r)));
  const changed = [];
  for (const [id, before] of snapById) {
    const after = nowById.get(id);
    if (after === undefined) continue;
    /* F-658/F-659 — compare the PERMISSION, not the stored bytes. `addAppAdmin` always
       pushes a full object, so a legacy bare-string row can never be reproduced
       byte-for-byte; a raw compare would call a CORRECT re-add "changed" forever and
       send the restore loop round again on damage it cannot repair. */
    if (JSON.stringify(normaliseRosterRow(after)) !== JSON.stringify(normaliseRosterRow(before))) {
      changed.push({ accountId: id, before, after });
    }
  }
  const clean = JSON.stringify(now) === JSON.stringify(snap);
  const dupes = now.length !== nowById.size || snap.length !== snapById.size || now.length !== snap.length;
  const sameSet = !clean && !dupes && strays.length === 0 && missing.length === 0 && changed.length === 0;
  return { strays, missing, changed, clean, sameSet, dupes };
}

/**
 * The verdict of the SECOND READ.
 *
 * F-659 — IT IS A SET COMPARE, BECAUSE `addAppAdmin` APPENDS (`users.push`,
 * src/index.js:5006). Any restore that re-adds a row lands it at the TAIL, so an
 * order-sensitive byte compare made a semantically-correct restore a PERMANENT red:
 * `strays:0 missing:0 changed:0` and the loudest assertion in the suite still printed
 * "THE ROSTER IS NOT RESTORED — restore it by hand", dispatching an operator to repair a
 * tenant that was already correct. The restore loop even conceded it (`if (plan.sameSet)
 * break; // no click can fix that`) — there is no reorder control in the Permissions tab.
 *
 * THE ORDER IS NOT A PERMISSION STATE. Nothing reads the roster index to decide anything;
 * `getConfigs` and the cards only RENDER in that order. So a roster carrying exactly the
 * same `{accountId, role, scope}` set, in a different order, is a PASS — reported as such,
 * with an info line that says what the residue is rather than swallowing it.
 *
 * EVERYTHING THAT IS A PERMISSION STATE STAYS A FAIL: any stray, missing, changed or
 * duplicated row.
 */
export function rosterRestoreVerdict(snapshot, current) {
  const plan = planRosterRestore(snapshot, current);
  if (plan.clean) return { ok: true, verdict: "byte-identical", plan };
  if (plan.sameSet) {
    const snapIds = (Array.isArray(snapshot) ? snapshot : []).map(rosterIdOf);
    const nowIds = (Array.isArray(current) ? current : []).map(rosterIdOf);
    const reordered = JSON.stringify(snapIds) !== JSON.stringify(nowIds);
    return {
      ok: true,
      verdict: reordered ? "same set, different order" : "same set, different row shape",
      info: reordered
        ? "every account carries exactly the role and scope the snapshot held; only the ORDER of the stored array differs, which `addAppAdmin` (users.push) cannot avoid and the Permissions tab cannot repair. No permission decision reads the index."
        : "every account carries exactly the role and scope the snapshot held; a row's non-permission fields (displayName / emailAddress, or a legacy bare string re-added as the object the product reads it as) differ from the stored bytes.",
      plan,
    };
  }
  const counts = plan.strays.length + " stray, " + plan.missing.length + " missing, " + plan.changed.length + " changed";
  const silent = plan.strays.length === 0 && plan.missing.length === 0 && plan.changed.length === 0;
  /* The only way to reach here with all three at zero is a DUPLICATED row: every account
     is accounted for, and the array is still longer. Say so, or the verdict reads "0, 0, 0
     — not restored" and nobody can act on it. */
  return { ok: false, verdict: silent ? "the row COUNT differs with no stray, missing or changed account — a DUPLICATED row" : counts, plan };
}

/** A PII-free shape of a plan, safe to print: id TAILS only, no names, no addresses. */
export function describePlan(plan) {
  return {
    strays: plan.strays.map((r) => idTail(rosterIdOf(r))),
    missing: plan.missing.map((r) => idTail(rosterIdOf(r))),
    changed: plan.changed.map((c) => idTail(c.accountId)),
    clean: plan.clean,
    sameSet: plan.sameSet,
  };
}
