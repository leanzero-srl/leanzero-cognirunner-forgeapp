/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// REGRESSION GUARD — finding F-OWN: "My Rules" listed rules the user never created.
//
// Two different jobs shared one flag in getConfigs:
//   - SCOPE ENFORCEMENT (a permission): a scope-"own" editor may only see their own
//     rules, but ownerless legacy rows must stay visible or an upgrade blanks their table.
//   - The "mine" FILTER (a display choice the user makes in the dropdown): must be
//     strict. A row with no owner is not yours.
// The old predicate `!c.createdBy || c.createdBy === accountId` served both, so every
// ownerless row — including the hundreds a workflow scan claims — showed up under
// EVERY user's "My Rules".
//
// filterConfigsForUser is the pure extraction of that decision. Both jobs are covered
// here explicitly so a future "simplification" that re-merges them fails loudly.
//
// src/index.js can't be imported offline (it pulls @forge/api, @forge/llm, …), so the
// function is fs+regex extracted and re-materialized — the same pattern
// prompt-builders.test.mjs and recover-verdict.test.mjs use.
//
// Run: node scripts/configs-filter.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, "../../src/index.js"), "utf8");
const grab = (name) => {
  const m = src.match(new RegExp(`export const ${name} = \\([\\s\\S]*?\\n\\};`));
  if (!m) { console.log(`FAIL: could not extract ${name} from src/index.js`); process.exit(1); }
  return m[0].replace(/^export /, "");
};
// filterConfigsForUser now delegates to THE visibility predicate (F-432), so all three
// come across together — extracting the caller without the predicate proves nothing.
// eslint-disable-next-line no-new-func
const { filterConfigsForUser, canSeeRule, ruleOwnerIds } = new Function(
  `"use strict";
   ${grab("ruleOwnerIds")}
   ${grab("canSeeRule")}
   ${grab("filterConfigsForUser")}
   return { filterConfigsForUser, canSeeRule, ruleOwnerIds };`,
)();

const ME = "acct-me";
const YOU = "acct-you";
const rows = [
  { id: "mine-1", createdBy: ME },
  { id: "mine-2", createdBy: ME },
  { id: "yours-1", createdBy: YOU },
  { id: "legacy-1", createdBy: null },          // predates createdBy
  { id: "claimed-1", createdBy: null, discovered: true, claimedBy: ME }, // claimed by a scan
];
const ids = (list) => list.map((c) => c.id).sort();

// ---- 1. The reported bug: "My Rules" must be strictly authored-by-me --------------
{
  const out = filterConfigsForUser(rows, { filter: "mine", accountId: ME, scope: "all", role: "admin" });
  ok(JSON.stringify(ids(out)) === JSON.stringify(["mine-1", "mine-2"]),
    `"mine" must return only rules I authored — got ${JSON.stringify(ids(out))}`);
  ok(!out.some((c) => c.id === "legacy-1"), "an ownerless legacy row must NOT count as mine");
  ok(!out.some((c) => c.id === "claimed-1"), "a scan-claimed row must NOT count as mine (this is the exact reported bug)");
  ok(!out.some((c) => c.id === "yours-1"), "another user's rule must never appear under mine");
}

// ---- 2. "mine" is symmetric — no user inherits the unowned rows -------------------
{
  const out = filterConfigsForUser(rows, { filter: "mine", accountId: YOU, scope: "all", role: "admin" });
  ok(JSON.stringify(ids(out)) === JSON.stringify(["yours-1"]),
    `a second user's "mine" must also exclude ownerless rows — got ${JSON.stringify(ids(out))}`);
}

// ---- 3. "all" for a privileged user shows everything ------------------------------
{
  const out = filterConfigsForUser(rows, { filter: "all", accountId: ME, scope: "all", role: "admin" });
  ok(out.length === rows.length, "an admin viewing All Rules sees every row");
}

// ---- 4. SCOPE ENFORCEMENT is a different job and KEEPS the ownerless fallback -----
// A scope-"own" editor must still see legacy/unowned rows, otherwise upgrading the
// app empties their table. This is why the two concerns had to be separated rather
// than the old predicate simply tightened.
{
  const out = filterConfigsForUser(rows, { filter: "all", accountId: ME, scope: "own", role: "editor" });
  ok(out.some((c) => c.id === "legacy-1"), "scope-own must still see ownerless legacy rows");
  ok(out.some((c) => c.id === "mine-1"), "scope-own sees their own rules");
  ok(!out.some((c) => c.id === "yours-1"), "scope-own must NOT see another user's rules");
}

