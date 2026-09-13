/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * PIPELINE SETUP — the ONE home of "CogniRunner installs a deploy pipeline into a
 * customer's repository" (1.4 commit 7, FRAME § commit 7, plan §3.4/§5).
 *
 * A Forge app cannot deploy a Forge app, so the deploy runs in the customer's own
 * CI under a customer-supplied Atlassian identity. The red team's finding was that
 * letting the MODEL drive that install lets a repo collaborator install arbitrary
 * scopes. Two rules close it, and both live here:
 *
 *   1. SETUP IS AN ADMIN RESOLVER, NEVER AN AGENT ACTION. The constant that says so
 *      is `CONNECTION_SECURITY_MODEL.pipelineSetupIsAdminResolver` in
 *      git-connections.js and this module ASSERTS it rather than restating it — if
 *      anyone ever flips it, this refuses to run and the decision is visible.
 *   2. THE PERMISSION LOCK. The scopes an install may carry are committed to the
 *      repo as `.cognirunner/forge-permissions.lock`; a re-run whose rendered lock
 *      differs from the one this app recorded is REFUSED, naming the scopes that
 *      differ. The pipeline's own `check-permissions-lock.js` (in the scaffold)
 *      enforces the same rule on the runner, at install time.
 *
 * WHAT IS RECORDED, AND WHAT IS NOT. One bounded KVS row per repo,
 * `git_pipeline:<connId>:<repoId>`, written after EVERY step so a half-finished
 * setup reports as partial with the step that failed — never as "pipeline ready".
 * The step list is a FIXED name list rebuilt each run, so the row can never grow.
 * `FORGE_EMAIL` / `FORGE_API_TOKEN` values never appear in the row, in a return
 * value or in a log line: the only reader of the identity's token is
 * `readForgeIdentity()`, and its value is handed straight to `setSecret`.
 *
 * WHY IT IS QUEUED AND NOT INLINE. A sync resolver has 25 s. One setup is
 * up to ~15 HTTP calls (GitHub: 2 per secret, 1–2 per variable, 4–5 for the
 * commit; Bitbucket adds `enablePipelines`), each with its own 10 s cap. It does
 * not fit, and a resolver timeout mid-chain is exactly the "refused import left a
 * live rule attached" defect in a different costume. So the resolver VALIDATES
 * everything (connection, allow-list, identity, scope allow-list, lock) BEFORE any
 * side effect, takes a FAIL_IF_EXISTS claim and enqueues `gitpipeline` on
 * `async-ai-queue`; the consumer runs the chain. It spends no model tokens, so it
 * is in NON_AI_TASK_TYPES and `estimateTaskTokens` prices it at 0.
 */

import storage from "@forge/kvs";
import { createHash } from "node:crypto";
import { renderScaffold, buildPermissionLock, SCAFFOLD_VERSION } from "./shared/git-scaffolds.js";
import { assertCommitWithinCaps, GitProviderError } from "./git-providers.js";
import {
  getConnection,
  isRepoAllowed,
  normalizeRepoId,
  providerForConnection,
  readForgeIdentity,
  getForgeIdentityStatus,
  CONNECTION_SECURITY_MODEL,
} from "./git-connections.js";

/* ===== KEY NAMES — the ONE home. Never retype one of these strings. ===== */

/** The per-repo pipeline record. Bounded; never carries a secret. */
export const gitPipelineKey = (connId, repoId) => `git_pipeline:${connId}:${normalizeRepoId(repoId)}`;
/**
 * The concurrency CLAIM for one setup run. FAIL_IF_EXISTS, 10 minutes: two admins
 * pressing "Set up pipeline" at the same moment must not both push secrets and
 * both commit. It is released whenever the run does not complete, so the queue's
 * retry is never swallowed — see `runPipelineSetup`.
 */
export const gitPipelineClaimKey = (connId, repoId) => `git_pipeline_exec:${connId}:${normalizeRepoId(repoId)}`;

