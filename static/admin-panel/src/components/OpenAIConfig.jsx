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
  { value: "bedrock", label: "AWS Bedrock", icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5z"/></svg>' },
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
  // AWS Bedrock: the API key is a plain bearer token (no SigV4). No endpoint URL —
  // the region (picked below) determines the Converse host. regionNeeded shows the picker.
  bedrock: { keyPlaceholder: "Bedrock API key (bearer token)", keyLabel: "Bedrock API Key", endpointNeeded: false, regionNeeded: true },
};

// AWS Bedrock regions. Bedrock endpoints are region-specific and model availability
// varies by region. eu-west-2 (London) is the test account's region; it is in the EU
// cross-region inference group (Anthropic models use eu.* inference-profile ids there).
const BEDROCK_REGIONS = [
  { value: "us-east-1", label: "us-east-1 · N. Virginia" },
  { value: "us-east-2", label: "us-east-2 · Ohio" },
  { value: "us-west-2", label: "us-west-2 · Oregon" },
  { value: "eu-west-1", label: "eu-west-1 · Ireland" },
  { value: "eu-west-2", label: "eu-west-2 · London" },
  { value: "eu-west-3", label: "eu-west-3 · Paris" },
  { value: "eu-central-1", label: "eu-central-1 · Frankfurt" },
  { value: "eu-north-1", label: "eu-north-1 · Stockholm" },
  { value: "ap-northeast-1", label: "ap-northeast-1 · Tokyo" },
  { value: "ap-southeast-1", label: "ap-southeast-1 · Singapore" },
  { value: "ap-southeast-2", label: "ap-southeast-2 · Sydney" },
  { value: "ap-south-1", label: "ap-south-1 · Mumbai" },
  { value: "ca-central-1", label: "ca-central-1 · Canada" },
];

// Built-in, always-available descriptions of every MCP tool CogniRunner can use. Shown as a
// hover tooltip on each tool chip so admins understand what a tool does even before (or without)
// a live server connection. A live server description, when fetched, overrides the static text.
const TOOL_DESCRIPTIONS = {
  // context7
  "resolve-library-id": "Resolve a library/framework/SDK name to its context7 ID so its docs can be fetched.",
  "query-docs": "Fetch current, version-accurate documentation for a resolved library/framework/SDK.",
  // web-search
  "get-web-search-summaries": "Return short summaries of the top web results for a query (cheap, fast).",
  "full-web-search": "Run a full web search and return ranked results with snippets and source URLs.",
  "get-single-web-page-content": "Fetch one web page and extract its readable text content.",
  "get-pdf-content": "Download a PDF by URL and extract its text content.",
  // doc-processor / doc-reader (+ docWriter create-* tools)
  "read-doc": "Read and extract text from an attached document (PDF / DOCX / XLSX / etc.).",
  "create-doc": "Generate a Word (.docx) document from authored content and attach it to the issue.",
  "create-markdown": "Generate a Markdown (.md) document from authored content and attach it.",
  "create-excel": "Generate an Excel (.xlsx) spreadsheet from structured data and attach it.",
  "create-pdf": "Generate a PDF document from authored content and attach it.",
  "create-pptx": "Generate a PowerPoint (.pptx) deck from authored content and attach it.",
  "fact-check": "Extract factual claims from text and check each against live web sources.",
  "list-templates": "List the document templates / style presets the doc server offers.",
};