// ---- 5. Enforcement and display choice compose, enforcement first -----------------
{
  const out = filterConfigsForUser(rows, { filter: "mine", accountId: ME, scope: "own", role: "editor" });
  ok(JSON.stringify(ids(out)) === JSON.stringify(["mine-1", "mine-2"]),
    "scope-own + mine narrows to authored-by-me only");
}

// ---- 6. Degenerate inputs must not throw on a hot read path -----------------------
{
  ok(filterConfigsForUser(null, { filter: "mine", accountId: ME }).length === 0, "null configs -> []");
  ok(filterConfigsForUser(rows, {}).length === rows.length, "no filter and no accountId -> unchanged");
  // No accountId (anonymous/system context) must not silently hide everything.
  ok(filterConfigsForUser(rows, { filter: "mine", accountId: null }).length === rows.length,
    "filter=mine with no accountId must not filter (nothing to compare against)");
}

// ---- 7. F-432: an admin re-arm moves createdBy; the AUTHOR must still see the row ----
//
// `armingStamp` re-stamps `createdBy` with whoever last saved the rule, and that was also
// the only visibility key — so an admin re-arming an editor's rule erased it from the
// editor's Rules tab, their "My rules" and their Logs tab. Visibility is now `createdBy`
// OR `firstCreatedBy`; PERMISSION (canActOnConfig) still reads `createdBy` alone.
{
  const rearmed = { id: "rearmed-1", createdBy: "acct-admin", firstCreatedBy: ME };
  const withRearmed = [...rows, rearmed];

  ok(JSON.stringify(ruleOwnerIds(rearmed)) === JSON.stringify(["acct-admin", ME]),
    "a row's owners are the acting account and the first author, in that order");
  ok(ruleOwnerIds({}).length === 0 && ruleOwnerIds(null).length === 0, "a row with neither has no owners");
  ok(ruleOwnerIds({ createdBy: ME, firstCreatedBy: ME }).length === 1, "one account is not counted twice");

  const seen = filterConfigsForUser(withRearmed, { accountId: ME, scope: "own", role: "editor" });
  ok(ids(seen).includes("rearmed-1"), "the AUTHOR still sees a rule an admin re-armed");
  const mine = filterConfigsForUser(withRearmed, { filter: "mine", accountId: ME, scope: "own", role: "editor" });
  ok(ids(mine).includes("rearmed-1"), "…and it is still under their My rules");

  const other = filterConfigsForUser(withRearmed, { accountId: YOU, scope: "own", role: "editor" });
  ok(!ids(other).includes("rearmed-1"), "a third editor sees nothing of it");
  const adminView = filterConfigsForUser(withRearmed, { accountId: "acct-admin", scope: "all", role: "admin" });
  ok(ids(adminView).includes("rearmed-1"), "an admin sees every row");

  // The "mine" arm is a DISPLAY choice and must NEVER short-circuit on admin — that is the
  // F-OWN defect in reverse ("My Rules" listing everything).
  const adminMine = filterConfigsForUser(withRearmed, { filter: "mine", accountId: "acct-admin", scope: "all", role: "admin" });
  ok(JSON.stringify(ids(adminMine)) === JSON.stringify(["rearmed-1"]),
    `an admin's "mine" is still only the admin's rules — got ${JSON.stringify(ids(adminMine))}`);
}

// ---- 8. canSeeRule directly: the ONE predicate three surfaces share --------------
{
  const row = { id: "x", createdBy: "acct-admin", firstCreatedBy: ME };
  ok(canSeeRule(row, { accountId: ME, role: "editor", scope: "own" }), "the first author may SEE it");
  ok(canSeeRule(row, { accountId: ME, role: "editor", scope: "own", mode: "mine" }), "…and it counts as theirs");
  ok(!canSeeRule(row, { accountId: YOU, role: "editor", scope: "own" }), "an unrelated editor may not");
  ok(canSeeRule(row, { accountId: YOU, role: "admin", scope: "all" }), "an admin may");
  ok(!canSeeRule(row, { accountId: YOU, role: "admin", scope: "all", mode: "mine" }),
    "but an admin's 'mine' is strict ownership, not privilege");
  const orphan = { id: "legacy" };
  ok(canSeeRule(orphan, { accountId: ME, role: "editor", scope: "own" }),
    "an ownerless legacy row stays visible — an upgrade must not blank the table");
  ok(!canSeeRule(orphan, { accountId: ME, role: "editor", scope: "own", mode: "mine" }),
    "…but an ownerless row is nobody's");
  ok(!canSeeRule(row, { accountId: null, mode: "mine" }), "no accountId owns nothing");
}

console.log(`\nconfigs-filter: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
