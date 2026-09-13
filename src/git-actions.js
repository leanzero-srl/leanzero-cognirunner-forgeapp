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
 */

/**
 * EXECUTOR for the `git` agent-action namespace (src/shared/agent-actions.js).
 *
 * One module per namespace; `src/agent-runner.js` delegates by namespace and never
 * learns a git action id. Everything the MODEL emits is clamped HERE, in code —
 * a prompt is never a guarantee (LAW 2):
 *
 *   · the repository must be in the CONNECTION'S allow-list (`conn.repos`); a repo the
 *     admin did not allow is refused before any provider call, never "probably fine";
 *   · branch names and file paths are sanitised (no `..`, no refspec metacharacters);
 *   · a commit carries at most MAX_COMMIT_FILES files and MAX_COMMIT_BYTES in total;
 *   · a PR body is capped at MAX_PR_BODY_BYTES, a comment at MAX_COMMENT_BYTES;
 *   · every result is defanged (it is quoted back to the model inside a fence and a
 *     PR body is attacker-authored text) and capped at MAX_RESULT_BYTES.
 *
 * SIMULATION is a guarantee, not a convention: in simulation every write returns
 * `{ simulated: true, … }` and the provider is never called at all.
 *
 * The connection store (src/git-connections.js) is the ONE home of the connection
 * record, the repo allow-list predicate and the provider factory; this module imports
 * them and only accepts `deps` overrides so the offline suite can run without KVS.
 */
import { GitProviderError, GIT_ERROR_CODES } from "./git-providers.js";
import { getConnection as storeGetConnection, providerForConnection as storeProviderForConnection, isRepoAllowed } from "./git-connections.js";
import { defangFence } from "./memories.js";

/** Caps — the ONE home for the git-action clamps (plan §3.14 "bounded inputs"). */
export const MAX_COMMIT_FILES = 20;
export const MAX_COMMIT_BYTES = 200 * 1024;
export const MAX_PR_BODY_BYTES = 8 * 1024;
export const MAX_COMMENT_BYTES = 4 * 1024;
export const MAX_RESULT_BYTES = 12 * 1024;
const MAX_TITLE_CHARS = 250;
const MAX_MESSAGE_CHARS = 2000;
const MAX_BRANCH_CHARS = 200;
const MAX_PATH_CHARS = 255;
const MAX_DEPLOY_INPUTS = 20;
/** One repository per run. A create is the least reversible write in the namespace. */
export const MAX_CREATE_REPO_PER_RUN = 1;

/** Our own refusal codes, distinct from the provider's GIT_ERROR_CODES. */
export const GIT_ACTION_CODES = ["not_configured", "not_allowed", "invalid_args", "too_large", "unknown_action", "unknown"];

class ActionRefusal extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const refuse = (code, message) => { throw new ActionRefusal(code, message); };

const byteLen = (s) => Buffer.byteLength(String(s == null ? "" : s), "utf8");
const str = (v) => String(v == null ? "" : v);

const clampText = (value, maxBytes, what) => {
  const s = str(value);
  if (byteLen(s) <= maxBytes) return s;
  // Cap, never refuse: a long body is the model being verbose, not an attack.
  const note = `\n…[${what} truncated]`;
  const room = Math.max(0, maxBytes - byteLen(note));
  return Buffer.from(s, "utf8").subarray(0, room).toString("utf8").replace(/\uFFFD$/, "") + note;
};

/** Branch / ref names: reject rather than repair — a silently rewritten ref is a wrong write. */
export const sanitizeBranch = (value, what = "branch") => {
  const b = str(value).trim();
  if (!b) refuse("invalid_args", `${what} is required`);
  if (b.length > MAX_BRANCH_CHARS) refuse("invalid_args", `${what} is too long`);
  if (b.startsWith("-") || b.startsWith("/") || b.endsWith("/") || b.endsWith(".lock")) refuse("invalid_args", `${what} "${b}" is not a valid ref name`);
  if (b.includes("..") || b.includes("@{") || /[~^:?*[\]\\\s]/.test(b) || /[\x00-\x1f\x7f]/.test(b)) refuse("invalid_args", `${what} "${b}" contains characters git does not allow`);
  return b;
};

