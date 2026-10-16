import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {createHandlers} from '../leadgen-workflow.mjs';
const {queueRequest}=createRequire(import.meta.url)('../leadgen-queue.js');
const {companyKeywords}=createRequire(import.meta.url)('../next-keywords.js');
const profile='cloud-phone-test',serial='47.100.213.173:10001',account='perfect21xx',run='mmv-company-fixture';
const company={company_id:'company-a',tenant_id:'tenant-a',version:7,run_id:run,policy_id:'policy-a'};
const binding={...company,profile,device_serial:serial,douyin_id:account,verification_status:'verified',enabled:true};
delete binding.policy_id;

async function preflight({flow='douyin_video_discovery',host='mmv',flag='1',receipt={...company,device_binding:binding},observed=account,rpcImpl}={}){
 const dir=mkdtempSync(join(tmpdir(),'mmv-company-')),calls=[],requests=[];
 const registry=join(dir,'accounts.tsv');writeFileSync(registry,profile+'\t'+observed+'\n');
 const env={HOME:dir,WFR_RUN_DIR:dir,WFR_HOSTKEY:host,LEADGEN_MMV_DEVICE_RUNTIME:flag,WF_BRAIN_WORKFLOW:flow,P:profile,SERIAL:serial,WFR_TAG:run,LEADGEN_LINE:'jinuo',DOUYIN_ACCOUNT_REGISTRY:registry,DOUYIN_PHONE_ADB:'/fixture/controller',DOUYIN_ADB_BIN:'/approved/adb'};
 const h=createHandlers({root:dir,env,rpc:async body=>{const {request}=body;if(request)requests.push(request);if(rpcImpl)return rpcImpl(body);if(body.kind==='keywords')return {result:['AI']};if(receipt instanceof Error)throw receipt;return {result:receipt};},execute:async(command,args)=>{
  calls.push({command,args});let stdout='';
  if(command==='adb'||command==='/approved/adb')stdout=args.includes('get-state')?'device\n':args.includes('telephony.registry')?'mCallState=0\n':'';
  if(command==='/fixture/controller'){const op=args[2]==='--lock-owner'?args[4]:args[2];if(op==='preflight')stdout='serial='+serial+'\n';if(op==='lock-acquire')stdout='lock=acquired\n';if(op==='lock-refresh')stdout='lock=refreshed owner='+run+' ttl=3600s\n';if(op==='account-current')stdout='douyin_id='+observed+'\n';}
  return {code:0,stdout,stderr:''};
 }});
 try {let result,error;try{result=await h.preflight();}catch(e){error=e;}
  const evidence=(()=>{try{return readFileSync(join(dir,'company-config-receipts.jsonl'),'utf8');}catch{return '';}})();
  return {result,error,calls,requests,evidence};
 }finally{rmSync(dir,{recursive:true,force:true});}
}

for(const [flow,step] of [['douyin_video_discovery','101'],['douyin_video_processing','102']])test('MMV '+step+' freezes exact company/account before any phone command and uses verified adb',async()=>{
 const r=await preflight({flow});assert.ifError(r.error);assert.equal(r.result.douyin_id,account);
 assert.equal(r.requests.length,1);assert.equal(r.requests[0].op,'company_config');assert.equal(r.requests[0].step,step);
 assert.deepEqual(r.requests[0].device_binding,{profile,device_serial:serial});
 assert.ok(r.calls.some(c=>c.command==='/approved/adb'));assert.ok(!r.calls.some(c=>c.command==='adb'));
 assert.equal(JSON.parse(r.evidence).device_binding.run_id,run);
});
for(const [name,receipt] of Object.entries({draft:new Error('COMPANY_CONFIG_NOT_ENABLED: snapshot'),missing:{...company},foreign_company:{...company,device_binding:{...binding,company_id:'company-b'}},foreign_tenant:{...company,device_binding:{...binding,tenant_id:'tenant-b'}},stale_version:{...company,device_binding:{...binding,version:6}},stale_run:{...company,device_binding:{...binding,run_id:'another-run'}},wrong_profile:{...company,device_binding:{...binding,profile:'foreign-profile'}},wrong_serial:{...company,device_binding:{...binding,device_serial:'foreign-serial'}},unverified:{...company,device_binding:{...binding,verification_status:'draft'}},disabled:{...company,device_binding:{...binding,enabled:false}}}))test('MMV missing or mismatched company binding blocks before all device actions: '+name,async()=>{
 const r=await preflight({receipt});assert.ok(r.error,name);assert.equal(r.calls.length,0,'must reject before adb, lock or gestures');
});
test('MMV actual globally registered login must equal this company frozen account',async()=>{
 const r=await preflight({observed:'another-global-account'});assert.match(r.error?.message||'',/COMPANY_ACCOUNT_IDENTITY_MISMATCH/);
});
for(const opts of [{host:'xian-m4',flag:'1'},{host:'mmv',flag:''}])test('legacy phone path does not gain MMV-only company semantics '+JSON.stringify(opts),async()=>{
 const r=await preflight(opts);assert.ifError(r.error);assert.equal(r.requests.length,0);assert.ok(r.calls.some(c=>c.command==='adb'));
});

