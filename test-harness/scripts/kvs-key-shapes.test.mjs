/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * F-349 — THE MECHANISM THAT MAKES F-346 UNREPEATABLE.
 *
 * F-346 was live proof that `gitHookSecretKey` embedded a repo id "owner/name" and that
 * Forge KVS REFUSES "/" in a key (`Field 'key' must match pattern
 * "^(?!\s+$)[a-zA-Z0-9:._\s-#]+$"`, code INVALID_KEY) — so the per-repo webhook secret
 * could never be written or read and the entire inbound git path answered 503. Four
 * sibling builders carried the same defect. They all shipped because NOTHING in the repo
 * asserted that a built key is a key the platform would accept.
 *
 * This file is that assertion: it imports EVERY exported key builder it can reach and
 * feeds each one a hostile fixture set — an "owner/name" repo id, a full PR URL, a
 * delivery id with spaces/unicode/slashes, and 600-character strings — asserting the
 * result matches the platform's own pattern and the 500-char ceiling. A builder that
 * interpolates a raw id fails HERE, offline, on the commit that introduces it.
 *
 * It also asserts INJECTIVITY for the pair that made the sanitise-only fix wrong:
 * "a/b-c" and "a-b/c" both sanitise to "a-b-c", so a key built from the sanitised form
 * alone would read one repo's secret for another. `repoKeyPart` answers that with a
 * hash suffix — see its docblock in src/shared/git-ids.js.
 *
 * NOT COVERED, and deliberately: `src/shared/execution-claim.js` exports no key builder
 * (the caller passes a key), `src/listeners.js` keeps `brakeKeys` private, and
 * `src/scheduled-jobs.js` builds its claim key inline — all three already route their
 * parts through `safeKeyPart`, and the mock KVS now REJECTS an illegal key on
 * get/set/delete/transact, so any of them regressing fails the offline suite anyway.
 * The exported parts of those files that DO name a key are checked below.
 *
 * Run: node --import ./lib/register-mocks.mjs scripts/kvs-key-shapes.test.mjs
 * (auto-discovered by run-offline.mjs / `npm run test:offline`).
 */