export const sanitizePath = (value) => {
  const p = str(value).trim().replace(/^\/+/, "");
  if (!p) refuse("invalid_args", "file path is required");
  if (p.length > MAX_PATH_CHARS) refuse("invalid_args", `file path "${p.slice(0, 60)}…" is too long`);
  if (p.split("/").some((seg) => seg === "." || seg === ".." || seg === "")) refuse("invalid_args", `file path "${p}" must be a plain repository-relative path`);
  if (/[\x00-\x1f\x7f]/.test(p)) refuse("invalid_args", "file path contains control characters");
  return p;
};

const positiveInt = (value, what) => {
  const n = typeof value === "number" ? value : parseInt(str(value), 10);
  if (!Number.isFinite(n) || n <= 0 || Math.floor(n) !== n) refuse("invalid_args", `${what} must be a positive whole number`);
  return n;
};

/**
 * THE allow-list predicate has ONE home: `isRepoAllowed` in src/git-connections.js
 * (F-276 — this file used to carry a second, subtly different copy that also
 * stripped a `.git` suffix, so the two disagreed on `acme/app.git`). Re-exported
 * here only so a reader of this file can find it.
 */
export { isRepoAllowed };

/** Deep-defang every string in a result, then cap the serialised size. */
const fenceReady = (value, depth = 0) => {
  if (typeof value === "string") return defangFence(value);
  if (Array.isArray(value)) return depth > 6 ? [] : value.map((v) => fenceReady(v, depth + 1));
  if (value && typeof value === "object") {
    if (depth > 6) return {};
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = fenceReady(v, depth + 1);
    return out;
  }
  return value;
};

/**
 * Cap the serialised result at MAX_RESULT_BYTES measured in UTF-8 BYTES — the model's
 * transport and the 12 KB tool-result budget are byte-counted, and a CJK or emoji
 * payload is up to 4× its `.length` (F-280). The truncated form KEEPS `success` and
 * `simulated`: a big result must never read as a different outcome than the small one.
 */
export const capResult = (result) => {
  const safe = fenceReady(result);
  const raw = JSON.stringify(safe === undefined ? {} : safe);
  if (byteLen(raw) <= MAX_RESULT_BYTES) return safe;
  const keep = safe && typeof safe === "object" && !Array.isArray(safe) ? safe : {};
  const head = { ...(keep.success !== undefined ? { success: keep.success } : {}), ...(keep.simulated !== undefined ? { simulated: keep.simulated } : {}), ...(keep.action !== undefined ? { action: keep.action } : {}) };
  const room = Math.max(0, MAX_RESULT_BYTES - byteLen(JSON.stringify({ ...head, truncated: true, note: "", data: "" })) - 120);
  return {
    ...head,
    truncated: true,
    note: `Result was ${byteLen(raw)} bytes; truncated to ${MAX_RESULT_BYTES}.`,
    data: Buffer.from(raw, "utf8").subarray(0, room).toString("utf8").replace(/\uFFFD$/, ""),
  };
};

/**
 * Build the executor for ONE agent run. `connectionId` is the rule's connection;
 * a tool call may name another with `connectionId`, and it is resolved through the
 * same store (which refuses an unknown, dead or credential-less connection).
 * This module never sees a token — it sees the adapter the store built.
 */