/** Task type on the EXISTING `async-ai-queue`. Priced at 0 in ai-budget.js. */
export const PIPELINE_TASK = "gitpipeline";
/** The scaffold this commits: workflow files + the app-id/lock helpers. */
export const PIPELINE_SCAFFOLD = "forge-pipeline";
/** Where the lock lives in the repo — the scaffold's own checker reads this path. */
export const PIPELINE_LOCK_PATH = ".cognirunner/forge-permissions.lock";
/** Installs are development-only; the rendered workflow enforces it, we set the var. */
export const PIPELINE_FORGE_ENV = "development";
const CLAIM_TTL = { ttl: { value: 10, unit: "MINUTES" } };

/**
 * THE SCOPE ALLOW-LIST. A lock may only carry scopes from this list.
 *
 * This is the red-team finding's actual fix: "a collaborator installs arbitrary
 * scopes" stops being possible when the set of installable scopes is a constant in
 * this app rather than whatever is in the repo's manifest this morning. WIDENING
 * THIS LIST IS A SECURITY DECISION, not a bug fix — an app that needs a scope which
 * is not here does not get its pipeline installed by CogniRunner.
 *
 * Deliberately absent, and not to be added without the owner: anything granting app
 * or site administration (`manage:app-*`, `admin:*`), any `act-as-user` variant, and
 * any scope that can mint or read credentials.
 */
export const PIPELINE_ALLOWED_SCOPES = Object.freeze([
  "storage:app",
  "read:me",
  "read:account",
  "read:jira-user",
  "read:jira-work",
  "write:jira-work",
  "read:project:jira",
  "read:issue:jira",
  "write:issue:jira",
  "read:field:jira",
  "read:workflow:jira",
  "write:workflow:jira",
  "read:issue-details:jira",
  "read:servicedesk-request",
  "read:jira-work:confluence",
  "read:confluence-content.all",
  "read:confluence-space.summary",
  "read:page:confluence",
  "read:space:confluence",
  "manage:jira-configuration",
]);
const ALLOWED_SCOPE_SET = new Set(PIPELINE_ALLOWED_SCOPES);

const nowIso = () => new Date().toISOString();

/* =========================================================================
 * PURE PARTS — the lock: its scopes, its hash, and how two locks differ.
 * No storage, no network; the offline suite drives these directly.
 * ========================================================================= */

/**
 * A permission-lock line that names a SCOPE, or null.
 *
 * `buildPermissionLock` keeps every line under `permissions:` verbatim, so the list
 * mixes structural YAML (`scopes:`, `content:`, `- unsafe-inline`) with the scope
 * items themselves. Only the items that look like a Forge scope are gated and
 * diffed; the rest are structure, compared as a whole but never reported as a
 * "scope change" (which would be a lie in a refusal message).
 */
export const scopeOfLockLine = (line) => {
  const m = /^-\s*"?([A-Za-z][A-Za-z0-9_.-]*(?::[A-Za-z0-9_.:-]+)+)"?\s*$/.exec(String(line || "").trim());
  return m ? m[1] : null;
};

/** Every scope NAME in a lock, sorted and de-duplicated. */
export const lockScopeNames = (lock) => {
  const out = new Set();
  for (const line of (lock && Array.isArray(lock.permissions) ? lock.permissions : [])) {
    const scope = scopeOfLockLine(line);
    if (scope) out.add(scope);
  }
  return [...out].sort();
};

/**
 * Scopes the allow-list refuses. Checked BEFORE any secret is written or any file
 * is committed — the `commitImportCore` rule: a refused setup leaves nothing live.
 */
export const disallowedScopes = (lock) => lockScopeNames(lock).filter((s) => !ALLOWED_SCOPE_SET.has(s));

/**
 * The lock's IDENTITY. Hashed over the permission lines only — never over
 * `approvedAt` / `approvedBy`, which change on every render and would make every
 * re-run look like a permission change.
 */
export const hashLock = (lock) =>
  createHash("sha256")
    .update(JSON.stringify((lock && Array.isArray(lock.permissions) ? lock.permissions : []).slice().sort()))
    .digest("hex")
    .slice(0, 32);

