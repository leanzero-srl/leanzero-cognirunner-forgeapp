/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * THE OFF STATE, WITH SOMETHING TO PRESS (F-914).
 *
 * Three surfaces used to end a refusal with a sentence and nothing else: the Code tab's
 * status card ("Open the Settings tab..." in bold), the Settings key-status card and the
 * agent-model hint (both of which painted "part of CogniRunner Coder, upgrade in Jira's
 * Manage apps" as primary-blue <strong>). A cold reader clicked the blue words, nothing
 * happened, and the walk recorded it as a dead end. Blue bold text that is not a link is
 * worse than plain text, because it promises a destination.
 *
 * So the two REAL actions live here, in ONE component, and a surface that has an off
 * state renders this instead of writing its own sentence:
 *
 *   1. Open the Settings tab - a callback, because the admin panel's tabs are not
 *      addressable by URL (src/shared/edition.js says the same thing where it refuses to
 *      put a URL in AGENT_CAPABILITY_REASONS.link). The Settings tab is adminOnly, so the
 *      CALLER passes null for a non-admin rather than this component guessing; a button
 *      that moves a reader to a tab they do not have is the next version of the dead end.
 *   2. Upgrade in Manage apps - a real href, `<siteUrl>/jira/settings/apps/manage`, built
 *      from the site origin `view.getContext()` reports. It renders only once that origin
 *      is known: a relative href inside a Custom UI iframe points at the iframe's own
 *      sandbox origin, which is a link to nowhere.
 *
 * THE CLICK GOES THROUGH `router.open`, and the `href` is still real. Forge's iframe is
 * sandboxed and a bare target="_blank" is not reliably allowed to open, so the anchor
 * carries the destination (readable, copyable, assertable) and the handler navigates the
 * way the platform supports.
 *
 * THE FRONTIER SENTENCE (`forgeLlm`) exists because an upgrade ALONE does not turn Coder
 * on for an Atlassian Forge LLM tenant: agentCapability() checks the edition first and
 * the agent model second (src/shared/edition.js), so a site that buys Coder while its
 * agent model is Haiku is refused a SECOND time, by a different reason, on the screen it
 * just paid to unblock. Naming both requirements before the upgrade is the whole point.
 */

import React, { useEffect, useState } from "react";
import { router, view } from "@forge/bridge";
/* F-961 - the path is NOT retyped here. `src/shared/manage-apps.js` (F-958) is the one
   home for "where does a Jira admin manage apps", and this component had its own copy of
   the same string sitting next to it. Re-exported so the existing importers and the
   harness keep resolving it from this module. */
import { MANAGE_APPS_PATH, manageAppsUrl } from "../../../../src/shared/manage-apps";

export { MANAGE_APPS_PATH };

/**
 * The one wording for "the edition is not the only requirement". Exported so the harness
 * asserts the sentence this component really renders rather than a retyped copy.
 */
export const FORGE_FRONTIER_SENTENCE =
  "On Atlassian Forge LLM this needs the Coder edition AND Claude Sonnet 5 or Opus 5 as the agent model, so an upgrade on its own still leaves it off.";

export default function AgentOffState({ sentence, forgeLlm = false, onGoToSettings = null, className = "" }) {
  const [siteUrl, setSiteUrl] = useState("");
  useEffect(() => {
    let live = true;
    Promise.resolve(view.getContext())
      .then((ctx) => { if (live && ctx && ctx.siteUrl) setSiteUrl(String(ctx.siteUrl).replace(/\/+$/, "")); })
      .catch(() => { /* No origin, no link. The sentence and the Settings button stand alone. */ });
    return () => { live = false; };
  }, []);

  const manageUrl = manageAppsUrl(siteUrl);

  return (
    <div className={`agent-off${className ? " " + className : ""}`}>
      {sentence && <p className="agent-off-text">{sentence}</p>}
      {forgeLlm && <p className="agent-off-text">{FORGE_FRONTIER_SENTENCE}</p>}
      <div className="agent-off-actions">
        {onGoToSettings && (
          <button type="button" className="agent-off-btn" onClick={onGoToSettings}>
            Open the Settings tab
          </button>
        )}
        {manageUrl && (
          <a
            className="agent-off-link"
            href={manageUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => { e.preventDefault(); router.open(manageUrl); }}
          >
            Upgrade in Manage apps
          </a>
        )}
      </div>
    </div>
  );
}
