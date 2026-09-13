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
    if (after !== undefined && JSON.stringify(after) !== JSON.stringify(before)) changed.push({ accountId: id, before, after });
  }
  const clean = JSON.stringify(now) === JSON.stringify(snap);
  const sameSet = !clean && strays.length === 0 && missing.length === 0 && changed.length === 0;
  return { strays, missing, changed, clean, sameSet };
}

/**
 * The verdict of the SECOND READ. `clean` is the only pass: a roster holding the same
 * rows in a different ORDER is a different stored value and is reported as such, not
 * quietly accepted.
 */
export function rosterRestoreVerdict(snapshot, current) {
  const plan = planRosterRestore(snapshot, current);
  if (plan.clean) return { ok: true, verdict: "byte-identical", plan };
  if (plan.sameSet) return { ok: false, verdict: "same rows, different order", plan };
  return { ok: false, verdict: plan.strays.length + " stray, " + plan.missing.length + " missing, " + plan.changed.length + " changed", plan };
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
