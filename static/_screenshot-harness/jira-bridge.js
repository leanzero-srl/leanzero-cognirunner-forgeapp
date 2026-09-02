/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 *
 * Dev-only screenshot/test harness — mock of @forge/jira-bridge (config-ui only).
 * config-ui calls only workflowRules.onConfigure(cb) to register a save handler.
 */
export const workflowRules = {
  onConfigure: async (cb) => {
    // Expose the registered save handler so tests can INVOKE the real
    // onConfigure path and assert on the exact config string the editor would
    // hand Jira (e.g. that a number-equals condition's valueNum is a JSON
    // number). Screenshot flows simply never call it — still a no-op for them.
    window.__ON_CONFIGURE__ = cb;
  },
};
export default { workflowRules };
