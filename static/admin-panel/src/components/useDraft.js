/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { draftKey, serializeDraft, deserializeDraft, isDraftStale } from "../../../../src/shared/draft-state.js";

/**
 * THE CONTRACT (F-990). Read this before wiring a form.
 *
 * 1. A DRAFT IS A CONVENIENCE AND IT FAILS SILENT-OPEN. Every touch of localStorage is
 *    wrapped: a Custom UI iframe in a locked-down browser can throw on the FIRST access,
 *    quota can be full, and a stored string can be corrupt. None of that may take the
 *    admin panel down, and none of it is reported to the user. Losing a draft is a
 *    disappointment; a white screen because storage was disabled is a failure.
 *
 * 2. RESTORE IS ALWAYS AN EXPLICIT CLICK, NEVER AUTOMATIC. The hook does not touch your
 *    state. It hands you `draft` and `hasDraft`; you render the resume card and call
 *    `restore()` from its Continue button. Auto-filling would resurrect a week-old answer
 *    set into a form the admin opened to do something else, with no way to tell where the
 *    values came from.
 *
 * 3. WRITES ARE SUPPRESSED UNTIL THE DRAFT IS RESOLVED. This is the subtle one. If the
 *    hook began saving on mount, the form's PRISTINE initial state would overwrite the
 *    stored draft in the 500 ms before the admin had even read the card, and Continue
 *    would restore nothing. So nothing is written until either there was no draft to
 *    begin with, or the admin has clicked Continue or Discard.
 *
 * 4. IT WAITS FOR `accountId`. The panel sets it ASYNC (App.js `checkIsAdmin`), so it is
 *    null for the first render or several. `draftKey` refuses a null account, and a draft
 *    keyed on "null" would be shared by every admin on the machine and restored into the
 *    wrong session. Until the account arrives this hook reads nothing and writes nothing.
 *
 * 5. CALL `clear()` ON EVERY SUCCESSFUL SAVE PATH. A draft that survives its own form
 *    being submitted is the card offering to restore work that already exists, which
 *    reads as a bug and invites a duplicate.
 *
 * 6. NO POLICY LIVES HERE. Which fields are excluded, which key, which TTL, which version
 *    and which size are all `src/shared/draft-state.js`. This file is a debounce, a
 *    try/catch and a resolved/unresolved flag.
 *
 * Byte-identical copy in static/config-ui/src/components/useDraft.js.
 *
 * @param {string} formId   one of DRAFT_FORM_IDS
 * @param {string|null} accountId  from App.js; null until checkIsAdmin answers
 * @param {object} state    the form state to persist, pruned by serializeDraft
 * @param {boolean} enabled false parks the hook entirely (e.g. an EDIT of an existing row)
 */
const DEBOUNCE_MS = 500;

export function useDraft(formId, accountId, state, enabled = true) {
  const key = enabled ? draftKey(accountId, formId) : null;
  const [found, setFound] = useState(null);      // { data, savedAt } from storage, unresolved
  const resolvedRef = useRef(false);             // may we write yet?
  const baselineRef = useRef(null);              // the serialization of the state we armed on
  const readKeyRef = useRef(null);
  const timerRef = useRef(null);

  const remove = useCallback((k) => {
    try { if (k) window.localStorage.removeItem(k); } catch (e) { /* silent-open */ }
  }, []);

  /* READ, once per key. */
  useEffect(() => {
    if (!key || readKeyRef.current === key) return;
    readKeyRef.current = key;
    let raw = null;
    try { raw = window.localStorage.getItem(key); } catch (e) { raw = null; }
    const parsed = deserializeDraft(raw);
    if (parsed && !isDraftStale(parsed.savedAt)) {
      setFound(parsed);                 // unresolved: the card is up, writing stays off
    } else {
      if (parsed) remove(key);          // stale or foreign: it will never be offered, so drop it
      resolvedRef.current = true;       // nothing to lose, start saving
      baselineRef.current = serializeDraft(state);
    }
  }, [key, remove, state]);

  /* WRITE, debounced, and only once resolved and only once the form has actually moved. */
  useEffect(() => {
    if (!key || !resolvedRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const raw = serializeDraft(state);
      /* Back at the state we armed on (or nothing worth keeping) is not a draft: writing
         one would put the resume card in front of an admin who changed nothing. */
      if (!raw || raw === baselineRef.current) { remove(key); return; }
      try { window.localStorage.setItem(key, raw); } catch (e) { /* silent-open */ }
    }, DEBOUNCE_MS);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [key, state, remove]);

  const arm = useCallback(() => {
    resolvedRef.current = true;
    baselineRef.current = null;   // whatever happens next IS the draft
    setFound(null);
  }, []);

  const restore = useCallback(() => { const d = found ? found.data : null; arm(); return d; }, [found, arm]);
  const discard = useCallback(() => { remove(key); arm(); }, [key, remove, arm]);
  const clear = useCallback(() => { remove(key); resolvedRef.current = true; baselineRef.current = null; setFound(null); }, [key, remove]);

  return {
    draft: found ? found.data : null,
    hasDraft: !!found,
    savedAt: found ? found.savedAt : 0,
    restore,
    discard,
    clear,
  };
}

export default useDraft;
