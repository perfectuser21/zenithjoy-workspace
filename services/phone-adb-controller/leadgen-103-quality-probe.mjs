#!/usr/bin/env node
// 固定数据集只读质量探针。只有显式授权才会访问 provider；绝不打开 PG 或设备。
import {readFileSync,realpathSync,mkdirSync,writeFileSync,readdirSync,statSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {request as httpRequest} from 'node:http';

const require=createRequire(import.meta.url);
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const digest=v=>createHash('sha256').update(typeof v==='string'||Buffer.isBuffer(v)?v:JSON.stringify(v)).digest('hex');
const codeFiles=['services/phone-adb-controller/leadgen-103-quality-probe.mjs',
 'services/phone-adb-controller/judge-comment.js','services/phone-adb-controller/judge-jev.js',
 'services/phone-adb-controller/leadgen-queue.js','services/phone-adb-controller/company-config-lib.js',
 'services/phone-adb-controller/judge-video.js','services/phone-adb-controller/judge-video-lib.js',
 'services/phone-adb-controller/leadgen-db-lib.js','services/phone-adb-controller/line-routes.js'];
function git(...args){return execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}
function argsOf(argv){
 const out={};for(let i=0;i<argv.length;i++){
  const arg=argv[i];if(arg==='--real-provider'){out.real=true;continue;}
  if(!['--dataset','--candidate','--output','--local-provider','--fixture-responses'].includes(arg)||!argv[i+1]||argv[i+1].startsWith('--')||out[arg])throw Error('PROBE_ARGS_INVALID');
  out[arg]=argv[++i];
 }if(!out['--dataset']||!out['--candidate']||!out['--output'])throw Error('PROBE_ARGS_INVALID');
 return out;
}
function candidateIdentity(candidate){
 const head=git('rev-parse','HEAD');let actual;
 try{actual=realpathSync(candidate);}catch{actual=null;}
 if(actual){if(actual!==realpathSync(root))throw Error('CANDIDATE_CODE_MISMATCH');}
 else{
  if(!/^[a-f0-9]{40}$/.test(candidate)||candidate!==head)throw Error('CANDIDATE_CODE_MISMATCH');
  try{for(const path of codeFiles){const committed=execFileSync('git',['show',`${head}:${path}`],{cwd:root,stdio:['ignore','pipe','ignore']});
    if(digest(committed)!==digest(readFileSync(join(root,path))))throw Error('CANDIDATE_CODE_MISMATCH');}}
  catch{throw Error('CANDIDATE_CODE_MISMATCH');}
 }
 return {candidate,head,files:Object.fromEntries(codeFiles.map(p=>[p,digest(readFileSync(join(root,p)))]))};
}
function datasetOf(path){
 let raw,data;try{raw=readFileSync(path);if(raw.length>262144)throw Error();data=JSON.parse(raw);}
 catch{throw Error('PROBE_DATASET_INVALID');}
 const cases=data?.cases,snapshot=data?.snapshot;
 if(!snapshot?.company_id||!snapshot?.tenant_id||!snapshot?.policy_id||!snapshot?.runtime_config?.comment_scoring?.audiences?.length
  ||!snapshot.runtime_config.comment_scoring.criteria||!Array.isArray(cases)||cases.length!==4||new Set(cases.map(c=>c.id)).size!==4)throw Error('PROBE_DATASET_INVALID');
 for(const c of cases){const {sha256,...value}=c;
  if(!/^[A-Za-z0-9_-]{1,64}$/.test(c.id||'')||!['A','B','C','不相关'].includes(c.expected)
   ||typeof c.comment_body!=='string'||!c.comment_body.trim()||Buffer.byteLength(c.comment_body)>4000
   ||typeof c.source_video!=='string'||!c.source_video.trim()||c.source_video.length>1000
   ||typeof c.source_video_url!=='string'||!/^https:\/\//.test(c.source_video_url)
   ||sha256!==digest(value))throw Error('PROBE_DATASET_INVALID');
 }return {data,sha256:digest(raw)};
}
function safeError(error){const message=String(error?.message||error);
 if(/^(?:PROBE_|CANDIDATE_|COMMANDER_|COMMENT_INPUT_)/.test(message))return message.slice(0,80);
 const http=message.match(/HTTP\s+(\d{3})/);return http?`PROVIDER_HTTP_${http[1]}`:'PROVIDER_REQUEST_FAILED';}
function unixPost(socketPath,path,body,signal){return new Promise((resolve,reject)=>{
 const req=httpRequest({socketPath,path,method:'POST',headers:{'content-type':'application/json'},signal},res=>{
  let text='';res.on('data',chunk=>{text+=chunk;if(text.length>16384)res.destroy(Error('PROBE_RESPONSE_TOO_LONG'));});
  res.on('end',()=>{try{if(res.statusCode!==200)throw Error(`HTTP ${res.statusCode}`);resolve(JSON.parse(text));}catch(error){reject(error);}});
 });req.on('error',reject);req.end(JSON.stringify(body));
});}
async function run(argv=process.argv.slice(2),env=process.env){
 const a=argsOf(argv),output=resolve(a['--output']);
 try{mkdirSync(output);}catch(error){if(error.code!=='EEXIST'||!statSync(output).isDirectory()||readdirSync(output).length)throw error;}
 const receipt={status:'BLOCKED',reason:null,candidate:a['--candidate'],execution_head:null,files:{},dataset_sha256:null,requests:[],cases:[]};
 const save=()=>writeFileSync(join(output,'receipt.json'),JSON.stringify(receipt,null,2),{flag:'wx',mode:0o600});
 try{
  const identity=candidateIdentity(a['--candidate']);Object.assign(receipt,{execution_head:identity.head,files:identity.files});
  const {data,sha256}=datasetOf(a['--dataset']);receipt.dataset_sha256=sha256;
  if(!a.real&&!a['--local-provider']&&!a['--fixture-responses']){receipt.reason='PROVIDER_AUTHORIZATION_MISSING';save();return 2;}
  if(a['--local-provider']&&!/^http:\/\/(?:127\.0\.0\.1|localhost):\d{1,5}$/.test(a['--local-provider'])
    &&!(a['--local-provider'].startsWith('unix:/')&&a['--local-provider'].length<240))throw Error('PROBE_LOCAL_PROVIDER_INVALID');
  const fixture=a['--fixture-responses']?JSON.parse(readFileSync(a['--fixture-responses'],'utf8')):null;
  if(fixture&&(!Array.isArray(fixture)||fixture.length>32))throw Error('PROBE_FIXTURE_INVALID');
  const key=a['--local-provider']||fixture?'local-probe-only':env.OPENROUTER_API_KEY;
  if(!key){receipt.reason='PROVIDER_KEY_MISSING';save();return 2;}
  const {judgeComment}=require('./judge-comment.js');const {evaluatePolicy}=require('./leadgen-queue.js');
  const {defaultHttpPost}=require('./judge-jev.js');
  let failures=0;
  for(const c of data.cases){
   const records=[];let stage='score';const caseRef=digest(c.id).slice(0,16);
   const httpPost=async(url,body,apiKey,opts)=>{
    const item={sequence:receipt.requests.length+1,case_ref:caseRef,stage,provider:'openrouter',model:body.model,
      endpoint:new URL(url).pathname,request_sha256:digest(body),response_id:null,response_sha256:null,error:null};
    receipt.requests.push(item);records.push(item.sequence);
    try{const local=a['--local-provider'],target=local&&!local.startsWith('unix:')?local+new URL(url).pathname:url;
      const response=fixture?fixture.shift():local?.startsWith('unix:')?await unixPost(local.slice(5),new URL(url).pathname,body,opts?.signal)
        :await defaultHttpPost(target,body,apiKey,opts);
      if(!response)throw Error('PROBE_FIXTURE_EXHAUSTED');item.response_id=response?.id||null;item.response_sha256=digest(response);return response;
    }catch(error){item.error=safeError(error);throw error;}
   };
   try{
    const judged=await judgeComment(c.comment_body,c.source_video,
      require('./company-config-lib.js').configTargetProfile(data.snapshot,'103'),
      {scoringRules:data.snapshot.runtime_config.comment_scoring,apiKey:key,httpPost});
    stage='policy_review';
    const row={id:c.id,comment_body:c.comment_body,source_video:c.source_video,source_video_url:c.source_video_url,
      relevance:judged.relevance,intent_grade:judged.grade==='不相关'?null:judged.grade,
      judgment_config:{run_id:'probe',company_id:data.snapshot.company_id,tenant_id:data.snapshot.tenant_id,version:data.snapshot.version,policy_id:data.snapshot.policy_id}};
    const policy=await evaluatePolicy(row,data.snapshot,{judgePolicy:(body,video,profile,reason,opts)=>
      require('./judge-comment.js').judgeCommander(body,video,profile,reason,{...opts,apiKey:key,httpPost})});
    const passed=Boolean(judged.audit?.model&&judged.audit?.response_id)&&judged.grade===c.expected&&policy.status==='pass';if(!passed)failures++;
    receipt.cases.push({case_ref:caseRef,expected:c.expected,grade:judged.grade,policy_status:policy.status,
      policy_reason:policy.reason,passed,requests:records});
   }catch(error){failures++;receipt.cases.push({case_ref:caseRef,expected:c.expected,passed:false,error:safeError(error),requests:records});}
  }
  if(fixture?.length){failures++;receipt.reason='PROBE_FIXTURE_UNUSED_RESPONSES';}
  const simulated=Boolean(a['--local-provider']||fixture);
  receipt.status=failures===0?(simulated?'SIMULATED_PASS':'PASS'):'FAIL';
  receipt.reason=failures===0?(simulated?'LOCAL_STUB_ONLY':'FOUR_CASES_VERIFIED'):'QUALITY_CHECK_FAILED';save();return failures===0?0:1;
 }catch(error){receipt.reason=/^CANDIDATE_CODE_MISMATCH$/.test(error.message)?error.message:safeError(error);
  save();return 2;}
}
process.exitCode=await run();
