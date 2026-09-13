/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline: the PRODUCTION git webhook (`gitWebhook` in src/index.js, 1.4 commit 5),
// driven end to end on a mock KVS and the mock @forge/events Queue.
//
// What this file is here to prove, in order of how badly it would hurt:
//  1. A delivery we did not sign is NEVER processed — wrong, missing, sha1-only
//     and other-repo signatures are 401/404 and enqueue nothing.
//  2. Routing is not an oracle: an unknown connection, a repo that is not on the
//     connection's allow-list, and a missing secret all answer the SAME 404 with
//     no body detail.
//  3. Every provider event maps to a row of the ONE catalogue — including the
//     one that cannot be read off the action verb, `closed` + merged:true.
//  4. The envelope matches `extractEventContext`'s git branch FIELD FOR FIELD.
//  5. A redelivery enqueues NOTHING (claim before side effect), and a failed
//     enqueue releases the claim so the provider's retry is not swallowed.
//  6. `raw` is an emit whitelist with a hard 8 KB cap.
//
// Run: node scripts/git-webhook.test.mjs   (auto-discovered by run-offline.mjs)

import "../lib/register-mocks-index.mjs";
import { createHmac } from "node:crypto";
import storage from "../lib/mock-kvs.mjs";
import { pushed, Queue } from "../lib/mock-forge-api.mjs";

const { gitWebhook, mapGitEvent, buildGitEnvelope, gitIssueKeysFrom } = await import("../../src/index.js");
const { extractEventContext, GIT_EVENT_IDS, isKnownEvent } = await import("../../src/shared/jira-events.js");
const { gitHookSecretKey, gitConnKey } = await import("../../src/git-connections.js");
const { safeKeyPart } = await import("../../src/shared/kvs-keys.js");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const CONN = "gc_test1";
const REPO = "leanzero/cognirunner";
const SECRET = "abcdef0123456789abcdef0123456789";
const OTHER_SECRET = "9999999999999999aaaaaaaaaaaaaaaa";

const seed = ({ kind = "github", repos = [REPO], secret = SECRET } = {}) => {
  storage.__reset();
  pushed.length = 0;
  storage.__seed(gitConnKey(CONN), { id: CONN, kind, label: "test", repos, status: "ok" });
  if (secret) storage.__seed(gitHookSecretKey(CONN, REPO), { secret, connId: CONN, repoId: REPO });
};

const sign = (body, secret = SECRET) => "sha256=" + createHmac("sha256", secret).update(body, "utf8").digest("hex");

let deliveryCounter = 0;
function req({
  payload, kind = "github", event = "pull_request", conn = CONN, repo = REPO,
  secret = SECRET, signature, header, delivery, method = "POST",
} = {}) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload || {});
  const sigHeader = header || (kind === "github" ? "x-hub-signature-256" : "x-hub-signature");
  const headers = {};
  const sig = signature === null ? null : (signature || sign(body, secret));
  if (sig) headers[sigHeader] = [sig];
  if (kind === "github") {
    headers["x-github-event"] = [event];
    headers["x-github-delivery"] = [delivery || `d-${++deliveryCounter}`];
  } else {
    headers["x-event-key"] = [event];
    headers["x-request-uuid"] = [delivery || `d-${++deliveryCounter}`];
  }
  const queryParameters = {};
  if (conn !== null) queryParameters.conn = [conn];
  if (repo !== null) queryParameters.repo = [repo];
  return { method, body, headers, queryParameters };
}
const parse = (r) => ({ status: r.statusCode, body: JSON.parse(r.body) });
const lastEvent = () => pushed[pushed.length - 1];

