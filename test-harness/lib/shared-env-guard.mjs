/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */
/* ═══════════════════════════════════════════════════════════════════════════════
 * ONE HOME FOR "WHICH ENVIRONMENT AM I POINTED AT" — F-686, F-698, F-699.
 *
 * F-679 put a `--i-know-dev-is-shared` refusal in `harness-fault-expiry-live.mjs`, and it
 * was RIGHT: arming `armKeyReadFault`/`armJiraFault` on the shared dev tenant makes an
 * admin who happens to be in Settings read a PLANTED refusal as a bad credential and
 * rotate a working key. But the refusal lived INLINE in one file, and three siblings armed
 * the very same levers on the very same tenant with nothing but `--env=dev`:
 * `key-status-fault-live.mjs`, `key-status-fault-ui-live.mjs` (240 s — 48x the guarded
 * driver's window, and it drives the real admin page) and `user-search-fault-live.mjs`
 * (dev as its ONLY mode, no `--env` at all). A guard with one home and four subjects is
 * not a guard; it is a comment that happens to exit. F-686 made it a library.
 *
 * F-698 then found the library had no idea what an environment WAS. `--env` was read with
 * a default and forked ONCE, on `=== "dev"`; every other string — `production`, `prod`,
 * `Dev`, `devv` — was accepted in silence, mapped to staging, and then WRITTEN INTO THE
 * EVIDENCE FILE as the environment the run had used. An evidence file that asserts an
 * environment the run never touched is worse than one that says nothing.
 *
 * F-699 found the other half. The docblock here claimed "no driver re-decides that
 * mapping" on the day FIVE drivers still carried the env-to-URL ternary inline — one of
 * them (`va-compaction-live.mjs`) with INVERTED polarity, so an unrecognised `--env` there
 * landed on the SHARED DEV tenant, the exact target this guard defaults away from — and
 * the env-to-Forge-env-id fork, the same decision one line below, sat byte-copied in four
 * more. One rule, ten homes, two of which disagreed.
 *
 * So there is now exactly ONE table (`ENVS`). It carries the environment's name, its
 * web-trigger URL variable and its Forge environment id, and the directory rules in
 * `scripts/evidence-redaction.test.mjs` are what stop the eleventh home from being
 * written: 4e ("any *-live.mjs that arms a fault must call requireEnvAck"), 4f ("no file
 * under lib/ or scripts/ may read STAGING_TESTSTATE_URL or retype an environment id
 * literal" — live-driver-scope's RULE 3 was absorbed into it by F-718, so that rule has
 * one home too) and 4g ("a driver's `mutates` is its TRUE set"). A driver with an inline
 * copy of any of them fails `npm run test:offline` before it is ever run.
 *
 * CONTRACT
 *   const { envName, hookUrl, envId } = requireEnvAck(process.argv.slice(2), {
 *     faults: ["keyRead:openai", "jiraUserSearch"],   // what this driver ARMS
 *     mutates: ["agents", "jobs"],                    // what it CHANGES and LEAVES changed
 *     maxSeconds: 240,                                // the LONGEST TTL it arms
 *     defaultEnv: "staging",                          // where `--env` lands when omitted
 *   });
 *
 *   - `--env` must name a key of `ENVS`, CASE-SENSITIVELY. Anything else exits 2 naming
 *     the legal set; `production`/`prod` gets its own sentence, because no driver in this
 *     directory has a production trigger and the only honest answer is a refusal.
 *   - `envName` is the VALIDATED name. It is what a driver writes into `ev.env`, so the
 *     evidence records an environment that exists and that the run actually used.
 *   - `hookUrl` and `envId` come out of the SAME row. No driver re-decides either, and a
 *     legal environment with no URL configured is a refusal too, not an `undefined` that
 *     turns every hook call into an opaque fetch error.
 *   - `--env=dev` without `--i-know-dev-is-shared` prints the blast radius OF THE FAULTS
 *     AND THE MUTATIONS THIS DRIVER NAMES, with this driver's own longest window, and
 *     exits 2. F-718: ARMING is not the criterion — MUTATING the shared tenant is, and a
 *     mutation is the one that OUTLIVES the process.
 *   - A driver that arms nothing and writes nothing passes `faults: []` AND `mutates: []`
 *     and gets the mapping only: a read-only driver runs on dev with no ceremony, which is
 *     exactly what keeps the refusal worth reading when it does fire. Both arrays are
 *     REQUIRED, so an empty blast radius is a statement rather than an omission.
 *   - `--envid` is NOT a second way to choose an environment (F-732). It survives only for
 *     the identity it already has: an id that is not `forgeEnvId(envName)` is a refusal,
 *     because the HOOK half and the BROWSER half of a driver must come from ONE row, and an
 *     id typed on the command line is rule 4f's banned literal typed somewhere the file rule
 *     cannot see it.
 *   - `scripts/evidence-redaction.test.mjs` rule 4g keeps the declaration HONEST: a driver
 *     that calls a mutator must declare a non-empty `mutates`, and one that declares
 *     `mutates: []` must call none. `requireAck: true` survives for a driver whose blast
 *     radius is real but fits no word in either vocabulary.
 *
 * WHY THE REFUSAL RUNS BEFORE `loadEnv()`. `loadEnv` THROWS when there is no `.env`
 * (lib/env.mjs). If the guard ran after it, `--env=dev` on an unconfigured machine would
 * die with "Missing .env" and the operator would learn nothing about the tenant — the
 * guard would be a courtesy for the configured and a surprise for everyone else. The argv
 * VALIDATION and the refusal therefore both happen first, and the env file is only read
 * once the environment is settled.
 * ═══════════════════════════════════════════════════════════════════════════════ */