/**
 * How two locks differ, REPORTED BY SCOPE NAME. `otherLinesChanged` says the
 * structural YAML moved without naming it, because a refusal that quotes raw
 * manifest lines back at an admin is noise, and the scopes are the security fact.
 */
export const diffLocks = (committed, rendered) => {
  const a = new Set(lockScopeNames(committed));
  const b = new Set(lockScopeNames(rendered));
  const added = [...b].filter((s) => !a.has(s)).sort();
  const removed = [...a].filter((s) => !b.has(s)).sort();
  const lines = (l) => (l && Array.isArray(l.permissions) ? l.permissions : []).slice().sort().join("\n");
  return { added, removed, otherLinesChanged: lines(committed) !== lines(rendered) && !added.length && !removed.length };
};

/**
 * The FIXED step list for a run. Rebuilt every time from the provider kind, so the
 * row's `steps` array is bounded by construction and can never accumulate.
 */
export const pipelineStepNames = (kind) => [
  ...(kind === "bitbucket" ? ["enable-pipelines"] : []),
  "secret:FORGE_EMAIL",
  "secret:FORGE_API_TOKEN",
  "var:FORGE_SITE",
  "var:FORGE_PRODUCT",
  "var:FORGE_ENV",
  "commit-scaffold",
];

/* =========================================================================
 * THE ROW
 * ========================================================================= */

/** Read the record for one repo. `null` when no setup has ever been attempted. */
export async function readPipelineRow(connId, repoId) {
  if (!connId || !repoId) return null;
  const row = await storage.get(gitPipelineKey(connId, repoId));
  return row && typeof row === "object" ? row : null;
}

const freshSteps = (kind) => pipelineStepNames(kind).map((name) => ({ name, status: "pending", at: null }));

/* =========================================================================
 * THE REQUEST HALF — every refusal happens here, BEFORE any side effect.
 * ========================================================================= */

const invalid = (error, code = "invalid", extra = {}) => ({ ok: false, error, code, ...extra });

/**
 * Validate a setup request against everything that can refuse it, take the
 * concurrency claim and enqueue. Returns `{ok:true, taskId, queued:true, lockHash}`
 * or a refusal carrying a machine `code`.
 *
 * ORDER IS THE POINT. Connection → allow-list → identity+consent → scope
 * allow-list → lock comparison → claim → enqueue. Nothing before the claim writes
 * anything, and nothing at all touches the git host.
 */
