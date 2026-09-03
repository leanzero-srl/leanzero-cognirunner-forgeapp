/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline stand-in for @forge/llm (its real client throws "Forge runtime not found" at import).
export const chat = async () => { throw new Error("mock @forge/llm: no provider offline"); };
export const list = async () => ({ models: [] });
export default { chat, list };
