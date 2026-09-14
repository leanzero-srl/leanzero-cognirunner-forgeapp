import { loadEnv, requireEnv } from "../lib/env.mjs";
/* F-715 — this probe carried the THIRD home of a Forge environment id (staging, inside
   the admin-page URL below). It is a `_probe-` file, so rule 4f in
   evidence-redaction.test.mjs never looked at it, and it is exactly the "nearest sibling"
   a new driver gets copied from. One row, one home. */
import { forgeEnvId } from "../lib/shared-env-guard.mjs";
const env = loadEnv();
const ENV_ID = forgeEnvId("staging");
const U = env.STAGING_TESTSTATE_URL, S = requireEnv("HARNESS_SECRET"), A = requireEnv("HARNESS_ADMIN_ACCOUNT_ID");
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const post=async(b)=>{const r=await fetch(U,{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+S},body:JSON.stringify(b)});return {s:r.status,j:JSON.parse(await r.text())};};
const inv=(fk,pl={})=>post({action:"invokeResolver",functionKey:fk,payload:pl,accountId:A});
const get=async(qs)=>{const r=await fetch(U+qs,{headers:{Authorization:"Bearer "+S}});return JSON.parse(await r.text());};
const va={persona:{name:"Probe",voice:{register:"terse",greeting:false,maxSentences:3,language:"auto"},signature:false},
 scope:{read:{site:false,projects:["JT"]},write:{projects:["JT"]}},
 intake:{serviceDesks:[{serviceDeskId:"1",queueIds:["1"]}],jql:"project = JT",mentionsOf:[],owedFirst:true},
 cadence:{preset:"every30",timeZone:"UTC",postWindow:{days:[0,1,2,3,4,5,6],from:"00:00",to:"23:59"}},
 powers:{replyPublic:false,replyInternal:true,assign:false,transition:false,editFields:false,confluenceRead:false,confluenceWrite:false,git:false,webSearch:false,skillIds:[]},
 guardrails:{capsPerHour:6,capsPerDay:20,owedPerHour:12,shadowTicks:3,minPostGapMinutes:15,antiPileUpDays:3,otherWriterQuietMinutes:20,approvalProjectKey:"",maxItemsPerTick:1,maxWritesPerRun:10},
 status:{paused:true,shadowUntilTick:500}};
await inv("saveAgentModel",{model:"claude-sonnet-5"});
const c=await inv("saveScheduledJob",{job:{name:"badge probe "+Date.now(),mode:"va",enabled:false,va}});
const id=c.j.job&&c.j.job.id;
if(!c.j.job){console.log("SAVE REFUSED",JSON.stringify(c.j).slice(0,400));process.exit(1);}
console.log("created",id,"stored shadowUntilTick",c.j.job.va.status.shadowUntilTick,"refused",JSON.stringify(c.j.refused));
const st=await inv("getVaStatus",{jobId:id});
console.log("getVaStatus.shadow =",JSON.stringify(st.j.shadow),"paused=",st.j.paused);
console.log("va_health:",JSON.stringify((await get("?what=kvs&key=va_health:"+id)).value));
// Now the tab, with a patient wait for the status to arrive.
const {chromium}=await import("../../static/_screenshot-harness/node_modules/playwright/index.mjs");
const ctx=await chromium.launchPersistentContext("/Users/mihaiperdum/Projects/forge-live-harness/.auth/profile",{headless:true,viewport:{width:1500,height:1200}});
try{
 const p=ctx.pages()[0]||await ctx.newPage();
 await p.goto("https://wolfaenpak.atlassian.net/jira/apps/36415848-6868-4697-9554-3c3ad87b8da9/"+ENV_ID,{waitUntil:"domcontentloaded"});
 let f=null;for(let i=0;i<90;i++){f=p.frames().find(x=>x.url().includes("cdn.prod.atlassian-dev.net"));if(f&&await f.locator(".tab-btn").count()>0)break;await sleep(1000);}
 await f.locator(".tab-btn",{hasText:/^\s*Agents\s*$/}).click();
 const card=f.locator(".va-agent").filter({has:f.locator(".va-agent-name",{hasText:"Probe"})}).first();
 await card.waitFor({state:"visible",timeout:60000});
 // WAIT for the per-agent status fetch to land: "Last tick" stops reading the placeholder.
 for(let i=0;i<40;i++){
   const lt=await card.locator(".va-stat").filter({has:f.locator(".va-stat-label",{hasText:/^Last tick$/})}).locator(".va-stat-value").first().innerText().catch(()=>"");
   if(lt && !/not known yet|…/.test(lt)) break;
   await sleep(1000);
 }
 await sleep(3000);
 const badges=await card.locator(".va-badge").allInnerTexts();
 const mode=await card.locator(".va-stat").filter({has:f.locator(".va-stat-label",{hasText:/^Mode$/})}).locator(".va-stat-value").first().innerText().catch(()=>null);
 const last=await card.locator(".va-stat").filter({has:f.locator(".va-stat-label",{hasText:/^Last tick$/})}).locator(".va-stat-value").first().innerText().catch(()=>null);
 console.log("TAB badges:",JSON.stringify(badges),"mode:",JSON.stringify(mode),"lastTick:",JSON.stringify(last));
}finally{await ctx.close();}
const d=await inv("deleteScheduledJob",{id});
console.log("deleted:",JSON.stringify(d.j));
console.log("model slot restored:",JSON.stringify((await post({action:"kvSet",key:"COGNIRUNNER_AGENT_MODEL_atlassian",value:null})).j));
