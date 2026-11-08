// Server-owned Activity primitives: the Agent supplies work, never authority.
import {createHash,randomUUID} from 'node:crypto';
import {appendFileSync,openSync,closeSync,writeFileSync,readFileSync,fsyncSync,mkdirSync,lstatSync,readdirSync} from 'node:fs';
import {join,isAbsolute,resolve,dirname} from 'node:path';
import {existsSync,realpathSync} from 'node:fs';
import {readFrozen,isCanonicalTcpDeviceSerial} from './runtime-definition.mjs';
import {readBinding} from './runtime-binding.mjs';
import {verifyProducerDescriptor,verifyProducerCompany} from './producer-descriptor.mjs';
import {rawModelScopeStopped} from './activity-skill-parent-loop.mjs';
import {skillLaunchDidNotStart} from './activity-skill-executor.mjs';

const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const canonical=value=>Array.isArray(value)?value.map(canonical):object(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const json=value=>JSON.stringify(canonical(value));
const hash=value=>createHash('sha256').update(typeof value==='string'?value:json(value)).digest('hex');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const videoId=/^\d{16,24}$/;
const schemas={
  company_config:[],keywords:[],verify_upstream:[],history:[],
  discover:['video'],discover_readback:['video'],inspect_videos:['video_ids'],claim_videos:[],renew_video:['video_id'],
  qualify:['video_id','evidence_id'],qualification_readback:['video_id'],
  comment_history:['video_id','video_url'],comment_history_readback:['video_id','video_url','history'],
  collect:['video_id','video_url','comments','history'],collect_partial:['video_id','video_url','comments','history'],sample_readback:['video_id','video_url','rows'],
  score_scope:[],score:['ids'],score_recovery:['ids'],score_readback:['ids'],score_exclusion_readback:['ids'],policy_review:['ids'],
  mark_leads:[],mark_readback:['ids','lead_ids'],bridge_outreach:[],bridge_readback:['ids'],
};
const slots={
  preflight:['company_config'],source:['company_config','keywords'],collect_videos:['discover','discover_readback','inspect_videos'],
  dedup:['company_config','verify_upstream','inspect_videos'],qualification:['company_config','claim_videos','renew_video','qualify','qualification_readback','inspect_videos'],
  collection:['renew_video','comment_history','comment_history_readback','collect','collect_partial','sample_readback','inspect_videos'],
  scoring:['company_config','score_scope','score','score_recovery','score_readback','score_exclusion_readback','policy_review'],
  mark_leads:['mark_leads','mark_readback','bridge_outreach','bridge_readback'],cleanup:[],
};
const writeOps=new Set(['company_config','discover','claim_videos','renew_video','qualify','collect','collect_partial','score','mark_leads','bridge_outreach']);
// Audited read-only branches: queue SELECTs (and the existing trusted URL HEAD
// resolver for sample/history). Recovery/model/bridge dispatch is not read-only.
const readbackFor={discover:['discover_readback'],claim_videos:['inspect_videos'],renew_video:['inspect_videos'],qualify:['inspect_videos'],collect:['sample_readback','comment_history_readback'],collect_partial:['sample_readback','comment_history_readback'],score:['score_readback']};
const readPhone=new Set(['status','foreground','window','ui-evidence','snapshot-evidence','outward-ledger']);
const phoneBySlot={preflight:['wake','unlock','open-app','account-current'],source:[],collect_videos:['open-search','search-time-layer','search-video-tab','search-video-cards','search-grid-scroll','tap-evidence','swipe-evidence','back-evidence','current-video-link','back-to-results'],
  dedup:[],qualification:['open-video','current-video-link','set-playback-speed','native-audio-evidence','record-start','record-status','record-stop','record-extract-audio','back-evidence'],
  collection:['open-video','current-video-link','open-comments','commenter-identity','tap-evidence','swipe-evidence','back-evidence','detail-restored'],scoring:[],mark_leads:[],cleanup:['close-app','return-safe-desktop']};
function privateRead(file){
  const stat=lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o077)!==0||stat.size>5*1024*1024)throw Error('AGENT_TOOL_JOURNAL_INVALID');
  return JSON.parse(readFileSync(file,'utf8'));
}
function syncDirectory(directory){const fd=openSync(directory,'r');try{if(!lstatSync(directory).isDirectory()||lstatSync(directory).isSymbolicLink())throw Error('AGENT_TOOL_JOURNAL_INVALID');fsyncSync(fd);}finally{closeSync(fd);}}
function durable(file,value){const fd=openSync(file,'wx',0o600);try{writeFileSync(fd,JSON.stringify(value));fsyncSync(fd);}finally{closeSync(fd);}syncDirectory(dirname(file));}
// Failure diagnostics never serialize exception messages, stacks or arbitrary
// attached values. Only finite code identifiers from own data properties cross
// into the durable journal; a failure file does not resolve its write intent.
function failureCodes(error){
  const own=(value,key)=>value&&(typeof value==='object'||typeof value==='function')?Object.getOwnPropertyDescriptor(value,key)?.value:undefined;
  const code=value=>{const valueCode=own(value,'code');return typeof valueCode==='string'&&/^[A-Z][A-Z0-9_]{0,95}$/.test(valueCode)?valueCode:null;};
  const cause_codes=[],seen=new Set([error]);let cause=own(error,'cause');
  for(let depth=0;cause&&depth<4&&!seen.has(cause);depth++){seen.add(cause);const value=code(cause);if(value)cause_codes.push(value);cause=own(cause,'cause');}
  return {error_code:code(error),cause_codes};
}
function identity(op,input){
  if(['discover','discover_readback'].includes(op))return 'discover:'+String(input.video?.videoId??input.video?.video_id);
  if(['collect','collect_partial'].includes(op))return op+':'+input.video_id+':'+hash((input.comments||[]).map(row=>row.native_receipt||hash(row)).sort());
  if(op==='renew_video')return op+':'+input.video_id+':'+randomUUID();
  if(op==='qualify')return op+':'+input.video_id;
  if(op==='score')return 'score:'+input.ids.join(',');
  return op;
}
export function mergeAgentCollectionRows({previous=[],fresh=[],videoId:vid,limit}){
  if(!videoId.test(vid||'')||!Number.isSafeInteger(limit)||limit<1||limit>50||![previous,fresh].every(Array.isArray))throw Error('AGENT_PRIMARY_COLLECTION_SCOPE_INVALID');
  const rows=[...new Map([...previous,...fresh].map(record=>{
    if(record?.video_id!==vid||!record.row?.douyinId||!record.row.commentBody)throw Error('AGENT_PRIMARY_COMMENT_SCOPE_INVALID');
    return [JSON.stringify([record.row.douyinId,record.row.commentBody]),record];
  })).values()];
  if(rows.length>limit)throw Error('AGENT_PRIMARY_COMMENT_LIMIT');return rows;
}
export function aggregateAgentCollectionCommit({previousInserted,receipt,videoId:vid,comments,historical}){
  if(!Number.isSafeInteger(previousInserted)||previousInserted<0||![comments,historical].every(n=>Number.isSafeInteger(n)&&n>=0)
    ||receipt?.video_id!==vid||!Number.isSafeInteger(receipt.inserted)||receipt.inserted<0||receipt.comments!==comments
    ||receipt.history_verified!==historical||receipt.coverage!==comments+historical||previousInserted+receipt.inserted>comments)throw Error('AGENT_PRIMARY_COLLECTION_COMMIT_UNVERIFIED');
  return {...receipt,inserted:previousInserted+receipt.inserted};
}

