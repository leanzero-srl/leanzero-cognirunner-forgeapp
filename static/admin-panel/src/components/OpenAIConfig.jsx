/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import React, { useState, useEffect, useRef } from "react";
import { router } from "@forge/bridge";
import CustomSelect from "./CustomSelect";
import Tooltip from "./Tooltip";
import { showToast } from "./toast";

// Forge Custom UI runs in a sandboxed iframe — plain <a target="_blank"> links
// are blocked (nothing happens on click). router.open() is the supported way to
// open an external URL in a new tab from Custom UI.
const ExtLink = ({ href, children, style }) => (
  <a
    href={href}
    onClick={(e) => { e.preventDefault(); router.open(href); }}
    style={{ cursor: "pointer", ...style }}
  >
    {children}
  </a>
);

const PROVIDER_OPTIONS = [
  { value: "openai", label: "OpenAI", icon: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M14.949 6.547a3.94 3.94 0 0 0-.348-3.273 4.11 4.11 0 0 0-4.4-1.934 4.1 4.1 0 0 0-1.778-.14 4.15 4.15 0 0 0-2.118-.114 4.1 4.1 0 0 0-1.891.948 4.04 4.04 0 0 0-1.158 1.753 4.1 4.1 0 0 0-1.563.679 4 4 0 0 0-1.14 1.253.99 3.99 0 0 0 .502 4.731 3.94 3.94 0 0 0 .346 3.274 4.11 4.11 0 0 0 4.402 1.933c.382.425.852.764 1.377.995.526.231 1.095.35 1.67.346 1.78.002 3.358-1.132 3.901-2.804a4.1 4.1 0 0 0 1.563-.68 4 4 0 0 0 1.14-1.253 3.99 3.99 0 0 0-.506-4.716m-6.097 8.406a3.05 3.05 0 0 1-1.945-.694l.096-.054 3.23-1.838a.53.53 0 0 0 .265-.455v-4.49l1.366.778q.02.011.025.035v3.722c-.003 1.653-1.361 2.992-3.037 2.996m-6.53-2.75a2.95 2.95 0 0 1-.36-2.01l.095.057L5.29 12.09a.53.53 0 0 0 .527 0l3.949-2.246v1.555a.05.05 0 0 1-.022.041L6.473 13.3c-1.454.826-3.311.335-4.15-1.098m-.85-6.94A3.02 3.02 0 0 1 3.07 3.949v3.785a.51.51 0 0 0 .262.451l3.93 2.237-1.366.779a.05.05 0 0 1-.048 0L2.585 9.342a2.98 2.98 0 0 1-1.113-4.094zm11.216 2.571L8.747 5.576l1.362-.776a.05.05 0 0 1 .048 0l3.265 1.86a3 3 0 0 1 1.173 1.207 2.96 2.96 0 0 1-.27 3.2 3.05 3.05 0 0 1-1.36.997V8.279a.52.52 0 0 0-.276-.445m1.36-2.015-.097-.057-3.226-1.855a.53.53 0 0 0-.53 0L6.249 6.153V4.598a.04.04 0 0 1 .019-.04L9.533 2.7a3.07 3.07 0 0 1 3.257.139c.474.325.843.778 1.066 1.303.223.526.289 1.103.191 1.664zM5.503 8.575 4.139 7.8a.05.05 0 0 1-.026-.037V4.049c0-.57.166-1.127.476-1.607s.752-.864 1.275-1.105a3.08 3.08 0 0 1 3.234.41l-.096.054-3.23 1.838a.53.53 0 0 0-.265.455zm.742-1.577 1.758-1 1.762 1v2l-1.755 1-1.762-1z"/></svg>' },
  { value: "azure", label: "Azure OpenAI", icon: '<svg viewBox="0 0 96 96" fill="currentColor"><path d="M33.338 6.544h26.038l-27.03 80.087a4.152 4.152 0 0 1-3.933 2.824H8.149a4.145 4.145 0 0 1-3.928-5.47L29.404 9.368a4.152 4.152 0 0 1 3.934-2.825z" opacity="0.8"/><path d="M71.175 60.261h-41.29a1.911 1.911 0 0 0-1.305 3.309l26.532 24.764a4.171 4.171 0 0 0 2.846 1.121h23.38z" opacity="0.6"/><path d="M33.338 6.544a4.118 4.118 0 0 0-3.943 2.879L4.252 83.917a4.14 4.14 0 0 0 3.908 5.538h20.787a4.443 4.443 0 0 0 3.41-2.9l5.014-14.777 17.91 16.705a4.237 4.237 0 0 0 2.666.972H81.24L71.024 60.261l-29.781.007L59.47 6.544z" opacity="0.9"/></svg>' },
  { value: "openrouter", label: "OpenRouter", icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.778 1.844v1.919q-.569-.026-1.138-.032-.708-.008-1.415.037c-1.93.126-4.023.728-6.149 2.237-2.911 2.066-2.731 1.95-4.14 2.75-.396.223-1.342.574-2.185.798-.841.225-1.753.333-1.751.333v4.229s.768.108 1.61.333c.842.224 1.789.575 2.185.799 1.41.798 1.228.683 4.14 2.75 2.126 1.509 4.22 2.11 6.148 2.236.88.058 1.716.041 2.555.005v1.918l7.222-4.168-7.222-4.17v2.176c-.86.038-1.611.065-2.278.021-1.364-.09-2.417-.357-3.979-1.465-2.244-1.593-2.866-2.027-3.68-2.508.889-.518 1.449-.906 3.822-2.59 1.56-1.109 2.614-1.377 3.978-1.466.667-.044 1.418-.017 2.278.02v2.176L24 6.014Z"/></svg>' },
  { value: "anthropic", label: "Anthropic", icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z"/></svg>' },
  { value: "lmstudio", label: "LM Studio", icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="14" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M7 8h2v3H7zM11 8h2v3h-2zM15 8h2v3h-2z"/></svg>' },
  { value: "atlassian", label: "Atlassian (Forge LLM)", icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7.12 11.084c-.282-.302-.717-.284-.92.072L.123 23.305a.585.585 0 0 0 .523.847h8.46a.563.563 0 0 0 .523-.323c1.825-3.772.719-9.508-2.51-12.745zM11.434.323c-3.022 4.785-2.822 10.085-.831 14.066l4.079 8.157a.585.585 0 0 0 .523.323h8.46a.585.585 0 0 0 .523-.847S12.81 1.255 12.524.685c-.256-.51-.865-.518-1.09-.362z"/></svg>' },
];

const PROVIDER_HELP = {
  openai: { keyPlaceholder: "sk-...", keyLabel: "OpenAI API Key", endpointNeeded: false },
  // Azure OpenAI rides the same OpenAI-compatible path as OpenAI; it is mostly untested end-to-end.
  azure: { keyPlaceholder: "Enter your Azure OpenAI API key...", keyLabel: "Azure API Key", endpointNeeded: true, endpointPlaceholder: "https://myresource.openai.azure.com/openai/v1", note: "Azure OpenAI is mostly untested — verify your deployment before relying on it." },
  openrouter: { keyPlaceholder: "sk-or-...", keyLabel: "OpenRouter API Key", endpointNeeded: false },
  anthropic: { keyPlaceholder: "sk-ant-...", keyLabel: "Anthropic API Key", endpointNeeded: false },
  lmstudio: {
    keyPlaceholder: "Optional: Bearer token from LM Studio Developer page",
    keyLabel: "API Token (optional)",
    endpointNeeded: true,
    endpointPlaceholder: "https://your-machine.tailXXXX.ts.net",
    keyOptional: true,
  },
  // Forge LLM is Atlassian-hosted: no API key, no endpoint. Inference runs inside
  // the Atlassian platform (data never leaves it) and is billed to the app vendor.
  atlassian: { keyPlaceholder: "", keyLabel: "API Key", endpointNeeded: false, noKey: true },
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
  // Mount-load failure: render an explicit error + Retry instead of pretending
  // the useState defaults (provider=openai, "No API key configured") are real.
  const [loadError, setLoadError] = useState(null);
  // Post-save re-fetch in progress — drives the frosted veil over the card.
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingProvider, setSavingProvider] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  // LM Studio: connection test + model load
  const [pinging, setPinging] = useState(false);
  const [pingResult, setPingResult] = useState(null); // { ok, modelCount, authOk, message } | { error }
  // True while ANY ping (silent or explicit) is running — drives the
  // "Testing connection…" status so the silent auto-ping after load/save
  // never shows a stale "not yet tested" state while the test runs.
  const [pingInFlight, setPingInFlight] = useState(false);
  const [loadingLmModel, setLoadingLmModel] = useState(false);
  // LM Studio MCP integrations — fixed set of 3 (context7, web-search, doc-reader).
  // Other MCPs in the user's mcp.json are NOT exposed by us per design.
  const [mcpEnabled, setMcpEnabled] = useState({ context7: false, webSearch: false, docReader: false, docWriter: false });
  const [mcpSavingKey, setMcpSavingKey] = useState(null); // which key is currently saving
  const [mcpExpanded, setMcpExpanded] = useState({}); // which setup panels are open
  const [mcpPingState, setMcpPingState] = useState({}); // {[key]: {loading, ok, error}}
  // Hosted doc-processor (remote MCP). The cross-provider bridge dials this URL on
  // every hosted provider; LM Studio can also point its own mcp.json at the same
  // URL+bearer (no CogniRunner code change for that case).
  const [docProcUrl, setDocProcUrl] = useState("");
  const [docProcBearerInput, setDocProcBearerInput] = useState("");
  const [docProcHasBearer, setDocProcHasBearer] = useState(false);
  const [docProcSaving, setDocProcSaving] = useState(false);
  const [docProcShowBearerInput, setDocProcShowBearerInput] = useState(false);
  // Z.AI key for the doc-processor MCP — only needed for OCR of scanned PDFs.
  const [docProcZaiInput, setDocProcZaiInput] = useState("");
  const [docProcHasZai, setDocProcHasZai] = useState(false);
  const [docProcShowZaiInput, setDocProcShowZaiInput] = useState(false);
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
  // Optional GitHub token for the web-search github tool (higher rate limits / private repos).
  const [webSearchGithubInput, setWebSearchGithubInput] = useState("");
  const [webSearchHasGithub, setWebSearchHasGithub] = useState(false);
  const [webSearchShowGithubInput, setWebSearchShowGithubInput] = useState(false);
  // Hosted context7 (remote MCP). Same pattern, but the API key is OPTIONAL (keyless
  // works) and is context7's own CONTEXT7_API_KEY header — not a Bearer.
  const [context7Url, setContext7Url] = useState("");
  const [context7ApiKeyInput, setContext7ApiKeyInput] = useState("");
  const [context7HasApiKey, setContext7HasApiKey] = useState(false);
  const [context7Saving, setContext7Saving] = useState(false);
  const [context7ShowApiKeyInput, setContext7ShowApiKeyInput] = useState(false);

  const pHelp = PROVIDER_HELP[provider] || PROVIDER_HELP.openai;
  const isLmStudio = provider === "lmstudio";
  const isAtlassian = provider === "atlassian";

  // For LM Studio, find metadata for the currently-selected model so we can show
  // "Loaded" / "Cold" badge + enable/disable the Load button.
  const selectedModelMeta = isLmStudio && selectedModel
    ? modelDetails.find((m) => m.id === selectedModel)
    : null;

  // Refresh-veil bookkeeping: a depth counter so nested refresh scopes (e.g.
  // the provider-switch chain wrapping loadStatus) keep the veil up until the
  // OUTERMOST scope completes instead of dropping it mid-chain.
  const refreshDepth = useRef(0);
  const beginRefresh = () => {
    refreshDepth.current += 1;
    setRefreshing(true);
  };
  const endRefresh = () => {
    refreshDepth.current = Math.max(0, refreshDepth.current - 1);
    if (refreshDepth.current === 0) setRefreshing(false);
  };

  // asRefresh: post-save re-fetch — keep current content visible under the
  // frosted veil instead of the full-card mount skeleton (driven by `loading`).
  const loadStatus = async ({ asRefresh = false } = {}) => {
    if (!invoke) return;
    if (asRefresh) beginRefresh();
    try {
      const [keyResult, modelsResult, modelKvs, providerResult, mcpsResult, docProcResult, webSearchResult, context7Result] = await Promise.all([
        invoke("getOpenAIKey"),
        invoke("getOpenAIModels"),
        invoke("getOpenAIModelFromKVS"),
        invoke("getProvider"),
        invoke("getLmStudioMcps").catch(() => ({ success: false })),
        invoke("getDocProcessorRemote").catch(() => ({ success: false })),
        invoke("getWebSearchRemote").catch(() => ({ success: false })),
        invoke("getContext7Remote").catch(() => ({ success: false })),
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
        // Restore live connection status after a refresh. pingResult is plain
        // component state, so without this the panel falls back to "URL saved —
        // not yet tested" on every reload even when the connection was verified
        // moments ago. Silent ping, not awaited; the backend falls back to the
        // saved token when no key is passed.
        if (p === "lmstudio" && providerResult.baseUrl) {
          runLmStudioPing({ baseUrlOverride: providerResult.baseUrl, silent: true });
        }
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
        setDocProcHasZai(!!docProcResult.hasZaiKey);
      }
      if (webSearchResult && webSearchResult.success) {
        setWebSearchUrl(webSearchResult.url || "");
        setWebSearchHasBearer(!!webSearchResult.hasBearer);
        setWebSearchHasSerper(!!webSearchResult.hasSerperKey);
        setWebSearchHasGithub(!!webSearchResult.hasGithubToken);
      }
      if (context7Result && context7Result.success) {
        setContext7Url(context7Result.url || "");
        setContext7HasApiKey(!!context7Result.hasApiKey);
      }
    } catch (e) {
      console.error("Failed to load AI config status:", e);
      if (asRefresh) {
        // Refresh failure: the previously-loaded data on screen is still
        // valid — surface the problem instead of failing silently.
        showToast("Failed to refresh settings: " + (e.message || e), "error");
      } else {
        // Mount-load failure: show an explicit error + Retry, never the defaults.
        setLoadError(e.message || String(e));
      }
    } finally {
      if (asRefresh) endRefresh();
      setLoading(false);
    }
  };

  const handleRetryLoad = () => {
    setLoadError(null);
    setLoading(true);
    loadStatus();
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
        // Revert on failure. The banner renders at the very top of the section,
        // far from the toggle — toast at the trigger too.
        setMcpEnabled(mcpEnabled);
        setError(result.error || "Failed to save MCP setting");
        showToast(result.error || "Failed to save MCP setting", "error");
      }
    } catch (e) {
      setMcpEnabled(mcpEnabled);
      setError("Failed to save MCP setting: " + e.message);
      showToast("Failed to save MCP setting: " + e.message, "error");
    }
    setMcpSavingKey(null);
  };

  const handleMcpPing = async (mcpKey) => {
    if (!invoke) return;
    setMcpPingState((prev) => ({ ...prev, [mcpKey]: { loading: true } }));
    try {
      // LM Studio uses the local-plugin probe (mcp.json reachability). Every other
      // provider tests the real bridge runtime path — tools/list against the
      // configured remote URL. Both return { success, ok, error, message }.
      const result = await invoke(isLmStudio ? "pingLmStudioMcp" : "testMcpConnection", { mcpKey });
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
    // "save" vs "clear" so only the clicked button shows the busy spinner.
    setDocProcSaving("save");
    setError(null);
    try {
      const result = await invoke("saveDocProcessorRemote", {
        url: docProcUrl.trim(),
        bearer: docProcBearerInput.trim(),
        zaiKey: docProcZaiInput.trim(),
      });
      if (result.success) {
        setDocProcHasBearer(true);
        setDocProcBearerInput("");
        setDocProcShowBearerInput(false);
        setDocProcHasZai(!!result.hasZaiKey);
        setDocProcZaiInput("");
        setDocProcShowZaiInput(false);
        showToast("Doc-processor settings saved");
      } else {
        // Banner is at the top of the section, far from this deep panel — toast too.
        setError(result.error || "Failed to save doc-processor remote config");
        showToast(result.error || "Failed to save doc-processor remote config", "error");
      }
    } catch (e) {
      setError("Failed to save doc-processor remote config: " + e.message);
      showToast("Failed to save doc-processor remote config: " + e.message, "error");
    }
    setDocProcSaving(false);
  };

  const handleRemoveDocProcRemote = async () => {
    if (!invoke) return;
    setDocProcSaving("clear");
    setError(null);
    try {
      const result = await invoke("removeDocProcessorRemote");
      if (result.success) {
        setDocProcUrl("");
        setDocProcHasBearer(false);
        setDocProcBearerInput("");
        setDocProcShowBearerInput(false);
        setDocProcHasZai(false);
        setDocProcZaiInput("");
        setDocProcShowZaiInput(false);
        showToast("Doc-processor settings cleared");
      } else {
        setError(result.error || "Failed to remove doc-processor remote config");
        showToast(result.error || "Failed to remove doc-processor remote config", "error");
      }
    } catch (e) {
      setError("Failed to remove doc-processor remote config: " + e.message);
      showToast("Failed to remove doc-processor remote config: " + e.message, "error");
    }
    setDocProcSaving(false);
  };

  const handleSaveWebSearchRemote = async () => {
    if (!invoke) return;
    if (!webSearchUrl.trim() || !webSearchBearerInput.trim()) return;
    // "save" vs "clear" so only the clicked button shows the busy spinner.
    setWebSearchSaving("save");
    setError(null);
    try {
      const result = await invoke("saveWebSearchRemote", {
        url: webSearchUrl.trim(),
        bearer: webSearchBearerInput.trim(),
        serperKey: webSearchSerperInput.trim(),
        githubToken: webSearchGithubInput.trim(),
      });
      if (result.success) {
        setWebSearchHasBearer(true);
        setWebSearchBearerInput("");
        setWebSearchShowBearerInput(false);
        setWebSearchHasSerper(!!result.hasSerperKey);
        setWebSearchSerperInput("");
        setWebSearchShowSerperInput(false);
        setWebSearchHasGithub(!!result.hasGithubToken);
        setWebSearchGithubInput("");
        setWebSearchShowGithubInput(false);
        showToast("Web-search settings saved");
      } else {
        // Banner is at the top of the section, far from this deep panel — toast too.
        setError(result.error || "Failed to save web-search remote config");
        showToast(result.error || "Failed to save web-search remote config", "error");
      }
    } catch (e) {
      setError("Failed to save web-search remote config: " + e.message);
      showToast("Failed to save web-search remote config: " + e.message, "error");
    }
    setWebSearchSaving(false);
  };

  const handleRemoveWebSearchRemote = async () => {
    if (!invoke) return;
    setWebSearchSaving("clear");
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
        setWebSearchHasGithub(false);
        setWebSearchGithubInput("");
        setWebSearchShowGithubInput(false);
        showToast("Web-search settings cleared");
      } else {
        setError(result.error || "Failed to remove web-search remote config");
        showToast(result.error || "Failed to remove web-search remote config", "error");
      }
    } catch (e) {
      setError("Failed to remove web-search remote config: " + e.message);
      showToast("Failed to remove web-search remote config: " + e.message, "error");
    }
    setWebSearchSaving(false);
  };

  const handleSaveContext7Remote = async () => {
    if (!invoke) return;
    // Key is OPTIONAL (keyless context7 works) — Save needs only the URL.
    if (!context7Url.trim()) return;
    setContext7Saving("save");
    setError(null);
    try {
      const result = await invoke("saveContext7Remote", {
        url: context7Url.trim(),
        apiKey: context7ApiKeyInput.trim(),
      });
      if (result.success) {
        setContext7HasApiKey(!!result.hasApiKey);
        setContext7ApiKeyInput("");
        setContext7ShowApiKeyInput(false);
        showToast("context7 settings saved");
      } else {
        setError(result.error || "Failed to save context7 remote config");
        showToast(result.error || "Failed to save context7 remote config", "error");
      }
    } catch (e) {
      setError("Failed to save context7 remote config: " + e.message);
      showToast("Failed to save context7 remote config: " + e.message, "error");
    }
    setContext7Saving(false);
  };

  const handleRemoveContext7Remote = async () => {
    if (!invoke) return;
    setContext7Saving("clear");
    setError(null);
    try {
      const result = await invoke("removeContext7Remote");
      if (result.success) {
        setContext7Url("");
        setContext7HasApiKey(false);
        setContext7ApiKeyInput("");
        setContext7ShowApiKeyInput(false);
        showToast("context7 settings cleared");
      } else {
        setError(result.error || "Failed to remove context7 remote config");
        showToast(result.error || "Failed to remove context7 remote config", "error");
      }
    } catch (e) {
      setError("Failed to remove context7 remote config: " + e.message);
      showToast("Failed to remove context7 remote config: " + e.message, "error");
    }
    setContext7Saving(false);
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
        // Hold the refresh veil for the WHOLE switch chain (KVS settle delay,
        // status re-fetch, LM Studio auto-ping) so stale pre-switch data never
        // reads as live while the chain runs.
        beginRefresh();
        try {
          await new Promise((r) => setTimeout(r, 500));
          await loadStatus({ asRefresh: true });
          // For LM Studio: auto-ping right after switch so the user sees actual
          // connection state (including 401 → "token required") instead of a
          // misleading "Switched successfully" message followed by a broken UI.
          if (provider === "lmstudio") {
            const ping = await runLmStudioPing({ silent: true });
            if (ping?.success && ping.ok && ping.authOk) {
              setSuccess(`Switched to LM Studio — connected, ${ping.modelCount || 0} model(s) found.`);
              showToast("Provider switched to LM Studio");
            } else if (ping?.tokenRequired) {
              setError(ping.error);
            } else if (ping?.tokenInvalid) {
              setError(ping.error);
            } else if (ping && !ping.success) {
              setError(ping.error || "Switched to LM Studio but connection test failed.");
            } else {
              setSuccess("Switched to LM Studio.");
              showToast("Provider switched to LM Studio");
            }
          } else {
            const label = PROVIDER_OPTIONS.find((p) => p.value === provider)?.label || provider;
            setSuccess(`Switched to ${label}`);
            showToast(`Provider switched to ${label}`);
          }
        } finally {
          endRefresh();
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
        await loadStatus({ asRefresh: true });
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
    // Set for silent pings too — the status block switches to the pulsing
    // "Testing connection…" state instead of the stale "not yet tested" grey.
    setPingInFlight(true);
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
      setPingInFlight(false);
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
        await loadStatus({ asRefresh: true });
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
        // Brief delay to let KVS propagate, then reload status + models —
        // veiled so the stale pre-save status never reads as live.
        beginRefresh();
        try {
          await new Promise((r) => setTimeout(r, 500));
          await loadStatus({ asRefresh: true });
        } finally {
          endRefresh();
        }
        // For LM Studio, re-ping with the just-saved token to confirm it works
        // and surface the actual model count. Using tokenOverride because keyInput
        // was just cleared above. (Runs outside the veil so the status block's
        // "Testing connection…" state stays fully visible.)
        if (isLmStudio) {
          const ping = await runLmStudioPing({ tokenOverride: tokenJustSaved, silent: true });
          if (ping?.success && ping.ok && ping.authOk) {
            setSuccess(`Token saved — connected, ${ping.modelCount || 0} model(s) found.`);
            showToast("Token saved");
          } else if (ping?.tokenInvalid) {
            setError(ping.error);
          } else if (ping && !ping.success) {
            setError(ping.error || "Token saved but connection test failed.");
          } else {
            setSuccess("Token saved.");
            showToast("Token saved");
          }
        } else {
          setSuccess("API key saved successfully");
          showToast("API key saved");
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
        showToast("Key removed — reverted to factory key");
        setModels([]);
        setCurrentModel(null);
        setSelectedModel("");
        await loadStatus({ asRefresh: true });
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
        showToast("Model saved");
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

  // Mount load failed — the state below still holds useState defaults
  // (provider=openai, "No API key configured"), which would read as real
  // data. Render an honest error + Retry instead of the fake defaults.
  if (loadError) {
    return (
      <div className="section">
        <div className="section-header">
          <span className="section-title">AI Provider Configuration</span>
        </div>
        <div className="card">
          <div style={{ padding: "16px" }}>
            <div className="load-error">
              <span>Couldn&apos;t load AI provider settings.</span>
              <button className="btn-retry" onClick={handleRetryLoad}>Retry</button>
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
        <div className="alert alert-error anim-rise">
          <span>{error}</span>
          <button className="alert-dismiss" onClick={() => setError(null)}>&times;</button>
        </div>
      )}
      {success && (
        <div className="alert alert-success anim-rise">
          <span>{success}</span>
          <button className="alert-dismiss" onClick={() => setSuccess(null)}>&times;</button>
        </div>
      )}

      <div className="card veil-host">
        {refreshing && (
          <div className="veil">
            <span className="spin-ring" />
            <span className="veil-label">Syncing settings…</span>
          </div>
        )}
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
                  className={"btn-small btn-edit" + (savingProvider ? " is-busy" : "")}
                  onClick={handleSaveProvider}
                  // For LM Studio, the backend requires a baseUrl on switch — disable
                  // the button until the user enters one so they don't get the
                  // "LM Studio requires a public base URL" error after clicking.
                  disabled={savingProvider || (provider === "lmstudio" && !endpointInput.trim())}
                  title={provider === "lmstudio" && !endpointInput.trim()
                    ? "Enter your Tailscale Funnel URL below first"
                    : undefined}
                >
                  Switch Provider
                </button>
              )}
            </div>
            {provider !== savedProvider && (
              <p style={{ margin: "4px 0 0 0", fontSize: "11px", color: "var(--primary-color)" }}>
                Your keys are saved per provider. Switching back will restore your previous key.
              </p>
            )}
            <p style={{ margin: "4px 0 0 0", fontSize: "11px", color: "var(--text-muted)" }}>
              All providers support chat completions and tool calling. Vision (image attachments) requires OpenAI, Azure, OpenRouter, Anthropic, or a vision-capable LM Studio model — Atlassian Forge LLM is text-only for now.
            </p>
            {isAtlassian && (
              <div className="anim-rise" style={{ marginTop: "8px", padding: "8px 10px", background: "var(--card-bg)", border: "2px solid var(--primary-color)", boxShadow: "0 4px 12px -4px rgba(37, 99, 235, 0.35)", borderRadius: "6px", fontSize: "11px", color: "var(--text-secondary)" }}>
                <strong>Atlassian-hosted Claude (Forge LLMs, Preview).</strong> No API key and no
                egress — prompts and field data never leave the Atlassian platform. Token usage is
                billed to the app vendor (LeanZero), not to your site. Supports tool calling (JQL
                agentic search works); image/file attachments are not analyzed yet. Requests pass
                Atlassian's AI moderation checks.
                <div style={{ marginTop: "6px" }}>
                  <strong>Cost shape.</strong> While a rule waits for a model response, the app also
                  consumes Forge compute time, which is billed to the vendor as well — long AI waits
                  cost more than tokens alone. The default model (Claude Haiku) keeps responses fast,
                  and heavy steps such as document generation, research, and fact-checked rules
                  automatically run in the background queue. Nothing to configure on your side — this
                  is simply why the fast default model is recommended.
                </div>
              </div>
            )}
          </div>

          {/* Azure Endpoint — only for Azure */}
          {provider === "azure" && (
            <div className="anim-rise" style={{ marginBottom: "16px" }}>
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
                <button className={"btn-small btn-edit" + (savingProvider ? " is-busy" : "")} onClick={handleSaveEndpoint} disabled={savingProvider || !endpointInput.trim()}>
                  Save
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
            <div className="anim-rise" style={{ marginBottom: "16px" }}>
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
                  className={"btn-small" + (pinging ? " is-busy" : "")}
                  onClick={handleTestConnection}
                  disabled={pinging || !endpointInput.trim()}
                  style={{ padding: "6px 10px" }}
                >
                  Test
                </button>
                <button className={"btn-small btn-edit" + (savingProvider ? " is-busy" : "")} onClick={handleSaveEndpoint} disabled={savingProvider || !endpointInput.trim()}>
                  Save
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

          {/* Key/Model section — only show for the saved (active) provider.
              Keyed on the provider so swapping providers replays the rise-in. */}
          {provider !== savedProvider ? (
            <div className="anim-rise" style={{ padding: "12px 0", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>
              Click <strong>Switch Provider</strong> to activate {PROVIDER_OPTIONS.find((p) => p.value === provider)?.label || provider} and manage its API key.
            </div>
          ) : (<div className="anim-rise" key={provider}>

          {/* Status — for LM Studio, reflect ACTUAL ping result instead of just
              "URL is set". A green dot only when we've confirmed the server responds
              and accepts our auth (or has no auth requirement). */}
          {(() => {
            // Compute LM Studio status from pingResult. While a ping is in
            // flight (silent OR explicit), say so — the old grey "not yet
            // tested" state was a lie during the auto-ping after page load.
            const checking = isLmStudio && hasKey && pingInFlight;
            let lmStatusColor = "var(--text-muted)";
            let lmStatusTitle = "LM Studio URL not set";
            let lmStatusBody = "Set the Tailscale Funnel URL above (https://*.ts.net pointing at your LM Studio server) to get started.";
            if (checking) {
              lmStatusColor = "var(--primary-color)";
              lmStatusTitle = "Testing connection…";
              lmStatusBody = "Contacting your LM Studio server — verifying reachability and auth.";
            } else if (isLmStudio && hasKey) {
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
            const statusTitle = isLmStudio
              ? lmStatusTitle
              : isAtlassian
                ? "Atlassian-hosted — ready, no key needed"
                : (isByok ? `Using your ${providerLabel} key` : "Using factory key");
            return (
              <div className="openai-status" style={{ marginBottom: "16px" }}>
                {/* Keyed on the resolved title: status changes fade in instead
                    of snapping, and the dot+title row pops (.status-settle)
                    when a ping resolves. */}
                <div key={statusTitle} className="anim-fade">
                  <div className={checking ? undefined : "status-settle"} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                    <span
                      className={checking ? "status-dot status-dot-checking" : "status-dot"}
                      style={{
                        display: "inline-block",
                        width: "8px",
                        height: "8px",
                        borderRadius: "50%",
                        background: isLmStudio ? lmStatusColor : (hasKey ? "var(--success-color)" : "var(--error-color)"),
                      }}
                    />
                    <strong style={{ fontSize: "13px" }}>{statusTitle}</strong>
                  </div>
                  <p style={{ margin: 0, fontSize: "12px", color: "var(--text-secondary)" }}>
                    {isLmStudio
                      ? lmStatusBody
                      : isAtlassian
                      ? "Claude served inside the Atlassian platform — no key, no egress."
                      : isByok
                        ? `Connected to ${providerLabel}. You can select from available models. Remove the key to revert to the factory key.`
                        : hasKey
                          ? `Factory model: ${factoryModel || "gpt-5.4-mini"}. Provide your own ${providerLabel} key to unlock model selection.`
                          : `No API key configured. Provide your ${providerLabel} API key to get started.`
                    }
                  </p>
                  {isAtlassian && (
                    <p style={{ margin: "6px 0 0", fontSize: "12px", color: "var(--text-secondary)" }}>
                      <strong style={{ color: "var(--primary-color)" }}>Only Claude Haiku is available</strong> on this
                      provider right now — larger models are billed to the app vendor. Claude Sonnet is planned as part
                      of the app's upcoming <strong>Advanced</strong> option.
                    </p>
                  )}
                </div>
              </div>
            );
          })()}

          {/* API Key Input — hidden entirely for Forge LLM (no key exists) */}
          {!isAtlassian && (
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
                <button className={"btn-small btn-danger" + (removing ? " is-busy" : "")} onClick={handleRemoveKey} disabled={removing}>
                  Remove Key
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
                <button className={"btn-small btn-edit" + (saving ? " is-busy" : "")} onClick={handleSaveKey} disabled={saving || !keyInput.trim()}>
                  Save Key
                </button>
              </div>
            )}
          </div>
          )}

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
                      className={"btn-small" + (loadingLmModel ? " is-busy" : "")}
                      onClick={handleLoadLmModel}
                      disabled={loadingLmModel || !selectedModel}
                      style={{ padding: "6px 10px" }}
                    >
                      Load
                    </button>
                  )}
                  <button
                    className={"btn-small btn-edit" + (savingModel ? " is-busy" : "")}
                    onClick={handleSaveModel}
                    disabled={savingModel || !selectedModel || selectedModel === currentModel}
                  >
                    Save Model
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
          </div>)}
        </div>
      </div>

      {/* MCP Integrations.
          CogniRunner is the MIDDLE LAYER: on every hosted provider (OpenAI / Azure /
          OpenRouter / Anthropic / Forge LLM) the app itself dials the MCP's URL and runs
          the tool calls — the AI provider never sees the URL or touches the MCP. Each
          MCP is configured like an mcp.json entry (a URL + optional key). LM Studio is
          the local-only alternative (the MCP runs on the user's machine via stdio). All
          three MCPs (context7 / web-search / doc-reader) work this way on every provider. */}
      {provider === savedProvider && (
        <div className="card" style={{ marginTop: "16px" }}>
          <div style={{ padding: "16px" }}>
            <div style={{ marginBottom: "12px" }}>
              <h3 style={{ margin: "0 0 4px 0", fontSize: "14px", fontWeight: 600, color: "var(--text-color)" }}>
                MCP Integrations
              </h3>
              <p style={{ margin: 0, fontSize: "12px", color: "var(--text-secondary)" }}>
                {isLmStudio
                  ? <>Extra tools the model can call via your LM Studio's <code style={{ fontSize: "11px" }}>mcp.json</code> (local, runs on your machine). Enable each and follow the setup steps. JQL agentic search is unaffected — it runs on a separate code path.</>
                  : <><strong>CogniRunner is the middle layer.</strong> Paste each MCP's hosted URL below and CogniRunner connects to it directly and runs the tool calls — your AI provider never sees the URL. Works the same on OpenAI / Azure / OpenRouter / Anthropic / Forge LLM. All three MCPs (<code style={{ fontSize: "11px" }}>context7</code>, <code style={{ fontSize: "11px" }}>web-search</code>, <code style={{ fontSize: "11px" }}>doc-reader</code>) are supported.</>
                }
              </p>
            </div>

            {/* How to connect — the three modes, made explicit. */}
            <div style={{ padding: "10px 12px", marginBottom: "12px", background: "rgba(37, 99, 235, 0.06)", border: "1px solid rgba(37, 99, 235, 0.35)", borderRadius: "6px", fontSize: "11px", color: "var(--text-secondary)" }}>
              <strong style={{ color: "var(--text-color)" }}>Three ways to connect an MCP:</strong>
              <ul style={{ margin: "6px 0 0", paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "4px" }}>
                <li><strong>LeanZero&apos;s hosted demo</strong> — point <code style={{ fontSize: "11px" }}>web-search</code> / <code style={{ fontSize: "11px" }}>doc-processor</code> at our Mac Studio instance; grab a free demo key at <ExtLink href="https://leanzero.atlascrafted.com" style={{ color: "var(--text-color)", fontWeight: 600 }}>leanzero.atlascrafted.com</ExtLink> (links in the cards below). Rate-limited, for evaluation. Works on every provider — CogniRunner connects to it for you.</li>
                <li><strong>Your own self-hosted server</strong> — clone the open-source repo and expose it via <strong>Tailscale Funnel</strong> (<em>required</em> — see the note below), then paste its <code style={{ fontSize: "11px" }}>*.ts.net</code> Service URL + Bearer in the card below. CogniRunner is the client on every hosted provider.</li>
                <li><strong>LM Studio (local stdio)</strong> — run the server locally and point LM Studio&apos;s <code style={{ fontSize: "11px" }}>mcp.json</code> at it. The MCP runs on your machine — the secure, local-only option (LM Studio provider).</li>
              </ul>
              <div style={{ marginTop: "8px", padding: "8px 10px", background: "var(--card-bg)", border: "2px solid #d97706", boxShadow: "0 4px 12px -4px rgba(217, 119, 6, 0.35)", borderRadius: "6px", color: "var(--text-secondary)" }}>
                <strong style={{ color: "var(--text-color)" }}>⚠ The addresses CogniRunner may reach are fixed by the installed app.</strong> It can only connect to an MCP on a <code style={{ fontSize: "11px" }}>*.ts.net</code> Tailscale&nbsp;Funnel URL (port <strong>443</strong>, <strong>8443</strong>, or <strong>10000</strong>) or to context7&apos;s <code style={{ fontSize: "11px" }}>mcp.context7.com</code>. That allow-list ships inside the app and <strong>can&apos;t be changed without re-deploying CogniRunner itself</strong> — which you can&apos;t do as an installer. So to self-host web-search / doc-processor you <strong>must run them behind your own Tailscale Funnel</strong> (any tailnet works — it&apos;s a wildcard); an arbitrary URL like <code style={{ fontSize: "11px" }}>https://mycompany.com/mcp</code> will be blocked. Don&apos;t want to run a Funnel? Use LeanZero&apos;s hosted demo above.</div>
              <div style={{ marginTop: "6px" }}>Service keys (web-search&apos;s Serper key, doc-processor&apos;s Z.AI OCR key) live on the MCP server — LeanZero&apos;s hosted demo manages them for you, so you only need the URL + Bearer. Self-hosters can also pass their own per-tenant keys in the cards below.</div>
            </div>

            {/* context7 — hosted on every provider via the bridge; LM Studio can run it locally */}
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
                  {/* Hosted context7 remote config — URL + OPTIONAL api key (keyless works). */}
                  <div style={{ padding: "10px 12px", marginBottom: "10px", background: "var(--card-bg)", border: "2px solid var(--success-color)", boxShadow: "0 4px 12px -4px rgba(22, 163, 106, 0.35)", borderRadius: "6px", fontSize: "11px" }}>
                    <strong>Hosted context7 (remote MCP)</strong>
                    <div style={{ marginTop: "4px", color: "var(--text-secondary)" }}>
                      Use the <strong>official hosted endpoint</strong> <code style={{ fontSize: "11px" }}>https://mcp.context7.com/mcp</code> (works without a key — a key only raises rate limits; grab one at <ExtLink href="https://context7.com/dashboard" style={{ color: "var(--success-color)", fontWeight: 600 }}>context7.com/dashboard</ExtLink>), or a self-host behind Tailscale Funnel (<code style={{ fontSize: "11px" }}>*.ts.net</code> on port 443 / 8443 / 10000). Those are the only context7 addresses CogniRunner may reach. It connects for you on every provider.
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "8px" }}>
                      <input
                        type="text"
                        placeholder="https://mcp.context7.com/mcp"
                        value={context7Url}
                        onChange={(e) => setContext7Url(e.target.value)}
                        style={{ padding: "5px 8px", border: "1px solid var(--border-color)", borderRadius: "4px", background: "var(--input-bg)", color: "var(--text-color)", fontSize: "11px" }}
                      />
                      {context7HasApiKey && !context7ShowApiKeyInput ? (
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ flex: 1, padding: "5px 8px", border: "1px solid var(--border-color)", borderRadius: "4px", background: "var(--input-bg)", color: "var(--text-muted)", fontFamily: "monospace", fontSize: "11px" }}>
                            ••••••••  (API key saved)
                          </span>
                          <button
                            type="button"
                            onClick={() => setContext7ShowApiKeyInput(true)}
                            disabled={context7Saving}
                            style={{ fontSize: "10px", padding: "4px 8px", border: "1px solid var(--border-color)", borderRadius: "4px", background: "var(--input-bg)", color: "var(--text-color)", cursor: "pointer" }}
                          >Replace</button>
                        </div>
                      ) : (
                        <input
                          type="password"
                          placeholder="CONTEXT7_API_KEY — OPTIONAL (keyless works; a key raises rate limits)"
                          value={context7ApiKeyInput}
                          onChange={(e) => setContext7ApiKeyInput(e.target.value)}
                          style={{ padding: "5px 8px", border: "1px solid var(--border-color)", borderRadius: "4px", background: "var(--input-bg)", color: "var(--text-color)", fontSize: "11px", fontFamily: "monospace" }}
                        />
                      )}
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button
                          type="button"
                          className={context7Saving === "save" ? "is-busy busy-solid" : undefined}
                          onClick={handleSaveContext7Remote}
                          disabled={!!context7Saving || !context7Url.trim()}
                          style={{ fontSize: "11px", padding: "5px 10px", border: "1px solid var(--success-color)", borderRadius: "4px", background: "var(--success-color)", color: "white", cursor: "pointer" }}
                        >Save</button>
                        {(context7HasApiKey || context7Url) && (
                          <button
                            type="button"
                            className={context7Saving === "clear" ? "is-busy" : undefined}
                            onClick={handleRemoveContext7Remote}
                            disabled={!!context7Saving}
                            style={{ fontSize: "11px", padding: "5px 10px", border: "1px solid var(--border-color)", borderRadius: "4px", background: "var(--input-bg)", color: "var(--text-color)", cursor: "pointer" }}
                          >Clear</button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* LM Studio alternative — run context7 locally via mcp.json. */}
                  {isLmStudio && (
                    <>
                      <p style={{ margin: "0 0 8px", fontSize: "12px", color: "var(--text-secondary)" }}>
                        <strong>LM Studio alternative (local):</strong> add this to your <code style={{ fontSize: "11px" }}>mcp.json</code> (the entry name <strong>must</strong> be <code style={{ fontSize: "11px" }}>context7</code> so our app can find it):
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
                </>
              )}
            />

            {/* web-search — visible for ALL providers. On every hosted provider
                (OpenAI / Azure / OpenRouter / Anthropic / Forge LLM) CogniRunner is
                the MCP client and proxies the tool calls; LM Studio loads it from
                local/remote mcp.json. */}
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
                  <div style={{ padding: "10px 12px", marginBottom: "10px", background: "var(--card-bg)", border: "2px solid var(--success-color)", boxShadow: "0 4px 12px -4px rgba(22, 163, 106, 0.35)", borderRadius: "6px", fontSize: "11px" }}>
                    <strong>Hosted web-search (remote MCP)</strong>
                    <div style={{ marginTop: "4px", color: "var(--text-secondary)" }}>
                      Point this at a web-search MCP. Use <strong>your own self-host</strong> (clone <code style={{ fontSize: "11px" }}>mcp-web-search</code> and expose it via Tailscale Funnel — the URL <strong>must</strong> be <code style={{ fontSize: "11px" }}>*.ts.net</code> on port 443 / 8443 / 10000, see the note above) or <strong>LeanZero&apos;s hosted demo</strong> — <ExtLink href="https://leanzero.atlascrafted.com/portfolio/mcp-web-search#get-key" style={{ color: "var(--success-color)", fontWeight: 600 }}>get a free demo key →</ExtLink>. Independent from doc-processor (separate URL + Bearer). The MCP is keyless, so also paste a Serper key (free tier at <ExtLink href="https://serper.dev" style={{ color: "var(--success-color)", fontWeight: 600 }}>serper.dev</ExtLink>) — it powers every search.
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
                      {webSearchHasGithub && !webSearchShowGithubInput ? (
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ flex: 1, padding: "5px 8px", border: "1px solid var(--border-color)", borderRadius: "4px", background: "var(--input-bg)", color: "var(--text-muted)", fontFamily: "monospace", fontSize: "11px" }}>
                            ••••••••  (GitHub token saved)
                          </span>
                          <button
                            type="button"
                            onClick={() => setWebSearchShowGithubInput(true)}
                            disabled={webSearchSaving}
                            style={{ fontSize: "10px", padding: "4px 8px", border: "1px solid var(--border-color)", borderRadius: "4px", background: "var(--input-bg)", color: "var(--text-color)", cursor: "pointer" }}
                          >Replace</button>
                        </div>
                      ) : (
                        <input
                          type="password"
                          placeholder="GitHub token — OPTIONAL, for the github tool (rate limits / private repos)"
                          value={webSearchGithubInput}
                          onChange={(e) => setWebSearchGithubInput(e.target.value)}
                          style={{ padding: "5px 8px", border: "1px solid var(--border-color)", borderRadius: "4px", background: "var(--input-bg)", color: "var(--text-color)", fontSize: "11px", fontFamily: "monospace" }}
                        />
                      )}
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button
                          type="button"
                          className={webSearchSaving === "save" ? "is-busy busy-solid" : undefined}
                          onClick={handleSaveWebSearchRemote}
                          disabled={!!webSearchSaving || !webSearchUrl.trim() || (!webSearchHasBearer && !webSearchBearerInput.trim()) || (webSearchShowBearerInput && !webSearchBearerInput.trim())}
                          style={{ fontSize: "11px", padding: "5px 10px", border: "1px solid var(--success-color)", borderRadius: "4px", background: "var(--success-color)", color: "white", cursor: "pointer" }}
                        >Save</button>
                        {(webSearchHasBearer || webSearchUrl) && (
                          <button
                            type="button"
                            className={webSearchSaving === "clear" ? "is-busy" : undefined}
                            onClick={handleRemoveWebSearchRemote}
                            disabled={!!webSearchSaving}
                            style={{ fontSize: "11px", padding: "5px 10px", border: "1px solid var(--border-color)", borderRadius: "4px", background: "var(--input-bg)", color: "var(--text-color)", cursor: "pointer" }}
                          >Clear</button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Provider-specific guidance for what happens once saved */}
                  {(provider === "anthropic" || provider === "openai" || provider === "azure" || provider === "openrouter") && (
                    <div style={{ padding: "8px 10px", marginBottom: "10px", background: "rgba(34, 197, 94, 0.08)", border: "1px solid rgba(34, 197, 94, 0.4)", borderRadius: "6px", fontSize: "11px" }}>
                      <strong>{provider === "anthropic" ? "Anthropic" : provider === "azure" ? "Azure OpenAI" : provider === "openrouter" ? "OpenRouter" : "OpenAI"} support: enabled.</strong> CogniRunner is the MCP client: during agentic validation it lists the enabled web-search tools, exposes the curated subset to the model as function tools, and proxies each tool call to the hosted server. Your AI provider never sees the URL. Configure the Service URL + Bearer (+ the Serper key) above and toggle the MCP on.
                    </div>
                  )}
                  {isAtlassian && (
                    <div style={{ padding: "8px 10px", marginBottom: "10px", background: "var(--card-bg)", border: "2px solid #d97706", boxShadow: "0 4px 12px -4px rgba(217, 119, 6, 0.35)", borderRadius: "6px", fontSize: "11px" }}>
                      <strong>Atlassian Forge LLM: works via the CogniRunner MCP bridge.</strong> The model can&apos;t reach MCP servers itself, but CogniRunner exposes the hosted web-search tools as function tools and proxies the calls from the Forge backend. Configure the hosted web-search above and enable this toggle.
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

            {/* doc-reader — visible for ALL providers. On every hosted provider
                (OpenAI / Azure / OpenRouter / Anthropic / Forge LLM) CogniRunner is
                the MCP client and proxies the tool calls; LM Studio loads it from
                local/remote mcp.json. */}
            <McpCard
              mcpKey="docReader"
              title="doc-reader"
              subtitle="Read PDF / DOCX / Excel / PowerPoint, and (with doc-writer) create / edit DOCX, PDF, Excel, Markdown, PPTX, plus fact-check"
              tools={["read-doc", "detect-format", "list-documents", "list-templates", "create-doc", "create-markdown", "create-excel", "create-pdf", "create-pptx", "edit-pptx", "fact-check"]}
              enabled={mcpEnabled.docReader}
              saving={mcpSavingKey === "docReader"}
              expanded={!!mcpExpanded.docReader}
              ping={mcpPingState.docReader}
              onToggle={() => handleMcpToggle("docReader")}
              onExpand={() => setMcpExpanded((p) => ({ ...p, docReader: !p.docReader }))}
              onPing={() => handleMcpPing("docReader")}
              setupBlock={(
                <>
                  {/* Hosted doc-processor remote config — the bridge dials this URL
                      on every hosted provider; LM Studio can also point its local
                      mcp.json at the same URL. Saved bearer is never sent back from
                      the backend; we only show "saved". */}
                  <div style={{ padding: "10px 12px", marginBottom: "10px", background: "var(--card-bg)", border: "2px solid var(--success-color)", boxShadow: "0 4px 12px -4px rgba(22, 163, 106, 0.35)", borderRadius: "6px", fontSize: "11px" }}>
                    <strong>Hosted doc-processor (remote MCP)</strong>
                    <div style={{ marginTop: "4px", color: "var(--text-secondary)" }}>
                      Point this at a doc-processor MCP. Use <strong>your own self-host</strong> (clone <code style={{ fontSize: "11px" }}>leanzero-mcp-doc-processor</code> and expose it via Tailscale Funnel — the URL <strong>must</strong> be <code style={{ fontSize: "11px" }}>*.ts.net</code> on port 443 / 8443 / 10000, see the note above) or <strong>LeanZero&apos;s hosted demo</strong> on our Mac Studio — <ExtLink href="https://leanzero.atlascrafted.com/portfolio/mcp-doc-processor#get-key" style={{ color: "var(--success-color)", fontWeight: 600 }}>get a free demo key →</ExtLink>. Paste the Service URL + Bearer below. LM Studio can alternatively point its <code style={{ fontSize: "11px" }}>mcp.json</code> at the same URL (see below).
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
                      {docProcHasZai && !docProcShowZaiInput ? (
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ flex: 1, padding: "5px 8px", border: "1px solid var(--border-color)", borderRadius: "4px", background: "var(--input-bg)", color: "var(--text-muted)", fontFamily: "monospace", fontSize: "11px" }}>
                            ••••••••  (Z.AI key saved)
                          </span>
                          <button
                            type="button"
                            onClick={() => setDocProcShowZaiInput(true)}
                            disabled={docProcSaving}
                            style={{ fontSize: "10px", padding: "4px 8px", border: "1px solid var(--border-color)", borderRadius: "4px", background: "var(--input-bg)", color: "var(--text-color)", cursor: "pointer" }}
                          >Replace</button>
                        </div>
                      ) : (
                        <input
                          type="password"
                          placeholder="Z.AI key — OPTIONAL, only for OCR of scanned PDFs (z.ai)"
                          value={docProcZaiInput}
                          onChange={(e) => setDocProcZaiInput(e.target.value)}
                          style={{ padding: "5px 8px", border: "1px solid var(--border-color)", borderRadius: "4px", background: "var(--input-bg)", color: "var(--text-color)", fontSize: "11px", fontFamily: "monospace" }}
                        />
                      )}
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button
                          type="button"
                          className={docProcSaving === "save" ? "is-busy busy-solid" : undefined}
                          onClick={handleSaveDocProcRemote}
                          disabled={!!docProcSaving || !docProcUrl.trim() || (!docProcHasBearer && !docProcBearerInput.trim()) || (docProcShowBearerInput && !docProcBearerInput.trim())}
                          style={{ fontSize: "11px", padding: "5px 10px", border: "1px solid var(--success-color)", borderRadius: "4px", background: "var(--success-color)", color: "white", cursor: "pointer" }}
                        >Save</button>
                        {(docProcHasBearer || docProcUrl) && (
                          <button
                            type="button"
                            className={docProcSaving === "clear" ? "is-busy" : undefined}
                            onClick={handleRemoveDocProcRemote}
                            disabled={!!docProcSaving}
                            style={{ fontSize: "11px", padding: "5px 10px", border: "1px solid var(--border-color)", borderRadius: "4px", background: "var(--input-bg)", color: "var(--text-color)", cursor: "pointer" }}
                          >Clear</button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Provider-specific guidance for what happens once saved */}
                  {(provider === "anthropic" || provider === "openai" || provider === "azure" || provider === "openrouter") && (
                    <div style={{ padding: "8px 10px", marginBottom: "10px", background: "rgba(34, 197, 94, 0.08)", border: "1px solid rgba(34, 197, 94, 0.4)", borderRadius: "6px", fontSize: "11px" }}>
                      <strong>{provider === "anthropic" ? "Anthropic" : provider === "azure" ? "Azure OpenAI" : provider === "openrouter" ? "OpenRouter" : "OpenAI"} support: enabled.</strong> CogniRunner is the MCP client: during agentic validation it lists the enabled doc-reader tools, exposes them to the model as function tools, and proxies the tool calls to the hosted doc-processor. Your AI provider never sees the URL. Configure the URL + Bearer above and enable doc-reader (and doc-writer for the create/edit tools). The single-use upload capability for each Jira issue is bound server-side — the model cannot redirect uploads.
                    </div>
                  )}
                  {isAtlassian && (
                    <div style={{ padding: "8px 10px", marginBottom: "10px", background: "var(--card-bg)", border: "2px solid #d97706", boxShadow: "0 4px 12px -4px rgba(217, 119, 6, 0.35)", borderRadius: "6px", fontSize: "11px" }}>
                      <strong>Atlassian Forge LLM: works via the CogniRunner MCP bridge.</strong> Doc-reader tools are exposed as function tools and proxied from the Forge backend. Note: Forge LLM accepts no inline file input, so direct attachment analysis is skipped — the model reads attachments through doc-reader's URL variant instead.
                    </div>
                  )}
                  {isLmStudio && (
                    <div style={{ padding: "8px 10px", marginBottom: "10px", background: "var(--card-bg)", border: "2px solid var(--primary-color)", boxShadow: "0 4px 12px -4px rgba(37, 99, 235, 0.35)", borderRadius: "6px", fontSize: "11px" }}>
                      <strong>Jira attachments:</strong> when this MCP is on, the validator mints a one-shot URL + Bearer token for each attachment and feeds them to the model, so it can call <code style={{ fontSize: "11px" }}>read-doc</code> with <code style={{ fontSize: "11px" }}>url</code> + <code style={{ fontSize: "11px" }}>authHeader</code>. Two ways to wire LM Studio to doc-processor: (a) <strong>local stdio</strong> — clone the repo and run <code style={{ fontSize: "11px" }}>node src/index.js</code> from <code style={{ fontSize: "11px" }}>mcp.json</code>; (b) <strong>remote HTTP</strong> (LM Studio &ge;0.3.17) — point <code style={{ fontSize: "11px" }}>mcp.json</code> at the hosted URL above with the Bearer in headers. Either way, the entry name in <code style={{ fontSize: "11px" }}>mcp.json</code> <strong>must</strong> be <code style={{ fontSize: "11px" }}>doc-reader</code>.
                    </div>
                  )}

                  {/* docWriter sub-toggle — applies to ALL providers when doc-reader is on */}
                  <div style={{ padding: "8px 10px", marginBottom: "10px", background: "var(--card-bg)", border: "2px solid var(--error-color)", boxShadow: "0 4px 12px -4px rgba(220, 38, 38, 0.35)", borderRadius: "6px", fontSize: "11px" }}>
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
              className={ping?.loading ? "is-busy" : undefined}
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
              Test
            </button>
          )}
        </div>
      </div>

      {ping && !ping.loading && (
        <div className="anim-pop" style={{
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
        <div className="anim-rise" style={{ marginTop: "10px", paddingTop: "10px", borderTop: "1px solid var(--border-color)" }}>
          {setupBlock}
        </div>
      )}
    </div>
  );
}
