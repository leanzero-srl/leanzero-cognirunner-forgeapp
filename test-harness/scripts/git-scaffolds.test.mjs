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
// The module itself must not use template literals (the class of bug the line arrays avoid).
import fs from "node:fs";
const src = fs.readFileSync(path.join(here, "..", "..", "src", "shared", "git-scaffolds.js"), "utf8");
const code = src.replace(/"(?:[^"\\\n]|\\.)*"/g, '""').replace(/\/\/.*$/gm, "");
assert.ok(!/`/.test(code), "git-scaffolds.js contains no template literal in its own code (backticks only inside string content)");
assert.ok(m.SCAFFOLD_INDEX.find((s) => s.id === "forge-pipeline"));
console.log("git-scaffolds: ok");
