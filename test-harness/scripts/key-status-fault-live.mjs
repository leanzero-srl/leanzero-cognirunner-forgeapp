/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * F-629 — THE KEY-STATUS FAILURE, LIVE.
 *
 * F-603: `loadProviderConfig` wrote `hasKey`/`noKeyNeeded`/`isByok` only inside
 * `if (keyResult.success)`, so a FAILED `getOpenAIKey` left the previous provider's values
 * standing — the managed engine's "ready, no key needed" green state rendered for a BYOK
 * provider, with no key input at all. The fix clears the triple on every load. But
 * `getOpenAIKey` is a KVS read plus a provider switch: nothing a tester can do from
 * outside makes it fail, so the fix was render-proven (editions.test.mjs E4b3, against the
 * real OpenAIConfig.jsx) and live-UNPROVEN.
 *
 * `armKeyReadFault` is the door. This driver arms it, asks the REAL resolver both ways,
 * disarms and asks again. It asserts the RESOLVER's answers, which is the contract the
 * card is built on; the rendering of that answer is E4b3's job and stays there.
 *
 * NOTHING IS CONFIGURED AND NO KEY IS TOUCHED. The lever is keyed by provider id, accepts
 * no key material and returns none; the provider's own KVS slot is read before and after
 * through `?what=kvs` and must be byte-identical. The lever is TTL-bounded (five minutes
 * maximum) and is disarmed in the `finally` anyway, proven gone by a re-read.
 *
 * MANUAL ARM: pass `--hold=N` to leave the fault armed for N seconds after the checks, so
 * an operator can open Apps -> CogniRunner -> Settings and READ the card in the state F-603
 * is about. The fault expires on its own whatever happens.
 *
 * SHARED DEV TENANT (F-686). `--env` defaults to `staging`; `--env=dev` additionally needs
 * `--i-know-dev-is-shared`, because `armKeyReadFault` on the shared site makes an admin who
 * happens to be in Settings read a PLANTED refusal as a bad credential and rotate a working
 * key. The refusal and its wording live in lib/shared-env-guard.mjs — one home, four drivers.
 *
 * Usage (from test-harness/):  node scripts/key-status-fault-live.mjs [--env=staging|dev]
 *   [--i-know-dev-is-shared] [--provider=openai] [--hold=0]
 * Env: STAGING_TESTSTATE_URL (or TESTSTATE_URL) + HARNESS_SECRET + HARNESS_ADMIN_ACCOUNT_ID.
 * Nothing secret is printed: not the secret, not the trigger URL, not a key or its length.
 */
import fs from "node:fs";
import { requireEnv } from "../lib/env.mjs";
// F-686 — the shared-dev acknowledgement has ONE home; this driver arms the very lever
// F-679's refusal was written about, so it goes through the same door.
import { requireEnvAck } from "../lib/shared-env-guard.mjs";
// The slot NAME has ONE home (src/shared/provider-slots.js). A retyped
// "COGNIRUNNER_KEY_openai" here would silently rot the day a helper changes.
import { providerKeySlot } from "../../src/shared/provider-slots.js";