/* ---- sample payloads ---- */
const ghPr = (action, extra = {}) => ({
  action,
  ...(() => { const { pull_request, ...rest } = extra; return rest; })(),
  repository: { full_name: REPO },
  sender: { login: "octocat", id: 7 },
  pull_request: {
    number: 42, title: "LZPT-31 fix the thing", state: action === "closed" ? "closed" : "open",
    draft: false, merged: false, merge_commit_sha: null,
    head: { sha: "a".repeat(40), ref: "feature/LZPT-31-thing" },
    base: { ref: "main" },
    html_url: "https://github.com/leanzero/cognirunner/pull/42",
    user: { login: "contributor" },
    ...(extra.pull_request || {}),
  },
});

/* ===================== 1. HMAC: valid / invalid / missing ===================== */
seed();
{
  const r = parse(await gitWebhook(req({ payload: ghPr("opened") })));
  ok(r.status === 202 && r.body.accepted === true && r.body.eventType === "git:pull_request:opened",
    `a correctly signed delivery is accepted (${JSON.stringify(r)})`);
  ok(pushed.length === 1, "…and enqueues exactly one event");
}
seed();
{
  const r = parse(await gitWebhook(req({ payload: ghPr("opened"), secret: OTHER_SECRET })));
  ok(r.status === 401 && !r.body.accepted, "a signature made with the WRONG secret is 401");
  ok(pushed.length === 0, "…and nothing is enqueued");
  ok(!JSON.stringify(r.body).includes("octocat"), "…and the 401 body carries no part of the payload");
}
seed();
{
  const r = parse(await gitWebhook(req({ payload: ghPr("opened"), signature: null })));
  ok(r.status === 401 && pushed.length === 0, "an UNSIGNED delivery is 401 and enqueues nothing");
}
seed();
{
  // A tampered body under a signature that was valid for the original.
  const body = JSON.stringify(ghPr("opened"));
  const good = sign(body);
  const r = parse(await gitWebhook({ ...req({ payload: ghPr("opened"), signature: good }), body: body + " " }));
  ok(r.status === 401 && pushed.length === 0, "a body changed by ONE byte fails verification");
}
seed();
{
  // GitHub sends a sha1 `x-hub-signature` too; it must never be accepted.
  const body = JSON.stringify(ghPr("opened"));
  const r = parse(await gitWebhook({
    method: "POST", body,
    headers: { "x-github-event": ["pull_request"], "x-github-delivery": ["d-sha1"], "x-hub-signature": ["sha1=" + "0".repeat(40)] },
    queryParameters: { conn: [CONN], repo: [REPO] },
  }));
  ok(r.status === 401 && pushed.length === 0, "a sha1-only x-hub-signature is refused (we verify sha256 only)");
}
seed();
{
  // …but the sha256 header wins when GitHub sends both.
  const body = JSON.stringify(ghPr("opened"));
  const r = parse(await gitWebhook({
    method: "POST", body,
    headers: {
      "x-github-event": ["pull_request"], "x-github-delivery": ["d-both"],
      "x-hub-signature": ["sha1=" + "0".repeat(40)], "x-hub-signature-256": [sign(body)],
    },
    queryParameters: { conn: [CONN], repo: [REPO] },
  }));
  ok(r.status === 202 && r.body.accepted === true, "the sha256 header is used when both headers are present");
}
/* Bitbucket signs the SAME construction on `x-hub-signature`. */
seed({ kind: "bitbucket" });
{
  const payload = {
    repository: { full_name: REPO },
    actor: { nickname: "bbuser", uuid: "{u-1}" },
    pullrequest: {
      id: 9, title: "LZPT-77 bitbucket work", state: "OPEN",
      source: { commit: { hash: "b".repeat(40) }, branch: { name: "feature/LZPT-77" } },
      destination: { branch: { name: "main" } },
      links: { html: { href: "https://bitbucket.org/leanzero/cognirunner/pull-requests/9" } },
      author: { nickname: "bbauthor" },
    },
  };
  const r = parse(await gitWebhook(req({ payload, kind: "bitbucket", event: "pullrequest:created" })));
  ok(r.status === 202 && r.body.eventType === "git:pull_request:opened",
    `a Bitbucket delivery verifies on x-hub-signature (${JSON.stringify(r)})`);
  const env = lastEvent().body.params.envelope;
  ok(env.pullRequest.number === 9 && env.pullRequest.headSha === "b".repeat(40) && env.pullRequest.baseRef === "main"
    && env.actor.login === "bbuser" && env.pullRequest.author.login === "bbauthor",
    `the Bitbucket payload normalises into the SAME envelope shape (${JSON.stringify(env.pullRequest)})`);
  ok(env.issueKeys.includes("LZPT-77"), "issue keys are read from the Bitbucket branch/title too");
}
seed({ kind: "bitbucket" });
{
  const r = parse(await gitWebhook(req({ payload: { repository: { full_name: REPO } }, kind: "bitbucket", event: "repo:push", header: "x-hub-signature-256" })));
  ok(r.status === 202 && r.body.accepted === true, "a Bitbucket delivery is also accepted on x-hub-signature-256 (same construction)");
}

