import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {singleHttpsRequest,officialSign,ownerOnlyAcl} from './asr-cos-http.mjs';
export const PRIVATE_COS_CONFIG=Object.freeze({schema:1,bucket:'zenithjoy-static-hk-1333590468',region:'ap-hongkong',prefix:'private/asr',acl:'private',sdk_version:'3.0.0',network_retries:0,max_bytes:32*1024*1024,max_audio_seconds:300,signature_seconds:180,retain_seconds:600,put_timeout_ms:30000,read_timeout_ms:30000,asr_timeout_ms:120000,cleanup_timeout_ms:10000,min_prepare_ms:15000,min_asr_ms:1000});
const endpoint='https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
const canonical=x=>JSON.stringify(Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))));
const sha=x=>createHash('sha256').update(x).digest('hex');
const need=(v,c)=>{if(!v)throw Error(c);};
function readAudio(file,config){
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
  const info=fs.fstatSync(fd);need(info.isFile()&&info.size>=44&&info.size<=config.max_bytes,'ASR_AUDIO_SIZE');
  const bytes=fs.readFileSync(fd);need(bytes.length===info.size&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WAVE','ASR_AUDIO_WAV');
  let rate=0,data=0;
  for(let i=12;i+8<=bytes.length;){const n=bytes.readUInt32LE(i+4),end=i+8+n;need(end<=bytes.length,'ASR_AUDIO_WAV');const kind=bytes.toString('ascii',i,i+4);if(kind==='fmt '){need(n>=16&&[1,3].includes(bytes.readUInt16LE(i+8)),'ASR_AUDIO_PCM');rate=bytes.readUInt32LE(i+16);}if(kind==='data')data+=n;i=end+(n%2);}
  need(rate>0&&data>0&&data/rate<=config.max_audio_seconds,'ASR_AUDIO_DURATION');return bytes;
 }finally{fs.closeSync(fd);}
}
export function createPrivateCosSource({config,scope,journalPath,deadlineMs,credentials,request=singleHttpsRequest,signer=officialSign,parseAcl=ownerOnlyAcl,now=Date.now}){
 need(canonical(config||{})===canonical(PRIVATE_COS_CONFIG),'ASR_COS_CONFIG_CHANGED');config={...config};scope={...scope};
 for(const k of ['task_id','run_id','action_id','video_id','owner'])need(typeof scope[k]==='string'&&/^[A-Za-z0-9_.:-]{1,200}$/.test(scope[k]),'ASR_OWNER_REQUIRED');
 need(/^[a-f0-9]{64}$/.test(scope.audio_sha256||''),'ASR_AUDIO_SHA_REQUIRED');
 need(path.isAbsolute(journalPath)&&Number.isFinite(deadlineMs),'ASR_CONTEXT_REQUIRED');
 need(credentials?.SecretId&&credentials?.SecretKey,'ASR_COS_CREDENTIAL_MISSING');
 const identity=sha(canonical(scope)),configSha=sha(canonical(config)),key=`${config.prefix}/${identity}/${scope.audio_sha256}.wav`;
 const host=`${config.bucket}.cos.${config.region}.myqcloud.com`,objectUrl=`https://${host}/${key}`;
 let state,issuedUrl;const secrets=new Set([credentials.SecretId,credentials.SecretKey]);
 const remaining=(cap,min=1,limit=deadlineMs)=>{const n=limit-now();need(n>=min,'ASR_DEADLINE');return Math.min(cap,n);};
 const syncDirectory=()=>{const fd=fs.openSync(path.dirname(journalPath),'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
 const durable=(file)=>{const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL,0o600);try{fs.writeFileSync(fd,JSON.stringify(state));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
 const save=()=>{const temp=journalPath+'.'+randomUUID();durable(temp);fs.renameSync(temp,journalPath);syncDirectory();};
 const load=()=>{
  const fd=fs.openSync(journalPath,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const info=fs.fstatSync(fd);need(info.isFile()&&info.size<=4*1024*1024&&(info.mode&0o077)===0,'ASR_JOURNAL_INVALID');state=JSON.parse(fs.readFileSync(fd,'utf8'));}finally{fs.closeSync(fd);}
  need(state.identity===identity&&state.config_sha256===configSha&&state.key===key&&state.sha256===scope.audio_sha256,'ASR_JOURNAL_SCOPE_CHANGED');
 };
 const auth=(method,url,headers={},expires=config.signature_seconds)=>{
  const u=new URL(url);need(u.protocol==='https:'&&u.hostname===host&&!u.username&&!u.password&&!u.hash&&u.pathname==='/'+key,'ASR_COS_URL_INVALID');
  return signer({...credentials,Method:method,Pathname:u.pathname,Headers:{host,...headers},Query:Object.fromEntries(u.searchParams),KeyTime:`${Math.floor(now()/1000)};${Math.floor(now()/1000)+expires}`,Expires:expires});
 };
 const objectRequest=async(method,{query={},body,headers={},maxBytes=config.max_bytes,cap=config.read_timeout_ms,unauthenticated=false,deadline=deadlineMs}={})=>{
  const u=new URL(objectUrl);for(const [k,v] of Object.entries(query))u.searchParams.set(k,v);
  const q={method,url:u.href,headers:{...headers},body,maxBytes,timeoutMs:remaining(cap,1,deadline)};
  if(!unauthenticated)q.headers.Authorization=auth(method,u.href,headers);
  return request(q);
 };
 const versionQuery=()=>state.version_id?{versionId:state.version_id}:{};
 const validateBytes=r=>{need(r.status===200&&Buffer.isBuffer(r.body)&&r.body.length===state.bytes&&sha(r.body)===state.sha256,'ASR_COS_READBACK');need((r.headers?.['x-cos-version-id']||null)===state.version_id,'ASR_COS_VERSION_CHANGED');need(r.headers?.['x-cos-meta-owner']===identity&&r.headers?.['x-cos-meta-sha256']===state.sha256,'ASR_COS_OWNER_CHANGED');};
 const sanitize=value=>{
  if(typeof value==='string')return /q-sign|q%2Dsign|q%252Dsign/i.test(value)||[...secrets].some(k=>value.includes(k))?'[REDACTED]':value;
  if(Array.isArray(value))return value.map(sanitize);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[sanitize(k),sanitize(v)]));return value;
 };
 const cleanup=async(deadline=deadlineMs)=>{
  try{
   if(state.delete_attempts===1){const absent=await objectRequest('HEAD',{query:versionQuery(),maxBytes:0,cap:config.cleanup_timeout_ms,deadline});need(absent.status===404,'ASR_COS_DELETE_UNVERIFIED');state.cleanup='verified';save();return;}
   const body=await objectRequest('GET',{query:versionQuery(),deadline});validateBytes(body);
   state.delete_attempts=1;save();const deleted=await objectRequest('DELETE',{query:versionQuery(),maxBytes:65536,cap:config.cleanup_timeout_ms,deadline});need([200,204].includes(deleted.status),'ASR_COS_DELETE_UNKNOWN');
   const absent=await objectRequest('HEAD',{query:versionQuery(),maxBytes:0,cap:config.cleanup_timeout_ms,deadline});need(absent.status===404,'ASR_COS_DELETE_UNVERIFIED');state.cleanup='verified';
  }catch{state.cleanup='unknown';}save();
 };
 const post=async(url,body,keyValue,audit)=>{
  need(url===endpoint&&body?.model==='qwen-audio-3.0-asr-flash'&&typeof keyValue==='string'&&keyValue.length>0,'ASR_ENDPOINT_UNVERIFIED');
  const messages=body?.input?.messages,content=messages?.[0]?.content;need(messages?.length===1&&messages[0].role==='user'&&content?.length===1&&content[0].type==='input_audio'&&content[0].input_audio?.data===issuedUrl&&body.parameters?.format==='wav','ASR_SOURCE_URL_UNVERIFIED');
  need(state.phase==='source_verified','ASR_ALREADY_STARTED');remaining(config.asr_timeout_ms,config.min_asr_ms);
  secrets.add(keyValue);state.phase='asr_started';state.asr_attempts=1;save();
  const serialized=JSON.stringify(body),started=now();let response;
  try{response=await request({method:'POST',url,headers:{Authorization:'Bearer '+keyValue,'Content-Type':'application/json'},body:serialized,maxBytes:2*1024*1024,timeoutMs:remaining(config.asr_timeout_ms,config.min_asr_ms)});}
  catch{state.transport={phase:'awaiting_headers',provider_received:'unknown',request_sha256:sha(serialized),request_bytes:Buffer.byteLength(serialized),elapsed_ms:now()-started};save();throw Error('ASR_PROVIDER_UNCONFIRMED');}
  state.transport={phase:'headers_received',http_status:response.status,raw_sha256:sha(response.body),raw_bytes:response.body.length,request_sha256:sha(serialized),request_bytes:Buffer.byteLength(serialized),elapsed_ms:now()-started};save();
  let raw;try{raw=JSON.parse(response.body.toString());}catch{throw Error('ASR_PROVIDER_RESPONSE_UNKNOWN');}
  need(raw&&typeof raw==='object'&&!Array.isArray(raw),'ASR_PROVIDER_RESPONSE_UNKNOWN');
  const safe=sanitize(raw),id=response.headers?.['x-request-id']||response.headers?.['x-dashscope-request-id'];
  state.response={http_status:response.status,body:safe,raw_sha256:sha(response.body),raw_bytes:response.body.length};save();
  const receipt={...state.response,stage:'asr',model:body.model,provider:'dashscope',request_sha256:sha(serialized),request_bytes:Buffer.byteLength(serialized),elapsed_ms:now()-started,transport_phase:'response_json_received',provider_received:'http_response_received',request_id:typeof id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(id)?id:null};
  await audit(receipt);state.response_persisted=true;save();need(response.status===200,'ASR_PROVIDER_REJECTED');return safe;
 };
 return {
  async run(audio,{perform,recover,audit}){
   if(fs.existsSync(journalPath)){
    load();if(state.text&&state.response_persisted)return state.text;
    if(state.response?.http_status===200){const text=recover(state.response.body);if(text){await audit({...state.response,stage:'asr',recovered:true});state.text=text;state.response_persisted=true;state.phase='completed';save();return text;}}
    throw Error('ASR_ACTION_UNKNOWN_NO_REPLAY');
   }
   remaining(config.put_timeout_ms,config.min_prepare_ms);const bytes=readAudio(audio,config);need(sha(bytes)===scope.audio_sha256,'ASR_INPUT_CHANGED');
   fs.mkdirSync(path.dirname(journalPath),{recursive:true,mode:0o700});
   state={schema:1,identity,scope,config_sha256:configSha,key,bucket:config.bucket,region:config.region,sha256:scope.audio_sha256,bytes:bytes.length,version_id:null,phase:'upload_started',put_attempts:1,asr_attempts:0,cleanup:'retained',signature_expires_at:null,retain_until:now()+config.retain_seconds*1000};
   durable(journalPath);syncDirectory();
   try{
    const uploaded=await objectRequest('PUT',{body:bytes,cap:config.put_timeout_ms,maxBytes:65536,headers:{'x-cos-acl':'private','x-cos-forbid-overwrite':'true','Content-Length':String(bytes.length),'Content-MD5':createHash('md5').update(bytes).digest('base64'),'x-cos-meta-owner':identity,'x-cos-meta-sha256':state.sha256}});need([200,201].includes(uploaded.status),'ASR_COS_UPLOAD_UNKNOWN');state.version_id=uploaded.headers?.['x-cos-version-id']||null;state.phase='uploaded';save();
    const acl=await objectRequest('GET',{query:{...versionQuery(),acl:''},maxBytes:65536});need(acl.status===200&&parseAcl(acl.body),'ASR_COS_NOT_PRIVATE');
    validateBytes(await objectRequest('GET',{query:versionQuery()}));
    const denied=await objectRequest('GET',{query:versionQuery(),unauthenticated:true,maxBytes:65536});need(denied.status===403,'ASR_COS_UNSIGNED_ACCESS');
    remaining(config.asr_timeout_ms,config.min_asr_ms);const start=Math.floor(now()/1000),signature=auth('GET',objectUrl+(state.version_id?'?versionId='+encodeURIComponent(state.version_id):''));
    const signed=new URL(objectUrl);if(state.version_id)signed.searchParams.set('versionId',state.version_id);for(const [k,v] of new URLSearchParams(signature))signed.searchParams.set(k,v);
    need(signed.searchParams.get('q-sign-time')===`${start};${start+config.signature_seconds}`&&signed.searchParams.get('q-signature')&&signed.searchParams.get('q-sign-algorithm')==='sha1','ASR_COS_SIGNATURE_INVALID');
    state.signature_expires_at=(start+config.signature_seconds)*1000;state.retain_until=Math.max(state.retain_until,state.signature_expires_at+60000);state.phase='source_verified';save();
    issuedUrl=signed.href;const text=await perform({url:issuedUrl,sha256:state.sha256,bytes:state.bytes,post:(u,b,k)=>post(u,b,k,audit)});need(typeof text==='string'&&text.trim()&&state.response_persisted,'ASR_TRANSCRIPT_UNVERIFIED');
    state.text=text;state.phase='completed';save();await cleanup();return text;
   }catch{state.phase=state.response_persisted?'failed':'unknown';save();if(state.response_persisted)await cleanup();throw Error('ASR_ACTION_UNCONFIRMED');}
  },
  async cleanupExpired({deadlineMs:cleanupDeadline}={}){load();need(now()>=state.retain_until,'ASR_RETENTION_ACTIVE');need(Number.isFinite(cleanupDeadline)&&cleanupDeadline>now()&&cleanupDeadline<=now()+30000,'ASR_CLEANUP_BUDGET');await cleanup(cleanupDeadline);return {verified:state.cleanup==='verified',key:state.key};}
 };
}
