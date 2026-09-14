/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * THE ERROR CLASS, ONE HOME.
 *
 * `errorClassOf` existed twice — src/test-hook.js and src/async-handler.js each carried a
 * byte-similar copy — and F-833 was about to add a third in src/coder-workspace.js. Two
 * copies of one rule is a defect waiting to diverge, three is a guarantee, so the rule
 * moved here and all of them import it. Dependency-free on purpose: this module is loaded
 * by the backend, by the async consumer and by offline tests, and must never drag @forge/*
 * in with it.
 *
 * WHAT THE CLASS IS FOR. It is the SHORT, loggable name of what threw — `code` when the
 * thrower supplied one (Forge KVS does), otherwise `name` ("TypeError", "ForgeKvsError"),
 * otherwise "Error". It is never the message: messages carry issue keys, ids and user text
 * and are clamped separately at the call site.
 */
export const errorClassOf = (e) =>
  (e && (e.code || e.name) ? String(e.code || e.name) : "Error").slice(0, 60);

/**
 * The KVS error codes the platform and the offline mock actually emit. Read from
 * node_modules/@forge/kvs/out/errors.js and the mock that mirrors it
 * (test-harness/lib/mock-kvs.mjs). A code NOT in this list is still a storage fault when
 * the error carries a ForgeKvs name — the list is an accelerator, not the whole test.
 */
const STORAGE_CODES = new Set([
  "INVALID_KEY",
  "INVALID_CURSOR",
  "STORAGE_LIMIT_EXCEEDED",
  "KEY_ALREADY_EXISTS",
  "CONDITIONAL_REQUEST_FAILED",
]);

/**
 * IS THIS A STORAGE FAULT RATHER THAN A NETWORK ONE?
 *
 * The distinction is not cosmetic. A storage fault means the app could not keep its own
 * bookkeeping — a KVS API error, or a TypeError because the storage handle is not what the
 * code expected (a missing `set`, which is precisely how F-833 hid: the throw was
 * classified "network" and the whole write group was written off as "Jira was unreachable"
 * while the real answer was "there is no store here"). A network fault means the remote
 * product was unreachable. They point at different repairs, so they must not share a name.
 *
 * True for: any `ForgeKvsError`/`ForgeKvsAPIError` (note the subclass does NOT override
 * `name`, so both read "ForgeKvsError"), any known KVS code, and any TypeError that is not
 * the fetch stack's own — a TypeError raised by a storage call is a broken handle, never a
 * socket, but see `isNetworkFault` for the one TypeError that IS a socket.
 */
export const isStorageFault = (e) => {
  if (!e) return false;
  const name = String(e.name || "");
  if (name.startsWith("ForgeKvs")) return true;
  if (e.code && STORAGE_CODES.has(String(e.code))) return true;
  if (name !== "TypeError") return false;
  // F-856: node 22 / undici raises a bare `TypeError: fetch failed` for EVERY DNS, TLS and
  // connection error, so the un-narrowed `name === "TypeError"` that used to end this
  // function labelled a Jira network blip a fault in OUR OWN bookkeeping, and sent the
  // reader to the wrong repair. Only a TypeError that is not the fetch stack's is storage.
  return !isNetworkFault(e);
};

/**
 * The node/undici error codes that mean "the remote was not reachable" rather than "our
 * store broke". `UND_ERR_*` is undici's own family (connect timeout, socket, headers
 * timeout); the rest are node's classic socket codes. They are read off the `cause` chain
 * because undici's public throw is a bare `TypeError("fetch failed")` with the real reason
 * hung underneath it.
 */
const NETWORK_CODES = new Set([
  "ENOTFOUND",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ECONNABORTED",
  "EPIPE",
  "EPROTO",
]);

const isNetworkCode = (code) => {
  if (!code) return false;
  const c = String(code);
  return NETWORK_CODES.has(c) || c.startsWith("UND_ERR");
};

/**
 * IS THIS A NETWORK FAULT? (F-856)
 *
 * Asks BOTH questions, because the fetch stack answers neither on its own: the message
 * ("fetch failed" is undici's one public wording) and the `cause` chain's `code`, which is
 * where the real reason lives. `AggregateError`-style `errors[]` is walked too, because a
 * multi-address DNS result fails as a list of ECONNREFUSEDs.
 *
 * A TypeError out of a broken storage handle ("store.set is not a function") answers false
 * here and stays a storage fault — that is the F-833 distinction, and keeping it is the
 * whole point of narrowing rather than deleting the TypeError rule.
 *
 * The chain is walked with a depth cap: `cause` can be self-referential.
 */
export const isNetworkFault = (e) => {
  if (!e) return false;
  if (String((e && e.message) || "").toLowerCase().includes("fetch failed")) return true;
  let cur = e;
  for (let depth = 0; cur && depth < 5; depth++) {
    if (isNetworkCode(cur.code)) return true;
    if (Array.isArray(cur.errors) && cur.errors.some((x) => x && isNetworkCode(x.code))) return true;
    cur = cur.cause;
  }
  return false;
};
