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
 * written: 4e ("any *-live.mjs that arms a fault must call requireEnvAck") and 4f ("no
 * *-live.mjs may read STAGING_TESTSTATE_URL or retype an environment id literal"). A
 * driver with an inline copy of either fails `npm run test:offline` before it is ever run.
 *
 * CONTRACT
 *   const { envName, hookUrl, envId } = requireEnvAck(process.argv.slice(2), {
 *     faults: ["keyRead:openai", "jiraUserSearch"],   // what this driver ARMS
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
 *     THIS DRIVER NAMES, with this driver's own longest window, and exits 2.
 *   - A driver that arms NOTHING passes `faults: []` and gets the mapping only. It is here
 *     for the table, not for the refusal; pass `requireAck: true` to opt into the refusal
 *     anyway. (Six drivers in this directory legitimately DEFAULT to dev — making the ack
 *     unconditional would break every one of them, which is a larger change than either
 *     finding asked for and belongs to whoever files it.)
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
};

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
 * @param {number}  [opts.maxSeconds] the LONGEST TTL this driver arms. Omit for a
 *                                    count-bounded lever, which has no window of its own.
 * @param {string}  [opts.defaultEnv] where `--env` lands when omitted (default "staging").
 * @param {boolean} [opts.requireAck] force the shared-dev refusal even with no faults.
 * @param {string}  [opts.script]     script name for the usage lines (defaults to argv[1])
 * @returns {{ envName: string, hookUrl: string, envId: string, urlVar: string,
 *            shared: boolean, acknowledged: boolean }}
 */
export function requireEnvAck(argv, { faults, maxSeconds, defaultEnv = "staging", requireAck = false, script } = {}) {
  if (!Array.isArray(faults)) {
    throw new Error(
      "requireEnvAck: name the faults this driver arms (`faults: []` if it arms none) — an unnamed blast radius is the defect F-686 is about"
    );
  }
  if (!Object.prototype.hasOwnProperty.call(ENVS, defaultEnv)) {
    throw new Error(`requireEnvAck: defaultEnv "${defaultEnv}" is not one of ${ENV_NAMES.join(", ")}`);
  }
  const name = script || (process.argv[1] || "").split("/").pop() || "this-driver.mjs";
  const envName = arg(argv, "env", defaultEnv);

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
      `  node scripts/${name} --env=${defaultEnv}`,
      `      # ${defaultEnv}, which is also where --env lands when it is omitted`,
    ]);
  }

  const row = ENVS[envName];
  const acknowledged = flag(argv, "i-know-dev-is-shared");
  const wantsAck = requireAck || faults.length > 0;

  if (row.shared && wantsAck && !acknowledged) {
    const windowLine = maxSeconds
      ? `each arming lasts up to ${maxSeconds}s in this driver`
      : "count-bounded, not time-bounded: armed until consumed or disarmed";
    die([
      "REFUSING to point this driver at the SHARED dev tenant without an explicit acknowledgement.",
      "",
      ...(faults.length
        ? [`While it runs it arms REAL, user-visible faults on that site (${windowLine}):`, ...faults.map(harmLine)]
        : ["It arms no faults, but it drives the shared dev tenant and other people are on it."]),
      "",
      "Every lever is disarmed in a finally — but NOT if this process is KILLED; the only bound",
      "then is the 300s family ceiling. Nothing in the evidence file or the terminal would ever",
      "tell the admin who just rotated a good key that a harness lever was live at that moment.",
      "Schedule the run, or tell whoever is on the tenant — do not discover it afterwards.",
      "",
      `  node scripts/${name}`,
      `      # ${defaultEnv}, the default`,
      `  node scripts/${name} --env=dev --i-know-dev-is-shared`,
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

export { FAULT_HARMS, ENVS, ENV_NAMES };
