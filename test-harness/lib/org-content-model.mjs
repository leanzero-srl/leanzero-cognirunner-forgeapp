/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import {createHash} from 'node:crypto';
const hash=s=>createHash('sha256').update(s).digest('hex');
const demand=(v,m)=>{if(!v)throw Error(m);};
// Authored synthetic business cases. No AI calls, credentials or tenant writes.
const DOMAINS={
  'apex-coresystems':[
    ['Preserve request identity across gateway retries','the proxy regenerates a request identifier after an upstream timeout','compare gateway traces with the downstream idempotency ledger','reuse the original identity across the retry boundary','one logical request creates one downstream record'],
    ['Restore least-privilege access after a team transfer','a role inherited from the previous team remains effective','compare effective access with the approved ownership matrix','remove the obsolete inheritance and retain the current team grant','the former entitlement is denied and the current entitlement succeeds'],
    ['Reconcile usage charges at the billing boundary','late usage arrives after the monthly aggregation watermark','match raw metering events to adjustment entries','apply a dated adjustment with a reference to the original period','the usage ledger and invoice delta reconcile without changing settled lines'],
    ['Recover a deployment after an incompatible configuration change','the service starts with a configuration schema from the next release','compare the deployed artifact, schema revision and startup trace','pin the compatible schema and exercise the documented rollback','the previous release starts cleanly and existing sessions remain usable'],
    ['Separate service noise from actionable latency alerts','a scheduled export inflates the shared latency percentile','compare interactive and background request distributions','split the alert population by workload and retain both dashboards','interactive degradation still pages the owner while the export is observable'],
    ['Retain API compatibility during a consumer migration','one consumer still omits a field introduced in the newer contract','replay signed contract fixtures from both consumer versions','accept the earlier payload while recording its deprecation usage','both contracts pass and the migration report identifies remaining consumers'],
  ],
  'beacon-logistics':[
    ['Resolve a cold-chain excursion during depot handover','the logger records a temperature spike while a pallet waits outside controlled storage','align logger readings with the dock scan and handover record','quarantine the affected lot and document the release decision','every affected shipment has a traceable disposition and an accountable reviewer'],
    ['Remove duplicate carrier milestones from shipment tracking','the carrier resends an event after its acknowledgement is delayed','compare carrier event identifiers with the tracking timeline','deduplicate by carrier identity while retaining the original event timestamp','a replay leaves one milestone and does not move the promised delivery date'],
    ['Release a customs hold with a corrected commodity declaration','the declaration uses a code from a superseded product classification','compare the packing list, tariff decision and submitted declaration','prepare the corrected declaration with the supporting classification evidence','the broker reference and release decision agree with the shipment contents'],
    ['Recover missed delivery windows on a constrained route','an upstream depot dispatch exceeds the planned loading window','compare dispatch scans, driving constraints and receiving hours','resequence the remaining stops and record accepted customer windows','the revised route respects driving limits and has no unacknowledged window changes'],
    ['Reconcile a warehouse transfer with a missing receipt scan','the destination receipt was recorded against the wrong handling unit','match origin dispatch, seal identity and destination stock movement','correct the receipt linkage while preserving the original audit reference','physical quantity and stock ledger agree for both locations'],
    ['Prevent a fleet service interval from slipping between planners','the odometer update arrives after the nightly planning cut-off','compare telematics readings with the maintenance due calculation','recalculate the service window and reserve an available vehicle','the vehicle is withdrawn before its limit and the route retains required capacity'],
  ],
  'factory-liberation':[
    ['Contain a batch with an out-of-tolerance measurement','a gauge drift changes the measured dimension near the acceptance limit','compare retained samples with the reference instrument and calibration history','hold the affected batch and define the reinspection boundary','released units have independent measurements within the approved tolerance'],
    ['Recover a line after intermittent sensor loss','the connector loses continuity during the high-vibration phase','align stoppage timestamps with vibration and signal-loss traces','replace the suspect connection and repeat the operating cycle','the line completes the verification run without a missed interlock'],
    ['Trace a supplier deviation through work in progress','a supplier lot was consumed before the revised certificate arrived','link receipt batches to production orders and finished unit serials','isolate the affected serial range and obtain the corrected evidence','every consumed unit has a disposition linked to its source lot'],
    ['Correct packaging instructions for a mixed-language shipment','the print job inherits the previous market template','compare the order market, label proof and scanned packaging code','bind the packaging template to the current market configuration','sample packs match the approved language and safety markings'],
    ['Validate a tooling change before increasing the production rate','the new tool changes the process window near the thermal limit','compare trial dimensions, cycle time and tool temperature','run a controlled qualification at the proposed rate','the process stays inside its approved window for the complete sample set'],
    ['Reduce unexplained energy consumption during idle periods','an auxiliary circuit remains energized after the shutdown sequence','compare meter intervals with the machine-state and isolation logs','correct the idle sequence and retain required safety circuits','idle demand decreases while restart and safety checks remain valid'],
  ],
  'krypton-cybersec':[
    ['Contain a suspicious sign-in without disrupting the investigation','a newly observed device reuses a valid session from a distant location','correlate identity events, session age and endpoint evidence','revoke the affected session and preserve the relevant event references','the session is unusable and the evidence timeline remains complete'],
    ['Prioritize an exposed dependency with a reachable vulnerable path','the packaged dependency differs from the version recorded in the inventory','compare the deployed digest, dependency tree and reachable endpoint','patch the deployed package and verify the vulnerable execution path','the exact deployed artifact no longer exposes the affected behavior'],
    ['Prove restoration of a critical service from an isolated backup','a backup completed but its recovery permissions were never exercised','compare backup manifests with restoration logs and integrity checks','restore into an isolated environment using the documented recovery identity','service data reconciles and recovery time is measured from the actual exercise'],
    ['Close an excessive entitlement discovered in a periodic review','a temporary administrative grant has no recorded expiry','compare grant history with the approved task and current ownership','remove the expired grant and verify required ordinary access','administrative operations are denied while the legitimate task remains possible'],
    ['Resolve an evidence gap before a control review','the control statement references an obsolete test execution','trace the statement to the current system boundary and test artifacts','repeat the scoped control test and link the new observations','the review can independently reproduce the stated control outcome'],
    ['Reduce false positives without suppressing a real detection path','a scheduled support action matches the generic intrusion sequence','compare benign support traces with the adversarial control sample','narrow the detection exception to the approved identity and activity window','the benign control is quiet and the adversarial control still raises an alert'],
  ],
  'solace-ai-labs':[
    ['Explain a quality regression on an underrepresented evaluation slice','the aggregate score hides a decline in a small language cohort','compare per-slice predictions, sample weights and adjudicated examples','expand the affected slice and rerun the fixed evaluation protocol','the decision reports uncertainty and the affected cohort separately'],
    ['Prevent training leakage through a near-duplicate source document','a transformed copy of an evaluation document enters the training corpus','compare provenance identifiers and content similarity results','remove the contaminated lineage and rebuild the affected split','no evaluation lineage is present in training and split counts reconcile'],
    ['Measure serving latency under a mixed request population','long-context requests monopolize the shared execution queue','compare queue delay, input size and completion latency by cohort','test a bounded admission policy with the same request replay','latency and throughput are reported together without dropping difficult requests'],
    ['Resolve disagreement in an annotation guideline','two valid interpretations produce inconsistent labels at a category boundary','review blinded examples and each annotator rationale','clarify the boundary with counterexamples and re-adjudicate the disputed slice','the revised guideline produces consistent decisions on held-out examples'],
    ['Validate retrieval grounding after a document refresh','the index retains chunks from a superseded policy revision','compare retrieved chunk identities with the current document manifest','rebuild the changed lineage and rerun grounded answer checks','answers cite current passages and abstain when the required evidence is absent'],
    ['Reproduce a promising experiment before committing compute','the saved configuration omits a preprocessing option used in the trial','compare recorded parameters, dataset checksums and execution manifests','reconstruct the trial with a complete immutable manifest','an independent run reproduces the result within the stated uncertainty'],
  ],
  'strata-datalabs':[
    ['Reconcile late source events across a warehouse partition boundary','the watermark advances before delayed source events are committed','compare source offsets, landing records and warehouse reconciliation totals','reprocess the affected interval with a stable event identity','source and warehouse totals agree without duplicate business records'],
    ['Restore a data contract after an upstream schema change','a nullable source field becomes mandatory without a versioned contract','compare producer payloads with consumer validation failures','publish a compatible contract and backfill the missing values','current and previous consumer versions pass their contract fixtures'],
    ['Explain a dashboard discrepancy at a reporting cut-off','the dashboard and ledger apply different time-zone boundaries','compare the underlying row population and business date rules','align the reporting boundary and document the affected period','the dashboard reconciles to the ledger for the same population'],
    ['Repair incomplete lineage for a derived sensitive attribute','a transformation introduces a field without inheriting its source classification','trace the transformation inputs and catalog ownership records','restore lineage and apply the approved classification to the derived field','the catalog identifies both the source and every downstream use'],
    ['Verify a retention change across active and archived storage','the archive lifecycle uses a different retention calculation','compare active object dates with archive lifecycle decisions','align the lifecycle policy and test both sides of the retention boundary','eligible objects expire and retained records remain retrievable'],
    ['Recover a stream consumer after a partial checkpoint commit','the checkpoint advances while one destination write remains uncommitted','compare checkpoint positions with destination event identities','replay from the last consistent boundary using idempotent writes','all source events appear once in the destination reconciliation'],
  ],
  wolfaenpak:[
    ['Verify transition enforcement against incomplete release evidence','the release request omits the rollback observation required by policy','compare the transition input with the agreed release checklist','supply independently verifiable recovery evidence before resubmitting','the incomplete request is refused and the complete control can proceed'],
    ['Restore ownership context on a newly created work step','a child issue is created without the responsible owner and review date','compare the parent context with the child fields before execution','inherit only missing values and preserve any deliberate child override','the child receives missing context and a replay leaves existing values unchanged'],
    ['Prevent duplicate follow-up work during transition replay','a client retries a transition after losing the completion response','compare the source admission, identity labels and generated issue links','reconcile the original result before allowing another creation attempt','one reserved follow-up exists and its source relationship is intact'],
    ['Distinguish an automation failure from a successful no-op','the rule completes without changing a field because its source is absent','compare execution logs with independent before-and-after field reads','record the missing-source outcome and retain the previous target value','the log explains the skip and the target remains unchanged'],
    ['Validate a change window across calendar boundaries','the calculated review date depends on execution time rather than the native due date','compare the source date with results around a month-end boundary','derive the review deadline from the documented source in UTC','the date is stable across retries and matches the stated calendar offset'],
    ['Recover a service handover with contradictory acceptance evidence','the handover summary claims completion while the attached observations show an open failure','compare the summary with the test record and outstanding action owner','correct the decision brief and retain the unresolved caveat','the decision states the observed result without claiming unperformed work'],
  ],
  'leanzero-apps-demo':[
    ['Resolve a launch dependency before committing the baseline','a supplier milestone finishes after the dependent integration window','compare the dependency chain, remaining effort and available working days','evaluate a revised sequence and retain the current baseline for comparison','the proposed dates respect dependencies and expose the remaining schedule risk'],
    ['Protect a reviewed control attachment from an untracked replacement','a revised attachment arrives after the review decision was recorded','compare the sealed attachment identity with the replacement request','route the proposed revision through the documented review process','the original reviewed evidence remains identifiable and the revision has its own decision'],
    ['Verify workflow evidence before a release handover','the request describes an intended check without its observed outcome','compare the acceptance criterion with the submitted test observations','complete the missing observation and resubmit the evidence','the rule distinguishes the unsupported claim from the completed evidence'],
    ['Reconcile an upgrade plan after a changed cutover constraint','the approved maintenance window moves while dependent tasks retain their earlier dates','compare the cutover fields, dependency links and baseline variance','build an alternative schedule using the revised working window','the alternative is traceable to the original baseline and does not hide delayed tasks'],
    ['Capture a service recovery decision with the supporting record','the operational decision refers to an attachment from a previous incident','compare the incident chronology with the current recovery evidence','link the correct record and request a fresh review of the decision','the reviewer can trace every decision statement to the current incident'],
    ['Turn a research finding into a bounded delivery experiment','the initial result is promising but its deployment assumptions are untested','compare the experiment manifest with delivery and support constraints','define a limited pilot with measurable acceptance and a recovery path','the pilot decision separates observed benefits from untested assumptions'],
  ],
};
const para=text=>({type:'paragraph',content:[{type:'text',text}]});
const heading=text=>({type:'heading',attrs:{level:2},content:[{type:'text',text}]});
const day=n=>new Date(Date.UTC(2026,8,10+n)).toISOString().slice(0,10);
function shuffle(rows,seed){return rows.map((row,i)=>({row,rank:hash(seed+':'+i)})).sort((a,b)=>a.rank.localeCompare(b.rank)).map(x=>x.row);}

