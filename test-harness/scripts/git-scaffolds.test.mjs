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
assert.throws(() => m.renderScaffold("forge-custom-ui", { APP_NAME: "x`y" }), /is not usable/);
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

/* ===================== F-541 — ONE VALIDATOR FOR THE SCAFFOLD VARIABLES ==============
 * A scaffold variable is substituted into shell words, YAML values and FILE PATHS. The
 * character set has to allow "." and "/" (static/app), which makes ".." and a leading "/"
 * reachable — and the backend's old SAFE_VAR allowed both, so a traversing UI_DIR was
 * refused only by the admin panel's own copy of the rule: in the browser, for one caller,
 * on one form. scaffoldVarError is the rule; the renderer and the setup resolver both call
 * it, and the UI imports it instead of keeping a copy. */
{
  assert.equal(typeof m.scaffoldVarError, "function", "the validator is exported from the single source");
  assert.equal(m.scaffoldVarError("UI_DIR", "static/app"), null, "a normal folder is usable");
  assert.equal(m.scaffoldVarError("UI_DIR", "none"), null, "…and so is the backend-only sentinel");
  assert.equal(m.scaffoldVarError("APP_NAME", "Next Steps"), null, "…and a name with a space");
  assert.equal(m.scaffoldVarError("UI_DIR", "  static/app  "), null, "…padding is trimmed, not refused");

  const cases = [
    ["UI_DIR", "", /cannot be empty/],
    ["UI_DIR", "   ", /cannot be empty/],
    ["UI_DIR", "x".repeat(81), /80 characters or fewer/],
    ["UI_DIR", "a`b", /may only contain/],
    ["UI_DIR", "$(id)", /may only contain/],
    ["UI_DIR", "a;b", /may only contain/],
    ["UI_DIR", "../../etc", /cannot contain \.\. or start with \//],
    ["UI_DIR", "static/../../etc", /cannot contain \.\. or start with \//],
    ["UI_DIR", "/etc/passwd", /cannot contain \.\. or start with \//],
    ["APP_NAME", "../escape", /cannot contain \.\. or start with \//],
  ];
  for (const [name, value, rx] of cases) {
    const err = m.scaffoldVarError(name, value);
    assert.ok(err && rx.test(err), name + "=" + JSON.stringify(value) + " is refused: " + err);
  }
  // ".." only as a whole SEGMENT — a folder legitimately named "..config" is fine.
  assert.equal(m.scaffoldVarError("UI_DIR", "static/..config"), null, "a segment that merely starts with dots is not traversal");

  // the sentence names the field a human is looking at.
  assert.ok(/^The Custom UI folder/.test(m.scaffoldVarError("UI_DIR", "")), "the label comes from the variable name");
  assert.ok(/^The app name/.test(m.scaffoldVarError("APP_NAME", "")), "…for both of them");
  assert.ok(/^Whatever/.test(m.scaffoldVarError("UI_DIR", "", "Whatever")), "…and a caller may override it");

  // the RENDERER refuses the same things, so the two can never disagree.
  for (const [name, value] of cases.map(([n, v]) => [n, v])) {
    assert.throws(() => m.renderScaffold("forge-pipeline", { [name]: value }), /is not usable/,
      "renderScaffold refuses " + name + "=" + JSON.stringify(value));
  }
  // and a good value still renders, trimmed.
  const rendered = m.renderScaffold("forge-pipeline", { UI_DIR: "  static/ui  " });
  assert.ok(/working-directory: static\/ui\n/.test(rendered.find((f) => f.path === ".github/workflows/forge-deploy.yml").content),
    "a padded value is trimmed before substitution, never emitted with its spaces");
}

/* ===================== F-540 — "none" MEANS THE STEP IS NOT THERE =====================
 * The Code tab offers "none" as the Custom UI folder for a backend-only app, and both
 * pipelines emitted the build step unconditionally, so that choice rendered
 * `working-directory: none` / `cd none` and the job died there. The UI could only warn;
 * the step lives in the scaffold, so the scaffold has to honour the choice.
 *
 * BOTH branches are held, and so is the failure mode of the mechanism itself: a line entry
 * that is neither a string nor a { when, lines } block must THROW, because a step silently
 * vanishing from a pipeline is the worst thing a conditional renderer can do. */
for (const kind of ["forge-custom-ui", "forge-pipeline"]) {
  const withUi = m.renderScaffold(kind, { UI_DIR: "static/app" });
  const noUi = m.renderScaffold(kind, { UI_DIR: "none" });
  const pick = (files, name) => files.find((f) => f.path === name).content;

  const ghYes = pick(withUi, ".github/workflows/forge-deploy.yml");
  const ghNo = pick(noUi, ".github/workflows/forge-deploy.yml");
  assert.ok(/name: Install and build \(Custom UI\)/.test(ghYes), kind + ": a real folder keeps the build step");
  assert.ok(/working-directory: static\/app/.test(ghYes), kind + ": ...pointed at it");
  assert.ok(!/Install and build \(Custom UI\)/.test(ghNo), kind + ": UI_DIR=none drops the build step entirely");
  assert.ok(!/working-directory: none/.test(ghNo), kind + ": ...so nothing ever points at a folder called none");
  assert.ok(/name: Install \(backend\)/.test(ghNo), kind + ": ...and the backend install still runs");
  assert.ok(/name: Deploy/.test(ghNo) && /name: Permission lock/.test(ghNo), kind + ": ...as do lock and deploy");

  const bbYes = pick(withUi, "bitbucket-pipelines.yml");
  const bbNo = pick(noUi, "bitbucket-pipelines.yml");
  assert.ok(/cd static\/app && npm install/.test(bbYes), kind + ": Bitbucket builds the UI when there is one");
  assert.ok(!/cd none/.test(bbNo) && !/npm run build/.test(bbNo), kind + ": ...and does not when there is not");
  assert.ok(/forge deploy/.test(bbNo), kind + ": ...the deploy survives either way");

  // the conditional never leaves a placeholder or an empty line behind.
  for (const f of noUi) {
    assert.ok(!/\{\{[A-Z_]+\}\}/.test(f.content), kind + "/" + f.path + ": no unresolved placeholder in the none branch");
    assert.ok(!/\n\n\n/.test(f.content), kind + "/" + f.path + ": the dropped block leaves no hole");
  }
}
assert.ok(m.scaffoldHasCustomUi({ UI_DIR: "static/app" }) === true
  && m.scaffoldHasCustomUi({ UI_DIR: "NONE" }) === false
  && m.scaffoldHasCustomUi({ UI_DIR: " none " }) === false
  && m.scaffoldHasCustomUi({}) === false,
  "the predicate is case- and space-insensitive, and an absent UI_DIR is no UI");

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

/* ===================== F-579 — A CONTENT CHANGE MUST BUMP THE VERSION =====================
 * The line arrays are COMMITTED INTO CUSTOMER REPOSITORIES. `SCAFFOLD_VERSION` is the only
 * thing that can tell an already-installed repo that what it carries is stale, and F-565
 * changed the workflow's content without touching it: every pipeline installed before that
 * fix stayed dead while the Code tab reported it installed, 6/6 steps done.
 *
 * So the guard is on the CONTENT, not on anyone's memory. This hashes every scaffold's
 * paths and raw line arrays (conditional blocks included, unrendered — a change inside a
 * `when` block is a content change too) and compares it with the checked-in
 * SCAFFOLD_CONTENT_HASH. When they differ the test FAILS and prints the new hash, and the
 * only correct response is: bump SCAFFOLD_VERSION, write its SCAFFOLD_CHANGELOG line, then
 * paste the hash. Updating the hash alone puts the constant back in the state this finding
 * was written about.
 */
const { createHash } = await import("node:crypto");

/** Canonical, order-preserving serialisation of the line arrays — paths and text only. */
const canonicalScaffoldContent = (scaffolds) =>
  JSON.stringify(
    Object.keys(scaffolds).sort().map((id) => [
      id,
      scaffolds[id].files.map((f) => [
        f.path,
        f.lines.map((l) => (typeof l === "string" ? l : ["when", l.lines])),
      ]),
    ])
  );
const scaffoldContentHash = (scaffolds) =>
  createHash("sha256").update(canonicalScaffoldContent(scaffolds)).digest("hex").slice(0, 32);

{
  const actual = scaffoldContentHash(m.SCAFFOLDS);
  assert.equal(
    actual,
    m.SCAFFOLD_CONTENT_HASH,
    "the scaffold line arrays changed without a version bump.\n" +
      "  Bump SCAFFOLD_VERSION (now " + m.SCAFFOLD_VERSION + "), add its SCAFFOLD_CHANGELOG line,\n" +
      "  then set SCAFFOLD_CONTENT_HASH = \"" + actual + "\";"
  );

  // The guard is not vacuous: a scratch edit to one line of one scaffold moves the hash.
  const scratch = JSON.parse(JSON.stringify({
    x: { files: m.SCAFFOLDS["forge-pipeline"].files.map((f) => ({ path: f.path, lines: f.lines.filter((l) => typeof l === "string") })) },
  }));
  const before = scaffoldContentHash(scratch);
  scratch.x.files[0].lines.push("# planted drift");
  assert.notEqual(scaffoldContentHash(scratch), before, "a planted line changes the content hash");
  assert.equal(scaffoldContentHash(m.SCAFFOLDS), actual, "…and the real catalogue was not mutated by the probe");

  // The version and its changelog agree: every version above 1 has a sentence, and the
  // sentence for a stuck row is what publicPipelineRow reports as `outdatedReason`.
  for (let v = 2; v <= m.SCAFFOLD_VERSION; v++) {
    assert.ok(typeof m.SCAFFOLD_CHANGELOG[v] === "string" && m.SCAFFOLD_CHANGELOG[v].length > 20,
      "SCAFFOLD_VERSION " + v + " has a changelog line saying why it was bumped");
  }
  assert.equal(m.scaffoldOutdatedReason(m.SCAFFOLD_VERSION), null, "the current version is not outdated");
  assert.equal(m.scaffoldOutdatedReason(1), m.SCAFFOLD_CHANGELOG[2], "a v1 row is told why, in the changelog's words");
  assert.ok(m.scaffoldOutdatedReason(null), "a row with NO recorded version reads as outdated, not as fine");
  assert.ok(m.scaffoldOutdatedReason("nonsense"), "…and so does an unparseable one");
}

console.log("git-scaffolds: ok");