export const createGitActionExecutor = ({
  simulation = false,
  log = () => {},
  connectionId = null,
  fetchImpl,
  // DI, FOR TESTS ONLY. Production takes the real store: the connection record, the
  // allow-list predicate and the provider factory all have ONE home in
  // src/git-connections.js (F-276), and that home is what applies the auth_dead and
  // allow-list refusals to every caller, not just this one.
  deps = {},
} = {}) => {
  const getConnection = deps.getConnection || storeGetConnection;
  const providerFor = deps.providerForConnection || storeProviderForConnection;
  const allowed = deps.isRepoAllowed || isRepoAllowed;

  // Per-EXECUTOR (i.e. per-run) budget. The executor is built once per agent run.
  let createdRepos = 0;

  const resolve = async (args) => {
    const id = args && args.connectionId ? str(args.connectionId) : connectionId;
    const conn = await getConnection(id || null);
    if (!conn) refuse("not_configured", "No Git connection is configured for this rule.");
    if (conn.status === "auth_dead") {
      throw new GitProviderError("auth_dead", "The Git connection's credential is no longer valid.", { provider: conn.kind });
    }
    // The provider is built LAZILY and by the store, which never lets the token out
    // of itself. Lazy matters twice: the argument clamps and the allow-list refusal
    // run first (so the model gets OUR reason, not the store's), and a SIMULATED
    // write never builds a provider or reads a credential at all.
    // `repo` is passed on so the store re-checks the allow-list: the check in
    // repoOf() is the message, this one is the guarantee.
    const getProvider = () => providerFor(conn.id || id || null, { repo: args && args.repo ? str(args.repo).trim() : undefined, fetchImpl });
    return { conn, getProvider };
  };

  const repoOf = (conn, args) => {
    const repo = str(args && args.repo).trim();
    if (!repo) refuse("invalid_args", "repo is required (owner/name)");
    if (!allowed(conn, repo)) refuse("not_allowed", `Repository "${repo}" is not in this connection's allowed repositories.`);
    return repo;
  };

  const clampFiles = (files) => {
    if (!Array.isArray(files) || !files.length) refuse("invalid_args", "files must be a non-empty array of { path, content }");
    if (files.length > MAX_COMMIT_FILES) refuse("too_large", `A commit may carry at most ${MAX_COMMIT_FILES} files (got ${files.length}).`);
    let total = 0;
    const out = files.map((f) => {
      const path = sanitizePath(f && f.path);
      const content = str(f && f.content);
      total += byteLen(content) + byteLen(path);
      return { path, content };
    });
    if (total > MAX_COMMIT_BYTES) refuse("too_large", `A commit may carry at most ${MAX_COMMIT_BYTES} bytes (got ${total}).`);
    return out;
  };

  // id → { write, plan(conn,args) → { call, summary } }. `plan` does ALL clamping, so a
  // simulated write is clamped and refused exactly like a real one.
  const PLANS = {
    create_repo: {
      write: true,
      plan: (conn, args) => {
        const name = str(args.name).trim();
        if (!name || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name)) refuse("invalid_args", "name must be a simple repository name (letters, digits, . _ -)");
        // `conn.repos` cannot bound this one — the repository does not exist yet — so the
        // bound is the CONNECTION'S OWN account/workspace plus a per-run budget of one
        // (F-278). Without both, "create a repo" is an unbounded write to any org the
        // token can reach, and a looping model can make hundreds.
        const owner = str(args.org).trim();
        const connOwner = str(conn.owner || conn.workspace || "").trim();
        if (owner && connOwner && owner.toLowerCase() !== connOwner.toLowerCase()) refuse("not_allowed", `This connection may only create repositories under "${connOwner}".`);
        if (owner && !connOwner) refuse("not_allowed", "This connection does not declare an owner, so a repository may only be created in its own account (omit org).");
        // The BUDGET IS CHECKED HERE AND SPENT ON SUCCESS (F-308). Counting the attempt
        // meant a simulated create, or one that failed with bad_request, permanently
        // burned the run's single allowance and the model was then refused with a cap
        // message for a repository that was never created.
        if (createdRepos >= MAX_CREATE_REPO_PER_RUN) refuse("not_allowed", `Only ${MAX_CREATE_REPO_PER_RUN} repository may be created per run.`);
        const onSuccess = () => { createdRepos++; };
        const common = { name, private: args.private !== false, description: clampText(args.description, 1000, "description") };
        // ONE plan, TWO provider vocabularies (F-300). Bitbucket's adapter takes
        // `workspace` and REQUIRES it; the model only ever knows the action's `org`
        // argument, so the mapping happens here rather than being an argument error
        // naming a parameter the model was never offered.
        if (conn.kind === "bitbucket") {
          const workspace = owner || str(conn.workspace || conn.owner || "").trim();
          if (!workspace) refuse("not_configured", "This Bitbucket connection has no workspace, so a repository cannot be created. Set the workspace on the connection in the Code tab.");
          const payload = { ...common, workspace };
          return { summary: payload, onSuccess, call: (p) => p.createRepo(payload) };
        }
        // GitHub: a PERSONAL account creates through /user/repos, an ORGANISATION
        // through /orgs/{org}/repos, and the adapter picks by whether `org` is set
        // (F-301). `conn.owner` is the whoami LOGIN for both kinds, so it cannot
        // answer the question — only the account TYPE can. Until the connection
        // stores it, REFUSE with a cause an admin can act on rather than send a
        // personal account to /orgs/<login>/repos and report a 404.
        const accountType = str(conn.accountType || conn.ownerType || "").trim().toLowerCase();
        if (owner) {
          const payload = { ...common, org: owner };
          return { summary: payload, onSuccess, call: (p) => p.createRepo(payload) };
        }
        if (accountType === "user") {
          const payload = { ...common };           // no org ⇒ /user/repos
          return { summary: payload, onSuccess, call: (p) => p.createRepo(payload) };
        }
        if (accountType === "organization" || accountType === "org") {
          if (!connOwner) refuse("not_configured", "This connection does not declare an organisation, so a repository cannot be created.");
          const payload = { ...common, org: connOwner };
          return { summary: payload, onSuccess, call: (p) => p.createRepo(payload) };
        }
        refuse("not_configured", "This connection does not record whether its account is a user or an organisation, so a repository cannot be created safely. Re-test the connection in the Code tab to refresh its identity, or pass org explicitly.");
      },
    },
    create_branch: {
      write: true,
      plan: (conn, args) => {
        const repo = repoOf(conn, args);
        const payload = { repo, branch: sanitizeBranch(args.branch), fromBranch: args.fromBranch ? sanitizeBranch(args.fromBranch, "fromBranch") : undefined };
        return { summary: payload, call: (p) => p.createBranch(payload) };
      },
    },
    commit_files: {
      write: true,
      plan: (conn, args) => {
        const repo = repoOf(conn, args);
        const branch = sanitizeBranch(args.branch);
        const message = clampText(args.message, MAX_MESSAGE_CHARS, "commit message");
        if (!message.trim()) refuse("invalid_args", "message is required");
        const files = clampFiles(args.files);
        return { summary: { repo, branch, message, files: files.length }, call: (p) => p.commitFiles({ repo, branch, message, files }) };
      },
    },
    open_pull_request: {
      write: true,
      plan: (conn, args) => {
        const repo = repoOf(conn, args);
        const title = str(args.title).trim().slice(0, MAX_TITLE_CHARS);
        if (!title) refuse("invalid_args", "title is required");
        const payload = {
          repo, title, body: clampText(args.body, MAX_PR_BODY_BYTES, "pull request body"),
          sourceBranch: sanitizeBranch(args.sourceBranch, "sourceBranch"),
          targetBranch: args.targetBranch ? sanitizeBranch(args.targetBranch, "targetBranch") : undefined,
          draft: args.draft === true,
        };
        return { summary: payload, call: (p) => p.openPullRequest(payload) };
      },
    },
    get_pull_request: {
      write: false,
      plan: (conn, args) => {
        const payload = { repo: repoOf(conn, args), number: positiveInt(args.number, "number") };
        return { summary: payload, call: (p) => p.getPullRequest(payload) };
      },
    },
    add_pr_comment: {
      write: true,
      plan: (conn, args) => {
        const repo = repoOf(conn, args);
        const body = clampText(args.body, MAX_COMMENT_BYTES, "comment");
        if (!body.trim()) refuse("invalid_args", "body is required");
        const payload = { repo, number: positiveInt(args.number, "number"), body };
        if (args.path) { payload.path = sanitizePath(args.path); payload.line = positiveInt(args.line, "line"); }
        return { summary: payload, call: (p) => p.addPullRequestComment(payload) };
      },
    },
    approve_pull_request: {
      write: true,
      plan: (conn, args) => {
        const payload = { repo: repoOf(conn, args), number: positiveInt(args.number, "number"), body: clampText(args.body, MAX_COMMENT_BYTES, "comment") };
        return { summary: payload, call: (p) => p.approvePullRequest(payload) };
      },
    },
    request_changes: {
      write: true,
      plan: (conn, args) => {
        const body = clampText(args.body, MAX_COMMENT_BYTES, "comment");
        if (!body.trim()) refuse("invalid_args", "body is required — say why changes are needed");
        const payload = { repo: repoOf(conn, args), number: positiveInt(args.number, "number"), body };
        return { summary: payload, call: (p) => p.requestChanges(payload) };
      },
    },
    get_build_state: {
      write: false,
      plan: (conn, args) => {
        const ref = str(args.ref).trim();
        const payload = { repo: repoOf(conn, args), ref: /^[0-9a-f]{7,40}$/i.test(ref) ? ref : sanitizeBranch(ref, "ref") };
        return { summary: payload, call: (p) => p.getBuildState(payload) };
      },
    },
    trigger_deploy: {
      write: true,
      plan: (conn, args) => {
        const repo = repoOf(conn, args);
        const workflow = str(args.workflow).trim();
        if (!workflow || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,120}$/.test(workflow) || workflow.includes("..")) refuse("invalid_args", "workflow must be a workflow file name or pipeline id");
        const ref = str(args.ref).trim();
        const inputs = {};
        const given = args.inputs && typeof args.inputs === "object" && !Array.isArray(args.inputs) ? args.inputs : {};
        for (const [k, v] of Object.entries(given).slice(0, MAX_DEPLOY_INPUTS)) inputs[str(k).slice(0, 80)] = str(typeof v === "object" ? JSON.stringify(v) : v).slice(0, 500);
        const payload = { repo, workflow, ref: /^[0-9a-f]{7,40}$/i.test(ref) ? ref : sanitizeBranch(ref, "ref"), inputs };
        return { summary: payload, call: (p) => p.triggerDeploy(payload) };
      },
    },
    get_deploy_status: {
      write: false,
      plan: (conn, args) => {
        const payload = { repo: repoOf(conn, args), workflow: args.workflow ? str(args.workflow).trim().slice(0, 120) : undefined, branch: args.branch ? sanitizeBranch(args.branch) : undefined, limit: 5 };
        return { summary: payload, call: (p) => p.getDeployStatus(payload) };
      },
    },
  };

  const ACTION_IDS = Object.keys(PLANS);

  return {
    namespace: "git",
    actionIds: ACTION_IDS,
    simulation: !!simulation,
    handles: (id) => Object.prototype.hasOwnProperty.call(PLANS, str(id)),

    /**
     * Execute one git action. NEVER throws: every failure is a
     * `{ success:false, code, error }` the runner can hand back to the model.
     * `auth_dead` additionally carries `banner:"auth_dead"` so the surface that
     * renders banners does not need a second error channel.
     */
    async execute(actionId, args = {}) {
      const id = str(actionId);
      const row = PLANS[id];
      if (!row) return { success: false, code: "unknown_action", error: `"${id}" is not a git action.` };
      try {
        if (!args || typeof args !== "object" || Array.isArray(args)) refuse("invalid_args", "tool arguments must be a JSON object");
        const { conn, getProvider } = await resolve(args);
        const planned = row.plan(conn, args);
        if (row.write && simulation) {
          log(`SIMULATION git ${id}: ${JSON.stringify(planned.summary).slice(0, 400)}`);
          return capResult({ success: true, simulated: true, action: id, connection: conn.id || null, request: planned.summary });
        }
        const out = await planned.call(await getProvider());
        // Per-run budgets are spent by RESULTS, never by attempts (F-308). This runs
        // only on the real, successful path — a simulation returned above.
        if (typeof planned.onSuccess === "function") planned.onSuccess();
        log(`git ${id} ok`);
        return capResult({ success: true, action: id, ...(out && typeof out === "object" && !Array.isArray(out) ? out : { result: out }) });
      } catch (e) {
        if (e instanceof ActionRefusal) {
          log(`git ${id} refused (${e.code}): ${e.message}`);
          return { success: false, code: e.code, error: defangFence(str(e.message).slice(0, 500)) };
        }
        // Only a code the PROVIDER actually produced is reported as a provider code.
        // Anything else is OUR bug or an unexpected runtime fault and says so — calling
        // it "network" told operators to check connectivity for a TypeError (F-279).
        const code = e && GIT_ERROR_CODES.includes(e.code) ? e.code : "unknown";
        const out = { success: false, code, error: defangFence(str(e && e.message).slice(0, 500)) };
        if (code === "auth_dead") out.banner = "auth_dead";
        log(`git ${id} failed (${code})`);
        return out;
      }
    },
  };
};
