/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * THE API-TOKEN SWEEP — F-812, the half a rule cannot fix.
 *
 * `lib/api-token-lease.mjs` and RULE 5 in `live-driver-scope.test.mjs` stop the NEXT
 * leak. They do nothing about the bearers ALREADY on the tenant: F-812 counted seven
 * live `shadow-door <ts>` admin tokens on staging, minted by a driver whose cleanup
 * called a resolver that does not exist. Each one is a full-power key to the Rules REST
 * API, and `createApiTokenInternal` refuses a mint once `MAX_TOKENS` live rows exist —
 * so the residue eventually breaks the very drivers that made it.
 *
 * WHAT IT DOES, AND WHAT IT REFUSES TO DO.
 *
 *   - It LISTS through `getApiTokens` and prints `id`, `name`, `role`, `createdAt`,
 *     `revokedAt` and nothing else. Not the token — the resolver does not return it
 *     after the mint — and NOT the `prefix` either: the prefix is the first ten
 *     characters of a live bearer, it is the field a reader would paste into a ticket,
 *     and printing it buys nothing the id does not. The field list is the lease
 *     library's `SWEEP_FIELDS`, not a shape typed here (F-646's lesson: the redaction
 *     decision belongs next to the mint, not at each print site). The answer's `url`
 *     field — the Rules API web-trigger — is never printed either.
 *   - It revokes ONLY rows whose NAME matches a generated pattern and that are still
 *     LIVE. The default is `/^shadow-door \d+$/`, which is the exact shape the shadow
 *     door mints and which no human types, so the default run cannot touch an
 *     integration's token called "shadow door notes". `--name-prefix=` widens it to a
 *     literal prefix; an EMPTY prefix is refused rather than treated as "everything".
 *   - It is a DRY RUN unless `--apply` is passed. The list is the whole point: a sweep
 *     whose first act is a write is a sweep nobody reads the output of.
 *   - With `--apply` it revokes, then READS THE LIST AGAIN and grades each id by its
 *     `revokedAt`. A revoke that answered `success` is not proof; the second read is.
 *     `revokeApiTokenInternal` writes a TOMBSTONE first and `listApiTokens` reports a
 *     resurrected row as revoked, so this read is the honest one.
 *
 * WHY IT IS NOT A `*-live.mjs`. The live-driver cohort carries the evidence-file, RESULT
 * line and environment contracts that a test driver owes; this is an operator tool that
 * asks one question and makes one change. It still goes through the shared-env guard —
 * `mutates: ["kvs"]`, which is the guard's own word for API tokens ("raw APP STORAGE rows
 * no other word covers (planted ballast, API tokens, coder threads)") — so pointing it at
 * a shared tenant still has to be acknowledged.
 *
 * Usage (from test-harness/):
 *   node scripts/api-token-sweep.mjs --env=staging                  # DRY RUN: what would go
 *   node scripts/api-token-sweep.mjs --env=staging --apply          # revoke them
 *   node scripts/api-token-sweep.mjs --env=staging --name-prefix=parity-   # another cohort
 *
 * Env: <ENV>_TESTSTATE_URL + HARNESS_SECRET + HARNESS_ADMIN_ACCOUNT_ID.
 */

import { requireEnvAck } from "../lib/shared-env-guard.mjs";
import { loadEnv, requireEnv } from "../lib/env.mjs";
import {
  LIST_RESOLVER, SHADOW_DOOR_NAME, namePrefixPattern, staleTokens, sweepRow, revokeApiToken,
} from "../lib/api-token-lease.mjs";

