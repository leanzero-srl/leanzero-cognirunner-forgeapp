// Offline: the scaffold single source renders, substitutes only declared vars, refuses unsafe
// values, never contains a JS template literal (GitHub Actions ${{ }} would be a SyntaxError),
// and the permission lock extractor sees exactly the manifest's permissions block.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const m = await import(path.join(here, "..", "..", "src", "shared", "git-scaffolds.js"));

const files = m.renderScaffold("forge-custom-ui", { APP_NAME: "Proof App" });
assert.ok(files.length >= 14, "renders the tree");
const wf = files.find((f) => f.path === ".github/workflows/forge-deploy.yml");
assert.ok(wf.content.includes("${{ secrets.FORGE_API_TOKEN }}"), "GitHub Actions syntax survives verbatim");
assert.ok(wf.content.includes("FORGE_APP_NAME: Proof App"), "declared var substituted");
assert.ok(!files.some((f) => /\{\{[A-Z_]+\}\}/.test(f.content)), "no unresolved placeholder");
assert.throws(() => m.renderScaffold("forge-custom-ui", { APP_NAME: "x`y" }), /unsafe/);
assert.throws(() => m.renderScaffold("nope"), /Unknown scaffold/);
const manifest = files.find((f) => f.path === "manifest.yml").content;
const lock = m.buildPermissionLock(manifest);
assert.deepEqual(lock.permissions, ["- read:jira-user", "- read:jira-work", "- storage:app", "- unsafe-inline", "content:", "scopes:", "styles:"]);
assert.ok(manifest.includes(m.PLACEHOLDER_FORGE_APP_ID), "committed manifest keeps the placeholder id");

