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
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ENVS, ENV_NAMES, MUTATION_NAMES, positionalArgs } from "../lib/shared-env-guard.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const GUARD = path.join(here, "..", "lib", "shared-env-guard.mjs");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

/**
 * Run a snippet in a fresh node, with the guard importable and NO env file reachable.
 * @returns {{code:number, out:string, err:string}}
 */
function run(body, argv = []) {
  const src = `import { requireEnvAck, declareMutations, forgeEnvId, positionalArgs } from ${JSON.stringify(GUARD)};\n${body}\n`;
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

console.log("\n3 · F-735 — A PINNED ENVIRONMENT MAY NOT BE ARGUED WITH IN ITS OWN ARGUMENT LIST");
{
  /* THE BYPASS, EXACTLY AS IT SHIPPED. `git-dispatch-drop-live.mjs` and
     `git-rotation-window-live.mjs` pinned themselves by APPENDING to the operator's argv:
     `requireEnvAck([...process.argv.slice(2), "--env=dev"], …)`. `arg()` is `argv.find(…)`,
     so the FIRST `--env` won and the operator's came first. This case is the proof that the
     old shape really did skip the refusal, so the fix below is measured against a bypass we
     have reproduced rather than one we assert existed. */
  /* This machine has no `.env`, so ANY run that gets past the guard dies in `loadEnv`
     instead of reaching `console.log`. The verdict here is therefore not the exit code but
     whether the GUARD refused — `passedTheGuard` is "no REFUSING sentence was printed",
     which is exactly the property the finding is about and the only one an unconfigured
     machine can observe. */
  /* THE PREDICATE READS EVERY REFUSAL THIS GUARD CAN PRINT, NOT ONE OF THEM.
   *
   * It used to be `!/REFUSING to run/`, and the guard has TWO openers: the argv refusals say
   * "REFUSING to run: …", the shared-tenant one says "REFUSING to point this driver at the
   * SHARED dev tenant …". So a run that was REFUSED by the shared-dev branch was reported as
   * having PASSED the guard. Measured on the pinned fixture below: exit 2, the body never
   * ran, and the old predicate answered TRUE — the `acked`/`bareAcked` assertions would have
   * stayed green with the acknowledgement path completely broken, which is the only thing
   * they exist to catch. (Same class as F-772 step 6: a check that reads the wrong field
   * announces a pass without ever looking.)
   *
   * `^REFUSING` at a line start covers both openers and any third; the exit code is asserted
   * WITH it so a future refusal worded differently still cannot read as a pass — `die()`
   * exits 2 and nothing else in these fixtures does. */
  const passedTheGuard = (r) => !/^REFUSING/m.test(r.err) && r.code !== 2;

  /* THE PREDICATE'S OWN POSITIVE CONTROL. Every "it passed the guard" assertion below is
     only as good as this function, so it is shown to answer FALSE on a run that was in fact
     refused — by the SHARED-TENANT branch specifically, the one the old predicate could not
     read. Without this, the repair is itself unfalsifiable. */
  {
    const refused = run('requireEnvAck(process.argv.slice(2), { forceEnv: "dev", faults: ["dispatchDrop"], mutates: ["git"] });\nconsole.log("ARMED");', []);
    ok(refused.code === 2 && !/ARMED/.test(refused.out),
      "the control fixture IS refused — exit 2 and the body never runs");
    ok(/SHARED dev tenant/.test(refused.err) && !/REFUSING to run/.test(refused.err),
      "…by the shared-tenant branch, whose opener is 'REFUSING to point …', NOT 'REFUSING to run' — which is exactly why the old predicate could not see it");
    ok(!passedTheGuard(refused),
      "…and passedTheGuard answers FALSE on it. The old `!/REFUSING to run/` answered TRUE, so every acked assertion below would have stayed green with the acknowledgement path broken");
  }

  const OLD = 'requireEnvAck([...process.argv.slice(2), "--env=dev"], { faults: ["dispatchDrop"], mutates: ["git"] });\nconsole.log("ARMED");';
  const bypass = run(OLD, ["--env=staging"]);
  ok(passedTheGuard(bypass),
    "REPRODUCTION (F-735): the OLD appended-flag shape lets `--env=staging` through with NO refusal at all — `arg()` takes the FIRST match and the operator's argv was spread first, so the driver ran on to arm its fault while the tenant it talks to was dev either way");
  const typo = run(OLD, ["--env=stagng"]);
  ok(!passedTheGuard(typo) && typo.code === 2,
    "…and a TYPO was LOUDER than the real bypass: `--env=stagng` hits the closed-set refusal while `--env=staging` sails through it. That asymmetry is the whole finding");

  /* THE FIX. The pin is the library's decision and a conflicting `--env` is refused BY NAME. */
  const NEW = 'requireEnvAck(process.argv.slice(2), { forceEnv: "dev", faults: ["dispatchDrop"], mutates: ["git"] });\nconsole.log("ARMED");';
  const r = run(NEW, ["--env=staging"]);
  ok(r.code === 2, `--env=staging is REFUSED for a forceEnv:"dev" driver (got ${r.code})`);
  ok(!/ARMED/.test(r.out), "…and the driver body never runs, so no fault is armed");
  ok(/can only ever run on dev/.test(r.err),
    "…with a refusal that names the pin rather than silently overriding the operator — a silent override leaves them believing they ran on staging (F-698)");
  ok(/it could only have moved the REFUSAL/.test(r.err),
    "…and explains why the flag was never going to move the target, which is the part that makes the pin believable");

  /* AGREEING IS NOT CONFLICTING, and the ack is still required because dev is shared. */
  const agree = run(NEW, ["--env=dev"]);
  ok(agree.code === 2 && /SHARED dev tenant/.test(agree.err),
    "`--env=dev` AGREES with the pin, so it is not refused as a conflict — it falls through to the shared-dev ack, which is what the old shape was supposed to reach and did not");
  const acked = run(NEW, ["--env=dev", "--i-know-dev-is-shared"]);
  ok(passedTheGuard(acked),
    "…and with the acknowledgement it proceeds past the guard");
  const bare = run(NEW, []);
  ok(bare.code === 2 && /SHARED dev tenant/.test(bare.err),
    "…and NO `--env` at all lands on the pin and asks, which is the mandatory-every-run behaviour both drivers' comments claim");
  const bareAcked = run(NEW, ["--i-know-dev-is-shared"]);
  ok(passedTheGuard(bareAcked),
    "…so the ordinary invocation is `--i-know-dev-is-shared` and nothing else");

  /* THE PIN IS ITSELF VALIDATED, on any machine, at the call and not at the one run that reaches it. */
  const bad = run('requireEnvAck(process.argv.slice(2), { forceEnv: "prod", faults: [], mutates: [] });');
  ok(bad.code !== 0 && /forceEnv "prod" is not one of/.test(bad.err),
    "a forceEnv outside the closed set THROWS — the pin comes out of the same table `--env` is checked against");

  /* AND IT IS REACHED BEFORE loadEnv, like every other refusal here. */
  ok(!/Missing .env|ENOENT/.test(r.err),
    "the conflict refusal arrives with NO env file — an operator on an unconfigured machine reads the tenant problem, not a file problem");

  /* THE TWO REAL CALL SITES USE IT. A library option no file takes is a library option that
     rots; these are the two files the finding is about. */
  for (const f of ["git-dispatch-drop-live.mjs", "git-rotation-window-live.mjs"]) {
    /* CODE ONLY. Both files now EXPLAIN the old shape in their docblocks — quoting the
       defect is how the next author learns why the pin moved — so a scan that read prose
       would fail them for the comment that documents the fix. */
    const src = readFileSync(path.join(here, f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    ok(/forceEnv:\s*"dev"/.test(src), `${f}: pins itself with forceEnv`);
    ok(!/\[\.\.\.process\.argv\.slice\(2\),\s*"--env=/.test(src),
      `${f}: …and keeps no appended-flag copy of the pin — the shape that lost to the operator's own --env`);
  }
}

console.log("\n· F-760 — THE HINT MUST BE A COMMAND THAT RUNS");
{
  /* The defect: the guard's hints end in `--i-know-dev-is-shared`, a phase driver read its
     phase as `process.argv[2]`, and so the copy-pasted suggestion put the ACK FLAG in the
     phase slot and exited 2 a second time with "phase must be one of". The refusal printed a
     command that could not run, and the operator started guessing — F-735's failure mode
     moved from the flag to the hint. The tester hit it twice on two different drivers.

     Two halves, tested as two halves:
       1. `positionalArgs` — a flag is never a positional, WHEREVER it sits; and
       2. `usage:` — the hint names the phase, so the suggestion is complete.
     Neither alone closes it: (1) without (2) leaves the operator a command with no phase,
     and (2) without (1) leaves the phase behind the flag's slot. */

  /* ── 1. THE HELPER, on the shapes this harness actually produces ─────────── */
  ok(JSON.stringify(positionalArgs(["--i-know-dev-is-shared"])) === "[]",
    "positionalArgs: a lone ack flag leaves NO positional — the exact argv the old hint produced");
  ok(JSON.stringify(positionalArgs(["--i-know-dev-is-shared", "window"])) === '["window"]',
    "positionalArgs: the phase is found AFTER the flag — the slot no longer decides");
  ok(JSON.stringify(positionalArgs(["window", "--env=dev", "--i-know-dev-is-shared"])) === '["window"]',
    "positionalArgs: `--name=value` is a flag too, so a valued flag cannot be read as a phase");
  ok(JSON.stringify(positionalArgs(["fault", "window"])) === '["fault","window"]',
    "positionalArgs: order is preserved and a second positional is NOT swallowed");
  ok(JSON.stringify(positionalArgs(["-"])) === '["-"]',
    "positionalArgs: a BARE dash is a value, not a flag — filtering is on the double dash, which is exact for this harness (`flag`/`arg` accept nothing else)");
  let threw = false;
  try { positionalArgs("window"); } catch (e) { threw = true; }
  ok(threw, "positionalArgs refuses a non-array rather than silently returning nothing");

  /* ── 2. THE HINT CARRIES THE USAGE, read out of a REAL refusal ───────────── */
  const r = run(
    'requireEnvAck(process.argv.slice(2), { faults: [], mutates: ["git"], forceEnv: "dev", script: "phase-driver.mjs", usage: "<window|fault>" });\nconsole.log("PROCEEDED");',
  );
  ok(r.code === 2 && !/PROCEEDED/.test(r.out), "the phase driver's guard refuses shared dev, as before");
  ok(!/Missing .env|ENOENT/.test(r.err), "…and it is still the TENANT refusal, not a file complaint — the order is unchanged");
  const hints = r.err.split("\n").filter((l) => /^\s+node scripts\//.test(l));
  ok(hints.length > 0, "the refusal prints at least one suggested command");
  ok(hints.every((l) => l.includes("<window|fault>")),
    "EVERY suggested command carries the driver's declared usage — a hint that omits it is the defect, and the loop above is why one fixed line was not enough");

  /* THE PROOF THE FINDING ASKED FOR: take the hint VERBATIM, feed its argv to a driver built
     exactly like the real ones, and assert it reaches the phase instead of refusing again. */
  const ackHint = hints.find((l) => l.includes("--i-know-dev-is-shared"));
  ok(!!ackHint, "one of the hints is the ack command — the one an operator copy-pastes");
  /* `<window|fault>` is a PLACEHOLDER: the operator substitutes one alternative, so the
     command actually typed is the hint with that token resolved. Resolve it the same way. */
  const hintArgv = ackHint.trim().split(/\s+/).slice(2)   // drop `node scripts/<name>`
    .map((a) => (/^<.*>$/.test(a) ? a.slice(1, -1).split("|")[0] : a));
  ok(hintArgv.includes("window"), "the hint's argv resolves to a phase the driver knows");
  ok(positionalArgs(hintArgv)[0] === "window",
    "…and a driver reading positionalArgs gets THAT phase from the hint's argv, flags and all — the property F-760 is about");

  /* END TO END, in a child, through the door that does not need a configured machine.
     `declareMutations` is the other half of the same defect (three of the four converted
     drivers use it) and it returns without touching `loadEnv`, so the phase dispatch below
     is REACHED here and its absence of a refusal is observed rather than inferred. */
  const r2 = run(
    'declareMutations(["git"], { script: "phase-driver.mjs", usage: "<window|fault>" });\n' +
    'const PHASE = positionalArgs(process.argv.slice(2))[0] || "window";\n' +
    'if (!["window", "fault"].includes(PHASE)) { console.error("phase must be one of: window, fault"); process.exit(2); }\n' +
    'console.log("RAN phase=" + PHASE);',
    hintArgv.filter((a) => a !== "--env=dev"),   // declareMutations has no --env; the ack is the whole of it
  );
  ok(r2.code === 0 && /RAN phase=window/.test(r2.out),
    "the hint's EXACT command runs the phase — it no longer exits 2 with `phase must be one of` (F-760)");
  ok(!/phase must be one of/.test(r2.err), "…and that sentence is not printed at all");

  /* The `requireEnvAck` half ends differently depending on the machine, and the test says so
     rather than asserting one machine's answer: once the guard is SATISFIED it calls
     `loadEnv`, which THROWS where there is no `test-harness/.env` (a fresh clone, a worktree)
     and returns where there is one. Either way the claim is the same and it is the whole of
     F-760 — the second exit-2 is gone, the run is past the phase decision. Asserting the
     unconfigured ending unconditionally would make this file pass in a worktree and fail on
     the maintainer's own checkout, which is a worse defect than the one being fixed. */
  const CONFIGURED = existsSync(path.join(here, "..", ".env"));
  const r2b = run(
    'requireEnvAck(process.argv.slice(2), { faults: [], mutates: ["git"], forceEnv: "dev", script: "phase-driver.mjs", usage: "<window|fault>" });\n' +
    'const PHASE = positionalArgs(process.argv.slice(2))[0] || "window";\n' +
    'if (!["window", "fault"].includes(PHASE)) { console.error("phase must be one of: window, fault"); process.exit(2); }\n' +
    'console.log("RAN phase=" + PHASE);',
    hintArgv,
  );
  ok(!/phase must be one of/.test(r2b.err),
    "the requireEnvAck driver's hint likewise never lands back on `phase must be one of`");
  /* On an UNCONFIGURED machine the ending is exact and is asserted. On a configured one it
     depends on which URLs that `.env` happens to carry — a fact about the operator's file,
     not about this fix — so only the F-760 claim above is asserted there. The end-to-end
     "the phase RAN" proof is the `declareMutations` child two paragraphs up, which needs no
     env file and therefore holds on every machine. */
  if (!CONFIGURED) {
    ok(r2b.code !== 2, "…and it is past BOTH the tenant refusal and the phase decision — neither exits 2 any more");
    ok(/Missing .*\.env/.test(r2b.err),
      "…stopping only at the env file this worktree has none of, which is the documented order and as far as a refusal test can honestly drive it");
  }

  /* THE OLD SHAPE, kept as the negative control. Without it, the two assertions above would
     still pass on a driver that never had the defect, and this section would prove nothing. */
  const r3 = run(
    'const PHASE = process.argv[2] || "window";\n' +
    'if (!["window", "fault"].includes(PHASE)) { console.error("phase must be one of: window, fault"); process.exit(2); }\n' +
    'console.log("RAN phase=" + PHASE);',
    ["--i-know-dev-is-shared", "window"],
  );
  ok(r3.code === 2 && /phase must be one of/.test(r3.err),
    "the OLD `process.argv[2]` shape still fails on that same argv — so the two assertions above are measuring the fix and not the weather");

  /* ── 3. EVERY LIVE DRIVER THAT READS A POSITIONAL IS CONVERTED ───────────── */
  /* The four found by `grep process.argv[2] scripts/*-live.mjs`:
       git-rotation-window-live.mjs   <window|fault>                (requireEnvAck)
       git-webhook-setup-live.mjs     <setup|idem|…|cleanup>        (declareMutations)
       bitbucket-live.mjs             <whoami|…|cleanup>            (declareMutations)
       pipeline-scaffold-live.mjs     <setup|…|cleanup>             (declareMutations)
     A fifth file growing the defect is caught by the directory scan below rather than by
     this list, which is why the list is allowed to be a comment. */
  for (const f of ["git-rotation-window-live.mjs", "git-webhook-setup-live.mjs", "bitbucket-live.mjs", "pipeline-scaffold-live.mjs"]) {
    const src = readFileSync(path.join(here, f), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    ok(/positionalArgs\(process\.argv\.slice\(2\)\)\[0\]/.test(code), `${f}: reads its phase as the first NON-FLAG argument`);
    ok(/usage:\s*"</.test(code), `${f}: declares a usage line, so the guard's hint can carry it`);
  }

  /* THE DIRECTORY RULE. `process.argv[2]` in a live driver is the defect itself; the scan is
     what stops the fifth file, and it reads CODE ONLY because all four now EXPLAIN the old
     shape in a comment — which is how the next author learns why the read moved. */
  const offenders = readdirSync(here)
    .filter((f) => f.endsWith("-live.mjs"))
    .filter((f) => /process\.argv\[2\]|argv\.slice\(2\)\[0\]/.test(
      readFileSync(path.join(here, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")));
  ok(offenders.length === 0,
    `no *-live.mjs reads a positional by slot — use positionalArgs (F-760). Offenders: ${offenders.join(", ") || "none"}`);
}


/* ── F-773 · THE COMMAND A REFUSAL OFFERS MUST NOT RE-PRINT THE REFUSAL ────────────
 *
 * The shared-tenant refusal built its offer out of `defaultEnv` and never looked at
 * `forceEnv`. On a PINNED driver — the real ones are `git-rotation-window-live.mjs` and its
 * siblings, `forceEnv: "dev"`, no `--env` of their own — `defaultEnv` is still its own
 * default of "staging", so the refusal ended with `node scripts/<name>` and
 * `# staging, the default`. That command cannot reach staging: `envName` takes the pin over
 * argv. It lands on the identical wall of text, the operator concludes the guard is broken,
 * and the next refusal is read past — which is the harm, not the wrong word.
 *
 * Spawned against a driver built exactly like the real pinned ones, and the offer is then
 * TAKEN VERBATIM and shown to pass the guard. A hint asserted only by regex is a hint
 * nobody has run.
 * ──────────────────────────────────────────────────────────────────────────────── */
{
  const PINNED = 'requireEnvAck(process.argv.slice(2), { forceEnv: "dev", faults: ["hookPromote"], mutates: ["git"], script: "git-rotation-window-live.mjs" });\nconsole.log("PROCEEDED");';

  const r = run(PINNED, []);
  ok(r.code === 2 && !/PROCEEDED/.test(r.out),
    "F-773: a pinned driver with no args still refuses the shared dev tenant — the ack is mandatory every run");
  const hints = r.err.split("\n").filter((l) => /^\s+node scripts\//.test(l));
  ok(hints.length === 1,
    `F-773: a PINNED driver is offered exactly ONE command — there is no safer environment to offer, so a second line could only be a --env that the pin overrides (got ${hints.length})`);

  /* THE DEFECT, STATED AS THE TWO THINGS THE OLD TEXT DID. */
  ok(!/# staging, the default/.test(r.err),
    "F-773: the refusal no longer calls staging 'the default' for a driver that can never run there — that sentence was the whole bug");
  ok(!hints.some((l) => /--env=/.test(l)),
    "F-773: …and offers no `--env` at all: every value of it is either refused as a conflict or redundant with the pin");

  /* AND THE TWO THINGS IT MUST SAY INSTEAD, which the forced branch already said. */
  ok(hints.every((l) => /--i-know-dev-is-shared/.test(l)),
    "F-773: the offered command carries the acknowledgement flag — on a pinned driver it is the whole of the decision");
  ok(/# dev, the only environment/.test(r.err),
    "F-773: …and the comment names the pin rather than a default the driver does not have");

  /* THE PROOF: the offer, RUN. `run`'s argv is the hint minus `node scripts/<name>`.
     "Passes the guard" is asserted as the ABSENCE OF THE REFUSAL, not as exit 0: past the
     ack, `requireEnvAck` calls `loadEnv()`, and a machine with no `.env` — this one, and
     every CI box — dies there. That death is itself the evidence, because it happens on the
     far side of the door: the old hint could never reach it, it came back to `REFUSING`.
     `passedGuard` is therefore the honest predicate, and it holds on a configured machine
     too, where the child simply prints PROCEEDED. */
  const passedGuard = (x) => !/^REFUSING/m.test(x.err) && (/PROCEEDED/.test(x.out) || /Missing .*\.env/.test(x.err));
  const offered = hints[0].trim().split(/\s+/).slice(2);
  const taken = run(PINNED, offered);
  ok(passedGuard(taken),
    `F-773: the offered command, taken VERBATIM (${offered.join(" ")}), gets PAST the guard instead of re-printing it — the property the finding is about`);
  ok(/^REFUSING/m.test(r.err) && !/^REFUSING/m.test(taken.err),
    "F-773: …stated as the before/after it is: the same driver, one refusal, and the command that refusal offered does not produce a second one");

  /* THE OTHER BRANCH IS UNCHANGED. The forced-conflict refusal (`--env=staging` on a pinned
     driver) now builds its offer through the same function, so assert it still reads as it
     did — one home is only an improvement if it did not quietly move the other caller. */
  const conflict = run(PINNED, ["--env=staging"]);
  ok(conflict.code === 2 && /can only ever run on dev/.test(conflict.err),
    "F-773: the forced-conflict refusal still names the pin");
  const conflictHints = conflict.err.split("\n").filter((l) => /^\s+node scripts\//.test(l));
  ok(conflictHints.length === 1 && /--i-know-dev-is-shared/.test(conflictHints[0]) && /# dev, the only environment/.test(conflict.err),
    "F-773: …and offers the same single acknowledged command it always did — the shared builder was taken FROM this branch, so this is the regression check on the move");
  const takenConflict = run(PINNED, conflictHints[0].trim().split(/\s+/).slice(2));
  ok(passedGuard(takenConflict), "F-773: …and that one gets past the guard too");

  /* AN UNPINNED DRIVER IS STILL OFFERED THE SAFER ENVIRONMENT BY NAME. The fix must not
     have collapsed the three cases into the pinned one. */
  const FREE = 'requireEnvAck(process.argv.slice(2), { faults: [], mutates: ["git"], script: "some-live.mjs" });\nconsole.log("PROCEEDED");';
  const free = run(FREE, ["--env=dev"]);
  ok(free.code === 2, "F-773: an unpinned driver sent to dev still refuses");
  const freeHints = free.err.split("\n").filter((l) => /^\s+node scripts\//.test(l));
  ok(freeHints.length === 2, `F-773: …and is offered TWO commands, the safer environment and the acknowledged dev (got ${freeHints.length})`);
  ok(/# staging, the default/.test(free.err),
    "F-773: …where naming the default IS correct, because this driver can actually run there");
  const takenFree = run(FREE, freeHints[0].trim().split(/\s+/).slice(2));
  ok(passedGuard(takenFree),
    "F-773: …and its first offer gets past as well — the unshared environment needs no acknowledgement");
}

console.log("\nshared-env-guard: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