export function buildPopulation(plan,siteName,projectKey){
  const site=plan.sites.find(s=>s.site===siteName),project=site?.projects.find(p=>p.key===projectKey);
  demand(site&&project&&DOMAINS[siteName.replace('.atlassian.net','')],'Unapproved content target');
  demand(project.existingOwnedIssues===0,'Existing campaign enrichment requires its independent baseline');
  const rows=[];let sequence=0;
  for(const wf of project.workflows){
    const states={...project.workflowStateCounts[wf.id]};
    for(const reserved of Object.values(project.reservedGeneratedStates||{}))if(reserved.workflow===wf.id)states[reserved.state]-=reserved.count;
    demand(Object.values(states).every(n=>Number.isInteger(n)&&n>=0),'Invalid reserved state allocation');
    const slots=shuffle(Object.entries(states).flatMap(([state,n])=>Array(n).fill(state)),siteName+'/'+wf.id);
    const types=shuffle(wf.issueTypes.flatMap(type=>Array(project.initialSeedByType[type]).fill(type)),wf.id+'/types');
    demand(slots.length===types.length,'Type and state allocation disagree');
    types.forEach((type,i)=>rows.push({identity:`${projectKey}:seed:${++sequence}`,projectKey,type,workflowId:wf.id,family:wf.family,state:slots[i],ordinal:sequence}));
  }
  demand(rows.length+project.reservedGeneratedIssues===project.issueTarget,'Population total disagrees with approved target');
  const catalogue=Object.fromEntries(site.issueTypeCatalogue.map(t=>[t.name,t]));
  const epics=rows.filter(r=>r.type==='Epic');
  const standards=rows.filter(r=>r.type!=='Epic'&&r.type!=='Sub-task'&&catalogue[r.type]?.hierarchyLevel!==-1);
  demand(standards.length,'No standard parent population');
  for(const row of rows){
    row.subtask=row.type==='Sub-task'||catalogue[row.type]?.hierarchyLevel===-1;
    if(row.subtask)row.parentIdentity=standards[row.ordinal%standards.length].identity;
    else if(row.type!=='Epic'&&epics.length&&row.ordinal%5!==0)row.parentIdentity=epics[row.ordinal%epics.length].identity;
  }
  return {site:siteName,project:projectKey,rows:rows.sort((a,b)=>(a.type==='Epic'?0:a.subtask?2:1)-(b.type==='Epic'?0:b.subtask?2:1)),reservedGeneratedIssues:project.reservedGeneratedIssues};
}