/* ===================== 2. routing is not an oracle ===================== */
for (const [label, patch] of [
  ["an unknown connection id", { conn: "gc_nope" }],
  ["a repo that is not on the allow-list", { repo: "someone/else" }],
  ["a missing conn parameter", { conn: null }],
  ["a missing repo parameter", { repo: null }],
]) {
  seed();
  const r = parse(await gitWebhook(req({ payload: ghPr("opened"), ...patch })));
  ok(r.status === 404 && Object.keys(r.body).length === 1 && r.body.ok === false,
    `${label} → 404 with no body detail (${JSON.stringify(r)})`);
  ok(pushed.length === 0, `${label} enqueues nothing`);
}
seed({ secret: null });
{
  const r = parse(await gitWebhook(req({ payload: ghPr("opened") })));
  ok(r.status === 404 && r.body.ok === false, "a connection with NO planted hook secret answers the same 404, never 'unsigned is fine'");
  ok(pushed.length === 0, "…and enqueues nothing");
}
seed();
{
  const r = parse(await gitWebhook(req({ payload: ghPr("opened"), method: "GET" })));
  ok(r.status === 405 && pushed.length === 0, "a non-POST delivery is refused without a lookup");
}
seed();
{
  // A valid signature for THIS repo carrying ANOTHER repo's payload.
  const payload = { ...ghPr("opened"), repository: { full_name: "attacker/other" } };
  const r = parse(await gitWebhook(req({ payload })));
  ok(r.status === 202 && r.body.ignored === "repo-mismatch" && pushed.length === 0,
    `a payload naming a different repo is dropped, never re-attributed (${JSON.stringify(r)})`);
}
seed({ kind: "bitbucket" });
{
  const body = JSON.stringify(ghPr("opened"));
  const r = parse(await gitWebhook({
    method: "POST", body,
    headers: { "x-github-event": ["pull_request"], "x-hub-signature-256": [sign(body)], "x-github-delivery": ["d-x"] },
    queryParameters: { conn: [CONN], repo: [REPO] },
  }));
  ok(r.status === 202 && r.body.ignored === "unrecognised-provider" && pushed.length === 0,
    "a GitHub-shaped delivery on a Bitbucket connection is ignored, not normalised with the wrong field map");
}

