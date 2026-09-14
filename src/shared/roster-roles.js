/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * F-840 — ONE HOME for the scope a roster row confers when it does not state one.
 *
 * THE DEFECT THIS EXISTS TO KILL. The product's READ of an `app_admins` row and its
 * WRITES disagreed about what a missing `scope` means. `getUserPermissions`
 * (src/index.js) defaulted a role-bearing row with no scope to "all" — site-wide reach
 * over every rule on the instance — while `addAppAdmin` / `updateUserRole` clamped a
 * missing scope to "own". Two copies of one rule, answering differently, and the
 * harness mirror (`test-harness/lib/roster-restore.mjs` `rosterRowRole`, F-658) copied
 * the READ, so a restore re-granted the wider of the two.
 *
 * WHY "own" IS THE VALUE. An editor whose scope was never stated must not gain
 * site-wide reach. The scope field exists to answer "own rules, or everyone's?", and
 * silence is not consent to the broader answer: the narrower default costs a
 * legitimately site-wide editor one explicit admin click, while the wider default hands
 * every rule on the instance to a row nobody meant to widen. Least privilege decides
 * the tie, and it matches what both write paths already stored.
 *
 * BEHAVIOUR CHANGE (deliberate, documented). A STORED row that carries an explicit
 * non-admin role (`"editor"` / `"viewer"`) but no `scope` now reads as "own" where it
 * previously read as "all". Such a row can only exist from a hand-edited KVS value or
 * a build predating the scope field — every write path since has stored a scope. The
 * repair is one Permissions-tab edit; the alternative (keeping the read wide) is a
 * silent site-wide grant.
 *
 * WHAT DOES NOT CHANGE — THE ADMIN ROLE IS "all" BY CONSTRUCTION. Both the resolvers
 * and the admin panel force `scope: "all"` whenever `role === "admin"`, and this
 * default is never consulted on that branch. A LEGACY row (a bare account-id string, or
 * an object with no `role` at all) still reads as role "admin", and therefore still
 * reads as scope "all" — this cut does not narrow those rows, it only settles what a
 * role-bearing, scope-less row means.
 *
 * Pure and dependency-free — bundles into the backend, the frontends and the offline
 * harness alike. Any new reader of a roster row must take its default from HERE rather
 * than re-typing a literal; a private copy is how the two answers diverged the first
 * time.
 */

/** The scope a roster row confers when it states a non-admin role but no scope. */
export const DEFAULT_ROSTER_SCOPE = "own";

/*
 * F-844 — ONE HOME for the roster VOCABULARY too, not just its default.
 *
 * THE DEFECT THIS EXISTS TO KILL. `VALID_ROLES` and `VALID_SCOPES` were declared twice,
 * verbatim: once in `src/index.js` (where `addAppAdmin` / `updateUserRole` clamp an
 * incoming role and scope) and once in `test-harness/lib/roster-restore.mjs` (where
 * `isReproducibleRosterRow` decides whether a restore may reproduce a row at all). Two
 * copies of one enum is exactly the shape that produced F-840: the mirror is supposed to
 * answer as the product answers, and a private copy can only stay right by luck. If a
 * fourth role or a third scope is ever added to the product, the mirror silently starts
 * REFUSING rows the product accepts — a restore that reports "not reproducible" for a
 * perfectly ordinary row, which reads as a harness bug and costs a hunt.
 *
 * WHY AN ARRAY AND NOT A SET. Order is meaningful: the admin panel renders the role
 * dropdown in this order (least reach first), and the refusal messages join it into
 * "viewer/editor/admin". Callers only ever `.includes()` or `.map()`, so an array is the
 * smaller contract.
 *
 * THESE ARE FROZEN because they are shared by reference across the backend, the admin
 * panel and the offline harness — a caller that sorted or pushed in place would mutate
 * every other reader's vocabulary. The harness parity assertion checks IDENTITY
 * (`===`), not deep equality, precisely so that a re-typed private copy cannot pass.
 */

/** Every role a roster row may confer, widest reach LAST. */
export const VALID_ROLES = Object.freeze(["viewer", "editor", "admin"]);

/** Every scope a non-admin roster row may confer. Admin is "all" by construction. */
export const VALID_SCOPES = Object.freeze(["own", "all"]);
