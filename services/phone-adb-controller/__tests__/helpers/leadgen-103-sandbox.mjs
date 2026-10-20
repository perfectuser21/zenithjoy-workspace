#!/usr/bin/env node
// QA 专用临时 PG 协议替身；通过真实 handleRpc/queueRequest/judgeComment 执行业务判定。
import {readFileSync,writeFileSync,existsSync,mkdirSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {handleRpc} from '../../leadgen-rpc.mjs';
import routes from '../../line-routes.js';

const hash=v=>createHash('sha256').update(v).digest('hex');
const argv=process.argv.slice(2),mode=argv[0],option=name=>argv[argv.indexOf(name)+1];
if(!['score','score_readback','policy_review','score_scope','score_recovery','mark_leads','mark_readback',
 'bridge_outreach','bridge_readback','claim_outreach','prepare_outreach'].includes(mode)||!argv.includes('--output'))throw Error('SANDBOX_ARGS_INVALID');
const output=option('--output');if(!output||output.startsWith('--'))throw Error('SANDBOX_OUTPUT_INVALID');
if(!existsSync(output))mkdirSync(output,{recursive:true});
const stateFile=join(output,'state.json');let state;
if(existsSync(stateFile))state=JSON.parse(readFileSync(stateFile,'utf8'));
else{if(!argv.includes('--fixture'))throw Error('SANDBOX_FIXTURE_REQUIRED');
 state=JSON.parse(readFileSync(option('--fixture'),'utf8'));state.calls=[];state.requests=[];
 if(!Array.isArray(state.rows)||!state.snapshot||!state.run||!state.source_run)throw Error('SANDBOX_FIXTURE_INVALID');
 state.snapshot.runtime_config.policy_id=state.snapshot.runtime_config.policy_id||state.snapshot.policy_id;
 state.snapshot.config_status='enabled';
}
state.leads||=[];state.outbox||=[];state.orders||=[];
const snapshot=state.snapshot,rows=state.rows,scope={line:state.line||'jinuo',run:state.run,source_run:state.source_run,
 limit:Number(state.limit||1)};
const route=routes.routeOf(scope.line);const pending=[];let before=null;const client={release(){},async query(sql,args=[]){state.calls.push({sql:sql.replace(/\s+/g,' ').trim(),args});
 if(sql==='BEGIN'){pending.length=0;before=structuredClone({rows:state.rows,leads:state.leads,outbox:state.outbox});return {rows:[]};}
 if(sql==='COMMIT'){for(const fn of pending)fn();pending.length=0;before=null;return {rows:[]};}
 if(sql==='ROLLBACK'){pending.length=0;if(before){rows.splice(0,rows.length,...before.rows);state.leads=before.leads;state.outbox=before.outbox;}before=null;return {rows:[]};}
 if(sql.includes('tenant_company_profiles')&&sql.includes('company_id FROM'))return {rows:[{company_id:snapshot.company_id}]};
 if(sql.includes('company_config_runs')&&sql.includes('company_id=$1'))return {rows:[{snapshot,source_run:state.source_run,task_inputs:{}}]};
 if(sql.includes('company_config_runs'))return {rows:[{snapshot,run_id:args[0],company_id:snapshot.company_id,tenant_id:snapshot.tenant_id,version:snapshot.version}]};
 if(sql.includes('SELECT id FROM zenithjoy.leadgen_comments'))return {rows:rows.filter(r=>r.harvest_batch===args[1]).map(r=>({id:r.id}))};
 if(sql.includes('SELECT id,harvest_batch,line_key,relevance'))return {rows:rows.filter(r=>r.harvest_batch===args[1]&&args[2].includes(r.id))};
 if(sql.includes('SELECT * FROM zenithjoy.leadgen_comments')){
  if(sql.includes('FOR UPDATE'))return {rows:rows.filter(r=>r.line_key===args[0]&&r.harvest_batch===args[1]&&r.process_status==='待分拣'
    &&(sql.includes('relevance IS NOT NULL')?r.relevance!=null:r.relevance==null)
    &&!(args[2]||[]).includes(r.id)&&(!args[5]||args[5].includes(r.id))&&(!args[3]||new Date(r.collected_at)>new Date(args[3])||new Date(r.collected_at).getTime()===new Date(args[3]).getTime()&&r.id>args[4]))
    .sort((a,b)=>new Date(a.collected_at)-new Date(b.collected_at)||a.id.localeCompare(b.id)).slice(0,1)};
  if(sql.includes('id=ANY'))return {rows:rows.filter(r=>r.line_key===args[0]&&args[1].includes(r.id)&&r.harvest_batch===args[2])};
  return {rows:rows.filter(r=>r.line_key===args[0]&&r.id===args[1])};
 }
 if(sql.includes('leadgen_videos'))return {rows:[{video_id:state.video?.video_id||'7617837149999841201',
  video_url:state.video?.video_url||rows[0].source_video_url,title:state.video?.title||rows[0].source_video,
  line_key:scope.line,judgment_status:'matched'}]};
 if(sql.includes('UPDATE zenithjoy.leadgen_comments')){
  if(sql.includes("process_status = '已分拣'")){const row=rows.find(r=>r.line_key===args[0]&&r.dedup_key===args[1]);
    if(row)pending.push(()=>{row.process_status='已分拣';});return {rows:[],rowCount:row?1:0};}
  pending.push(()=>{const row=rows.find(r=>r.id===args[0]);Object.assign(row,{relevance:args[1],intent_grade:args[2],
   judgment_reason:args[3],judgment_config:JSON.parse(args[4])});});return {rows:[],rowCount:1};}
 if(sql.includes('SELECT id,relevance,intent_grade,process_status'))return {rows:rows.filter(r=>args[1].includes(r.id))};
 if(sql.includes('pg_advisory_xact_lock'))return {rows:[{pg_advisory_xact_lock:null}]};
 if(sql.includes('SELECT id, dup_hit_count FROM zenithjoy.leadgen_leads'))return {rows:state.leads.filter(r=>r.line_key===args[0]&&(r.nickname===args[1]||r.douyin_id===args[2]))};
 if(sql.includes('INSERT INTO zenithjoy.leadgen_leads')){const lead={id:randomUUID(),line_key:args[0],nickname:args[1],douyin_id:args[2],profile_url:args[3],dup_hit_count:0};state.leads.push(lead);return {rows:[{id:lead.id}],rowCount:1};}
 if(sql.includes('SELECT id,line_key,douyin_id FROM zenithjoy.leadgen_leads'))return {rows:state.leads.filter(r=>r.line_key===args[0]&&r.id===args[1])};
 if(sql.includes('SELECT id FROM zenithjoy.leadgen_leads'))return {rows:state.leads.filter(r=>r.line_key===args[0]&&args[1].includes(r.id))};
 if(sql.includes('INSERT INTO zenithjoy.leadgen_bridge_outbox')){if(!state.outbox.some(r=>r.line_key===args[0]&&r.comment_id===args[1])){
  state.outbox.push({id:randomUUID(),line_key:args[0],comment_id:args[1],lead_id:args[2],run_tag:args[3],source_run:args[4],
   payload:JSON.parse(args[5]),payload_sha256:args[6],qualification_status:args[7],state:'pending'});}return {rows:[],rowCount:1};}
 if(sql.includes('SELECT * FROM zenithjoy.leadgen_bridge_outbox')){
  if(sql.includes('feishu_record_id=ANY'))return {rows:state.outbox.filter(r=>r.line_key===args[0]&&args[1].includes(r.feishu_record_id))};
  if(sql.includes('feishu_record_id=$2'))return {rows:state.outbox.filter(r=>r.line_key===args[0]&&r.feishu_record_id===args[1])};
  if(sql.includes('comment_id=ANY'))return {rows:state.outbox.filter(r=>r.line_key===args[0]&&args[1].includes(r.comment_id)&&r.run_tag===args[2])};
  if(sql.includes('id=ANY'))return {rows:state.outbox.filter(r=>r.line_key===args[0]&&args[1].includes(r.id))};
  return {rows:state.outbox.filter(r=>r.line_key===args[0]&&['pending','attempted','unknown'].includes(r.state))};
 }
 if(sql.includes('UPDATE zenithjoy.leadgen_bridge_outbox')){const row=state.outbox.find(r=>r.line_key===args[0]&&r.id===args[1]);if(!row)return {rows:[],rowCount:0};
  if(sql.includes("state='attempted'")){row.state='attempted';row.fields=JSON.parse(args[2]);row.fields_sha256=args[3];row.attempted_at=new Date().toISOString();}
  else if(sql.includes("state='confirmed'")){row.state='confirmed';row.feishu_record_id=args[2];}
  else if(sql.includes("state='protected'")){row.state='protected';row.feishu_record_id=args[2];}
  else if(sql.includes('state=$3'))row.state=args[2];return {rows:[row],rowCount:1};}
 throw Error('SANDBOX_SQL_UNSUPPORTED');
}};
const pool={connect:async()=>client,query:(...args)=>client.query(...args)};
const previousFetch=globalThis.fetch,previousHome=process.env.HOME,previousCredential=process.env.LEADGEN_FEISHU_CREDENTIALS;
process.env.OPENROUTER_API_KEY='sandbox-only';process.env.HOME=output;
const cred=join(output,'feishu-sandbox-credentials.json');writeFileSync(cred,JSON.stringify({[route.account]:{appId:'sandbox-app',appSecret:'sandbox-only'}}),{mode:0o600});
process.env.LEADGEN_FEISHU_CREDENTIALS=cred;
globalThis.fetch=async(url,opts={})=>{const parsed=new URL(url);
 if(parsed.hostname==='open.feishu.cn'){
  const path=parsed.pathname,method=opts.method||'GET';let data;
  if(path.includes('tenant_access_token'))data={code:0,tenant_access_token:'sandbox-token'};
  else if(path.includes(`/tables/${route.script}/records`))data={code:0,data:{items:[{record_id:'recSCRIPT123',fields:{'启用状态':'启用','子版本':'B','话术ID':state.template?.id||'sandbox-approved',
   '话术正文':state.template?.message||'你好，请查看资料'}}],has_more:false}};
  else if(path.endsWith('/fields'))data={code:0,data:{items:[{field_name:'采集时间',type:1}],has_more:false}};
  else if(path.includes(`/tables/${route.lead}/records`)){
   const id=path.split('/records/')[1];
   if(method==='POST'){const fields=JSON.parse(opts.body).fields,record={record_id:`recSANDBOX${state.orders.length+1}ABC`,fields};state.orders.push(record);data={code:0,data:{record}};}
   else if(method==='PUT'){const record=state.orders.find(r=>r.record_id===id);if(!record)throw Error('SANDBOX_ORDER_MISSING');Object.assign(record.fields,JSON.parse(opts.body).fields);data={code:0,data:{record}};}
   else if(id){const record=state.orders.find(r=>r.record_id===id);data={code:0,data:{record}};}
   else data={code:0,data:{items:state.orders,has_more:false}};
  }else throw Error('SANDBOX_FEISHU_PATH_INVALID');
  state.requests.push({path,method,provider:'feishu'});return new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
 }
 if(parsed.hostname!=='openrouter.ai')throw Error('SANDBOX_NETWORK_BLOCKED');
 const body=JSON.parse(opts.body),text=body.state||body.messages?.[0]?.content||'';
 const match=rows.find(r=>text.includes(r.comment_body));if(!match)throw Error('SANDBOX_UNMATCHED_COMMENT');
 const response=match.response;if(!response)throw Error('SANDBOX_RESPONSE_REQUIRED');
 state.requests.push({path:parsed.pathname,model:body.model,case_id:match.id,request_sha256:hash(opts.body)});
 let result;
 if(parsed.pathname==='/api/alpha/decisions')result={id:`jev-${match.id}`,model:body.model,answers:body.questions?.recipient
   ?{recipient:{choice:response.recipient_choice||'unknown',confidence:.99}}
   :{grade:{choice:response.primary_grade,confidence:response.primary_confidence??.99}}};
 else if(parsed.pathname==='/api/v1/chat/completions'){
  const evidence=response.policy_evidence;
  result={id:`commander-${match.id}`,model:body.model,choices:[{message:{content:response.raw||`\`\`\`json\n${JSON.stringify({grade:response.policy_grade,policy_evidence:evidence})}\n\`\`\``}}]};
 }else throw Error('SANDBOX_ENDPOINT_INVALID');
 return new Response(JSON.stringify(result),{status:200,headers:{'content-type':'application/json'}});
};
try{
 const run=['mark_leads','mark_readback','bridge_outreach','bridge_readback'].includes(mode)?state.mark_run||scope.run:
  ['claim_outreach','prepare_outreach'].includes(mode)?state.contact_run||'contact104':scope.run;
 const fields=mode==='score_recovery'?{ids:rows.map(r=>r.id)}:mode==='policy_review'?{claim:scope.run,ids:rows.filter(r=>r.judgment_config?.run_id===scope.run).map(r=>r.id)}:
  mode==='score_readback'||mode==='mark_readback'?{ids:rows.filter(r=>mode==='mark_readback'
   ?r.process_status==='已分拣'&&state.outbox.some(o=>o.comment_id===r.id&&o.run_tag===run)
   :r.judgment_config?.run_id===scope.run).map(r=>r.id),
   lead_ids:mode==='mark_readback'?state.leads.map(l=>l.id):undefined}:
  mode==='bridge_readback'?{ids:state.outbox.map(r=>r.id)}:
  mode==='claim_outreach'?{profile:state.profile||'legacy',sender_douyin_id:state.sender_douyin_id||'sandbox-sender',limit:1}:
  mode==='prepare_outreach'?{id:state.claim?.id,profile:state.profile||'legacy',sender_douyin_id:state.sender_douyin_id||'sandbox-sender',
   script_id:state.claim?.script_id,script_version:state.claim?.script_version,message_sha256:state.claim?.message?hash(state.claim.message):null,
   target_douyin_id:state.claim?.douyin_id,profile_url:state.claim?.profile_url}:{};
 const input={kind:mode.endsWith('_outreach')&&mode!=='bridge_outreach'?'outreach':'queue',
  source:{commit:'a'.repeat(40),files:[{path:'leadgen-queue.js',sha256:hash(readFileSync(new URL('../../leadgen-queue.js',import.meta.url)))}]},
  request:{op:mode,...scope,run,source_run:scope.source_run,...fields}};
 const result=await handleRpc(input,{pool,verify:source=>{if(source?.commit!=='a'.repeat(40)||!source.files?.length)throw Error('SANDBOX_SOURCE_INVALID');}});
 if(mode==='claim_outreach')state.claim=result.result?.[0]||null;
 writeFileSync(stateFile,JSON.stringify(state,null,2),{mode:0o600});
 process.stdout.write(JSON.stringify({result:result.result,rows:rows.map(r=>({id:r.id,harvest_batch:r.harvest_batch,relevance:r.relevance??null,
  intent_grade:r.intent_grade??null,process_status:r.process_status,judgment_config:r.judgment_config||null})),
  outbox:state.outbox,orders:state.orders,requests:state.requests})+'\n');
}catch(error){writeFileSync(stateFile,JSON.stringify(state,null,2),{mode:0o600});process.stdout.write(JSON.stringify({error:error.message,
 rows:rows.map(r=>({id:r.id,relevance:r.relevance??null,process_status:r.process_status})),requests:state.requests})+'\n');process.exitCode=1;}
finally{globalThis.fetch=previousFetch;process.env.HOME=previousHome;
 if(previousCredential===undefined)delete process.env.LEADGEN_FEISHU_CREDENTIALS;else process.env.LEADGEN_FEISHU_CREDENTIALS=previousCredential;}