import { loadEnv } from "./env.mjs";

/**
 * THE TABLE. Every fact that depends on "which environment" lives in ONE row.
 *
 * `forgeEnvId` is the id in `.../jira/apps/<appId>/<envId>` — the admin-page URL the
 * Playwright half of a UI driver opens. It was copied into four drivers; when staging is
 * redeployed and the id changes, the one edit is HERE.
 */
const ENVS = Object.freeze({
  dev: Object.freeze({
    urlVar: "TESTSTATE_URL",
    forgeEnvId: "989ecaa0-261b-406e-b444-78c01c0d7772",
    forgeEnvArg: "development",
    shared: true,
  }),
  staging: Object.freeze({
    urlVar: "STAGING_TESTSTATE_URL",
    forgeEnvId: "1abe9beb-537b-43c1-b94f-e877e251f779",
    forgeEnvArg: "staging",
    shared: false,
  }),
});
const ENV_NAMES = Object.freeze(Object.keys(ENVS));

/**
 * The Forge environment id, for a script that wants ONLY the admin-page URL — no `--env`,
 * no `.env`, no refusal, no side effect.
 *
 * F-699's env-id cohort is not the same as its URL cohort. Thirteen `*-live.mjs` in this
 * directory are dev-only one-shot Playwright scripts that never open a web trigger and
 * never call `loadEnv`; routing them through `requireEnvAck` would make them demand a
 * `.env` and a `TESTSTATE_URL` they have no use for — a real behaviour regression bought
 * for a cosmetic uniformity. They get this instead, and the directory rule (4f) is then
 * satisfiable by every file it covers without any of them changing what it does.
 */
export function forgeEnvId(envName) {
  if (!Object.prototype.hasOwnProperty.call(ENVS, envName)) {
    throw new Error(`forgeEnvId: "${envName}" is not one of ${ENV_NAMES.join(", ")}`);
  }
  return ENVS[envName].forgeEnvId;
}

/**
 * The web-trigger URL for ONE named environment, for the driver that talks to BOTH in a
 * single run — `probes-1.5-live.mjs` compares dev against staging, so it cannot settle on
 * one `envName` the way `requireEnvAck` does. It still must not carry its own copy of the
 * variable names, which is the F-699 defect; this is the same row, read one field at a
 * time. Returns `undefined` when the variable is unset — the caller decides, because a
 * probe that reports "staging is not configured" is doing its job.
 */
export function hookUrlFor(envName) {
  if (!Object.prototype.hasOwnProperty.call(ENVS, envName)) {
    throw new Error(`hookUrlFor: "${envName}" is not one of ${ENV_NAMES.join(", ")}`);
  }
  return loadEnv()[ENVS[envName].urlVar];
}

/** The `.env` variable that carries an environment's web-trigger URL, for an error message
 *  that must name it. Reading the NAME is not re-deciding the mapping. */
export function hookUrlVar(envName) {
  if (!Object.prototype.hasOwnProperty.call(ENVS, envName)) {
    throw new Error(`hookUrlVar: "${envName}" is not one of ${ENV_NAMES.join(", ")}`);
  }
  return ENVS[envName].urlVar;
}

/** The user-visible harm of each lever, in ONE place. A driver NAMES the fault it arms; it
 *  does not get to describe — or to forget to describe — what that fault does to a
 *  bystander. That was exactly the drift F-686 found. */
