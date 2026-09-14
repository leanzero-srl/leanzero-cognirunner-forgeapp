/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * F-804 — EVERY RELATIVE SPECIFIER IN src/ MUST RESOLVE THE WAY NODE RESOLVES IT.
 *
 * `src/index.js:12448` read `export { testStateTrigger, gitWebhookProbe } from "./test-hook"`.
 * The Forge bundler accepts that; Node's ESM resolver does NOT — there is no extension
 * search in ESM. The consequence was not cosmetic: the `?what=execlogs` arm of the test
 * hook does `await import("./index.js")` for `readLogs`, so the arm could not be driven
 * offline at all, and F-802's proof for that one door had to fall back to calling
 * `readCeiling` directly (see the comment at rules-runtime-regression.test.mjs's
 * `?what=execlogs` check). Four `await import("./index")` sites in src/async-handler.js
 * carried the same defect, on the path that stores a log for an async task.
 *
 * `scripts/shared-imports.test.mjs` is the sibling gate and it covers `src/shared/` ONLY
 * (it readdirs that one directory), so nothing was watching this class anywhere else —
 * asserted below rather than assumed.
 *
 * WHAT THIS SUITE DOES: a RESOLVER WALK, no execution. It reads every `src/**\/*.js`,
 * extracts the static `import … from "…"` / `export … from "…"` specifiers and the
 * `import("…")` literals, and for every RELATIVE one asserts the target exists on disk at
 * exactly the written path. Execution is deliberately not attempted: importing
 * `src/index.js` pulls `@forge/llm`, which throws "Forge runtime not found." outside the
 * platform, and the offline mock loader maps `@forge/kvs`/`@forge/api`/`@forge/events`
 * only. A resolver walk is the part of module loading this defect lives in.
 *
 * Run: node scripts/src-specifier-resolution.test.mjs (auto-discovered by run-offline.mjs)
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// The @forge/* mock loader that lets src/index.js itself load offline (mock kvs/api/llm/resolver).
import "../lib/register-mocks-index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(here, "../../src");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const abs = path.join(dir, e.name);
  if (e.isDirectory()) return walk(abs);
  return e.isFile() && e.name.endsWith(".js") ? [abs] : [];
});

/* The two shapes, deliberately narrow so that JS written INSIDE a string (the knowledge
 * packs in src/shared/knowledge-packs/*.js carry whole code samples as JSON string bodies)
 * cannot be mistaken for a real specifier: a static form must START a line, and a dynamic
 * `import(` must not be preceded by a backslash (an escaped quote inside a string body) or
 * by an identifier character. */
const STATIC_RE = /^[ \t]*(?:import|export)\b[^\n;]*?\bfrom\s*["']([^"'\n]+)["']/gm;
const DYNAMIC_RE = /(?:^|[^\w$.\\])import\(\s*["']([^"'\n]+)["']\s*\)/g;

const specifiersIn = (code) => {
  const out = [];
  for (const re of [STATIC_RE, DYNAMIC_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(code)) !== null) out.push(m[1]);
  }
  return out;
};

const files = walk(srcDir).sort();
ok(files.length > 0, "src/ contains modules to walk");

let relativeSeen = 0;
for (const abs of files) {
  const rel = path.relative(path.join(here, "../.."), abs);
  const code = readFileSync(abs, "utf8");
  for (const spec of specifiersIn(code)) {
    if (!spec.startsWith(".")) continue;   // bare specifiers are the package resolver's job
    relativeSeen++;
    const target = path.resolve(path.dirname(abs), spec);
    // Node's ESM resolver does no extension search and no directory index: the written
    // path must BE the file.
    const resolves = existsSync(target) && statSync(target).isFile();
    ok(resolves, `${rel}: "${spec}" resolves as written (extensionless specifiers do not load under Node ESM)`);
  }
}
ok(relativeSeen > 20, `the walk actually SAW the relative specifiers (found ${relativeSeen})`);

/* POSITIVE CONTROL — the exact pre-fix line of src/index.js is still SEEN as a defect by
 * this walk, and the fixed line passes. Without this the suite could be green because the
 * extractor stopped matching. */
{
  const preFix = 'export { testStateTrigger, gitWebhookProbe } from "./test-hook";';
  const postFix = 'export { testStateTrigger, gitWebhookProbe } from "./test-hook.js";';
  const specs = (src) => specifiersIn(src);
  ok(specs(preFix).length === 1 && specs(preFix)[0] === "./test-hook", "POSITIVE CONTROL: the pre-fix specifier is extracted");
  const resolveFrom = (spec) => {
    const t = path.resolve(srcDir, spec);
    return existsSync(t) && statSync(t).isFile();
  };
  ok(resolveFrom("./test-hook") === false, "POSITIVE CONTROL: the pre-fix specifier does NOT resolve — the walk would have gone red on it");
  ok(resolveFrom("./test-hook.js") === true, "…and the fixed one does");
  ok(specs(postFix)[0] === "./test-hook.js", "the fixed line is extracted too (the extractor is not blind to it)");
  // NEGATIVE CONTROL for the string-body guard: code samples inside a JSON string are not
  // physical-line-anchored, so they are correctly ignored.
  const inString = '  "body": "```javascript\\nimport { x } from \'./not-a-real-file\';\\n```"';
  ok(specs(inString).length === 0, "NEGATIVE CONTROL: an import written inside a knowledge-pack string body is not counted");
}