const arg = (n, d) => { const h = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const PROVIDER = arg("provider", "openai");
/* THE LONGEST WINDOW THIS DRIVER ARMS is the family ceiling, not the 120s of step 1: step
 * "TTL clamp" deliberately asks for 99999s and lets the server clamp it, so the honest
 * number to put in front of an operator is the cap itself. `--hold=N` (≤300) can hold the
 * refusing lever for an operator to read the card, which lands at the same place. */
const { envName: ENV_NAME, hookUrl: HOOK_URL } = requireEnvAck(process.argv.slice(2), {
  faults: [`keyRead:${PROVIDER}`],
  mutates: [],   /* the lever is the whole blast radius: every store read here is a READ */
  maxSeconds: 300,
  script: "key-status-fault-live.mjs",
});
const SECRET = requireEnv("HARNESS_SECRET");
const ADMIN = requireEnv("HARNESS_ADMIN_ACCOUNT_ID");
const OTHER = PROVIDER === "atlassian" ? "openai" : "atlassian";
const HOLD = Math.max(0, Math.min(300, Number(arg("hold", "0")) || 0));
const OUT = new URL("../results/key-status-fault", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passes = 0, fails = 0, unproven = 0;
const ev = { at: new Date().toISOString(), env: ENV_NAME, provider: PROVIDER, checks: [] };
const PASS = (s, d) => { passes++; ev.checks.push({ v: "PASS", s, ...(d ? { d } : {}) }); console.log(`  PASS  ${s}${d ? " " + JSON.stringify(d) : ""}`); };
const FAIL = (s, d) => { fails++; ev.checks.push({ v: "FAIL", s, ...(d ? { d } : {}) }); console.log(`  FAIL  ${s}${d ? " " + JSON.stringify(d) : ""}`); };
const NV = (s, d) => { unproven++; ev.checks.push({ v: "N/V", s, ...(d ? { d } : {}) }); console.log(`  N/V   ${s}${d ? " " + JSON.stringify(d) : ""}`); };
const info = (s) => console.log(`        ${s}`);

const readRes = async (res) => {
  let text = ""; try { text = await res.text(); } catch (e) { return { status: 0, json: null, raw: e.message }; }
  let json = null; try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, json, raw: json ? null : text.slice(0, 300) };
};
async function hook(body, method = "POST", qs = "") {
  if (!HOOK_URL) throw new Error(`no web-trigger URL for environment "${ENV_NAME}"`);
  return readRes(await fetch(HOOK_URL + qs, {
    method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + SECRET },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  }));
}
const invoke = async (functionKey, payload = {}, accountId = ADMIN) =>
  hook({ action: "invokeResolver", functionKey, payload, accountId });
/** The KEY SLOT, reduced to a FINGERPRINT. Never the value, never its length. */
const keySlotFingerprint = async (provider) => {
  const r = await hook(null, "GET", `?what=kvs&key=${encodeURIComponent(providerKeySlot(provider))}`);
  const v = r.json ? r.json.value : undefined;
  return v === null || v === undefined ? "EMPTY" : "PRESENT";
};
const getKey = (provider) => invoke("getOpenAIKey", { provider });
const arm = (mode, ttlSeconds) => hook({ action: "armKeyReadFault", provider: PROVIDER, mode, ttlSeconds });
const disarm = () => hook({ action: "disarmKeyReadFault", provider: PROVIDER });
const readLever = () => hook({ action: "readKeyReadFault", provider: PROVIDER });

