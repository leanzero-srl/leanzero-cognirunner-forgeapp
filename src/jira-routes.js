/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * THE ONE HOME OF A FAULTABLE JIRA ROUTE — F-661.
 *
 * WHY IT EXISTS: `src/harness-fault.js` declares `JIRA_FAULT_USER_SEARCH_PATH` "THE one
 * home of the path string the F-648 consumer and this lever must agree on" — and then
 * NOTHING built a fetch from it. Both consumers of `/rest/api/3/user/search` carried
 * their own `route`…`` literal, so the agreement was a COMMENT, not a mechanism: if
 * `searchUsers` had been migrated to `/rest/api/3/user/search/query`, the lever would
 * simply never have fired and the live door would have reported "no fault" instead of
 * "the constant is stale". Worse, the SECOND consumer — `resolveUserToAccountId`, on the
 * semantic-PF assignee WRITE path — never asked the lever at all, so arming the fault
 * proved one of two call sites while reading as a proof of the endpoint.
 *
 * So the route and the fault check get one home each, and both consumers use both:
 *   - `userSearchRoute()` BUILDS the URL from `JIRA_FAULT_USER_SEARCH_PATH`. The constant
 *     is spliced in as a pre-trusted `Route` (the `route` tag inserts a Route verbatim in
 *     path mode and would otherwise THROW on the slashes); `query` and `maxResults` still
 *     ride the tag as ordinary interpolations, so caller-supplied text is escaped exactly
 *     as it was before this module existed.
 *   - `jiraFetchWithFault()` asks `jiraFaultStatus()` for that same path and, when a
 *     lever is armed, hands back a synthetic `{ ok:false, status }` so each consumer's own
 *     real `!ok` arm runs UNCHANGED — the proof is of the product's behaviour, not of the
 *     lever's.
 *
 * HARNESS OFF (i.e. PRODUCTION) → BYTE-IDENTICAL FETCH. `harnessEnabled()` is asked first,
 * so no KVS read is paid per keystroke, and the call is forwarded with the SAME ARITY the
 * consumer used: one argument when it passed no options, two when it did. A wrapper that
 * "helpfully" normalised `undefined` into `{}` would be a behaviour change smuggled in as
 * a refactor.
 *
 * THE GATES ARE NOT HERE. Each consumer keeps its own — `searchUsers` refuses a non-admin
 * BEFORE it reaches this module, and this module must be called AFTER that refusal, never
 * before it; a fault lever that runs ahead of a permission gate would make the gate's
 * ordering unprovable, which is half of what F-655 was raised for.
 */
import api, { route, assumeTrustedRoute } from "@forge/api";
import { harnessEnabled, jiraFaultStatus, JIRA_FAULT_USER_SEARCH_PATH } from "./harness-fault.js";

/**
 * The faultable path, pre-trusted ONCE so the `route` tag will splice it into path
 * position verbatim. It is our own frozen module constant, never caller input — which is
 * the only thing that makes `assumeTrustedRoute` the right tool here.
 */
const USER_SEARCH_BASE = assumeTrustedRoute(JIRA_FAULT_USER_SEARCH_PATH);

/** Default page size each consumer asked for before F-661; kept per-caller, not merged. */
export const USER_SEARCH_DEFAULT_MAX_RESULTS = 10;

/**
 * THE one builder for the user-search URL. Every fetch of that endpoint goes through it,
 * so the constant and the wire are the same string by construction rather than by review.
 */
export const userSearchRoute = (query, { maxResults = USER_SEARCH_DEFAULT_MAX_RESULTS } = {}) =>
  route`${USER_SEARCH_BASE}?query=${query}&maxResults=${maxResults}`;

/**
 * The string a `Route` will put on the wire. `@forge/api` returns a readonly Route object;
 * the offline mock returns a plain string. One reader for both so an assertion (and a log
 * line) never has to know which it is holding.
 */
export const routeString = (r) => (r && typeof r === "object" && typeof r.value === "string" ? r.value : String(r));

/**
 * THE one seam where a planted Jira transport failure enters the app.
 *
 * `path` is the bare path the lever is keyed by (`JIRA_FAULT_USER_SEARCH_PATH`), NOT the
 * built route — `jiraFaultStatus` matches by exact equality against `JIRA_FAULT_PATHS` and
 * refuses anything else, so a path that is not faultable simply never plants.
 *
 * Call this AFTER the consumer's own permission gate. Best-effort by construction: every
 * failure inside `jiraFaultStatus` already answers `null` (no lever), so this can never
 * break a real Jira call by accident.
 */
export const jiraFetchWithFault = async (path, builtRoute, options) => {
  const plantedStatus = harnessEnabled() ? await jiraFaultStatus(path) : null;
  if (plantedStatus !== null) {
    // The shape the consumers' `!resp.ok` arms already handle. `json()` is present but
    // unreachable through an `ok` check — a planted fault must never look like a 200.
    return { ok: false, status: plantedStatus, json: async () => [], text: async () => "" };
  }
  return options === undefined
    ? api.asApp().requestJira(builtRoute)
    : api.asApp().requestJira(builtRoute, options);
};