export function createLeadgenAgentTools({scope:provided,runDir,primitives}){
  const scope=structuredClone(provided);
  if(!object(scope)||!['douyin_video_discovery','douyin_video_processing','douyin_comment_scoring'].includes(scope.workflow)||!slots[scope.activity]
    ||!uuid.test(scope.task_id||'')||!uuid.test(scope.binding_id||'')||!/^[a-f0-9]{40}$/.test(scope.source_commit||'')
    ||!/^[a-f0-9]{64}$/.test(scope.snapshot_sha256||'')||!/^[-A-Za-z0-9_]{1,120}$/.test(scope.run||'')
    ||!scope.run_id?.startsWith(scope.workflow+'-'+scope.run+'__')||!/^[-A-Za-z0-9_.]{1,80}$/.test(scope.profile||'')
    ||!(/^[-A-Za-z0-9_.]{1,80}$/.test(scope.serial||'')||isCanonicalTcpDeviceSerial(scope.serial))||!/^[-A-Za-z0-9_]{1,80}$/.test(scope.line||'')
    ||!Number.isSafeInteger(scope.deadline_ms)||!Number.isSafeInteger(scope.limit)||scope.limit<1||scope.limit>50
    ||scope.source_run!==null&&!/^[-A-Za-z0-9_]{1,120}$/.test(scope.source_run||'')
    ||!isAbsolute(runDir)||!object(primitives)||typeof primitives.assertResources!=='function')throw Error('AGENT_TOOL_SCOPE_INVALID');
  const expectedWorkflow={source:'douyin_video_discovery',collect_videos:'douyin_video_discovery',dedup:'douyin_video_processing',qualification:'douyin_video_processing',collection:'douyin_video_processing',scoring:'douyin_comment_scoring',mark_leads:'douyin_comment_scoring'};
  if(expectedWorkflow[scope.activity]&&scope.workflow!==expectedWorkflow[scope.activity])throw Error('AGENT_TOOL_SCOPE_INVALID');
  const directory=join(runDir,'agent-tools',scope.activity);mkdirSync(directory,{recursive:true,mode:0o700});
  const stat=lstatSync(directory);if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o077)!==0)throw Error('AGENT_TOOL_JOURNAL_INVALID');
  syncDirectory(dirname(directory));syncDirectory(runDir);
  const scopeKey=hash(scope),receipts=[];let result=null,settled=false,busy=false;
  const rawTermination=proof=>{
    if(scope.execution_transport!=='raw-model-v1')return;
    const state=primitives.executionState?.()||{};
    if(!(rawModelScopeStopped(proof?.raw_model_proof,scope)||skillLaunchDidNotStart(proof,scope))
      ||state.native_stop_unproven===true||state.execution_unknown===true)throw Error('AGENT_TOOL_TERMINATION_UNVERIFIED');
  };
  const intents=()=>readdirSync(directory).filter(name=>/^[a-f0-9]{64}\.intent\.json$/.test(name)).map(name=>{
    const value=privateRead(join(directory,name));if(value.scope_key!==scopeKey)throw Error('AGENT_TOOL_JOURNAL_SCOPE_MISMATCH');return {name,key:name.slice(0,64),value};
  });
  const unresolved=()=>intents().filter(row=>{try{privateRead(join(directory,row.key+'.result.json'));return false;}catch(error){if(error.code==='ENOENT')return true;throw error;}});
  const pendingReadback=(op,input)=>{
    if(!object(input)||!slots[scope.activity].includes(op)||Object.keys(input).some(key=>!schemas[op]?.includes(key)))return null;
    const pending=unresolved();if(pending.length!==1)return null;
    const original=pending[0].value;if(!(readbackFor[original.operation]||[]).includes(op))return null;
    const request=original.request;
    if(op==='discover_readback')return (input.video?.videoId??input.video?.video_id)===(request.video?.videoId??request.video?.video_id)?{video:request.video}:null;
    if(op==='inspect_videos'){
      const allowed=request.video_ids||[request.video_id];return Array.isArray(input.video_ids)&&input.video_ids.length>0&&input.video_ids.every(id=>allowed.includes(id))?{video_ids:input.video_ids}:null;
    }
    if(['sample_readback','comment_history_readback'].includes(op)){
      if(input.video_id!==request.video_id||input.video_url!==request.video_url)return null;
      return op==='comment_history_readback'?{video_id:request.video_id,video_url:request.video_url,history:request.history||[]}:
        {video_id:request.video_id,video_url:request.video_url,rows:[...(request.history||[]),...(request.comments||[])].map(row=>({...(row.id?{id:row.id}:{}),douyinId:row.douyinId,commentBody:row.commentBody,sourceVideoUrl:row.sourceVideoUrl||request.video_url}))};
    }
    if(op==='score_readback')return Array.isArray(input.ids)&&input.ids.length>0&&input.ids.every(id=>request.ids.includes(id))?{ids:input.ids,sources:Object.fromEntries(input.ids.map(id=>[id,request.sources?.[id]||scope.source_run]))}:null;
    return null;
  };
  const canReadback=(op,input)=>{try{return pendingReadback(op,input)!==null;}catch{return false;}};
  async function guard(options={}){if(Date.now()>=scope.deadline_ms)throw Error('AGENT_TOOL_DEADLINE');if(await primitives.assertResources(scope,options)!==true)throw Error('AGENT_TOOL_RESOURCE_UNVERIFIED');if(Date.now()>=scope.deadline_ms)throw Error('AGENT_TOOL_DEADLINE');}
  const business=async(op,input={})=>{
    if(!slots[scope.activity].includes(op))throw Error('AGENT_TOOL_OPERATION_NOT_ALLOWED');
    if(!object(input)||Object.keys(input).some(key=>!schemas[op].includes(key)))throw Error('AGENT_TOOL_INPUT_SCOPE_INVALID');
    if(busy)throw Error('AGENT_TOOL_OPERATION_BUSY');
    const pending=unresolved();
    const readback=pending.length?pendingReadback(op,input):null;
    if(pending.length&&!readback)throw Error('AGENT_TOOL_COMMIT_UNKNOWN_READBACK_REQUIRED');
    await guard({readOnly:!!readback});
    if(['discover','discover_readback'].includes(op)){
      const id=input.video?.videoId??input.video?.video_id;if(!videoId.test(id||''))throw Error('AGENT_TOOL_VIDEO_INPUT_INVALID');
      if(op==='discover'&&input.video?.metrics?.comment_total?.value===0)throw Error('DISCOVERY_CONFIRMED_ZERO_COMMENTS');
    }
    if(op==='score'&&(!Array.isArray(input.ids)||input.ids.length!==1||!uuid.test(input.ids[0])))throw Error('AGENT_TOOL_SCORE_INPUT_INVALID');
    if(['collect','collect_partial'].includes(op)&&(!videoId.test(input.video_id||'')||!Array.isArray(input.comments)||!Array.isArray(input.history||[])||!Number.isSafeInteger(scope.comment_limit)||scope.comment_limit<1||input.comments.length+(input.history?.length||0)>scope.comment_limit))throw Error('AGENT_TOOL_COLLECTION_INPUT_INVALID');
    // Native evidence and server queues remain authoritative; the Agent cannot
    // turn self-reported metrics/recipient/qualification text into a write.
    if(!readback&&typeof primitives.validateInput!=='function')throw Error('AGENT_TOOL_NATIVE_ADMISSION_UNAVAILABLE');
    const trusted=readback||await primitives.validateInput(op,structuredClone(input),scope);
    if(!object(trusted))throw Error('AGENT_TOOL_NATIVE_ADMISSION_INVALID');
    const request={...trusted,line:scope.line,run:scope.run,source_run:scope.source_run||undefined,limit:op==='score'?1:scope.limit};
    if(op==='score')request.budget_max=scope.limit;
    if(op==='company_config')Object.assign(request,{step:scope.workflow==='douyin_video_discovery'?'101':scope.workflow==='douyin_video_processing'?'102':'103',...(scope.serial!=='none'?{device_binding:{profile:scope.profile,device_serial:scope.serial}}:{})});
    if(op==='claim_videos')request.config_required=true;
    if(op==='policy_review')request.claim=scope.run;
    if(op==='bridge_outreach')request.remaining_ms=Math.max(1,Math.min(165000,scope.deadline_ms-Date.now()-15000));
    const key=hash([scopeKey,identity(op,input)]),intentFile=join(directory,key+'.intent.json'),resultFile=join(directory,key+'.result.json');
    const intent={scope_key:scopeKey,scope,operation:op,input_sha256:hash(request),request};
    if(writeOps.has(op)){
      let prior;
      try{prior=privateRead(intentFile);}catch(error){if(error.code!=='ENOENT')throw error;}
      if(prior){
        if(prior.input_sha256!==intent.input_sha256)throw Error('AGENT_TOOL_WRITE_IDENTITY_REUSED');
        try{return privateRead(resultFile).result;}catch(error){if(error.code!=='ENOENT')throw error;throw Object.assign(Error('AGENT_TOOL_COMMIT_UNKNOWN_READBACK_REQUIRED'),{externalEffect:'unknown'});}
      }
      if(op==='discover'&&intents().filter(row=>row.value.operation==='discover').length>=scope.limit)throw Error('AGENT_TOOL_VIDEO_LIMIT');
      if(op==='score'&&intents().filter(row=>row.value.operation==='score').length>=scope.limit)throw Error('AGENT_TOOL_SCORE_LIMIT');
      durable(intentFile,intent);
    }
    busy=true;
    try{
      let value;
      if(op==='keywords')value=await primitives.keywords(scope);
      else if(op==='verify_upstream')value=await primitives.verifyUpstream(scope);
      else if(op==='qualify')value=await primitives.qualify(request,scope);
      else if(op==='qualification_readback')value=await primitives.qualificationReadback(request,scope);
      else value=await primitives.queue(op,request);
      const receipt={operation:op,input:trusted,result:value};receipts.push(receipt);
      if(writeOps.has(op))durable(resultFile,{...intent,result:value});
      else if(readback)durable(join(directory,hash([pending[0].key,op,request,randomUUID()])+'.readback.json'),{original_intent_key:pending[0].key,operation:op,request,result:value,continues_execution:false,native_stop_proven:false,observed_at:new Date().toISOString()});
      return value;
    }catch(error){if(writeOps.has(op)){error.externalEffect='unknown';error.message='AGENT_TOOL_COMMIT_UNKNOWN_READBACK_REQUIRED';}throw error;}
    finally{busy=false;}
  };
  const phone=async(command,...args)=>{
    if(scope.serial==='none'||!readPhone.has(command)&&!(phoneBySlot[scope.activity]||[]).includes(command))throw Error('AGENT_TOOL_PHONE_NOT_ALLOWED');
    if(args.some(arg=>typeof arg!=='string'||arg.length>1000||/[\0\r\n]/.test(arg)||arg.startsWith('--')))throw Error('AGENT_TOOL_PHONE_INPUT_INVALID');
    if(busy||unresolved().length)throw Error('AGENT_TOOL_PHONE_COMMIT_UNKNOWN_READBACK_REQUIRED');await guard();
    if(!readPhone.has(command)&&typeof primitives.validatePhone!=='function')throw Error('AGENT_TOOL_PHONE_ADMISSION_UNAVAILABLE');
    const eid=`${scope.run}-agent-${scope.activity}-${randomUUID()}`;
    if(readPhone.has(command)&&args.length)throw Error('AGENT_TOOL_PHONE_INPUT_INVALID');
    const readEid=primitives.evidenceId?.(command,{...scope,evidence_id:eid})||(scope.activity==='cleanup'?`${scope.run}-${scope.run_id.split('__').at(-1)}-cleanup-desktop`:eid);
    if(!/^[A-Za-z0-9_-]+$/.test(readEid)||!readEid.startsWith(scope.run+'-'))throw Error('AGENT_TOOL_EVIDENCE_ID_INVALID');
    const trusted=readPhone.has(command)?(['ui-evidence','snapshot-evidence'].includes(command)?[readEid]:[]):await primitives.validatePhone(command,args,{...scope,evidence_id:eid});
    if(!Array.isArray(trusted))throw Error('AGENT_TOOL_PHONE_ADMISSION_INVALID');
    busy=true;try{return await primitives.phone(command,...trusted);}finally{busy=false;}
  };
  const lifecycle=async(operation,fn)=>{
    await guard();if(busy)return {deferred:true};if(unresolved().length)throw Object.assign(Error('AGENT_TOOL_COMMIT_UNKNOWN_READBACK_REQUIRED'),{externalEffect:'unknown'});
    const key=hash([scopeKey,operation,randomUUID()]),intent={scope_key:scopeKey,scope,operation,request:{},input_sha256:hash({})};
    durable(join(directory,key+'.intent.json'),intent);busy=true;
    try{const value=await fn();durable(join(directory,key+'.result.json'),{...intent,result:value??null});return value;}
    catch(error){
      try{durable(join(directory,key+'.failure.json'),{...intent,...failureCodes(error),observed_at:new Date().toISOString()});}
      catch(journalError){journalError.externalEffect='unknown';journalError.message='AGENT_TOOL_COMMIT_UNKNOWN_READBACK_REQUIRED';journalError.cause=error;throw journalError;}
      error.externalEffect='unknown';error.message='AGENT_TOOL_COMMIT_UNKNOWN_READBACK_REQUIRED';throw error;
    }finally{busy=false;}
  };
  let prepared=false;
  return {business,phone,canReadback,
    ...(typeof primitives.closeNativeScope==='function'?{closeNativeScope:proof=>primitives.closeNativeScope(proof,scope)}:{}),
    heartbeat:async()=>{if(unresolved().length)return {deferred:true,commit_unknown:true};try{return await lifecycle('resource_heartbeat',()=>primitives.heartbeat?.(scope));}catch(error){primitives.resourceUnknown?.(error,scope);error.executionStopped=false;throw error;}},
    inspect:async()=>{
      const facts=await primitives.inspect?.(scope),preflight=scope.activity==='preflight';
      const companyAdmitted=preflight&&prepared&&object(facts?.company)&&Boolean(facts.company.company_id&&facts.company.tenant_id&&facts.company.device_binding);
      const commands=scope.serial==='none'?[]:[...readPhone,...phoneBySlot[scope.activity]];
      return {...facts,scope:structuredClone(scope),phone_capabilities:commands,business_capabilities:[...slots[scope.activity]],
        tool_contract:{business:Object.fromEntries(slots[scope.activity].map(op=>[op,{input_keys:[...schemas[op]]}])),
          ...(preflight?{phone:Object.fromEntries(commands.map(command=>[command,{args:[]}]))}:{})},
        ...(preflight?{bootstrap:{resources_prepared:prepared,company_config_admitted:companyAdmitted,
          ...(companyAdmitted&&!facts.account?{next_required_intent:{type:'phone',command:'account-current',args:[]},instruction:'公司配置与设备范围已由Code准入；下一步调用account-current读取原生账号。context或模型文字不能代替账号证据。'}:{})}}:{}),
        pending_write_readbacks:unresolved().map(row=>({operation:row.value.operation,readback_operations:readbackFor[row.value.operation]||[]}))};
    },
    prepare:async()=>{if(prepared)return;const result=await lifecycle('resource_prepare',()=>primitives.prepare?.(scope));if(!result?.deferred)prepared=true;return result;},
    settle:async proof=>{if(proof?.execution_stopped!==true||busy)throw Error('AGENT_TOOL_TERMINATION_UNVERIFIED');rawTermination(proof);if(unresolved().length)throw Object.assign(Error('AGENT_TOOL_COMMIT_UNKNOWN_READBACK_REQUIRED'),{externalEffect:'unknown'});await guard();if(typeof primitives.settle!=='function')throw Error('AGENT_TOOL_RESULT_ADAPTER_UNAVAILABLE');result=await primitives.settle({scope,receipts:structuredClone(receipts),proof});settled=true;return result;},
    release:async proof=>{if(proof?.execution_stopped!==true||!settled||busy)throw Error('AGENT_TOOL_TERMINATION_UNVERIFIED');rawTermination(proof);if(scope.activity!=='cleanup')throw Error('AGENT_TOOL_RELEASE_NOT_CLEANUP');const released=await lifecycle('resource_release',()=>primitives.release?.(proof,scope));if(!object(released))throw Error('AGENT_TOOL_RELEASE_UNVERIFIED');result={...result,...released};return released;},
    getResult:()=>{const state=primitives.executionState?.()||{};return state.native_stop_unproven===true||state.execution_unknown===true?{...(result||{}),execution_stopped:false,...(state.native_stop_unproven===true?{native_stop_unproven:true}:{})}:result;},
  };
}

