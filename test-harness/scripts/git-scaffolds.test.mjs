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
