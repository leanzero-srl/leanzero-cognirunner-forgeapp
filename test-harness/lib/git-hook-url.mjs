/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */
// ONE builder for the harness's view of a git webhook URL. Mirrors `hookUrlFor` in
// src/git-connections.js (`?conn=&repo=`, both encoded). Two live drivers each carried
// their own copy and one forgot to encode the connection id (2026-09-14).
export const gitHookUrl = (trigger, connId, repo) =>
  `${trigger}${trigger.includes("?") ? "&" : "?"}conn=${encodeURIComponent(connId)}&repo=${encodeURIComponent(repo)}`;
