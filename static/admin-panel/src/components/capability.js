/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * F-436 — THE CODER CAPABILITY READ, WITH A WAY BACK FROM A TRANSPORT FAILURE.
 *
 * Every surface that asks `getAgentCapability` used to collapse two different things into
 * one value: "this instance cannot run the Coder" (an ANSWER) and "the question never got
 * through" (NO answer). Both were stored as `{ enabled: false, reason: "unknown" }`, and
 * because the fetching effect guarded on `|| coderCapability`, that stored non-answer was
 * truthy — so the read never happened again for the life of the iframe. One timed-out
 * request bricked the premade post-function editor on an instance where the Coder was
 * fully on, and the save refusal then asserted a cause the call had never returned
 * ("the Coder is off").
 *
 * So this helper keeps the two apart:
 *   status "loading" — asking, or waiting out a backoff. Refuse a save, do not explain why.
 *   status "unknown" — the read failed and the retries are spent. The instance's capability
 *                      is NOT KNOWN: say exactly that, offer `retry()`, and never say off.
 *   status "verdict" — the backend answered. `verdict` is its response, verbatim; the
 *                      caller decides what `enabled`/`reason` (or a refusal shape) means.
 *
 * The direction of the gate does NOT change (LAW 3): anything that is not an enabled
 * verdict still refuses the save, because an unanswered question is not a yes. What
 * changes is that the question gets asked again — three times on a 2 s / 4 s / 8 s ladder,
 * and on demand from a button — and that the words match what actually happened.
 *
 * A RESOLVED response is an answer even when `success` is false: that is the backend
 * speaking (a permission refusal, an upgrade-required body), and retrying it would just
 * ask a settled question three more times. Only a throw, or a body that is not an object
 * carrying a usable `success`, is transport.
 *
 * SELF-CONTAINED by the duplication convention: no imports from App.js, and `invoke` is a
 * parameter rather than a module import so the admin panel (which passes its own) and the
 * workflow editor (which imports the bridge) can share one file byte for byte.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/* Three retries after the first attempt. The backend's provider/config read is TTL-cached
   (~30 s), so a retry costs the instance nothing; the ladder is about outlasting a flaky
   connection, not about rate. */
export const CAPABILITY_RETRY_DELAYS_MS = [2000, 4000, 8000];

/* ONE wording, every surface — the same discipline AGENT_CAPABILITY_REASONS applies to the
   verdicts. The title is deliberately about the READ, not about the Coder: the one thing
   this state knows is that it does not know. */
export const CAPABILITY_UNKNOWN_TITLE = "Could not check whether the Coder is available";
export const CAPABILITY_UNKNOWN_TEXT =
  "The check did not come back. That says nothing about whether the Coder is on - it means the question never got an answer. Retry, or reopen this screen once the connection is back.";
export const CAPABILITY_CHECKING_TITLE = "Checking whether the Coder is available";
export const CAPABILITY_RETRY_LABEL = "Retry the check";

/**
 * Was this an ANSWER? Returns the response when it is one, null when it is transport.
 * Exported so a test can pin the classification without driving a browser.
 */
export function capabilityAnswer(res) {
  if (!res || typeof res !== "object") return null;
  if (res.success === true) return res;
  // A structured "no" from the backend (permission refusal, upgrade required) is an answer.
  if (res.success === false && (res.code || res.error || res.reason)) return res;
  return null;
}

/**
 * useAgentCapability(invoke, active) -> { status, verdict, retry }
 *
 * `active` gates the read so a surface that has no use for the verdict never provokes one.
 * Flipping it off and on again re-asks, which is correct: the admin may have fixed the
 * provider in another tab.
 */
export function useAgentCapability(invoke, active) {
  const [state, setState] = useState({ status: "loading", verdict: null });
  const [nonce, setNonce] = useState(0);
  // The generation token: only the newest ladder may write state (the same rule every
  // other long async flow in this app follows).
  const genRef = useRef(0);
  const timerRef = useRef(null);
  const mountedRef = useRef(true);
  /* `invoke` lives in a ref rather than in the dependency array: the admin panel passes it
     as a prop, and a caller that re-created it every render would otherwise restart the
     ladder on every keystroke. */
  const invokeRef = useRef(invoke);
  invokeRef.current = invoke;

  useEffect(() => () => {
    mountedRef.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    const token = ++genRef.current;
    const alive = () => mountedRef.current && genRef.current === token;
    setState({ status: "loading", verdict: null });

    const settleOrRetry = (tryIndex) => {
      const delay = CAPABILITY_RETRY_DELAYS_MS[tryIndex];
      if (delay === undefined) { if (alive()) setState({ status: "unknown", verdict: null }); return; }
      timerRef.current = setTimeout(() => { if (alive()) attempt(tryIndex + 1); }, delay);
    };
    const attempt = (tryIndex) => {
      Promise.resolve()
        .then(() => invokeRef.current("getAgentCapability"))
        .then((res) => {
          if (!alive()) return;
          const answer = capabilityAnswer(res);
          if (answer) { setState({ status: "verdict", verdict: answer }); return; }
          settleOrRetry(tryIndex);
        })
        .catch(() => { if (alive()) settleOrRetry(tryIndex); });
    };
    attempt(0);

    return () => {
      // Bumping the token is what stops an in-flight promise writing into a dead surface;
      // the timer is cleared so a pending backoff does not fire after unmount.
      genRef.current++;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [active, nonce]);

  // The button. Restarts the ladder from the top, which is what a reader who has just
  // fixed their connection means by "retry".
  const retry = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setNonce((n) => n + 1);
  }, []);

  return { status: state.status, verdict: state.verdict, retry };
}