const FAULT_HARMS = {
  keyRead: (p) =>
    `the ${p || "provider"} key slot REFUSES to be read — an admin on Settings -> Providers sees\n` +
    `    "Couldn't read key status", and a "test key" click answers a planted refusal. The harm\n` +
    `    is not the wait: they read it as a bad credential and ROTATE A WORKING KEY.`,
  jiraUserSearch: () =>
    `/rest/api/3/user/search answers 429 — the Permissions tab's people picker shows a\n` +
    `    throttling notice and finds NOBODY, and a rule author mid-edit sees an empty search.`,
  dispatchDrop: () =>
    `queued webhook deliveries are DROPPED for the armed connection — a developer whose\n` +
    `    push lands in that window sees no rule run and no row in the delivery log.`,
  hookPromote: () =>
    `the repository hook secret ROTATION fails at its promote step — the connection card\n` +
    `    shows "rotation failed" to anyone who opens it, on a connection they did not touch.`,
  /* F-721 — the ONLY lever in this table whose blast radius is honestly "nothing a user
     sees": `armDeleteFault` makes KVS deletes refuse, and the only rows a harness driver
     deletes are the INERT plant ballast `plantHarnessFaults` wrote. It is named anyway,
     because a lever with no sentence is a lever nobody can reason about, and because the
     sweep it stalls is the app's own. The MUTATION of planting that ballast is a separate
     declaration (`mutates: ["kvs"]`); this line is about the lever, not the rows. */
  deleteFault: () =>
    `KVS deletes REFUSE for the armed window. Nothing user-visible breaks — the only rows a\n` +
    `    harness driver deletes are inert plant ballast — but the app's own sweep stops\n` +
    `    advancing while it is armed, and a KILLED process leaves the ballast planted.`,
};

/* ── F-718 — THE SECOND TRIGGER: MUTATION ────────────────────────────────────────
 * The ack was drawn at ARMS-A-FAULT and the criterion was never written down, so the line
 * fell where nobody would have chosen it: `plant-sweep-live.mjs` — which writes INERT
 * ballast and arms nothing — demanded `--i-know-dev-is-shared`, while
 * `va-purge-on-delete-live.mjs` DELETED a virtual agent, `coder-pin-kept-live.mjs`
 * REWROTE `COGNIRUNNER_AI_PROVIDER` and `knowledge-doors-editor-live.mjs` WROTE SKILLS
 * into the shared store — all on `--env=dev`, in silence, and all newly reachable on dev
 * because the F-699 conversion had just given seven of them an `--env` they never had.
 *
 * The line is MUTATES SHARED DEV. A fault is loud and short and disarmed in a `finally`;
 * a mutation is quiet and PERSISTS after the process exits — the deleted agent does not
 * come back. Both trigger the refusal now, and a driver declares its true set of BOTH:
 * `faults: []` and `mutates: []` are statements, not omissions, and rule 4g in
 * `scripts/evidence-redaction.test.mjs` is what keeps the second one honest.
 *
 * The vocabulary is CLOSED, for the reason FAULT_HARMS is closed: a driver NAMES what it
 * touches, it does not get to invent — or to soften — the description of it. `kvs` is the
 * honest catch-all for an app storage row no other word covers (planted ballast, API
 * tokens, a coder thread), never a lazier spelling of one that does.
 */
const MUTATION_HARMS = Object.freeze({
  roster: "the app's ADMIN/EDITOR roster — someone's role on this tenant changes",
  skills: "the shared SKILL store — skills are created, edited or disabled for everyone",
  docs: "the shared DOCUMENTATION library — docs are created or deleted for everyone",
  memories: "the instance MEMORY store — learned facts are added or removed for everyone",
  providerSlot: "the AI PROVIDER/MODEL slots — every AI call on this tenant changes provider mid-flight",
  agents: "VIRTUAL AGENTS — agents are created, tombstoned or DELETED, and a delete does not come back",
  jobs: "SCHEDULED JOBS — jobs are created, run-now'd or deleted, and a tick may fire while someone watches",
  listeners: "LISTENERS — listener rules are saved or deleted, so real Jira events start or stop running rules",
  rules: "WORKFLOW RULES — rule configs are registered, edited or removed",
  issues: "JIRA ITSELF — issues, comments, labels or transitions are written on a real project",
  git: "GIT CONNECTIONS — repository connections, hook secrets or deploys are written",
  kvs: "raw APP STORAGE rows no other word covers (planted ballast, API tokens, coder threads)",
});
const MUTATION_NAMES = Object.freeze(Object.keys(MUTATION_HARMS));