export async function requestPipelineSetup({
  connectionId,
  repo,
  manifestYaml,
  site,
  product = "Jira",
  branch = null,
  scaffoldVars = null,
  accountId = null,
} = {}) {
  // The security model is DATA, and this is the assertion that keeps it honest.
  if (CONNECTION_SECURITY_MODEL.pipelineSetupIsAdminResolver !== true) {
    return invalid("Pipeline setup is an admin resolver; the security model says otherwise", "security_model");
  }
  if (!connectionId) return invalid("A git connection is required");
  const repoId = normalizeRepoId(repo);
  if (!repoId) return invalid("A repository is required");

  const conn = await getConnection(connectionId);
  if (!conn) return invalid("Unknown git connection", "not_found");
  if (conn.status === "auth_dead") {
    return invalid("This git connection's credential is no longer valid", "auth_dead");
  }
  // FAIL CLOSED: an absent or empty allow-list allows NOTHING (isRepoAllowed).
  if (!isRepoAllowed(conn, repoId)) {
    return invalid("That repository is not on this connection's allow-list", "not_allowed", {
      hint: "add-repo-to-allowlist",
    });
  }

  // The deploy identity, with RECORDED CONSENT. Absent consent is a refusal, never
  // a default-yes — this credential acts as a human in their own Atlassian tenant.
  const identity = await getForgeIdentityStatus();
  if (!identity.hasIdentity) {
    return invalid("No Forge deploy identity is configured", "identity_required", { hint: "configure-forge-identity" });
  }
  if (!identity.consent || !identity.consent.at) {
    return invalid("The stored deploy identity has no recorded consent", "consent_required", {
      hint: "configure-forge-identity",
    });
  }

  if (!site || !String(site).trim()) {
    return invalid("The Atlassian site to deploy to is required (FORGE_SITE)");
  }
  if (!manifestYaml || !String(manifestYaml).trim()) {
    return invalid("The app's manifest.yml is required — the permission lock is built from it", "manifest_required");
  }

  const lock = buildPermissionLock(String(manifestYaml), { approvedBy: accountId, source: "cognirunner" });
  const scopes = lockScopeNames(lock);
  if (!scopes.length) {
    return invalid("That manifest declares no permission scopes — nothing to lock", "manifest_required");
  }
  const refusedScopes = disallowedScopes(lock);
  if (refusedScopes.length) {
    return invalid(
      `CogniRunner will not install a pipeline for these scopes: ${refusedScopes.join(", ")}`,
      "scope_not_allowed",
      { scopes: refusedScopes }
    );
  }
  const lockHash = hashLock(lock);

  // IDEMPOTENCY, and the whole point of the lock: a repo whose recorded lock
  // differs from the one this manifest renders is REFUSED, by scope name.
  const existing = await readPipelineRow(connectionId, repoId);
  if (existing && existing.lockHash && existing.lockHash !== lockHash) {
    const d = diffLocks({ permissions: existing.lockPermissions || [] }, lock);
    const parts = [];
    if (d.added.length) parts.push(`added ${d.added.join(", ")}`);
    if (d.removed.length) parts.push(`removed ${d.removed.join(", ")}`);
    if (!parts.length) parts.push("the manifest's permissions block changed");
    return invalid(
      `The permissions in this manifest differ from the lock committed to ${repoId}: ${parts.join("; ")}. ` +
        "Re-approve the new permissions before the pipeline is reinstalled.",
      "lock_mismatch",
      { added: d.added, removed: d.removed, otherLinesChanged: d.otherLinesChanged }
    );
  }

  // Nothing has been written yet. From here on there is exactly one write before
  // the enqueue — the claim — and it is released by whichever run does not finish.
  const taskId = `gpipe_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    await storage.set(
      gitPipelineClaimKey(connectionId, repoId),
      { at: nowIso(), taskId, by: accountId || null },
      { keyPolicy: "FAIL_IF_EXISTS", ...CLAIM_TTL }
    );
  } catch (e) {
    return invalid("A pipeline setup for this repository is already running", "already_running");
  }

  const enqueuedAt = nowIso();
  try {
    const { Queue } = await import("@forge/events");
    const queue = new Queue({ key: "async-ai-queue" });
    await queue.push({
      body: {
        taskType: PIPELINE_TASK,
        taskId,
        params: {
          taskId,
          connectionId,
          repoId,
          site: String(site).trim(),
          product: String(product || "Jira").trim() || "Jira",
          branch: branch ? String(branch) : null,
          scaffoldVars: scaffoldVars && typeof scaffoldVars === "object" ? scaffoldVars : null,
          lock,
          lockHash,
          requestedBy: accountId || null,
          enqueuedAt,
        },
      },
    });
  } catch (e) {
    // The push failed, so nothing will ever run. Give the claim back, or the next
    // attempt is refused as "already running" for ten minutes for no reason.
    await releaseClaim(connectionId, repoId);
    return invalid(`Could not queue the pipeline setup: ${String((e && e.message) || e).slice(0, 160)}`, "queue");
  }

  // The row is created QUEUED so the UI has something to poll immediately, and so
  // a setup that dies in the consumer is visible as queued-and-never-ran.
  const row = {
    connId: connectionId,
    repoId,
    kind: conn.kind,
    scaffold: PIPELINE_SCAFFOLD,
    scaffoldVersion: SCAFFOLD_VERSION,
    steps: freshSteps(conn.kind),
    lockHash,
    lockPermissions: lock.permissions.slice(0, 200),
    lockScopes: scopes,
    status: "queued",
    installedAt: existing ? existing.installedAt || null : null,
    lastRun: existing ? existing.lastRun || null : null,
    taskId,
    requestedBy: accountId || null,
    queuedAt: enqueuedAt,
    updatedAt: enqueuedAt,
  };
  await storage.set(gitPipelineKey(connectionId, repoId), row);
  return { ok: true, queued: true, taskId, lockHash, status: row };
}

async function releaseClaim(connId, repoId) {
  try {
    await storage.delete(gitPipelineClaimKey(connId, repoId));
  } catch (_) {
    /* best-effort: the real answer is the caller's */
  }
}

/* =========================================================================
 * THE EXECUTION HALF — the consumer's work.
 * ========================================================================= */

/**
 * Run the step chain for one repo.
 *
 * Every step is recorded on the row BEFORE the next one starts, so a chain that
 * dies half-way reports as `status:"partial"` naming the step that failed. A
 * partial setup is NEVER reported as ready — the FRAME's fail-closed rule for this
 * commit, and the reason the row exists at all.
 *
 * THE LOCK IS RE-CHECKED HERE. The request half already compared it, but minutes
 * can pass on a queue and the row is the authority; re-checking costs one read and
 * closes the window where a second request changed the recorded lock.
 *
 * THE CLAIM IS RELEASED ON EVERY EXIT, success or failure. The instruction this was
 * built to ("released on any non-completion") exists so the platform's retry is not
 * swallowed; holding it after a SUCCESS would instead refuse a legitimate re-run
 * for ten minutes with "already running", which is a false sentence. The row's
 * `lockHash` + `installedAt` is the idempotency record; the claim only ever guards
 * CONCURRENCY.
 */
export async function runPipelineSetup(params, { fetchImpl } = {}) {
  const p = params || {};
  const { connectionId, repoId, lockHash } = p;
  if (!connectionId || !repoId || !p.lock) {
    return { ok: false, error: "gitpipeline requires connectionId, repoId and a lock", code: "invalid" };
  }

  const finish = async (result) => {
    await releaseClaim(connectionId, repoId);
    return result;
  };

  let row = await readPipelineRow(connectionId, repoId);
  if (!row) {
    return finish({ ok: false, error: "The pipeline record is gone — nothing was changed", code: "not_found" });
  }
  // AT-LEAST-ONCE IS THE PLATFORM'S PROMISE. A redelivery of a run that already
  // installed THIS lock does nothing and says so.
  if (row.installedAt && row.lockHash === lockHash && row.status === "installed") {
    return finish({ ok: true, duplicate: true, status: publicPipelineRow(row) });
  }
  if (row.lockHash && lockHash && row.lockHash !== lockHash) {
    const d = diffLocks({ permissions: row.lockPermissions || [] }, p.lock);
    return finish({
      ok: false,
      code: "lock_mismatch",
      error: `The recorded permission lock for ${repoId} changed while this setup was queued (added ${d.added.join(", ") || "none"}, removed ${d.removed.join(", ") || "none"}) — nothing was changed`,
      added: d.added,
      removed: d.removed,
    });
  }

  const kind = row.kind;
  const steps = freshSteps(kind);
  let index = 0;
  const write = async (patch) => {
    row = { ...row, ...patch, steps, updatedAt: nowIso() };
    await storage.set(gitPipelineKey(connectionId, repoId), row);
  };
  const step = async (name, fn) => {
    const slot = steps[index];
    if (!slot || slot.name !== name) {
      // The fixed list and the chain disagree — a programming error, not a runtime
      // one, and it must be loud rather than silently skipping a step.
      throw new Error(`pipeline step order mismatch: expected ${slot && slot.name} got ${name}`);
    }
    index++;
    try {
      await fn();
      slot.status = "done";
      slot.at = nowIso();
      await write({ status: "running" });
    } catch (e) {
      slot.status = "failed";
      slot.at = nowIso();
      // The MESSAGE only. A provider error body is already redacted of the secrets
      // the adapter knows about; nothing here re-adds one.
      slot.error = String((e && e.message) || e).slice(0, 300);
      await write({ status: "partial", failedStep: name });
      throw e;
    }
  };

  await write({ status: "running", startedAt: nowIso(), taskId: p.taskId || row.taskId || null, failedStep: null });

  try {
    // `providerForConnection` re-checks the allow-list and fails closed on a dead
    // credential — the allow-list is enforced on BOTH sides of the queue.
    const provider = await providerForConnection(connectionId, { repo: repoId, fetchImpl });
    // The only read of the deploy token in this module. It is handed to setSecret
    // and never held anywhere else.
    const identity = await readForgeIdentity();

    if (kind === "bitbucket") {
      await step("enable-pipelines", () => provider.enablePipelines({ repo: repoId, enabled: true }));
    }
    await step("secret:FORGE_EMAIL", () =>
      provider.setSecret({ repo: repoId, name: "FORGE_EMAIL", value: identity.email }));
    await step("secret:FORGE_API_TOKEN", () =>
      provider.setSecret({ repo: repoId, name: "FORGE_API_TOKEN", value: identity.token }));
    await step("var:FORGE_SITE", () => provider.setVariable({ repo: repoId, name: "FORGE_SITE", value: p.site }));
    await step("var:FORGE_PRODUCT", () =>
      provider.setVariable({ repo: repoId, name: "FORGE_PRODUCT", value: p.product || "Jira" }));
    await step("var:FORGE_ENV", () =>
      provider.setVariable({ repo: repoId, name: "FORGE_ENV", value: PIPELINE_FORGE_ENV }));

    let sha = null;
    await step("commit-scaffold", async () => {
      const files = renderScaffold(PIPELINE_SCAFFOLD, p.scaffoldVars || {});
      files.push({
        path: PIPELINE_LOCK_PATH,
        content: JSON.stringify(p.lock, null, 2) + "\n",
      });
      // The cap is checked BEFORE the write, here as well as inside the adapter,
      // so a refusal happens with nothing half-committed.
      assertCommitWithinCaps(kind, files);
      const branch = p.branch || (await provider.getDefaultBranch({ repo: repoId }));
      const out = await provider.commitFiles({
        repo: repoId,
        branch,
        message: "chore(cognirunner): install Forge deploy pipeline + permission lock",
        files,
      });
      sha = (out && out.sha) || null;
      row = { ...row, branch, commitSha: sha };
    });

    await write({ status: "installed", installedAt: nowIso(), failedStep: null, commitSha: sha });
    return finish({ ok: true, status: publicPipelineRow(row) });
  } catch (e) {
    const code = e instanceof GitProviderError ? e.code : "error";
    return finish({
      ok: false,
      code,
      error: String((e && e.message) || e).slice(0, 300),
      status: publicPipelineRow(row),
    });
  }
}

/**
 * THE public shape of the row. An ALLOW-LIST, for the same reason
 * `publicConnection` is one: a field added to the stored row must not become a
 * field the UI receives by accident.
 */
export function publicPipelineRow(row) {
  if (!row || typeof row !== "object") return null;
  return {
    connId: row.connId || null,
    repoId: row.repoId || null,
    kind: row.kind || null,
    scaffold: row.scaffold || null,
    scaffoldVersion: row.scaffoldVersion ?? null,
    status: row.status || null,
    steps: (Array.isArray(row.steps) ? row.steps : []).map((s) => ({
      name: String(s && s.name).slice(0, 40),
      status: String((s && s.status) || "pending").slice(0, 20),
      at: (s && s.at) || null,
      ...(s && s.error ? { error: String(s.error).slice(0, 300) } : {}),
    })),
    failedStep: row.failedStep || null,
    lockHash: row.lockHash || null,
    lockScopes: Array.isArray(row.lockScopes) ? row.lockScopes.slice(0, 100) : [],
    branch: row.branch || null,
    commitSha: row.commitSha || null,
    installedAt: row.installedAt || null,
    queuedAt: row.queuedAt || null,
    startedAt: row.startedAt || null,
    updatedAt: row.updatedAt || null,
    lastRun: row.lastRun || null,
    requestedBy: row.requestedBy || null,
  };
}

/* =========================================================================
 * STATUS + DEPLOY TRIGGER
 * ========================================================================= */

/**
 * The row, plus a LIVE deploy read when a run is known.
 *
 * The live read is BEST EFFORT: a provider fault yields `deploy:null` and a
 * `deployError` sentence rather than failing the whole read. The row is the fact
 * the admin needs (did setup finish, which step failed); a CI outage must not hide
 * it. That is a read-only surface with no side effect, so it is the one place in
 * this module that does not fail closed, and this sentence is why.
 */
export async function pipelineStatus(connectionId, repoId, { fetchImpl } = {}) {
  const row = await readPipelineRow(connectionId, normalizeRepoId(repoId));
  if (!row) return { ok: true, status: null, deploy: null };
  const out = { ok: true, status: publicPipelineRow(row), deploy: null };
  const run = row.lastRun || null;
  if (!run) return out;
  try {
    const provider = await providerForConnection(connectionId, { repo: row.repoId, fetchImpl });
    const deploy = await provider.getDeployStatus(
      row.kind === "github"
        ? { repo: row.repoId, workflow: run.workflow || "forge-deploy.yml", branch: run.ref || row.branch || undefined, limit: 5 }
        : { repo: row.repoId, limit: 5 }
    );
    out.deploy = deploy;
  } catch (e) {
    out.deployError = String((e && e.message) || e).slice(0, 200);
  }
  return out;
}

/**
 * Start a deploy on an ALREADY INSTALLED pipeline.
 *
 * This is the `dangerous`-class action the agent gate permits a model to *trigger*
 * and never to *install*: an explicit `confirm === true` from the caller's payload
 * is required, the repo must be on the allow-list, and the run id is recorded on
 * the row so the status read has something to poll. GitHub's dispatch returns 204
 * with no id — `lastRun.id` is then null, which is the truth, not an invented id.
 */
export async function triggerPipelineDeploy({
  connectionId,
  repo,
  confirm,
  ref = null,
  workflow = "forge-deploy.yml",
  accountId = null,
  fetchImpl,
} = {}) {
  if (confirm !== true) {
    return invalid("Starting a deploy needs an explicit confirmation", "confirmation_required", {
      hint: "confirm-dangerous-action",
    });
  }
  if (!connectionId) return invalid("A git connection is required");
  const repoId = normalizeRepoId(repo);
  if (!repoId) return invalid("A repository is required");
  const conn = await getConnection(connectionId);
  if (!conn) return invalid("Unknown git connection", "not_found");
  if (!isRepoAllowed(conn, repoId)) {
    return invalid("That repository is not on this connection's allow-list", "not_allowed");
  }
  const row = await readPipelineRow(connectionId, repoId);
  if (!row || row.status !== "installed") {
    return invalid("No installed pipeline for that repository — set it up first", "not_installed");
  }
  const branch = ref || row.branch || null;
  if (!branch) return invalid("A branch to deploy is required", "invalid");

  let out;
  try {
    const provider = await providerForConnection(connectionId, { repo: repoId, fetchImpl });
    out =
      conn.kind === "github"
        ? await provider.triggerDeploy({ repo: repoId, workflow, ref: branch, inputs: { environment: PIPELINE_FORGE_ENV } })
        : await provider.triggerDeploy({ repo: repoId, ref: branch });
  } catch (e) {
    const code = e instanceof GitProviderError ? e.code : "error";
    return invalid(String((e && e.message) || e).slice(0, 300), code);
  }
  const lastRun = {
    id: (out && out.id) || null,
    ref: branch,
    workflow: conn.kind === "github" ? workflow : null,
    at: nowIso(),
    by: accountId || null,
  };
  await storage.set(gitPipelineKey(connectionId, repoId), { ...row, lastRun, updatedAt: nowIso() });
  return { ok: true, run: lastRun };
}