export function renderCase(plan,population,row,metadata,users){
  const site=plan.sites.find(s=>s.site===population.site),project=site.projects.find(p=>p.key===row.projectKey);
  demand(metadata?.key===project.key&&metadata.createdByCampaign&&metadata.checkedAt,'Verified new-project metadata required');
  demand(users.length&&users.every(u=>u.active&&u.accountId),'Verified assignable users required');
  const n=row.ordinal,seed=parseInt(hash(population.site+'/'+row.identity).slice(0,8),16);
  const scenario=DOMAINS[population.site.replace('.atlassian.net','')][seed%6];
  const location=['Bucharest','Dublin','Rotterdam','Prague','Hamburg','Valencia'][Math.floor(seed/7)%6];
  const cohort=['pilot','regional rollout','quarterly review','recovery exercise','release candidate','follow-up investigation'][Math.floor(seed/43)%6];
  const reference=`${project.key.slice(0,5)}-${String(1000+n)}`;
  const samples=12+seed%187,exceptions=1+Math.floor(seed/13)%7;
  const observed=`The ${location} ${cohort} sample contains ${samples} records; ${exceptions} require follow-up because ${scenario[1]}. Reference ${reference} retains the source comparison and the reviewer questions.`;
  const evidence=`Scope: ${project.name}, ${location}, ${cohort}. Observation: ${observed} Verification method: ${scenario[2]}. Acceptance: ${scenario[4]}. Exclusion: results from other cohorts are not evidence for this decision.`;
  const done=plan.workflowFamilies[row.family].statusCategories[row.state]==='Done';
  const sections=n%3===0?[['Decision to make',`For ${project.name}, determine whether to ${scenario[3]}.`],['Observations',observed],['Acceptance boundary',scenario[4]],['Open questions',`Confirm ownership of the ${exceptions} exceptions before extending the decision beyond ${location}.`]]:[['Context',`${scenario[0]} in ${project.name}. This record covers the ${location} ${cohort}, reference ${reference}.`],['Evidence',observed],['Proposed action',scenario[3]],['Verification',`${scenario[2]}; acceptance requires that ${scenario[4]}.`]];
  const owner=users[seed%users.length];
  const fields={project:{id:metadata.id},issuetype:{id:metadata.issueTypes[row.type]?.id},summary:`${scenario[0]} — ${location} ${reference}`,description:{type:'doc',version:1,content:sections.flatMap(([h,t])=>[heading(h),para(t)])},labels:['lz-org-expanded-20260910',`lz-case-${hash(population.site+'/'+row.identity).slice(0,24)}`,row.family,cohort.replaceAll(' ','-')],assignee:{accountId:owner.accountId},duedate:day(3+seed%120)};
  demand(fields.issuetype.id,'Exact type identity missing');
  for(const f of project.customFields){
    const actual=metadata.fields[f.name];demand(actual?.id&&actual.projectKeys?.includes(project.key),'Exact field context missing');
    const suffix=f.name.slice(project.key.length+1);let value;
    if(f.type==='paragraph')value={type:'doc',version:1,content:[para(suffix==='Evidence'?evidence:suffix==='Actual Outcome'?(done?`The scoped verification is recorded against ${reference}. ${scenario[4]}. Remaining exceptions are tracked separately; the conclusion does not extend to other cohorts.`:`Verification remains open for ${reference}; ${exceptions} observations still need a disposition.`):`Decision for ${reference}: ${done?'accept the scoped outcome':'retain the open decision'}; ${scenario[3]}. Preserve the stated exclusions and unresolved evidence.`)]};
    else if(f.type==='number')value=1+seed%97;
    else if(f.type==='date')value=day(10+seed%120);
    else if(f.type==='single-user')value={accountId:owner.accountId};
    else if(f.type==='single-select'){
      const option=suffix==='Disposition'?(done?'Accepted':row.state==='Backlog'?'New':'Investigating'):f.options[Math.floor(seed/17)%f.options.length];
      const selected=actual.options.find(o=>o.value===option&&!o.disabled);demand(selected,'Option binding missing');value={id:selected.id};
    }else value=suffix==='Reference'?reference:f.exampleValues?.[seed%f.exampleValues.length]||`${location} ${cohort}`;
    fields[actual.id]=value;
  }
  return {identity:row.identity,desiredState:row.state,workflowId:row.workflowId,parentIdentity:row.parentIdentity,fields};
}