/* ===================== 3. every event mapping ===================== */
const MAPPINGS = [
  ["github", "pull_request", { action: "opened" }, "git:pull_request:opened"],
  ["github", "pull_request", { action: "synchronize" }, "git:pull_request:synchronize"],
  ["github", "pull_request", { action: "closed", pull_request: { merged: false } }, "git:pull_request:closed"],
  ["github", "pull_request", { action: "closed", pull_request: { merged: true } }, "git:pull_request:merged"],
  ["github", "pull_request", { action: "reopened" }, null],
  ["github", "pull_request_review", { action: "submitted" }, "git:pull_request_review:submitted"],
  ["github", "pull_request_review", { action: "dismissed" }, null],
  ["github", "issue_comment", { action: "created", issue: { pull_request: { url: "x" } } }, "git:issue_comment:created"],
  ["github", "issue_comment", { action: "created", issue: {} }, null],
  ["github", "push", {}, "git:push"],
  ["github", "check_run", { action: "completed" }, "git:check_run:completed"],
  ["github", "check_run", { action: "created" }, null],
  ["github", "ping", {}, null],
  ["bitbucket", "pullrequest:created", {}, "git:pull_request:opened"],
  ["bitbucket", "pullrequest:updated", {}, "git:pull_request:synchronize"],
  ["bitbucket", "pullrequest:fulfilled", {}, "git:pull_request:merged"],
  ["bitbucket", "pullrequest:rejected", {}, "git:pull_request:closed"],
  ["bitbucket", "pullrequest:comment_created", {}, "git:issue_comment:created"],
  ["bitbucket", "pullrequest:approved", {}, "git:pull_request_review:submitted"],
  ["bitbucket", "repo:push", {}, "git:push"],
  ["bitbucket", "repo:commit_status_updated", {}, "git:pipeline:completed"],
  ["bitbucket", "issue:created", {}, null],
];
for (const [kind, event, payload, expected] of MAPPINGS) {
  const got = mapGitEvent(kind, event, payload);
  ok(got === expected, `${kind} ${event} ${JSON.stringify(payload).slice(0, 40)} → ${expected} (got ${got})`);
  if (expected) ok(GIT_EVENT_IDS.includes(expected) && isKnownEvent(expected),
    `${expected} is a row of the ONE catalogue — the webhook invents no event ids`);
}
// merged vs closed, end to end and not just in the map.
seed();
{
  const merged = ghPr("closed", { pull_request: { merged: true, merge_commit_sha: "c".repeat(40) } });
  const r = parse(await gitWebhook(req({ payload: merged })));
  ok(r.body.eventType === "git:pull_request:merged", "a closed+merged PR is delivered as MERGED, end to end");
  const env = lastEvent().body.params.envelope;
  ok(env.pullRequest.merged === true && env.pullRequest.mergeCommitSha === "c".repeat(40),
    "…and the envelope carries merged:true and the merge commit");
}
seed();
{
  const r = parse(await gitWebhook(req({ payload: ghPr("closed") })));
  ok(r.body.eventType === "git:pull_request:closed", "a closed, unmerged PR is delivered as CLOSED");
  ok(lastEvent().body.params.envelope.pullRequest.merged === false, "…with merged:false");
}
seed();
{
  const r = parse(await gitWebhook(req({ payload: { action: "reopened", repository: { full_name: REPO } }, event: "pull_request" })));
  ok(r.status === 202 && r.body.ignored === "unsupported-event" && pushed.length === 0,
    "an event we do not model answers 202 ignored — never a retryable non-2xx");
}
seed();
{
  const r = parse(await gitWebhook(req({ payload: { zen: "x", repository: { full_name: REPO } }, event: "ping" })));
  ok(r.status === 202 && pushed.length === 0, "GitHub's `ping` is accepted and ignored (the install check succeeds)");
}

