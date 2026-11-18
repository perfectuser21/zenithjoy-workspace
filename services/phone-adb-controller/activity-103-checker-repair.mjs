// Convert only a proven, stopped 103 pre-dispatch mistake into bounded checker feedback.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const identityKeys=['task_id','run_id','run_tag','workflow','activity','attempt'];
const checks=['existing_score_readback','lead_identity_and_scope','persisted_leads','delivery_readback'];
const readonly=new Set(['policy_review','score_readback','mark_readback','bridge_readback']);
const allowed=['bridge_outreach','bridge_readback','mark_leads','mark_readback','policy_review','score_readback'];
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const need=v=>{if(!v)throw Error('REPAIR_NOT_PROVEN');};
export function configure103CheckerRepair(contract){
 need(contract?.workflow==='douyin-leadgen-103'&&Array.isArray(contract.activities)
   &&contract.activities.filter(a=>a.key==='mark_leads').length===1);
 const value=structuredClone(contract),activity=value.activities.find(a=>a.key==='mark_leads');
 need(activity.runtime?.executor_kind==='agent');
 need(activity.runtime.checker_repair===undefined||equal(activity.runtime.checker_repair,{max_attempts:2,retry_safe:true}));
 activity.runtime.checker_repair={max_attempts:2,retry_safe:true};return value;
}
export function configure103HostManifest(manifest,{hostRoot}={}){
 need(typeof hostRoot==='string'&&fs.realpathSync(hostRoot)===path.resolve(hostRoot));
 const source=JSON.parse(fs.readFileSync(path.join(hostRoot,'tool-host-103.json'),'utf8'));
 need(source.schema==='activity-103-tool-host/v1'&&manifest?.profile?.files&&manifest?.run?.contract);
 need(equal(Object.keys(source.sha256).sort(),['TOOLS.txt','activity-103-checker-repair.mjs','activity-103-tool-host.py','activity-tool-result.py','checker.mjs','repair-runtime.json','tool_scope.py','tools.py'].sort()));
 const result=structuredClone(manifest);result.run.contract=configure103CheckerRepair(result.run.contract);
 for(const [name,expected]of Object.entries(source.sha256)){
  need(path.basename(name)===name);const file=path.join(hostRoot,name);need(!fs.lstatSync(file).isSymbolicLink());
  const actual=createHash('sha256').update(fs.readFileSync(file)).digest('hex');need(actual===expected);result.profile.files[name]=actual;
 }
 result.profile.files['tool-host-103.json']=createHash('sha256').update(fs.readFileSync(path.join(hostRoot,'tool-host-103.json'))).digest('hex');
 return result;
}
function readOwned(file){
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{const s=fs.fstatSync(fd);need(s.isFile()&&s.nlink===1&&s.uid===process.getuid()&&!(s.mode&0o077)&&s.size<8*1024*1024);return JSON.parse(fs.readFileSync(fd,'utf8'));}
 finally{fs.closeSync(fd);}
}
function observedMissing(request,observed,readbackSource){
 need(request.phase==='end'&&request.activity==='mark_leads'&&request.workflow==='103'&&observed.outcome==='blocked');
 need(observed.nonce===request.nonce&&Object.keys(observed.identity).length===identityKeys.length&&identityKeys.every(k=>observed.identity[k]===request[k]));
 need(Array.isArray(request.checks)&&request.checks.length===checks.length&&checks.every(k=>request.checks.includes(k)));
 need(Array.isArray(observed.checks)&&observed.checks.length===checks.length&&checks.every(k=>observed.checks.filter(c=>c.id===k).length===1));
 const scope=request.context.verification['103'].comment_ids;
 need(Array.isArray(scope)&&scope.length>0&&scope.length<=50&&new Set(scope).size===scope.length&&scope.every(x=>typeof x==='string'&&x));
 need(equal(observed.output.comment_ids,scope)&&equal(observed.output.outbox_states,[]));
 const by=Object.fromEntries(observed.checks.map(c=>[c.id,c]));
 for(const c of observed.checks)need(Array.isArray(c.evidence)&&c.evidence.length===1&&typeof c.evidence[0].source==='string'&&c.evidence[0].source&&c.evidence[0].observation);
 const stored=by.existing_score_readback.evidence[0].observation.stored;
 need(by.existing_score_readback.status==='passed'&&Array.isArray(stored)&&stored.length===scope.length&&scope.every(id=>stored.filter(x=>x.id===id&&x.status==='pass').length===1));
 const lead=by.lead_identity_and_scope.evidence[0].observation;
 const outbox=by.persisted_leads.evidence[0].observation;
 need(by.lead_identity_and_scope.status==='failed'&&equal(lead.comment_ids,scope)&&equal(lead.lead_ids,[]));
 need(by.persisted_leads.status==='failed'&&equal(outbox.lead_ids,[])&&equal(outbox.outbox_ids,[]));
 const delivery=by.delivery_readback;
 // Network/identity/readback failures are never translated into a known absent delivery.
 need(delivery.status==='unknown'&&delivery.evidence[0].source===readbackSource
   &&equal(delivery.evidence[0].observation,{reason:'not_yet_verified'}));
 return scope;
}
function stopped(root,request){
 const id=request.context.action_id;need(/^[a-f0-9]{64}$/.test(id));
 need(typeof request.run_id==='string'&&/^[A-Za-z0-9_-]+$/.test(request.run_id));
 const directory=path.join(root,'control',request.run_id,'actions',id);
 need(fs.realpathSync(directory)===path.resolve(directory));
 const m=readOwned(path.join(directory,'manifest.json')),r=readOwned(path.join(directory,'result.json'));
 need(m.protocol==='activity-supervisor/v1'&&r.protocol==='activity-supervisor-result/v1'&&r.nonce===m.nonce&&r.deadline===m.deadline&&equal(r.binding,m.binding));
 need(m.binding.task_id===request.task_id&&m.binding.run_id===request.run_id&&m.binding.activity_key===request.activity&&m.binding.action_id===id);
 const t=r.transport;need(r.transport_sha256===digest(t)&&t.exit_code===0&&!t.exit_signal&&!t.reason_code&&typeof t.stdout==='string'
   &&t.execution_stopped!==false&&t.external_effect!=='unknown'&&Number.isSafeInteger(t.started_at_ms)&&Number.isSafeInteger(t.ended_at_ms)&&t.ended_at_ms>=t.started_at_ms);
 return {directory,started:t.started_at_ms,ended:t.ended_at_ms};
}
function safeReceipts(root,request,stop){
 const directory=path.join(root,'receipts');need(fs.realpathSync(directory)===path.resolve(directory));
 const names=fs.readdirSync(directory).filter(n=>n.endsWith('.json'));need(names.length>0&&names.length<=512);
 let rejected=0,matched=0;const evidence=[];
 for(const name of names){
  const r=readOwned(path.join(directory,name));need(r.state==='terminal');
  const b=r.binding;need(b&&['task_id','run_id','run_tag'].every(k=>b.identity?.[k]===request[k]));
  if(b.activity!==request.activity)continue;
  need(b.kind==='business'&&Array.isArray(b.args)&&b.args.length===1);
  const i=JSON.parse(b.args[0]);need(i&&typeof i.op==='string');
  need(Number.isFinite(r.started_at)&&Number.isFinite(r.ended_at)&&r.started_at*1000>=stop.started&&r.ended_at*1000<=stop.ended&&r.ended_at>=r.started_at);
  const result=r.result,data=result?.data;matched++;
  if(result?.exit_code===2&&result.error==='BUSINESS_ACTIVITY_SCOPE'&&data?.phase==='pre_dispatch'
    &&data.dispatched===false&&data.external_effect==='none'&&data.activity===request.activity
    &&Array.isArray(data.allowed_operations)&&equal([...data.allowed_operations].sort(),allowed)&&!allowed.includes(i.op))rejected++;
  else need(result?.exit_code===0&&readonly.has(i.op));
  evidence.push({source:path.join(directory,name),observation:{operation:i.op,state:r.state,exit_code:result.exit_code,dispatched:result.exit_code===2?false:true}});
 }
 need(matched>0&&rejected>0);return evidence;
}
export async function repair103Readback(request,observed,{root,readbackSource='production-readback'}={}){
 try{
  need(typeof root==='string'&&fs.realpathSync(root)===path.resolve(root));
  need(readbackSource==='production-readback'||readbackSource==='scratch:delivery-disabled'
    &&request.context.sandbox===true&&request.context.sandbox_database==='cecelia_scratch');
  const scope=observedMissing(request,observed,readbackSource),stop=stopped(root,request),evidence=safeReceipts(root,request,stop);
  const output=structuredClone(observed);output.outcome='failed';output.retryable=true;output.external_effect='none';
  for(const c of output.checks){
   if(c.id==='existing_score_readback')continue;
   c.status='failed';c.expected=c.id==='delivery_readback'?'confirmed_delivery':'persisted_lead_and_outbox';
   c.actual=c.id==='delivery_readback'?'not_created':{comment_ids:scope,lead_ids:[],outbox_ids:[]};
   c.reason='本Activity只有已确认的只读调用或执行前拒绝，目标尚未创建。按当前允许操作纠正，不重评：'+allowed.join(', ');
   c.evidence.push(...evidence,{source:path.join(stop.directory,'result.json'),observation:{execution_stopped:true,exit_code:0}});
  }
  return output;
 }catch{return observed;}
}
