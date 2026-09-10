/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
// Authored business cases; every number below belongs to synthetic demonstration evidence.
import {createHash} from 'node:crypto';
const domains={
  DELIVERY:{name:'Delivery Decisions',formats:{pdf:12,csv:10,json:6,txt:6,svg:6},kinds:['Readiness assessment','Dependency review','Release decision','Handover evidence'],cases:[
    ['Product launch','LAUNCH','regional onboarding','the invitation callback arrives before the customer record is committed','queue the callback against its correlation identifier and replay only after persistence','duplicate invitations','Customer Operations',96,7],
    ['Platform upgrade','UPGRADE','database cutover','a legacy report still reads the retired account-status column','publish a compatibility view for one release and remove it after the report owner signs off','silent reporting gaps','Platform Engineering',84,5],
    ['Regional rollout','ROLLOUT','regional configuration','the tax-region lookup falls back to the default market for newly provisioned tenants','validate the tenant mapping before activation and reject an absent region','incorrect regional configuration','Delivery Operations',120,9],
    ['Release assurance','RELQA','release candidate qualification','the mobile retry path creates a second request after a timeout','retain the client request identity across retries and verify one persisted result','duplicate customer actions','Quality Engineering',144,11],
    ['Customer onboarding','ONBOARD','workspace provisioning','a delayed group sync leaves the first workspace owner without access','wait for the required group membership and report a recoverable provisioning state','incomplete onboarding','Customer Success',72,4],
    ['Research delivery','LAB','model handover','the evaluation manifest points to a dataset revision that the serving image cannot load','pin the dataset digest alongside the serving image and reject mismatched revisions','unreproducible release evidence','Research Engineering',108,8],
  ]},
  CONTROLS:{name:'Control Assurance',formats:{pdf:18,csv:8,json:8,txt:8,svg:6},kinds:['Control design','Evidence sampling','Exception assessment','Remediation record','Approval brief'],cases:[
    ['Privileged access','COGDEMO','temporary administrative access','the expiry job has no owner after a service handover','assign a accountable service owner and require an expiry timestamp on every grant','standing elevated access','Security Operations',150,6],
    ['Supplier assurance','ONBOARD','supplier onboarding','the processing-location declaration excludes a support subcontractor','obtain the complete processing chain before releasing the onboarding gate','incomplete supplier evidence','Procurement Assurance',64,3],
    ['Evidence retention','RELQA','release evidence retention','the archive job retains the index but omits the linked attachments','verify attachment digests during archival and retain the full decision package','an incomplete audit trail','Quality Governance',180,12],
    ['Change approval','UPGRADE','emergency change approval','the implementation window begins before the fallback owner has acknowledged the plan','require the fallback owner acknowledgement before the approval decision','an unowned rollback','Change Management',90,5],
    ['Recovery assurance','ROLLOUT','restore validation','the backup restore succeeds while a dependent key mapping is missing','include application-level reconciliation after the restore and compare key coverage','unusable recovered data','Reliability Engineering',128,7],
    ['Model governance','LAB','evaluation governance','the acceptance threshold was changed after the candidate score became visible','freeze the threshold in the evaluation manifest before the candidate is evaluated','selection bias in release decisions','Research Governance',112,8],
  ]},
  OPERATIONS:{name:'Service Operations',formats:{pdf:12,csv:12,json:6,txt:8,svg:6},kinds:['Service runbook','Incident analysis','Recovery rehearsal','Operational handover'],cases:[
    ['Identity federation','COGDEMO','single sign-on','the certificate rollover leaves one regional connection on the old signing certificate','publish overlapping validity and check each regional connection before retiring the old certificate','regional sign-in failures','Identity Operations',132,6],
    ['Event delivery','LAUNCH','event processing','a consumer acknowledges the message before the downstream write completes','acknowledge only after the durable write and route exhausted retries to a reviewed queue','lost delivery events','Integration Operations',160,10],
    ['Deployment pipeline','UPGRADE','deployment promotion','the approval artifact references the prior image digest','bind promotion to the reviewed digest and refuse a changed artifact','promotion of an unreviewed build','Platform Operations',88,4],
    ['Warehouse reconciliation','ROLLOUT','inventory synchronisation','out-of-order stock movements are applied using ingestion time','order by the source movement sequence and quarantine gaps for reconciliation','incorrect inventory balances','Data Operations',192,13],
    ['Certificate renewal','RELQA','certificate lifecycle','the renewal task updates storage but the running gateway keeps the expired certificate','reload the gateway and verify the served certificate from each region','expiry-related service interruption','Service Reliability',76,3],
    ['Backup restoration','LAB','research workspace recovery','the restored workspace contains pointers to an unavailable object-store prefix','restore the referenced object set and validate the manifest before exposing the workspace','partial workspace recovery','Research Operations',104,7],
    ['Customer escalation','ONBOARD','support handover','the escalation is assigned to a team whose service coverage ended yesterday','resolve the current coverage roster before assigning the escalation','unowned customer escalations','Support Operations',116,9],
  ]},
  RESEARCH:{name:'Research Evidence',formats:{pdf:6,csv:6,json:4,txt:2,svg:6},kinds:['Experiment protocol','Dataset assessment','Evaluation findings','Release recommendation'],cases:[
    ['Relevance ranking','LAB','search ranking evaluation','the validation set contains near-duplicates of training examples','split by source document lineage and publish both aggregate and cohort results','inflated relevance scores','Search Research',200,14],
    ['Anomaly triage','LAB','anomaly detection','the detector treats scheduled maintenance as an unexplained service anomaly','include the maintenance calendar and evaluate the missed-incident tradeoff separately','unnecessary incident noise','Reliability Research',168,12],
    ['Delivery forecasting','ROLLOUT','delivery forecast evaluation','late-arriving completion dates leak into the feature snapshot','freeze each feature snapshot at the forecast origin and replay the same cutoff','optimistic completion forecasts','Planning Research',156,9],
    ['Evidence extraction','RELQA','document extraction','the extractor merges a table footnote into the approval decision','preserve table structure and route ambiguous approval evidence for review','misread approval evidence','Document Research',124,8],
    ['Onboarding assistance','ONBOARD','assisted onboarding','the assistant proposes a step that is unavailable in the selected service tier','ground suggestions in the tier capability list and retain a visible escalation path','unfulfillable onboarding advice','Product Research',140,10],
  ]},
};
const marker='lz-org-expanded-20260910';
const text=s=>({type:'text',text:s});
const p=s=>({type:'paragraph',content:[text(s)]});
const heading=s=>({type:'heading',attrs:{level:2},content:[text(s)]});
const cell=s=>({type:'tableCell',content:[p(String(s))]});
const table=rows=>({type:'table',attrs:{isNumberColumnEnabled:false,layout:'default'},content:rows.map(row=>({type:'tableRow',content:row.map(cell)}))});
export function evidenceCatalog(){
  const spaces=[];
  for(const [key,domain] of Object.entries(domains)){
    const pages=[];
    for(const [caseIndex,c] of domain.cases.entries())for(const [kindIndex,kind] of domain.kinds.entries()){
      const [subject,project,scope,cause,action,risk,owner,sample,exceptions]=c;
      const index=pages.length,identity=key.toLowerCase()+'-'+String(index+1).padStart(2,'0');
      const examined=sample+kindIndex*7,failed=exceptions+(kindIndex%2),passed=examined-failed;
      const title=subject+' - '+kind;
      const measurements=Array.from({length:12},(_,i)=>{const n=examined+i*3;const misses=Math.max(0,failed-Math.floor(i/3));return {cohort:['North','Central','South'][i%3],batch:identity+'-B'+String(i+1).padStart(2,'0'),sample:n,passed:n-misses,exceptions:misses,latencyMs:180+caseIndex*23+i*11};});
      const paragraphs=[
        `This ${kind.toLowerCase()} covers ${scope} for ${project}. The decision concerns ${risk}. It applies to the candidate change and its dependent handover tasks; it does not establish approval for unrelated projects.`,
        `The prepared case reproduces a specific failure: ${cause}. The first review sample contains ${examined} records, of which ${passed} meet the stated check and ${failed} require investigation. Keep the exception set separate from the passing sample so the follow-up can be reproduced.`,
        `The proposed response is to ${action}. The ${owner} role owns the implementation evidence. A reviewer from the affected service must check the exception sample before the decision moves forward. An unresolved exception stays visible with an owner and a next review date.`,
        `Acceptance requires the original failing examples to pass after the change, a fresh sample from all three cohorts, and a check that the previous valid behaviour still works. Compare the source identifiers, observed result and expected result for every exception; a total count alone is insufficient.`,
        `If the acceptance check fails, retain the candidate evidence and return the decision for rework. Record which records failed, the proposed correction and the next controlled verification. Do not replace a failed result with a new unlabelled sample.`,
        `The evidence package includes the source scenario, cohort measurements and a review procedure. The document and its attachments are prepared synthetic demonstration material; no uploaded file constitutes a real approval, executed recovery or successful app test.`,
      ];
      const body={type:'doc',version:1,content:[heading('Purpose and scope'),p(paragraphs[0]),heading('Observations'),p(paragraphs[1]),table([['Review sample','Pass','Exception','Owner role'],[examined,passed,failed,owner]]),heading('Decision and controls'),p(paragraphs[2]),heading('Acceptance evidence'),p(paragraphs[3]),p(paragraphs[4]),heading('Ownership and references'),{type:'paragraph',content:[text('Related Jira work: '),{type:'text',text:project,marks:[{type:'link',attrs:{href:'https://leanzero-apps-demo.atlassian.net/plugins/servlet/project-config/'+project+'/details'}}]}]},p(paragraphs[5]),p(`Evidence reference: ${identity}. Campaign: ${marker}. Review disposition: prepared, awaiting actual workflow execution.`)]};
      pages.push({identity,title,project,owner,scope,cause,action,risk,paragraphs,body,measurements,attachments:[]});
    }
    let offset=0;
    for(const [format,count] of Object.entries(domain.formats)){
      for(let i=0;i<count;i++){
        const page=pages[(offset+i)%pages.length];page.attachments.push({format,name:page.identity+'-'+({pdf:'decision-pack',csv:'cohort-measurements',json:'case-contract',txt:'review-runbook',svg:'decision-flow'}[format])+'.'+format});
      }
      offset+=count;
    }
    spaces.push({key,name:domain.name,description:`${marker}. Prepared demonstration evidence for ${domain.name.toLowerCase()}.`,pages});
  }
  return {site:'leanzero-apps-demo.atlassian.net',marker,spaces};
}
export function textAttachment(page,format){
  if(format==='csv')return 'batch,cohort,sample,passed,exceptions,latency_ms\n'+page.measurements.map(r=>[r.batch,r.cohort,r.sample,r.passed,r.exceptions,r.latencyMs].join(',')).join('\n')+'\n';
  if(format==='json')return JSON.stringify({schemaVersion:1,reference:page.identity,synthetic:true,project:page.project,scope:page.scope,risk:page.risk,review:{state:'prepared',ownerRole:page.owner,actualApproval:null},failure:{cause:page.cause,proposedResponse:page.action},acceptance:{originalFailuresMustPass:true,cohorts:['North','Central','South'],preserveFailedSamples:true},measurements:page.measurements},null,2)+'\n';
  if(format==='txt')return [page.title,'','Prepared synthetic review runbook.','',...page.paragraphs,'','Procedure:','1. Record the candidate version and source identifiers.','2. Reproduce the failing examples described above.','3. Apply the proposed response only to the approved demonstration scope.','4. Compare every exception and the fresh cohort sample.','5. Record the actual outcome; retain failures for rework.','6. Request the real reviewer decision in Sentinel Vault.','',`Reference: ${page.identity}; role: ${page.owner}.`].join('\n')+'\n';
  if(format==='svg'){
    const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="340" viewBox="0 0 1100 340"><rect width="1100" height="340" fill="#0f172a"/><text x="42" y="48" fill="white" font-family="Arial" font-size="25">${escape(page.title)}</text><text x="42" y="80" fill="#cbd5e1" font-family="Arial" font-size="16">${escape(page.project+' | '+page.identity+' | Prepared synthetic decision path')}</text>${['Capture evidence','Review exceptions','Record decision','Retain package'].map((label,i)=>`<rect x="${42+i*265}" y="125" width="220" height="78" rx="10" fill="${['#2563eb','#7c3aed','#0d9488','#ea580c'][i]}"/><text x="${152+i*265}" y="169" text-anchor="middle" fill="white" font-family="Arial" font-size="18">${label}</text>${i<3?`<path d="M ${270+i*265} 164 h 25 m -8 -7 l 8 7 -8 7" fill="none" stroke="white" stroke-width="3"/>`:''}`).join('')}<text x="42" y="265" fill="white" font-family="Arial" font-size="17">Failed checks return to evidence preparation with the original exception sample retained.</text><text x="42" y="302" fill="#cbd5e1" font-family="Arial" font-size="15">Owner role: ${escape(page.owner)}. No approval is implied by this diagram.</text></svg>`;
  }
  throw Error('Unsupported text attachment '+format);
}
export const evidenceHash=value=>createHash('sha256').update(value).digest('hex');