/* ===================== 4. the envelope, field for field ===================== */
seed();
{
  await gitWebhook(req({ payload: ghPr("opened"), delivery: "delivery-envelope-1" }));
  const ev = lastEvent();
  ok(ev.queue === "async-ai-queue", "the event goes on the existing async-ai-queue");
  ok(ev.body.taskType === "git-event", "taskType is `git-event` (the no-AI task type: never paced by the token governor)");
  ok(typeof ev.body.taskId === "string" && ev.body.taskId.includes("_gitevent_"), `the task id comes from makeTaskId (${ev.body.taskId})`);
  ok(ev.concurrency && ev.concurrency.key === `git-event:${CONN}` && ev.concurrency.limit === 2,
    `the push carries the per-connection concurrency cap (${JSON.stringify(ev.concurrency)})`);
  ok(Object.keys(ev.body.params).length === 1 && ev.body.params.envelope, "params carries the envelope and nothing else");

  const env = ev.body.params.envelope;
  ok(env.eventType === "git:pull_request:opened" && env.source === "git", "envelope.eventType + source:'git'");
  ok(env.connectionId === CONN, "envelope.connectionId");
  ok(env.repoId === REPO && env.repoId === env.repoId.toLowerCase(), "envelope.repoId is lower-cased owner/name");
  ok(env.actor.login === "octocat", "envelope.actor.login");
  ok(env.deliveryId === "delivery-envelope-1", "envelope.deliveryId is the provider's delivery header");
  ok(env.pullRequest.number === 42 && env.pullRequest.headSha === "a".repeat(40)
    && env.pullRequest.state === "open" && env.pullRequest.headRef === "feature/LZPT-31-thing"
    && env.pullRequest.baseRef === "main" && env.pullRequest.url.startsWith("https://github.com/"),
    `envelope.pullRequest {number, headSha, state, …} (${JSON.stringify(env.pullRequest)})`);
  ok(Array.isArray(env.issueKeys) && env.issueKeys.includes("LZPT-31"), "envelope.issueKeys (advisory, from the branch / PR title)");
  ok(env.raw && env.raw.action === "opened", "envelope.raw carries the allow-listed action verb");
  ok(!JSON.stringify(env).includes(SECRET), "the envelope never carries the signing secret");

  // THE point of the envelope: the ONE extractor reads it.
  const ctx = extractEventContext(env.eventType, env);
  ok(ctx.connectionId === CONN, "extractEventContext reads connectionId");
  ok(ctx.repoId === REPO, "extractEventContext reads repoId");
  ok(ctx.actorLogin === "octocat", "extractEventContext reads actor.login → actorLogin");
  // `num()` in the extractor stringifies every id (that is its contract for Jira ids
  // too), so the envelope carries the NUMBER and the context carries "42".
  ok(ctx.prNumber === "42", `extractEventContext reads pullRequest.number → prNumber (${ctx.prNumber})`);
  ok(ctx.deliveryId === "delivery-envelope-1", "extractEventContext reads deliveryId");
  ok(ctx.issueKey === "LZPT-31" && ctx.issueKeys.includes("LZPT-31"), "extractEventContext reads issueKeys");
  ok(ctx.entityName === `${REPO} PR #42`, `extractEventContext renders the entity name (${ctx.entityName})`);
}
seed();
{
  // A push: ref, commits (capped at 20) and the keys read out of commit subjects.
  const commits = Array.from({ length: 30 }, (_, i) => ({ id: String(i).padStart(40, "0"), message: `LZPT-${i + 1} step ${i}`, author: { username: "dev" } }));
  const payload = { repository: { full_name: REPO }, sender: { login: "pusher", id: 3 }, ref: "refs/heads/feature/LZPT-12", before: "0".repeat(40), after: "f".repeat(40), forced: false, commits };
  await gitWebhook(req({ payload, event: "push" }));
  const env = lastEvent().body.params.envelope;
  ok(env.push.ref === "refs/heads/feature/LZPT-12" && env.push.after === "f".repeat(40), "envelope.push {ref, before, after}");
  ok(env.push.commits.length === 20, `commits are capped at 20 server-side (got ${env.push.commits.length})`);
  ok(env.issueKeys.length <= 20, "issueKeys are capped at 20");
}
seed();
{
  // Untrusted strings are clamped AFTER parsing, server-side.
  const payload = ghPr("opened", { pull_request: { title: "L".repeat(5000) } });
  await gitWebhook(req({ payload }));
  const env = lastEvent().body.params.envelope;
  ok(env.pullRequest.title.length === 300, `a 5,000-char PR title is clamped to 300 (got ${env.pullRequest.title.length})`);
}
// the pure extractor
ok(gitIssueKeysFrom("feature/lzpt-31-thing").includes("LZPT-31"), "issue keys are case-insensitive in a branch name");
ok(gitIssueKeysFrom("no keys here").length === 0, "…and nothing is invented when there are none");
ok(gitIssueKeysFrom("ABC-1 ABC-1 DEF-2").length === 2, "…and they are de-duplicated");

