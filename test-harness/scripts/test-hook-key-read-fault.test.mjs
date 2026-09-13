/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * F-629 — THE KEY-READ FAULT, AND THE RESOLVER IT IS ALLOWED TO BREAK.
 *
 * F-603 is a bug about what the provider settings card does when `getOpenAIKey` FAILS: a
 * stale `noKeyNeeded` paints a BYOK provider as "Managed by LeanZero — nothing to paste
 * here", with no key input rendered at all. The resolver is a KVS read plus a provider
 * switch, so nothing a tester can do from outside makes it answer `{success:false}` or
 * throw, and the fix could only ever be exercised against a mock.
 *
 * A lever that can break a product resolver is the most dangerous thing in this file, so
 * what this suite proves is mostly about when it must NOT work:
 *  · `getOpenAIKey` IS UNAFFECTED WHEN NO FAULT ROW EXISTS — the control, asserted on the
 *    same provider, before and after, so the positive below is not a resolver that was
 *    broken anyway;
 *  · IT IS INERT IN PRODUCTION. With HARNESS_SECRET absent the arming refuses, the mode
 *    read answers null, the hook is 404 — and a row armed while the gate was open stops
 *    being consulted the moment it closes, which is the property that matters: a lever
 *    left armed on a build that is then promoted must not follow it;
 *  · IT PLANTS AND RETURNS NO KEY. The body carries a provider, a mode and a TTL; the
 *    answers carry the fault key and never a slot value, and the fault keyspace is the
 *    only thing written;
 *  · THE MODE AND THE TTL ARE CLAMPED server-side, in the module that owns the lever;
 *  · IT IS PER-PROVIDER: arming openai leaves the managed engine's read working, which is
 *    exactly the F-603 sequence (managed loads, then the BYOK provider's read fails).
 *
 * Run: node scripts/test-hook-key-read-fault.test.mjs (auto-discovered by run-offline.mjs)
 */

import "../lib/register-mocks-index.mjs";
import storage from "../lib/mock-kvs.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const SECRET = "harness-secret-629";
const { testStateTrigger } = await import("../../src/test-hook.js");
const { handler } = await import("../../src/index.js");
const fault = await import("../../src/harness-fault.js");
const { providerKeySlot } = await import("../../src/shared/provider-slots.js");

const post = async (body, { bearer = SECRET } = {}) => {
  const res = await testStateTrigger({
    method: "POST",
    headers: bearer === null ? {} : { authorization: `Bearer ${bearer}` },
    body: JSON.stringify(body),
  });
  let parsed = null; try { parsed = JSON.parse(res.body); } catch { /* text */ }
  return { status: res.statusCode, body: parsed, raw: res.body };
};
// F-633 put a viewer floor on `getOpenAIKey`, and this suite is about what the door does
// BELOW that floor — so the caller has to be on the roster to reach the lever at all.
storage.__seed("app_admins", [{ accountId: "acct-admin", role: "admin", scope: "all" }]);

const getKey = (provider) => handler({ call: { functionKey: "getOpenAIKey", payload: { provider } } }, { principal: { accountId: "acct-admin" } });
const arm = (extra) => post({ action: "armKeyReadFault", provider: "openai", mode: "refuse", ttlSeconds: 60, ...extra });
const disarm = (provider = "openai") => post({ action: "disarmKeyReadFault", provider });
const readLever = (provider = "openai") => post({ action: "readKeyReadFault", provider });

// A real BYOK key, so "the resolver works" is a positive answer and not an empty store.
await storage.set(providerKeySlot("openai"), "sk-a-real-looking-byok-key");

/* ═════ 1. THE CONTROL — the resolver is fine with no lever ═════ */
process.env.HARNESS_SECRET = SECRET;
{
  const r = await getKey("openai");
  ok(r && r.success === true && r.hasKey === true && r.isByok === true,
    `with NO fault row getOpenAIKey answers normally (got ${JSON.stringify(r)})`);
  ok(r.noKeyNeeded === undefined, "…and a BYOK provider carries no noKeyNeeded — the field F-603 is about");
  ok((await readLever()).body.value === null, "…and there really is no lever armed (the control is a real read)");
}

/* ═════ 2. THE GATE ═════ */
process.env.HARNESS_SECRET = "";
{
  ok((await arm()).status === 404, "with NO HARNESS_SECRET configured the whole hook is 404");
  const armed = await fault.armKeyReadFault("openai", "refuse", 60);
  ok(armed && armed.ok === false && armed.reason === "harness-off", "…and the lever itself refuses harness-off even if something else calls it");
  ok((await fault.keyReadFaultMode("openai")) === null, "…and the consuming side answers null in production");
}
process.env.HARNESS_SECRET = SECRET;
{
  const none = await post({ action: "armKeyReadFault", provider: "openai", mode: "refuse" }, { bearer: null });
  ok(none.status === 404, `no bearer -> 404 (got ${none.status})`);
  const wrong = await post({ action: "armKeyReadFault", provider: "openai", mode: "refuse" }, { bearer: "not-the-secret" });
  ok(wrong.status === 404, `a wrong bearer -> 404 (got ${wrong.status})`);
  ok((await fault.keyReadFaultMode("openai")) === null, "…and neither refused call armed anything");
}

/* ═════ 3. THE INPUT GUARDS ═════ */
{
  ok((await post({ action: "armKeyReadFault", provider: "not-a-provider", mode: "refuse" })).status === 400, "an unknown provider is 400");
  ok((await post({ action: "armKeyReadFault", provider: "openai", mode: "explode" })).status === 400, 'a mode outside {refuse, throw} is 400');
  ok((await post({ action: "armKeyReadFault", provider: "openai" })).status === 400, "a missing mode is 400");
  ok((await fault.keyReadFaultMode("openai")) === null, "…and none of those refusals armed anything");
}

/* ═════ 4. refuse — the {success:false} arm ═════ */
{
  const armed = await arm({ mode: "refuse", ttlSeconds: 60 });
  ok(armed.status === 200 && armed.body.mode === "refuse" && armed.body.ttlSeconds === 60,
    `arming answers the mode and the effective TTL (got ${armed.raw.slice(0, 160)})`);
  ok(typeof armed.body.key === "string" && armed.body.key.startsWith("harness_fault:key-read:"),
    `…on the fault keyspace, from harnessFaultKey (got ${armed.body.key})`);
  ok(!JSON.stringify(armed.body).includes("sk-"), "…and the answer carries no key material at all");

  const r = await getKey("openai");
  ok(r && r.success === false && r.hasKey === false && r.isByok === false,
    `getOpenAIKey now answers the {success:false} body F-603 is about (got ${JSON.stringify(r)})`);
  ok(r.harnessFault === true, "…flagged as a planted fault, so a log reader can tell it from a real one");

  // PER-PROVIDER: the other engine is untouched. This IS the F-603 sequence.
  const managed = await getKey("atlassian");
  ok(managed && managed.success === true && managed.noKeyNeeded === true,
    `…while another provider's read still works (got ${JSON.stringify(managed)})`);

  // NON-CONSUMING: the window bounds it, not a count.
  const again = await getKey("openai");
  ok(again && again.success === false, "…and a SECOND read still fails — the lever is a window, not a one-shot");
  ok((await readLever()).body.value.mode === "refuse", "…the row is still armed after two reads");
}

/* ═════ 5. IT IS INERT THE MOMENT THE GATE CLOSES ═════ */
{
  process.env.HARNESS_SECRET = "";
  const r = await getKey("openai");
  ok(r && r.success === true && r.hasKey === true,
    `with the row STILL ARMED but HARNESS_SECRET absent, getOpenAIKey works normally again (got ${JSON.stringify(r)})`);
  process.env.HARNESS_SECRET = SECRET;
  ok((await getKey("openai")).success === false, "…and the same row bites again when the gate reopens — it was the gate, not an expiry");
}

/* ═════ 6. throw — the rejected-invoke arm ═════ */
{
  await disarm();
  await arm({ mode: "throw", ttlSeconds: 30 });
  let threw = null;
  try { await getKey("openai"); } catch (e) { threw = e; }
  ok(threw !== null, "with mode:throw the invocation REJECTS rather than returning a body");
  ok(threw && threw.harnessFault === true && threw.name === "HarnessFault",
    `…with the NAMED fault class, so nothing downstream mistakes it for a product error (got ${threw && threw.name})`);
  ok(!String(threw && threw.message).includes("sk-"), "…and the message carries no key material");
}

/* ═════ 7. THE TTL CLAMP ═════ */
{
  await disarm();
  const huge = await arm({ mode: "refuse", ttlSeconds: 99999 });
  ok(huge.body.ttlSeconds === fault.HARNESS_KEY_READ_FAULT_MAX_TTL_SECONDS,
    `a TTL above the cap is clamped to ${fault.HARNESS_KEY_READ_FAULT_MAX_TTL_SECONDS}s (got ${huge.body.ttlSeconds})`);
  await disarm();
  const tiny = await arm({ mode: "refuse", ttlSeconds: 0 });
  ok(tiny.body.ttlSeconds >= 1, `a TTL of zero is clamped up, never to "forever" (got ${tiny.body.ttlSeconds})`);
  await disarm();
  const none = await post({ action: "armKeyReadFault", provider: "openai", mode: "refuse" });
  ok(none.body.ttlSeconds === fault.HARNESS_KEY_READ_FAULT_MAX_TTL_SECONDS, "an absent TTL defaults to the cap, not to unbounded");
}

/* ═════ 8. IT WRITES NOTHING BUT THE FAULT KEY ═════ */
{
  await disarm();
  const real = { get: storage.get, set: storage.set, delete: storage.delete };
  const touched = [];
  const spy = (name) => async function counting(k, ...rest) { touched.push(`${name} ${k}`); return real[name].call(this, k, ...rest); };
  storage.get = spy("get"); storage.set = spy("set"); storage.delete = spy("delete");
  await arm({ mode: "refuse", ttlSeconds: 60 });
  storage.get = real.get; storage.set = real.set; storage.delete = real.delete;
  const writes = touched.filter((t) => t.startsWith("set ") || t.startsWith("delete "));
  ok(writes.length === 1 && writes[0].includes("harness_fault:key-read:openai"),
    `arming writes exactly ONE key, on the fault keyspace (got ${JSON.stringify(writes)})`);
  ok((await storage.get(providerKeySlot("openai"))) === "sk-a-real-looking-byok-key",
    "…and the provider's own key slot is untouched — the lever never goes near a credential");
}

/* ═════ 9. DISARM, AND THE CONTROL AGAIN ═════ */
{
  const d = await disarm();
  ok(d.status === 200 && d.body.disarmed === true, "disarm removes the lever and says so");
  ok((await readLever()).body.value === null, "…the row is gone");
  const r = await getKey("openai");
  ok(r && r.success === true && r.hasKey === true && r.isByok === true,
    `…and getOpenAIKey is back to normal — the same read that failed above now works (got ${JSON.stringify(r)})`);
}

console.log(`test-hook-key-read-fault (F-629): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
