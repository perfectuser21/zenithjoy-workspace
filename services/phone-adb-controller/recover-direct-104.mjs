// Recover one verified direct send from its original Task, Feishu order and native receipt.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fetchBrainAuthorityGet} from './brain-authority-get.mjs';
import {readLeadResult,recoverDirectSentLead} from './activity-104-state.mjs';

const require=createRequire(import.meta.url);
const {orderClient,withOrderLock}=require('./leadgen-outreach-orders.js');
const {routeOf}=require('./line-routes.js');
const {getPool}=require('./leadgen-db-connect.js');
const {nativeIntent}=require('./leadgen-outreach-bridge.js');
const {readCollectionAccountBinding}=require('./company-config-lib.js');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const need=(condition,code)=>{if(!condition)throw Error(code);};
const uuid=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
function readReceipt(file){
 const st=fs.lstatSync(file);
 need(st.isFile()&&st.nlink===1&&!(st.mode&0o022)&&st.size<=2*1024*1024,'DIRECT_RECEIPT_FILE');
 return JSON.parse(fs.readFileSync(file,'utf8'));
}
async function brainGet(route){
 const token=process.env.CECELIA_INTERNAL_TOKEN;
 need(token,'BRAIN_TOKEN_MISSING');
 const response=await fetchBrainAuthorityGet('http://127.0.0.1:5221/api/brain/'+route,{headers:{'x-internal-token':token},timeoutMs:10000});
 need(response.ok,'BRAIN_READBACK_FAILED');
 return response.json();
}
async function main(){
 const [taskId,receiptDirectory,apply,...extra]=process.argv.slice(2);
 need(uuid.test(taskId||'')&&receiptDirectory&&path.isAbsolute(receiptDirectory)&&(!apply||apply==='--apply')&&!extra.length,
  'Usage: node recover-direct-104.mjs ORIGINAL_TASK_ID ABSOLUTE_RECEIPT_DIRECTORY [--apply]');
 const result=await brainGet('tasks/'+taskId),originalTask=result.task||result;
 need(originalTask.id===taskId&&originalTask.status==='completed','DIRECT_TASK_AUTHORITY');
 const directory=fs.realpathSync(receiptDirectory);
 const nativeFile=path.join(directory,'collection-native-result.json');
 need(originalTask.result?.evidence?.includes(nativeFile),'DIRECT_TASK_EVIDENCE');
 const c=readReceipt(path.join(directory,'context.json')),native=readReceipt(nativeFile);
 need(c.task_id===taskId&&uuid.test(c.decision_id),'DIRECT_TASK_SCOPE');
 const decisions=await brainGet('strategic-decisions?status=active&made_by=user&limit=50');
 need(decisions.data.some(row=>row.id===c.decision_id&&row.made_by==='user'),'DIRECT_DECISION_AUTHORITY');
 need(native.status==='sent'&&native.order_id===c.order_id&&native.message_delta_verified===true&&native.message_sha256===c.message_sha256&&native.delivery_verified===false,'DIRECT_NATIVE_RESULT');
 for(const key of ['chat','typed','sent','risk','send_foreground','risk_foreground','before_screenshot','after_screenshot']){
  const a=native.evidence?.[key];
  need(a&&path.isAbsolute(a.path)&&/^[a-f0-9]{64}$/.test(a.sha256),'DIRECT_NATIVE_EVIDENCE');
  const stat=fs.lstatSync(a.path);
  need(stat.isFile()&&stat.size>0&&stat.size<=30*1024*1024&&hash(fs.readFileSync(a.path))===a.sha256,'DIRECT_NATIVE_EVIDENCE');
 }
 need(native.evidence.send_foreground.mtime_ms===originalTask.result.status_detail.order.timestamp,'DIRECT_NATIVE_TIMESTAMP');
 const route=routeOf(c.line),pool=getPool();
 try{
  await withOrderLock(route.key,async()=>{
   const {rows}=await pool.query("SELECT * FROM zenithjoy.leadgen_bridge_outbox WHERE line_key=$1 AND feishu_record_id=$2 AND state='confirmed' AND qualification_status='passed'",[route.key,c.order_id]);
   need(rows.length===1,'DIRECT_OUTBOX_UNIQUE');
   const o=rows[0],p=o.payload;
   const binding=await readCollectionAccountBinding(pool,{lineKey:route.key,run:p.comment_run,sourceRun:p.recipient_evidence?.scope?.source_run});
   nativeIntent(o,{companyBinding:binding});
   const q=p.qualification;
   need(c.company_id===q.company_id&&p.target_douyin_id===c.target&&p.profile_url===c.profile_url,'DIRECT_CONTEXT_SCOPE');
   const scope={record_id:c.order_id,comment_id:o.comment_id,lead_id:o.lead_id,target_douyin_id:c.target,profile_url:c.profile_url,source_102_run:p.comment_run,source_103_run:p.scoring_run};
   const context={company_id:q.company_id,tenant_id:q.tenant_id,line:route.key,profile:c.profile,serial:c.serial,sender_id:c.account,source_commit:c.source,
    tasks:{104:{task_id:taskId,run_id:taskId,run_tag:c.tag}},verification:{104:scope,policy_id:q.policy_id,policy_version:Number(q.company_version)}};
   const api=await orderClient(route);
   const record=await api.get(c.order_id);
   const before=await readLeadResult({pool,context,scope});
   const recovered=await recoverDirectSentLead({pool,context,scope,record,originalTask,decisionId:c.decision_id,messageSha256:c.message_sha256,dryRun:!apply});
   console.log(JSON.stringify({order_id:c.order_id,before:before.lead.send_status,after:recovered.lead.send_status,changed:recovered.changed,dry_run:!apply}));
  });
 }finally{await pool.end();}
}
main().catch(error=>{console.error(error.code||(/^[A-Z_]+$/.test(error.message)?error.message:'DIRECT_RECOVERY_FAILED'));process.exitCode=1;});
