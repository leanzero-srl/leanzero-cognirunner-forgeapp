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
  onConfigure: async (_cb) => { /* no-op for standalone screenshots */ },
};
export default { workflowRules };