const { envName: ENV_NAME, hookUrl: HOOK_URL } = requireEnvAck(process.argv.slice(2), {
  faults: [], mutates: ["kvs"], defaultEnv: "staging",
  usage: "[--apply] [--name-prefix=<literal>]",
});
loadEnv();
const argv = process.argv.slice(2);
const arg = (n, d) => { const h = argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const APPLY = argv.includes("--apply");
const PREFIX = arg("name-prefix", null);
const SECRET = requireEnv("HARNESS_SECRET");
const ADMIN = requireEnv("HARNESS_ADMIN_ACCOUNT_ID");

/* The pattern is decided ONCE, before anything is read: an empty `--name-prefix=` throws
   out of `namePrefixPattern` rather than matching every token on the tenant. */
const PATTERN = PREFIX === null ? SHADOW_DOOR_NAME : namePrefixPattern(PREFIX);

const invoke = async (functionKey, payload = {}) => {
  const res = await fetch(HOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + SECRET },
    body: JSON.stringify({ action: "invokeResolver", functionKey, payload, accountId: ADMIN }),
  });
  let body = null;
  const text = await res.text();
  try { body = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, body, raw: body ? null : text.slice(0, 200) };
};

/** The token list, or a throw that says why — never the answer body, which carries `url`. */
async function listTokens() {
  const r = await invoke(LIST_RESOLVER);
  const a = r.body;
  if (!(a && a.success && Array.isArray(a.tokens))) {
    throw new Error(`${LIST_RESOLVER} did not answer a token list (HTTP ${r.status}${a && a.error ? `: ${String(a.error).slice(0, 120)}` : ""})`);
  }
  return a.tokens;
}

const show = (rows) => rows.map((t) => "    " + JSON.stringify(sweepRow(t))).join("\n");

async function main() {
  console.log(`API TOKEN SWEEP on ${ENV_NAME} — pattern ${PATTERN} — ${APPLY ? "APPLY" : "DRY RUN (pass --apply to revoke)"}`);
  const before = await listTokens();
  const live = before.filter((t) => t && !t.revokedAt);
  console.log(`\n  ${before.length} token row(s), ${live.length} live`);
  const candidates = staleTokens(before, PATTERN);
  if (!candidates.length) {
    console.log("\n  NOTHING TO SWEEP — no LIVE token's name matches the pattern.");
    /* The negative is PROVEN, not observed: if the list itself is empty the "0 matches"
       above says nothing about the pattern, and that is the shape of gate that moved 159
       tickets on a client tenant. */
    if (!live.length) console.log("  (and there are no live tokens at all, so this is an empty tenant, not a filter that missed)");
    return 0;
  }
  console.log(`\n  ${candidates.length} LIVE token(s) match:\n${show(candidates)}`);
  const skipped = before.filter((t) => t && t.revokedAt && typeof t.name === "string" && PATTERN.test(t.name));
  if (skipped.length) console.log(`\n  ${skipped.length} already-revoked row(s) with the same name shape are LEFT ALONE`);

  if (!APPLY) {
    console.log("\n  DRY RUN — nothing was revoked. Re-run with --apply to revoke the rows above.");
    return 0;
  }

  console.log("\n  REVOKING");
  const answers = [];
  for (const t of candidates) {
    const r = await revokeApiToken(invoke, t.id);
    console.log(`    ${r.id}: ${r.revoked ? "revoked" : `NOT revoked (${r.error || "revoked:false"})`}`);
    answers.push(r);
  }

  /* THE SECOND READ. A `success` answer is the door's word for what it did; the list is
     the tenant's word for what is true, and only the second one is evidence. */
  console.log("\n  SECOND READ — the same list, re-asked");
  const after = await listTokens();
  const byId = new Map(after.map((t) => [t.id, t]));
  let stillLive = 0;
  for (const t of candidates) {
    const row = byId.get(t.id);
    const gone = !row || Boolean(row.revokedAt);
    if (!gone) stillLive += 1;
    console.log(`    ${t.id}: ${gone ? "revokedAt is set (or the row is gone)" : "STILL LIVE"}`);
  }
  const failedAnswers = answers.filter((r) => !r.revoked).length;
  console.log(`\n  RESULT: ${candidates.length - stillLive}/${candidates.length} swept`
    + (failedAnswers ? `, ${failedAnswers} revoke call(s) did not answer revoked:true` : ""));
  return stillLive ? 1 : 0;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((e) => { console.error("\nSWEEP ERROR:", String((e && e.message) || e)); process.exitCode = 1; });
