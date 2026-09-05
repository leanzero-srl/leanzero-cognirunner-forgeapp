/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline stand-in for @forge/api (and the Queue from @forge/events) so modules that
// import them at top level (src/listeners.js, src/scheduled-jobs.js) load in unit tests.
// Every Jira call is recorded; tests can script responses via __respond(fn).
const calls = [];
let responder = null;

const fakeResponse = (status, body) => ({
  ok: status >= 200 && status < 300, status, statusText: String(status),
  headers: { get: () => null },
  json: async () => body, text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});

export const route = (strings, ...vals) => strings.reduce((acc, s, i) => acc + s + (i < vals.length ? String(vals[i]) : ""), "");

const requestJira = async (path, opts = {}) => {
  calls.push({ path: String(path), opts });
  if (responder) return responder(String(path), opts);
  return fakeResponse(404, { errorMessages: ["mock: no responder"] });
};

const api = {
  asApp: () => ({ requestJira }),
  asUser: () => ({ requestJira }),
  __calls: calls,
  __reset() { calls.length = 0; responder = null; },
  __respond(fn) { responder = fn; },
  __response: fakeResponse,
};

export const fetch = async () => fakeResponse(500, "mock fetch");
export const webTrigger = { getUrl: async (key) => `https://mock.webtrigger/${key}` };
export const getAppContext = () => ({ environmentAri: null });
export default api;

// @forge/events subset
export const pushed = [];
export class Queue {
  constructor({ key }) { this.key = key; }
  async push(ev) { for (const event of Array.isArray(ev) ? ev : [ev]) pushed.push({ queue: this.key, ...event }); return { jobId: `mockjob-${pushed.length}` }; }
  getJob() { return { cancel: async () => {} }; }
}

export const InvocationErrorCode = { FUNCTION_RETRY_REQUEST: "FUNCTION_RETRY_REQUEST" };
export class InvocationError {
  constructor(retryOptions) { return { _retry: true, retryOptions }; }
}
