/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import React, { useState, useEffect } from "react";
import CustomSelect from "./CustomSelect";
import Tooltip from "./Tooltip";

const PROVIDER_OPTIONS = [
  { value: "openai", label: "OpenAI", icon: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M14.949 6.547a3.94 3.94 0 0 0-.348-3.273 4.11 4.11 0 0 0-4.4-1.934 4.1 4.1 0 0 0-1.778-.14 4.15 4.15 0 0 0-2.118-.114 4.1 4.1 0 0 0-1.891.948 4.04 4.04 0 0 0-1.158 1.753 4.1 4.1 0 0 0-1.563.679 4 4 0 0 0-1.14 1.253.99 3.99 0 0 0 .502 4.731 3.94 3.94 0 0 0 .346 3.274 4.11 4.11 0 0 0 4.402 1.933c.382.425.852.764 1.377.995.526.231 1.095.35 1.67.346 1.78.002 3.358-1.132 3.901-2.804a4.1 4.1 0 0 0 1.563-.68 4 4 0 0 0 1.14-1.253 3.99 3.99 0 0 0-.506-4.716m-6.097 8.406a3.05 3.05 0 0 1-1.945-.694l.096-.054 3.23-1.838a.53.53 0 0 0 .265-.455v-4.49l1.366.778q.02.011.025.035v3.722c-.003 1.653-1.361 2.992-3.037 2.996m-6.53-2.75a2.95 2.95 0 0 1-.36-2.01l.095.057L5.29 12.09a.53.53 0 0 0 .527 0l3.949-2.246v1.555a.05.05 0 0 1-.022.041L6.473 13.3c-1.454.826-3.311.335-4.15-1.098m-.85-6.94A3.02 3.02 0 0 1 3.07 3.949v3.785a.51.51 0 0 0 .262.451l3.93 2.237-1.366.779a.05.05 0 0 1-.048 0L2.585 9.342a2.98 2.98 0 0 1-1.113-4.094zm11.216 2.571L8.747 5.576l1.362-.776a.05.05 0 0 1 .048 0l3.265 1.86a3 3 0 0 1 1.173 1.207 2.96 2.96 0 0 1-.27 3.2 3.05 3.05 0 0 1-1.36.997V8.279a.52.52 0 0 0-.276-.445m1.36-2.015-.097-.057-3.226-1.855a.53.53 0 0 0-.53 0L6.249 6.153V4.598a.04.04 0 0 1 .019-.04L9.533 2.7a3.07 3.07 0 0 1 3.257.139c.474.325.843.778 1.066 1.303.223.526.289 1.103.191 1.664zM5.503 8.575 4.139 7.8a.05.05 0 0 1-.026-.037V4.049c0-.57.166-1.127.476-1.607s.752-.864 1.275-1.105a3.08 3.08 0 0 1 3.234.41l-.096.054-3.23 1.838a.53.53 0 0 0-.265.455zm.742-1.577 1.758-1 1.762 1v2l-1.755 1-1.762-1z"/></svg>' },
  { value: "azure", label: "Azure OpenAI", icon: '<svg viewBox="0 0 96 96" fill="currentColor"><path d="M33.338 6.544h26.038l-27.03 80.087a4.152 4.152 0 0 1-3.933 2.824H8.149a4.145 4.145 0 0 1-3.928-5.47L29.404 9.368a4.152 4.152 0 0 1 3.934-2.825z" opacity="0.8"/><path d="M71.175 60.261h-41.29a1.911 1.911 0 0 0-1.305 3.309l26.532 24.764a4.171 4.171 0 0 0 2.846 1.121h23.38z" opacity="0.6"/><path d="M33.338 6.544a4.118 4.118 0 0 0-3.943 2.879L4.252 83.917a4.14 4.14 0 0 0 3.908 5.538h20.787a4.443 4.443 0 0 0 3.41-2.9l5.014-14.777 17.91 16.705a4.237 4.237 0 0 0 2.666.972H81.24L71.024 60.261l-29.781.007L59.47 6.544z" opacity="0.9"/></svg>' },
  { value: "openrouter", label: "OpenRouter", icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.778 1.844v1.919q-.569-.026-1.138-.032-.708-.008-1.415.037c-1.93.126-4.023.728-6.149 2.237-2.911 2.066-2.731 1.95-4.14 2.75-.396.223-1.342.574-2.185.798-.841.225-1.753.333-1.751.333v4.229s.768.108 1.61.333c.842.224 1.789.575 2.185.799 1.41.798 1.228.683 4.14 2.75 2.126 1.509 4.22 2.11 6.148 2.236.88.058 1.716.041 2.555.005v1.918l7.222-4.168-7.222-4.17v2.176c-.86.038-1.611.065-2.278.021-1.364-.09-2.417-.357-3.979-1.465-2.244-1.593-2.866-2.027-3.68-2.508.889-.518 1.449-.906 3.822-2.59 1.56-1.109 2.614-1.377 3.978-1.466.667-.044 1.418-.017 2.278.02v2.176L24 6.014Z"/></svg>' },
  { value: "anthropic", label: "Anthropic", icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z"/></svg>' },
  { value: "lmstudio", label: "LM Studio", icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="14" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M7 8h2v3H7zM11 8h2v3h-2zM15 8h2v3h-2z"/></svg>' },
];

const PROVIDER_HELP = {
  openai: { keyPlaceholder: "sk-...", keyLabel: "OpenAI API Key", endpointNeeded: false },
  azure: { keyPlaceholder: "Enter your Azure OpenAI API key...", keyLabel: "Azure API Key", endpointNeeded: true, endpointPlaceholder: "https://myresource.openai.azure.com/openai/v1" },
  openrouter: { keyPlaceholder: "sk-or-...", keyLabel: "OpenRouter API Key", endpointNeeded: false },
  anthropic: { keyPlaceholder: "sk-ant-...", keyLabel: "Anthropic API Key", endpointNeeded: false },
  lmstudio: {
    keyPlaceholder: "Optional: Bearer token from LM Studio Developer page",
    keyLabel: "API Token (optional)",
    endpointNeeded: true,
    endpointPlaceholder: "https://your-machine.tailXXXX.ts.net",
    keyOptional: true,
  },
};

export default function OpenAIConfig({ invoke }) {
  const [provider, setProvider] = useState("openai");
  const [savedProvider, setSavedProvider] = useState("openai"); // what's actually saved in KVS
  const [baseUrl, setBaseUrl] = useState("");
  const [isByok, setIsByok] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  // LM Studio: token is OPTIONAL; isByok is true once the baseUrl is set, but we need
  // a separate flag to know whether a Bearer token has actually been saved — otherwise
  // the UI would mask a non-existent key and hide the input.
  const [hasToken, setHasToken] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [endpointInput, setEndpointInput] = useState("");
  const [models, setModels] = useState([]);
  const [modelDetails, setModelDetails] = useState([]); // LM Studio enriched metadata
  const [currentModel, setCurrentModel] = useState(null);
  const [selectedModel, setSelectedModel] = useState("");
  const [factoryModel, setFactoryModel] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingProvider, setSavingProvider] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  // LM Studio: connection test + model load
  const [pinging, setPinging] = useState(false);
  const [pingResult, setPingResult] = useState(null); // { ok, modelCount, authOk, message } | { error }
  const [loadingLmModel, setLoadingLmModel] = useState(false);
  // LM Studio MCP integrations — fixed set of 3 (context7, web-search, doc-reader).
  // Other MCPs in the user's mcp.json are NOT exposed by us per design.
  const [mcpEnabled, setMcpEnabled] = useState({ context7: false, webSearch: false, docReader: false, docWriter: false });
  const [mcpSavingKey, setMcpSavingKey] = useState(null); // which key is currently saving
  const [mcpExpanded, setMcpExpanded] = useState({}); // which setup panels are open
  const [mcpPingState, setMcpPingState] = useState({}); // {[key]: {loading, ok, error}}
  // Hosted doc-processor (remote MCP). Used by Anthropic natively (mcp_servers
  // field) and by LM Studio when the user's mcp.json is the remote variant
  // (no CogniRunner code change for that case — just the same URL+bearer).
  const [docProcUrl, setDocProcUrl] = useState("");
  const [docProcBearerInput, setDocProcBearerInput] = useState("");
  const [docProcHasBearer, setDocProcHasBearer] = useState(false);
  const [docProcSaving, setDocProcSaving] = useState(false);
  const [docProcShowBearerInput, setDocProcShowBearerInput] = useState(false);
  // Hosted web-search (remote MCP). Same pattern as docProc above; separate KVS
  // slot so each MCP service can be hosted at a different URL/Bearer.
  const [webSearchUrl, setWebSearchUrl] = useState("");
  const [webSearchBearerInput, setWebSearchBearerInput] = useState("");
  const [webSearchHasBearer, setWebSearchHasBearer] = useState(false);
  const [webSearchSaving, setWebSearchSaving] = useState(false);
  const [webSearchShowBearerInput, setWebSearchShowBearerInput] = useState(false);
  // Serper key for the keyless web-search MCP — the admin supplies it here.
  const [webSearchSerperInput, setWebSearchSerperInput] = useState("");
  const [webSearchHasSerper, setWebSearchHasSerper] = useState(false);
  const [webSearchShowSerperInput, setWebSearchShowSerperInput] = useState(false);

  const pHelp = PROVIDER_HELP[provider] || PROVIDER_HELP.openai;
  const isLmStudio = provider === "lmstudio";

  // For LM Studio, find metadata for the currently-selected model so we can show
  // "Loaded" / "Cold" badge + enable/disable the Load button.
  const selectedModelMeta = isLmStudio && selectedModel
    ? modelDetails.find((m) => m.id === selectedModel)
    : null;

  const loadStatus = async () => {
    if (!invoke) return;
    try {
      const [keyResult, modelsResult, modelKvs, providerResult, mcpsResult, docProcResult, webSearchResult] = await Promise.all([
        invoke("getOpenAIKey"),
        invoke("getOpenAIModels"),
        invoke("getOpenAIModelFromKVS"),
        invoke("getProvider"),
        invoke("getLmStudioMcps").catch(() => ({ success: false })),
        invoke("getDocProcessorRemote").catch(() => ({ success: false })),
        invoke("getWebSearchRemote").catch(() => ({ success: false })),
      ]);

      if (providerResult.success) {
        const p = providerResult.provider || "openai";
        setProvider(p);
        setSavedProvider(p);
        setBaseUrl(providerResult.baseUrl || "");
        // Both Azure and LM Studio use a user-supplied base URL — show it in the input.
        setEndpointInput(
          (providerResult.provider === "azure" || providerResult.provider === "lmstudio")
            ? (providerResult.baseUrl || "")
            : ""
        );
      }
      if (keyResult.success) {
        setHasKey(keyResult.hasKey);
        setIsByok(keyResult.isByok);
        // For LM Studio, hasToken reflects whether a Bearer token is actually saved
        // (separate from isByok which just means "URL is configured").
        setHasToken(!!keyResult.hasToken);
      }
      if (modelsResult.success) {
        setModels(modelsResult.models || []);
        setModelDetails(modelsResult.modelDetails || []);
        if (!modelsResult.isByok) {
          setFactoryModel(modelsResult.currentModel || "");
        }
      }
      if (modelKvs.success) {
        setCurrentModel(modelKvs.model);
        // Always reset selectedModel to the saved value (or empty) — without an else
        // branch, a stale value from a previous provider would persist after switching.
        setSelectedModel(modelKvs.model || "");
        if (modelKvs.model) {
          /* keep parity with the unconditional set above */
        }
        if (!modelKvs.isByok) {
          setFactoryModel(modelKvs.model || "");
        }
      }
      if (mcpsResult && mcpsResult.success) {
        setMcpEnabled(mcpsResult.enabled || { context7: false, webSearch: false, docReader: false, docWriter: false });
      }
      if (docProcResult && docProcResult.success) {
        setDocProcUrl(docProcResult.url || "");
        setDocProcHasBearer(!!docProcResult.hasBearer);
      }
      if (webSearchResult && webSearchResult.success) {
        setWebSearchUrl(webSearchResult.url || "");
        setWebSearchHasBearer(!!webSearchResult.hasBearer);
        setWebSearchHasSerper(!!webSearchResult.hasSerperKey);
      }
    } catch (e) {
      console.error("Failed to load AI config status:", e);
    }
    setLoading(false);
  };

  // Toggle one MCP — saves immediately so the user doesn't have to click an
  // extra Save button. Optimistic UI: flip locally first, persist, revert on error.
  const handleMcpToggle = async (mcpKey) => {
    if (!invoke) return;
    let next = { ...mcpEnabled, [mcpKey]: !mcpEnabled[mcpKey] };
    // docWriter is a sub-capability of docReader: turning docReader OFF forces
    // docWriter OFF too (backend clamps the same way; this keeps the UI synced
    // without waiting for the round-trip).
    if (mcpKey === "docReader" && !next.docReader) {
      next = { ...next, docWriter: false };
    }
    setMcpEnabled(next);
    setMcpSavingKey(mcpKey);
    setError(null);
    try {
      const result = await invoke("saveLmStudioMcps", { enabled: next });
      if (!result.success) {
        // Revert on failure
        setMcpEnabled(mcpEnabled);
        setError(result.error || "Failed to save MCP setting");
      }
    } catch (e) {
      setMcpEnabled(mcpEnabled);
      setError("Failed to save MCP setting: " + e.message);
    }
    setMcpSavingKey(null);
  };

  const handleMcpPing = async (mcpKey) => {
    if (!invoke) return;
    setMcpPingState((prev) => ({ ...prev, [mcpKey]: { loading: true } }));
    try {
      const result = await invoke("pingLmStudioMcp", { mcpKey });
      setMcpPingState((prev) => ({
        ...prev,
        [mcpKey]: {
          loading: false,
          ok: result.success && result.ok,
          error: result.error,
          message: result.message,
        },
      }));
    } catch (e) {
      setMcpPingState((prev) => ({
        ...prev,
        [mcpKey]: { loading: false, ok: false, error: e.message },
      }));
    }
  };

  const handleSaveDocProcRemote = async () => {
    if (!invoke) return;
    if (!docProcUrl.trim() || !docProcBearerInput.trim()) return;
    setDocProcSaving(true);
    setError(null);
    try {
      const result = await invoke("saveDocProcessorRemote", {
        url: docProcUrl.trim(),
        bearer: docProcBearerInput.trim(),
      });
      if (result.success) {
        setDocProcHasBearer(true);
        setDocProcBearerInput("");
        setDocProcShowBearerInput(false);
      } else {
        setError(result.error || "Failed to save doc-processor remote config");
      }
    } catch (e) {
      setError("Failed to save doc-processor remote config: " + e.message);
    }
    setDocProcSaving(false);
  };

  const handleRemoveDocProcRemote = async () => {
    if (!invoke) return;
    setDocProcSaving(true);
    setError(null);
    try {
      const result = await invoke("removeDocProcessorRemote");
      if (result.success) {
        setDocProcUrl("");
        setDocProcHasBearer(false);
        setDocProcBearerInput("");
        setDocProcShowBearerInput(false);
      } else {
        setError(result.error || "Failed to remove doc-processor remote config");
      }
    } catch (e) {
      setError("Failed to remove doc-processor remote config: " + e.message);
    }
    setDocProcSaving(false);
  };

  const handleSaveWebSearchRemote = async () => {
    if (!invoke) return;
    if (!webSearchUrl.trim() || !webSearchBearerInput.trim()) return;
    setWebSearchSaving(true);
    setError(null);
    try {
      const result = await invoke("saveWebSearchRemote", {
        url: webSearchUrl.trim(),
        bearer: webSearchBearerInput.trim(),
        serperKey: webSearchSerperInput.trim(),
      });
      if (result.success) {
        setWebSearchHasBearer(true);
        setWebSearchBearerInput("");
        setWebSearchShowBearerInput(false);
        setWebSearchHasSerper(!!result.hasSerperKey);
        setWebSearchSerperInput("");
        setWebSearchShowSerperInput(false);
      } else {
        setError(result.error || "Failed to save web-search remote config");
      }
    } catch (e) {
      setError("Failed to save web-search remote config: " + e.message);
    }
    setWebSearchSaving(false);
  };

  const handleRemoveWebSearchRemote = async () => {
    if (!invoke) return;
    setWebSearchSaving(true);
    setError(null);
    try {
      const result = await invoke("removeWebSearchRemote");
      if (result.success) {
        setWebSearchUrl("");
        setWebSearchHasBearer(false);
        setWebSearchBearerInput("");
        setWebSearchShowBearerInput(false);
        setWebSearchHasSerper(false);
        setWebSearchSerperInput("");
        setWebSearchShowSerperInput(false);
      } else {
        setError(result.error || "Failed to remove web-search remote config");
      }
    } catch (e) {
      setError("Failed to remove web-search remote config: " + e.message);
    }
    setWebSearchSaving(false);
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const handleSaveProvider = async () => {
    setSavingProvider(true);
    setError(null);
    setSuccess(null);
    setPingResult(null);
    try {
      const payload = { provider };
      // Both Azure and LM Studio require a user-supplied base URL.
      if ((provider === "azure" || provider === "lmstudio") && endpointInput.trim()) {
        payload.baseUrl = endpointInput.trim();
      }
      const result = await invoke("saveProvider", payload);
      if (result.success) {
        setSavedProvider(provider);
        setKeyInput("");
        await new Promise((r) => setTimeout(r, 500));
        await loadStatus();
        // For LM Studio: auto-ping right after switch so the user sees actual
        // connection state (including 401 → "token required") instead of a
        // misleading "Switched successfully" message followed by a broken UI.
        if (provider === "lmstudio") {
          const ping = await runLmStudioPing({ silent: true });
          if (ping?.success && ping.ok && ping.authOk) {
            setSuccess(`Switched to LM Studio — connected, ${ping.modelCount || 0} model(s) found.`);
          } else if (ping?.tokenRequired) {
            setError(ping.error);
          } else if (ping?.tokenInvalid) {
            setError(ping.error);
          } else if (ping && !ping.success) {
            setError(ping.error || "Switched to LM Studio but connection test failed.");
          } else {
            setSuccess("Switched to LM Studio.");
          }
        } else {
          setSuccess(`Switched to ${PROVIDER_OPTIONS.find((p) => p.value === provider)?.label || provider}`);
        }
      } else {
        setError(result.error || "Failed to save provider");
      }
    } catch (e) {
      setError("Failed to save provider: " + e.message);
    }
    setSavingProvider(false);
  };

  const handleSaveEndpoint = async () => {
    if (!endpointInput.trim()) return;
    setSavingProvider(true);
    setError(null);
    setSuccess(null);
    setPingResult(null);
    try {
      const result = await invoke("saveProvider", { provider, baseUrl: endpointInput.trim() });
      if (result.success) {
        await loadStatus();
        // For LM Studio, immediately verify connectivity so the user knows whether
        // their token (or lack of one) is accepted. The status block + token field
        // both react to the ping result.
        if (provider === "lmstudio") {
          const ping = await runLmStudioPing({ silent: true });
          if (ping?.success && ping.ok && ping.authOk) {
            setSuccess(`Endpoint saved — connected, ${ping.modelCount || 0} model(s) found.`);
          } else if (ping?.tokenRequired) {
            setError(ping.error);
          } else if (ping?.tokenInvalid) {
            setError(ping.error);
          } else if (ping && !ping.success) {
            setError(ping.error || "Endpoint saved but connection test failed.");
          } else {
            setSuccess("Endpoint saved.");
          }
        } else {
          setSuccess(`${PROVIDER_OPTIONS.find((p) => p.value === provider)?.label || provider} endpoint saved`);
        }
      } else {
        setError(result.error || "Failed to save endpoint");
      }
    } catch (e) {
      setError("Failed to save endpoint: " + e.message);
    }
    setSavingProvider(false);
  };

  // LM Studio: ping the user's tunnel to verify reachability + auth.
  // Used by both the explicit "Test" button and the auto-ping after save flows.
  // The `silent` flag suppresses success/error toasts when called automatically
  // after Save (we don't want to spam the user with "Test passed" on every save).
  const runLmStudioPing = async ({ baseUrlOverride, tokenOverride, silent } = {}) => {
    const url = (baseUrlOverride ?? endpointInput).trim();
    if (!url) return null;
    if (!silent) {
      setPinging(true);
      setError(null);
      setSuccess(null);
    }
    setPingResult(null);
    try {
      const result = await invoke("pingLmStudio", {
        baseUrl: url,
        apiKey: (tokenOverride ?? keyInput).trim(),
      });
      // Always store the ping result so the UI status block can reflect actual state.
      setPingResult(result);
      if (!silent) {
        if (result.success && result.ok && result.authOk) {
          setSuccess(result.message || `Connected — ${result.modelCount || 0} model(s) found.`);
        } else if (result.tokenRequired) {
          setError(result.error);
        } else if (result.tokenInvalid) {
          setError(result.error);
        } else if (!result.success) {
          setError(result.error || "Connection test failed");
        } else if (!result.authOk) {
          setError(`Reachable, but inference failed: ${result.pingError || "unknown"}. Check your token.`);
        }
      }
      return result;
    } catch (e) {
      if (!silent) setError("Test failed: " + e.message);
      return null;
    } finally {
      if (!silent) setPinging(false);
    }
  };

  const handleTestConnection = () => runLmStudioPing();

  // LM Studio: preload the chosen model so first inference doesn't pay JIT cold-start.
  const handleLoadLmModel = async () => {
    if (!selectedModel) return;
    setLoadingLmModel(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await invoke("loadLmStudioModel", { model: selectedModel });
      if (result.success) {
        setSuccess(result.message || `Loaded "${selectedModel}"`);
        // Refresh model state so the badge updates.
        await loadStatus();
      } else {
        setError(result.error || "Failed to load model");
      }
    } catch (e) {
      setError("Failed to load model: " + e.message);
    }
    setLoadingLmModel(false);
  };

  const handleSaveKey = async () => {
    if (!keyInput.trim()) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const tokenJustSaved = keyInput.trim();
      const result = await invoke("saveOpenAIKey", { key: tokenJustSaved });
      if (result.success) {
        setKeyInput("");
        // Brief delay to let KVS propagate, then reload status + models
        await new Promise((r) => setTimeout(r, 500));
        await loadStatus();
        // For LM Studio, re-ping with the just-saved token to confirm it works
        // and surface the actual model count. Using tokenOverride because keyInput
        // was just cleared above.
        if (isLmStudio) {
          const ping = await runLmStudioPing({ tokenOverride: tokenJustSaved, silent: true });
          if (ping?.success && ping.ok && ping.authOk) {
            setSuccess(`Token saved — connected, ${ping.modelCount || 0} model(s) found.`);
          } else if (ping?.tokenInvalid) {
            setError(ping.error);
          } else if (ping && !ping.success) {
            setError(ping.error || "Token saved but connection test failed.");
          } else {
            setSuccess("Token saved.");
          }
        } else {
          setSuccess("API key saved successfully");
        }
      } else {
        setError(result.error || "Failed to save key");
      }
    } catch (e) {
      setError("Failed to save key: " + e.message);
    }
    setSaving(false);
  };

  const handleRemoveKey = async () => {
    setRemoving(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await invoke("removeOpenAIKey");
      if (result.success) {
        setSuccess("Reverted to factory key");
        setModels([]);
        setCurrentModel(null);
        setSelectedModel("");
        await loadStatus();
      } else {
        setError(result.error || "Failed to remove key");
      }
    } catch (e) {
      setError("Failed to remove key: " + e.message);
    }
    setRemoving(false);
  };

  const handleSaveModel = async () => {
    if (!selectedModel) return;
    setSavingModel(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await invoke("saveOpenAIModel", { model: selectedModel });
      if (result.success) {
        setCurrentModel(selectedModel);
        setSuccess("Model saved: " + selectedModel);
      } else {
        setError(result.error || "Failed to save model");
      }
    } catch (e) {
      setError("Failed to save model: " + e.message);
    }
    setSavingModel(false);
  };

  if (loading) {
    return (
      <div className="section">
        <div className="section-header">
          <span className="section-title">AI Provider Configuration</span>
        </div>
        <div className="card">
          <div style={{ padding: "16px" }}>
            {/* Provider selector skeleton */}
            <div style={{ marginBottom: "16px" }}>
              <div className="sk sk-text" style={{ width: 60, height: 10, marginBottom: 6 }} />
              <div className="sk sk-block" style={{ width: 280, height: 36, borderRadius: 10 }} />
            </div>
            {/* Status skeleton */}
            <div style={{ marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: 4 }}>
                <div className="sk" style={{ width: 8, height: 8, borderRadius: "50%" }} />
                <div className="sk sk-text" style={{ width: 140, height: 13 }} />
              </div>
              <div className="sk sk-text" style={{ width: "80%", height: 10 }} />
            </div>
            {/* Key input skeleton */}
            <div style={{ marginBottom: "16px" }}>
              <div className="sk sk-text" style={{ width: 80, height: 10, marginBottom: 6 }} />
              <div style={{ display: "flex", gap: "8px" }}>
                <div className="sk sk-block" style={{ flex: 1, height: 36, borderRadius: 10 }} />
                <div className="sk sk-block" style={{ width: 90, height: 36, borderRadius: 10 }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const providerLabel = PROVIDER_OPTIONS.find((p) => p.value === provider)?.label || provider;

  return (
    <div className="section">
      <div className="section-header">
        <span className="section-title">AI Provider Configuration</span>
      </div>

      {error && (
        <div className="alert alert-error">
          <span>{error}</span>
          <button className="alert-dismiss" onClick={() => setError(null)}>&times;</button>
        </div>
      )}
      {success && (
        <div className="alert alert-success">
          <span>{success}</span>
          <button className="alert-dismiss" onClick={() => setSuccess(null)}>&times;</button>
        </div>
      )}

      <div className="card">
        <div style={{ padding: "16px" }}>
          {/* Provider Selector */}
          <div style={{ marginBottom: "16px" }}>
            <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", marginBottom: "6px" }}>
              Provider
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div style={{ maxWidth: "280px", flex: "0 0 280px" }}>
                <CustomSelect
                  value={provider}
                  onChange={setProvider}
                  options={PROVIDER_OPTIONS}
                  disabled={savingProvider}
                />
              </div>
              {provider !== savedProvider && (
                <button
                  className="btn-small btn-edit"
                  onClick={handleSaveProvider}
                  // For LM Studio, the backend requires a baseUrl on switch — disable
                  // the button until the user enters one so they don't get the
                  // "LM Studio requires a public base URL" error after clicking.
                  disabled={savingProvider || (provider === "lmstudio" && !endpointInput.trim())}
                  title={provider === "lmstudio" && !endpointInput.trim()
                    ? "Enter your Tailscale Funnel URL below first"
                    : undefined}
                >
                  {savingProvider ? "Switching..." : "Switch Provider"}
                </button>
              )}
            </div>
            {provider !== savedProvider && (
              <p style={{ margin: "4px 0 0 0", fontSize: "11px", color: "var(--primary-color)" }}>
                Your keys are saved per provider. Switching back will restore your previous key.
              </p>
            )}
            <p style={{ margin: "4px 0 0 0", fontSize: "11px", color: "var(--text-muted)" }}>
              All providers support chat completions, tool calling, and vision capabilities.
            </p>
          </div>

          {/* Azure Endpoint — only for Azure */}
          {provider === "azure" && (
            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "flex", alignItems: "center", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", marginBottom: "6px" }}>
                Azure Endpoint
                <Tooltip text={
                  "How to get your Azure OpenAI endpoint:\n\n" +
                  "1. Go to portal.azure.com\n" +
                  "2. Navigate to your Azure OpenAI resource (or create one under 'Azure AI services' > 'Azure OpenAI')\n" +
                  "3. In the resource overview, find 'Endpoint' — it looks like:\n" +
                  "   https://myresource.openai.azure.com/\n" +
                  "4. Append /openai/v1 to the end, so the full URL is:\n" +
                  "   https://myresource.openai.azure.com/openai/v1\n\n" +
                  "Make sure you have at least one model deployed in Azure AI Studio (e.g. gpt-4o or gpt-4o-mini) before connecting."
                } />
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <input
                  type="text"
                  value={endpointInput}
                  onChange={(e) => setEndpointInput(e.target.value)}
                  placeholder={pHelp.endpointPlaceholder}
                  style={{
                    flex: 1,
                    padding: "8px 12px",
                    border: "1px solid var(--border-color)",
                    borderRadius: "4px",
                    background: "var(--input-bg)",
                    color: "var(--text-color)",
                    fontSize: "13px",
                    fontFamily: "SFMono-Regular, Consolas, monospace",
                  }}
                  onKeyDown={(e) => e.key === "Enter" && handleSaveEndpoint()}
                />
                <button className="btn-small btn-edit" onClick={handleSaveEndpoint} disabled={savingProvider || !endpointInput.trim()}>
                  {savingProvider ? "Saving..." : "Save"}
                </button>
              </div>
              <p style={{ margin: "4px 0 0 0", fontSize: "11px", color: "var(--text-muted)" }}>
                Your Azure OpenAI resource URL. Must end with <code style={{ fontSize: "11px" }}>/openai/v1</code>
              </p>
            </div>
          )}

          {/* LM Studio Endpoint — user-hosted public tunnel URL.
              Shown whenever LM Studio is selected (not just when saved) so the user
              can enter the URL BEFORE clicking "Switch Provider". Without this,
              switching fails because the backend requires a baseUrl to validate. */}
          {isLmStudio && (
            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "flex", alignItems: "center", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", marginBottom: "6px" }}>
                LM Studio Public URL
                <Tooltip text={
                  "How to expose LM Studio to Forge via Tailscale Funnel:\n\n" +
                  "1. In LM Studio, open Settings → Developer and toggle 'Serve on Local Network' ON.\n" +
                  "2. Install Tailscale on the machine running LM Studio and join your tailnet.\n" +
                  "3. Enable Funnel for port 1234:\n" +
                  "   sudo tailscale funnel 1234\n" +
                  "   (or use the GUI: Tailscale menu → Serve & Funnel)\n" +
                  "4. Copy the public HTTPS URL Tailscale prints (looks like https://your-machine.tailXXXX.ts.net) and paste it here.\n" +
                  "5. REQUIRED for safety: in LM Studio's Developer page, enable authentication and create an API token. Paste it in the 'API Token' field below — without a token, anyone who finds your URL can use your LM Studio server.\n\n" +
                  "Only *.ts.net (Tailscale Funnel) is allowlisted in the app's egress. Other tunnel providers (ngrok, Cloudflare Tunnel) will not work — requests would be blocked by Forge before leaving the cloud."
                } />
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <input
                  type="text"
                  value={endpointInput}
                  onChange={(e) => setEndpointInput(e.target.value)}
                  placeholder={pHelp.endpointPlaceholder}
                  style={{
                    flex: 1,
                    padding: "8px 12px",
                    border: "1px solid var(--border-color)",
                    borderRadius: "4px",
                    background: "var(--input-bg)",
                    color: "var(--text-color)",
                    fontSize: "13px",
                    fontFamily: "SFMono-Regular, Consolas, monospace",
                  }}
                  onKeyDown={(e) => e.key === "Enter" && handleSaveEndpoint()}
                />
                <button
                  className="btn-small"
                  onClick={handleTestConnection}
                  disabled={pinging || !endpointInput.trim()}
                  style={{ padding: "6px 10px" }}
                >
                  {pinging ? "Testing..." : "Test"}
                </button>
                <button className="btn-small btn-edit" onClick={handleSaveEndpoint} disabled={savingProvider || !endpointInput.trim()}>
                  {savingProvider ? "Saving..." : "Save"}
                </button>
              </div>
              <p style={{ margin: "4px 0 0 0", fontSize: "11px", color: "var(--text-muted)" }}>
                Tunnel root URL — the base, not a specific endpoint path. We'll append <code style={{ fontSize: "11px" }}>/v1</code> for inference and <code style={{ fontSize: "11px" }}>/api/v1</code> for model management.
              </p>
              {pingResult && pingResult.ok && (
                <p style={{
                  margin: "6px 0 0 0",
                  fontSize: "11px",
                  color: pingResult.authOk ? "var(--success-color)" : "var(--error-color)",
                }}>
                  {pingResult.authOk ? "✓ " : "⚠ "}{pingResult.message}
                </p>
              )}
            </div>
          )}

          {/* Key/Model section — only show for the saved (active) provider */}
          {provider !== savedProvider ? (
            <div style={{ padding: "12px 0", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>
              Click <strong>Switch Provider</strong> to activate {PROVIDER_OPTIONS.find((p) => p.value === provider)?.label || provider} and manage its API key.
            </div>
          ) : (<>

          {/* Status — for LM Studio, reflect ACTUAL ping result instead of just
              "URL is set". A green dot only when we've confirmed the server responds
              and accepts our auth (or has no auth requirement). */}
          {(() => {
            // Compute LM Studio status from pingResult
            let lmStatusColor = "var(--text-muted)";
            let lmStatusTitle = "LM Studio URL not set";
            let lmStatusBody = "Set the Tailscale Funnel URL above (https://*.ts.net pointing at your LM Studio server) to get started.";
            if (isLmStudio && hasKey) {
              if (!pingResult) {
                lmStatusColor = "var(--text-muted)";
                lmStatusTitle = "URL saved — not yet tested";
                lmStatusBody = "Click Test (above) or Save again to verify the connection.";
              } else if (pingResult.tokenRequired) {
                lmStatusColor = "var(--error-color)";
                lmStatusTitle = "Reachable, but token required";
                lmStatusBody = "Your LM Studio server requires an API token. Paste it in the field below.";
              } else if (pingResult.tokenInvalid) {
                lmStatusColor = "var(--error-color)";
                lmStatusTitle = "Reachable, but token rejected";
                lmStatusBody = "The token below is invalid or expired. Generate a new one in LM Studio's Developer page and update it.";
              } else if (!pingResult.success || !pingResult.ok) {
                lmStatusColor = "var(--error-color)";
                lmStatusTitle = "Cannot reach your LM Studio server";
                lmStatusBody = pingResult.error || "Check that the tunnel is up and the URL is correct.";
              } else if (!pingResult.authOk) {
                lmStatusColor = "#d97706";
                lmStatusTitle = "Reachable, but inference test failed";
                lmStatusBody = `Models list returned, but a test chat call failed: ${pingResult.pingError || "unknown"}.`;
              } else {
                lmStatusColor = "var(--success-color)";
                lmStatusTitle = `Connected — ${pingResult.modelCount || 0} model(s) available`;
                lmStatusBody = "Inference and field data stay on your machine. Pick a model below.";
              }
            }
            return (
              <div className="openai-status" style={{ marginBottom: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                  <span style={{
                    display: "inline-block",
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    background: isLmStudio ? lmStatusColor : (hasKey ? "var(--success-color)" : "var(--error-color)"),
                  }} />
                  <strong style={{ fontSize: "13px" }}>
                    {isLmStudio
                      ? lmStatusTitle
                      : (isByok ? `Using your ${providerLabel} key` : "Using factory key")}
                  </strong>
                </div>
                <p style={{ margin: 0, fontSize: "12px", color: "var(--text-secondary)" }}>
                  {isLmStudio
                    ? lmStatusBody
                    : isByok
                      ? `Connected to ${providerLabel}. You can select from available models. Remove the key to revert to the factory key.`
                      : hasKey
                        ? `Factory model: ${factoryModel || "gpt-5.4-mini"}. Provide your own ${providerLabel} key to unlock model selection.`
                        : `No API key configured. Provide your ${providerLabel} API key to get started.`
                  }
                </p>
              </div>
            );
          })()}

          {/* API Key Input */}
          <div style={{ marginBottom: "16px" }}>
            <label style={{ display: "flex", alignItems: "center", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", marginBottom: "6px" }}>
              {pHelp.keyLabel}
              {provider === "azure" && (
                <Tooltip text={
                  "How to get your Azure OpenAI API key:\n\n" +
                  "1. Go to portal.azure.com\n" +
                  "2. Open your Azure OpenAI resource\n" +
                  "3. In the left sidebar, click 'Keys and Endpoint' (under Resource Management)\n" +
                  "4. Copy either Key 1 or Key 2 — both work\n\n" +
                  "The key is a 32-character hex string (no 'sk-' prefix). Keep it secret — anyone with this key can use your Azure OpenAI quota."
                } />
              )}
              {provider === "openrouter" && (
                <Tooltip text={
                  "How to get your OpenRouter API key:\n\n" +
                  "1. Go to openrouter.ai and sign in\n" +
                  "2. Click your profile icon > 'Keys'\n" +
                  "3. Click 'Create Key', give it a name, and copy it\n\n" +
                  "OpenRouter keys start with 'sk-or-'. You'll need credits in your account to make API calls."
                } />
              )}
              {provider === "anthropic" && (
                <Tooltip text={
                  "How to get your Anthropic API key:\n\n" +
                  "1. Go to console.anthropic.com and sign in\n" +
                  "2. Click 'API Keys' in the left sidebar\n" +
                  "3. Click 'Create Key', give it a name, and copy it\n\n" +
                  "Anthropic keys start with 'sk-ant-'. You'll need credits or a billing plan to make API calls.\n\n" +
                  "Default model: Claude Haiku 4.5 (fastest, most affordable). You can switch to Sonnet or Opus for more capable models."
                } />
              )}
              {isLmStudio && (
                <Tooltip text={
                  "How to set up LM Studio API authentication (REQUIRED when exposing via Tailscale Funnel):\n\n" +
                  "1. Open LM Studio's Developer page (left sidebar).\n" +
                  "2. In Server Settings, toggle authentication ON.\n" +
                  "3. Click 'Manage Tokens' → 'Create Token', name it (e.g. 'cognirunner'), copy it immediately (LM Studio only shows it once).\n" +
                  "4. Paste it here.\n\n" +
                  "Without a token, anyone who discovers your *.ts.net URL can use your LM Studio server."
                } />
              )}
            </label>
            {/* For LM Studio the token is optional — gate the masked-vs-input render on
                whether a token has actually been saved (hasToken), NOT on isByok which
                is true the moment the baseUrl is set. Other providers keep the original
                isByok-based gate since their key is required. */}
            {(isLmStudio ? hasToken : isByok) ? (
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{
                  flex: 1,
                  padding: "8px 12px",
                  background: "var(--code-bg)",
                  borderRadius: "4px",
                  fontFamily: "SFMono-Regular, Consolas, monospace",
                  fontSize: "13px",
                  color: "var(--text-secondary)",
                  letterSpacing: "1px",
                }}>
                  ••••••••••••••••
                </span>
                <button className="btn-small btn-danger" onClick={handleRemoveKey} disabled={removing}>
                  {removing ? "Removing..." : "Remove Key"}
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <input
                  type="password"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder={pHelp.keyPlaceholder}
                  style={{
                    flex: 1,
                    padding: "8px 12px",
                    border: "1px solid var(--border-color)",
                    borderRadius: "4px",
                    background: "var(--input-bg)",
                    color: "var(--text-color)",
                    fontSize: "13px",
                    fontFamily: "SFMono-Regular, Consolas, monospace",
                  }}
                  onKeyDown={(e) => e.key === "Enter" && handleSaveKey()}
                />
                <button className="btn-small btn-edit" onClick={handleSaveKey} disabled={saving || !keyInput.trim()}>
                  {saving ? "Saving..." : "Save Key"}
                </button>
              </div>
            )}
          </div>

          {/* Model Selection — only when BYOK */}
          {isByok && (
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", marginBottom: "6px" }}>
                Model
              </label>
              {models.length === 0 ? (
                <p style={{ margin: 0, fontSize: "12px", color: "var(--text-muted)" }}>
                  {isLmStudio
                    ? "No models found. Make sure LM Studio has at least one LLM downloaded, then click Test above to retry."
                    : "No chat models found. Check your API key and try again."}
                </p>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div style={{ flex: 1 }}>
                    <CustomSelect
                      value={selectedModel}
                      onChange={setSelectedModel}
                      placeholder="Select a model..."
                      searchable
                      searchPlaceholder="Search models..."
                      options={isLmStudio && modelDetails.length > 0
                        ? modelDetails.map((m) => {
                            const parts = [];
                            // Capability badges — the parser normalizes vision/toolUse
                            // from LM Studio's capabilities object so we can show them
                            // regardless of which schema (api/v1, api/v0, v1) was used.
                            if (m.vision) parts.push("👁 vision");
                            if (m.toolUse) parts.push("🛠 tools");
                            if (m.state === "loaded") parts.push("loaded");
                            else if (m.state === "not-loaded") parts.push("cold");
                            if (m.quantization) parts.push(m.quantization);
                            if (m.max_context_length) parts.push(`${Math.round(m.max_context_length / 1024)}K ctx`);
                            const suffix = parts.length > 0 ? ` · ${parts.join(" · ")}` : "";
                            return { value: m.id, label: `${m.id}${suffix}` };
                          })
                        : models.map((m) => ({ value: m, label: m }))}
                    />
                  </div>
                  {isLmStudio && selectedModelMeta?.state === "not-loaded" && (
                    <button
                      className="btn-small"
                      onClick={handleLoadLmModel}
                      disabled={loadingLmModel || !selectedModel}
                      style={{ padding: "6px 10px" }}
                    >
                      {loadingLmModel ? "Loading..." : "Load"}
                    </button>
                  )}
                  <button
                    className="btn-small btn-edit"
                    onClick={handleSaveModel}
                    disabled={savingModel || !selectedModel || selectedModel === currentModel}
                  >
                    {savingModel ? "Saving..." : "Save Model"}
                  </button>
                </div>
              )}
              {isLmStudio && selectedModelMeta && (
                <p style={{ margin: "4px 0 0 0", fontSize: "11px", color: "var(--text-muted)" }}>
                  {selectedModelMeta.state === "loaded"
                    ? "✓ Model is loaded — first call will be fast."
                    : selectedModelMeta.state === "not-loaded"
                      ? "⚠ Model not loaded. First call will JIT-load it (10–60s cold start). Click Load to preload."
                      : null}
                  {selectedModelMeta.arch ? ` · ${selectedModelMeta.arch}` : ""}
                  {selectedModelMeta.vision
                    ? " · Vision-capable (can process Jira attachment images in validators)."
                    : " · Text-only — Jira attachment images will be ignored. Pick a 👁 vision model to process them."}
                  {!selectedModelMeta.toolUse && selectedModelMeta.toolUse !== undefined
                    ? " · Not trained for tool use — JQL agentic search may produce malformed calls; pick a 🛠 model for that."
                    : ""}
                </p>
              )}
              {currentModel && (
                <p style={{ margin: "4px 0 0 0", fontSize: "11px", color: "var(--text-muted)" }}>
                  Currently active: <strong>{currentModel}</strong>
                </p>
              )}
            </div>
          )}
          </>)}
        </div>
      </div>

      {/* MCP Integrations.
          - context7 is LM-Studio-only (requires a local stdio MCP process — not
            exposed via a hosted URL we can proxy).
          - doc-reader + web-search work on LM Studio (mcp.json), Anthropic
            (native mcp_servers field), AND OpenAI / Azure / OpenRouter, where
            CogniRunner acts as the MCP client and bridges the tool calls
            (the cross-provider hosted-MCP bridge). They need the hosted URL +
            bearer below (+ a Serper key for web-search). */}
      {provider === savedProvider && (
        <div className="card" style={{ marginTop: "16px" }}>
          <div style={{ padding: "16px" }}>
            <div style={{ marginBottom: "12px" }}>
              <h3 style={{ margin: "0 0 4px 0", fontSize: "14px", fontWeight: 600, color: "var(--text-color)" }}>
                MCP Integrations
              </h3>
              <p style={{ margin: 0, fontSize: "12px", color: "var(--text-secondary)" }}>
                {isLmStudio
                  ? <>Extra tools the model can call via your LM Studio's <code style={{ fontSize: "11px" }}>mcp.json</code>. Enable each and follow the setup steps. JQL agentic search is unaffected — it runs on a separate code path.</>
                  : <>Tools the model can call. Configure the hosted <code style={{ fontSize: "11px" }}>doc-processor</code> / <code style={{ fontSize: "11px" }}>web-search</code> below, then enable doc-reader / web-search — they work on Anthropic (native) and on OpenAI / Azure / OpenRouter, where CogniRunner bridges the tool calls. Only <code style={{ fontSize: "11px" }}>context7</code> stays LM-Studio-only (it needs a local process).</>
                }
              </p>
            </div>

            {/* context7 — LM Studio only */}
            {isLmStudio && (
            <McpCard
              mcpKey="context7"
              title="context7"
              subtitle="Up-to-date library / framework / SDK docs"
              tools={["resolve-library-id", "query-docs"]}
              enabled={mcpEnabled.context7}
              saving={mcpSavingKey === "context7"}
              expanded={!!mcpExpanded.context7}
              ping={mcpPingState.context7}
              onToggle={() => handleMcpToggle("context7")}
              onExpand={() => setMcpExpanded((p) => ({ ...p, context7: !p.context7 }))}
              onPing={() => handleMcpPing("context7")}
              setupBlock={(
                <>
                  <p style={{ margin: "0 0 8px", fontSize: "12px", color: "var(--text-secondary)" }}>
                    Get a free API key at <code style={{ fontSize: "11px" }}>context7.com/dashboard</code> (higher rate limits — works without one too).
                  </p>
                  <p style={{ margin: "0 0 8px", fontSize: "12px", color: "var(--text-secondary)" }}>
                    Add this to your LM Studio <code style={{ fontSize: "11px" }}>mcp.json</code> (the entry name <strong>must</strong> be <code style={{ fontSize: "11px" }}>context7</code> so our app can find it):
                  </p>
                  <pre style={{ margin: 0, padding: "10px", background: "var(--code-bg)", borderRadius: "6px", fontSize: "11px", overflow: "auto", color: "var(--text-color)" }}>
{`"context7": {
  "url": "https://mcp.context7.com/mcp",
  "headers": {
    "CONTEXT7_API_KEY": "YOUR_API_KEY_HERE"
  }
}`}
                  </pre>
                  <p style={{ margin: "8px 0 0", fontSize: "11px", color: "var(--text-muted)" }}>
                    GitHub: <code style={{ fontSize: "11px" }}>github.com/upstash/context7</code>
                  </p>
                </>
              )}
            />
            )}

            {/* web-search — visible for ALL providers (LM Studio uses local
                or remote mcp.json; Anthropic uses native mcp_servers; OpenAI /
                Azure / OpenRouter use the cross-provider bridge — CogniRunner
                proxies the tool calls). */}
            <McpCard
              mcpKey="webSearch"
              title="web-search"
              subtitle="Multi-engine web search & URL extraction (default Bing, no key required)"
              tools={["get-web-search-summaries", "full-web-search", "get-single-web-page-content", "get-pdf-content"]}
              enabled={mcpEnabled.webSearch}
              saving={mcpSavingKey === "webSearch"}
              expanded={!!mcpExpanded.webSearch}
              ping={mcpPingState.webSearch}
              onToggle={() => handleMcpToggle("webSearch")}
              onExpand={() => setMcpExpanded((p) => ({ ...p, webSearch: !p.webSearch }))}
              onPing={() => handleMcpPing("webSearch")}
              setupBlock={(
                <>
                  {/* Hosted web-search remote config — separate KVS slot from
                      doc-processor so the two services can be hosted at
                      different URLs / Bearers. */}
                  <div style={{ padding: "10px 12px", marginBottom: "10px", background: "rgba(34, 197, 94, 0.06)", border: "1px solid rgba(34, 197, 94, 0.4)", borderRadius: "6px", fontSize: "11px" }}>
                    <strong>Hosted web-search (remote MCP)</strong>
                    <div style={{ marginTop: "4px", color: "var(--text-secondary)" }}>
                      Required for {provider === "anthropic" ? "Anthropic" : "non-LM-Studio providers"}. LM Studio can also use it via <code style={{ fontSize: "11px" }}>~/.lmstudio/mcp.json</code> (URL + headers — see below). Self-host on your Mac with Tailscale Funnel; see the <code style={{ fontSize: "11px" }}>mcp-web-search</code> README for the one-time setup. Separate Service URL + Bearer from doc-processor — these are independent services. The web-search MCP is keyless, so also paste a Serper API key (free tier at <code style={{ fontSize: "11px" }}>serper.dev</code>) — it powers every search.
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "8px" }}>
                      <input
                        type="text"
                        placeholder="https://your-mac.your-tailnet.ts.net/mcp"
                        value={webSearchUrl}
                        onChange={(e) => setWebSearchUrl(e.target.value)}
                        style={{ padding: "5px 8px", border: "1px solid var(--border-color)", borderRadius: "4px", background: "var(--input-bg)", color: "var(--text-color)", fontSize: "11px" }}
                      />
                      {webSearchHasBearer && !webSearchShowBearerInput ? (
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ flex: 1, padding: "5px 8px", border: "1px solid var(--border-color)", borderRadius: "4px", background: "var(--input-bg)", color: "var(--text-muted)", fontFamily: "monospace", fontSize: "11px" }}>
                            ••••••••  (Bearer saved)
                          </span>
                          <button
                            type="button"
                            onClick={() => setWebSearchShowBearerInput(true)}
                            disabled={webSearchSaving}
                            style={{ fontSize: "10px", padding: "4px 8px", border: "1px solid var(--border-color)", borderRadius: "4px", background: "var(--input-bg)", color: "var(--text-color)", cursor: "pointer" }}
                          >Replace</button>
                        </div>
                      ) : (
                        <input
                          type="password"
                          placeholder="Tenant Bearer (paste from web-search admin)"
                          value={webSearchBearerInput}
                          onChange={(e) => setWebSearchBearerInput(e.target.value)}
                          style={{ padding: "5px 8px", border: "1px solid var(--border-color)", borderRadius: "4px", background: "var(--input-bg)", color: "var(--text-color)", fontSize: "11px", fontFamily: "monospace" }}
                        />
                      )}
                      {webSearchHasSerper && !webSearchShowSerperInput ? (
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ flex: 1, padding: "5px 8px", border: "1px solid var(--border-color)", borderRadius: "4px", background: "var(--input-bg)", color: "var(--text-muted)", fontFamily: "monospace", fontSize: "11px" }}>
                            ••••••••  (Serper key saved)
                          </span>
                          <button
                            type="button"
                            onClick={() => setWebSearchShowSerperInput(true)}
                            disabled={webSearchSaving}
                            style={{ fontSize: "10px", padding: "4px 8px", border: "1px solid var(--border-color)", borderRadius: "4px", background: "var(--input-bg)", color: "var(--text-color)", cursor: "pointer" }}
                          >Replace</button>
                        </div>
                      ) : (
                        <input
                          type="password"
                          placeholder="Serper API key (free tier at serper.dev) — powers web search"
                          value={webSearchSerperInput}
                          onChange={(e) => setWebSearchSerperInput(e.target.value)}
                          style={{ padding: "5px 8px", border: "1px solid var(--border-color)", borderRadius: "4px", background: "var(--input-bg)", color: "var(--text-color)", fontSize: "11px", fontFamily: "monospace" }}
                        />
                      )}
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button
                          type="button"
                          onClick={handleSaveWebSearchRemote}
                          disabled={webSearchSaving || !webSearchUrl.trim() || (!webSearchHasBearer && !webSearchBearerInput.trim()) || (webSearchShowBearerInput && !webSearchBearerInput.trim())}
                          style={{ fontSize: "11px", padding: "5px 10px", border: "1px solid var(--success-color)", borderRadius: "4px", background: "var(--success-color)", color: "white", cursor: "pointer" }}
                        >{webSearchSaving ? "Saving…" : "Save"}</button>
                        {(webSearchHasBearer || webSearchUrl) && (
                          <button
                            type="button"
                            onClick={handleRemoveWebSearchRemote}
                            disabled={webSearchSaving}
                            style={{ fontSize: "11px", padding: "5px 10px", border: "1px solid var(--border-color)", borderRadius: "4px", background: "var(--input-bg)", color: "var(--text-color)", cursor: "pointer" }}
                          >Clear</button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Provider-specific guidance for what happens once saved */}
                  {provider === "anthropic" && (
                    <div style={{ padding: "8px 10px", marginBottom: "10px", background: "rgba(37, 99, 235, 0.08)", border: "1px solid rgba(37, 99, 235, 0.4)", borderRadius: "6px", fontSize: "11px" }}>
                      <strong>Anthropic native MCP:</strong> when this MCP is on AND the hosted web-search above is configured, CogniRunner attaches it to every Messages API request via the <code style={{ fontSize: "11px" }}>mcp_servers</code> field. Claude itself dispatches tool calls.
                      <div style={{ marginTop: "6px", padding: "6px 8px", background: "rgba(245, 158, 11, 0.10)", border: "1px solid rgba(245, 158, 11, 0.3)", borderRadius: "4px", color: "var(--text-secondary)" }}>
                        ⚠ <strong>Cost note:</strong> Anthropic's <code style={{ fontSize: "11px" }}>mcp_toolset</code> shape doesn't support per-server <code style={{ fontSize: "11px" }}>allowed_tools</code>, so the model sees ALL ~11 tools the web-search server registers (including expensive ones like <code style={{ fontSize: "11px" }}>progressive-web-search</code> 20s and <code style={{ fontSize: "11px" }}>research_and_save_to_markdown</code> multi-URL crawl). LM Studio filters to a 4-tool subset; Anthropic doesn't. If you need to restrict, configure a per-tenant tool allowlist on the web-search server itself.
                      </div>
                    </div>
                  )}
                  {(provider === "openai" || provider === "azure" || provider === "openrouter") && (
                    <div style={{ padding: "8px 10px", marginBottom: "10px", background: "rgba(34, 197, 94, 0.08)", border: "1px solid rgba(34, 197, 94, 0.4)", borderRadius: "6px", fontSize: "11px" }}>
                      <strong>{provider === "azure" ? "Azure OpenAI" : provider === "openrouter" ? "OpenRouter" : "OpenAI"} support: enabled.</strong> These APIs have no native remote-MCP, so CogniRunner bridges it: during agentic validation it lists the enabled hosted MCP tools, exposes them to the model as function tools, and proxies the tool calls to the hosted server. Configure the Service URL + Bearer (+ the Serper key for web-search) above and toggle the MCP on.
                    </div>
                  )}

                  {/* LM Studio-only setup snippets — two ways: local stdio OR remote HTTP via mcp.json */}
                  {isLmStudio && (
                    <>
                      <p style={{ margin: "0 0 8px", fontSize: "12px", color: "var(--text-secondary)" }}>
                        <strong>Option A — local stdio (LM Studio):</strong> clone the repo and run from <code style={{ fontSize: "11px" }}>mcp.json</code>:
                      </p>
                      <pre style={{ margin: "0 0 8px", padding: "10px", background: "var(--code-bg)", borderRadius: "6px", fontSize: "11px", overflow: "auto", color: "var(--text-color)" }}>
{`git clone https://github.com/leanzero-srl/mcp-web-search
cd mcp-web-search
npm install && npm run build`}
                      </pre>
                      <p style={{ margin: "0 0 8px", fontSize: "12px", color: "var(--text-secondary)" }}>
                        Add to <code style={{ fontSize: "11px" }}>mcp.json</code> (entry name <strong>must</strong> be <code style={{ fontSize: "11px" }}>web-search</code>). The <code style={{ fontSize: "11px" }}>"args"</code> path <strong>must</strong> be absolute, and <code style={{ fontSize: "11px" }}>"timeout": 120000</code> is required — full searches take 30–90 s and LM Studio's default timeout will kill them otherwise.
                      </p>
                      <pre style={{ margin: "0 0 8px", padding: "10px", background: "var(--code-bg)", borderRadius: "6px", fontSize: "11px", overflow: "auto", color: "var(--text-color)" }}>
{`"web-search": {
  "command": "node",
  "args": ["/ABSOLUTE/PATH/TO/mcp-web-search/dist/index.js"],
  "timeout": 120000,
  "env": {
    "SEARCH_ENGINE": "bing"
  }
}`}
                      </pre>
                      <p style={{ margin: "8px 0 8px", fontSize: "12px", color: "var(--text-secondary)" }}>
                        <strong>Option B — remote HTTP (LM Studio &ge;0.3.17):</strong> add to <code style={{ fontSize: "11px" }}>mcp.json</code>:
                      </p>
                      <pre style={{ margin: 0, padding: "10px", background: "var(--code-bg)", borderRadius: "6px", fontSize: "11px", overflow: "auto", color: "var(--text-color)" }}>
{`"web-search": {
  "url": "${webSearchUrl || "https://your-mac.your-tailnet.ts.net/mcp"}",
  "headers": {
    "Authorization": "Bearer <tenant-bearer-from-web-search>"
  }
}`}
                      </pre>
                      <p style={{ margin: "8px 0 0", fontSize: "11px", color: "var(--text-muted)" }}>
                        Engines: <code style={{ fontSize: "11px" }}>bing</code> (default), <code style={{ fontSize: "11px" }}>brave</code>, and <code style={{ fontSize: "11px" }}>duckduckgo</code> all work without an API key.{" "}
                        <code style={{ fontSize: "11px" }}>SEARCH_ENGINE=serper</code> requires <code style={{ fontSize: "11px" }}>SERPER_API_KEY</code>. Optional <code style={{ fontSize: "11px" }}>GITHUB_TOKEN</code> unlocks deeper GitHub repo crawls.{" "}
                        GitHub: <code style={{ fontSize: "11px" }}>github.com/leanzero-srl/mcp-web-search</code>
                      </p>
                    </>
                  )}
                </>
              )}
            />

            {/* doc-reader — visible for ALL providers (LM Studio uses local
                or remote mcp.json; Anthropic uses native mcp_servers; OpenAI /
                Azure / OpenRouter use the cross-provider bridge — CogniRunner
                proxies the tool calls). */}
            <McpCard
              mcpKey="docReader"
              title="doc-reader"
              subtitle="PDF / DOCX / Excel processing — local files + Jira attachments (URL variant)"
              tools={["read-doc", "list-documents"]}
              enabled={mcpEnabled.docReader}
              saving={mcpSavingKey === "docReader"}
              expanded={!!mcpExpanded.docReader}
              ping={mcpPingState.docReader}
              onToggle={() => handleMcpToggle("docReader")}
              onExpand={() => setMcpExpanded((p) => ({ ...p, docReader: !p.docReader }))}
              onPing={() => handleMcpPing("docReader")}
              setupBlock={(
                <>
                  {/* Hosted doc-processor remote config — used by Anthropic
                      natively (mcp_servers field) and by LM Studio when its
                      local mcp.json is the remote variant. Saved bearer is
                      never sent back from the backend; we only show "saved". */}
                  <div style={{ padding: "10px 12px", marginBottom: "10px", background: "rgba(34, 197, 94, 0.06)", border: "1px solid rgba(34, 197, 94, 0.4)", borderRadius: "6px", fontSize: "11px" }}>
                    <strong>Hosted doc-processor (remote MCP)</strong>
                    <div style={{ marginTop: "4px", color: "var(--text-secondary)" }}>
                      Required for {provider === "anthropic" ? "Anthropic" : "non-LM-Studio providers"}. LM Studio can also use it via <code style={{ fontSize: "11px" }}>~/.lmstudio/mcp.json</code> (URL + headers — see below). Self-host on your Mac with Tailscale Funnel; see the <code style={{ fontSize: "11px" }}>leanzero-mcp-doc-processor</code> README for the one-time setup.
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "8px" }}>
                      <input
                        type="text"
                        placeholder="https://your-mac.your-tailnet.ts.net/mcp"
                        value={docProcUrl}
                        onChange={(e) => setDocProcUrl(e.target.value)}
                        style={{ padding: "5px 8px", border: "1px solid var(--border-color)", borderRadius: "4px", background: "var(--input-bg)", color: "var(--text-color)", fontSize: "11px" }}
                      />
                      {docProcHasBearer && !docProcShowBearerInput ? (
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ flex: 1, padding: "5px 8px", border: "1px solid var(--border-color)", borderRadius: "4px", background: "var(--input-bg)", color: "var(--text-muted)", fontFamily: "monospace", fontSize: "11px" }}>
                            ••••••••  (Bearer saved)
                          </span>
                          <button
                            type="button"
                            onClick={() => setDocProcShowBearerInput(true)}
                            disabled={docProcSaving}
                            style={{ fontSize: "10px", padding: "4px 8px", border: "1px solid var(--border-color)", borderRadius: "4px", background: "var(--input-bg)", color: "var(--text-color)", cursor: "pointer" }}
                          >Replace</button>
                        </div>
                      ) : (
                        <input
                          type="password"
                          placeholder="Tenant Bearer (paste from doc-processor admin)"
                          value={docProcBearerInput}
                          onChange={(e) => setDocProcBearerInput(e.target.value)}
                          style={{ padding: "5px 8px", border: "1px solid var(--border-color)", borderRadius: "4px", background: "var(--input-bg)", color: "var(--text-color)", fontSize: "11px", fontFamily: "monospace" }}
                        />
                      )}
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button
                          type="button"
                          onClick={handleSaveDocProcRemote}
                          disabled={docProcSaving || !docProcUrl.trim() || (!docProcHasBearer && !docProcBearerInput.trim()) || (docProcShowBearerInput && !docProcBearerInput.trim())}
                          style={{ fontSize: "11px", padding: "5px 10px", border: "1px solid var(--success-color)", borderRadius: "4px", background: "var(--success-color)", color: "white", cursor: "pointer" }}
                        >{docProcSaving ? "Saving…" : "Save"}</button>
                        {(docProcHasBearer || docProcUrl) && (
                          <button
                            type="button"
                            onClick={handleRemoveDocProcRemote}
                            disabled={docProcSaving}
                            style={{ fontSize: "11px", padding: "5px 10px", border: "1px solid var(--border-color)", borderRadius: "4px", background: "var(--input-bg)", color: "var(--text-color)", cursor: "pointer" }}
                          >Clear</button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Provider-specific guidance for what happens once saved */}
                  {provider === "anthropic" && (
                    <div style={{ padding: "8px 10px", marginBottom: "10px", background: "rgba(37, 99, 235, 0.08)", border: "1px solid rgba(37, 99, 235, 0.4)", borderRadius: "6px", fontSize: "11px" }}>
                      <strong>Anthropic native MCP:</strong> when this MCP is on AND the hosted doc-processor above is configured, CogniRunner attaches it to every Messages API request via the <code style={{ fontSize: "11px" }}>mcp_servers</code> field with the beta header <code style={{ fontSize: "11px" }}>anthropic-beta: mcp-client-2025-11-20</code>. Claude itself dispatches tool calls — no per-tool plumbing on our side. Single-use upload capability for each Jira issue is bound server-side and passed in the system prompt; the model cannot redirect uploads.
                    </div>
                  )}
                  {(provider === "openai" || provider === "azure" || provider === "openrouter") && (
                    <div style={{ padding: "8px 10px", marginBottom: "10px", background: "rgba(34, 197, 94, 0.08)", border: "1px solid rgba(34, 197, 94, 0.4)", borderRadius: "6px", fontSize: "11px" }}>
                      <strong>{provider === "azure" ? "Azure OpenAI" : provider === "openrouter" ? "OpenRouter" : "OpenAI"} support: enabled.</strong> These APIs have no native remote-MCP, so CogniRunner bridges it: during agentic validation it lists the enabled doc-reader tools, exposes them to the model, and proxies the tool calls to the hosted doc-processor. Configure the URL + Bearer above and enable doc-reader (and doc-writer for the create/edit tools).
                    </div>
                  )}
                  {isLmStudio && (
                    <div style={{ padding: "8px 10px", marginBottom: "10px", background: "rgba(37, 99, 235, 0.08)", border: "1px solid rgba(37, 99, 235, 0.4)", borderRadius: "6px", fontSize: "11px" }}>
                      <strong>Jira attachments:</strong> when this MCP is on, the validator mints a one-shot URL + Bearer token for each attachment and feeds them to the model, so it can call <code style={{ fontSize: "11px" }}>read-doc</code> with <code style={{ fontSize: "11px" }}>url</code> + <code style={{ fontSize: "11px" }}>authHeader</code>. Two ways to wire LM Studio to doc-processor: (a) <strong>local stdio</strong> — clone the repo and run <code style={{ fontSize: "11px" }}>node src/index.js</code> from <code style={{ fontSize: "11px" }}>mcp.json</code>; (b) <strong>remote HTTP</strong> (LM Studio &ge;0.3.17) — point <code style={{ fontSize: "11px" }}>mcp.json</code> at the hosted URL above with the Bearer in headers. Either way, the entry name in <code style={{ fontSize: "11px" }}>mcp.json</code> <strong>must</strong> be <code style={{ fontSize: "11px" }}>doc-reader</code>.
                    </div>
                  )}

                  {/* docWriter sub-toggle — applies to ALL providers when doc-reader is on */}
                  <div style={{ padding: "8px 10px", marginBottom: "10px", background: "rgba(220, 38, 38, 0.06)", border: "1px solid rgba(220, 38, 38, 0.3)", borderRadius: "6px", fontSize: "11px" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: mcpEnabled.docReader ? "pointer" : "not-allowed", opacity: mcpEnabled.docReader ? 1 : 0.5 }}>
                      <input
                        type="checkbox"
                        checked={mcpEnabled.docWriter === true && mcpEnabled.docReader === true}
                        disabled={!mcpEnabled.docReader || mcpSavingKey === "docWriter"}
                        onChange={() => handleMcpToggle("docWriter")}
                      />
                      <strong>Allow document creation (write / upload)</strong>
                      {mcpSavingKey === "docWriter" && <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>saving…</span>}
                    </label>
                    <div style={{ marginTop: "6px", paddingLeft: "22px", color: "var(--text-secondary)" }}>
                      When ON, the model can call <code style={{ fontSize: "11px" }}>create-doc</code>,{" "}
                      <code style={{ fontSize: "11px" }}>create-markdown</code>, and{" "}
                      <code style={{ fontSize: "11px" }}>create-excel</code>; the resulting file is attached
                      automatically to the issue under validation. Each upload capability is one-shot, 10-min TTL,
                      and bound to a single issue (the model cannot redirect uploads). <strong>Defaults OFF</strong> —
                      enable only if you trust the model with write access. Requires doc-reader (read) to be enabled.
                    </div>
                  </div>

                  {/* Local stdio setup — LM Studio only (and only as one of the two LM Studio options) */}
                  {isLmStudio && (
                    <>
                      <p style={{ margin: "0 0 8px", fontSize: "12px", color: "var(--text-secondary)" }}>
                        <strong>Option A — local stdio (LM Studio):</strong> clone the repo and add to <code style={{ fontSize: "11px" }}>mcp.json</code>:
                      </p>
                      <pre style={{ margin: "0 0 8px", padding: "10px", background: "var(--code-bg)", borderRadius: "6px", fontSize: "11px", overflow: "auto", color: "var(--text-color)" }}>
{`git clone https://github.com/leanzero-srl/leanzero-mcp-doc-processor
cd leanzero-mcp-doc-processor
npm install`}
                      </pre>
                      <pre style={{ margin: "0 0 8px", padding: "10px", background: "var(--code-bg)", borderRadius: "6px", fontSize: "11px", overflow: "auto", color: "var(--text-color)" }}>
{`"doc-reader": {
  "command": "node",
  "args": ["/ABSOLUTE/PATH/TO/leanzero-mcp-doc-processor/src/index.js"]
}`}
                      </pre>
                      <p style={{ margin: "8px 0 8px", fontSize: "12px", color: "var(--text-secondary)" }}>
                        <strong>Option B — remote HTTP (LM Studio &ge;0.3.17):</strong> add to <code style={{ fontSize: "11px" }}>mcp.json</code>:
                      </p>
                      <pre style={{ margin: 0, padding: "10px", background: "var(--code-bg)", borderRadius: "6px", fontSize: "11px", overflow: "auto", color: "var(--text-color)" }}>
{`"doc-reader": {
  "url": "${docProcUrl || "https://your-mac.your-tailnet.ts.net/mcp"}",
  "headers": {
    "Authorization": "Bearer <tenant-bearer-from-doc-processor>"
  }
}`}
                      </pre>
                      <p style={{ margin: "8px 0 0", fontSize: "11px", color: "var(--text-muted)" }}>
                        Optional env <code style={{ fontSize: "11px" }}>Z_AI_API_KEY</code> for vision OCR.{" "}
                        GitHub: <code style={{ fontSize: "11px" }}>github.com/leanzero-srl/leanzero-mcp-doc-processor</code>
                      </p>
                    </>
                  )}
                </>
              )}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// Single MCP card — toggle, status pill, collapsible setup block, Test button.
function McpCard({ mcpKey, title, subtitle, tools, enabled, saving, expanded, ping, onToggle, onExpand, onPing, setupBlock }) {
  const pillStyle = enabled
    ? { background: "rgba(22, 163, 106, 0.12)", color: "var(--success-color)", border: "1px solid rgba(22, 163, 106, 0.4)" }
    : { background: "var(--input-bg)", color: "var(--text-muted)", border: "1px solid var(--border-color)" };
  return (
    <div style={{
      border: "1px solid var(--border-color)",
      borderRadius: "8px",
      padding: "12px 14px",
      marginBottom: "10px",
      background: "var(--input-bg)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "2px" }}>
            <strong style={{ fontSize: "13px", color: "var(--text-color)" }}>{title}</strong>
            <span style={{ fontSize: "10px", padding: "1px 6px", borderRadius: "10px", ...pillStyle }}>
              {enabled ? "ENABLED" : "DISABLED"}
            </span>
            {saving && <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>saving…</span>}
          </div>
          <p style={{ margin: "0 0 4px", fontSize: "11px", color: "var(--text-secondary)" }}>{subtitle}</p>
          <p style={{ margin: 0, fontSize: "10px", color: "var(--text-muted)" }}>
            Tools exposed: {tools.map((t) => <code key={t} style={{ fontSize: "10px", marginRight: "6px" }}>{t}</code>)}
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px", alignItems: "flex-end" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "11px", color: "var(--text-secondary)" }}>
            <input type="checkbox" checked={enabled} onChange={onToggle} disabled={saving} />
            Enable
          </label>
          {enabled && (
            <button
              onClick={onPing}
              disabled={ping?.loading}
              style={{
                fontSize: "10px",
                padding: "3px 8px",
                border: "1px solid var(--border-color)",
                borderRadius: "4px",
                background: "var(--input-bg)",
                color: "var(--text-color)",
                cursor: ping?.loading ? "default" : "pointer",
              }}
            >
              {ping?.loading ? "Testing…" : "Test"}
            </button>
          )}
        </div>
      </div>

      {ping && !ping.loading && (
        <div style={{
          marginTop: "8px",
          padding: "6px 10px",
          fontSize: "11px",
          borderRadius: "4px",
          background: ping.ok ? "rgba(22, 163, 106, 0.08)" : "rgba(220, 38, 38, 0.08)",
          color: ping.ok ? "var(--success-color)" : "var(--error-color)",
          border: `1px solid ${ping.ok ? "rgba(22, 163, 106, 0.3)" : "rgba(220, 38, 38, 0.3)"}`,
        }}>
          {ping.ok ? `✓ ${ping.message || "Reachable"}` : `✗ ${ping.error || "Test failed"}`}
        </div>
      )}

      <button
        onClick={onExpand}
        style={{
          marginTop: "10px",
          fontSize: "11px",
          padding: "0",
          border: "none",
          background: "transparent",
          color: "var(--primary-color)",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        {expanded ? "▾ Hide setup" : "▸ Show setup instructions"}
      </button>
      {expanded && (
        <div style={{ marginTop: "10px", paddingTop: "10px", borderTop: "1px solid var(--border-color)" }}>
          {setupBlock}
        </div>
      )}
    </div>
  );
}
