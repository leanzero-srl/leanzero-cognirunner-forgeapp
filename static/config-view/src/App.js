/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import React, { useState, useEffect } from "react";

// Inject styles directly
const injectStyles = () => {
  if (document.getElementById("app-styles")) return;

  const style = document.createElement("style");
  style.id = "app-styles";
  style.textContent = `
    :root {
      --bg-color: transparent;
      --text-color: #0f172a;
      --text-secondary: #64748b;
      --text-muted: #94a3b8;
      --primary-color: #2563eb;
      --code-bg: #f1f5f9;
      --success-color: #16a34a;
      --error-color: #dc2626;
      --border-color: #cbd5e1;
      --card-bg: #ffffff;
    }

    html[data-color-mode="dark"] {
      --bg-color: transparent;
      --text-color: #F5F5F7;
      --text-secondary: #A0A0B0;
      --text-muted: #71717a;
      --primary-color: #3b82f6;
      --code-bg: #0A0A0F;
      --success-color: #22c55e;
      --error-color: #ef4444;
      --border-color: #374151;
      --card-bg: #13131A;
    }

    *, *::before, *::after { box-sizing: border-box; }

    html, body {
      margin: 0;
      padding: 0;
      font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: var(--bg-color);
      color: var(--text-color);
      font-size: 13px;
      line-height: 1.4;
    }

    .container { padding: 8px 12px; }

    .empty {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--text-muted);
    }

    .config-item {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin-bottom: 6px;
    }

    .config-item:last-child { margin-bottom: 0; }

    .label {
      font-weight: 600;
      font-size: 12px;
      flex-shrink: 0;
      min-width: 50px;
      color: var(--text-secondary);
    }

    .value {
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 12px;
      font-family: SFMono-Regular, Consolas, monospace;
      background-color: var(--code-bg);
      color: var(--primary-color);
    }

    .prompt-value {
      font-size: 12px;
      word-break: break-word;
      color: var(--text-color);
    }

    .loading-text {
      font-size: 12px;
      color: var(--text-muted);
    }

    .logs-section {
      margin-top: 16px;
      border-top: 1px solid var(--border-color);
      padding-top: 12px;
    }

    .logs-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }

    .logs-title {
      font-weight: 600;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-secondary);
    }

    .logs-actions {
      display: flex;
      gap: 8px;
    }

    .btn-small {
      padding: 4px 8px;
      font-size: 11px;
      border: 1px solid var(--border-color);
      border-radius: 3px;
      background: var(--card-bg);
      color: var(--text-color);
      cursor: pointer;
    }

    .btn-small:hover:not(:disabled) {
      background: var(--code-bg);
    }
    .btn-small:disabled { opacity: 0.6; cursor: default; }

    .logs-list {
      max-height: 300px;
      overflow-y: auto;
      border: 1px solid var(--border-color);
      border-radius: 4px;
      background: var(--card-bg);
    }

    .log-entry {
      padding: 8px 10px;
      border-bottom: 1px solid var(--border-color);
      font-size: 11px;
    }

    .log-entry:last-child {
      border-bottom: none;
    }

    .log-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
    }

    .log-status {
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
    }

    .log-status.valid {
      background: var(--success-color);
      color: #ffffff;
    }

    .log-status.invalid {
      background: var(--error-color);
      color: #ffffff;
    }

    .log-time {
      color: var(--text-muted);
      font-size: 10px;
    }

    .log-issue {
      font-weight: 600;
      color: var(--primary-color);
    }

    .log-details {
      color: var(--text-secondary);
      margin-top: 4px;
    }

    .log-reason {
      margin-top: 4px;
      padding: 4px 8px;
      background: var(--code-bg);
      border-radius: 3px;
      color: var(--text-color);
    }

    .log-tools {
      margin-top: 4px;
      font-size: 10px;
      color: var(--text-muted);
    }

    .log-type-badge {
      display: inline-block;
      padding: 1px 5px;
      border-radius: 3px;
      font-size: 10px;
      font-weight: 600;
      background: var(--primary-color);
      color: #ffffff;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .log-tools-badge {
      display: inline-block;
      padding: 1px 5px;
      border-radius: 3px;
      font-size: 10px;
      font-weight: 600;
      background: var(--primary-color);
      color: #ffffff;
      margin-right: 6px;
    }

    html[data-color-mode="dark"] .log-tools-badge {
      background: var(--primary-color);
    }

    .log-queries {
      margin-top: 3px;
      padding: 3px 6px;
      background: var(--code-bg);
      border-radius: 3px;
      font-family: SFMono-Regular, Consolas, monospace;
      font-size: 10px;
      word-break: break-all;
      color: var(--text-secondary);
    }

    .log-recommendation {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      margin-top: 6px;
      padding: 8px 10px;
      border-radius: 6px;
      background: var(--card-bg);
      border: 2px solid var(--primary-color);
      box-shadow: 0 4px 12px -4px rgba(37, 99, 235, 0.35);
      font-size: 11px;
      line-height: 1.5;
      color: var(--text-color);
      white-space: pre-line;
    }

    .log-rec-icon { flex-shrink: 0; font-size: 13px; }

    .log-trace {
      margin-top: 6px;
    }

    .log-trace-toggle {
      font-size: 10px;
      color: var(--text-muted);
      cursor: pointer;
      user-select: none;
    }
    .log-trace-toggle:hover { color: var(--text-secondary); }

    .log-trace-content {
      margin-top: 4px;
      padding: 6px 8px;
      background: var(--code-bg);
      border-radius: 4px;
      font-family: SFMono-Regular, Consolas, monospace;
      font-size: 10px;
      line-height: 1.6;
      max-height: 200px;
      overflow-y: auto;
    }

    .log-trace-line {
      color: var(--text-secondary);
      padding: 1px 0;
    }

    .log-trace-error {
      color: var(--error-color);
      font-weight: 600;
    }

    .no-logs {
      padding: 16px;
      text-align: center;
      color: var(--text-muted);
      font-size: 12px;
    }

    .license-banner {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 10px;
      border-radius: 4px;
      font-size: 11px;
      margin-bottom: 10px;
      border: 1px solid;
    }

    .license-active {
      background: rgba(0, 102, 68, 0.1);
      border-color: var(--success-color);
      color: var(--success-color);
    }

    .license-inactive {
      background: rgba(222, 53, 11, 0.1);
      border-color: var(--error-color);
      color: var(--error-color);
    }

    .rule-status-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 8px 10px;
      border-radius: 4px;
      font-size: 11px;
      margin-bottom: 10px;
      border: 1px solid;
    }

    .status-disabled-banner {
      border-color: var(--error-color);
      background: rgba(222, 53, 11, 0.08);
      color: var(--error-color);
    }

    .status-active-banner {
      border-color: var(--success-color);
      background: rgba(0, 102, 68, 0.08);
      color: var(--success-color);
    }

    .rule-status-content {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .btn-enable {
      color: var(--success-color);
      border-color: var(--success-color);
      flex-shrink: 0;
    }

    .btn-enable:hover {
      background: rgba(0, 102, 68, 0.1);
    }

    .btn-danger {
      color: var(--error-color);
      border-color: var(--error-color);
      flex-shrink: 0;
    }

    .btn-danger:hover {
      background: rgba(222, 53, 11, 0.1);
    }

    .alert {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      padding: 8px 10px;
      border-radius: 4px;
      font-size: 11px;
      margin-bottom: 10px;
      border: 1px solid;
    }

    .alert-error {
      background: rgba(222, 53, 11, 0.08);
      border-color: var(--error-color);
      color: var(--error-color);
    }

    .alert-warning {
      background: rgba(255, 153, 31, 0.08);
      border-color: #FF991F;
      color: #FF991F;
    }

    html[data-color-mode="dark"] .alert-warning {
      color: #F5CD47;
      border-color: #F5CD47;
    }

    .alert-dismiss {
      margin-left: auto;
      background: none;
      border: none;
      color: inherit;
      cursor: pointer;
      font-size: 14px;
      line-height: 1;
      padding: 0 2px;
      opacity: 0.7;
    }

    .alert-dismiss:hover { opacity: 1; }

    .sk {
      background: linear-gradient(90deg, #cbd5e1 25%, #f1f5f9 50%, #cbd5e1 75%);
      background-size: 200% 100%;
      animation: skShimmer 1.5s ease-in-out infinite;
      border-radius: 6px;
    }
    html[data-color-mode="dark"] .sk {
      background: linear-gradient(90deg, #1e1e2e 25%, #2a2a3a 50%, #1e1e2e 75%);
      background-size: 200% 100%;
    }
    @keyframes skShimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
  `;
  document.head.appendChild(style);
};