/* ============ 4b. header casing (F-338) ============ */
seed();
{
  // Providers send mixed-case header names. The reader must fold case over the
  // ACTUAL keys, not guess spellings — every lookup on this surface (signature,
  // event, delivery id) goes through it, so a miss reads as "unsigned".
  const body = JSON.stringify(ghPr("opened"));
  const canonical = parse(await gitWebhook({
    method: "POST", body, queryParameters: { conn: [CONN], repo: [REPO] },
    headers: {
      "X-Hub-Signature-256": [sign(body)],
      "X-GitHub-Event": ["pull_request"],
      "X-GitHub-Delivery": ["case-1"],
    },
  }));
  ok(canonical.status === 202 && canonical.body.accepted === true, `GitHub's canonical header casing is read (${JSON.stringify(canonical)})`);
  ok(!!storage.__raw(`git_delivery:${CONN}:case-1`), "…including the delivery id, so dedupe still works");
  const mixed = parse(await gitWebhook({
    method: "POST", body, queryParameters: { conn: [CONN], repo: [REPO] },
    headers: {
      "x-HUB-signature-256": [sign(body)],
      "X-github-EVENT": ["pull_request"],
      "x-GitHub-DELIVERY": ["case-2"],
    },
  }));
  ok(mixed.status === 202 && mixed.body.accepted === true, `an arbitrary mixed casing is read too (${JSON.stringify(mixed)})`);
}

/* ===================== 5. redelivery ===================== */
seed();
{
  const first = parse(await gitWebhook(req({ payload: ghPr("opened"), delivery: "dup-1" })));
  ok(first.status === 202 && first.body.accepted === true && pushed.length === 1, "the first delivery is enqueued");
  const second = parse(await gitWebhook(req({ payload: ghPr("opened"), delivery: "dup-1" })));
  ok(second.status === 202 && second.body.duplicate === true, `a REDELIVERY answers 202 {duplicate:true} (${JSON.stringify(second)})`);
  ok(pushed.length === 1, "…and enqueues NOTHING the second time");
  ok(storage.__raw(`git_delivery:${CONN}:dup-1`), "the claim key is git_delivery:<connId>:<deliveryId>");
  // A DIFFERENT delivery id of the same PR still goes through — dedupe is per delivery, not per PR.
  const third = parse(await gitWebhook(req({ payload: ghPr("opened"), delivery: "dup-2" })));
  ok(third.body.accepted === true && pushed.length === 2, "a different delivery id of the same PR is still processed");
}
seed();
{
  // A failed enqueue must RELEASE the claim, or the provider's retry is swallowed.
  const realPush = Queue.prototype.push;
  Queue.prototype.push = async () => { throw new Error("queue down"); };
  const r = parse(await gitWebhook(req({ payload: ghPr("opened"), delivery: "boom-1" })));
  Queue.prototype.push = realPush;
  ok(r.status === 500, `a failed enqueue answers non-2xx so the provider retries (${JSON.stringify(r)})`);
  ok(!storage.__raw(`git_delivery:${CONN}:boom-1`), "…and the idempotency claim is released, so the retry is not seen as a duplicate");
  const retry = parse(await gitWebhook(req({ payload: ghPr("opened"), delivery: "boom-1" })));
  ok(retry.status === 202 && retry.body.accepted === true && pushed.length === 1, "…and the retry is accepted and enqueued");
}

