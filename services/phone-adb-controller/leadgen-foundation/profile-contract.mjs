// The registered B contract is authoritative; this projection contains no business rules.
import{createHash}from'node:crypto';
import{generateAcceptance,verifyAcceptance}from'./contract-acceptance.mjs';
import{FACT_TOOL_DESCRIPTION}from'./checker-facts.mjs';
const canonical=x=>JSON.stringify(x,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const need=x=>{if(!x)throw Error('PROFILE_CONTRACT');};
const emptyAllowed=a=>Array.isArray(a.failure.empty_ok)&&a.failure.empty_ok.length>0&&a.failure.empty_ok.every(x=>typeof x==='string'&&x.trim());
const foundationPrefix='services/phone-adb-controller/leadgen-foundation/';
const agentEntry=foundationPrefix+'worker.mjs';
const lightweightEntry=foundationPrefix+'lightweight-101-worker.mjs';
export const lightweight101Tool='light101-discover';
export function lightweight101Entry(profile,workflow){
 const variant=profile.leadgen?.discovery_variant;
 if(variant===undefined)return undefined;
 need(variant==='lightweight-host-script-v1'&&workflow==='douyin_video_discovery'
  &&/^[a-f0-9]{64}$/.test(profile.files?.[lightweightEntry]??''));
 return lightweightEntry;
}
function declaredHostTools(activities,lightweight){
 const requirements=activities.map(a=>a.acceptance.document.required_host_tools);
 if(requirements.every(required=>required===undefined))return undefined;
 need(requirements.every(required=>Array.isArray(required)));
 return [...new Set([...requirements.flat(),...(lightweight?[lightweight101Tool]:[])])].sort();
}
export function projectAgentProfile(original,{documents,workflow}){
 const result=structuredClone(original),authority=documents[workflow];need(authority&&result.contract.workflow===workflow);
 const lightweight=lightweight101Entry(result.profile,workflow);
 const previous=new Map(result.contract.activities.map(a=>[a.key,a]));
 result.contract.activities=authority.activities.map((slot,index)=>{
  const key=slot.key??slot.ref.split('.')[1],acceptance=generateAcceptance({documents,workflow,activity:key}),document=acceptance.document,old=previous.get(key);need(old&&result.profile.skill_runtime.activities[key]);
  const runtime={...old.runtime,protocol:'json-stdio-v1',entry:agentEntry,executor_kind:'agent'};
  const spec=result.profile.skill_runtime.activities[key];
  // No duplicated check-ID table. The adapter binds the installed Node identity and per-run provider.
  spec.checker={mode:'agent',timeout_ms:spec.checker.timeout_ms,evidence:{roots:['checker-input','native','receipts','qualification-receipts','collection-evidence-receipts','outreach-receipts'],provider:{command:'@node',entry:'checker-facts-entry.mjs',timeout_ms:120000,description:FACT_TOOL_DESCRIPTION}}};
  if(workflow==='douyin_video_processing'&&key==='collection')spec.stop_checker={command:'@node',entry:'collection-stop-entry.mjs',timeout_ms:45000};
  spec.allow_empty=!!emptyAllowed(document);
  return{key,order:index+1,budget:structuredClone(document.budget),acceptance,failure:structuredClone(document.failure),runtime};
 });
 const tools=declaredHostTools(result.contract.activities,lightweight);
 if(tools!==undefined)result.profile.skill_runtime.host_tools.kinds=tools;
 result.profile.leadgen.contract_sha256=createHash('sha256').update(canonical(result.contract)).digest('hex');
 return result;
}
export function verifyAgentProfile(document,{documents,workflow}){
 need(document.contract.workflow===workflow);
 verifyBoundContract(document.contract,document.profile);
 const lightweight=lightweight101Entry(document.profile,workflow);
 const tools=declaredHostTools(document.contract.activities,lightweight);
 if(tools!==undefined)need(canonical(tools)===canonical(document.profile.skill_runtime.host_tools?.kinds));
 const slots=documents[workflow].activities.map(x=>x.key??x.ref.split('.')[1]);need(document.contract.activities.length===slots.length);
 for(const [i,a]of document.contract.activities.entries()){
  need(a.key===slots[i]&&a.order===i+1);verifyAcceptance(a.acceptance,{documents,workflow,activity:a.key});
  need(canonical(a.budget)===canonical(a.acceptance.document.budget)&&canonical(a.failure)===canonical(a.acceptance.document.failure));
  need(a.runtime.executor_kind==='agent'&&a.runtime.protocol==='json-stdio-v1'&&a.runtime.entry===agentEntry);
  const spec=document.profile.skill_runtime.activities[a.key],checker=spec?.checker;
  need(spec&&spec.allow_empty===!!emptyAllowed(a.acceptance.document)&&checker?.mode==='agent'&&!('start_checks'in checker)&&!('required_checks'in checker)&&!('entry'in checker)&&!('command'in checker));
 }
 return true;
}

export function verifyBoundContract(contract,profile){need(createHash('sha256').update(canonical(contract)).digest('hex')===profile.leadgen.contract_sha256);return true;}
