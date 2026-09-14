/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */
/*
 * THE GUARD'S REFUSALS, DRIVEN AS REFUSALS — F-732, F-733.
 *
 * `lib/shared-env-guard.mjs` refuses by calling `process.exit(2)`, so the only honest test of
 * a refusal is a CHILD PROCESS: an in-process call would take the exit with it. Every case
 * below spawns `node --input-type=module`, reads the exit code AND the sentence, and asserts
 * both — the code is what an operator's shell sees, the sentence is the only thing that tells
 * them why.
 *
 * THE ORDER IS PART OF THE CONTRACT. The argv validation and every refusal happen BEFORE
 * `loadEnv()`, because `loadEnv` THROWS on a machine with no `test-harness/.env` and the
 * operator would then learn "Missing .env" instead of "you are pointed at the shared tenant".
 * Each refusal below is asserted NOT to be a file complaint, which is the check that keeps
 * the order honest; on an unconfigured machine (a fresh clone, a worktree) it is also the
 * only reason these cases can run at all.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ENVS, ENV_NAMES, MUTATION_NAMES } from "../lib/shared-env-guard.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const GUARD = path.join(here, "..", "lib", "shared-env-guard.mjs");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

/**
 * Run a snippet in a fresh node, with the guard importable and NO env file reachable.
 * @returns {{code:number, out:string, err:string}}
 */
function run(body, argv = []) {
  const src = `import { requireEnvAck, declareMutations, forgeEnvId } from ${JSON.stringify(GUARD)};\n${body}\n`;
  try {
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", src, "driver.mjs", ...argv], {
      encoding: "utf8",
      cwd: path.join(here, ".."),
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out, err: "" };
  } catch (e) {
    return { code: e.status ?? -1, out: String(e.stdout || ""), err: String(e.stderr || "") };
  }
}

/* The harness for the harness: a spawn that CANNOT refuse must still be observable, or every
   "exit 2" below could be a spawn failure wearing a refusal's clothes. */
{
  const r = run('console.log("REACHED");');
  ok(r.code === 0 && /REACHED/.test(r.out),
    "the child can import the guard and run — an exit code below is the guard's answer, not a broken spawn");
}

console.log("\n1 · F-733 — THE DEV-ONLY DECLARATION, AND THE FLAG THAT IS THE WHOLE ACK");
{
  /* READ-ONLY PROCEEDS. This is the control that keeps the refusal worth reading: if every
     driver had to pass the flag, nobody would read the sentence on the one that matters. */
  const r = run('declareMutations([]);\nconsole.log("PROCEEDED");');
  ok(r.code === 0 && /PROCEEDED/.test(r.out),
    "a read-only dev-only driver declares `[]` and runs with no ceremony — and with NO .env, which is the point of the declaration-only door");

  /* MUTATING REFUSES, and the sentence names what it would change. */
  const r2 = run('declareMutations(["roster"]);\nconsole.log("PROCEEDED");');
  ok(r2.code === 2, `a non-empty declaration without the ack exits 2 (got ${r2.code})`);
  ok(!/PROCEEDED/.test(r2.out), "…and the driver body never runs");
  ok(/REFUSING to run/.test(r2.err), "…with a refusal on stderr");
  ok(/ADMIN\/EDITOR roster/.test(r2.err),
    "…that names the harm from the guard's own MUTATION_HARMS table, not a sentence typed at the call site");
  ok(/--i-know-dev-is-shared/.test(r2.err), "…and tells the operator the one thing they can do about it");
  ok(!/--env/.test(r2.err.replace(/no `--env`/g, "")),
    "…and does NOT offer a safer environment, because this cohort has none — an offer that lands back here is how a refusal becomes wallpaper");

  /* THE ACK LETS IT THROUGH — the refusal is a question, not a wall. */
  const r3 = run('declareMutations(["roster"]);\nconsole.log("PROCEEDED");', ["--i-know-dev-is-shared"]);
  ok(r3.code === 0 && /PROCEEDED/.test(r3.out),
    "…and with the acknowledgement it proceeds, still with no .env and no environment resolved");

  /* THE VOCABULARY IS CLOSED, and an omission is a THROW rather than a default of `[]` —
     a default would let the next driver be written without ever facing the question. */
  const r4 = run('declareMutations(["rooster"]);');
  ok(r4.code !== 0 && /unknown mutation "rooster"/.test(r4.err),
    "a typo is an unknown word and THROWS, on any machine, before the refusal can be reached");
  const r5 = run("declareMutations();");
  ok(r5.code !== 0 && /name what this driver CHANGES/.test(r5.err),
    "…and an OMITTED declaration throws too: an empty blast radius must be stated, never defaulted");
  ok(MUTATION_NAMES.length >= 10 && MUTATION_NAMES.includes("roster") && MUTATION_NAMES.includes("kvs"),
    "the closed vocabulary this door shares with requireEnvAck is the guard's own (" + MUTATION_NAMES.join(", ") + ")");
}

console.log("\n2 · F-732 — `--envid` MAY NOT RE-DECIDE THE ROW");
{
  const DEV = ENVS.dev.forgeEnvId, STAGING = ENVS.staging.forgeEnvId;
  const call = 'const r = requireEnvAck(process.argv.slice(2), { faults: [], mutates: [], defaultEnv: "staging" });\nconsole.log("ENVID:" + r.envId);';

  /* THE SPLIT F-714 FIXED IN ONE DRIVER AND LEFT AVAILABLE BY FLAG IN EIGHT: the hook half
     goes to staging, the browser half to dev, and the evidence file records "staging". */
  const r = run(call, ["--env=staging", `--envid=${DEV}`]);
  ok(r.code === 2, `--env=staging with the DEV id is refused (got ${r.code})`);
  ok(/REFUSING to run: --envid does not name the environment/.test(r.err),
    "…and the refusal says which half disagreed rather than failing later as 'the notice never appeared'");
  ok(/--env=dev/.test(r.err),
    "…and NAMES the environment that id belongs to, because the operator meant something and the guard knows what");

  const r2 = run(call, ["--env=dev", "--i-know-dev-is-shared", `--envid=${STAGING}`]);
  ok(r2.code === 2 && /--env=staging/.test(r2.err),
    "…and the mirror direction too — the shared-dev ack cannot cover this, because it keys off --env and --envid never reaches it");

  const r3 = run(call, ["--env=staging", "--envid=not-a-uuid"]);
  ok(r3.code === 2 && /not one this harness knows at all/.test(r3.err),
    "an id that is no environment's is refused with its own sentence — ids are not typed, they come out of the table");

  /* THE FLAG SURVIVES FOR THE IDENTITY IT ALREADY HAD. Eight drivers pass it; none of them
     may use it to choose, and all of them may use it to confirm. */
  const r4 = run(call, ["--env=staging", `--envid=${STAGING}`]);
  ok(r4.code !== 2, "`--envid` equal to the settled row is NOT refused — the flag keeps the one meaning it can honestly have");
  const r5 = run(call, ["--env=staging"]);
  ok(r5.code === r4.code, "…and passing it changes nothing, which is the whole of the rule");

  /* PROVEN BEFORE loadEnv: this machine has no .env, and the refusal still arrives. */
  ok(!/Missing .env|ENOENT/.test(r.err),
    "the refusal is reached WITHOUT an env file — it is checked before loadEnv, so an unconfigured operator reads the tenant problem and not a file problem");
  ok(ENV_NAMES.length === 2 && DEV !== STAGING, "the two rows this rule compares really are two different environments");
}

console.log("\nshared-env-guard: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
