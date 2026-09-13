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
console.log("git-scaffolds: ok");
