// Parse original native command evidence. No UI keywords, bubble counts or business acceptance.
import fs from'node:fs';import path from'node:path';import{createHash}from'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('hex'),need=(x,c)=>{if(!x)throw Error(c);};
const canonical=x=>JSON.stringify(x,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
function asset(a){need(a&&path.isAbsolute(a.path),'ASSET_PATH');const s=fs.lstatSync(a.path);need(s.isFile()&&!s.isSymbolicLink()&&s.size<=30*1024*1024,'ASSET_PATH');const bytes=fs.readFileSync(a.path);need(hash(bytes)===a.sha256,'ASSET_HASH');return bytes;}
const object=a=>JSON.parse(asset(a));
function fields(stdout){const result={};for(const line of String(stdout??'').split('\n')){const m=line.match(/^([A-Za-z_][A-Za-z_0-9]*)=(.*)$/);if(m){need(result[m[1]]===undefined||result[m[1]]===m[2],'DUPLICATE_NATIVE_FIELD');result[m[1]]=m[2];}}return result;}
const response=r=>r.response??r;
const millis=x=>typeof x==='number'?x:Date.parse(x);
function receipt(a,s){const r=object(a);for(const key of ['task_id','run_id','profile','serial'])need(r[key]===s[key],'NATIVE_RECEIPT_SCOPE');const start=millis(r.started_at),end=millis(r.finished_at);need(Number.isFinite(start)&&end>=start,'NATIVE_RECEIPT_TIME');return{receipt:r,reported_fields:fields(response(r).stdout)};}
function artifacts(e){const out={};for(const [key,spec]of Object.entries(e)){if(!spec?.path||!spec.sha256)continue;const bytes=asset(spec);out[key]={path:spec.path,sha256:hash(bytes),bytes:bytes.length};if(/\.(?:xml|json|txt|log)$/.test(spec.path))out[key].text=bytes.toString('utf8');}return out;}
export function readPreflightFacts(e,scope){
 e=e.preflight??e;const account=receipt(e.sender_account,scope),device=receipt(e.device_preflight,scope),risk=receipt(e.risk_receipt,scope);
 return{source_verified:true,account,device,risk_receipt:risk,artifacts:artifacts(e)};
}
export function readSendFacts(e,scope,auth,artifactDir,c){
 e=e.native??e;need(path.resolve(e.invocation.path)===path.resolve(artifactDir,'phone-invocation.json'),'INVOCATION_PATH');const inv=object(e.invocation);
 need(inv.schema==='leadgen104-native-invocation-v1'&&inv.action_key===hash(canonical(scope)),'INVOCATION_KEY');
 for(const key of ['task_id','run_id','run_tag','profile','serial','sender_id','target_douyin_id','message_sha256','record_id','comment_id','profile_url'])need(inv[key]===scope[key],'INVOCATION_SCOPE');
 need(inv.state==='returned'&&inv.composite_invocations===1&&inv.tap_invocations===0&&inv.method==='private-message-send','INVOCATION_UNCONFIRMED');
 const start=millis(inv.started_at),end=millis(inv.finished_at);need(Number.isFinite(start)&&end>=start&&start<=c.business_deadline_ms&&end<=(c.cleanup_deadline_ms??c.business_deadline_ms),'INVOCATION_TIME');
 need(hash(auth.message)===scope.message_sha256&&typeof inv.evidence_id==='string'&&inv.evidence_id.startsWith(scope.run_tag+'-'),'INVOCATION_SCOPE');
 need(canonical(inv.composite_args)===canonical(['private-message-send',scope.sender_id,scope.target_douyin_id,Buffer.from(auth.message).toString('base64'),inv.evidence_id,scope.profile_url]),'COMPOSITE_ARGUMENTS');
 const r=response(inv);need((r.exit_code??r.code)===0,'COMPOSITE_NATIVE_FAILED');const f=fields(r.stdout);
 need(f.sender_douyin_id===scope.sender_id&&f.target_douyin_id===scope.target_douyin_id&&f.message_sha256===scope.message_sha256,'COMPOSITE_IDENTITY');
 return{source_verified:true,classification_source:'controller_report',outcome:['sent','restricted','rate_limited'].includes(f.send_status)?f.send_status:'unknown',reported_fields:f,receipt:inv,artifacts:artifacts(e),sent_at_ms:end,timestamp_basis:'native_command_completed_observed',actual_send_attempts:1};
}