export default function OpenAIConfig({ invoke }) {
  const [provider, setProvider] = useState("atlassian");
  const [activeProvider, setActiveProvider] = useState("atlassian"); // what's actually saved in KVS
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
  const [listUnavailable, setListUnavailable] = useState(false); // Bedrock: live list returned nothing
  const [currentModel, setCurrentModel] = useState(null);
  const [selectedModel, setSelectedModel] = useState("");
  // AI usage meter (admin-only). Best-effort under-count of AI calls + tokens.
  const [usage, setUsage] = useState(null);
  const [usageConfirmReset, setUsageConfirmReset] = useState(false);
  const [usageResetting, setUsageResetting] = useState(false);
  // AWS Bedrock: region rides the base URL; ack is the Anthropic use-case gate; the
  // free-text field lets the admin paste any model / inference-profile id directly.
  const [bedrockRegion, setBedrockRegion] = useState("eu-west-2");
  const [bedrockAck, setBedrockAck] = useState(false);
  const [savingAck, setSavingAck] = useState(false);
  const [customModelInput, setCustomModelInput] = useState("");
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
  // LM Studio: model-picker "loaded only" filter + the max-concurrent-jobs cap.
  const [lmLoadedOnly, setLmLoadedOnly] = useState(false);
  const [lmConcurrency, setLmConcurrency] = useState(0);
  const [lmConcurrencyInput, setLmConcurrencyInput] = useState("");
  const [savingConcurrency, setSavingConcurrency] = useState(false);
  // LM Studio multi-model pool: spread runtime validations across all loaded models (default ON).
  const [lmPool, setLmPool] = useState(true);
  const [savingPool, setSavingPool] = useState(false);
  // Per-model dispatch weights (down-weight slower devices). { modelId: weight }.
  const [lmWeights, setLmWeights] = useState({});
  const [lmWeightModels, setLmWeightModels] = useState([]);
  const [savingWeights, setSavingWeights] = useState(false);
  // LM Studio MCP integrations — fixed set of 3 (context7, web-search, doc-reader).
  // Other MCPs in the user's mcp.json are NOT exposed by us per design.
  const [mcpEnabled, setMcpEnabled] = useState({ context7: false, webSearch: false, docReader: false, docWriter: false, localContext7: false, localWebSearch: false, localDocReader: false });
  const [mcpSavingKey, setMcpSavingKey] = useState(null); // which key is currently saving
  const [mcpExpanded, setMcpExpanded] = useState({}); // which setup panels are open
  const [showMcpHelp, setShowMcpHelp] = useState(false); // collapsible "how MCP connections work" guide
  const [mcpPingState, setMcpPingState] = useState({}); // {[key]: {loading, ok, error}}
  // Hosted doc-processor (remote MCP). The cross-provider bridge dials this URL on
  // every hosted provider; LM Studio can also point its own mcp.json at the same
  // URL+bearer (no CogniRunner code change for that case).
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
  // Distinct LM Link device labels surfaced by getOpenAIModels (probe-gated:
  // empty until LM Studio actually tags remote-device instances). When present,
  // the model picker groups models by device.
  const lmDevices = [...new Set((modelDetails || []).map((m) => m.device).filter(Boolean))];
  const isAtlassian = provider === "atlassian";
  const isBedrock = provider === "bedrock";
  // Tracks the provider whose config is currently being loaded, so a fast switch
  // doesn't let a slow in-flight load() overwrite the newer provider's state.
  const providerRef = useRef("atlassian");
  const providerLabelFor = (p) => PROVIDER_OPTIONS.find((o) => o.value === p)?.label || p;

  // "Unchanged" flags so Save buttons disable when there's nothing to save (no confusing
  // always-active Save). baseUrl holds the VIEWED provider's saved URL (set by loadProviderConfig).
  const bedrockSavedRegion = (() => {
    const m = (baseUrl || "").match(/bedrock-runtime\.([a-z0-9-]+)\.amazonaws\.com/i);
    return m ? m[1].toLowerCase() : null;
  })();
  const bedrockRegionUnchanged = bedrockRegion === bedrockSavedRegion;
  const endpointUnchanged = endpointInput.trim() === (baseUrl || "").trim();

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

  // Load the per-provider config for the provider being VIEWED. Passing {provider} lets the
  // admin browse/edit ANY provider's stored config (key status, models, saved model, URL/region)
  // WITHOUT activating it. Guarded by providerRef so a fast switch isn't clobbered by a slow
  // in-flight load.
  const loadProviderConfig = async (target, { asRefresh = false } = {}) => {
    if (!invoke) return;
    providerRef.current = target;
    if (asRefresh) beginRefresh();
    try {
      const [keyResult, modelsResult, modelKvs] = await Promise.all([
        invoke("getOpenAIKey", { provider: target }),
        invoke("getOpenAIModels", { provider: target }),
        invoke("getOpenAIModelFromKVS", { provider: target }),
      ]);
      // A newer switch superseded this load — drop the stale result.
      if (providerRef.current !== target) return;

      if (keyResult.success) {
        setHasKey(keyResult.hasKey);
        setIsByok(keyResult.isByok);
        // For LM Studio, hasToken reflects whether a Bearer token is actually saved
        // (separate from isByok which just means "URL is configured").
        setHasToken(!!keyResult.hasToken);
        // The viewed provider's OWN base URL → populate the endpoint (azure/lmstudio) and
        // region (bedrock) fields for whichever provider is being viewed, not just the active.
        const b = keyResult.baseUrl || "";
        setBaseUrl(b);
        setEndpointInput((target === "azure" || target === "lmstudio") ? b : "");
        if (target === "bedrock") {
          const m = b.match(/bedrock-runtime\.([a-z0-9-]+)\.amazonaws\.com/i);
          setBedrockRegion(m ? m[1].toLowerCase() : "eu-west-2");
        }
        // LM Studio: silent auto-ping for live status; clear any stale ping otherwise.
        if (target === "lmstudio" && b) {
          runLmStudioPing({ baseUrlOverride: b, silent: true });
        } else {
          setPingResult(null);
        }
      }
      if (modelsResult.success) {
        setModels(modelsResult.models || []);
        setModelDetails(modelsResult.modelDetails || []);
        setListUnavailable(!!modelsResult.listUnavailable);
        if (!modelsResult.isByok) setFactoryModel(modelsResult.currentModel || "");
      }
      if (modelKvs.success) {
        setCurrentModel(modelKvs.model);
        setSelectedModel(modelKvs.model || "");
        if (!modelKvs.isByok) setFactoryModel(modelKvs.model || "");
      }
      setCustomModelInput("");
    } catch (e) {
      console.error("Failed to load provider config:", e);
      if (asRefresh) showToast("Failed to load provider config: " + (e.message || e), "error");
      else setLoadError(e.message || String(e));
    } finally {
      if (asRefresh) endRefresh();
    }
  };

  // Mount load: global/active state (active provider, Anthropic ack, MCP/remote configs) PLUS
  // the active provider's own config. The dropdown then loads other providers on demand via
  // loadProviderConfig — viewing a provider never changes which one is active.
  const loadStatus = async () => {
    if (!invoke) return;
    try {
      const [providerResult, mcpsResult, docProcResult, webSearchResult, context7Result, usageResult] = await Promise.all([
        invoke("getProvider"),
        invoke("getLmStudioMcps").catch(() => ({ success: false })),
        invoke("getDocProcessorRemote").catch(() => ({ success: false })),
        invoke("getWebSearchRemote").catch(() => ({ success: false })),
        invoke("getContext7Remote").catch(() => ({ success: false })),
        invoke("getAiUsage").catch(() => ({ success: false })),
      ]);
      if (usageResult && usageResult.success) setUsage(usageResult.usage);

      let initial = "atlassian";
      if (providerResult.success) {
        initial = providerResult.provider || "atlassian";
        setActiveProvider(initial);
        setProvider(initial);
        setBedrockAck(!!providerResult.bedrockAck);
      }
      if (mcpsResult && mcpsResult.success) {
        setMcpEnabled(mcpsResult.enabled || { context7: false, webSearch: false, docReader: false, docWriter: false, localContext7: false, localWebSearch: false, localDocReader: false });
      }
      if (docProcResult && docProcResult.success) {
        setDocProcUrl(docProcResult.url || "");
        setDocProcHasBearer(!!docProcResult.hasBearer);
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
      // Show the active provider's config first.
      await loadProviderConfig(initial);
    } catch (e) {
      console.error("Failed to load AI config status:", e);
      setLoadError(e.message || String(e));
    } finally {
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
    // On the hosted-bridge path (every non-LM-Studio provider), fetch the live tool
    // list the moment an MCP is enabled so the card shows what it can actually use.
    // docWriter widens doc-reader's tools, so re-fetch doc-reader when it flips.
    if (!isLmStudio) {
      if (mcpKey === "docWriter") {
        if (next.docReader) handleMcpPing("docReader");
      } else if (!mcpKey.startsWith("local") && next[mcpKey] === true) {
        handleMcpPing(mcpKey);
      }
    }
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
          // Live, vetted tool list the server actually exposes (∩ what CogniRunner
          // uses). testMcpConnection returns it; LM Studio's local probe does not.
          tools: Array.isArray(result.tools) ? result.tools : undefined,
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
    // Allow saving when a Bearer is already saved (masked) — only require a fresh
    // Bearer on first setup. Re-entering the key just to edit the URL was the bug.
    if (!docProcUrl.trim() || (!docProcHasBearer && !docProcBearerInput.trim())) return;
    // "save" vs "clear" so only the clicked button shows the busy spinner.
    setDocProcSaving("save");
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
    // Allow saving the URL/Serper edits when a Bearer is already saved (masked);
    // only require a fresh Bearer on first setup. (The "save didn't work unless I
    // changed the key" bug.)
    if (!webSearchUrl.trim() || (!webSearchHasBearer && !webSearchBearerInput.trim())) return;
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

  // Switch which provider's config is being VIEWED — does NOT activate it. Loads that
  // provider's stored config so the admin can inspect/edit any provider without changing
  // which one runs AI.
  const handleSelectProvider = (p) => {
    if (p === provider) return;
    setProvider(p);
    providerRef.current = p;
    setError(null);
    setSuccess(null);
    setPingResult(null);
    setKeyInput("");
    setCustomModelInput("");
    loadProviderConfig(p, { asRefresh: true });
  };

  // Make the VIEWED provider the ACTIVE one (the provider inference uses). Persists any
  // endpoint/region currently entered, then activates. This is the ONLY path that changes
  // the active provider — editing a provider's key/model/URL leaves the active one untouched.
  const handleSetActive = async () => {
    setSavingProvider(true);
    setError(null);
    setSuccess(null);
    setPingResult(null);
    try {
      const payload = { provider }; // activate defaults to true
      // Azure / LM Studio carry a user-supplied base URL; Bedrock a region.
      if ((provider === "azure" || provider === "lmstudio") && endpointInput.trim()) {
        payload.baseUrl = endpointInput.trim();
      }
      if (provider === "bedrock") payload.region = bedrockRegion;
      const result = await invoke("saveProvider", payload);
      if (result.success) {
        setActiveProvider(provider);
        const label = providerLabelFor(provider);
        // Hold the veil over the settle delay + re-fetch so stale data never reads as live.
        beginRefresh();
        try {
          await new Promise((r) => setTimeout(r, 500));
          // asRefresh so a transient reload failure shows a toast over the (still-valid) panel
          // instead of nuking the whole card to the fatal loadError screen — activation succeeded.
          await loadProviderConfig(provider, { asRefresh: true });
          if (provider === "lmstudio") {
            const ping = await runLmStudioPing({ silent: true });
            if (ping?.success && ping.ok && ping.authOk) {
              setSuccess(`${label} is now active — connected, ${ping.modelCount || 0} model(s) found.`);
            } else if (ping?.tokenRequired || ping?.tokenInvalid) {
              setError(ping.error);
            } else if (ping && !ping.success) {
              setError(ping.error || `${label} is now active, but the connection test failed.`);
            } else {
              setSuccess(`${label} is now the active provider.`);
            }
          } else {
            setSuccess(`${label} is now the active provider.`);
          }
        } finally {
          endRefresh();
        }
        showToast(`${label} set as active`);
      } else {
        setError(result.error || "Failed to set active provider");
      }
    } catch (e) {
      setError("Failed to set active provider: " + e.message);
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
      // activate:false — saving the endpoint edits this provider's config WITHOUT making it
      // the active provider (use "Set as active" for that).
      const result = await invoke("saveProvider", { provider, baseUrl: endpointInput.trim(), activate: false });
      if (result.success) {
        await loadProviderConfig(provider, { asRefresh: true });
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
        await loadProviderConfig(provider, { asRefresh: true });
      } else {
        setError(result.error || "Failed to load model");
      }
    } catch (e) {
      setError("Failed to load model: " + e.message);
    }
    setLoadingLmModel(false);
  };

  // Load the saved max-concurrent-LM-Studio-jobs cap when viewing LM Studio.
  useEffect(() => {
    if (!isLmStudio || !invoke) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await invoke("getLmStudioConcurrency");
        if (!cancelled && r && r.success) {
          setLmConcurrency(r.limit || 0);
          setLmConcurrencyInput(r.limit ? String(r.limit) : "");
        }
      } catch (e) { /* non-fatal — cap is optional */ }
      // Independent of the cap load: a concurrency-resolver failure must not
      // hide the saved pool value (defaults ON if this also fails).
      try {
        const rp = await invoke("getLmStudioPool");
        if (!cancelled && rp && rp.success) setLmPool(rp.enabled !== false);
      } catch (e) { /* non-fatal — pool defaults ON */ }
      try {
        const rw = await invoke("getLmStudioWeights");
        if (!cancelled && rw && rw.success) { setLmWeights(rw.weights || {}); setLmWeightModels(rw.models || []); }
      } catch (e) { /* non-fatal — weights default to 1 */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLmStudio]);

  const handleSaveConcurrency = async () => {
    const n = lmConcurrencyInput.trim() === "" ? 0 : Number(lmConcurrencyInput);
    if (!Number.isFinite(n) || n < 0) { setError("Enter a non-negative number (0 = uncapped)."); return; }
    setSavingConcurrency(true);
    setError(null);
    setSuccess(null);
    try {
      const r = await invoke("saveLmStudioConcurrency", { limit: Math.floor(n) });
      if (r && r.success) {
        setLmConcurrency(r.limit || 0);
        setLmConcurrencyInput(r.limit ? String(r.limit) : "");
        setSuccess(r.limit ? `Capped at ${r.limit} concurrent LM Studio job(s).` : "LM Studio concurrency uncapped.");
      } else {
        setError((r && r.error) || "Failed to save concurrency cap");
      }
    } catch (e) {
      setError("Failed to save concurrency cap: " + e.message);
    }
    setSavingConcurrency(false);
  };

  const handleTogglePool = async () => {
    const next = !lmPool;
    setSavingPool(true);
    setError(null);
    setSuccess(null);
    try {
      const r = await invoke("saveLmStudioPool", { enabled: next });
      if (r && r.success) {
        setLmPool(r.enabled !== false);
        setSuccess(r.enabled
          ? "Runtime validations will spread across all loaded models."
          : "Runtime validations pinned to the selected model.");
      } else {
        setError((r && r.error) || "Failed to save model-pool setting");
      }
    } catch (e) {
      setError("Failed to save model-pool setting: " + e.message);
    }
    setSavingPool(false);
  };

  const handleSetWeight = async (modelId, weight) => {
    const next = { ...lmWeights };
    if (Number(weight) > 1) next[modelId] = Number(weight); else delete next[modelId];
    setLmWeights(next);
    setSavingWeights(true); setError(null); setSuccess(null);
    try {
      const r = await invoke("saveLmStudioWeights", { weights: next });
      if (r && r.success) { setLmWeights(r.weights || {}); setSuccess("Device dispatch weights updated."); }
      else setError((r && r.error) || "Failed to save weights");
    } catch (e) { setError("Failed to save weights: " + e.message); }
    setSavingWeights(false);
  };

  const handleSaveKey = async () => {
    if (!keyInput.trim()) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const tokenJustSaved = keyInput.trim();
      // Save to the VIEWED provider's slot (not necessarily the active one).
      const result = await invoke("saveOpenAIKey", { key: tokenJustSaved, provider });
      if (result.success) {
        setKeyInput("");
        // Brief delay to let KVS propagate, then reload this provider's config —
        // veiled so the stale pre-save status never reads as live.
        beginRefresh();
        try {
          await new Promise((r) => setTimeout(r, 500));
          await loadProviderConfig(provider, { asRefresh: true });
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
      const result = await invoke("removeOpenAIKey", { provider });
      if (result.success) {
        setSuccess("Key removed");
        showToast("Key removed — enter your own key to use this provider");
        setModels([]);
        setCurrentModel(null);
        setSelectedModel("");
        await loadProviderConfig(provider, { asRefresh: true });
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
      const result = await invoke("saveOpenAIModel", { model: selectedModel, provider });
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

  // Bedrock: save the chosen region (the backend constructs the Converse host from it).
  // activate:false — editing the region does NOT activate Bedrock.
  const handleSaveBedrockRegion = async () => {
    setSavingProvider(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await invoke("saveProvider", { provider: "bedrock", region: bedrockRegion, activate: false });
      if (result.success) {
        beginRefresh();
        try {
          await new Promise((r) => setTimeout(r, 500));
          await loadProviderConfig("bedrock", { asRefresh: true });
        } finally {
          endRefresh();
        }
        setSuccess(`Bedrock region set to ${bedrockRegion}`);
        showToast("Bedrock region saved");
      } else {
        setError(result.error || "Failed to save region");
      }
    } catch (e) {
      setError("Failed to save region: " + e.message);
    }
    setSavingProvider(false);
  };

  // Bedrock: persist the Anthropic use-case acknowledgment. Purely informational — it no
  // longer gates anything, so no reload is needed (and the optimistic value is what we keep).
  const handleSaveBedrockAck = async (checked) => {
    setSavingAck(true);
    setBedrockAck(checked); // optimistic
    try {
      const result = await invoke("setBedrockAck", { acknowledged: checked });
      if (!result.success) {
        setBedrockAck(!checked); // revert
        setError(result.error || "Failed to save acknowledgment");
      }
    } catch (e) {
      setBedrockAck(!checked);
      setError("Failed to save acknowledgment: " + e.message);
    }
    setSavingAck(false);
  };

  // Bedrock (and any provider): save a free-text model / inference-profile id the admin
  // pasted, instead of picking from the dropdown. Many Bedrock models need a profile id
  // (eu./us.) that the live list may not surface, so manual entry is always available.
  const handleSaveCustomModel = async () => {
    const model = customModelInput.trim();
    if (!model) return;
    setSavingModel(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await invoke("saveOpenAIModel", { model, provider });
      if (result.success) {
        setCurrentModel(model);
        setSelectedModel(model);
        setCustomModelInput("");
        setSuccess("Model saved: " + model);
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

  const resetUsage = async () => {
    setUsageResetting(true);
    try {
      const r = await invoke("resetAiUsage");
      if (r && r.success) {
        const u = await invoke("getAiUsage").catch(() => null);
        if (u && u.success) setUsage(u.usage);
      }
    } catch (e) { /* ignore */ }
    setUsageResetting(false);
    setUsageConfirmReset(false);
  };

  const usageProviderMax = usage ? Math.max(1, ...Object.values(usage.month.byProvider || {}).map((x) => x.total || 0)) : 1;

  return (
    <div className="section">
      <div className="section-header">
        <span className="section-title">AI Provider Configuration</span>
      </div>

      {usage && (
        <div className="usage-card">
          <div className="usage-head">
            <span className="usage-eyebrow">§ AI USAGE</span>
            {usageConfirmReset ? (
              <span className="usage-reset-confirm">
                Reset all counts?
                <button className={`btn-small btn-danger${usageResetting ? " is-busy" : ""}`} onClick={resetUsage} disabled={usageResetting}>Reset</button>
                <button className="btn-small" onClick={() => setUsageConfirmReset(false)} disabled={usageResetting}>Cancel</button>
              </span>
            ) : (
              <button className="btn-small" onClick={() => setUsageConfirmReset(true)}>Reset</button>
            )}
          </div>
          <div className="usage-stats">
            <div className="usage-stat"><span className="usage-num">{usage.month.calls.toLocaleString()}</span><span className="usage-lbl">calls this month</span></div>
            <div className="usage-stat"><span className="usage-num">{usage.month.total.toLocaleString()}</span><span className="usage-lbl">tokens this month</span></div>
            <div className="usage-stat"><span className="usage-num">{usage.today.calls.toLocaleString()}</span><span className="usage-lbl">calls today</span></div>
            <div className="usage-stat"><span className="usage-num">{usage.today.total.toLocaleString()}</span><span className="usage-lbl">tokens today</span></div>
          </div>
          {Object.keys(usage.month.byProvider || {}).length > 0 && (
            <div className="usage-providers">
              {Object.entries(usage.month.byProvider).sort((a, b) => (b[1].total || 0) - (a[1].total || 0)).map(([prov, v]) => (
                <div className="usage-prov-row" key={prov}>
                  <span className="usage-prov-name">{prov}</span>
                  <span className="usage-prov-bar"><span className="usage-prov-fill" style={{ width: `${Math.round(((v.total || 0) / usageProviderMax) * 100)}%` }} /></span>
                  <span className="usage-prov-val">{(v.total || 0).toLocaleString()} tok · {v.calls} calls</span>
                </div>
              ))}
            </div>
          )}
          <div className="usage-foot">Best-effort under-count across all AI calls (validators, post-functions, and design-time tools). Not a billing ledger.</div>
        </div>
      )}

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
                  onChange={handleSelectProvider}
                  // Mark the active provider right in the dropdown so it's always clear
                  // which one runs AI, even while browsing another's config.
                  options={PROVIDER_OPTIONS.map((o) => o.value === activeProvider ? { ...o, label: `${o.label}  •  Active` } : o)}
                  disabled={savingProvider}
                />
              </div>
              {provider !== activeProvider && (
                <button
                  className={"btn-small btn-edit" + (savingProvider ? " is-busy" : "")}
                  onClick={handleSetActive}
                  // LM Studio needs a baseUrl before it can be activated — disable until set.
                  disabled={savingProvider || (provider === "lmstudio" && !endpointInput.trim())}
                  title={provider === "lmstudio" && !endpointInput.trim()
                    ? "Enter your Tailscale Funnel URL below first"
                    : `Make ${providerLabelFor(provider)} the provider used for AI`}
                >
                  Set as active
                </button>
              )}
            </div>
            {/* Always show which provider is active (and, when browsing, which you're viewing). */}
            <p style={{ margin: "6px 0 0 0", fontSize: "11px", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
              <span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "50%", background: "var(--success-color)" }} />
              Active: <strong style={{ color: "var(--text-color)" }}>{providerLabelFor(activeProvider)}</strong>
              {provider !== activeProvider && (
                <span style={{ color: "var(--text-muted)" }}>· Viewing <strong style={{ color: "var(--text-color)" }}>{providerLabelFor(provider)}</strong> (not active — its config is shown below; “Set as active” to use it)</span>
              )}
            </p>
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
                <button className={"btn-small btn-edit" + (savingProvider ? " is-busy" : "")} onClick={handleSaveEndpoint} disabled={savingProvider || !endpointInput.trim() || endpointUnchanged}>
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
                <button className={"btn-small btn-edit" + (savingProvider ? " is-busy" : "")} onClick={handleSaveEndpoint} disabled={savingProvider || !endpointInput.trim() || endpointUnchanged}>
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
                  color: pingResult.busy ? "#d97706" : pingResult.authOk ? "var(--success-color)" : "var(--error-color)",
                }}>
                  {pingResult.busy ? "⚠ " : pingResult.authOk ? "✓ " : "⚠ "}{pingResult.message}
                </p>
              )}
            </div>
          )}

          {/* AWS Bedrock region — shown whenever Bedrock is selected so the region can be
              picked BEFORE switching (the backend needs it to build the Converse host). */}
          {isBedrock && (
            <div className="anim-rise" style={{ marginBottom: "16px" }}>
              <label style={{ display: "flex", alignItems: "center", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", marginBottom: "6px" }}>
                AWS Region
                <Tooltip text={
                  "AWS Bedrock endpoints are region-specific, and model availability varies by region.\n\n" +
                  "1. Pick the region where your Bedrock API key and model access are set up.\n" +
                  "2. In that region's AWS console → Bedrock → Model access, request access to the models you want.\n\n" +
                  "Note: in EU regions (e.g. eu-west-2 London), Anthropic Claude models are invoked via 'eu.' cross-region inference-profile ids; US regions use 'us.'. The model picker below lists the ids your account can use."
                } />
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div style={{ maxWidth: "280px", flex: "0 0 280px" }}>
                  <CustomSelect
                    value={bedrockRegion}
                    onChange={setBedrockRegion}
                    options={BEDROCK_REGIONS}
                    searchable
                    searchPlaceholder="Search regions..."
                    disabled={savingProvider}
                  />
                </div>
                {/* Save the region for the viewed Bedrock config (does not activate it). */}
                <button className={"btn-small btn-edit" + (savingProvider ? " is-busy" : "")} onClick={handleSaveBedrockRegion} disabled={savingProvider || bedrockRegionUnchanged} title={bedrockRegionUnchanged ? "Region already saved" : `Save region ${bedrockRegion}`}>
                  Save Region
                </button>
              </div>
              <p style={{ margin: "4px 0 0 0", fontSize: "11px", color: "var(--text-muted)" }}>
                Authenticated with a Bedrock API key (bearer token) — no AWS access-key signing. Endpoint: <code style={{ fontSize: "11px" }}>bedrock-runtime.{bedrockRegion}.amazonaws.com</code>
              </p>
            </div>
          )}

          {/* Key/Model section — shown for whichever provider is being VIEWED, so the admin can
              inspect/edit any provider's config without activating it. Keyed on the provider so
              swapping replays the rise-in. */}
          <div className="anim-rise" key={provider}>

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
              } else if (pingResult.busy) {
                lmStatusColor = "#d97706";
                lmStatusTitle = `Reachable — ${pingResult.modelCount || 0} model(s), but busy`;
                lmStatusBody = "The server is saturated right now, so the inference check timed out. This is not a connection problem — it'll pass once the queue clears.";
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
                : (isByok ? `Using your ${providerLabel} key` : "No key configured");
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
                        ? `Connected to ${providerLabel}. You can select from available models. Remove the key to clear it.`
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

          {/* Bedrock-only: Anthropic use-case acknowledgment. Amazon Bedrock requires a
              one-per-AWS-account console form before Anthropic models can be invoked; this
              checkbox is purely a UX gate that reveals the model picker. */}
          {isBedrock && isByok && (
            <div className="anim-rise" style={{ marginBottom: "16px", padding: "10px 12px", background: "var(--card-bg)", border: "2px solid var(--primary-color)", boxShadow: "0 4px 12px -4px rgba(37, 99, 235, 0.35)", borderRadius: "6px", fontSize: "12px", color: "var(--text-secondary)" }}>
              <strong style={{ color: "var(--text-color)" }}>Anthropic models need a one-time account setup.</strong> Amazon Bedrock
              requires first-time customers to submit use-case details before Anthropic (Claude) models can be invoked — once per
              AWS account. In the AWS console, open <strong>Bedrock → Model catalog</strong> and click <strong>“Submit use case
              details”</strong>, then complete the form. Other families (Amazon Nova, Llama, Mistral) don't require this.
              <label style={{ display: "flex", alignItems: "flex-start", gap: "8px", marginTop: "10px", cursor: "pointer" }}>
                <input type="checkbox" checked={bedrockAck} disabled={savingAck} onChange={(e) => handleSaveBedrockAck(e.target.checked)} style={{ marginTop: "2px" }} />
                <span><strong style={{ color: "var(--text-color)" }}>I've submitted Anthropic use-case details in the AWS console</strong> (or I only use non-Anthropic models). Acknowledgment only — the model list below works either way.</span>
              </label>
            </div>
          )}

          {/* Model Selection — only when BYOK. For Bedrock the picker shows as soon as the
              key is set; the Anthropic acknowledgment above is an awareness formality, NOT a
              gate (model listing works regardless — listing != invoking). */}
          {isByok && (
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)", marginBottom: "6px" }}>
                Model
              </label>
              {models.length === 0 ? (
                <p style={{ margin: 0, fontSize: "12px", color: "var(--text-muted)" }}>
                  {isLmStudio
                    ? "No models found. Make sure LM Studio has at least one LLM downloaded, then click Test above to retry."
                    : isBedrock
                      ? (listUnavailable
                          ? "Couldn't list models from AWS — your API key's IAM policy may not allow listing, or no models are enabled in this region. Enter a model or inference-profile id manually below."
                          : "No models found in this region. Enter a model or inference-profile id manually below.")
                      : "No chat models found. Check your API key and try again."}
                </p>
              ) : (
                <>
                {isLmStudio && modelDetails.some((m) => m.state === "not-loaded") && (
                  <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--text-secondary)", marginBottom: "8px", cursor: "pointer", userSelect: "none" }}>
                    <input type="checkbox" checked={lmLoadedOnly} onChange={(e) => setLmLoadedOnly(e.target.checked)} />
                    Show loaded models only
                  </label>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div style={{ flex: 1 }}>
                    <CustomSelect
                      value={selectedModel}
                      onChange={setSelectedModel}
                      placeholder="Select a model..."
                      searchable
                      searchPlaceholder="Search models..."
                      options={isLmStudio && modelDetails.length > 0
                        ? (lmLoadedOnly ? modelDetails.filter((m) => m.state === "loaded") : modelDetails).map((m) => {
                            // Subtle secondary text (quant / context window).
                            const meta = [];
                            if (m.quantization) meta.push(m.quantization);
                            if (m.max_context_length) meta.push(`${Math.round(m.max_context_length / 1024)}K ctx`);
                            // Solid saturated badges (mandate: no faded tints). loaded=green,
                            // cold=slate, capabilities=teal, device=slate.
                            const badges = [];
                            if (m.state === "loaded") badges.push({ text: "loaded", tone: "loaded" });
                            else if (m.state === "not-loaded") badges.push({ text: "cold", tone: "cold" });
                            if (m.vision) badges.push({ text: "vision", tone: "info" });
                            if (m.toolUse) badges.push({ text: "tools", tone: "info" });
                            if (m.device) badges.push({ text: m.device, tone: "device" });
                            return { value: m.id, label: m.id, meta: meta.join(" · ") || undefined, badges, group: m.device || "This machine" };
                          })
                        : models.map((m) => ({ value: m, label: m }))}
                      groups={isLmStudio && lmDevices.length > 0
                        ? [...lmDevices, "This machine"].filter((d, i, a) => a.indexOf(d) === i)
                            .map((d) => ({ label: d, filter: (o) => (o.group || "This machine") === d }))
                        : undefined}
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
                </>
              )}
              {/* Bedrock free-text entry — always available so the admin can paste any
                  model / inference-profile id the live list didn't surface. */}
              {isBedrock && (
                <div style={{ marginTop: models.length === 0 ? "8px" : "10px" }}>
                  <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "4px" }}>
                    Or enter a model / inference-profile id
                  </label>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <input
                      type="text"
                      value={customModelInput}
                      onChange={(e) => setCustomModelInput(e.target.value)}
                      placeholder="e.g. eu.anthropic.claude-sonnet-4-6"
                      style={{ flex: 1, padding: "8px 12px", border: "1px solid var(--border-color)", borderRadius: "4px", background: "var(--input-bg)", color: "var(--text-color)", fontSize: "13px", fontFamily: "SFMono-Regular, Consolas, monospace" }}
                      onKeyDown={(e) => e.key === "Enter" && handleSaveCustomModel()}
                    />
                    <button className={"btn-small btn-edit" + (savingModel ? " is-busy" : "")} onClick={handleSaveCustomModel} disabled={savingModel || !customModelInput.trim() || customModelInput.trim() === currentModel}>
                      Use this model
                    </button>
                  </div>
                  <p style={{ margin: "4px 0 0 0", fontSize: "11px", color: "var(--text-muted)" }}>
                    Many Bedrock models require a cross-region inference-profile id (<code style={{ fontSize: "11px" }}>eu.</code> / <code style={{ fontSize: "11px" }}>us.</code> prefix) rather than the bare model id.
                  </p>
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
              {isLmStudio && (
                <div style={{ marginTop: "14px", paddingTop: "14px", borderTop: "1px solid var(--border-color)" }}>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--text-color)", marginBottom: "4px" }}>
                    Max concurrent LM Studio jobs
                  </label>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <input
                      type="number"
                      min="0"
                      value={lmConcurrencyInput}
                      onChange={(e) => setLmConcurrencyInput(e.target.value)}
                      placeholder="0 = uncapped"
                      style={{ width: "120px", padding: "8px 12px", border: "1px solid var(--border-color)", borderRadius: "4px", background: "var(--input-bg)", color: "var(--text-color)", fontSize: "13px" }}
                      onKeyDown={(e) => e.key === "Enter" && handleSaveConcurrency()}
                    />
                    <button
                      className={"btn-small btn-edit" + (savingConcurrency ? " is-busy" : "")}
                      onClick={handleSaveConcurrency}
                      disabled={savingConcurrency || String(lmConcurrency) === (lmConcurrencyInput.trim() === "" ? "0" : lmConcurrencyInput.trim())}
                    >
                      Save cap
                    </button>
                  </div>
                  <p style={{ margin: "4px 0 0 0", fontSize: "11px", color: "var(--text-muted)" }}>
                    Forge runs queued jobs in parallel by default. This caps how many LM Studio jobs run at once (app-wide) — set it to roughly your device count × LM Studio's per-model concurrency to spread work without thrashing a machine. <strong>0 = uncapped.</strong>
                  </p>
                </div>
              )}
              {isLmStudio && (
                <div style={{ marginTop: "14px", paddingTop: "14px", borderTop: "1px solid var(--border-color)" }}>
                  <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: savingPool ? "default" : "pointer" }}>
                    <input
                      type="checkbox"
                      checked={lmPool}
                      disabled={savingPool}
                      onChange={handleTogglePool}
                      style={{ marginTop: "2px", width: "16px", height: "16px", accentColor: "var(--primary-color)", cursor: "inherit" }}
                    />
                    <span>
                      <span style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--text-color)" }}>
                        Run on all loaded models (not just the primary)
                        {savingPool && <span className="spin-ring spin-ring-sm" style={{ marginLeft: "8px", verticalAlign: "middle" }} />}
                      </span>
                      <span style={{ display: "block", fontSize: "11px", color: "var(--text-muted)", marginTop: "3px" }}>
                        <strong style={{ color: "var(--text-color)" }}>On</strong> (needs 2+ models loaded): every AI call — validators, conditions, <em>and</em> post-functions — is spread across all loaded models (round-robin, capability-aware: agentic calls only go to tool-trained models, vision only to VLMs), so all your devices work in parallel instead of one being hammered while the others idle. <strong style={{ color: "var(--text-color)" }}>Off</strong>: everything uses only the primary model selected above. No-op when a single model is loaded.
                      </span>
                    </span>
                  </label>
                  {lmPool && lmWeightModels.length >= 2 && (
                    <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid var(--border-color)" }}>
                      <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-color)", marginBottom: "4px" }}>
                        Device dispatch weight
                        {savingWeights && <span className="spin-ring spin-ring-sm" style={{ marginLeft: "8px", verticalAlign: "middle" }} />}
                      </div>
                      <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "8px" }}>
                        Mark a slower device to receive proportionally less work — a <strong style={{ color: "var(--text-color)" }}>Slow</strong> model gets ~1 job for every 3 a normal one gets, <strong style={{ color: "var(--text-color)" }}>Very slow</strong> ~1 in 6. Stops a slow box backing up while a fast one idles.
                      </div>
                      {lmWeightModels.map((m, i) => {
                        // One row per LOADED INSTANCE. Backend returns {wkey,id,quant,ctx};
                        // tolerate a bare-string shape from an older backend during deploy.
                        const wkey = typeof m === "string" ? m : (m.wkey || m.id);
                        const id = typeof m === "string" ? m : m.id;
                        const metaParts = [];
                        if (m && m.quant) metaParts.push(m.quant);
                        if (m && m.ctx) metaParts.push(`${Math.round(m.ctx / 1024)}K ctx`);
                        const meta = metaParts.join(" · ");
                        return (
                          <div key={wkey || id || i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", padding: "5px 0" }}>
                            <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "1px" }}>
                              <span title={id} style={{ fontSize: "12px", color: "var(--text-color)", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{id}</span>
                              {meta && <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{meta}</span>}
                            </span>
                            <div style={{ width: "164px", flexShrink: 0 }}>
                              <CustomSelect
                                value={String(lmWeights[wkey] || 1)}
                                disabled={savingWeights}
                                onChange={(v) => handleSetWeight(wkey, Number(v))}
                                options={[
                                  { value: "1", label: "Normal" },
                                  { value: "3", label: "Slow (⅓ work)" },
                                  { value: "6", label: "Very slow (⅙ work)" },
                                ]}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          </div>
        </div>
      </div>

      {/* MCP Integrations.
          CogniRunner is the MIDDLE LAYER: on every hosted provider (OpenAI / Azure /
          OpenRouter / Anthropic / Forge LLM) the app itself dials the MCP's URL and runs
          the tool calls — the AI provider never sees the URL or touches the MCP. Each
          MCP is configured like an mcp.json entry (a URL + optional key). LM Studio is
          the local-only alternative (the MCP runs on the user's machine via stdio). All
          three MCPs (context7 / web-search / doc-reader) work this way on every provider. */}
      {provider === activeProvider && (
        <div className="card" style={{ marginTop: "16px" }}>
          <div style={{ padding: "16px" }}>
            {/* Compact header: a one-line summary (detail in tooltips) + a toggle
                that reveals the full connection guide. All the original copy is
                preserved below — just tucked behind "How it works" so the section
                can breathe (owner: "no room to breathe"). */}
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", marginBottom: "12px" }}>
              <div>
                <h3 style={{ margin: "0 0 4px 0", fontSize: "14px", fontWeight: 600, color: "var(--text-color)" }}>
                  MCP Integrations
                </h3>
                <p style={{ margin: 0, fontSize: "12px", color: "var(--text-secondary)" }}>
                  {isLmStudio
                    ? <>Extra tools the model can call via your LM Studio&apos;s <code style={{ fontSize: "11px" }}>mcp.json</code> — local to your machine; enable each below and follow its setup.<Tooltip text="JQL agentic search is unaffected — it runs on a separate code path from these MCP tools." /></>
                    : <><strong>CogniRunner is the middle layer</strong> — it dials each MCP&apos;s URL and runs the tool calls; your AI provider never sees the URL.<Tooltip text="Works the same on OpenAI / Azure / OpenRouter / Anthropic / AWS Bedrock / Forge LLM. All three MCPs — context7, web-search, doc-reader — are supported on every provider." /></>
                  }
                </p>
              </div>
              <button
                type="button"
                className="btn-small btn-edit"
                onClick={() => setShowMcpHelp((v) => !v)}
                aria-expanded={showMcpHelp}
                style={{ flexShrink: 0, whiteSpace: "nowrap" }}
              >
                {showMcpHelp ? "Hide guide" : "How it works"}
              </button>
            </div>

            {/* Full connection guide — collapsed by default. Nothing is removed;
                this is the de-densified home for the three connection modes, the
                egress restriction, and (for LM Studio) the per-MCP routing note. */}
            {showMcpHelp && (
            <div className="anim-rise">
            {/* LM-Studio-only: per-MCP local routing now lives on each card below (the
                "Run locally via LM Studio" toggle), replacing the old single global flag. */}
            {isLmStudio && (
              <div style={{ margin: "0 0 12px", padding: "10px 12px", background: "var(--card-bg)", border: "2px solid #0d9488", borderRadius: "6px", fontSize: "12px", color: "var(--text-secondary)" }}>
                <strong style={{ color: "var(--text-color)" }}>LM Studio: choose per MCP where it runs.</strong> Each card below has a <strong>“Run locally via LM Studio (mcp.json)”</strong> toggle — turn it on to load that MCP from LM Studio on your machine, or leave it off to use the hosted bridge (its Service URL / Bearer fields). Only LM Studio supports local MCPs; every other provider always uses the hosted bridge. <strong>Keep all enabled MCPs on the same side:</strong> LM Studio can’t combine local and hosted tools in one request, so if you mix them CogniRunner routes them ALL through the hosted bridge (a “local” MCP would then also need its hosted Service URL / Bearer below).
              </div>
            )}

            {/* How to connect — the three modes, made explicit. Solid neutral
                surface (not a faded tint) per the owner UI mandate. */}
            <div style={{ padding: "10px 12px", marginBottom: "12px", background: "var(--code-bg)", border: "1px solid var(--border-color)", borderRadius: "6px", fontSize: "11px", color: "var(--text-secondary)" }}>
              <strong style={{ color: "var(--text-color)" }}>Three ways to connect an MCP:</strong>
              <ul style={{ margin: "6px 0 0", paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "4px" }}>
                <li><strong>LeanZero&apos;s hosted demo</strong> — point <code style={{ fontSize: "11px" }}>web-search</code> / <code style={{ fontSize: "11px" }}>doc-processor</code> at our Mac Studio instance; grab a free demo key at <ExtLink href="https://leanzero.atlascrafted.com" style={{ color: "var(--text-color)", fontWeight: 600 }}>leanzero.atlascrafted.com</ExtLink> (links in the cards below). Rate-limited, for evaluation. Works on every provider — CogniRunner connects to it for you.</li>
                <li><strong>Your own self-hosted server</strong> — clone the open-source repo and expose it via <strong>Tailscale Funnel</strong> (<em>required</em> — see the note below), then paste its <code style={{ fontSize: "11px" }}>*.ts.net</code> Service URL + Bearer in the card below. CogniRunner is the client on every hosted provider.</li>
                <li><strong>LM Studio (local stdio)</strong> — run the server locally and point LM Studio&apos;s <code style={{ fontSize: "11px" }}>mcp.json</code> at it. The MCP runs on your machine — the secure, local-only option (LM Studio provider).</li>
              </ul>
              <div style={{ marginTop: "8px", padding: "8px 10px", background: "var(--card-bg)", border: "2px solid #d97706", boxShadow: "0 4px 12px -4px rgba(217, 119, 6, 0.35)", borderRadius: "6px", color: "var(--text-secondary)" }}>
                <strong style={{ color: "var(--text-color)" }}>⚠ The addresses CogniRunner may reach are fixed by the installed app.</strong> It can only connect to an MCP on a <code style={{ fontSize: "11px" }}>*.ts.net</code> Tailscale&nbsp;Funnel URL on <strong>port 443</strong> (Forge egress reaches only the default HTTPS port — <strong>8443 / 10000 are blocked</strong>, so serve your Funnel on 443) or to context7&apos;s <code style={{ fontSize: "11px" }}>mcp.context7.com</code>. That allow-list ships inside the app and <strong>can&apos;t be changed without re-deploying CogniRunner itself</strong> — which you can&apos;t do as an installer. So to self-host web-search / doc-processor you <strong>must run them behind your own Tailscale Funnel</strong> (any tailnet works — it&apos;s a wildcard); an arbitrary URL like <code style={{ fontSize: "11px" }}>https://mycompany.com/mcp</code> will be blocked. Don&apos;t want to run a Funnel? Use LeanZero&apos;s hosted demo above.</div>
              <div style={{ marginTop: "6px" }}>Service keys (web-search&apos;s Serper key) live on the MCP server — LeanZero&apos;s hosted demo manages them for you, so you only need the URL + Bearer. Self-hosters can also pass their own per-tenant key in the card below.</div>
            </div>
            </div>
            )}

            {/* context7 — hosted on every provider via the bridge; LM Studio can run it locally */}
            <McpCard
              mcpKey="context7"
              title="context7"
              subtitle="Up-to-date library / framework / SDK docs"
              tools={["resolve-library-id", "query-docs"]}
              enabled={mcpEnabled.context7}
              saving={mcpSavingKey === "context7"}
              isLmStudio={isLmStudio}
              local={!!mcpEnabled.localContext7}
              localSaving={mcpSavingKey === "localContext7"}
              onToggleLocal={() => handleMcpToggle("localContext7")}
              hostedGreyed={isLmStudio && mcpEnabled.localContext7}
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
                      Use the <strong>official hosted endpoint</strong> <code style={{ fontSize: "11px" }}>https://mcp.context7.com/mcp</code> (works without a key — a key only raises rate limits; grab one at <ExtLink href="https://context7.com/dashboard" style={{ color: "var(--success-color)", fontWeight: 600 }}>context7.com/dashboard</ExtLink>), or a self-host behind Tailscale Funnel (<code style={{ fontSize: "11px" }}>*.ts.net</code> on port 443). Those are the only context7 addresses CogniRunner may reach. It connects for you on every provider.
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
                (OpenAI / Azure / OpenRouter / Anthropic / AWS Bedrock / Forge LLM) CogniRunner is
                the MCP client and proxies the tool calls; LM Studio loads it from
                local/remote mcp.json. */}
            <McpCard
              mcpKey="webSearch"
              title="web-search"
              subtitle="Multi-engine web search & URL extraction (default Bing, no key required)"
              tools={["get-web-search-summaries", "full-web-search", "get-single-web-page-content", "get-pdf-content"]}
              enabled={mcpEnabled.webSearch}
              saving={mcpSavingKey === "webSearch"}
              isLmStudio={isLmStudio}
              local={!!mcpEnabled.localWebSearch}
              localSaving={mcpSavingKey === "localWebSearch"}
              onToggleLocal={() => handleMcpToggle("localWebSearch")}
              hostedGreyed={isLmStudio && mcpEnabled.localWebSearch}
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
                      Point this at a web-search MCP. Use <strong>your own self-host</strong> (clone <code style={{ fontSize: "11px" }}>mcp-web-search</code> and expose it via Tailscale Funnel — the URL <strong>must</strong> be <code style={{ fontSize: "11px" }}>*.ts.net</code> on <strong>port 443</strong>; Forge egress blocks 8443/10000, see the note above) or <strong>LeanZero&apos;s hosted demo</strong> — <ExtLink href="https://leanzero.atlascrafted.com/portfolio/mcp-web-search#get-key" style={{ color: "var(--success-color)", fontWeight: 600 }}>get a free demo key →</ExtLink>. Independent from doc-processor (separate URL + Bearer). The MCP is keyless, so also paste a Serper key (free tier at <ExtLink href="https://serper.dev" style={{ color: "var(--success-color)", fontWeight: 600 }}>serper.dev</ExtLink>) — it powers every search.
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
                (OpenAI / Azure / OpenRouter / Anthropic / AWS Bedrock / Forge LLM) CogniRunner is
                the MCP client and proxies the tool calls; LM Studio loads it from
                local/remote mcp.json. */}
            <McpCard
              mcpKey="docReader"
              title="doc-reader"
              subtitle="Read PDF / DOCX / Excel / PowerPoint, and (with doc-writer) create / edit DOCX, PDF, Excel, Markdown, PPTX, plus fact-check"
              tools={["read-doc", "create-doc", "create-markdown", "create-excel", "create-pdf", "create-pptx", "fact-check", "list-templates"]}
              enabled={mcpEnabled.docReader}
              saving={mcpSavingKey === "docReader"}
              isLmStudio={isLmStudio}
              local={!!mcpEnabled.localDocReader}
              localSaving={mcpSavingKey === "localDocReader"}
              onToggleLocal={() => handleMcpToggle("localDocReader")}
              hostedGreyed={isLmStudio && mcpEnabled.localDocReader}
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
                      Point this at a doc-processor MCP. Use <strong>your own self-host</strong> (clone <code style={{ fontSize: "11px" }}>leanzero-mcp-doc-processor</code> and expose it via Tailscale Funnel — the URL <strong>must</strong> be <code style={{ fontSize: "11px" }}>*.ts.net</code> on <strong>port 443</strong>; Forge egress blocks 8443/10000, see the note above) or <strong>LeanZero&apos;s hosted demo</strong> on our Mac Studio — <ExtLink href="https://leanzero.atlascrafted.com/portfolio/mcp-doc-processor#get-key" style={{ color: "var(--success-color)", fontWeight: 600 }}>get a free demo key →</ExtLink>. Paste the Service URL + Bearer below. LM Studio can alternatively point its <code style={{ fontSize: "11px" }}>mcp.json</code> at the same URL (see below).
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
function McpCard({ mcpKey, title, subtitle, tools, enabled, saving, expanded, ping, onToggle, onExpand, onPing, setupBlock, hostedGreyed, isLmStudio, local, localSaving, onToggleLocal }) {
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
          {/* Live, vetted tool list. Once an MCP is enabled we fetch the tools the
              server ACTUALLY exposes (∩ what CogniRunner uses) as { name, description }
              and show them as solid chips. HOVER a chip for the server's own description
              — the SAME text the model receives. Before fetch / on LM Studio: curated set. */}
          {(() => {
            // live = [{name, description}]; static fallback = ["name", ...] → normalize.
            const live = Array.isArray(ping?.tools) ? ping.tools : null;
            const shown = (live && live.length ? live : tools).map((t) => (typeof t === "string" ? { name: t } : t));
            return (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", alignItems: "center", marginTop: "1px" }}>
                <span style={{ fontSize: "10px", color: "var(--text-muted)", marginRight: "1px" }}>
                  {ping?.loading ? "Loading tools…" : live ? "Tools in use:" : "Tools available:"}
                </span>
                {shown.map((t) => {
                  // Prefer the live server description; fall back to the built-in static one so
                  // EVERY tool always has a hover tooltip explaining what it does.
                  const desc = t.description || TOOL_DESCRIPTIONS[t.name];
                  const chip = (
                    <span
                      className={live ? "mcp-tool-chip" : undefined}
                      style={live
                        ? { cursor: desc ? "help" : "default" }
                        : { fontSize: "10px", fontWeight: 600, padding: "2px 8px", borderRadius: "10px", background: "var(--input-bg)", color: "var(--text-secondary)", border: "1px solid var(--border-color)", cursor: desc ? "help" : "default" }}
                    >{t.name}</span>
                  );
                  return desc
                    ? <Tooltip key={t.name} text={desc}>{chip}</Tooltip>
                    : <span key={t.name}>{chip}</span>;
                })}
              </div>
            );
          })()}
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

      {/* LM-Studio-only per-MCP routing: local (mcp.json) vs the hosted bridge. */}
      {isLmStudio && enabled && (
        <label style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "8px", padding: "8px 10px", borderRadius: "6px", border: `2px solid ${local ? "#0d9488" : "var(--border-color)"}`, background: "var(--card-bg)", cursor: "pointer", fontSize: "11px", color: "var(--text-secondary)" }}>
          <input type="checkbox" checked={!!local} disabled={localSaving} onChange={onToggleLocal} />
          <span>
            <strong style={{ color: local ? "#0d9488" : "var(--text-color)" }}>Run locally via LM Studio (mcp.json)</strong>
            {local
              ? " — served by LM Studio on your machine; the hosted Service URL / Bearer below are unused."
              : " — off: uses the hosted bridge (configure the Service URL / Bearer below)."}
          </span>
          {localSaving && <span style={{ color: "var(--text-muted)" }}>saving…</span>}
        </label>
      )}

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
          {hostedGreyed && (
            <p style={{ margin: "0 0 8px", fontSize: "11px", color: "#0d9488", fontWeight: 600 }}>
              This {title} runs locally via LM Studio (mcp.json) — the hosted URL / Bearer below are not used. Turn off &quot;Run locally&quot; above to use the hosted bridge instead.
            </p>
          )}
          <div style={{ opacity: hostedGreyed ? 0.4 : 1, pointerEvents: hostedGreyed ? "none" : "auto" }} aria-disabled={hostedGreyed}>
            {setupBlock}
          </div>
        </div>
      )}
    </div>
  );
}
