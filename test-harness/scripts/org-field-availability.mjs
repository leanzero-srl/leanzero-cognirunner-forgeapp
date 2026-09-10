/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
// Legacy tenants need explicit visibility in a project-owned field configuration.
import {readFileSync,existsSync,mkdirSync,openSync,writeFileSync,closeSync,unlinkSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {makeClient,atomicSave,durableMutation} from './org-metadata-execute.mjs';
import {requireEnv} from '../lib/env.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export const canonicalField=f=>({id:f.id,description:f.description||'',isHidden:!!f.isHidden,isRequired:!!f.isRequired,...(f.renderer?{renderer:f.renderer}:{})});
export function desiredFieldConfiguration(original,fields){
  const rows=original.map(f=>({...f}));
  for(const f of Object.values(fields))if(!f.system){const existing=rows.find(x=>x.id===f.id);if(existing)existing.isHidden=false;else rows.push(canonicalField({id:f.id,isHidden:false,isRequired:false,...(f.type==='paragraph'?{renderer:'wiki-renderer'}:{})}));}
  return rows;
}
export const visibleConfiguration=rows=>rows.filter(f=>!f.isHidden).map(canonicalField).sort((a,b)=>a.id.localeCompare(b.id));
export function requireExclusiveConsumers(configId,schemeId,projectId,mappings,associations){
  if(configId)assert(mappings.filter(m=>String(m.fieldConfigurationId)===configId).every(m=>String(m.fieldConfigurationSchemeId)===schemeId),'Owned field configuration was reused in another scheme');
  if(schemeId)assert(associations.filter(a=>String(a.fieldConfigurationScheme?.id)===schemeId).every(a=>a.projectIds.every(id=>String(id)===projectId)),'Owned field scheme was reused on another project');
}
export async function createFields(api,project,type){
  const fields=[];
  for(let start=0;;){
    const page=await api(`/rest/api/3/issue/createmeta/${project}/issuetypes/${type}?startAt=${start}&maxResults=100`),rows=page.fields||page.values;
    assert(Array.isArray(rows),'Malformed create metadata');fields.push(...rows);
    if(page.isLast===true||(Number.isFinite(page.total)&&fields.length>=page.total))return fields;
    assert(rows.length,'Incomplete create metadata');start+=rows.length;
  }
}
export async function verifyFieldAvailability(api,key,binding){
  let checked=0;
  for(const [name,type] of Object.entries(binding.issueTypes)){
    const fields=await createFields(api,key,type.id),ids=new Set(fields.map(f=>f.fieldId||f.key));
    const missing=Object.values(binding.fields).filter(f=>!ids.has(f.id));
    assert(!missing.length,`${key}/${name} cannot create fields: ${missing.map(f=>f.id).join(',')}`);checked++;
  }
  return checked;
}
export async function main(mode,site,key){
  assert(['apply','verify'].includes(mode));
  const plan=JSON.parse(readFileSync(resolve(root,'docs/org-expanded-approval-plan.json'))),project=plan.sites.find(s=>s.site===site)?.projects.find(p=>p.key===key);assert(project,'Unapproved project');
  const metadata=JSON.parse(readFileSync(resolve(root,'test-harness/results/org-metadata-v1',site+'.json'))),binding=metadata.projects[key];assert(metadata.site===site&&binding?.checkedAt);
  const api=makeClient(site,mode,Buffer.from(requireEnv('JIRA_ADMIN_EMAIL')+':'+requireEnv('JIRA_API_TOKEN')).toString('base64'));
  const permissions=await api('/rest/api/3/mypermissions?projectKey='+key+'&permissions=ADMINISTER,BROWSE_PROJECTS');assert(permissions.permissions.ADMINISTER.havePermission&&permissions.permissions.BROWSE_PROJECTS.havePermission);
  const legacy=Object.values(binding.fields).filter(f=>!f.system).every(f=>f.scopeMechanism==='field-context');
  const folder=resolve(root,'test-harness/results/org-field-availability-v1',site);mkdirSync(folder,{recursive:true});const path=resolve(folder,key+'.json'),lock=path+'.lock',fd=openSync(lock,'wx',0o600);writeFileSync(fd,JSON.stringify({pid:process.pid,mode}));closeSync(fd);
  try{
    const state=existsSync(path)?JSON.parse(readFileSync(path)):{site,key,projectId:binding.id,pending:{},objects:{}};assert.equal(state.projectId,binding.id);assert.equal(state.site,site);assert.equal(state.key,key);const save=()=>atomicSave(path,state);
    async function pages(endpoint){const result=[];for(let start=0;;){const p=await api(endpoint+(endpoint.includes('?')?'&':'?')+'startAt='+start+'&maxResults=100');assert(Array.isArray(p.values));result.push(...p.values);if(p.isLast||(Number.isFinite(p.total)&&result.length>=p.total))return result;assert(p.values.length);start+=p.values.length;}}
    async function association(){const rows=await pages('/rest/api/3/fieldconfigurationscheme/project?projectId='+binding.id);assert.equal(rows.length,1);assert.deepEqual(rows[0].projectIds.map(String),[binding.id]);return rows[0].fieldConfigurationScheme?.id?String(rows[0].fieldConfigurationScheme.id):null;}
    async function exclusive(configId,schemeId){
      const mappings=await pages('/rest/api/3/fieldconfigurationscheme/mapping');const associations=[];
      if(schemeId){
        const projects=await pages('/rest/api/3/project/search?status=live&status=archived&status=deleted');assert(projects.some(p=>String(p.id)===binding.id),'Project inventory lacks positive target control');
        for(let i=0;i<projects.length;i+=50){const query=projects.slice(i,i+50).map(p=>'projectId='+p.id).join('&');associations.push(...await pages('/rest/api/3/fieldconfigurationscheme/project?'+query));}
      }
      requireExclusiveConsumers(configId,schemeId,binding.id,mappings,associations);
    }
    async function ensure(id,endpoint,body){
      const matches=(await pages(endpoint)).filter(x=>x.name===body.name);assert(matches.length<=1);let found=matches[0],owned=state.objects[id];
      if(found){assert(owned||state.pending[id],'Refuse existing unowned configuration');assert.equal(found.description,body.description);if(owned)assert.equal(String(found.id),owned.id);}
      else{assert(!owned&&!state.pending[id],'Missing or uncertain configuration; no repeat');assert.equal(mode,'apply');state.pending[id]={body,at:new Date().toISOString()};save();found=await api(endpoint,'POST',body);assert(found.id);}
      state.objects[id]={id:String(found.id),body};delete state.pending[id];save();return String(found.id);
    }
    if(legacy){
      if(!state.baseline){
        const schemeId=await association();let mappings;
        if(schemeId)mappings=(await pages('/rest/api/3/fieldconfigurationscheme/mapping?fieldConfigurationSchemeId='+schemeId)).map(m=>({issueTypeId:String(m.issueTypeId),fieldConfigurationId:String(m.fieldConfigurationId)}));
        else{const defaults=(await pages('/rest/api/3/fieldconfiguration')).filter(c=>c.isDefault);assert.equal(defaults.length,1);mappings=[{issueTypeId:'default',fieldConfigurationId:String(defaults[0].id)}];}
        assert(mappings.some(m=>m.issueTypeId==='default'));const configs={};for(const id of new Set(mappings.map(m=>m.fieldConfigurationId)))configs[id]=(await pages('/rest/api/3/fieldconfiguration/'+id+'/fields')).map(canonicalField);
        state.baseline={schemeId,mappings,configs};save();
      }
      const ids={};
      for(const [sourceId,original] of Object.entries(state.baseline.configs)){
        const id=await ensure('config/'+sourceId,'/rest/api/3/fieldconfiguration',{name:key+' Showcase Field Configuration '+sourceId,description:'lz-org-expanded-20260910: '+key+' / field configuration '+sourceId});ids[sourceId]=id;
        const expected=desiredFieldConfiguration(original,binding.fields);
        const before=await pages('/rest/api/3/fieldconfiguration/'+id+'/fields');
        const hide=before.filter(f=>!expected.some(x=>x.id===f.id)).map(f=>({id:f.id,isHidden:true}));
        const body={fieldConfigurationItems:[...expected,...hide]};
        await exclusive(id,state.objects.scheme?.id);
        await durableMutation(state,save,api,mode,'fields/'+id,'PUT','/rest/api/3/fieldconfiguration/'+id+'/fields',body,async()=>JSON.stringify(visibleConfiguration(await pages('/rest/api/3/fieldconfiguration/'+id+'/fields')))===JSON.stringify(visibleConfiguration(expected)));
      }
      const schemeId=await ensure('scheme','/rest/api/3/fieldconfigurationscheme',{name:key+' Showcase Field Configuration Scheme',description:'lz-org-expanded-20260910: '+key+' / isolated field visibility'});
      const mappings=state.baseline.mappings.map(m=>({...m,fieldConfigurationId:ids[m.fieldConfigurationId]}));const normalize=rows=>rows.map(m=>m.issueTypeId+':'+m.fieldConfigurationId).sort();
      await exclusive(null,schemeId);
      await durableMutation(state,save,api,mode,'mapping','PUT','/rest/api/3/fieldconfigurationscheme/'+schemeId+'/mapping',{mappings},async()=>JSON.stringify(normalize(await pages('/rest/api/3/fieldconfigurationscheme/mapping?fieldConfigurationSchemeId='+schemeId)))===JSON.stringify(normalize(mappings)));
      const current=await association();assert(current===schemeId||current===state.baseline.schemeId,'Preserve external scheme reassociation');
      await durableMutation(state,save,api,mode,'association','PUT','/rest/api/3/fieldconfigurationscheme/project',{projectId:binding.id,fieldConfigurationSchemeId:schemeId},async()=>await association()===schemeId);
    }
    const issueTypes=await verifyFieldAvailability(api,key,binding);state.verifiedAt=new Date().toISOString();state.issueTypes=issueTypes;state.legacy=legacy;save();console.log(JSON.stringify({project:key,status:'CREATE_FIELDS_READBACK_PASS',issueTypes,mode}));
  }finally{unlinkSync(lock);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main(...process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1;});
