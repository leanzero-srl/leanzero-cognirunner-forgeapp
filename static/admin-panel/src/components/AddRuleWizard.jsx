/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import React, { useState, useEffect } from "react";
import CustomSelect from "./CustomSelect";
// Shared components — these are the SAME ones used by config-ui (the workflow-menu
// flow). Keeping them in one place ensures rule-creation options + logic are
// identical across both entry points.
import DocRepository from "./DocRepository";
import ReviewPanel from "./ReviewPanel";
import SemanticConfig from "./SemanticConfig";
import GenerateDocConfig from "./GenerateDocConfig";
import FunctionBuilder from "./FunctionBuilder";

const RULE_TYPE_OPTIONS = [
  { value: "validator", label: "Validator", desc: "Block transition if validation fails" },
  { value: "condition", label: "Condition", desc: "Hide transition if condition not met" },
  { value: "postfunction-semantic", label: "Semantic Post Function", desc: "AI modifies a field after transition" },
  { value: "postfunction-generate-doc", label: "Generate Document", desc: "AI writes a doc & attaches it to the issue" },
  { value: "postfunction-static", label: "Static Post Function", desc: "Run custom code after transition" },
];

export default function AddRuleWizard({ invoke, onClose, onCreated }) {
  // Wizard steps: project -> workflow -> transition -> type -> config
  const [step, setStep] = useState(1);

  // Step 1: Project
  const [projects, setProjects] = useState([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [selectedProject, setSelectedProject] = useState(null);

  // Step 2: Workflow
  const [workflows, setWorkflows] = useState([]);
  const [loadingWorkflows, setLoadingWorkflows] = useState(false);
  const [selectedWorkflow, setSelectedWorkflow] = useState(null);

  // Step 3: Transition
  const [transitions, setTransitions] = useState([]);
  const [loadingTransitions, setLoadingTransitions] = useState(false);
  const [selectedTransition, setSelectedTransition] = useState(null);

  // Step 4: Rule type
  const [ruleType, setRuleType] = useState(null);

  // Step 5: Config
  const [fields, setFields] = useState([]);
  const [loadingFields, setLoadingFields] = useState(false);
  const [fieldId, setFieldId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [conditionPrompt, setConditionPrompt] = useState("");
  const [actionPrompt, setActionPrompt] = useState("");
  const [actionFieldId, setActionFieldId] = useState("");
  const [crossCheckClaims, setCrossCheckClaims] = useState(false);
  const [docFormat, setDocFormat] = useState("pdf");
  const [contentPrompt, setContentPrompt] = useState("");
  const [docTitlePrompt, setDocTitlePrompt] = useState("");
  const [attachComment, setAttachComment] = useState(false);
  const [enableTools, setEnableTools] = useState(null); // null = auto, true = on, false = off
  // Doc library: selected reference docs that get fed into the AI prompt.
  // Used for validators/conditions and semantic post-functions.
  // (Static PF docs are stored per-step inside `functions[].selectedDocIds`.)
  const [selectedDocIds, setSelectedDocIds] = useState([]);
  // Static PF state — must match the shape FunctionBuilder/FunctionBlock expects
  // (operationPrompt, conditionPrompt, endpoint, method, etc.) so the shared
  // component can drive the form identically to config-ui.
  const [functions, setFunctions] = useState([{
    id: `func_${Date.now()}_initial`,
    name: "",
    conditionPrompt: "",
    operationType: "work_item_query",
    operationPrompt: "",
    endpoint: "",
    method: "GET",
    variableName: "result1",
    code: "",
    includeBackoff: false,
  }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [testIssue, setTestIssue] = useState("");
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [created, setCreated] = useState(false);
  const [submitted, setSubmitted] = useState(false); // for field validation

  // Load projects on mount
  useEffect(() => {
    (async () => {
      try {
        const result = await invoke("listProjects");
        if (result.success) setProjects(result.projects || []);
        else setError(result.error);
      } catch (e) { setError("Failed to load projects"); }
      setLoadingProjects(false);
    })();
  }, []);

  // Load workflows when project selected
  const handleProjectSelect = async (project) => {
    setSelectedProject(project);
    setSelectedWorkflow(null);
    setSelectedTransition(null);
    setWorkflows([]);
    setTransitions([]);
    setLoadingWorkflows(true);
    setError(null);
    try {
      const result = await invoke("getProjectWorkflows", { projectKey: project.key, projectId: project.id });
      if (result.success) setWorkflows(result.workflows || []);
      else setError(result.error);
    } catch (e) { setError("Failed to load workflows"); }
    setLoadingWorkflows(false);
    setStep(2);
  };

  // Load transitions when workflow selected
  const handleWorkflowSelect = async (workflow) => {
    setSelectedWorkflow(workflow);
    setSelectedTransition(null);
    setTransitions([]);
    setLoadingTransitions(true);
    setError(null);
    try {
      const result = await invoke("getWorkflowTransitions", { workflowName: workflow.name });
      if (result.success) setTransitions(result.transitions || []);
      else setError(result.error);
    } catch (e) { setError("Failed to load transitions"); }
    setLoadingTransitions(false);
    setStep(3);
  };

  // Select transition
  const handleTransitionSelect = (transition) => {
    setSelectedTransition(transition);
    setStep(4);
  };

  // Select rule type and load fields
  const handleTypeSelect = async (type) => {
    setRuleType(type);
    setStep(5);
    // Only fetch fields if not already loaded
    if (fields.length === 0) {
      setLoadingFields(true);
      try {
        const result = await invoke("getFields");
        if (result.success) {
          setFields(result.fields || []);
        } else {
          console.error("getFields failed:", result.error);
        }
      } catch (e) {
        console.error("getFields error:", e);
      }
      setLoadingFields(false);
    }
  };

  // Save the rule
  const handleSave = async () => {
    setSubmitted(true);
    // Validate required fields
    if (ruleType === "validator" && (!fieldId || !prompt.trim())) return;
    if (ruleType === "condition" && (!fieldId || !prompt.trim())) return;
    if (ruleType === "postfunction-semantic" && !conditionPrompt.trim()) return;
    if (ruleType === "postfunction-generate-doc" && !contentPrompt.trim()) return;
    if (ruleType === "postfunction-static" && !functions.some((f) => f.code)) return;

    setSaving(true);
    setError(null);

    const isPostFunction = ruleType.startsWith("postfunction");
    const ruleId = `${selectedWorkflow.name}::${selectedTransition.id}`;
    const workflowData = {
      workflowName: selectedWorkflow.name,
      workflowId: selectedWorkflow.id,
      transitionId: selectedTransition.id,
      transitionName: selectedTransition.name,
      transitionFromName: selectedTransition.fromName,
      transitionToName: selectedTransition.toName,
      projectKey: selectedProject.key,
    };

    try {
      // Step A: Register config in CogniRunner KVS
      let result;
      // CRITICAL: include `type` in the config payload that gets injected into the
      // workflow XML. Without it, the saved config has no signal of whether it was
      // semantic or static — config-ui falls back to detection heuristics and
      // executePostFunction has to infer from the Forge module key. Embedding type
      // here makes the saved config self-identifying and removes a class of bugs
      // (e.g. workflow editor labeling the rule wrong, runtime dispatch confusion).
      const configPayload = isPostFunction
        ? ruleType === "postfunction-static"
          ? { type: ruleType, fieldId: "static-code", prompt: functions[0]?.operationPrompt || "", functions, workflow: workflowData }
          : ruleType === "postfunction-generate-doc"
            ? { type: ruleType, fieldId: fieldId || "description", prompt: contentPrompt, contentPrompt, docFormat, docTitlePrompt, attachComment, selectedDocIds, workflow: workflowData }
            : { type: ruleType, fieldId: fieldId || "description", prompt: prompt || conditionPrompt, conditionPrompt, actionPrompt, actionFieldId, selectedDocIds, crossCheckClaims, workflow: workflowData }
        : { type: ruleType, fieldId: fieldId || "description", prompt, enableTools, selectedDocIds, workflow: workflowData };

      if (isPostFunction) {
        result = await invoke("registerPostFunction", {
          id: ruleId,
          type: ruleType,
          ...configPayload,
          functions: ruleType === "postfunction-static" ? functions : [],
          workflow: workflowData,
        });
      } else {
        result = await invoke("registerConfig", {
          id: ruleId,
          type: ruleType,
          ...configPayload,
          workflow: workflowData,
        });
      }

      if (!result.success) {
        setError(result.error || "Failed to save rule config");
        setSaving(false);
        return;
      }

      // Step B: Inject the rule into the actual Jira workflow
      const injectResult = await invoke("injectWorkflowRule", {
        workflowName: selectedWorkflow.name,
        transitionId: selectedTransition.id,
        ruleType,
        config: JSON.stringify(configPayload),
      });

      if (injectResult.success) {
        if (onCreated) onCreated();
        setCreated(true);
      } else {
        // Config was saved but injection failed — show warning, don't close
        setError(`Rule config saved, but could not inject into workflow: ${injectResult.error}. You can add it manually from the Jira workflow editor.`);
      }
    } catch (e) {
      setError("Failed to save: " + e.message);
    }
    setSaving(false);
  };

  const fieldOptions = fields.map((f) => ({ value: f.id, label: `${f.name} (${f.id})` }));

  const goToStep = (targetStep) => {
    if (targetStep >= step) return; // can only go back
    if (targetStep <= 0) return;
    setStep(targetStep);
    if (targetStep <= 1) { setSelectedProject(null); setSelectedWorkflow(null); setSelectedTransition(null); setRuleType(null); }
    if (targetStep <= 2) { setSelectedWorkflow(null); setSelectedTransition(null); setRuleType(null); }
    if (targetStep <= 3) { setSelectedTransition(null); setRuleType(null); }
    if (targetStep <= 4) { setRuleType(null); }
  };

  const stepLabel = (num, label) => (
    <span
      className={step > num ? "wiz-step-done" : step === num ? "wiz-step-active" : "wiz-step-future"}
      onClick={() => goToStep(num)}
    >
      {num}. {label}
    </span>
  );

  if (created) {
    return (
      <div className="card wizard">
        <div className="wiz-success">
          <div className="wiz-success-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--success-color)" strokeWidth="2">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>
          <div className="wiz-success-title">Rule Created</div>
          <div className="wiz-success-text">
            {RULE_TYPE_OPTIONS.find((o) => o.value === ruleType)?.label} has been added to{" "}
            <strong>{selectedTransition?.name}</strong> on {selectedWorkflow?.name}.
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button className="btn-small" onClick={onClose}>Done</button>
            <button className="btn-small btn-edit" onClick={() => {
              setCreated(false); setStep(1); setSubmitted(false);
              setSelectedProject(null); setSelectedWorkflow(null); setSelectedTransition(null); setRuleType(null);
              setFieldId(""); setPrompt(""); setConditionPrompt(""); setActionPrompt(""); setActionFieldId(""); setCrossCheckClaims(false);
              setDocFormat("pdf"); setContentPrompt(""); setDocTitlePrompt(""); setAttachComment(false);
              setSelectedDocIds([]);
              setTestResult(null); setTestIssue("");
              setFunctions([{
                id: `func_${Date.now()}_initial`,
                name: "",
                conditionPrompt: "",
                operationType: "work_item_query",
                operationPrompt: "",
                endpoint: "",
                method: "GET",
                variableName: "result1",
                code: "",
                includeBackoff: false,
              }]);
            }}>Add Another Rule</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card wizard">
      {/* Header */}
      <div className="wizard-header">
        <div className="wizard-header-left">
          <div className="wizard-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--primary-color)" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </div>
          <div>
            <h3 className="wizard-title">Add New Rule</h3>
            <p className="wizard-subtitle">
              {step <= 3 ? "Select where to add the rule" : step === 4 ? "Choose rule type" : "Configure the rule"}
            </p>
          </div>
        </div>
        <button className="btn-small" onClick={onClose}>Cancel</button>
      </div>

      <div className="wizard-body">
        {/* Breadcrumb */}
        <div className="wizard-breadcrumb">
          {stepLabel(1, "Project")}
          <span className="wiz-sep">/</span>
          {stepLabel(2, "Workflow")}
          <span className="wiz-sep">/</span>
          {stepLabel(3, "Transition")}
          <span className="wiz-sep">/</span>
          {stepLabel(4, "Type")}
          <span className="wiz-sep">/</span>
          {stepLabel(5, "Configure")}
        </div>

        {error && (
          <div className="alert alert-error" style={{ marginBottom: "12px" }}>
            <span>{error}</span>
            <button className="alert-dismiss" onClick={() => setError(null)}>&times;</button>
          </div>
        )}

        {/* Step 1: Project */}
        {step >= 1 && (
          <div style={{ marginBottom: step > 1 ? "8px" : "0" }}>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "6px" }}>
              Project
            </label>
            {step === 1 ? (
              loadingProjects ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "6px" }}>
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px", border: "1px solid var(--border-color)", borderRadius: "8px" }}>
                      <div className="sk sk-block" style={{ width: 24, height: 24, borderRadius: 6, flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div className="sk sk-text" style={{ width: "70%", height: 12, marginBottom: 4 }} />
                        <div className="sk sk-text" style={{ width: "30%", height: 10 }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "6px" }}>
                  {projects.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => handleProjectSelect(p)}
                      style={{
                        display: "flex", alignItems: "center", gap: "10px",
                        padding: "10px 14px", border: "1px solid var(--border-color)",
                        borderRadius: "8px", background: "var(--input-bg)", color: "var(--text-color)",
                        cursor: "pointer", transition: "all 0.15s ease", fontSize: "13px", textAlign: "left",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--primary-color)"; e.currentTarget.style.background = "var(--hover-bg)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border-color)"; e.currentTarget.style.background = "var(--input-bg)"; }}
                    >
                      {p.avatarUrl ? (
                        <img src={p.avatarUrl} alt="" style={{ width: 24, height: 24, borderRadius: 6 }} />
                      ) : (
                        <span style={{
                          width: 24, height: 24, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center",
                          background: "rgba(37,99,235,0.12)", color: "var(--primary-color)", fontSize: "10px", fontWeight: 700,
                        }}>{p.key.substring(0, 2)}</span>
                      )}
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <span style={{ fontWeight: 600, lineHeight: 1.2 }}>{p.name}</span>
                        <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>{p.key}</span>
                      </div>
                    </button>
                  ))}
                  {projects.length === 0 && <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>No projects found</span>}
                </div>
              )
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <code className="field-id">{selectedProject?.key}</code>
                <span style={{ fontSize: "12px" }}>{selectedProject?.name}</span>
                <button className="btn-small" onClick={() => { setStep(1); setSelectedProject(null); setSelectedWorkflow(null); setSelectedTransition(null); setRuleType(null); }} style={{ fontSize: "10px", padding: "2px 6px" }}>Change</button>
              </div>
            )}
          </div>
        )}

        {/* Step 2: Workflow */}
        {step >= 2 && (
          <div style={{ marginBottom: step > 2 ? "8px" : "0" }}>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "6px" }}>
              Workflow
            </label>
            {step === 2 ? (
              loadingWorkflows ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {[1, 2].map((i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", border: "1px solid var(--border-color)", borderRadius: "8px" }}>
                      <div className="sk sk-text" style={{ width: "50%", height: 13 }} />
                      <div className="sk sk-text" style={{ width: "20%", height: 11 }} />
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {workflows.map((w) => (
                    <button
                      key={w.id}
                      onClick={() => handleWorkflowSelect(w)}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        width: "100%", padding: "10px 14px", border: "1px solid var(--border-color)",
                        borderRadius: "8px", background: "var(--input-bg)", color: "var(--text-color)",
                        cursor: "pointer", transition: "all 0.15s ease", fontSize: "13px",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--primary-color)"; e.currentTarget.style.background = "var(--hover-bg)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border-color)"; e.currentTarget.style.background = "var(--input-bg)"; }}
                    >
                      <span style={{ fontWeight: 600 }}>{w.name}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{w.transitionCount} transitions</span>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" style={{ opacity: 0.5 }}>
                          <path d="M9 18l6-6-6-6" />
                        </svg>
                      </div>
                    </button>
                  ))}
                  {workflows.length === 0 && <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>No workflows found for this project</span>}
                </div>
              )
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "12px" }}>{selectedWorkflow?.name}</span>
                <button className="btn-small" onClick={() => { setStep(2); setSelectedWorkflow(null); setSelectedTransition(null); setRuleType(null); }} style={{ fontSize: "10px", padding: "2px 6px" }}>Change</button>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Transition */}
        {step >= 3 && (
          <div style={{ marginBottom: step > 3 ? "8px" : "0" }}>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "6px" }}>
              Transition
            </label>
            {step === 3 ? (
              loadingTransitions ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", border: "1px solid var(--border-color)", borderRadius: "8px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <div className="sk sk-text" style={{ width: 80, height: 13 }} />
                        <div className="sk sk-text" style={{ width: 40, height: 16, borderRadius: 4 }} />
                        <div className="sk sk-text" style={{ width: 12, height: 12 }} />
                        <div className="sk sk-text" style={{ width: 50, height: 16, borderRadius: 4 }} />
                      </div>
                      <div className="sk sk-text" style={{ width: 14, height: 14 }} />
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {transitions.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => handleTransitionSelect(t)}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        width: "100%", padding: "10px 14px", border: "1px solid var(--border-color)",
                        borderRadius: "8px", background: "var(--input-bg)", color: "var(--text-color)",
                        cursor: "pointer", transition: "all 0.15s ease", fontSize: "13px",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--primary-color)"; e.currentTarget.style.background = "var(--hover-bg)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border-color)"; e.currentTarget.style.background = "var(--input-bg)"; }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <span style={{ fontWeight: 600 }}>{t.name}</span>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "var(--text-muted)" }}>
                          <span style={{
                            padding: "2px 6px", borderRadius: "4px", fontSize: "10px", fontWeight: 500,
                            background: t.type === "initial" ? "rgba(22,163,106,0.1)" : "rgba(100,116,139,0.1)",
                            color: t.type === "initial" ? "var(--success-color)" : "var(--text-secondary)",
                          }}>
                            {t.fromName || "Any"}
                          </span>
                          <span style={{ color: "var(--text-muted)" }}>&rarr;</span>
                          <span style={{
                            padding: "2px 6px", borderRadius: "4px", fontSize: "10px", fontWeight: 500,
                            background: "rgba(37,99,235,0.1)", color: "var(--primary-color)",
                          }}>
                            {t.toName || "?"}
                          </span>
                        </span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        {(t.hasCogniValidator || t.hasCogniCondition || t.hasCogniPostFunction) && (
                          <span style={{
                            fontSize: "9px", padding: "2px 6px", borderRadius: "4px", fontWeight: 600,
                            background: "rgba(37,99,235,0.12)", color: "var(--primary-color)", letterSpacing: "0.3px",
                          }}>
                            COGNIRUNNER
                          </span>
                        )}
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" style={{ opacity: 0.5 }}>
                          <path d="M9 18l6-6-6-6" />
                        </svg>
                      </div>
                    </button>
                  ))}
                  {transitions.length === 0 && <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>No transitions found</span>}
                </div>
              )
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "12px" }}>{selectedTransition?.name}</span>
                <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>({selectedTransition?.fromName} &rarr; {selectedTransition?.toName})</span>
                <button className="btn-small" onClick={() => { setStep(3); setSelectedTransition(null); setRuleType(null); }} style={{ fontSize: "10px", padding: "2px 6px" }}>Change</button>
              </div>
            )}
          </div>
        )}

        {/* Step 4: Rule type */}
        {step >= 4 && (
          <div style={{ marginBottom: step > 4 ? "8px" : "0" }}>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "6px" }}>
              Rule Type
            </label>
            {step === 4 ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                {RULE_TYPE_OPTIONS.map((opt) => {
                  const badgeClass = opt.value.startsWith("postfunction") ? "type-postfunction"
                    : opt.value === "condition" ? "type-condition" : "type-validator";
                  return (
                    <button
                      key={opt.value}
                      onClick={() => handleTypeSelect(opt.value)}
                      style={{
                        display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "6px",
                        padding: "14px 16px", border: "1px solid var(--border-color)",
                        borderRadius: "8px", background: "var(--input-bg)", color: "var(--text-color)",
                        cursor: "pointer", transition: "all 0.15s ease", textAlign: "left",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--primary-color)"; e.currentTarget.style.background = "var(--hover-bg)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border-color)"; e.currentTarget.style.background = "var(--input-bg)"; }}
                    >
                      <span className={`type-badge ${badgeClass}`} style={{ fontSize: "9px" }}>{opt.label}</span>
                      <span style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.3 }}>{opt.desc}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span className={`type-badge type-${ruleType?.startsWith("postfunction") ? "postfunction" : ruleType}`}>
                  {RULE_TYPE_OPTIONS.find((o) => o.value === ruleType)?.label}
                </span>
                <button className="btn-small" onClick={() => { setStep(4); setRuleType(null); }} style={{ fontSize: "10px", padding: "2px 6px" }}>Change</button>
              </div>
            )}
          </div>
        )}

        {/* Step 5: Config */}
        {step === 5 && (
          <div style={{ marginTop: "12px", borderTop: "1px solid var(--border-color)", paddingTop: "12px" }}>
            {/* Validator / Condition config */}
            {(ruleType === "validator" || ruleType === "condition") && (
              <>
                {/* Info banner */}
                <div style={{
                  display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px", marginBottom: "14px",
                  borderRadius: "8px", border: "1px solid var(--border-color)", background: "var(--input-bg)",
                }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={ruleType === "condition" ? "var(--success-color)" : "var(--primary-color)"} strokeWidth="2">
                    {ruleType === "condition"
                      ? <><circle cx="12" cy="12" r="10" /><path d="M8 12l2 2 4-4" /></>
                      : <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    }
                  </svg>
                  <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                    {ruleType === "condition"
                      ? "Hides or shows the transition button based on AI evaluation. Does not block — just controls visibility."
                      : "Blocks the transition if the AI determines the field content does not meet your criteria."
                    }
                  </div>
                </div>

                {/* Field selector */}
                <div style={{ marginBottom: "14px" }}>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "6px" }}>
                    Field to Validate <span style={{ color: "var(--error-color)" }}>*</span>
                  </label>
                  {loadingFields ? (
                    <div className="sk sk-block" style={{ height: 36 }} />
                  ) : (
                    <CustomSelect
                      value={fieldId}
                      onChange={setFieldId}
                      placeholder="Select a field..."
                      searchable
                      searchPlaceholder="Search fields..."
                      options={fieldOptions}
                    />
                  )}
                  <p style={{ margin: "4px 0 0 0", fontSize: "11px", color: "var(--text-muted)" }}>
                    Select the field whose value will be validated by AI on each transition.
                  </p>
                </div>

                {/* Prompt */}
                <div style={{ marginBottom: "14px" }}>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "6px" }}>
                    Validation Prompt <span style={{ color: "var(--error-color)" }}>*</span>
                  </label>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder={ruleType === "condition"
                      ? "When should this transition be visible? E.g. 'Show only when the description contains acceptance criteria'"
                      : "Describe what makes the field value valid. E.g. 'The description must include steps to reproduce, expected behavior, and actual behavior'"
                    }
                    rows={5}
                    className={`wiz-textarea${submitted && !prompt.trim() ? " wiz-error" : ""}`}
                  />
                  <p style={{ margin: "4px 0 0 0", fontSize: "11px", color: "var(--text-muted)" }}>
                    Describe the validation criteria in natural language. The AI will evaluate if the field content meets these requirements.
                  </p>
                </div>

                {/* JQL / Agentic toggle */}
                <div style={{ marginBottom: "14px" }}>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "6px" }}>
                    Jira Search (JQL)
                  </label>
                  <div style={{ maxWidth: "280px" }}>
                    <CustomSelect
                      value={enableTools === null ? "auto" : enableTools ? "on" : "off"}
                      onChange={(v) => setEnableTools(v === "auto" ? null : v === "on")}
                      options={[
                        { value: "auto", label: "Auto-detect from prompt" },
                        { value: "on", label: "Always enabled" },
                        { value: "off", label: "Always disabled" },
                      ]}
                    />
                  </div>
                  <p style={{ margin: "4px 0 0 0", fontSize: "11px", color: "var(--text-muted)" }}>
                    When enabled, the AI can search Jira for similar or related issues during validation (e.g. duplicate detection). Auto-detect activates this when your prompt mentions duplicates, similarity, or existing issues.
                  </p>
                </div>

                {/* Documentation Library — same component config-ui uses, lets the AI
                    reference user-uploaded reference docs during validation. */}
                <DocRepository
                  selectedDocs={selectedDocIds}
                  onSelectionChange={setSelectedDocIds}
                />

                {/* AI Review — same component config-ui uses. Critiques the configured
                    rule (prompt + field + selected docs) before the user saves. */}
                <ReviewPanel
                  configType={ruleType}
                  config={{ fieldId, prompt, enableTools, selectedDocIds }}
                />

                {/* Test Run */}
                <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: "12px", marginBottom: "14px" }}>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "6px" }}>
                    Test Validation
                  </label>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <input
                      type="text"
                      value={testIssue}
                      onChange={(e) => setTestIssue(e.target.value.toUpperCase())}
                      placeholder="Issue key (e.g. WFH-36)"
                      className="wiz-input wiz-input-mono"
                      style={{ flex: 1 }}
                    />
                    <button
                      className="btn-small btn-edit"
                      disabled={testRunning || !testIssue.trim() || !fieldId || !prompt.trim()}
                      onClick={async () => {
                        setTestRunning(true);
                        setTestResult(null);
                        try {
                          const result = await invoke("testValidation", {
                            issueKey: testIssue.trim(),
                            fieldId,
                            prompt,
                            enableTools,
                            selectedDocIds,
                          });
                          setTestResult(result);
                        } catch (e) {
                          setTestResult({ success: false, error: e.message });
                        }
                        setTestRunning(false);
                      }}
                    >
                      {testRunning ? "Running..." : "Run Test"}
                    </button>
                  </div>
                  <p style={{ margin: "4px 0 0 0", fontSize: "11px", color: "var(--text-muted)" }}>
                    Dry run — no transition is blocked. Tests the validation against a real issue.
                  </p>

                  {testResult && (
                    <div style={{
                      marginTop: "8px", padding: "10px 12px", borderRadius: "8px",
                      border: `1px solid ${testResult.success ? (testResult.isValid ? "var(--success-color)" : "var(--error-color)") : "var(--error-color)"}`,
                      background: testResult.success ? (testResult.isValid ? "rgba(22,163,106,0.06)" : "rgba(220,38,38,0.06)") : "rgba(220,38,38,0.06)",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                        <span className={`type-badge ${testResult.success && testResult.isValid ? "type-condition" : "type-validator"}`} style={{ fontSize: "9px" }}>
                          {testResult.success ? (testResult.isValid ? "PASS" : "FAIL") : "ERROR"}
                        </span>
                        {testResult.issueKey && <span style={{ fontSize: "12px", fontWeight: 600 }}>{testResult.issueKey}</span>}
                        {testResult.executionTimeMs && <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>{testResult.executionTimeMs}ms</span>}
                        <button style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "16px" }} onClick={() => setTestResult(null)}>&times;</button>
                      </div>
                      {testResult.error && !testResult.success && (
                        <div style={{ fontSize: "12px", color: "var(--error-color)", marginBottom: "4px" }}>{testResult.error}</div>
                      )}
                      {testResult.reason && (
                        <div style={{ fontSize: "12px", color: "var(--text-color)" }}>
                          <span style={{ fontWeight: 600, fontSize: "10px", color: "var(--text-muted)", textTransform: "uppercase" }}>AI Reasoning</span>
                          <div style={{ marginTop: "2px" }}>{testResult.reason}</div>
                        </div>
                      )}
                      {testResult.fieldValue && (
                        <div style={{ marginTop: "6px" }}>
                          <span style={{ fontWeight: 600, fontSize: "10px", color: "var(--text-muted)", textTransform: "uppercase" }}>Field Value</span>
                          <pre style={{ margin: "2px 0 0 0", fontSize: "11px", padding: "6px 8px", background: "var(--code-bg)", borderRadius: "4px", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: "100px", overflow: "auto" }}>{testResult.fieldValue}</pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Semantic PF config — uses the same SemanticConfig component as config-ui.
                The component itself includes: source-field selector, condition + action
                prompts, target-field selector, doc library, AI review, and a test panel.
                Anything that exists in the workflow-menu flow exists here too. */}
            {ruleType === "postfunction-semantic" && (
              <SemanticConfig
                conditionPrompt={conditionPrompt}
                setConditionPrompt={setConditionPrompt}
                actionPrompt={actionPrompt}
                setActionPrompt={setActionPrompt}
                actionFieldId={actionFieldId}
                setActionFieldId={setActionFieldId}
                fieldId={fieldId}
                setFieldId={setFieldId}
                fields={fields}
                loadingFields={loadingFields}
                errorFields={null}
                selectedDocIds={selectedDocIds}
                onDocSelectionChange={setSelectedDocIds}
                crossCheckClaims={crossCheckClaims}
                setCrossCheckClaims={setCrossCheckClaims}
              />
            )}

            {ruleType === "postfunction-generate-doc" && (
              <GenerateDocConfig
                fieldId={fieldId}
                setFieldId={setFieldId}
                fields={fields}
                loadingFields={loadingFields}
                errorFields={null}
                docFormat={docFormat}
                setDocFormat={setDocFormat}
                contentPrompt={contentPrompt}
                setContentPrompt={setContentPrompt}
                docTitlePrompt={docTitlePrompt}
                setDocTitlePrompt={setDocTitlePrompt}
                attachComment={attachComment}
                setAttachComment={setAttachComment}
                selectedDocIds={selectedDocIds}
                onDocSelectionChange={setSelectedDocIds}
              />
            )}

            {/* Static PF — uses the same FunctionBuilder component as config-ui.
                FunctionBuilder renders a FunctionBlock per step with: prior-vars bar,
                operation-type auto-detection, endpoint suggestion, doc library per
                step, AI code generation with doc context, code editor, generation
                fallback notice, and per-step test runs. AI Review of the whole chain
                is included at the bottom of FunctionBuilder. Identical to config-ui. */}
            {ruleType === "postfunction-static" && (
              <FunctionBuilder
                functions={functions}
                setFunctions={setFunctions}
              />
            )}


          </div>
        )}
      </div>

      {/* Footer */}
      {step === 5 && (
        <div className="wiz-footer">
          <span className="wiz-footer-hint">The rule will be registered and injected into the workflow transition automatically.</span>
          <div className="wiz-footer-actions">
            <button className="btn-small" onClick={onClose}>Cancel</button>
            <button
              className="btn-small btn-edit"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Creating..." : "Create Rule"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
