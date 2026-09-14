/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * PremadeRuleForm — the catalog-driven config form for premade (non-AI) workflow
 * validators/conditions. Picks a rule type from the shared catalog, renders the
 * inputs that rule needs, and reports the assembled config + validity to the
 * parent via `onChange(config, valid)`.
 *
 * Self-contained (no imports from App.js) so it can be byte-copied to
 * static/admin-panel/src/components/. Imports only React, @forge/bridge,
 * CustomSelect, and the shared catalog. REST-backed picker lists are fetched
 * once via the getRuleLists resolver.
 *
 * Props:
 *   mode      "validator" | "condition" | "postfunction" — which catalog half to show.
 *             "postfunction" is the premade POST-FUNCTION half (the Coder, 1.4 commit 12):
 *             it has no error message and no gate copy, because it runs after the
 *             transition and can never block one.
 *   fields    [{ id, name, ... }] — the issue fields (loaded by the parent).
 *   initial   the saved premade config to hydrate on edit (or null for new).
 *   onChange  (config, valid) => void — config is { ruleType, ...params }.
 */
import React, { useState, useEffect, useRef } from "react";
import { invoke, router, view } from "@forge/bridge";
import CustomSelect from "./CustomSelect";
import {
  getCatalog, findRule, COMPARE_OPS, EXPRESSION_BACKED_CONDITIONS, CONDITION_NOT_EXPRESSIBLE_REASON,
  conditionFieldSupport, PR_MATCH_OPTIONS, PR_MATCH_DEFAULT, gitSubEnabled, hasGitGroup,
  CODER_PF_MODES, CODER_PF_INSTRUCTIONS_MAX, getCoderPfMode,
  confluenceSubEnabled, hasConfluenceGroup,
  CONFLUENCE_VALIDATOR_MODES, CONFLUENCE_VALIDATOR_MODE_DEFAULT, CONFLUENCE_VALIDATOR_MODE_IDS,
} from "../../../../src/shared/premade-rules-catalog.js";
/* The Confluence vocabulary, from the ONE home the executor and the server-side clamp
   read (F-447): the caps this form must not let a rule exceed and the default page title
   the run time actually falls back to. */
import {
  CQL_MAX_CHARS, TITLE_MAX_CHARS, COMMENT_TEMPLATE_MAX_CHARS,
  CONFLUENCE_DEFAULT_TITLE_TEMPLATE, renderTextTemplate, renderCqlTemplate,
  CONFLUENCE_NOT_INSTALLED, CONFLUENCE_INSTALL_REMEDY,
} from "../../../../src/shared/confluence-rules.js";
import { manageAppsUrl } from "../../../../src/shared/manage-apps.js";
import { redosRisk } from "../../../../src/shared/regex-safety.js";
import { gitProviderKindMeta, normalizeRepoId } from "../../../../src/shared/git-ids.js";
import { isPermissionRefusal } from "./refusal";

// F-379 — the labels and hints live in the CATALOG (PR_MATCH_OPTIONS), beside the ids the
// executor reads, because explain-facts.js renders the same rule in the same words. This
// form used to carry its own copy, and after F-362 that copy still promised a trust the
// executor had dropped: the cognirunner.git property NOMINATES a pull request number and
// nothing more, so "property" and "both" are the same check and the picker now says so.

/* F-463 - the skills cap. The SAME number the knowledge panel enforces per static step
   and the resolver enforces on a Coder turn: four instruction packs is what a prompt
   carries without the rule's own words being crowded out. */
const MAX_RULE_SKILLS = 4;