const snapshot=()=>({...company,runtime_config:{platform_accounts:[{profile,device_serial:serial,douyin_id:account,verification_status:'verified',enabled:true}]} });
async function configRequest(change=s=>s,input={}){
 let frozen;
 const result=await queueRequest({}, {op:'company_config',line:'jinuo',run,step:'101',device_binding:{profile,device_serial:serial},...input},{freezeCompanyConfig:async(_pool,args)=>{frozen=args;return change(snapshot());}});
 return {result,frozen};
}
test('real company_config returns only same-run scoped verified binding, using original freeze',async()=>{
 const r=await configRequest();assert.deepEqual(r.result.device_binding,binding);assert.equal(r.result.runtime_config,undefined);
 assert.deepEqual(r.frozen,{lineHint:'jinuo',runId:run,sourceRun:null,step:'101'});
});
for(const [name,change] of Object.entries({missing:s=>({...s,runtime_config:{}}),disabled:s=>{s.runtime_config.platform_accounts[0].enabled=false;return s;},draft:s=>{s.runtime_config.platform_accounts[0].verification_status='draft';return s;},wrong_serial:s=>{s.runtime_config.platform_accounts[0].device_serial='other';return s;},foreign_profile:s=>{s.runtime_config.platform_accounts[0].profile='other';return s;},duplicate:s=>{s.runtime_config.platform_accounts.push({...s.runtime_config.platform_accounts[0]});return s;}}))test('real company binding request rejects '+name,async()=>{await assert.rejects(()=>configRequest(change),/COMPANY_ACCOUNT_DEVICE_NOT_VERIFIED/);});
test('legacy company_config 101 response retains original business shape',async()=>{
 const r=await configRequest(s=>s,{device_binding:undefined});assert.equal(r.result.device_binding,undefined);assert.equal(r.result.runtime_config,undefined);
});
test('MMV101 preflight preserves the real keyword freeze taskInputs instead of freezing an empty request first',async()=>{
 let frozenInputs;const operations=[];
 const deps={freezeCompanyConfig:async(_pool,args)=>{
  const inputs=args.taskInputs||{};
  if(frozenInputs===undefined)frozenInputs=structuredClone(inputs);
  else if(args.taskInputs!==undefined)assert.deepEqual(inputs,frozenInputs,'COMPANY_TASK_INPUTS_CHANGED');
  return {...snapshot(),runtime_config:{...snapshot().runtime_config,search_strategy:{keywords:['AI']}}};
 }};
 const r=await preflight({rpcImpl:async body=>{
  operations.push(body.kind==='keywords'?'keywords':body.request.op);
  if(body.kind==='keywords'){const v=await companyKeywords({}, {lineHint:body.line,runId:body.run,limit:body.limit,keywords:body.keywords},deps);return {result:v.keywords,config:v.config};}
  return {result:await queueRequest({},body.request,deps)};
 }});
 assert.ifError(r.error);assert.deepEqual(operations,['keywords','company_config']);
 assert.deepEqual(frozenInputs,{keywords:null,limit:2});
});