/** `"agents"` -> its sentence. An unknown word THROWS rather than passing quietly: the
 *  whole point of a closed vocabulary is that a typo cannot become an undeclared
 *  mutation, which is the F-718 defect in miniature. */
function mutationLine(kind) {
  const line = MUTATION_HARMS[kind];
  if (!line) {
    throw new Error(
      `requireEnvAck: unknown mutation "${kind}" — the vocabulary is closed (${MUTATION_NAMES.join(", ")}); ` +
      "add a word to MUTATION_HARMS with its sentence, do not describe it at the call site"
    );
  }
  return `  - ${line}`;
}

const flag = (argv, n) => argv.includes(`--${n}`);
const arg = (argv, n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};

/** `"keyRead:openai"` or `{ kind, param }` -> the harm sentence. */
function harmLine(fault) {
  const kind = typeof fault === "string" ? fault.split(":")[0] : fault.kind;
  const param = typeof fault === "string" ? fault.split(":")[1] : fault.param;
  const f = FAULT_HARMS[kind];
  if (!f) {
    throw new Error(
      `requireEnvAck: unknown fault "${kind}" — add it to FAULT_HARMS, do not describe it at the call site`
    );
  }
  return `  - ${f(param)}`;
}

/* ── F-760 — THE POSITIONAL AND THE FLAG MUST NOT COMPETE FOR argv[2] ─────────────
 * A phase-driven driver used to read its phase as `process.argv[2]`. The guard's own
 * refusal hint ends with `node scripts/<name> --i-know-dev-is-shared`, so an operator
 * who copy-pastes the suggestion puts the ACK FLAG in slot 2 — the driver reads it as
 * the phase and exits 2 a second time with `phase must be one of: window, fault`. The
 * refusal therefore prints a command that cannot run, and the operator starts guessing,
 * which is the F-735 failure mode relocated from the flag to the hint.
 *
 * Both halves are fixed, and they are independent:
 *   - here, a driver reads its positionals through `positionalArgs`, so a flag is never
 *     mistaken for a phase WHEREVER it appears in the command line; and
 *   - below, `requireEnvAck`/`declareMutations` take a `usage:` string and splice it into
 *     every hint they print, so the suggestion carries the phase the driver needs.
 *
 * Filtering on the DOUBLE dash is exact for this harness, not a heuristic: every flag in
 * `lib/` and `scripts/` is `--name` or `--name=value` (see `flag`/`arg` directly above —
 * neither form can consume a following word, so there is no "flag value" to skip). A bare
 * `-` or a negative number is a VALUE and is deliberately kept.
 */
/**
 * @param {string[]} argv usually `process.argv.slice(2)`
 * @returns {string[]} argv without its `--flags`, order preserved
 */
export function positionalArgs(argv = process.argv.slice(2)) {
  if (!Array.isArray(argv)) {
    throw new Error("positionalArgs: pass an argv array (usually process.argv.slice(2))");
  }
  return argv.filter((a) => !String(a).startsWith("--"));
}

/** The usage line a driver declared, spliced after the script name in a hint (F-760). */
const usageBit = (usage) => (usage ? ` ${usage}` : "");

/** One exit door, so every refusal in this file reads the same way. */
function die(lines) {
  console.error(["", ...lines, ""].join("\n"));
  process.exit(2);
}

/**
 * Settle the environment for a live driver: validate `--env`, refuse the shared tenant
 * where it must be refused, and hand back the WHOLE row for that environment.
 *
 * @param {string[]} argv             process.argv.slice(2)
 * @param {object}   opts
 * @param {Array}    opts.faults      the levers this driver arms (keys of FAULT_HARMS,
 *                                    optionally `kind:param`, e.g. `keyRead:openai`).
 *                                    `[]` means "this driver arms nothing" and is the
 *                                    mapping-only form — it must still be written out, so
 *                                    an EMPTY blast radius is a statement rather than an
 *                                    omission.
 * @param {string[]} opts.mutates     what this driver CHANGES on the tenant and LEAVES
 *                                    changed, as words from the closed MUTATION_HARMS
 *                                    vocabulary. `[]` means "this driver is read-only" —
 *                                    also required, also a statement (F-718), and rule 4g
 *                                    checks it against the mutators the file actually
 *                                    calls.
 * @param {number}  [opts.maxSeconds] the LONGEST TTL this driver arms. Omit for a
 *                                    count-bounded lever, which has no window of its own.
 * @param {string}  [opts.defaultEnv] where `--env` lands when omitted (default "staging").
 * @param {string}  [opts.forceEnv]   this driver has NO choice of environment: it is pinned
 *                                    here, `--env` may only ever AGREE, and a conflicting
 *                                    `--env` is refused by name. Mutually exclusive with
 *                                    `defaultEnv`, which is about where a free choice lands.
 * @param {boolean} [opts.requireAck] force the shared-dev refusal even with no faults.
 * @param {string}  [opts.script]     script name for the usage lines (defaults to argv[1])
 * @param {string}  [opts.usage]      F-760 — the POSITIONALS this driver requires, e.g.
 *                                    `"<window|fault>"`. Spliced after the script name in
 *                                    EVERY hint this function prints, so the command the
 *                                    refusal suggests is one that actually runs. A phase
 *                                    driver that omits it prints a hint that exits 2 again
 *                                    for a second, unrelated reason — which is the whole
 *                                    of F-760.
 * @returns {{ envName: string, hookUrl: string, envId: string, urlVar: string,
 *            shared: boolean, acknowledged: boolean }}
 */
