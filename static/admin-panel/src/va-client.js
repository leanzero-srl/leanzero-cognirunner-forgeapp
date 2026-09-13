/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * THE VIRTUAL ADMINISTRATOR'S ONE SEAM TO THE BACKEND (release 1.5, commit 5c).
 *
 * Every resolver the Agents tab talks to is named HERE and nowhere else. The tab, the
 * wizard, the classic form and the status surfaces all call these functions, so a resolver
 * rename is one edit in one file rather than a grep across four components that each spelled
 * the name themselves. That matters more than usual this time: the backend half (commit 5b)
 * is being cut in parallel against the FRAME's names, and a UI that scattered those names
 * would have no single place to reconcile a drift.
 *
 * IT DECIDES NOTHING. No clamping, no validation, no defaulting of a record - the wizard's
 * brain is `src/shared/va-wizard.js` and the record's clamps are `normalizeVa`. What this
 * module does is name a resolver, pass a payload, and answer with whatever came back. The
 * ONE liberty it takes is turning a THROWN invoke into a resolved refusal shape
 * (`{success:false, error, threw:true}`), because a transport fault and a resolver's own
 * "no" are different things and every caller here has to render both; `threw` is how a
 * caller tells them apart (see `refusal.js` for the permission half of that contract).
 *
 * SHAPES THE BACKEND MUST MATCH (docs/FRAME-1.5-va-confluence.md, commit 5):
 *   vaWizardStep({input})  -> the `stepWizard` result: {success, turn:{state, stepId, field,
 *                             ask, prompt, options, extras, refused, notes, done, sample?,
 *                             summary?, guardrailSentences?, preview?, va?, created?,
 *                             fallbackToForm?, record?}}. The resolver owns the catalogue
 *                             and persists `va_wizard:{accountId}`; the UI keeps no state.
 *   vaWizardReset()        -> {success}
 *   saveScheduledJob({job:{mode:"va", va, ...}}) -> the existing job save answer {success, job}
 *   listVaAgents()         -> {success, agents:[job row + {va}]}
 *   getVaStatus({jobId})   -> {success, lastTick, staged, nextTick, nextPostWindow, shadow,
 *                             paused, health, receipts:[...]}
 *   listVaDrafts({jobId})  -> {success, drafts:[...]}   (shadow mode staging table)
 *   approveVaDraft / rejectVaDraft({jobId, itemKey, stagedAt}) -> {success}
 *   listVaEffects({jobId}) -> {success, effects:[...], items:[...]}
 *   getVaMemory({jobId})   -> {success, memory, constraints:[...], bytes, capBytes}
 *   saveVaMemory({jobId, memory, constraints}) -> {success, bytes} | a named refusal
 *   pauseVa / resumeVa({jobId}) -> {success, paused}
 *   runVaTickNow / runVaPostNow({jobId}) -> {success, taskId} (polled by getAsyncTaskResult)
 */

/** One call. A throw becomes a refusal shape; nothing else is interpreted. */
const call = async (invoke, name, payload) => {
  try {
    const r = await invoke(name, payload);
    return r && typeof r === "object" ? r : { success: false, error: `${name} answered nothing.` };
  } catch (e) {
    return { success: false, threw: true, error: (e && e.message) || String(e) };
  }
};

/**
 * Bind the client to this app's `invoke`. Every component takes the bound object rather than
 * `invoke` itself, which is what keeps the resolver names unreachable from a component.
 */
export const createVaClient = (invoke) => ({
  wizardStep: (input) => call(invoke, "vaWizardStep", { input }),
  wizardReset: () => call(invoke, "vaWizardReset", {}),
  /* The classic form needs the WHOLE catalogue at once, where a wizard turn carries only
     the current step's slice. Same data, same resolver family: `{success, catalog:
     {projects:[{key,name}], serviceDesks:[{id,name,queues:[{id,name}]}], timeZones:[],
     skillIndex:[{id,name}]}}` - the exact shape `catalogToCtx` in va-wizard.js expects. */
  catalog: () => call(invoke, "vaCatalog", {}),
  saveAgent: (va, extra = {}) => call(invoke, "saveScheduledJob", { job: { mode: "va", va, ...extra } }),
  listAgents: () => call(invoke, "listVaAgents", {}),
  status: (jobId) => call(invoke, "getVaStatus", { jobId }),
  drafts: (jobId) => call(invoke, "listVaDrafts", { jobId }),
  approveDraft: (jobId, draft) => call(invoke, "approveVaDraft", { jobId, itemKey: draft && draft.itemKey, stagedAt: draft && draft.stagedAt }),
  rejectDraft: (jobId, draft) => call(invoke, "rejectVaDraft", { jobId, itemKey: draft && draft.itemKey, stagedAt: draft && draft.stagedAt }),
  effects: (jobId) => call(invoke, "listVaEffects", { jobId }),
  getMemory: (jobId) => call(invoke, "getVaMemory", { jobId }),
  saveMemory: (jobId, memory, constraints) => call(invoke, "saveVaMemory", { jobId, memory, constraints }),
  pause: (jobId) => call(invoke, "pauseVa", { jobId }),
  resume: (jobId) => call(invoke, "resumeVa", { jobId }),
  runTickNow: (jobId) => call(invoke, "runVaTickNow", { jobId }),
  runPostNow: (jobId) => call(invoke, "runVaPostNow", { jobId }),
});

export default createVaClient;