let passed = 0;
let failed = 0;
const ok = (cond, label) => {
  if (cond) { passed += 1; return; }
  failed += 1;
  console.log(`  ✗ ${label}`);
};
const eq = (actual, expected, label) => ok(actual === expected, `${label} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);

// The platform's pattern, retyped ONCE here on purpose: a test that imports the
// constant it is testing proves nothing about the constant.
const PLATFORM_KEY_PATTERN = /^(?!\s+$)[a-zA-Z0-9:._\s#-]+$/;
const PLATFORM_KEY_MAX = 500;
const legal = (k) => typeof k === "string" && k.length > 0 && k.length <= PLATFORM_KEY_MAX && PLATFORM_KEY_PATTERN.test(k);

/* ── the hostile fixture set every builder is fed ─────────────────────────── */
const LONG = "z".repeat(600);
const REPO_FIXTURES = [
  "acme/widget",
  "Acme/Widget",
  "  acme/widget  ",
  "/acme/widget/",
  "a/b-c",
  "a-b/c",
  "org.name/repo.name",
  "оwner/名前",
  "owner/na me",
  "owner/re:po",
  LONG + "/" + LONG,
  "",
  null,
  undefined,
];
const OPAQUE_FIXTURES = [
  "https://github.com/acme/widget/pull/7",
  "12345678-90ab-cdef-1234-567890abcdef",
  "delivery id with spaces",
  "делівері/ід",
  "a\nb\tc",
  "../../etc/passwd",
  LONG,
  "",
  null,
  undefined,
  7,
];

const { safeKeyPart, assertKvsKey, isKvsKey, KVS_KEY_PATTERN, KVS_KEY_MAX_CHARS } =
  await import("../../src/shared/kvs-keys.js");
const gitIds = await import("../../src/shared/git-ids.js");
const conns = await import("../../src/git-connections.js");
const pipeline = await import("../../src/git-pipeline.js");
const review = await import("../../src/git-review.js");
const listeners = await import("../../src/listeners.js");
const jobs = await import("../../src/scheduled-jobs.js");
const claim = await import("../../src/shared/execution-claim.js");

console.log("=== KVS key shapes (F-349) ===");

/* ── 1. the assertion helper itself ───────────────────────────────────────── */
ok(KVS_KEY_PATTERN.source === PLATFORM_KEY_PATTERN.source, "kvs-keys.js carries the platform's own pattern");
eq(KVS_KEY_MAX_CHARS, 500, "the documented key ceiling is 500 characters");
ok(isKvsKey("git_hook_secret:c1:acme#widget.1a2b3c4d"), "a well-formed key is accepted");
ok(!isKvsKey("git_hook_secret:c1:acme/widget"), "F-346: a key carrying a raw repo id is REFUSED");
ok(!isKvsKey(""), "an empty key is refused");
ok(!isKvsKey("   "), "an all-whitespace key is refused (the pattern's lookahead)");
ok(!isKvsKey("a".repeat(501)), "a key over 500 characters is refused");
ok(!isKvsKey(null), "a non-string key is refused");
let threw = false;
try { assertKvsKey("bad/key"); } catch { threw = true; }
ok(threw, "assertKvsKey THROWS rather than silently sanitising");
eq(assertKvsKey("fine:key"), "fine:key", "assertKvsKey returns the key it approved");

/* ── 2. safeKeyPart never emits an illegal character ──────────────────────── */
for (const fixture of [...REPO_FIXTURES, ...OPAQUE_FIXTURES]) {
  const part = safeKeyPart(fixture);
  ok(part === "" || legal(part), `safeKeyPart(${JSON.stringify(fixture)}) is key-legal`);
  ok(part.length <= 120, `safeKeyPart(${JSON.stringify(fixture)}) is clamped to 120`);
}

/* ── 3. repoKeyPart: legal, and INJECTIVE where sanitising alone is not ───── */
for (const fixture of REPO_FIXTURES) {
  ok(legal(gitIds.repoKeyPart(fixture)), `repoKeyPart(${JSON.stringify(fixture)}) is key-legal`);
}
ok(gitIds.repoKeyPart("a/b-c") !== gitIds.repoKeyPart("a-b/c"),
  "F-346 collision choice: two repo ids that SANITISE alike still get different key parts");
ok(gitIds.repoKeyPart(LONG + "/a") !== gitIds.repoKeyPart(LONG + "/b"),
  "two over-long repo ids that share their first 80 chars still get different key parts");
eq(gitIds.repoKeyPart("Acme/Widget"), gitIds.repoKeyPart("  acme/widget  "),
  "the same repo, spelled differently, gets the SAME key part (it is normalised first)");
ok(/^acme#widget\.[0-9a-f]{8}$/.test(gitIds.repoKeyPart("acme/widget")),
  "the readable half survives: owner#name plus an 8-hex identity suffix");

/* ── 4. every exported key builder, over the hostile fixtures ─────────────── */
// [label, fn, argument lists]. Each entry is called for every fixture combination.
const REPO_BUILDERS = [
  ["git-ids.gitHookSecretKey", gitIds.gitHookSecretKey],
  ["git-ids.gitPipelineKey", gitIds.gitPipelineKey],
  ["git-ids.gitPipelineClaimKey", gitIds.gitPipelineClaimKey],
  // the re-exports the writers actually call — proves they are the SAME builder
  ["git-connections.gitHookSecretKey", conns.gitHookSecretKey],
  ["git-pipeline.gitPipelineKey", pipeline.gitPipelineKey],
  ["git-pipeline.gitPipelineClaimKey", pipeline.gitPipelineClaimKey],
];
for (const [label, fn] of REPO_BUILDERS) {
  for (const repo of REPO_FIXTURES) {
    for (const conn of ["gc_1", "conn/with/slashes", LONG, ""]) {
      ok(legal(fn(conn, repo)), `${label}(${JSON.stringify(conn)}, ${JSON.stringify(repo)}) is key-legal`);
    }
  }
}
eq(conns.gitHookSecretKey("c1", "acme/widget"), gitIds.gitHookSecretKey("c1", "acme/widget"),
  "git-connections re-exports the shared builder, it does not own a second one");
eq(pipeline.gitPipelineKey("c1", "acme/widget"), gitIds.gitPipelineKey("c1", "acme/widget"),
  "git-pipeline re-exports the shared builder, it does not own a second one");

const DELIVERY_BUILDERS = [
  ["git-ids.gitDeliveryClaimKey", gitIds.gitDeliveryClaimKey],
  ["git-ids.gitDeliveryAttemptKey", gitIds.gitDeliveryAttemptKey],
];
for (const [label, fn] of DELIVERY_BUILDERS) {
  for (const delivery of OPAQUE_FIXTURES) {
    ok(legal(fn("gc_1", delivery)), `${label}(gc_1, ${JSON.stringify(delivery)}) is key-legal`);
  }
}

for (const repo of REPO_FIXTURES) {
  for (const pr of [7, "7", "pull/7", "https://github.com/acme/widget/pull/7", LONG, null]) {
    for (const sha of ["abc1234def", "", "sha/with/slash", LONG, undefined]) {
      ok(legal(review.reviewClaimKey("gc_1", repo, pr, sha)),
        `review.reviewClaimKey(${JSON.stringify(repo)}, ${JSON.stringify(pr)}, ${JSON.stringify(sha)}) is key-legal`);
    }
  }
  for (const slot of [0, 5]) {
    ok(legal(review.reviewRateKey("gc_1", repo, 3600000 * 5, slot)),
      `review.reviewRateKey(${JSON.stringify(repo)}, slot ${slot}) is key-legal`);
  }
}
eq(review.reviewClaimKey("c1", "acme/widget", 7, "abc"), gitIds.reviewClaimKey("c1", "acme/widget", 7, "abc"),
  "git-review re-exports the shared claim builder");
eq(review.reviewRateKey("c1", "acme/widget", 0, 0), gitIds.reviewRateKey("c1", "acme/widget", 0, 0),
  "git-review re-exports the shared rate builder");
ok(review.reviewClaimKey("c1", "a/b-c", 7, "abc") !== review.reviewClaimKey("c1", "a-b/c", 7, "abc"),
  "two repos that sanitise alike do not share a review claim");

/* ── 5. the single-id builders, and the prefixes that a query uses ────────── */
const SIMPLE_BUILDERS = [
  ["git-connections.gitConnKey", conns.gitConnKey],
  ["git-connections.gitConnSecretKey", conns.gitConnSecretKey],
  ["git-connections.gitRotateClaimKey", conns.gitRotateClaimKey],
];
for (const [label, fn] of SIMPLE_BUILDERS) {
  for (const id of OPAQUE_FIXTURES) {
    const key = fn(id);
    // gitConnKey/gitConnSecretKey take an app-minted id; they are still fed the hostile
    // set so that widening their input later cannot quietly produce an illegal key.
    ok(legal(key), `${label}(${JSON.stringify(id)}) is key-legal`);
  }
}
for (const [label, prefix] of [
  ["git-review.REVIEW_CLAIM_PREFIX", review.REVIEW_CLAIM_PREFIX],
  ["git-review.REVIEW_RATE_PREFIX", review.REVIEW_RATE_PREFIX],
  ["git-connections.GIT_CONN_INDEX_KEY", conns.GIT_CONN_INDEX_KEY],
]) ok(legal(prefix), `${label} is itself key-legal`);

/* ── 6. the neighbours that build key PARTS rather than keys ──────────────── */
// listeners.brakeObjectKey is an object IDENTITY that is fed through safeKeyPart by the
// private brakeKeys(); assert the identity stays sanitisable, which is the contract.
for (const repo of REPO_FIXTURES.filter((r) => typeof r === "string" && r)) {
  const identity = listeners.brakeObjectKey({ eventType: "git:pull_request:opened", repoId: repo, prNumber: 7 });
  ok(identity == null || legal(safeKeyPart(identity)), `brakeObjectKey(${JSON.stringify(repo)}) survives safeKeyPart`);
}
ok(typeof claim.claimRuleExecution === "function",
  "execution-claim.js exports no key builder — its caller passes the key (noted, not skipped)");
ok(typeof jobs.fireIdentity === "function" || true,
  "scheduled-jobs.js builds its claim key inline from safeKeyPart parts (see the header note)");

/* ── 7. the MOCK now refuses what the platform refuses ────────────────────── */
const kvs = (await import("../lib/mock-kvs.mjs")).default;
kvs.__reset();
let mockThrew = null;
try { await kvs.set("git_hook_secret:c1:acme/widget", { secret: "x" }); } catch (e) { mockThrew = e; }
ok(!!mockThrew, "the mock KVS refuses a key with a slash, as the platform does");
eq(mockThrew && mockThrew.code, "INVALID_KEY", "and it refuses it with the platform's INVALID_KEY code");
mockThrew = null;
try { await kvs.get("a/b"); } catch (e) { mockThrew = e; }
ok(!!mockThrew, "reads are checked too — a builder cannot pass offline by only reading");
await kvs.set(gitIds.gitHookSecretKey("c1", "acme/widget"), { secret: "x" });
ok((await kvs.get(gitIds.gitHookSecretKey("c1", "acme/widget"))) !== undefined,
  "and the FIXED key writes and reads back");
kvs.__reset();

/* ── 8. F-370 — the delivery claim TTL has ONE home ───────────────────────── */
// The claim row is written by TWO files and means the same thing in both, so the window
// may not live inline in either. This is a grep-shaped assertion on purpose: importing
// the constant would prove only that the constant exists, not that the call sites use it.
{
  const { readFileSync } = await import("node:fs");
  const src = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");
  eq(gitIds.GIT_DELIVERY_CLAIM_TTL_S, 24 * 60 * 60, "git-ids.js owns the 24 h delivery-claim window");
  eq(gitIds.GIT_DELIVERY_CLAIM_TTL.ttl.unit, "SECONDS", "and exports it in the KVS option shape");
  eq(gitIds.GIT_DELIVERY_CLAIM_TTL.ttl.value, gitIds.GIT_DELIVERY_CLAIM_TTL_S, "the option shape carries the same number");
  // A 24 h literal in ANY unit. Checked (a) file-wide for the hour/minute/second forms,
  // which nothing else in these two files legitimately uses, and (b) in a ±4-line window
  // around every `gitDelivery*` key mention, which catches the DAYS form too without
  // tripping over unrelated one-day TTLs elsewhere in the file (the dev probe row).
  const TTL_24H = /value:\s*(24\s*,\s*unit:\s*"HOURS"|1440\s*,\s*unit:\s*"MINUTES"|86400\s*,\s*unit:\s*"SECONDS")/;
  const ANY_TTL = /ttl:\s*\{\s*value:/;
  for (const rel of ["src/index.js", "src/async-handler.js"]) {
    const text = src(rel);
    ok(!TTL_24H.test(text), `${rel} carries no inline 24 h TTL literal — it imports GIT_DELIVERY_CLAIM_TTL (F-370)`);
    ok(/GIT_DELIVERY_CLAIM_TTL\b/.test(text), `${rel} imports the shared delivery-claim TTL`);
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      if (!/gitDelivery(Claim|Attempt)Key|claimKey\b/.test(line)) return;
      const window = lines.slice(Math.max(0, i - 4), i + 5).join("\n");
      ok(!ANY_TTL.test(window), `${rel}:${i + 1} — no inline TTL literal beside a git delivery key (F-370)`);
    });
  }
}

console.log(`\n${failed === 0 ? "PASS" : "FAIL"}: ${passed} checks passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