export default function PremadeRuleForm({ mode = "validator", fields = [], initial, onChange }) {
  const catalog = getCatalog(mode);

  const [ruleType, setRuleType] = useState("");
  const [fieldId, setFieldId] = useState("");
  const [regex, setRegex] = useState("");
  const [allowedValues, setAllowedValues] = useState("");
  const [op, setOp] = useState("eq");
  const [compareValue, setCompareValue] = useState("");
  const [value, setValue] = useState("");
  const [pickerValue, setPickerValue] = useState(""); // backs a `picker` param
  const [minLen, setMinLen] = useState("");
  const [maxLen, setMaxLen] = useState("");
  const [dateMode, setDateMode] = useState("future");
  const [days, setDays] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [lists, setLists] = useState({});
  const [listsError, setListsError] = useState(false); // fetch failure — kept distinct from a genuinely-empty list
  /* ---- the GIT param group (F-350) ----------------------------------------------
     FOUR keys, exactly as the catalogue docblock declares: connectionId, repo,
     prMatch, strict. The Strict helper text below is the fail-open/fail-closed table
     beside runGitValidator (src/premade-rules.js) put into words, and it describes the
     only two rows `strict` actually flips: provider unreachable, and a dead credential.
     The two rows that fail CLOSED whatever strict says — a connection id naming no row,
     and a repo that is not on that connection's allow-list — are MISCONFIGURATION, which
     is why both are picked from a list here and never typed. */
  const [connectionId, setConnectionId] = useState("");
  const [repo, setRepo] = useState("");
  const [prMatch, setPrMatch] = useState("both");
  const [strict, setStrict] = useState(false);
  /* ---- the CODER params (F-388) --------------------------------------------------
     `coderMode` writes `mode` and `instructions` writes `instructions` — the two keys
     `enqueueCoderPostFunction` (src/index.js) reads beside the git group. There is no
     default mode on purpose: a coder rule saved with no mode is an ERROR at every
     transition in both strict columns, so the form refuses to save without one rather
     than quietly picking "build" and pushing code nobody asked for. */
  const [coderMode, setCoderMode] = useState("");
  const [instructions, setInstructions] = useState("");
  /* ---- the Coder's SKILLS (F-463) -------------------------------------------------
     `skillIds` is the third key `enqueueCoderPostFunction` reads, and it is a rule-level
     choice: the same instruction packs ride every transition this rule fires on. At most
     MAX_RULE_SKILLS, enforced here and again in the resolver. `skillNames` travels beside
     it exactly as `fieldName` travels beside `fieldId` - DISPLAY ONLY, so a summary can
     name what was picked without a second read; every runtime decision is made from the
     ids. A rule with no skills omits both keys rather than saving empty arrays. */
  const [skillIds, setSkillIds] = useState([]);
  const [skillRows, setSkillRows] = useState([]);
  /* ---- the CONFLUENCE param group (F-447) ---------------------------------------
     The keys `premadeConfluenceConfig` (src/index.js) clamps and stores, and nothing
     else: spaceKey, mode, cqlTemplate, prompt, titleTemplate, parentId, commentTemplate,
     strict (shared with the git group above) and the source fieldId. Which of them a
     given rule HAS is `confluenceSubEnabled`'s question, never truthiness (F-388).
     The space is PICKED, never typed: a space key that names no space is
     MISCONFIGURATION, and misconfiguration BLOCKS the transition in BOTH strict columns
     (the F-416 degradation table beside runConfluenceValidator, src/premade-rules.js). */
  const [spaceKey, setSpaceKey] = useState("");
  const [confMode, setConfMode] = useState(CONFLUENCE_VALIDATOR_MODE_DEFAULT);
  const [cqlTemplate, setCqlTemplate] = useState("");
  const [confPrompt, setConfPrompt] = useState("");
  const [titleTemplate, setTitleTemplate] = useState("");
  const [parentId, setParentId] = useState("");
  const [commentTemplate, setCommentTemplate] = useState("");
  /* Rich connection rows (kind, status, per-connection repo allow-list) from
     `listGitConnections`. That resolver is requireAdmin, so a workflow EDITOR gets a
     permission REFUSAL — not an outage, and not something to retry. In that case the
     form falls back to the editor-floor rows getRuleLists returns.

     F-369 — those rows are now RICH: `gitconnections: [{id, kind, label, repos[]}]`, with
     no status and no secret state. Each row carries its OWN repo allow-list, so the editor
     path NARROWS exactly like the admin path, and the "this list is every repository across
     all connections" note disappears with the thing it described. The older flat shape
     (`{value,label}` plus the `gitrepos` UNION) is still read, because a form that breaks on
     the shape its backend has today would be worse than one that says it cannot narrow: no
     repos[] on the rows means no narrowing, and the note comes back.
     null = not fetched yet. */
  const [gitRows, setGitRows] = useState(null);
  const [gitNarrowed, setGitNarrowed] = useState(true);
  const [gitRefused, setGitRefused] = useState(false);
  const hydratedRef = useRef(false);
  // NL-to-rule builder ("Build from a description"), collapsed by default.
  const [brOpen, setBrOpen] = useState(false);
  const [nlText, setNlText] = useState("");
  const [buildState, setBuildState] = useState("idle"); // idle | loading | done | degraded | error
  const [buildExplanation, setBuildExplanation] = useState("");
  const [buildReason, setBuildReason] = useState("");
  const [buildUnresolved, setBuildUnresolved] = useState([]);
  /* F-958 - the builder sits COLLAPSED at the top of the form, and the required CQL box
     sits far below it, so a designer who does not write CQL met a required field with no
     way forward. `brBodyRef`/`brInputRef` give the "Describe the page instead" button
     beside that field a real destination: it opens the builder, scrolls it into view and
     puts the caret in the textarea, which is the same thing the reader would have had to
     find by hand. */
  const brBodyRef = useRef(null);
  const brInputRef = useRef(null);
  const [brFocusPending, setBrFocusPending] = useState(false);
  const openBuilderForCql = () => { setBrOpen(true); setBrFocusPending(true); };
  /* The scroll and the focus happen AFTER the body exists, which is why they are an
     effect and not the click handler: the textarea is mounted by the state change the
     click makes, so a handler that reaches for it finds null. */
  useEffect(() => {
    if (!brFocusPending || !brOpen) return;
    if (brBodyRef.current && brBodyRef.current.scrollIntoView) {
      brBodyRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    if (brInputRef.current && brInputRef.current.focus) brInputRef.current.focus();
    setBrFocusPending(false);
  }, [brFocusPending, brOpen]);

  /* The site origin, for the Manage apps link on the not-installed card. No origin means
     no link and the prose stands alone - it never renders a dead href. */
  const [siteUrl, setSiteUrl] = useState("");
  useEffect(() => {
    let live = true;
    Promise.resolve(view.getContext())
      .then((ctx) => { if (live && ctx && ctx.siteUrl) setSiteUrl(String(ctx.siteUrl)); })
      .catch(() => { /* no origin, no link */ });
    return () => { live = false; };
  }, []);

  // Fetch REST-backed picker lists once (issue types / statuses / resolutions / link types / priorities).
  // A fetch failure is kept distinct from a genuinely-empty list so the picker can offer Retry
  // instead of silently reading as "None available" (which would look like the list has no options).
  const loadLists = () => {
    setListsError(false);
    invoke("getRuleLists")
      .then((res) => { if (res?.success) setLists(res.lists || {}); else setListsError(true); })
      .catch(() => setListsError(true));
  };
  useEffect(() => { loadLists(); }, []);

  // The rich git rows, fetched once. A permission refusal is a SETTLED answer (the
  // reader is not a CogniRunner admin) and leaves gitRows as an empty array so the
  // fallback below takes over; any other failure does the same, because a git rule
  // with no pickable connection is unfinished config, which the executor ALLOWS.
  const gitLoadedRef = useRef(false);
  const loadGitConnections = () => {
    if (gitLoadedRef.current) return;
    gitLoadedRef.current = true;
    invoke("listGitConnections")
      .then((res) => {
        if (res?.success && Array.isArray(res.connections)) { setGitRows(res.connections); setGitNarrowed(true); }
        // A refusal and an outage both land here; neither can narrow a repo list, and
        // isPermissionRefusal is what tells them apart for the note the picker shows.
        else { setGitRows([]); setGitNarrowed(false); setGitRefused(isPermissionRefusal(res)); }
      })
      .catch(() => { setGitRows([]); setGitNarrowed(false); });
  };

  // Hydrate from a saved config exactly once (on edit).
  useEffect(() => {
    if (hydratedRef.current || !initial) return;
    hydratedRef.current = true;
    const rt = initial.ruleType || "";
    setRuleType(rt);
    setFieldId(initial.fieldId || "");
    setRegex(initial.regex || "");
    setAllowedValues(initial.allowedValues || "");
    setOp(initial.op || "eq");
    setCompareValue(initial.compareValue || "");
    setValue(initial.value || "");
    const pk = findRule(mode, rt)?.params?.picker?.key;
    setPickerValue(pk ? initial[pk] || "" : "");
    setMinLen(initial.min != null ? String(initial.min) : "");
    setMaxLen(initial.max != null ? String(initial.max) : "");
    setDateMode(initial.mode || "future");
    setDays(initial.days != null ? String(initial.days) : "");
    setConnectionId(initial.connectionId || "");
    setRepo(initial.repo || "");
    setPrMatch(initial.prMatch === "property" || initial.prMatch === "branch" ? initial.prMatch : "both");
    setStrict(initial.strict === true);
    // `mode` is shared with the dateRel group (future/within), so it is only read as a
    // coder mode when the catalogue says this rule HAS one — and only when it names a
    // real mode, so a row from a newer build hydrates as "unset" rather than as a
    // picker showing a mode the executor would refuse.
    setCoderMode(findRule(mode, rt)?.params?.coderMode && getCoderPfMode(initial.mode) ? initial.mode : "");
    setInstructions(typeof initial.instructions === "string" ? initial.instructions.slice(0, CODER_PF_INSTRUCTIONS_MAX) : "");
    setSkillIds(Array.isArray(initial.skillIds)
      ? initial.skillIds.filter((v) => typeof v === "string" && v).slice(0, MAX_RULE_SKILLS)
      : []);
    // The Confluence group. `mode` is a key THREE groups write (dateRel, the Coder and
    // this one), so it is only read as a Confluence mode when the catalogue says this
    // rule has one, and only when it names a mode the executor knows.
    setSpaceKey(initial.spaceKey || "");
    setConfMode(hasConfluenceGroup(findRule(mode, rt)?.params) && CONFLUENCE_VALIDATOR_MODE_IDS.includes(initial.mode)
      ? initial.mode : CONFLUENCE_VALIDATOR_MODE_DEFAULT);
    setCqlTemplate(typeof initial.cqlTemplate === "string" ? initial.cqlTemplate.slice(0, CQL_MAX_CHARS) : "");
    setConfPrompt(typeof initial.prompt === "string" ? initial.prompt.slice(0, CQL_MAX_CHARS) : "");
    setTitleTemplate(typeof initial.titleTemplate === "string" ? initial.titleTemplate.slice(0, TITLE_MAX_CHARS) : "");
    setParentId(initial.parentId || "");
    setCommentTemplate(typeof initial.commentTemplate === "string" ? initial.commentTemplate.slice(0, COMMENT_TEMPLATE_MAX_CHARS) : "");
    setErrorMessage(initial.errorMessage || "");
  }, [initial, mode]);

  const rule = findRule(mode, ruleType);
  const p = rule?.params || {};
  // A condition is evaluated by Jira as a Jira expression, not by our backend, so
  // only the types the manifest expression implements are real. Offering any other
  // one would silently allow every transition.
  const notExpressible = mode === "condition" && !!ruleType && !EXPRESSION_BACKED_CONDITIONS.includes(ruleType);
  const unavailable = rule?.availability === "unavailable" || notExpressible;
  const unavailableWhy = notExpressible ? CONDITION_NOT_EXPRESSIBLE_REASON : rule?.unavailableReason;

  // Field-based CONDITION types: the expression can only evaluate custom fields
  // of a live-probed kind (see CONDITION_FIELD_KINDS). Resolve the picked field's
  // support ONCE here — it drives the config keys (exprProp/exprKind), the
  // refusal note, and validity. conditionFieldSupport is the single source.
  /* Does THIS rule show the source-field picker? Only the Confluence PAGE post-function
     authors a body from a field (`confluenceIssueFacts`, src/index.js); the validator
     names its own fields inside the CQL template, and the comment rule substitutes only
     {issueKey}/{summary}. The page rule is the one whose group keeps `titleTemplate`. */
  const confSourceField = mode === "postfunction" && hasConfluenceGroup(p) && confluenceSubEnabled(p, "titleTemplate");
  const isFieldCondition = mode === "condition"
    && (ruleType === "field-has-value" || ruleType === "field-empty" || ruleType === "field-equals");
  const pickedField = p.field ? fields.find((f) => f.id === fieldId) : null;
  const fieldSupport = isFieldCondition && pickedField
    ? conditionFieldSupport(pickedField, ruleType)
    : null;

  // Build the config object + validity from the current state.
  const fieldName = (pickedField || fields.find((f) => f.id === fieldId) || {}).name || "";
  // conditionKind tells the manifest expression this config is one it should
  // evaluate. Without it the expression falls through to "allow" — which is what
  // keeps every pre-existing condition behaving exactly as before.
  const config = mode === "condition" ? { ruleType, conditionKind: "deterministic" } : { ruleType };
  if (p.field) {
    config.fieldId = fieldId;
    config.fieldName = fieldName;
  }
  if (fieldSupport && fieldSupport.exprProp) {
    // The expression only ever indexes `issue` with exprProp, only ever runs the
    // typed comparison exprKind names, and falls open without both — so these
    // keys ARE the safety contract, resolved at save time from the field schema.
    config.exprProp = fieldSupport.exprProp;
    config.exprKind = fieldSupport.exprKind;
    // Number equals compares typed (expression == is strict): carry the value as
    // a real JSON number too. The expression ignores a non-finite/absent one.
    if (ruleType === "field-equals" && fieldSupport.exprKind === "num" && value.trim() !== "" && Number.isFinite(Number(value))) {
      config.valueNum = Number(value);
    }
  }
  if (p.regex) config.regex = regex.trim();
  if (p.allowed) config.allowedValues = allowedValues.trim();
  if (p.opValue) {
    config.op = op;
    config.compareValue = compareValue.trim();
  }
  if (p.value) config.value = value.trim();
  // Set the picker key ONLY when chosen — an optional picker (link type) left blank must OMIT the key
  // so the executor's "any" branch (config.x == null) fires (an empty string would not equal null).
  if (p.picker && pickerValue.trim()) config[p.picker.key] = pickerValue.trim();
  if (p.lengthBounds) {
    if (minLen.trim() !== "") config.min = Number(minLen);
    if (maxLen.trim() !== "") config.max = Number(maxLen);
  }
  if (p.dateRel) {
    config.mode = dateMode;
    if (dateMode === "within" && days.trim() !== "") config.days = Number(days);
  }
  // The Coder's two keys. `mode` is only ever one of CODER_PF_MODE_IDS (the control cannot
  // produce anything else) and `instructions` is clamped HERE as well as at the prompt
  // seam, because a config that saves 40KB of notes is a 240KiB KVS value waiting to
  // happen — the clamp belongs where the value is created, not only where it is read.
  if (p.coderMode) config.mode = coderMode;
  if (p.instructions) {
    const text = instructions.trim().slice(0, CODER_PF_INSTRUCTIONS_MAX);
    if (text) config.instructions = text;
  }
  // F-463 - the ids the engine reads, and the names only a reader needs. Nothing is
  // written when nothing was picked: the Coder simply runs with no skills, which is what
  // every Coder rule did before this control existed.
  if (p.skillIds && skillIds.length) {
    config.skillIds = skillIds.slice(0, MAX_RULE_SKILLS);
    config.skillNames = config.skillIds.map((id) => (skillRows.find((sk) => sk.id === id) || {}).name || id);
  }
  if (hasGitGroup(p)) {
    config.connectionId = connectionId;
    // normalizeRepoId is the SINGLE way a repo id is written down (src/shared/git-ids.js).
    // The picker already offers normalised values; running it here means a hydrated legacy
    // value or an AI draft cannot save a differently-cased id that isRepoAllowed would
    // then reject — which fails CLOSED and would read as "this rule is broken".
    config.repo = normalizeRepoId(repo);
    // Only the sub-controls this rule actually has reach the config: writing a prMatch a
    // rule switched OFF would put a key in the saved config that nothing ever reads, and
    // every reader would then have to guess whether it meant anything.
    if (gitSubEnabled(p, "prMatch")) config.prMatch = prMatch;
    if (gitSubEnabled(p, "strict")) config.strict = strict === true;
  }
  /* The CONFLUENCE group writes EXACTLY the catalogue's param ids, and only the
     sub-controls this rule has - the same discipline as the git group, and the same
     reason: a key the executor never reads is a control the next reader has to guess
     the meaning of. The clamps mirror `premadeConfluenceConfig` (src/index.js) so the
     form cannot hand the backend a value the backend would silently cut. */
  if (hasConfluenceGroup(p)) {
    if (confluenceSubEnabled(p, "spaceKey") && spaceKey.trim()) config.spaceKey = spaceKey.trim().slice(0, 120);
    if (confluenceSubEnabled(p, "mode")) config.mode = confMode;
    if (confluenceSubEnabled(p, "cqlTemplate") && cqlTemplate.trim()) config.cqlTemplate = cqlTemplate.trim().slice(0, CQL_MAX_CHARS);
    if (confluenceSubEnabled(p, "prompt") && confPrompt.trim()) config.prompt = confPrompt.trim().slice(0, CQL_MAX_CHARS);
    if (confluenceSubEnabled(p, "titleTemplate") && titleTemplate.trim()) config.titleTemplate = titleTemplate.trim().slice(0, TITLE_MAX_CHARS);
    if (confluenceSubEnabled(p, "commentTemplate") && commentTemplate.trim()) config.commentTemplate = commentTemplate.trim().slice(0, COMMENT_TEMPLATE_MAX_CHARS);
    // A page id, digits only - the same shape the backend accepts. Anything else is
    // dropped rather than saved as a parent nothing can resolve.
    if (confluenceSubEnabled(p, "parentId") && /^[0-9]{1,32}$/.test(parentId.trim())) config.parentId = parentId.trim();
    // The catalogue switches `strict` OFF on both post-functions (there is no strict
    // behaviour once the transition has happened), so this needs no rule-kind special
    // case: the group's shape is the one answer.
    if (confluenceSubEnabled(p, "strict")) config.strict = strict === true;
    // The source field the page's body is authored from (`confluenceIssueFacts` reads
    // config.fieldId and falls back to the description). Only the page rule reads it.
    if (confSourceField && fieldId) {
      config.fieldId = fieldId;
      config.fieldName = fieldName;
    }
  }
  if (mode === "validator" && errorMessage.trim()) config.errorMessage = errorMessage.trim();

  // ReDoS guard: block saving a catastrophic-backtracking pattern (e.g. (a+)+) — it would hang the
  // 25s validator budget for every reporter at runtime.
  const regexRisk = p.regex && regex.trim() ? redosRisk(regex.trim()) : null;

  let valid = !!ruleType && !unavailable;
  if (p.field && !fieldId) valid = false;
  // A field condition may only save with a supported field resolved: no
  // exprProp/exprKind means the expression would fall open — a rule that saves
  // but never gates is exactly the fiction this feature replaced.
  if (isFieldCondition && fieldId && (!fieldSupport || fieldSupport.unsupported)) valid = false;
  // Number equals must carry a real number.
  if (isFieldCondition && ruleType === "field-equals" && fieldSupport?.exprKind === "num"
      && value.trim() !== "" && !Number.isFinite(Number(value))) valid = false;
  if (p.regex && !regex.trim()) valid = false;
  if (regexRisk) valid = false;
  if (p.allowed && !allowedValues.trim()) valid = false;
  if (p.opValue && !compareValue.trim()) valid = false;
  if (p.value && !value.trim()) valid = false;
  if (p.picker && !p.picker.optional && !pickerValue.trim()) valid = false;
  if (p.lengthBounds && minLen.trim() === "" && maxLen.trim() === "") valid = false; // need at least one bound
  // Both bounds present but inverted (min > max) matches NOTHING at runtime → the validator
  // would block EVERY value on every transition. Refuse to save it (a common transposed-numbers slip).
  const boundsInverted = p.lengthBounds && minLen.trim() !== "" && maxLen.trim() !== "" && Number(minLen) > Number(maxLen);
  if (boundsInverted) valid = false;
  if (p.dateRel && dateMode === "within" && !(Number(days) > 0)) valid = false; // within needs a positive day count
  // Both git keys are required. Without them runGitValidator returns allow("not-configured")
  // — a gate that saves and then permits everything, which is the fiction F-350 is about.
  if (hasGitGroup(p) && (!connectionId.trim() || !normalizeRepoId(repo))) valid = false;
  // A Coder rule with no mode ERRORS on every transition in BOTH strict columns (the
  // fail-open/closed table beside enqueueCoderPostFunction), so it must not be savable.
  if (p.coderMode && !getCoderPfMode(coderMode)) valid = false;
  /* The Confluence group's required keys are exactly the ones whose absence is
     MISCONFIGURATION at run time - and misconfiguration BLOCKS the transition in BOTH
     strict columns (the validator) or records an ERROR on every run (the two
     post-functions). A rule that cannot say what it is checking must not be savable. */
  if (hasConfluenceGroup(p)) {
    if (confluenceSubEnabled(p, "spaceKey") && !spaceKey.trim()) valid = false;
    if (confluenceSubEnabled(p, "cqlTemplate") && !cqlTemplate.trim()) valid = false;
    if (confluenceSubEnabled(p, "mode") && confMode === "semantic" && !confPrompt.trim()) valid = false;
    if (confluenceSubEnabled(p, "commentTemplate") && !commentTemplate.trim()) valid = false;
    // A parent that is not a page id would be dropped on save - refuse it in front of
    // the reader instead of quietly losing what they typed.
    if (confluenceSubEnabled(p, "parentId") && parentId.trim() && !/^[0-9]{1,32}$/.test(parentId.trim())) valid = false;
  }

  /* ---- git derived values ---------------------------------------------------------
     One place decides what rows the two pickers see. `gitRows` (admin, rich) wins; the
     fallback is built from the flat lists getRuleLists already returns to editors. The
     fallback's repos are the UNION across connections, so it cannot narrow — which is
     exactly what `gitNarrowed:false` says to the reader below. */
  // Fetched only once a git rule is actually picked — a non-admin opening any other
  // premade rule must never see a permission refusal it did not provoke.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (hasGitGroup(p)) loadGitConnections(); }, [hasGitGroup(p)]);
  /* F-463 - the skills catalogue, fetched only once a rule that HAS the param is picked,
     for the same reason the git read is: a reader opening any other premade rule must
     never provoke a refusal for a question they did not ask. A refusal or an outage both
     leave the list empty, which renders NO picker - the rule saves and runs exactly as it
     did before the control existed, rather than blocking on a list nobody can read. */
  const skillsLoadedRef = useRef(false);
  useEffect(() => {
    if (!p.skillIds || skillsLoadedRef.current) return;
    skillsLoadedRef.current = true;
    invoke("getSkills")
      .then((res) => {
        if (res?.success && Array.isArray(res.skills)) setSkillRows(res.skills.filter((sk) => sk && sk.id && sk.enabled !== false));
      })
      .catch(() => { /* no picker, same as a refusal */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!p.skillIds]);
  const toggleRuleSkill = (id) => {
    setSkillIds((prev) => (prev.includes(id)
      ? prev.filter((v) => v !== id)
      : (prev.length >= MAX_RULE_SKILLS ? prev : [...prev, id])));
  };
  /* The editor-floor rows, normalised to the admin row's field names so ONE renderer
     serves both paths. `repos` is what decides whether this path can narrow (F-369). */
  const gitFallback = (lists.gitconnections || [])
    .map((o) => ({
      id: o.id || o.value,
      label: o.label || o.id || o.value,
      kind: o.kind || null,
      status: "ok", // the editor floor deliberately carries no credential state
      repos: Array.isArray(o.repos) ? o.repos : null,
    }))
    .filter((o) => !!o.id);
  const usingFallback = !((gitRows && gitRows.length) || gitNarrowed);
  const gitConnections = usingFallback
    ? gitFallback.map((o) => ({ ...o, repos: o.repos || [] }))
    : (gitRows || []);
  /* Can the list on screen be narrowed to ONE connection? The admin path always can; the
     editor path can whenever its rows carry their own repos[]. */
  const reposNarrowed = usingFallback
    ? (gitFallback.length > 0 && gitFallback.every((o) => Array.isArray(o.repos)))
    : true;
  const gitConn = gitConnections.find((c) => c.id === connectionId) || null;
  const gitConnDead = !!gitConn && gitConn.status === "auth_dead";
  // The repo allow-list of the CHOSEN connection. Nothing is offered before a connection
  // is chosen: a repository is only meaningful inside one, and the executor fails CLOSED
  // on a repo that connection may not read.
  const gitRepoOptions = reposNarrowed
    ? (gitConn ? (gitConn.repos || []) : [])
    : (connectionId ? (lists.gitrepos || []).map((o) => o.value) : []);

  // Report up whenever config/valid actually change. Use a ref for onChange so the
  // effect doesn't loop on the parent's inline callback identity.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const configKey = JSON.stringify({ config, valid });
  useEffect(() => {
    onChangeRef.current?.(config, valid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey]);

  // Switching the rule type clears params that don't apply (the error message persists — it's a
  // validator-wide message, not rule-specific).
  const onRuleType = (v) => {
    setRuleType(v);
    setFieldId("");
    setRegex("");
    setAllowedValues("");
    setOp("eq");
    setCompareValue("");
    setValue("");
    setPickerValue("");
    setMinLen("");
    setMaxLen("");
    setDateMode("future");
    setDays("");
    setConnectionId("");
    setRepo("");
    setPrMatch("both");
    // The Coder's params never survive a rule-type switch either: a mode and a note
    // written for one rule mean nothing on another, and `mode` is a key TWO groups use.
    setCoderMode("");
    setInstructions("");
    setSkillIds([]);
    // The Confluence params never survive a rule-type switch either: a space, a query and
    // a title written for one rule mean nothing on another, and `mode` is a key three
    // groups write.
    setSpaceKey("");
    setConfMode(CONFLUENCE_VALIDATOR_MODE_DEFAULT);
    setCqlTemplate("");
    setConfPrompt("");
    setTitleTemplate("");
    setParentId("");
    setCommentTemplate("");
    // Strict resets to OFF, never carried across rule types: arming the fail-CLOSED
    // behaviour on a transition is always an explicit choice (build-rule.js says the
    // same about the AI draft).
    setStrict(false);
  };

  // Apply a validated AI draft to the form via the setters (never saves). Numerics
  // are String()-coerced to match the string-typed state (min/max/days render via
  // .trim()) — mirrors the hydrate effect; a number here would crash the render.
  const applyDraft = (built) => {
    setRuleType(built.ruleType || "");
    setFieldId(built.fieldId || "");
    setRegex(built.regex || "");
    setAllowedValues(built.allowedValues || "");
    setOp(built.op || "eq");
    setCompareValue(built.compareValue || "");
    setValue(built.value || "");
    setPickerValue(built.pickerValue || "");
    setMinLen(built.min != null ? String(built.min) : "");
    setMaxLen(built.max != null ? String(built.max) : "");
    setDateMode(built.dateMode || "future");
    setDays(built.days != null ? String(built.days) : "");
    // The git group: validateBuiltRule only ever emits a connectionId/repo the CALLER
    // supplied, and leaves anything it could not resolve in `unresolved` for the human —
    // so an unresolved one must land as "" (an empty picker the user must fill), never
    // as a half-real value.
    setConnectionId(built.connectionId || "");
    setRepo(built.repo || "");
    setPrMatch(built.prMatch === "property" || built.prMatch === "branch" ? built.prMatch : "both");
    setStrict(built.strict === true);
    // The draft builder's vocabulary is KNOWN_PARAM_TYPES (src/shared/build-rule.js), which
    // has no coder params — so a draft can only ever CLEAR them, never invent a mode that
    // would hand a transition to the Coder because a sentence sounded like it.
    setCoderMode("");
    setInstructions("");
    // Same reason: nothing in KNOWN_PARAM_TYPES names a skill, so a draft can only clear.
    setSkillIds([]);
    /* The draft builder DOES have a Confluence vocabulary (src/shared/build-rule.js), and
       what it could not resolve it leaves in `unresolved` for the human - so an absent
       value lands as an empty control the reader must fill, never as a half-real one. */
    setSpaceKey(built.spaceKey || "");
    setConfMode(CONFLUENCE_VALIDATOR_MODE_IDS.includes(built.mode) ? built.mode : CONFLUENCE_VALIDATOR_MODE_DEFAULT);
    setCqlTemplate(built.cqlTemplate || "");
    setConfPrompt(built.prompt || "");
    setTitleTemplate(built.titleTemplate || "");
    setParentId(built.parentId || "");
    setCommentTemplate(built.commentTemplate || "");
    // errorMessage persists (validator-wide) — not cleared.
  };

  // One AI call per explicit Build click. Grounds the AI on exactly the field/list
  // options the user's own dropdowns show, so it can only reference real values.
  const runBuild = async () => {
    if (buildState === "loading" || nlText.trim().length < 5) return;
    setBuildState("loading");
    setBuildExplanation("");
    setBuildUnresolved([]);
    try {
      const result = await invoke("buildRule", {
        mode,
        description: nlText,
        fields: fields.map((f) => ({ id: f.id, name: f.name })),
        lists,
      });
      if (result && result.degraded) {
        setBuildReason(result.reason || "error");
        setBuildState("degraded");
      } else if (result && result.success && result.built) {
        applyDraft(result.built);
        setBuildExplanation(result.explanation || "");
        setBuildUnresolved(Array.isArray(result.unresolved) ? result.unresolved : []);
        setBuildState("done");
      } else {
        setBuildReason((result && result.error) || "");
        setBuildState("error");
      }
    } catch (e) {
      console.error("Build rule failed:", e);
      setBuildState("error");
    }
  };

  return (
    <div className="pr-form">
      {/* Build from a description (NL-to-rule) — collapsed by default; applies a
          reviewable draft to the form below, never saves.

          F-398 — NOT on the POST-FUNCTION half. `validateBuiltRule` (src/shared/build-rule.js)
          resolves every non-condition build against the VALIDATOR catalogue, so a draft built
          here could only ever name a rule key this picker does not contain: the form would set
          a ruleType it cannot render, `findRule("postfunction", key)` would answer null, and
          the whole thing would read as broken. A control whose only outcome is a dead form is
          worse than no control. It comes back the day the builder learns this half. */}
      {mode !== "postfunction" && (
      <div className="br-bar">
        <button type="button" className={`br-toggle${brOpen ? " open" : ""}`} onClick={() => setBrOpen((o) => !o)}>
          <span className="br-toggle-caret">▸</span> Build from a description
          <span className="br-toggle-hint">let AI pick the rule for you</span>
        </button>
        {brOpen && (
          <div className="br-body" ref={brBodyRef}>
            <textarea
              className="br-input"
              ref={brInputRef}
              value={nlText}
              onChange={(e) => setNlText(e.target.value)}
              placeholder="Describe the rule in plain English, e.g. “require the Rollback Plan field to be filled in”…"
              rows={2}
            />
            <button
              type="button"
              className={`br-btn${buildState === "loading" ? " is-busy busy-solid" : ""}`}
              onClick={runBuild}
              disabled={buildState === "loading" || nlText.trim().length < 5}
            >
              ✦ Build rule
            </button>
            {buildState === "done" && (
              <div className="br-card">
                <div className="br-eyebrow">§ WHAT I BUILT</div>
                {buildExplanation && <div className="br-summary">{buildExplanation}</div>}
                <div className="br-applied">Applied below, review and save.</div>
                {buildUnresolved.length > 0 && (
                  <div className="br-hint">Still needs: {buildUnresolved.join(", ")}.</div>
                )}
              </div>
            )}
            {buildState === "degraded" && (
              <div className="br-note">
                {buildReason === "lmstudio"
                  ? "Rule-building isn't available with the self-hosted LM Studio provider, switch to a hosted provider in CogniRunner Settings."
                  : buildReason === "timeout"
                  ? "The AI provider didn't respond in time, try again in a moment."
                  : "Couldn't build a rule right now, try again in a moment."}
              </div>
            )}
            {buildState === "error" && (
              <div className="br-note">{buildReason || "Couldn't match a premade rule to that description, try rephrasing."}</div>
            )}
          </div>
        )}
      </div>
      )}

      <div className="form-group">
        <label className="label">Rule <span className="required">*</span></label>
        <CustomSelect
          value={ruleType}
          onChange={onRuleType}
          searchable
          placeholder="Choose a premade rule…"
          options={catalog.map((r) => {
            // Tell the story IN the dropdown, not only after selection: any type
            // the manifest expression can't evaluate — anything needing related-
            // issue / attachment / group data — is annotated as unavailable right
            // here, so the picker never presents an option that silently won't
            // save. (The field-based trio now ships — its support is per FIELD,
            // annotated in the field picker below instead.)
            let meta = r.availability === "unavailable" ? "Use a Jira built-in" : undefined;
            if (mode === "condition" && !EXPRESSION_BACKED_CONDITIONS.includes(r.key)) {
              meta = "Not available as a condition";
            }
            return { value: r.key, label: r.label, meta };
          })}
        />
        {rule && !unavailable && <p className="hint">{rule.help}</p>}
      </div>

      {unavailable && (
        <div className="pr-note">{unavailableWhy}</div>
      )}

      {!unavailable && mode === "validator" && ruleType === "field-changed" && (
        <div className="pr-note">
          The field must be on this transition's screen. If it isn't, the transition is blocked for
          everyone, choose a field shown on the transition screen.
        </div>
      )}
      {!unavailable && mode === "validator" && ruleType === "comment-required" && (
        <div className="pr-note">
          The Comment field must be on this transition's screen, or no comment can be entered and it
          blocks for everyone.
        </div>
      )}
      {!unavailable && mode === "condition" && ruleType === "field-equals" && (
        <p className="hint">
          For a multi-value field like Labels, use “Field has a value” instead.
        </p>
      )}

      {!unavailable && p.field && (
        <div className="form-group">
          <label className="label">Field <span className="required">*</span></label>
          <CustomSelect
            value={fieldId}
            onChange={setFieldId}
            searchable
            placeholder="Choose a field…"
            options={fields.map((f) => {
              // Field conditions support only custom fields of live-verified
              // kinds — say so on the option itself, not after selection.
              let meta = f.id;
              if (isFieldCondition && conditionFieldSupport(f, ruleType).unsupported) {
                meta = "Not supported for conditions";
              }
              return { value: f.id, label: f.name, meta };
            })}
          />
          {fieldSupport?.unsupported && (
            <div className="pr-note">{fieldSupport.unsupported}</div>
          )}
        </div>
      )}

      {!unavailable && p.regex && (
        <div className="form-group">
          <label className="label">Pattern (regular expression) <span className="required">*</span></label>
          <input
            className="input pr-mono"
            placeholder="e.g. ^[A-Z]{2,4}-\d+$"
            value={regex}
            onChange={(e) => setRegex(e.target.value)}
          />
          {regexRisk && (
            <div style={{ marginTop: "6px", fontSize: "12px", fontWeight: 600, color: "var(--error-color)" }}>
              {regexRisk}
            </div>
          )}
        </div>
      )}

      {!unavailable && p.allowed && (
        <div className="form-group">
          <label className="label">
            Allowed values <span className="pr-opt">comma-separated</span> <span className="required">*</span>
          </label>
          <input
            className="input"
            placeholder="e.g. Approved, Signed off, Released"
            value={allowedValues}
            onChange={(e) => setAllowedValues(e.target.value)}
          />
        </div>
      )}

      {!unavailable && p.opValue && (
        <div className="pr-row2">
          <div className="form-group">
            <label className="label">Operator</label>
            <CustomSelect value={op} onChange={setOp} options={COMPARE_OPS} />
          </div>
          <div className="form-group">
            <label className="label">Value <span className="required">*</span></label>
            <input className="input" placeholder="e.g. 1" value={compareValue} onChange={(e) => setCompareValue(e.target.value)} />
          </div>
        </div>
      )}

      {!unavailable && p.value && (
        <div className="form-group">
          <label className="label">Value <span className="pr-opt">case-insensitive</span> <span className="required">*</span></label>
          <input className="input" placeholder="e.g. Approved" value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
      )}

      {!unavailable && p.lengthBounds && (
        <>
          <div className="pr-row2">
            <div className="form-group">
              <label className="label">Min <span className="pr-opt">optional</span></label>
              <input className={`input ${boundsInverted ? "input-error" : ""}`} type="number" min="0" placeholder="e.g. 10" value={minLen} onChange={(e) => setMinLen(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="label">Max <span className="pr-opt">optional</span></label>
              <input className={`input ${boundsInverted ? "input-error" : ""}`} type="number" min="0" placeholder="e.g. 255" value={maxLen} onChange={(e) => setMaxLen(e.target.value)} />
            </div>
          </div>
          {boundsInverted && <div className="br-hint">Min must not be greater than Max, a rule with Min above Max matches nothing and would block every transition.</div>}
        </>
      )}

      {!unavailable && p.dateRel && (
        <>
          <div className="pr-row2">
            <div className="form-group">
              <label className="label">Must be</label>
              <CustomSelect
                value={dateMode}
                onChange={setDateMode}
                options={[
                  { value: "future", label: "in the future" },
                  { value: "within", label: "within N days" },
                ]}
              />
            </div>
            {dateMode === "within" && (
              <div className="form-group">
                <label className="label">Days from today <span className="required">*</span></label>
                <input className="input" type="number" min="1" placeholder="e.g. 30" value={days} onChange={(e) => setDays(e.target.value)} />
              </div>
            )}
          </div>
          <p className="hint">Pick a date or date-time field above. Times are compared in UTC by calendar day.</p>
        </>
      )}

      {!unavailable && p.picker && (() => {
        const opts = lists[p.picker.source] || [];
        // A saved value missing from the freshly-fetched list (perms/pagination) would render as the
        // placeholder — keep it visible + selected so an edit doesn't look blank or lose the value.
        const shown = pickerValue && !opts.some((o) => o.value === pickerValue)
          ? [{ value: pickerValue, label: `${pickerValue} (saved)` }, ...opts]
          : opts;
        return (
          <div className="form-group">
            <label className="label">
              {p.picker.label} {p.picker.optional ? <span className="pr-opt">optional</span> : <span className="required">*</span>}
            </label>
            <CustomSelect
              value={pickerValue}
              onChange={setPickerValue}
              searchable
              options={shown}
              placeholder={listsError ? "Couldn't load options. Retry below" : (!opts.length ? "None available, check your permissions" : p.picker.ph)}
            />
            {listsError && (
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "6px", fontSize: "12px", color: "var(--error-color)" }}>
                <span>Couldn't load these options.</span>
                <button type="button" className="btn-retry" onClick={loadLists}>Retry</button>
              </div>
            )}
          </div>
        );
      })()}

      {/* ---- the GIT param group (F-350) ------------------------------------------
          Connection → repository → what counts as "the" pull request → strict. Both
          identifiers are PICKED, never typed, because the two ways they can be wrong
          (a connection that no longer exists, a repo off its allow-list) fail CLOSED
          at the transition whatever `strict` says. No native select, no rail, no tint:
          solid chips, a solid segmented control, and a solid red block for a dead
          credential — the same treatment the admin Code tab gives it. */}
      {/* ---- the CODER mode (F-388) ------------------------------------------------
          The same segmented control the prMatch group uses, because it is the same kind
          of question: a short, closed list where every option must be readable at once.
          The chosen mode's `help` is the hint below it, from the ONE table in
          premade-rules-catalog.js — the words the Coder is actually instructed with.
          Solid, no rail, no tint, no native select. */}
      {!unavailable && p.coderMode && (
        <div className="form-group">
          <label className="label">What the Coder does <span className="required">*</span></label>
          <div className="pr-seg pr-seg-wrap pr-seg-coder" role="radiogroup" aria-label="What the Coder does">
            {CODER_PF_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={coderMode === m.id}
                className={`pr-seg-btn${coderMode === m.id ? " active" : ""}`}
                onClick={() => setCoderMode(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="hint">
            {getCoderPfMode(coderMode)
              ? getCoderPfMode(coderMode).help
              : "Pick what this transition hands the Coder. Nothing runs until one is chosen."}
          </p>
        </div>
      )}

      {/* ---- the Coder's extra instructions (F-388) --------------------------------
          UNTRUSTED text. It is clamped here, clamped again in the saved config, and
          fenced + defanged as DATA by renderCoderPfMessage (src/index.js) — the counter
          exists so the admin sees the clamp before it silently takes their last
          paragraph away. */}
      {!unavailable && p.instructions && (
        <div className="form-group">
          <label className="label">Extra instructions <span className="pr-opt">optional</span></label>
          <textarea
            className="input pr-coder-notes"
            rows={4}
            maxLength={CODER_PF_INSTRUCTIONS_MAX}
            placeholder={hasConfluenceGroup(p)
              ? "Anything the page should say or avoid: the sections it must have, the audience, a house style to follow."
              : "Anything the Coder should know about this repository: the test command, a coding standard, a directory to stay out of."}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value.slice(0, CODER_PF_INSTRUCTIONS_MAX))}
          />
          <div className="pr-coder-count">
            <span className={instructions.length >= CODER_PF_INSTRUCTIONS_MAX ? "pr-coder-count-full" : ""}>
              {instructions.length} / {CODER_PF_INSTRUCTIONS_MAX}
            </span>
          </div>
          <p className="hint">
            {hasConfluenceGroup(p)
              ? "The page's author reads this as a note from you. It never changes where the page is written or what the rule is allowed to do."
              : "The Coder reads this as a note from you, never as permission to do more than the mode above allows."}
          </p>
        </div>
      )}

      {/* ---- the Coder's SKILLS (F-463) --------------------------------------------
          The same hand-rolled multi-select the Coder panel's composer uses: one solid chip
          per skill, the pressed state on aria-pressed, never a native select and never a
          checkbox. The chosen chips are the skills hue #7c3aed (dark #8b5cf6) with white
          text; the rest carry a full border. Optional: a Coder rule with no skills is a
          valid rule, so nothing here can make the form invalid. */}
      {!unavailable && p.skillIds && skillRows.length > 0 && (
        <div className="form-group">
          <label className="label">Skills <span className="pr-opt">optional</span></label>
          <div className="pr-skill-list" role="group" aria-label="Skills for this rule">
            {skillRows.map((sk) => {
              const on = skillIds.includes(sk.id);
              return (
                <button
                  key={sk.id}
                  type="button"
                  className={`pr-skill-chip${on ? " is-on" : ""}`}
                  aria-pressed={on}
                  onClick={() => toggleRuleSkill(sk.id)}
                  disabled={!on && skillIds.length >= MAX_RULE_SKILLS}
                >
                  {sk.name}
                </button>
              );
            })}
          </div>
          <p className="hint">
            {skillIds.length >= MAX_RULE_SKILLS
              ? `That is the most a turn can carry: ${MAX_RULE_SKILLS} skills. Unpick one to choose another.`
              : `Up to ${MAX_RULE_SKILLS} skills ride every run of this rule. They are instructions for the Coder, never permission to do more than the mode above allows.`}
          </p>
        </div>
      )}

      {!unavailable && hasGitGroup(p) && (
        <>
          <div className="form-group">
            <label className="label">Git connection <span className="required">*</span></label>
            <CustomSelect
              value={connectionId}
              onChange={(v) => { setConnectionId(v); setRepo(""); }}
              searchable
              placeholder={gitConnections.length ? "Choose a git connection…" : "No git connections, an admin adds them under Apps, CogniRunner, Code"}
              options={gitConnections.map((c) => ({
                value: c.id,
                label: c.label || c.id,
                // CustomSelect renders text, not markup, so the KIND rides the option as
                // `type` and the solid chip is drawn for the CHOSEN row below. Widening
                // CustomSelect to take JSX would fork a deliberately-diverged component.
                type: c.kind ? gitProviderKindMeta(c.kind).label : undefined,
                meta: c.status === "auth_dead" ? "credential dead" : undefined,
              }))}
            />
            {gitConn && (
              <div className="pr-git-chosen">
                {gitConn.kind && (
                  <span className={`pr-git-kind pr-git-kind-${gitProviderKindMeta(gitConn.kind).id}`}>
                    {gitProviderKindMeta(gitConn.kind).label}
                  </span>
                )}
                <span className="pr-git-chosen-label">{gitConn.label || gitConn.id}</span>
              </div>
            )}
            {gitConnDead && (
              /* Solid red, white text, loud — a dead credential means every rule on this
                 connection has silently stopped, which must never be whispered. Same words
                 and same weights as the Code tab's `.code-dead`; a separate class because
                 this component is byte-copied into admin-panel, where `.code-dead` already
                 has its own home in injectStyles() and a second copy would be one rule in
                 two places. */
              <div className="pr-git-dead" role="alert">
                <span className="pr-git-dead-title">This credential is dead</span>
                <span className="pr-git-dead-text">
                  {gitConn.authDeadReason || "The provider rejected it."} This rule cannot check anything until an admin replaces the credential under Apps, CogniRunner, Code.
                </span>
              </div>
            )}
          </div>

          <div className="form-group">
            <label className="label">Repository <span className="required">*</span></label>
            <CustomSelect
              value={repo}
              onChange={setRepo}
              searchable
              placeholder={
                !connectionId ? "Choose a connection first…"
                  : gitRepoOptions.length ? "Choose a repository…"
                  : "This connection allows no repositories"
              }
              options={gitRepoOptions.map((r) => ({ value: r, label: r }))}
            />
            {connectionId && !reposNarrowed && (
              <p className="hint">
                {gitRefused
                  ? "You are not a CogniRunner admin, so this list is every repository across all connections rather than just this one's."
                  : "The per-connection repository list could not be read, so this list is every repository across all connections."}
                {" "}If the repository is not on this connection's allow-list, the transition is blocked until an admin adds it.
              </p>
            )}
          </div>

          {/* prMatch is drawn ONLY for the rules that read it. The Coder post-function
              switches it off (`git: { prMatch: false }`) because it locates its own pull
              request from the mode's instruction — a control here would be a promise the
              executor never keeps. */}
          {gitSubEnabled(p, "prMatch") && (
          <div className="form-group">
            <label className="label">Which pull request counts</label>
            <div className="pr-seg" role="radiogroup" aria-label="Which pull request counts">
              {PR_MATCH_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={prMatch === o.value}
                  className={`pr-seg-btn${prMatch === o.value ? " active" : ""}`}
                  onClick={() => setPrMatch(o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <p className="hint">{(PR_MATCH_OPTIONS.find((o) => o.value === prMatch) || PR_MATCH_OPTIONS.find((o) => o.value === PR_MATCH_DEFAULT)).hint}</p>
          </div>
          )}

          {gitSubEnabled(p, "strict") && (
          <div className="form-group">
            <label className="pr-git-toggle-row">
              <input type="checkbox" checked={strict} onChange={(e) => setStrict(e.target.checked)} />
              <span className="pr-git-toggle-label">Strict</span>
            </label>
            {/* A post-function runs AFTER the transition is applied, so nothing it does can
                block anything — for that half, `strict` chooses between a red execution-log
                entry and a quiet skip. These are the two columns of the fail-open/fail-closed
                table beside enqueueCoderPostFunction (src/index.js); if that table changes,
                these sentences change in the same commit. */}
            <p className="hint">
              {mode === "postfunction"
                ? (strict
                  ? "If the connection, its token or the git capability is unavailable, the run is recorded as a FAILURE for an admin to act on."
                  : "If the connection, its token or the git capability is unavailable, the run is recorded as a skip that says why. Nothing is written.")
                : (strict
                  ? "If GitHub or Bitbucket cannot be reached, the transition is blocked until the connection works again."
                  : "If GitHub or Bitbucket cannot be reached, the transition is allowed and a banner shows why.")}
            </p>
          </div>
          )}
        </>
      )}

      {/* ---- the CONFLUENCE param group (F-447) -----------------------------------
          Space -> what to look for (or what to write) -> strict. Mirrors the git group
          above deliberately: the identifier is PICKED and never typed, the closed choice
          is the app's own segmented control rather than a native select, and the Strict
          copy is the F-416 degradation table put into words. Solid colours, no rail, no
          tint. Every control here is drawn only when `confluenceSubEnabled` says this
          rule HAS it, so the form can never offer a key the executor ignores (F-388). */}
      {!unavailable && hasConfluenceGroup(p) && (() => {
        const spaces = lists.confluencespaces || [];
        // A saved space missing from a freshly-fetched list stays visible and selected,
        // exactly like the generic picker above: an edit must not look blank.
        const spaceOptions = spaceKey && !spaces.some((o) => o.value === spaceKey)
          ? [{ value: spaceKey, label: `${spaceKey} (saved)` }, ...spaces]
          : spaces;
        // The live example. Rendered through the SAME two renderers the run time uses,
        // on one sample issue, so a reader sees the quoting rather than being told about
        // it: cqlQuote turns a summary into a complete quoted literal, and a title is
        // substituted raw because a title is not a query.
        const sample = { issueKey: "ACME-42", summary: 'Payment retry "fails" on 3DS' };
        const cqlExample = cqlTemplate.trim() ? renderCqlTemplate(cqlTemplate.trim(), sample) : null;
        const titleExample = renderTextTemplate(titleTemplate.trim() || CONFLUENCE_DEFAULT_TITLE_TEMPLATE, sample, TITLE_MAX_CHARS);
        const commentExample = commentTemplate.trim()
          ? renderTextTemplate(commentTemplate.trim(), sample, COMMENT_TEMPLATE_MAX_CHARS) : "";
        const legend = (
          <p className="hint">
            <code className="pr-conf-ph">{"{issueKey}"}</code>
            <code className="pr-conf-ph">{"{summary}"}</code>
            <code className="pr-conf-ph">{"{field:<id>}"}</code>
            are replaced with this issue's values.
          </p>
        );
        return (
          <>
            {confluenceSubEnabled(p, "spaceKey") && (
              <div className="form-group">
                <label className="label">Confluence space <span className="required">*</span></label>
                <CustomSelect
                  value={spaceKey}
                  onChange={setSpaceKey}
                  searchable
                  options={spaceOptions}
                  placeholder={listsError
                    ? "Couldn't load spaces - Retry below"
                    : (!spaces.length ? "No Confluence spaces - install CogniRunner on Confluence, or check its access" : "Choose a Confluence space\u2026")}
                />
                {/* F-915 - A DISABLED PICKER IS NOT AN ANSWER. With no spaces the reader
                    saw an empty control and a placeholder, which reads as "this app is
                    broken" rather than "one install is missing". The card says what is
                    missing and who fixes it, in the SAME words the runtime refusal uses
                    (src/shared/confluence-rules.js, read by src/premade-rules.js too), so
                    a designer and an operator are never told two different things.
                    Solid slate, white text, no rail and no tint; it is a STATEMENT, not a
                    failure, so it is not the red one errors use. */}
                {!listsError && !spaces.length && (
                  <div className="pr-conf-missing" role="note">
                    <span className="pr-conf-missing-title">{CONFLUENCE_NOT_INSTALLED}</span>
                    <span className="pr-conf-missing-text">
                      {CONFLUENCE_INSTALL_REMEDY} This rule cannot be saved until a space can be picked.
                    </span>
                    {/* F-958 - "Apps, Manage apps" was prose only, so the reader had to go
                        hunting for a page this app knows the address of. Site-relative
                        path from src/shared/manage-apps.js, new tab, and only when the
                        context gave us an origin. */}
                    {manageAppsUrl(siteUrl) && (
                      <a
                        className="pr-conf-missing-link"
                        href={manageAppsUrl(siteUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => { e.preventDefault(); router.open(manageAppsUrl(siteUrl)); }}
                      >
                        Open Manage apps
                      </a>
                    )}
                  </div>
                )}
                {listsError && (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "6px", fontSize: "12px", color: "var(--error-color)" }}>
                    <span>Couldn't load the space list.</span>
                    <button type="button" className="btn-retry" onClick={loadLists}>Retry</button>
                  </div>
                )}
                <p className="hint">The space is picked, never typed: a space this app cannot see is a misconfiguration, and a misconfigured rule blocks the transition whatever Strict says.</p>
              </div>
            )}

            {confluenceSubEnabled(p, "mode") && (
              <div className="form-group">
                <label className="label">What counts as a pass</label>
                <div className="pr-seg pr-seg-wrap pr-seg-conf" role="radiogroup" aria-label="What counts as a pass">
                  {CONFLUENCE_VALIDATOR_MODES.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      role="radio"
                      aria-checked={confMode === m.value}
                      className={`pr-seg-btn${confMode === m.value ? " active" : ""}`}
                      onClick={() => setConfMode(m.value)}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <p className="hint">{(CONFLUENCE_VALIDATOR_MODES.find((m) => m.value === confMode) || CONFLUENCE_VALIDATOR_MODES[0]).hint}</p>
              </div>
            )}

            {confluenceSubEnabled(p, "cqlTemplate") && (
              <div className="form-group">
                {/* F-958 - the route OUT of CQL, on the field that demands it. The
                    builder writes this template from a plain-English description, and
                    until now nothing on this required field said so. Solid indigo button,
                    white text, no rail and no tint. Only on the halves that actually draw
                    the builder (it is not rendered for post-functions). */}
                <div className="pr-conf-cql-head">
                  <label className="label">Which page to look for <span className="required">*</span></label>
                  {mode !== "postfunction" && (
                    <button type="button" className="pr-describe-btn" onClick={openBuilderForCql}>
                      Describe the page instead
                    </button>
                  )}
                </div>
                <textarea
                  className="input pr-conf-tpl"
                  rows={3}
                  maxLength={CQL_MAX_CHARS}
                  placeholder={'title ~ {issueKey} OR text ~ {summary}'}
                  value={cqlTemplate}
                  onChange={(e) => setCqlTemplate(e.target.value.slice(0, CQL_MAX_CHARS))}
                />
                {legend}
                {cqlExample && (
                  <div className="pr-conf-example">
                    <span className="pr-conf-example-label">For ACME-42 this searches</span>
                    <code className="pr-conf-example-text">{cqlExample.ok ? cqlExample.cql : cqlExample.reason}</code>
                  </div>
                )}
                <p className="hint">The space is added for you. Write <code>title ~ {"{summary}"}</code>, never <code>title ~ "{"{summary}"}"</code>: each value arrives already quoted.</p>
              </div>
            )}

            {confluenceSubEnabled(p, "prompt") && confMode === "semantic" && (
              <div className="form-group">
                <label className="label">What the page must say <span className="required">*</span></label>
                <textarea
                  className="input pr-conf-tpl"
                  rows={3}
                  maxLength={CQL_MAX_CHARS}
                  placeholder="The page must describe the rollback plan and name an owner."
                  value={confPrompt}
                  onChange={(e) => setConfPrompt(e.target.value.slice(0, CQL_MAX_CHARS))}
                />
                <p className="hint">The top 3 matching pages are read and judged against this. One AI call per transition.</p>
              </div>
            )}

            {confluenceSubEnabled(p, "titleTemplate") && (
              <div className="form-group">
                <label className="label">Page title <span className="pr-opt">optional</span></label>
                <input
                  className="input"
                  maxLength={TITLE_MAX_CHARS}
                  placeholder={`Default: ${CONFLUENCE_DEFAULT_TITLE_TEMPLATE}`}
                  value={titleTemplate}
                  onChange={(e) => setTitleTemplate(e.target.value.slice(0, TITLE_MAX_CHARS))}
                />
                {legend}
                <div className="pr-conf-example">
                  <span className="pr-conf-example-label">For ACME-42 the page is titled</span>
                  <code className="pr-conf-example-text">{titleExample}</code>
                </div>
                <p className="hint">The title is the page's identity: the rule updates the page it wrote before rather than creating a second one.</p>
              </div>
            )}

            {confSourceField && (
              <div className="form-group">
                <label className="label">Source field <span className="pr-opt">optional</span></label>
                <CustomSelect
                  value={fieldId}
                  onChange={setFieldId}
                  searchable
                  options={fields.map((f) => ({ value: f.id, label: f.name }))}
                  placeholder="Description (the default)"
                />
                <p className="hint">The field the page body is written from. Left empty, the rule reads the issue's Description.</p>
              </div>
            )}

            {confluenceSubEnabled(p, "parentId") && (
              <div className="form-group">
                <label className="label">Parent page (id from the page URL) <span className="pr-opt">optional</span></label>
                <input
                  className="input pr-mono"
                  placeholder="e.g. 393217"
                  value={parentId}
                  onChange={(e) => setParentId(e.target.value)}
                />
                <p className="hint">
                  {parentId.trim() && !/^[0-9]{1,32}$/.test(parentId.trim())
                    ? "A parent page id is the number in the page's URL - digits only."
                    : "New pages are created under this page. Open the parent in Confluence and copy the number out of its URL (.../pages/393217/...). Leave it empty to create them at the top of the space."}
                </p>
              </div>
            )}

            {confluenceSubEnabled(p, "commentTemplate") && (
              <div className="form-group">
                <label className="label">Comment text <span className="required">*</span></label>
                <textarea
                  className="input pr-conf-tpl"
                  rows={3}
                  maxLength={COMMENT_TEMPLATE_MAX_CHARS}
                  placeholder={"{issueKey} moved on: {summary}"}
                  value={commentTemplate}
                  onChange={(e) => setCommentTemplate(e.target.value.slice(0, COMMENT_TEMPLATE_MAX_CHARS))}
                />
                {legend}
                {commentExample && (
                  <div className="pr-conf-example">
                    <span className="pr-conf-example-label">For ACME-42 the comment reads</span>
                    <code className="pr-conf-example-text">{commentExample}</code>
                  </div>
                )}
                <p className="hint">No AI and no token cost: your text with the issue's values filled in.</p>
              </div>
            )}

            {/* Strict, on the rules the catalogue gives it: the VALIDATOR. Both Confluence
                post-functions switch it off, because the choice strict offers - block or
                allow - does not exist once the transition has happened. */}
            {confluenceSubEnabled(p, "strict") && (
              <div className="form-group">
                <label className="pr-git-toggle-row">
                  <input type="checkbox" checked={strict} onChange={(e) => setStrict(e.target.checked)} />
                  <span className="pr-git-toggle-label">Strict</span>
                </label>
                {/* The two columns of the F-416 degradation table beside
                    runConfluenceValidator (src/premade-rules.js). If that table changes,
                    these sentences change in the same commit. */}
                <p className="hint">
                  {strict
                    ? "If Confluence cannot be checked - not installed, access refused, unreachable, too slow, or the AI judge unavailable in Semantic mode - the transition is BLOCKED and the message names the cause."
                    : "If Confluence cannot be checked - not installed, access refused, unreachable, too slow, or the AI judge unavailable in Semantic mode - the transition is ALLOWED and a banner in the execution log says why."}
                </p>
                <p className="hint pr-conf-misconfig">
                  Strict changes nothing about an incomplete rule: a missing space or template blocks the transition in both modes.
                </p>
              </div>
            )}
          </>
        );
      })()}

      {!unavailable && mode === "validator" && (
        <div className="form-group">
          <label className="label">Error message <span className="pr-opt">shown to the user if blocked</span></label>
          <input
            className="input"
            placeholder={`Default: “${fieldName || "This field"} …”`}
            value={errorMessage}
            onChange={(e) => setErrorMessage(e.target.value)}
          />
        </div>
      )}

      {!unavailable && !valid && ruleType && <p className="hint">Fill in the rule's details to finish.</p>}

      <p className="hint pr-foot">
        {/* F-915 - THE FOOTER IS PER RULE, NOT PER MODE. It was keyed on "is this a
            post-function", so the two CONFLUENCE post-functions were told, in the app's
            own voice, that "the Coder works in the background for several minutes" - about
            a rule the Coder has nothing to do with. The sentence now comes from the
            catalogue row's own foot, which is the same file that already owns the rule's
            label and its help, and the mode-wide sentence is only the fallback for a row
            that has not been given one. */}
        {mode === "postfunction"
          ? (rule && rule.foot)
            || "This runs AFTER the transition, so it never blocks anyone."
          : mode === "condition"
          ? "If the rule isn't met, the transition is hidden (no message). If the check can't run, the transition is shown (it never silently hides one). No AI is used."
          // F-958 - the CONFLUENCE group carries its own Strict paragraph, beside the
          // checkbox, stating BOTH columns of the degradation table. Repeating the same
          // fail-open/fail-closed sentence down here made one screen say the rule's
          // behaviour three times over. The footer keeps only what the Strict paragraph
          // does not say: what happens on a plain fail, and the AI cost of Semantic mode.
          : hasConfluenceGroup(p)
          ? `If the rule isn't met, the transition is blocked and your message is shown.${confMode === "semantic" ? " Semantic mode uses one AI call per transition." : " No AI is used."}`
          : hasGitGroup(p) && strict
          // Strict is the admin opting OUT of the app-wide fail-OPEN contract for this one
          // rule, so the footer must stop promising the opposite (it is the sentence a
          // reader trusts when the gate starts refusing during an outage).
          ? `If the rule isn't met, the transition is blocked and your message is shown. Strict is on, so the transition is also blocked while ${hasConfluenceGroup(p) ? "Confluence" : "the provider"} can't be reached.${hasConfluenceGroup(p) && confMode === "semantic" ? " Semantic mode uses one AI call per transition." : " No AI is used."}`
          : `If the rule isn't met, the transition is blocked and your message is shown. If the check can't run, the transition is allowed (it never traps the issue).${hasConfluenceGroup(p) && confMode === "semantic" ? " Semantic mode uses one AI call per transition." : " No AI is used."}`}
      </p>
    </div>
  );
}
