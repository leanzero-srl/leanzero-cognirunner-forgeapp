/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
// Offline plan by default. All live mutation modes require explicit CLI apply.
import {readFileSync,existsSync,mkdirSync,openSync,closeSync,writeFileSync,renameSync,unlinkSync,fsyncSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {executeProjectGraphs,buildGraphPayload,graphHash} from '../lib/org-workflow-graphs.mjs';
const hosts=['apex-coresystems','beacon-logistics','factory-liberation','krypton-cybersec','solace-ai-labs','strata-datalabs','wolfaenpak','leanzero-apps-demo'].map(s=>s+'.atlassian.net');
const fail=message=>{throw new Error(message);};
function atomic(path,value){const temporary=path+'.tmp',fd=openSync(temporary,'w',0o600);try{writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fsyncSync(fd);}finally{closeSync(fd);}renameSync(temporary,path);const directory=openSync(dirname(path),'r');try{fsyncSync(directory);}finally{closeSync(directory);}}
export function graphClient(site,mode,auth,fetcher=fetch){
  if(!hosts.includes(site))fail('Unapproved graph target');
  return async(path,method='GET',body)=>{
    if(!path.startsWith('/rest/api/3/')||path.includes('..')||path.includes('://')||path.includes('#'))fail('Invalid graph API path');
    if(!['GET','POST','PUT'].includes(method))fail('Unsupported graph method');
    if(method!=='GET'&&mode!=='apply')fail('Read-only mode refused mutation');
    let response;
    try{response=await fetcher(`https://${site}${path}`,{method,headers:{Authorization:'Basic '+auth,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},redirect:'error',signal:AbortSignal.timeout(30000),...(body?{body:JSON.stringify(body)}:{})});}
    catch{fail(`${method} request uncertain; reconcile durable receipt before retry`);}
    if(!response.ok)fail(`${method} ${path}: HTTP ${response.status}; no automatic replay`);
    const text=await response.text();return text?JSON.parse(text):null;
  };
}
export async function main(args=process.argv.slice(2)){
  const mode=args.shift();if(!['plan','inspect','verify','apply'].includes(mode))fail('Use plan|inspect|verify|apply --manifest PATH --metadata PATH --project KEY --output PATH [--env-module PATH]');
  const options={};while(args.length){const flag=args.shift();if(!['--manifest','--metadata','--project','--output','--env-module'].includes(flag)||!args.length||Object.hasOwn(options,flag))fail('Unknown, repeated or incomplete argument');options[flag]=args.shift();}
  for(const flag of ['--manifest','--metadata','--project','--output'])if(!options[flag])fail('Missing '+flag);
  const plan=JSON.parse(readFileSync(resolve(options['--manifest']))),metadata=JSON.parse(readFileSync(resolve(options['--metadata'])));
  if(!hosts.includes(metadata.site)||metadata.site==='leanzero.atlassian.net'||metadata.manifestHash!==graphHash(plan)||metadata.marker!=='lz-org-expanded-20260910')fail('Metadata scope/manifest mismatch');
  const site=plan.sites.find(s=>s.site===metadata.site),project=site?.projects.find(p=>p.key===options['--project']),binding=metadata.projects?.[options['--project']];
  if(!project||!binding?.checkedAt)fail('Project metadata is not complete');
  if(binding.createdByCampaign!==true){console.log(JSON.stringify({project:project.key,status:'BLOCKED_EXISTING_PROJECT_MIGRATION'}));return;}
  if(String(metadata.objects?.[project.key+'/project']?.id)!==binding.id)fail('Fresh project creation receipt missing');
  if(mode==='plan'){console.log(JSON.stringify({site:metadata.site,project:project.key,status:'OFFLINE_GRAPH_PLAN',payload:buildGraphPayload(plan,metadata.site,project,binding)},null,2));return;}
  if(!options['--env-module'])fail('Live operation requires explicit env module');
  const env=await import(pathToFileURL(resolve(options['--env-module'])));env.loadEnv();const auth=Buffer.from(env.requireEnv('JIRA_ADMIN_EMAIL')+':'+env.requireEnv('JIRA_API_TOKEN')).toString('base64');
  const output=resolve(options['--output']);mkdirSync(dirname(output),{recursive:true});const lock=output+'.lock';const fd=openSync(lock,'wx',0o600);
  try{writeFileSync(fd,JSON.stringify({pid:process.pid,mode,site:metadata.site}));closeSync(fd);
    const state=existsSync(output)?JSON.parse(readFileSync(output)):{site:metadata.site,manifestHash:graphHash(plan),projects:{},pending:{}};
    const result=await executeProjectGraphs({plan,site:metadata.site,project,metadata:binding,state,api:graphClient(metadata.site,mode,auth),save:s=>atomic(output,s),mode});console.log(JSON.stringify(result));
  }finally{unlinkSync(lock);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