let invoke;

function App() {
  const [config, setConfig] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [logsLoading, setLogsLoading] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [licenseActive, setLicenseActive] = useState(null);
  const [ruleDisabled, setRuleDisabled] = useState(null);
  const [ruleId, setRuleId] = useState(null);
  const [workflowContext, setWorkflowContext] = useState(null);
  const [toggling, setToggling] = useState(false);
  const [clearingLogs, setClearingLogs] = useState(false);

  const fetchLogs = async () => {
    if (!invoke) return;
    setLogsLoading(true);
    try {
      const result = await invoke("getLogs");
      if (result.success) {
        let allLogs = result.logs || [];
        // Filter to only show logs for this specific rule
        if (config?.type?.includes("postfunction")) {
          // Post-function: match by type and action field
          const pfType = config.type;
          const actionField = config.actionFieldId || config.fieldId || "";
          allLogs = allLogs.filter((l) =>
            (l.type && l.type.includes("postfunction")) &&
            (l.fieldId === actionField || l.fieldId === "static-code" || pfType.includes("static"))
          );
        } else if (config?.fieldId) {
          // Validator/condition: match by field ID
          allLogs = allLogs.filter((l) => l.fieldId === config.fieldId && (!l.type || l.type === "validation"));
        }
        setLogs(allLogs);
      }
    } catch (e) {
      console.error("Failed to fetch logs:", e);
    }
    setLogsLoading(false);
  };

  const clearLogs = async () => {
    if (!invoke) return;
    setClearingLogs(true);
    try {
      await invoke("clearLogs");
      setLogs([]);
    } catch (e) {
      console.error("Failed to clear logs:", e);
    }
    setClearingLogs(false);
  };

  const [toggleError, setToggleError] = useState(null);
  const [toggleWarning, setToggleWarning] = useState(null);

  const handleToggleRule = async () => {
    if (!invoke || !ruleId) return;
    setToggling(true);
    setToggleError(null);
    setToggleWarning(null);
    try {
      const isPF = config?.type?.includes("postfunction") || config?.conditionPrompt !== undefined;
      const action = ruleDisabled
        ? (isPF ? "enablePostFunction" : "enableRule")
        : (isPF ? "disablePostFunction" : "disableRule");
      const result = await invoke(action, { id: ruleId });
      if (result.success) {
        setRuleDisabled(result.disabled);
        if (result.warning) {
          setToggleWarning(result.warning);
        }
      } else {
        setToggleError(result.error || "Failed to update rule. Please try again.");
      }
    } catch (e) {
      console.error("Failed to toggle rule:", e);
      setToggleError("Failed to communicate with the server. Please try again.");
    }
    setToggling(false);
  };

  const formatTime = (timestamp) => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleString();
    } catch {
      return timestamp;
    }
  };

  useEffect(() => {
    injectStyles();

    const init = async () => {
      try {
        const bridge = await import("@forge/bridge");
        invoke = bridge.invoke;

        // Enable theming for dark mode support
        if (bridge.view && bridge.view.theme && bridge.view.theme.enable) {
          await bridge.view.theme.enable();
        }

        const context = await bridge.view.getContext();
        console.log("config-view context:", JSON.stringify(context, null, 2));

        // Try all possible locations for the config per module type
        const possibleConfig =
          context?.extension?.postFunctionConfig ||
          context?.extension?.validatorConfig ||
          context?.extension?.conditionConfig ||
          context?.extension?.configuration ||
          context?.extension?.config;

        if (possibleConfig) {
          // Config is stored as JSON string, parse it
          if (typeof possibleConfig === "string") {
            try {
              setConfig(JSON.parse(possibleConfig));
            } catch {
              // Fallback if not valid JSON
            }
          } else {
            setConfig(possibleConfig);
          }
        }

        // Derive rule ID and workflow context (same pattern as config-ui)
        const ext = context?.extension || {};
        const derivedRuleId = ext.entryPoint || ext.key || null;
        if (derivedRuleId) {
          setRuleId(derivedRuleId);
        }

        // Capture workflow context for API lookups
        const wfCtx = {};
        if (ext.workflowId) wfCtx.workflowId = ext.workflowId;
        if (ext.workflowName) wfCtx.workflowName = ext.workflowName;
        if (ext.scopedProjectId) wfCtx.projectId = ext.scopedProjectId;
        if (ext.transitionContext) {
          wfCtx.transitionId = ext.transitionContext.id;
          wfCtx.transitionFromName = ext.transitionContext.from?.name;
          wfCtx.transitionToName = ext.transitionContext.to?.name;
        }
        if (context?.siteUrl) wfCtx.siteUrl = context.siteUrl;
        if (Object.keys(wfCtx).length > 0) {
          setWorkflowContext(wfCtx);
        }

        // Check license status from context
        const licenseStatus = context?.license?.active;
        if (licenseStatus !== undefined) {
          setLicenseActive(licenseStatus);
        }
      } catch (e) {
        console.log("Could not load config:", e);
      }

      // Also check license via resolver (more reliable for paid apps)
      try {
        const licenseResult = await invoke("checkLicense");
        if (licenseResult?.isActive !== undefined) {
          setLicenseActive(licenseResult.isActive);
        }
      } catch (e) {
        console.log("Could not check license:", e);
      }

      setLoading(false);
    };
    init();
  }, []);

  // Check rule disabled status using all available identifiers
  useEffect(() => {
    if (!invoke) return;
    // Need at least one identifier to look up
    if (!ruleId && !config?.fieldId) return;
    const checkStatus = async () => {
      try {
        const result = await invoke("getRuleStatus", {
          id: ruleId,
          fieldId: config?.fieldId,
          prompt: config?.prompt,
          conditionPrompt: config?.conditionPrompt,
          actionPrompt: config?.actionPrompt,
          type: config?.type,
          workflow: workflowContext,
        });
        if (result.found) {
          setRuleDisabled(result.disabled);
          // Always use the registryId from KVS — ext.entryPoint gives "view" which
          // doesn't match the actual KVS config id (registered by config-ui)
          if (result.registryId) {
            setRuleId(result.registryId);
          }
        }
      } catch (e) {
        console.log("Could not check rule status:", e);
      }
    };
    checkStatus();
  }, [ruleId, config, workflowContext]);

  if (loading) {
    return (
      <div className="container">
        <div style={{ padding: "4px 0" }}>
          <div className="sk" style={{ width: "50%", height: 12 }} />
        </div>
      </div>
    );
  }

  const statusBanner = ruleDisabled === true ? (
    <div className="rule-status-banner status-disabled-banner">
      <div className="rule-status-content">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
        </svg>
        <span>This rule is <strong>disabled</strong>. It will not run on transitions.</span>
      </div>
      <button
        className="btn-small btn-enable"
        onClick={handleToggleRule}
        disabled={toggling}
      >
        {toggling ? "Enabling..." : "Enable"}
      </button>
    </div>
  ) : ruleDisabled === false ? (
    <div className="rule-status-banner status-active-banner">
      <div className="rule-status-content">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M20 6L9 17l-5-5" />
        </svg>
        <span>This rule is <strong>active</strong>.</span>
      </div>
      <button
        className="btn-small btn-danger"
        onClick={handleToggleRule}
        disabled={toggling}
      >
        {toggling ? "Disabling..." : "Disable"}
      </button>
    </div>
  ) : null;

  const licenseBanner = licenseActive === false ? (
    <div className="license-banner license-inactive">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span>License inactive — AI validation is disabled. Transitions will pass through without checks.</span>
    </div>
  ) : licenseActive === true ? (
    <div className="license-banner license-active">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M20 6L9 17l-5-5" />
      </svg>
      <span>License active</span>
    </div>
  ) : null;

  const toggleAlerts = (
    <>
      {toggleError && (
        <div className="alert alert-error">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{toggleError}</span>
          <button className="alert-dismiss" onClick={() => setToggleError(null)}>&times;</button>
        </div>
      )}
      {toggleWarning && (
        <div className="alert alert-warning">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span>{toggleWarning}</span>
          <button className="alert-dismiss" onClick={() => setToggleWarning(null)}>&times;</button>
        </div>
      )}
    </>
  );

  // Check if config has any meaningful data (validator/condition OR post-function)
  const hasConfig = config && (
    config.fieldId || config.prompt ||
    config.conditionPrompt || config.actionPrompt ||
    config.type?.includes("postfunction") ||
    (config.functions && config.functions.length > 0)
  );

  if (!hasConfig) {
    return (
      <div className="container">
        {licenseBanner}
        {statusBanner}
        {toggleAlerts}
        <div className="empty">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>No configuration set</span>
        </div>

        {/* Still show logs section even without config */}
        <div className="logs-section">
          <div className="logs-header">
            <span className="logs-title">{config?.type?.includes("postfunction") ? "Execution Logs" : "Validation Logs"}</span>
            <div className="logs-actions">
              <button
                className="btn-small"
                onClick={() => {
                  setShowLogs(!showLogs);
                  if (!showLogs) fetchLogs();
                }}
              >
                {showLogs ? "Hide Logs" : "Show Logs"}
              </button>
              {showLogs && logs.length > 0 && (
                <button className="btn-small" onClick={clearLogs} disabled={clearingLogs}>
                  {clearingLogs ? "Clearing..." : "Clear"}
                </button>
              )}
              {showLogs && (
                <button className="btn-small" onClick={fetchLogs} disabled={logsLoading}>
                  {logsLoading ? "Refreshing..." : "Refresh"}
                </button>
              )}
            </div>
          </div>

          {showLogs && (
            <div className="logs-list">
              {logsLoading ? (
                <div style={{ padding: "12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                    <div className="sk" style={{ width: "40px", height: "14px" }} />
                    <div className="sk" style={{ width: "60px", height: "14px" }} />
                    <div className="sk" style={{ width: "120px", height: "12px" }} />
                  </div>
                  <div className="sk" style={{ width: "80%", height: "12px", marginBottom: "8px" }} />
                  <div className="sk" style={{ width: "95%", height: "32px", marginBottom: "16px" }} />
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                    <div className="sk" style={{ width: "40px", height: "14px" }} />
                    <div className="sk" style={{ width: "60px", height: "14px" }} />
                    <div className="sk" style={{ width: "100px", height: "12px" }} />
                  </div>
                  <div className="sk" style={{ width: "70%", height: "12px", marginBottom: "8px" }} />
                  <div className="sk" style={{ width: "85%", height: "32px" }} />
                </div>
              ) : logs.length === 0 ? (
                <div className="no-logs">No validation logs yet</div>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="log-entry">
                    <div className="log-header">
                      <span
                        className={`log-status ${log.isValid ? "valid" : "invalid"}`}
                      >
                        {log.isValid ? "PASS" : "FAIL"}
                      </span>
                      <span className="log-issue">{log.issueKey}</span>
                      <span className="log-time">
                        {formatTime(log.timestamp)}
                      </span>
                    </div>
                    <div className="log-details">
                      Field: <code>{log.fieldId}</code>
                    </div>
                    <div className="log-reason">{log.reason}</div>
                    {log.toolMeta?.toolsUsed && (
                      <div className="log-tools">
                        <span className="log-tools-badge">JQL</span>
                        {log.toolMeta.toolRounds} round{log.toolMeta.toolRounds !== 1 ? "s" : ""}, {log.toolMeta.totalResults} result{log.toolMeta.totalResults !== 1 ? "s" : ""}
                        {log.toolMeta.queries?.length > 0 && (
                          <div className="log-queries">
                            {log.toolMeta.queries.map((q, i) => <div key={i}>{q}</div>)}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      {licenseBanner}
      {statusBanner}
      {toggleAlerts}

      {/* Post-function: Semantic */}
      {config.type === "postfunction-semantic" && (
        <>
          <div className="config-item">
            <span className="label">Type:</span>
            <span className="prompt-value">Semantic Post Function</span>
          </div>
          {config.conditionPrompt && (
            <div className="config-item">
              <span className="label">Condition:</span>
              <span className="prompt-value">{config.conditionPrompt}</span>
            </div>
          )}
          {config.actionPrompt && (
            <div className="config-item">
              <span className="label">Action:</span>
              <span className="prompt-value">{config.actionPrompt}</span>
            </div>
          )}
          {config.actionFieldId && (
            <div className="config-item">
              <span className="label">Target:</span>
              <code className="value">{config.actionFieldId}</code>
            </div>
          )}
        </>
      )}

      {/* Post-function: Static */}
      {config.type === "postfunction-static" && (
        <>
          <div className="config-item">
            <span className="label">Type:</span>
            <span className="prompt-value">Static Post Function</span>
          </div>
          <div className="config-item">
            <span className="label">Steps:</span>
            <span className="prompt-value">{config.functions?.length || 0} function block{(config.functions?.length || 0) !== 1 ? "s" : ""}</span>
          </div>
          {config.functions?.map((fn, i) => (
            <div key={i} className="config-item" style={{ paddingLeft: "12px" }}>
              <span className="label">#{i + 1}:</span>
              <span className="prompt-value">
                {fn.name || fn.operationPrompt?.substring(0, 80) || "(no description)"}
              </span>
            </div>
          ))}
        </>
      )}

      {/* Validator / Condition (original) */}
      {!config.type?.includes("postfunction") && (
        <>
          {config.fieldId && (
            <div className="config-item">
              <span className="label">Field:</span>
              <code className="value">{config.fieldId}</code>
            </div>
          )}
          {config.prompt && (
            <div className="config-item">
              <span className="label">Prompt:</span>
              <span className="prompt-value">
                {config.prompt.length > 100
                  ? config.prompt.substring(0, 100) + "..."
                  : config.prompt}
              </span>
            </div>
          )}
          {config.enableTools === true && (
            <div className="config-item">
              <span className="label">Tools:</span>
              <span className="prompt-value">JQL Search (always enabled)</span>
            </div>
          )}
          {config.enableTools === false && (
            <div className="config-item">
              <span className="label">Tools:</span>
              <span className="prompt-value">Disabled</span>
            </div>
          )}
        </>
      )}

      {/* Logs section */}
      <div className="logs-section">
        <div className="logs-header">
          <span className="logs-title">{config?.type?.includes("postfunction") ? "Execution Logs" : "Validation Logs"}</span>
          <div className="logs-actions">
            <button
              className="btn-small"
              onClick={() => {
                setShowLogs(!showLogs);
                if (!showLogs) fetchLogs();
              }}
            >
              {showLogs ? "Hide Logs" : "Show Logs"}
            </button>
            {showLogs && logs.length > 0 && (
              <button className="btn-small" onClick={clearLogs}>
                Clear
              </button>
            )}
            {showLogs && (
              <button className="btn-small" onClick={fetchLogs}>
                Refresh
              </button>
            )}
          </div>
        </div>

        {showLogs && (
          <div className="logs-list">
            {logsLoading ? (
              <div className="no-logs">Loading logs...</div>
            ) : logs.length === 0 ? (
              <div className="no-logs">No validation logs yet</div>
            ) : (
              logs.map((log) => (
                <div key={log.id} className="log-entry">
                  <div className="log-header">
                    <span className={`log-status ${log.isValid ? "valid" : "invalid"}`}>
                      {log.type === "postfunction-semantic" ? (log.isValid ? "OK" : "ERR")
                        : log.type === "postfunction-static" ? (log.isValid ? "OK" : "ERR")
                        : (log.isValid ? "PASS" : "FAIL")}
                    </span>
                    {log.type && log.type !== "validation" && (
                      <span className="log-type-badge">{log.type.replace("postfunction-", "PF: ")}</span>
                    )}
                    <span className="log-issue">{log.issueKey}</span>
                    <span className="log-time">{formatTime(log.timestamp)}</span>
                    {log.executionTimeMs && (
                      <span className="log-time">{log.executionTimeMs}ms</span>
                    )}
                  </div>
                  {log.fieldId && log.fieldId !== "static-code" && (
                    <div className="log-details">
                      Field: <code>{log.fieldId}</code>
                      {log.mode && <span style={{ marginLeft: "8px", fontSize: "10px", color: "var(--text-muted)" }}>({log.mode})</span>}
                      {log.docsUsed && <span style={{ marginLeft: "4px", fontSize: "10px", color: "var(--primary-color)" }}>+ docs</span>}
                    </div>
                  )}
                  {log.decision && (
                    <div className="log-details">
                      Decision: <strong>{log.decision}</strong>
                      {log.changes !== undefined && <span> | {log.changes} change{log.changes !== 1 ? "s" : ""}</span>}
                      {log.steps && <span> | {log.steps} step{log.steps !== 1 ? "s" : ""}</span>}
                    </div>
                  )}
                  {log.workflowName && (
                    <div className="log-details" style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                      Transition: {log.workflowName}{log.transitionName ? ` (${log.transitionName})` : ""}
                    </div>
                  )}
                  <div className="log-reason">{log.reason}</div>
                  {log.toolMeta?.toolsUsed && (
                    <div className="log-tools">
                      <span className="log-tools-badge">JQL</span>
                      {log.toolMeta.toolRounds} round{log.toolMeta.toolRounds !== 1 ? "s" : ""}, {log.toolMeta.totalResults} result{log.toolMeta.totalResults !== 1 ? "s" : ""}
                      {log.toolMeta.queries?.length > 0 && (
                        <div className="log-queries">
                          {log.toolMeta.queries.map((q, i) => <div key={i}>{q}</div>)}
                        </div>
                      )}
                    </div>
                  )}
                  {log.recommendation && (
                    <div className="log-recommendation">
                      <span className="log-rec-icon">💡</span>
                      <span>{log.recommendation}</span>
                    </div>
                  )}
                  {log.trace && Array.isArray(log.trace) && log.trace.length > 0 && (
                    <details className="log-trace">
                      <summary className="log-trace-toggle">Execution trace ({log.trace.length} entries)</summary>
                      <div className="log-trace-content">
                        {log.trace.map((t, i) => (
                          <div key={i} className={`log-trace-line ${t.startsWith && t.startsWith("ERROR") ? "log-trace-error" : ""}`}>
                            {t}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                  {log.aiTimeMs && (
                    <div className="log-details" style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                      AI: {log.aiTimeMs}ms{log.tokens ? ` · ${log.tokens} tokens` : ""}{log.docCount ? ` · ${log.docCount} doc(s)` : ""}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
