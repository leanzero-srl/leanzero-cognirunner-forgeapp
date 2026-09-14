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
 * `name`, so both read "ForgeKvsError"), any known KVS code, and any TypeError — a
 * TypeError raised by a storage call is a broken handle, never a socket.
 */
export const isStorageFault = (e) => {
  if (!e) return false;
  const name = String(e.name || "");
  if (name.startsWith("ForgeKvs")) return true;
  if (e.code && STORAGE_CODES.has(String(e.code))) return true;
  return name === "TypeError";
};
