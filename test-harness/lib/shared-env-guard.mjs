/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */
/* ═══════════════════════════════════════════════════════════════════════════════
 * F-686 — ONE HOME FOR THE SHARED-TENANT ACKNOWLEDGEMENT.
 *
 * F-679 put a `--i-know-dev-is-shared` refusal in `harness-fault-expiry-live.mjs`, and it
 * was RIGHT: arming `armKeyReadFault`/`armJiraFault` on the shared dev tenant makes an
 * admin who happens to be in Settings read a PLANTED refusal as a bad credential and
 * rotate a working key. But the refusal lived INLINE in one file, and three siblings armed
 * the very same levers on the very same tenant with nothing but `--env=dev`:
 * `key-status-fault-live.mjs`, `key-status-fault-ui-live.mjs` (240 s — 48x the guarded
 * driver's window, and it drives the real admin page) and `user-search-fault-live.mjs`
 * (dev as its ONLY mode, no `--env` at all). A guard with one home and four subjects is
 * not a guard; it is a comment that happens to exit.
 *
 * So the refusal is a LIBRARY now, and the directory rule in
 * `scripts/evidence-redaction.test.mjs` ("any *-live.mjs that arms a fault must import
 * requireEnvAck") is what stops the next driver from being written without it: a fifth
 * fault driver with an inline copy fails `npm run test:offline`.
 *
 * CONTRACT
 *   const { envName, hookUrl } = requireEnvAck(process.argv.slice(2), {
 *     faults: ["keyRead:openai", "jiraUserSearch"],   // what this driver ARMS
 *     maxSeconds: 240,                                // the LONGEST TTL it arms
 *   });
 *
 *   - `--env` defaults to `staging`. The shared tenant is never what you get by
 *     forgetting an argument.
 *   - `--env=dev` without `--i-know-dev-is-shared` prints the blast radius OF THE FAULTS
 *     THIS DRIVER NAMES, with this driver's own longest window, and exits 2.
 *   - It returns the web-trigger URL for the chosen environment — `TESTSTATE_URL` for dev,
 *     `STAGING_TESTSTATE_URL` for staging — so no driver re-decides that mapping.
 *
 * WHY THE REFUSAL RUNS BEFORE `loadEnv()`. `loadEnv` THROWS when there is no `.env`
 * (lib/env.mjs). If the guard ran after it, `--env=dev` on an unconfigured machine would
 * die with "Missing .env" and the operator would learn nothing about the tenant — the
 * guard would be a courtesy for the configured and a surprise for everyone else. The argv
 * check therefore happens first, and the env file is only read once the environment is
 * settled.
 * ═══════════════════════════════════════════════════════════════════════════════ */
import { loadEnv } from "./env.mjs";

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

/**
 * Settle the environment for a driver that arms harness faults.
 *
 * @param {string[]} argv             process.argv.slice(2)
 * @param {object}   opts
 * @param {Array}    opts.faults      the levers this driver arms (keys of FAULT_HARMS,
 *                                    optionally `kind:param`, e.g. `keyRead:openai`)
 * @param {number}  [opts.maxSeconds] the LONGEST TTL this driver arms. Omit for a
 *                                    count-bounded lever, which has no window of its own.
 * @param {string}  [opts.script]     script name for the usage lines (defaults to argv[1])
 * @returns {{ envName: string, hookUrl: string|undefined, acknowledged: boolean }}
 */
export function requireEnvAck(argv, { faults = [], maxSeconds, script } = {}) {
  if (!Array.isArray(faults) || faults.length === 0) {
    throw new Error(
      "requireEnvAck: name the faults this driver arms — an unnamed blast radius is the defect F-686 is about"
    );
  }
  const envName = arg(argv, "env", "staging");
  const name = script || (process.argv[1] || "").split("/").pop() || "this-driver.mjs";
  const acknowledged = flag(argv, "i-know-dev-is-shared");

  if (envName === "dev" && !acknowledged) {
    const windowLine = maxSeconds
      ? `each arming lasts up to ${maxSeconds}s in this driver`
      : "count-bounded, not time-bounded: armed until consumed or disarmed";
    console.error([
      "",
      "REFUSING to point this driver at the SHARED dev tenant without an explicit acknowledgement.",
      "",
      `While it runs it arms REAL, user-visible faults on that site (${windowLine}):`,
      ...faults.map(harmLine),
      "",
      "Every lever is disarmed in a finally — but NOT if this process is KILLED; the only bound",
      "then is the 300s family ceiling. Nothing in the evidence file or the terminal would ever",
      "tell the admin who just rotated a good key that a harness lever was live at that moment.",
      "Schedule the run, or tell whoever is on the tenant — do not discover it afterwards.",
      "",
      `  node scripts/${name}`,
      `      # staging, the default`,
      `  node scripts/${name} --env=dev --i-know-dev-is-shared`,
      "",
    ].join("\n"));
    process.exit(2);
  }

  /* Settled. Only NOW is the env file allowed to have an opinion. */
  const env = loadEnv();
  const hookUrl = envName === "dev" ? env.TESTSTATE_URL : env.STAGING_TESTSTATE_URL;
  return { envName, hookUrl, acknowledged };
}

export { FAULT_HARMS };