export function requireEnvAck(argv, { faults, mutates, maxSeconds, defaultEnv = "staging", forceEnv, requireAck = false, script, usage } = {}) {
  if (!Array.isArray(faults)) {
    throw new Error(
      "requireEnvAck: name the faults this driver arms (`faults: []` if it arms none) — an unnamed blast radius is the defect F-686 is about"
    );
  }
  /* F-718 — the same demand for the OTHER half of the blast radius. A driver that does not
     say what it writes is exactly the driver that deleted an agent on the shared tenant in
     silence, so an omitted `mutates` is a THROW and not a default of `[]`: a default would
     let the next driver be written without ever facing the question. */
  if (!Array.isArray(mutates)) {
    throw new Error(
      "requireEnvAck: name what this driver MUTATES on the tenant (`mutates: []` if it is read-only) — " +
      `the closed vocabulary is ${MUTATION_NAMES.join(", ")} (F-718)`
    );
  }
  /* Validate EVERY word before the environment fork, so a typo is caught on staging too
     and never waits for the one run that points at dev to be discovered. */
  for (const m of mutates) mutationLine(m);
  for (const f of faults) harmLine(f);
  if (!Object.prototype.hasOwnProperty.call(ENVS, defaultEnv)) {
    throw new Error(`requireEnvAck: defaultEnv "${defaultEnv}" is not one of ${ENV_NAMES.join(", ")}`);
  }
  if (forceEnv !== undefined && !Object.prototype.hasOwnProperty.call(ENVS, forceEnv)) {
    throw new Error(`requireEnvAck: forceEnv "${forceEnv}" is not one of ${ENV_NAMES.join(", ")}`);
  }
  const name = script || (process.argv[1] || "").split("/").pop() || "this-driver.mjs";

  /* ── F-735 — A PINNED ENVIRONMENT IS THE LIBRARY'S DECISION, NOT AN ARGV TRICK ────
   * Two drivers are dev-only by construction — `testState` resolves `TESTSTATE_URL`
   * unconditionally and there is no staging trigger for their flow — so they tried to make
   * the choice for themselves by appending to the operator's argv:
   *
   *     requireEnvAck([...process.argv.slice(2), "--env=dev"], { … })
   *
   * `arg()` is `argv.find(…)`, which returns the FIRST match, and the operator's argv is
   * spread FIRST. So `--env=staging` on the command line WON: `shared` came out false, the
   * shared-dev refusal was skipped entirely, and the two drivers whose own comments call the
   * ack "mandatory on every run" armed `armDispatchFault` / `armHookPromoteFault` on dev in
   * silence. The flag moved the refusal and did not move the target, because neither driver
   * reads the guard's `hookUrl` — the tenant comes from `lib/rules-api.mjs` either way.
   *
   * A typo was LOUDER than the real bypass: `--env=stagng` hit the closed-set refusal above
   * while `--env=staging` sailed through. That is the signature of a guard that can be
   * argued with in its own argument list, so the pin moves in here where it cannot be.
   *
   * The conflicting `--env` is refused BY NAME rather than ignored. Silently overriding it
   * would leave an operator who typed `--env=staging` believing they had run against
   * staging — F-698's complaint exactly, and the reason an unknown `--env` is a refusal and
   * not a fallback. */
  if (forceEnv !== undefined) {
    const asked = arg(argv, "env", null);
    if (asked !== null && asked !== forceEnv) {
      die([
        `REFUSING to run: --env=${JSON.stringify(asked)}, but this driver can only ever run on ${forceEnv}.`,
        "",
        "It is pinned by CONSTRUCTION, not by preference: the tenant it talks to comes from",
        `\`lib/rules-api.mjs\`, which resolves ${ENVS[forceEnv].urlVar} unconditionally, and there is no`,
        "trigger for this flow anywhere else. So the flag could never have moved the target —",
        "it could only have moved the REFUSAL, which is precisely what it used to do (F-735).",
        "",
        `Your \`--env\` is NOT being ignored. It used to be, quietly: the pin was appended after`,
        "your argv and the first `--env` won, so this exact command ran against dev with the",
        "shared-tenant refusal skipped, and a TYPO would have been louder than the bypass.",
        "",
        `  node scripts/${name}${usageBit(usage)}${ENVS[forceEnv].shared ? " --i-know-dev-is-shared" : ""}`,
        `      # ${forceEnv}, the only environment this driver has`,
      ]);
    }
  }
  const envName = forceEnv !== undefined ? forceEnv : arg(argv, "env", defaultEnv);

  /* F-698 — A CLOSED SET, CASE-SENSITIVE, CHECKED BEFORE ANYTHING ELSE (and before
     `loadEnv`, so it answers on an unconfigured machine too). The old code forked once on
     `=== "dev"` and let every other string through to the staging branch without a word —
     and the driver then recorded that string as the environment it had run in. */
  if (!Object.prototype.hasOwnProperty.call(ENVS, envName)) {
    const isProd = /^prod(uction)?$/i.test(envName);
    die([
      `REFUSING to run: --env=${JSON.stringify(envName)} is not an environment this harness knows.`,
      "",
      ...(isProd
        ? [
          "There is no production web-trigger and no production Forge environment id in this",
          "directory, and there will not be one: a live driver plants state, arms faults and",
          "drives the admin UI. Accepting the word would have run this against STAGING and",
          `written "${envName}" into results/.../evidence.json as the environment it used.`,
        ]
        : [
          "It was NOT silently mapped to staging. The old guard did exactly that — anything",
          "that was not the literal `dev` became staging, and the evidence file then recorded",
          "the string it was given rather than the tenant the run touched (F-698).",
        ]),
      "",
      `Legal values (case-sensitive): ${ENV_NAMES.join(", ")}`,
      "",
      `  node scripts/${name}${usageBit(usage)} --env=${defaultEnv}`,
      `      # ${defaultEnv}, which is also where --env lands when it is omitted`,
    ]);
  }

  const row = ENVS[envName];
  const acknowledged = flag(argv, "i-know-dev-is-shared");
  /* F-718 — MUTATION IS THE SECOND TRIGGER, AND IT IS THE HEAVIER ONE. A fault ends when
     the `finally` runs; a write does not. */
  const wantsAck = requireAck || faults.length > 0 || mutates.length > 0;

  if (row.shared && wantsAck && !acknowledged) {
    const windowLine = maxSeconds
      ? `each arming lasts up to ${maxSeconds}s in this driver`
      : "count-bounded, not time-bounded: armed until consumed or disarmed";
    die([
      "REFUSING to point this driver at the SHARED dev tenant without an explicit acknowledgement.",
      "",
      ...(faults.length
        ? [`While it runs it arms REAL, user-visible faults on that site (${windowLine}):`, ...faults.map(harmLine), ""]
        : []),
      ...(mutates.length
        ? ["It CHANGES this shared tenant, and a change OUTLIVES the run — the driver restores what",
          "it can, but a killed process, a failed restore or a delete does not come back:",
          ...mutates.map(mutationLine), ""]
        : []),
      ...(!faults.length && !mutates.length
        ? ["It arms no faults and writes nothing it has named, but it drives the shared dev tenant",
          "and other people are on it.", ""]
        : []),
      /* The closing paragraph has to match what was just listed. A mutation-only driver
         arms nothing, and telling its operator about levers and a 300s ceiling would be
         the guard talking about a file it is not looking at — which is how a refusal
         becomes wallpaper. */
      ...(faults.length
        ? ["Every lever is disarmed in a finally — but NOT if this process is KILLED; the only bound",
          "then is the 300s family ceiling. Nothing in the evidence file or the terminal would ever",
          "tell the admin who just rotated a good key that a harness lever was live at that moment."]
        : ["The driver restores what it changed on the way out — but NOT if this process is KILLED,",
          "and not for a delete. Nothing in the evidence file or the terminal would ever tell the",
          "person whose agent, job or provider slot just moved that a harness run did it."]),
      "Schedule the run, or tell whoever is on the tenant — do not discover it afterwards.",
      "",
      /* A driver whose DEFAULT is dev must not be told "just run it with no --env": that
         lands right back here. Offer the other environment by name instead. */
      ...(ENVS[defaultEnv].shared
        ? [`  node scripts/${name}${usageBit(usage)} --env=${ENV_NAMES.find((n) => !ENVS[n].shared)}`,
          `      # the unshared environment — note this driver DEFAULTS to dev`]
        : [`  node scripts/${name}${usageBit(usage)}`, `      # ${defaultEnv}, the default`]),
      `  node scripts/${name}${usageBit(usage)} --env=dev --i-know-dev-is-shared`,
    ]);
  }

  /* ── F-732 — `--envid` MAY NOT RE-DECIDE THE ROW ─────────────────────────────────
   * F-714 fixed the hook-half/browser-half split in ONE driver and left the same split
   * available BY FLAG in eight siblings: `--envid` took a RAW environment id that overrode
   * the settled row, so `--env=staging --envid=<dev id>` armed a fault on STAGING for 240 s
   * and then pointed Playwright at the DEV admin page, where nothing was armed. The driver
   * FAILs "the notice never appeared" and `ev.env` records "staging" for a run whose UI half
   * was dev — F-698's exact complaint, re-entered through a flag.
   *
   * Rule 4f forbids retyping an environment id IN A FILE, and an id typed on the COMMAND LINE
   * is the same decision made outside the one home, so the rule belongs here rather than in a
   * convention: the flag survives, and it may only ever say what the row already says. The
   * shared-dev ack cannot cover this by construction — it keys off `--env`, and `--envid`
   * never reaches it, so pointing the BROWSER at dev was unacknowledged.
   *
   * It is checked BEFORE `loadEnv()` for the same reason everything else here is: an operator
   * on an unconfigured machine must read the refusal, not "Missing .env". */
  const rawEnvId = arg(argv, "envid", null);
  if (rawEnvId !== null && rawEnvId !== row.forgeEnvId) {
    const named = ENV_NAMES.find((n) => ENVS[n].forgeEnvId === rawEnvId);
    die([
      `REFUSING to run: --envid does not name the environment this run settled on (${envName}).`,
      "",
      "A driver has a HOOK half and a BROWSER half, and both must come from ONE row of the",
      "guard's table. `--envid` used to override the browser half alone, so",
      "`--env=staging --envid=<dev id>` armed the fault on one tenant and drove the admin page",
      "of the other — and the evidence file recorded the environment of the half that did not",
      "fail (F-698, F-714, F-732).",
      "",
      ...(named
        ? [`The id given is ${named}'s. If that is the environment you want, name it:`,
          `  node scripts/${name}${usageBit(usage)} --env=${named}`]
        : ["The id given is not one this harness knows at all. Environment ids are not typed;",
          "they come out of the one table, which `--env` already reads for you:",
          `  node scripts/${name}${usageBit(usage)} --env=${envName}`]),
      "",
      `\`--envid\` survives only for the identity it already has: --envid=${row.forgeEnvId} is`,
      `what --env=${envName} means, and passing it changes nothing.`,
    ]);
  }

  /* Settled. Only NOW is the env file allowed to have an opinion. */
  const env = loadEnv();
  const hookUrl = env[row.urlVar];
  if (!hookUrl) {
    /* F-698 — a LEGAL environment with no URL is a refusal too. It used to become
       `undefined`, and every hook call then failed with an opaque fetch error instead of
       the one sentence that names the variable to set. */
    die([
      `REFUSING to run: environment "${envName}" has no web-trigger URL.`,
      "",
      `Set ${row.urlVar} in test-harness/.env to the output of:`,
      `  forge webtrigger create -f harness-test-state -e ${row.forgeEnvArg}`,
    ]);
  }
  return { envName, hookUrl, envId: row.forgeEnvId, urlVar: row.urlVar, shared: row.shared, acknowledged };
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * F-733 — THE DEV-ONLY DRIVERS DECLARE TOO, WITHOUT BEING DRAGGED THROUGH THE MAPPING.
 *
 * Rule 4g's own comment stated the gap it could not close: only a driver that CALLS
 * `requireEnvAck` can declare anything, and twenty-five `*-live.mjs` never do. They are
 * dev-only by construction — no `--env`, no choice — and several of them WRITE:
 * `perm-discriminator-live.mjs` grants and removes app roles, `skills-knowledge-ui-live.mjs`
 * writes SKILLS into the shared store, `pipeline-scaffold-live.mjs` pushes a DEPLOY.
 * All of it on the shared tenant, in silence, while `plant-sweep-live.mjs` — which writes
 * inert ballast — has to be acknowledged. That is F-718's line drawn in the wrong place
 * again, one cohort over.
 *
 * Routing them through `requireEnvAck` is the WRONG fix and F-699 already said why: it would
 * make a Playwright script that never opens a web trigger demand a `.env` and a
 * `TESTSTATE_URL` it has no use for — a real behaviour regression bought for a cosmetic
 * uniformity. So this is the DECLARATION half on its own. No `--env`, no environment
 * resolution, no `loadEnv`, nothing read from disk: the SAME closed vocabulary, the same
 * sentences, the same exit code.
 *
 * AND THE FLAG IS THE WHOLE ACKNOWLEDGEMENT, because there is nothing else to acknowledge.
 * `requireEnvAck` asks only when the settled row is shared; these drivers have one row and it
 * IS the shared one, so a non-empty `mutates` always asks. A driver that declares `[]` runs
 * with no ceremony — which is exactly what keeps the refusal worth reading when it fires.
 *
 * `scripts/evidence-redaction.test.mjs` rule 4g reads this call exactly as it reads
 * `mutates:`, so the declaration is held to the same honesty test: a driver that calls a
 * mutator may not declare `[]`, and one that declares a word must call something.
 *
 * ONE LIMIT, MEASURED AND STATED RATHER THAN IMPLIED. This function demands no `.env` — but
 * ESM evaluates every IMPORT before the module body, and `lib/jira.mjs` and
 * `lib/rules-api.mjs` both call `loadEnv()` at module scope. So in the drivers that import one
 * of those, an UNCONFIGURED machine still reads "Missing .env" before it reads this refusal;
 * only `perm-discriminator-live.mjs` and `skills-knowledge-ui-live.mjs` refuse first. What is
 * true of ALL of them, and is the guarantee that matters, is that the refusal precedes every
 * NETWORK call and every browser: `loadEnv` reads a file, it does not touch a tenant. Measured
 * 2026-09-14 over all 26 with an env file present: 23 of 23 mutating drivers exit 2 with this
 * sentence, and the 3 read-only ones run on to their own fixtures.
 * ═══════════════════════════════════════════════════════════════════════════════ */

/**
 * Declare what a DEV-ONLY driver changes on the shared tenant, and refuse without the ack.
 *
 * @param {string[]} mutates  words from the closed MUTATION_HARMS vocabulary. `[]` means
 *                            "this driver is read-only" and is REQUIRED, not omittable —
 *                            an empty blast radius is a statement, never a silence.
 * @param {object}  [opts]
 * @param {string[]} [opts.argv]   defaults to `process.argv.slice(2)`
 * @param {string}  [opts.script]  script name for the usage line (defaults to argv[1])
 * @param {string}  [opts.usage]   F-760 — the POSITIONALS this driver requires, e.g.
 *                                 `"<setup|rotate|cleanup>"`, spliced after the script name
 *                                 in the hint so the suggested command actually runs.
 * @returns {{ mutates: string[], acknowledged: boolean }}
 */
export function declareMutations(mutates, { argv = process.argv.slice(2), script, usage } = {}) {
  if (!Array.isArray(mutates)) {
    throw new Error(
      "declareMutations: name what this driver CHANGES on the shared dev tenant " +
      "(`declareMutations([])` if it is read-only) — " +
      `the closed vocabulary is ${MUTATION_NAMES.join(", ")} (F-733)`
    );
  }
  /* Validate EVERY word first, so a typo is a THROW at module load on any machine and never
     waits for the one run that reaches the refusal to be discovered. */
  for (const m of mutates) mutationLine(m);

  const acknowledged = flag(argv, "i-know-dev-is-shared");
  if (!mutates.length || acknowledged) return { mutates, acknowledged };

  const name = script || (process.argv[1] || "").split("/").pop() || "this-driver.mjs";
  die([
    "REFUSING to run: this driver CHANGES the SHARED dev tenant and nobody has said so out loud.",
    "",
    "It has no `--env`: dev is the only tenant it can talk to, so there is no safer environment",
    "to offer you and the acknowledgement is the whole of the decision.",
    "",
    "What it changes, and a change OUTLIVES the run — the driver restores what it can, but a",
    "killed process, a failed restore or a delete does not come back:",
    ...mutates.map(mutationLine),
    "",
    "Nothing in the evidence file or the terminal would ever tell the person whose role, skill,",
    "job or connection just moved that a harness run did it. Schedule it, or tell whoever is on",
    "the tenant — do not discover it afterwards.",
    "",
    `  node scripts/${name}${usageBit(usage)} --i-know-dev-is-shared`,
  ]);
}

export { FAULT_HARMS, MUTATION_HARMS, MUTATION_NAMES, ENVS, ENV_NAMES };
