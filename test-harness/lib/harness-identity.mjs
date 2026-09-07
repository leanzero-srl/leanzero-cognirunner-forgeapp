/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// ONE identity for offline tests that drive permission-gated resolvers.
//
// The design-time resolvers (testPostFunction, testValidation, the test* dry-runs,
// generatePostFunctionCode, fixPostFunctionCode, suggestEndpoint, reviewConfig,
// validateIssue, searchIssues) require at least the editor role, so a test that
// invokes the handler with no principal now gets a refusal instead of a run.
//
// IMPORTANT: the caller identity travels in the SECOND handler argument, not in
// event.context — mock-forge-resolver.mjs (like the platform) overwrites
// context.accountId from `ctx.principal.accountId`. Always:
//   handler({ call: { functionKey, payload } }, ADMIN_PRINCIPAL)
// Call seedAdminRoster(storage) after any storage.__reset() so the roster lookup
// is explicit rather than relying on getUserPermissions' first-user bootstrap.
//
// DENIED_PRINCIPAL is the opposite fixture: a real accountId that is NOT on the
// roster. With the roster seeded, getUserPermissions falls through to the Jira
// group-membership check, so a test using it must have a @forge/api responder that
// does not name this account in a group.
export const ADMIN_ACCOUNT_ID = "harness-admin-account";
export const ADMIN_PRINCIPAL = { principal: { accountId: ADMIN_ACCOUNT_ID } };
export const DENIED_ACCOUNT_ID = "harness-stranger-account";
export const DENIED_PRINCIPAL = { principal: { accountId: DENIED_ACCOUNT_ID } };

export const adminRoster = () => ([
  { accountId: ADMIN_ACCOUNT_ID, displayName: "Harness admin", role: "admin", scope: "all" },
]);

/** Seed the app-admin roster into a mock KVS instance (mock-kvs.mjs). */
export const seedAdminRoster = (storage) => storage.__seed("app_admins", adminRoster());