// Shared source admission only: it neither operates the phone nor claims work.
export async function verifyAgentUpstream({env,state,queue,sampleInput,profile,serial,line,run}){
    state.companyConfig=await queue('company_config',{step:'102'});
    appendFileSync(join(env.WFR_RUN_DIR,'company-config-receipts.jsonl'),JSON.stringify(state.companyConfig)+'\n',{mode:0o600});
    const sourceRun=env.LEADGEN_SOURCE_RUN;
    if(!/^[a-zA-Z0-9_-]{1,120}$/.test(sourceRun||''))throw Error('102缺有效上游101运行号');
    const upstreamDir=resolve(env.WFR_RUN_DIR,'..',`douyin_video_discovery-${sourceRun}`);
    const upstream=readFrozen(upstreamDir),current=readFrozen(env.WFR_RUN_DIR);
    if(upstream.run_identity?.capability!=='douyin_video_discovery'||upstream.run_identity.tag!==sourceRun
      ||upstream.run_identity.profile!==profile||upstream.deployment.source_commit!==current.deployment.source_commit&&!current.producer_descriptor)throw Error('上游101冻结身份或发布来源不一致');
    const final=JSON.parse(readFileSync(join(upstreamDir,'split-result.json'),'utf8'));
    const collect=Array.isArray(final?.results)?final.results.filter(item=>item?.activity==='collect_videos'):[];
    const runPrefix=`douyin_video_discovery-${sourceRun}__`;
    const attempt=typeof final?.run_id==='string'&&final.run_id.startsWith(runPrefix)?final.run_id.slice(runPrefix.length):'';
    if(final?.status!=='completed'||final.workflow_key!=='douyin_video_discovery'
      ||!/^a[1-9][0-9]*$/.test(attempt)
      ||final.source_commit!==upstream.deployment.source_commit||final.profile!==profile
      ||final.evidence_status!=='sent'||collect.length!==1
      ||collect[0].status!=='completed'||collect[0].verification?.verified!==true)throw Error('上游101终态或collect_videos验收未通过');
    const progressRaw=readFileSync(join(upstreamDir,'discovery-progress.json'));
    const input=JSON.parse(progressRaw);
    const producer=current.producer_descriptor?verifyProducerDescriptor(current.producer_descriptor,{upstream,progressRaw,progress:input,env,company:state.companyConfig,consumerSourceCommit:current.deployment.source_commit}):null;
    if(producer)verifyProducerCompany(producer,await queue('verify_producer_company',{descriptor:producer}));
    state.producerDescriptor=producer;
    if(input.run!==sourceRun||input.profile!==profile||!Array.isArray(input.videos)||input.videos.length>1000
      ||!Array.isArray(input.captures)||input.captures.length>10000)throw Error('上游101交接清单身份或数量无效');
    const all=[...input.videos,...input.captures];
    if(all.some(v=>!/^\d{16,24}$/.test(v.videoId||'')||typeof v.author!=='string'||!v.author.trim()))throw Error('上游视频ID或作者证据无效');
    const ids=[...new Set(input.videos.map(v=>v.videoId))];
    if(ids.length!==input.videos.length||input.captures.some(v=>!ids.includes(v.videoId))||ids.some(id=>!input.captures.some(v=>v.videoId===id)))throw Error('上游真实取链与保存ID清单不一致');
    const rows=await queue('inspect_videos',{video_ids:ids});
    if(!Array.isArray(rows)||rows.length!==ids.length||ids.some(id=>rows.filter(r=>r.video_id===id).length!==1))throw Error('PG读回缺上游真实视频ID');
    const own=JSON.parse(readFileSync(env.OWN_ACCOUNTS_CONF||join(env.HOME,'bin-harvest/config/own-accounts.json'),'utf8'));
    if(!Array.isArray(own.nicknames)||!Array.isArray(own.ids))throw Error('自家账号配置缺失');
    const normalize=v=>String(v??'').normalize('NFKC').replace(/\s+/g,' ').trim();
    const ownNames=new Set([...own.nicknames,...own.ids].map(normalize));
    const fulfilled=new Set(),priorProofs=[],ignoredFailedSamplingRuns=[];
    if(sampleInput){
      const siblings=readdirSync(resolve(env.WFR_RUN_DIR,'..'));
      if(siblings.length>2000)throw Error('采样前序运行索引超界');
      for(const name of siblings.filter(n=>/^douyin_video_processing-[A-Za-z0-9_-]+$/.test(n))){
        const priorDir=resolve(env.WFR_RUN_DIR,'..',name);
        if(priorDir===resolve(env.WFR_RUN_DIR)||lstatSync(priorDir).isSymbolicLink()||!lstatSync(priorDir).isDirectory())continue;
        const file=join(priorDir,name.slice('douyin_video_processing-'.length)+'-sampling-readback.json');
        if(!existsSync(file))continue;
        if(lstatSync(file).isSymbolicLink()||(lstatSync(file).mode&0o077)!==0||lstatSync(file).size>10000000)throw Error('采样回执不得使用符号链接或公开权限或超界正文');
        const prior=readFrozen(priorDir),si=prior.sampling_input;
        if(!si||si.source_run!==sourceRun||si.comment_limit!==sampleInput.comment_limit)continue;
        if(si.profile!==profile||si.serial!==serial||si.line!==line||prior.deployment.source_commit!==current.deployment.source_commit||prior.run_identity?.tag!==si.run_tag||prior.run_identity?.capability!=='douyin_video_processing'||prior.run_identity?.profile!==profile||prior.run_identity?.serial!==si.serial||prior.run_identity?.serial!==serial||prior.run_identity?.run_id!==name)throw Error('前序采样冻结scope不符');
        const receipt=JSON.parse(readFileSync(file,'utf8')),final=JSON.parse(readFileSync(join(priorDir,'split-result.json'),'utf8'));
        const attempt=typeof final.run_id==='string'?final.run_id.slice((name+'__').length):'';
        if(!/^a[1-9][0-9]*$/.test(attempt)||final.run_id!==name+'__'+attempt||!['completed','partial','failed'].includes(final.status))throw Error('前序采样缺真实run及attempt终态');
        const binding=readBinding(priorDir,attempt,prior);if(binding.run_id!==final.run_id||receipt.run_id!==binding.run_id)throw Error('前序采样运行绑定不一致');
        if(final.profile!==profile||JSON.stringify(final.sampling_input)!==JSON.stringify(si)||final.source_commit!==current.deployment.source_commit||final.workflow_key!=='douyin_video_processing')throw Error('前序采样终态scope不符');
        // 失败运行保留原件，但不兑现其采样配额，也不能堵住同批其它待处理视频。
        // 只有冻结来源、身份及正式绑定全部一致的失败终态可以在这里忽略。
        if(final.status==='failed'){
          ignoredFailedSamplingRuns.push({prior_run:si.run_tag,run_id:binding.run_id,status:final.status});continue;
        }
        const activity=final.results?.find(r=>r.activity==='collection');
        if(receipt.verified!==true||JSON.stringify(receipt.sampling_input)!==JSON.stringify(si)||final.profile!==profile||JSON.stringify(final.sampling_input)!==JSON.stringify(si)||final.source_commit!==current.deployment.source_commit||final.workflow_key!=='douyin_video_processing'||activity?.verification?.verified!==true||!['completed','partial'].includes(activity?.status)||!Array.isArray(receipt.videos)||receipt.videos.length>1000||JSON.stringify(activity.result?.sampling_receipts)!==JSON.stringify(receipt.videos.map(({pg_rows,...publicReceipt})=>publicReceipt)))throw Error('前序采样缺真实已验收Activity回执');
        for(const v of receipt.videos){
          if(!ids.includes(v.video_id)||v.source_run!==sourceRun||v.comment_limit!==si.comment_limit||!Array.isArray(v.pg_rows)||v.pg_rows.length!==v.coverage||!['quota_reached','footer_reached','no_comments'].includes(v.stop_reason)||v.stop_reason==='quota_reached'&&v.coverage!==si.comment_limit||v.coverage>si.comment_limit)throw Error('前序采样配额或上游范围不符');
          const proof=await queue('sample_readback',{video_id:v.video_id,video_url:v.video_url,rows:v.pg_rows});
          if(proof.verified!==true||proof.video_id!==v.video_id||proof.coverage!==v.coverage||JSON.stringify(proof.rows)!==JSON.stringify(v.pg_rows))throw Error('前序采样实际PG读回缺失');
          fulfilled.add(v.video_id);priorProofs.push({prior_run:si.run_tag,video_id:v.video_id,coverage:proof.coverage});
        }
      }
    }
    const skipped=[],eligible=[];
    for(const v of input.videos){const row=rows.find(r=>r.video_id===v.videoId);
      if(!['pending','matched','rejected'].includes(row.judgment_status)||typeof row.process_status!=='string')throw Error('PG视频状态缺合法终态');
      const currentPolicy=row.judgment_config?.company_id===state.companyConfig.company_id&&row.judgment_config?.version===state.companyConfig.version;
      const reason=producer&&!producer.video_ids.includes(v.videoId)?'producer_scope':row.judgment_status==='rejected'&&currentPolicy?'rejected':row.process_status==='评论已采'?'completed':fulfilled.has(v.videoId)?'sample_fulfilled':ownNames.has(normalize(v.author))?'own':null;
      if(reason)skipped.push({video_id:v.videoId,reason});else eligible.push(v.videoId);
    }
    state.intakeVideoIds=eligible;
    const proof={verified:true,source_run:sourceRun,source_commit:upstream.deployment.source_commit,...(producer?{consumer_source_commit:current.deployment.source_commit,producer_descriptor:producer}:{}),
      prior_sampling_readbacks:priorProofs,ignored_failed_sampling_runs:ignoredFailedSamplingRuns,observed_at:new Date().toISOString(),video_ids:ids,eligible_video_ids:eligible,skipped,rows,
      duplicate_observations:input.captures.length-ids.length};
    writeFileSync(join(env.WFR_RUN_DIR,`${run}-intake-readback.json`),JSON.stringify(proof),{mode:0o600});
    return {historical_filter_verified:Number(rows.length===ids.length),own_filter_verified:Number(Array.isArray(own.nicknames)&&Array.isArray(own.ids)),run_dedup_verified:Number(new Set(eligible).size===eligible.length),
      received:ids.length,eligible:eligible.length,ignored_failed_sampling_runs:ignoredFailedSamplingRuns.length,skipped_completed:skipped.filter(v=>v.reason==='completed').length,
      skipped_sample_fulfilled:skipped.filter(v=>v.reason==='sample_fulfilled').length,skipped_rejected:skipped.filter(v=>v.reason==='rejected').length,skipped_own:skipped.filter(v=>v.reason==='own').length,duplicate_observations:proof.duplicate_observations};
}