seed();
{
  // F-334: a KVS FAULT on the claim is NOT a duplicate. 202 is the one answer
  // that stops the provider retrying, so an infrastructure fault must fail CLOSED.
  storage.__failNextSet();
  const r = parse(await gitWebhook(req({ payload: ghPr("opened"), delivery: "kvs-1" })));
  ok(r.status === 503 && r.body.duplicate !== true, `a KVS fault on the claim answers 503, not 202 duplicate (${JSON.stringify(r)})`);
  ok(pushed.length === 0, "…and nothing is enqueued");
  const retry = parse(await gitWebhook(req({ payload: ghPr("opened"), delivery: "kvs-1" })));
  ok(retry.status === 202 && retry.body.accepted === true && pushed.length === 1, "…and the provider's retry is accepted and enqueued");
}
seed();
{
  // The claim key is sanitised: a header id carrying key-hostile characters
  // cannot shape the key (or collide with another connection's namespace).
  const r = parse(await gitWebhook(req({ payload: ghPr("opened"), delivery: "a b/c\u00e9*1" })));
  ok(r.status === 202 && r.body.accepted === true, "a delivery id with hostile characters is still accepted");
  const rawId = "a b/c\u00e9*1";
  ok(!storage.__raw(`git_delivery:${CONN}:${rawId}`), "…and the raw header value never becomes the key");
  ok(!!storage.__raw(`git_delivery:${CONN}:${safeKeyPart(rawId)}`), "…the sanitised key is the one written");
}

/* ===================== 6. the raw cap and the raw whitelist ===================== */
seed();
{
  const payload = {
    action: "opened", repository: { full_name: REPO }, sender: { login: "octocat", id: 7 },
    pull_request: ghPr("opened").pull_request,
    // Everything below is NOT on the whitelist and must not reach `raw`.
    installation: { access_token: "SHOULD-NEVER-APPEAR" },
    body: "x".repeat(50000),
    diff: "y".repeat(50000),
    secret: "ALSO-NEVER",
  };
  await gitWebhook(req({ payload }));
  const env = lastEvent().body.params.envelope;
  const rawJson = JSON.stringify(env.raw);
  ok(!rawJson.includes("SHOULD-NEVER-APPEAR") && !rawJson.includes("ALSO-NEVER"),
    `raw is an emit WHITELIST — unlisted fields do not ride along (${rawJson.slice(0, 120)})`);
  ok(Buffer.byteLength(rawJson, "utf8") <= 8192, `raw is within the 8 KB cap (${Buffer.byteLength(rawJson, "utf8")} bytes)`);
  ok(Object.keys(env.raw).every((k) => ["action", "eventKey", "ref", "before", "after", "created", "deleted", "forced", "number", "_truncated"].includes(k)),
    `only allow-listed keys are present (${Object.keys(env.raw).join(",")})`);
}
seed();
{
  // A single ALLOW-LISTED string field that is enormous still cannot blow the cap.
  const payload = { action: "opened", ref: "z".repeat(60000), repository: { full_name: REPO }, sender: { login: "o", id: 1 }, pull_request: ghPr("opened").pull_request };
  await gitWebhook(req({ payload }));
  const env = lastEvent().body.params.envelope;
  ok(Buffer.byteLength(JSON.stringify(env.raw), "utf8") <= 8192, "an oversized allow-listed value is clamped, and raw stays under 8 KB");
}

/* ===================== 7. the enqueued shape is small ===================== */
seed();
{
  const payload = { repository: { full_name: REPO }, sender: { login: "p", id: 1 }, ref: "refs/heads/x", commits: Array.from({ length: 500 }, (_, i) => ({ id: String(i), message: "m".repeat(1000), author: { username: "d" } })) };
  await gitWebhook(req({ payload, event: "push" }));
  const bytes = Buffer.byteLength(JSON.stringify(lastEvent().body), "utf8");
  ok(bytes < 180000, `even a 500-commit push enqueues a bounded event (${bytes} bytes, async events cap near 200 KB)`);
}

console.log(`git-webhook: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