/* THE SCOPE STATEMENT: shared-imports.test.mjs is the load gate, and it reads ONE
 * directory. Named here so a future reader does not assume it already covered src/. */
{
  const sharedGate = readFileSync(path.join(here, "shared-imports.test.mjs"), "utf8");
  ok(/readdirSync\(sharedDir\)/.test(sharedGate) && /"\.\.\/\.\.\/src\/shared"/.test(sharedGate),
    "shared-imports.test.mjs enumerates src/shared only — this suite is what covers the rest of src/");
}

/* F-804 ITSELF, pinned by name so the one-character regression is loud. */
{
  const indexSrc = readFileSync(path.join(srcDir, "index.js"), "utf8");
  ok(/from\s+"\.\/test-hook\.js"/.test(indexSrc), "src/index.js re-exports the test hook with the loadable specifier (F-804)");
  ok(!/from\s+"\.\/test-hook"/.test(indexSrc), "…and no extensionless copy of that line survives");
  const asyncSrc = readFileSync(path.join(srcDir, "async-handler.js"), "utf8");
  ok(!/import\("\.\/index"\)/.test(asyncSrc), "src/async-handler.js's storeLog imports name index.js with its extension (same class)");
}

/* THE PAYOFF: `?what=execlogs` IS NOW DRIVABLE END TO END.
 *
 * This is what the specifier cost. The arm is
 *   `const { readLogs } = await import("./index.js"); return answerStored("logs", "log_entry:", ...)`
 * - so until src/index.js could be loaded by Node at all, F-802's proof for this one door
 * had to call `readCeiling` directly and reason about the routing from the source. With the
 * specifier fixed and the `register-mocks-index` loader in place, the door itself answers,
 * and the EQUALITY F-802 is about (`?what=execlogs` masks the same bytes `?what=kvs` does,
 * on the same stored row) is asserted on the wire instead of on a helper.
 */
{
  process.env.HARNESS_SECRET = process.env.HARNESS_SECRET || "harness-secret-804";
  const { testStateTrigger } = await import("../../src/test-hook.js");
  const { LOG_ENTRY_PREFIX } = await import("../../src/rule-stats.js");
  const storage = (await import("../lib/mock-kvs.mjs")).default;

  const BEARER = "zz-f804-execlogs-end-to-end-bearer-zz";
  const key = `${LOG_ENTRY_PREFIX}9999999999998_f804aaaa`;
  const entry = { ruleId: "r-804", outcome: "pass", aiResponse: { authorization: `Bearer ${BEARER}` } };
  storage.__seed(key, entry);

  const GET = async (qs) => {
    const res = await testStateTrigger({
      method: "GET",
      queryParameters: qs,
      headers: { authorization: [`Bearer ${process.env.HARNESS_SECRET}`] },
    });
    let parsed = null; try { parsed = JSON.parse(res.body); } catch { /* text */ }
    return { status: res.statusCode, body: parsed, raw: String(res.body) };
  };

  const viaArm = await GET({ what: ["execlogs"], ruleId: ["r-804"] });
  ok(viaArm.status === 200, `?what=execlogs answers (got ${viaArm.status} ${viaArm.raw.slice(0, 200)})`);
  ok(viaArm.raw.includes(BEARER) === false, "the arm did NOT put the step result's bearer on the wire (F-802, now proven AT the door)");
  ok(Array.isArray(viaArm.body && viaArm.body.logs), "the envelope is still `logs` - no driver has to change");
  ok(viaArm.body && viaArm.body.logs[0] && viaArm.body.logs[0].outcome === "pass", "the entry is otherwise readable");

  const viaKvs = await GET({ what: ["kvs"], key: [key] });
  ok(viaKvs.status === 200 && viaKvs.body && viaKvs.body.value, "...and the same row is readable through the door that always had the ceiling");
  ok(JSON.stringify(viaArm.body.logs[0].aiResponse.authorization) === JSON.stringify(viaKvs.body.value.aiResponse.authorization),
    "THE EQUALITY: the same field, the same fingerprint, whichever door read it");

  // POSITIVE CONTROL: a clean entry comes back plain and says nothing about masking.
  const cleanKey = `${LOG_ENTRY_PREFIX}9999999999997_f804bbbb`;
  storage.__seed(cleanKey, { ruleId: "r-804-clean", outcome: "pass" });
  const clean = await GET({ what: ["execlogs"], ruleId: ["r-804-clean"] });
  ok(clean.status === 200 && clean.body.logs.length === 1 && !("maskedFields" in clean.body),
    "POSITIVE CONTROL: an entry with nothing secret in it is answered plain");
}

console.log(`src-specifier-resolution (F-804): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