async function main() {
  console.log(`\nF-629 — the key-status failure, on ${ENV_NAME.toUpperCase()}, provider ${PROVIDER}\n`);
  const ping = await hook(null, "GET");
  if (ping.status !== 200) throw new Error(`the hook is not reachable on ${ENV_NAME} (GET -> ${ping.status})`);
  PASS(`hook reachable on ${ENV_NAME}, secret accepted`);

  const slotBefore = await keySlotFingerprint(PROVIDER);
  info(`the ${PROVIDER} key slot is ${slotBefore} before anything (fingerprint only — no value is read into this script)`);

  try {
    /* ── STEP 0 — the CONTROL, on the SAME resolver and the same provider ──── */
    console.log("STEP 0 - with no lever armed, getOpenAIKey answers normally");
    const control = await getKey(PROVIDER);
    ev.control = control.json;
    if (control.json && control.json.success === true) {
      PASS("getOpenAIKey answers success:true - the control is a real read, not a resolver that was broken anyway", {
        provider: control.json.provider, hasKey: control.json.hasKey, isByok: control.json.isByok, noKeyNeeded: control.json.noKeyNeeded ?? null,
      });
    } else {
      FAIL("getOpenAIKey is ALREADY failing with no lever armed - nothing below would prove anything", { body: JSON.stringify(control.json).slice(0, 300) });
      return;
    }
    const lever0 = await readLever();
    if (lever0.json && lever0.json.value === null) PASS("…and no key-read fault is armed for this provider");
    else FAIL("a key-read fault is already armed", { value: lever0.json && lever0.json.value });

    /* ── STEP 1 — refuse: the {success:false} body F-603 is about ──────────── */
    console.log("\nSTEP 1 - mode:refuse - the failed key read the card must not paint green");
    const armed = await arm("refuse", 120);
    ev.armed = armed.json;
    if (armed.status === 200 && armed.json && armed.json.mode === "refuse") {
      PASS("the lever is armed", { key: armed.json.key, ttlSeconds: armed.json.ttlSeconds, maxTtlSeconds: armed.json.maxTtlSeconds });
    } else { FAIL("the lever would not arm", { status: armed.status, body: JSON.stringify(armed.json).slice(0, 300) }); return; }
    if (armed.json.key && !JSON.stringify(armed.json).toLowerCase().includes("sk-")) PASS("…and the answer carries the fault KEY and no key material");
    else FAIL("the arming answer looks like it carries key material");

    const refused = await getKey(PROVIDER);
    ev.refused = refused.json;
    const f = refused.json;
    if (f && f.success === false) PASS("getOpenAIKey now answers success:false - the exact body F-603's catch arm produces", { harnessFault: f.harnessFault === true });
    else FAIL("getOpenAIKey did not fail with the lever armed", { body: JSON.stringify(f).slice(0, 300) });
    // THE FIELD THE BUG IS ABOUT. A failed read must not assert readiness.
    if (f && f.noKeyNeeded !== true && f.hasKey !== true && f.isByok !== true) {
      PASS("…and it asserts NO readiness: noKeyNeeded, hasKey and isByok are all absent or false, so a card that clears its state on every load cannot paint 'nothing to paste here'", {
        noKeyNeeded: f.noKeyNeeded ?? null, hasKey: f.hasKey ?? null, isByok: f.isByok ?? null,
      });
    } else FAIL("the failure body asserts readiness - this is the F-603 shape leaking from the backend", { body: JSON.stringify(f).slice(0, 300) });

    const other = await getKey(OTHER);
    ev.other = other.json;
    if (other.json && other.json.success === true) {
      PASS(`…while ${OTHER}'s read still works - the lever is PER-PROVIDER, which is the F-603 sequence (one engine loads, the next one's read fails)`, { provider: other.json.provider });
    } else FAIL(`${OTHER}'s read broke too - the lever is not provider-scoped`, { body: JSON.stringify(other.json).slice(0, 200) });

    const again = await getKey(PROVIDER);
    if (again.json && again.json.success === false) PASS("…and a SECOND read still fails - the lever is a window, not a one-shot, so a whole panel load sees it");
    else FAIL("the second read succeeded - the lever was consumed", { body: JSON.stringify(again.json).slice(0, 200) });

    if (HOLD) {
      info(`--hold=${HOLD}: the fault stays armed. Open Apps -> CogniRunner -> Settings and select ${PROVIDER}.`);
      info("Expected: the API key INPUT is rendered, \"Couldn't read key status\" and a STATUS UNREAD chip appear,");
      info("and none of \"Managed by LeanZero\" / \"ready, no key needed\" / \"nothing to paste here\" / \"No key configured\".");
      await sleep(HOLD * 1000);
      NV("the RENDERED card was held for a human to read; this script does not grade pixels (editions.test.mjs E4b3 does)");
    }

    /* ── STEP 2 — throw: the rejected invoke ───────────────────────────────── */
    console.log("\nSTEP 2 - mode:throw - the other failure shape F-603 names");
    await disarm();
    const armedThrow = await arm("throw", 60);
    if (!(armedThrow.status === 200 && armedThrow.json.mode === "throw")) { FAIL("the throw lever would not arm", { body: JSON.stringify(armedThrow.json).slice(0, 200) }); }
    else {
      const thrown = await getKey(PROVIDER);
      ev.thrown = { status: thrown.status, json: thrown.json, raw: thrown.raw };
      // The hook wraps a thrown resolver in its own 500 — that IS the rejected invocation.
      if (thrown.status === 500 || (thrown.json && thrown.json.error)) {
        PASS("getOpenAIKey REJECTS rather than returning a body - the thrown-invoke arm", { status: thrown.status });
      } else FAIL("the throw lever did not make the resolver reject", { status: thrown.status, body: JSON.stringify(thrown.json).slice(0, 300) });
      const msg = JSON.stringify(ev.thrown);
      if (msg.includes("HarnessFault") || msg.includes("harness key-read fault")) PASS("…and the failure NAMES itself a harness fault, so a forge-logs reader never mistakes it for a product error");
      else NV("the thrown error did not surface a recognisable harness-fault name through the hook's 500", { raw: String(thrown.raw || "").slice(0, 160) });
      if (!msg.toLowerCase().includes("sk-")) PASS("…and carries no key material");
      else FAIL("the thrown error surfaced something key-shaped");
    }

    /* ── STEP 3 — the guards ───────────────────────────────────────────────── */
    console.log("\nSTEP 3 - the door accepts a provider, a mode and a TTL, and nothing else");
    const badMode = await hook({ action: "armKeyReadFault", provider: PROVIDER, mode: "explode" });
    if (badMode.status === 400) PASS("a mode outside {refuse, throw} is 400", { error: badMode.json && badMode.json.error });
    else FAIL("a bad mode was accepted", { status: badMode.status });
    const badProvider = await hook({ action: "armKeyReadFault", provider: "not-a-provider", mode: "refuse" });
    if (badProvider.status === 400) PASS("an unknown provider id is 400");
    else FAIL("an unknown provider was accepted", { status: badProvider.status });
    await disarm();
    const clamped = await hook({ action: "armKeyReadFault", provider: PROVIDER, mode: "refuse", ttlSeconds: 99999 });
    if (clamped.json && clamped.json.ttlSeconds === clamped.json.maxTtlSeconds) {
      PASS("a TTL above the cap is clamped server-side", { ttlSeconds: clamped.json.ttlSeconds, cap: clamped.json.maxTtlSeconds });
    } else FAIL("the TTL was not clamped", { body: JSON.stringify(clamped.json).slice(0, 200) });
  } finally {
    /* ── RESTORE — and the SECOND read, which is what proves the first one ── */
    console.log("\nRESTORE");
    const d = await disarm();
    const lever = await readLever();
    ev.after = lever.json;
    if (lever.json && lever.json.value === null) PASS("the key-read fault is DISARMED - the same read that saw it above now sees nothing", { disarmed: d.json && d.json.disarmed });
    else FAIL("the lever survives the disarm", { value: lever.json && lever.json.value });

    const back = await getKey(PROVIDER);
    if (back.json && back.json.success === true) PASS("…and getOpenAIKey is back to normal - the resolver that failed above now works", { hasKey: back.json.hasKey, isByok: back.json.isByok });
    else FAIL("getOpenAIKey is still failing after the disarm", { body: JSON.stringify(back.json).slice(0, 300) });

    const slotAfter = await keySlotFingerprint(PROVIDER);
    if (slotAfter === slotBefore) PASS(`the ${PROVIDER} key slot is unchanged (${slotBefore} -> ${slotAfter}) - the lever never went near a credential`);
    else FAIL("the provider key slot changed across this run", { before: slotBefore, after: slotAfter });

    fs.writeFileSync(OUT + "/evidence.json", JSON.stringify(ev, null, 2));
    console.log(`\n${passes} pass, ${fails} fail, ${unproven} not verified. Evidence: ${OUT}/evidence.json`);
  }
}

await main();
process.exit(fails === 0 ? 0 : 1);