// F-343 — the lock's identity is its SCOPE SET. Two renders of one manifest must be
// byte-equal; only the provenance siblings (approvedBy/approvedAt, which nothing
// compares or hashes) may differ, and only when a caller passes them.
{
  const a = m.buildPermissionLock(manifest);
  const b = m.buildPermissionLock(manifest);
  assert.equal(JSON.stringify(a), JSON.stringify(b), "two renders of one manifest are byte-equal");
  assert.equal(a.approvedAt, null, "approvedAt defaults to a fixed sentinel, not a wall clock");
  const stamped = m.buildPermissionLock(manifest, { approvedAt: "2026-01-01T00:00:00.000Z", approvedBy: "acc" });
  assert.equal(stamped.approvedAt, "2026-01-01T00:00:00.000Z", "a caller may stamp the provenance");
  assert.deepEqual(stamped.permissions, a.permissions, "…without changing the lock's identity");
  const ignore = (l) => JSON.stringify({ ...l, approvedAt: null, approvedBy: null });
  assert.equal(ignore(stamped), ignore(a), "stamped and unstamped locks are equal once provenance is excluded");
  const sources = m.SCAFFOLD_INDEX.map((sc) => sc.id);
  for (const id of sources) {
    const mf = m.renderScaffold(id, { APP_NAME: "Proof App" }).find((f) => f.path === "manifest.yml");
    if (!mf) continue;
    assert.equal(JSON.stringify(m.buildPermissionLock(mf.content)), JSON.stringify(m.buildPermissionLock(mf.content)),
      `${id}: repeated lock renders are byte-equal`);
  }
}
// The module itself must not use template literals (the class of bug the line arrays avoid).
import fs from "node:fs";
const src = fs.readFileSync(path.join(here, "..", "..", "src", "shared", "git-scaffolds.js"), "utf8");
const code = src.replace(/"(?:[^"\\\n]|\\.)*"/g, '""').replace(/\/\/.*$/gm, "");
assert.ok(!/`/.test(code), "git-scaffolds.js contains no template literal in its own code (backticks only inside string content)");
assert.ok(m.SCAFFOLD_INDEX.find((s) => s.id === "forge-pipeline"));

/* ===================== F-527 — THE BOOTSTRAP CANNOT ASK A QUESTION =====================
 * Live, 2026-09-13: `forge register -y --personal "$FORGE_APP_NAME"` died after 41s with
 * "Prompts can not be meaningfully rendered in non-TTY environments" (the CLI wanted a
 * Developer Space), and with `--personal` plus a space it was refused outright with
 * "Personal apps are not allowed in this developer space". What registered headless was
 * `forge register -y -s <developer-space-id> <name>`.
 *
 * The space id reaches the shell through the job env rather than being interpolated into
 * the run script: a ${{ }} expression inside a run: block is textual substitution and a
 * repository variable is admin-writable, so the env indirection is the shape that cannot
 * become shell. Both halves are held here. */
for (const kind of ["forge-custom-ui", "forge-pipeline"]) {
  const rendered = m.renderScaffold(kind, {});
  const gh = rendered.find((f) => f.path === ".github/workflows/forge-deploy.yml").content;
  const bb = rendered.find((f) => f.path === "bitbucket-pipelines.yml").content;
  for (const [label, text] of [[kind + " github", gh], [kind + " bitbucket", bb]]) {
    assert.ok(!/--personal/.test(text), label + ": the bootstrap never passes --personal");
    assert.ok(/forge register -y -s "\$FORGE_DEVELOPER_SPACE"/.test(text),
      label + ": the bootstrap names the developer space explicitly");
    assert.ok(/FORGE_DEVELOPER_SPACE is not set/.test(text),
      label + ": an absent space id fails LOUD, naming the variable - never a TTY prompt");
    assert.ok(/exit 1/.test(text), label + ": ...and stops the job");
  }
  assert.ok(gh.includes("FORGE_DEVELOPER_SPACE: ${{ vars.FORGE_DEVELOPER_SPACE }}"),
    kind + ": the workflow reads the repository variable into the job env");
}

/* ===================== F-528 — THE RUNNER DOES NOT PRETEND TO STORE THE APP ID =======
 * Probed live, 2026-09-13: a workflow with exactly `contents: read, actions: write` and
 * GH_TOKEN=github.token got HTTP 403 "Resource not accessible by integration" from
 * POST /repos/:o/:r/actions/variables, while a PAT accepted the identical call on the
 * identical repository seconds later. Repository variables are an `administration`
 * resource and GITHUB_TOKEN can never hold it.
 *
 * So the scaffold must not claim it can, must not carry a permission it cannot use, and
 * must tell the human (or CogniRunner, which holds the PAT) what to set. */
for (const kind of ["forge-custom-ui", "forge-pipeline"]) {
  const gh = m.renderScaffold(kind, {}).find((f) => f.path === ".github/workflows/forge-deploy.yml").content;
  assert.ok(!/gh variable set/.test(gh), kind + ": the runner never tries to write a repository variable");
  assert.ok(!/actions: write/.test(gh), kind + ": ...and does not carry a permission that would not help");
  assert.ok(!/GH_TOKEN/.test(gh), kind + ": ...and needs no token of its own");
  assert.ok(/::notice::Registered app id \$APP_ID/.test(gh),
    kind + ": a successful register PRINTS the id, because the product cannot read the runner's output");
  assert.ok(/set the repository variable FORGE_APP_ID/.test(gh),
    kind + ": ...and names the variable to set");
  assert.ok(/if: env\.FORGE_APP_ID == ''/.test(gh),
    kind + ": registration is gated on there being no app id");
  assert.ok(/every run registers again/.test(gh),
    kind + ": the copy says what really happens until the variable exists - not 'registers at most once'");
}
assert.ok(!/registers the app ONCE/.test(src) && !/registers at most once/.test(src),
  "the module's own comments no longer promise a bootstrap that registers at most once automatically");

/* ===================== F-531 — THE TRIGGER BRANCH ON BOTH HOSTS ======================
 * A repository CogniRunner creates on Bitbucket comes back with mainbranch.name = "master"
 * (live, the offshoot's -bb repo), while the committed pipeline only listed `main`, so its
 * branch pipeline never fired -- only the custom: entry could be started. New GitHub repos
 * default to `main`, which is why this stayed invisible until Bitbucket was exercised. Both
 * names, on both hosts, is the answer that does not depend on a value read at setup time. */
for (const kind of ["forge-custom-ui", "forge-pipeline"]) {
  const rendered = m.renderScaffold(kind, {});
  const gh = rendered.find((f) => f.path === ".github/workflows/forge-deploy.yml").content;
  const bb = rendered.find((f) => f.path === "bitbucket-pipelines.yml").content;
  assert.ok(/branches: \[main, master\]/.test(gh), kind + ": the GitHub workflow triggers on main AND master");
  assert.ok(/\n    main:\n      - step: \*forge-deploy\n    master:\n      - step: \*forge-deploy\n/.test(bb),
    kind + ": the Bitbucket branch pipeline names both, reusing the one step anchor");
  assert.ok(/  custom:\n    forge-deploy:/.test(bb), kind + ": ...and the custom entry is still there");
}

/* ===================== F-530 — THE INSTALL COMMAND MATCHES THE TREE ==================
 * Live, Bitbucket run #1 of the offshoot: `+ npm ci` -> `npm error code EUSAGE`, "The
 * `npm ci` command can only install with an existing package-lock.json or
 * npm-shrinkwrap.json". Nothing after it ran. The scaffold has never committed a lockfile
 * and its own README said `npm install`, so the tree and the pipeline disagreed in writing.
 *
 * This is the INVARIANT rather than the instance: a scaffold may say `npm ci` only if it
 * actually ships a lockfile. That way a future scaffold which does ship one is free to use
 * it, and one which does not can never reintroduce the failure. */
for (const entry of m.SCAFFOLD_INDEX) {
  const rendered = m.renderScaffold(entry.id, {});
  const shipsLock = rendered.some((f) => /(^|\/)(package-lock\.json|npm-shrinkwrap\.json)$/.test(f.path));
  for (const f of rendered) {
    if (shipsLock) break;
    assert.ok(!/\bnpm ci\b/.test(f.content),
      entry.id + "/" + f.path + ": no `npm ci` in a scaffold that ships no lockfile");
  }
  if (!shipsLock) {
    const ci = rendered.filter((f) => /forge-deploy\.yml$|bitbucket-pipelines\.yml$/.test(f.path));
    for (const f of ci) {
      assert.ok(/npm install --no-audit --no-fund/.test(f.content),
        entry.id + "/" + f.path + ": installs with `npm install`, the command the README also gives");
    }
  }
}

/* ===================== F-529 — THE LOCK SPEAKS BEFORE FORGE DOES =====================
 * Live, 2026-09-13: with `write:jira-work` added to the manifest, the Permission lock step
 * printed `permission lock: DRIFT` / `locked=false` and the scopes — correctly — and then
 * the Deploy step killed the job with Forge's `MAJOR_VERSION_RULE` ("run forge deploy
 * --approve MAJOR_VERSION_RULE"). Both install steps were skipped, so the designed
 * "deployed, NOT installed" warning was unreachable and the admin read the wrong reason
 * for a red run.
 *
 * Two things are held here: the ORDER (the lock step is before the deploy step in the
 * rendered YAML, so the lock can stop the job), and the two drift CLASSES, run through the
 * committed checker itself rather than reasoned about. */
{
  const os = await import("node:os");
  const { execFileSync } = await import("node:child_process");
  const gh = m.renderScaffold("forge-pipeline", {}).find((f) => f.path === ".github/workflows/forge-deploy.yml").content;
  const iLock = gh.indexOf("name: Permission lock");
  const iDeploy = gh.indexOf("name: Deploy");
  assert.ok(iLock > -1 && iDeploy > -1 && iLock < iDeploy,
    "the permission-lock step runs BEFORE forge deploy, so its refusal is the one the job dies of");
  assert.ok(/steps\.lock\.outputs\.drift/.test(gh), "the warning step reports which drift class it is");

  const bb = m.renderScaffold("forge-pipeline", {}).find((f) => f.path === "bitbucket-pipelines.yml").content;
  const bLock = bb.indexOf("check-permissions-lock.js");
  const bDeploy = bb.indexOf("forge deploy");
  assert.ok(bLock > -1 && bLock < bDeploy, "…and on Bitbucket too");
  assert.ok(/check-permissions-lock\.js > \.lock-result \|\| \{ cat \.lock-result; exit 1; \}/.test(bb),
    "Bitbucket honours the checker's exit code — a ';' would have swallowed it");

  // The checker is a standalone file in a customer's repo, so it restates the scope rule.
  // The two homes are held BYTE-EQUAL here; that is the price of the second copy.
  const checker = m.renderScaffold("forge-pipeline", {}).find((f) => f.path === ".cognirunner/check-permissions-lock.js").content;
  const pipelineSrc = fs.readFileSync(path.join(here, "..", "..", "src", "git-pipeline.js"), "utf8");
  const RX = /\/\^-\\s\*"\?\(\[A-Za-z\]\[A-Za-z0-9_\.-\]\*\(\?::\[A-Za-z0-9_\.:-\]\+\)\+\)"\?\\s\*\$\//;
  assert.ok(RX.test(checker) && RX.test(pipelineSrc),
    "the scope-vs-structure regex in the generated checker is byte-equal to scopeOfLockLine's");

  // Now RUN it, on a real tree, for each class.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-lock-"));
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  write(".cognirunner/check-permissions-lock.js", checker);
  const manifestOf = (scopes, styles) => [
    "modules:", "  jira:globalPage:", "    - key: page",
    "permissions:", "  scopes:", ...scopes.map((x) => "    - " + x),
    "  content:", "    styles:", ...styles.map((x) => "      - " + x),
    "app:", "  id: x",
  ].join("\n");
  const base = manifestOf(["read:jira-work", "storage:app"], ["unsafe-inline"]);
  write("manifest.yml", base);
  write(".cognirunner/forge-permissions.lock", JSON.stringify(m.buildPermissionLock(base), null, 2));
  const run = () => {
    try { return { code: 0, out: execFileSync(process.execPath, [".cognirunner/check-permissions-lock.js"], { cwd: dir, encoding: "utf8" }) }; }
    catch (e) { return { code: e.status, out: String(e.stdout || "") }; }
  };

  let r = run();
  assert.equal(r.code, 0, "no drift exits 0");
  assert.ok(/permission lock: OK/.test(r.out) && /locked=true/.test(r.out) && /drift=none/.test(r.out), "…and says so: " + r.out);

  // SCOPE drift — the class forge deploy would otherwise refuse first.
  write("manifest.yml", manifestOf(["read:jira-work", "storage:app", "write:jira-work"], ["unsafe-inline"]));
  r = run();
  assert.equal(r.code, 1, "a widened SCOPE fails the step, so the job never reaches forge deploy");
  assert.ok(/drift=scopes/.test(r.out), "…classified as a scope drift: " + r.out);
  assert.ok(/::error::permission lock: DRIFT \(scopes\)/.test(r.out), "…with the LOCK's own message, not Forge's");
  assert.ok(/added write:jira-work/.test(r.out), "…naming the scope that appeared");
  assert.ok(/Nothing was deployed/.test(r.out), "…and saying what did not happen");
  assert.ok(!/MAJOR_VERSION_RULE/.test(r.out), "…and never quoting Forge's approval rule at the admin");

  // A REMOVED scope is a scope drift too — narrowing is still a change nobody approved.
  write("manifest.yml", manifestOf(["read:jira-work"], ["unsafe-inline"]));
  r = run();
  assert.equal(r.code, 1, "a removed scope fails the step as well");
  assert.ok(/removed storage:app/.test(r.out), "…naming it: " + r.out);

  // NON-SCOPE drift — content/styles. This one really does deploy and skip the install.
  write("manifest.yml", manifestOf(["read:jira-work", "storage:app"], ["unsafe-inline", "unsafe-hashes"]));
  r = run();
  assert.equal(r.code, 0, "a content/styles change does NOT fail the job — it does not trip MAJOR_VERSION_RULE");
  assert.ok(/drift=other/.test(r.out) && /locked=false/.test(r.out),
    "…it is 'other' drift: deployed, NOT installed, which is the warning step's only reachable class: " + r.out);

  // A MISSING lock behaves like 'other': deploy, withhold the install.
  fs.rmSync(path.join(dir, ".cognirunner", "forge-permissions.lock"));
  r = run();
  assert.equal(r.code, 0, "a missing lock does not fail the job");
  assert.ok(/drift=missing/.test(r.out) && /locked=false/.test(r.out), "…it withholds the install: " + r.out);

  fs.rmSync(dir, { recursive: true, force: true });
}

/* ===================== render-scaffold PARITY =====================
 * The harness script that writes a scaffold to disk (and that the offshoot is checked
 * against) must emit exactly the line arrays in this module - otherwise "scaffold parity
 * OK" is a statement about a stale renderer. Rendered, then re-checked through the script
 * itself in --check mode, and a planted drift proves the check is not vacuous. */
{
  const os = await import("node:os");
  const { execFileSync } = await import("node:child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-scaffold-"));
  const script = path.join(here, "render-scaffold.mjs");
  execFileSync(process.execPath, [script, "forge-custom-ui", dir], { stdio: "pipe" });
  const out = execFileSync(process.execPath, [script, "forge-custom-ui", dir, "--check"], { encoding: "utf8" });
  assert.ok(/scaffold parity OK/.test(out), "a freshly rendered tree re-checks clean");
  for (const f of m.renderScaffold("forge-custom-ui", {})) {
    assert.equal(fs.readFileSync(path.join(dir, f.path), "utf8"), f.content,
      f.path + " on disk is byte-equal to the line array");
  }
  const wfPath = path.join(dir, ".github", "workflows", "forge-deploy.yml");
  fs.writeFileSync(wfPath, fs.readFileSync(wfPath, "utf8") + "# drift\n");
  let detected = false;
  try { execFileSync(process.execPath, [script, "forge-custom-ui", dir, "--check"], { stdio: "pipe" }); }
  catch (e) { detected = /DRIFT \.github\/workflows\/forge-deploy\.yml/.test(String(e.stdout || "")); }
  assert.ok(detected, "--check fails on a drifted file, naming it");
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log("git-scaffolds: ok");
