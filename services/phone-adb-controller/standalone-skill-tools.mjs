// 单步工具边界；不启动模型、工作流或活动循环。真实身份/锁/来源由每次调用的准入器读回。
const fail=code=>{throw Object.assign(Error('STANDALONE_TOOL_'+code),{code:'STANDALONE_TOOL_'+code});};
const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const keys=(v,allowed)=>{if(!record(v)||Object.keys(v).some(k=>!allowed.includes(k)))fail('INPUT');};
const text=(v,max=12000)=>typeof v==='string'&&v.length<=max&&!/[\0\r\n]/.test(v);
const noArgs=new Set(['status','preflight','foreground','open-app','return-safe-desktop']);
const evidenceArg=new Set(['account-current','snapshot-evidence','ui-evidence','search-video-tab','search-video-cards','evidence-bundle']);
const rpcOps=new Set(['company_config','keywords','resolve_share_link','discover','discover_readback']);
export function createStandaloneSkillTools({frozen,assertAuthority,phone,rpc}){
 if(typeof assertAuthority!=='function'||typeof phone!=='function'||typeof rpc!=='function')fail('PROVIDERS');
 const f=structuredClone(frozen),input=f?.agent_input,identity=f?.standalone_skill;
 if(f?.execution_mode!=='agent'||f.primary_host!=='codex-exec-v1'||identity?.protocol!=='codex-exec-v1'||input?.workflow_key!=='douyin_video_discovery'
  ||input.task_id!==identity.task_id||!text(input.profile)||!text(input.run_tag)||!text(input.line)||!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>50
  ||!Array.isArray(identity.scope?.approved_keywords)||!identity.scope.approved_keywords.length||identity.scope.approved_keywords.length>50
  ||identity.scope.approved_keywords.some(k=>!text(k,200)||!k.trim())||new Set(identity.scope.approved_keywords).size!==identity.scope.approved_keywords.length)fail('SCOPE');
 const approved=identity.scope.approved_keywords,run=input.run_tag,line=input.line,profile=input.profile;
 const evidence=v=>text(v,200)&&v.startsWith(run+'-')&&/^[A-Za-z0-9_-]+$/.test(v);
 const approvedKeyword=v=>typeof v==='string'&&approved.includes(v);
 const validatePhone=q=>{
  keys(q,['command','args']);const {command,args}=q;if(!text(command,60)||!Array.isArray(args))fail('PHONE_INPUT');
  if(noArgs.has(command)){if(args.length)fail('PHONE_ARGS');}
  else if(evidenceArg.has(command)){if(args.length!==1||!evidence(args[0]))fail('EVIDENCE');}
  else if(command==='open-search'){
   if(args.length!==1||!text(args[0],1000)||!/^[A-Za-z0-9._%+-]+$/.test(args[0]))fail('PHONE_ARGS');let keyword;try{keyword=decodeURIComponent(args[0]);}catch{fail('KEYWORD');}if(!approvedKeyword(keyword))fail('KEYWORD');
  }else if(command==='current-video-link'){
   if(![1,2].includes(args.length)||!evidence(args[0])||args.length===2&&!approvedKeyword(args[1]))fail('PHONE_ARGS');
  }else if(command==='search-time-layer'){
   const filters=input.discovery_filters;
   if(args.length!==6||!filters||args[0]!==filters.time_layer||!evidence(args[1])||args[2]!==filters.sort||args[3]!=='unlimited'||args[4]!=='unlimited'||args[5]!==filters.location)fail('FILTER_SCOPE');
  }else if(command==='open-search-card'){
   // 语义provider须立即重读search-video-cards，选本次index并校验详情；不是控制器CLI命令。
   if(args.length!==2||!Number.isSafeInteger(args[0])||args[0]<0||args[0]>49||!evidence(args[1]))fail('CARD_INPUT');
  }else fail('PHONE_COMMAND');
  return {command,args,profile,owner:run};
 };
 const submitted=new Set();let uncertainVideo=null;
 const businessRequest=q=>{
  keys(q,['operation','input']);const op=q.operation,p=q.input??{};if(!rpcOps.has(op))fail('BUSINESS_OPERATION');
  if(op==='company_config'){keys(p,[]);return {kind:'queue',request:{op,line,run,step:'101',device_binding:{profile,device_serial:input.serial}}};}
  if(op==='keywords'){keys(p,[]);return {kind:'keywords',line,run,limit:Math.min(input.limit,approved.length),keywords:approved};}
  if(op==='resolve_share_link'){
   keys(p,['url']);if(!text(p.url,3000))fail('SHARE_URL');let url;try{url=new URL(p.url);}catch{fail('SHARE_URL');}
   if(url.protocol!=='https:'||url.username||url.password||url.port||!['v.douyin.com','www.douyin.com'].includes(url.hostname))fail('SHARE_URL');
   return {kind:'resolve_share_link',url:p.url};
  }
  keys(p,['video']);keys(p.video,['videoId','video_id','videoUrl','video_url','title','keyword','author','metrics']);
  const v=p.video,id=v.videoId??v.video_id,url=v.videoUrl??v.video_url;
  if(!/^\d{16,24}$/.test(id??'')||url!==`https://www.douyin.com/video/${id}`||v.videoId!==undefined&&v.video_id!==undefined&&v.videoId!==v.video_id
   ||v.videoUrl!==undefined&&v.video_url!==undefined&&v.videoUrl!==v.video_url||!approvedKeyword(v.keyword)||!text(v.title,2000)||!v.title.trim()
   ||v.author!==undefined&&!text(v.author,500)||!record(v.metrics)||JSON.stringify(v.metrics).length>2*1024*1024)fail('VIDEO');
  if(uncertainVideo&&(op==='discover'||JSON.stringify(v)!==JSON.stringify(uncertainVideo)))fail('COMMIT_UNKNOWN');
  if(op==='discover'&&!submitted.has(id)&&submitted.size>=input.limit)fail('QUOTA');
  return {kind:'queue',request:{op,line,run,video:v}};
 };
 const business=async request=>{
  const q=request.request;
  if(q?.op==='discover')uncertainVideo=structuredClone(q.video);
  const result=await rpc(request);
  if(['discover','discover_readback'].includes(q?.op)&&result?.ok===true&&result.result?.metrics_verified===true&&['pending','matched','rejected'].includes(result.result.status)){
   submitted.add(q.video.videoId??q.video.video_id);
   if(uncertainVideo&&JSON.stringify(q.video)===JSON.stringify(uncertainVideo))uncertainVideo=null;
  }
  return result;
 };
 const usedEvidence=new Set();
 const reserveEvidence=q=>{
  const id=evidenceArg.has(q.command)||q.command==='current-video-link'?q.args[0]:['search-time-layer','open-search-card'].includes(q.command)?q.args[1]:null;
  if(id===null)return;
  if(usedEvidence.has(id))fail('EVIDENCE_REUSED');
  usedEvidence.add(id);
 };
 let busy=false;
 return async function call(op,raw={}){
  if(busy)fail('BUSY');busy=true;
  try{
   const q=structuredClone(raw);let provider,arg;
   if(op==='inspect'){
    keys(q,[]);provider=async()=>({stage:'101',scope:structuredClone(input),approved_keywords:structuredClone(approved),skill:structuredClone(identity.skill),
     phone_commands:[...noArgs,...evidenceArg,'open-search','current-video-link','search-time-layer','open-search-card'],semantic_phone_commands:['open-search-card'],
     semantic_phone_requirements:{'open-search-card':'provider立即重读当前卡片，按index定位并核对详情；不得直接转发为控制器命令'},business_operations:[...rpcOps]});
   }else if(op==='phone'){arg=validatePhone(q);provider=phone;}
   else if(op==='business'){arg=businessRequest(q);provider=business;}
   else fail('OPERATION');
   await assertAuthority();
   if(op==='phone')reserveEvidence(arg);
   let result,error,failed=false;
   try{result=await provider(arg);}catch(e){failed=true;error=e;}
   // 未知提交不重试。后置准入失败同时保留原错误，不能把未知提交改写成未调用。
   try{await assertAuthority();}catch(e){if(failed){if(error instanceof Error)error.authority_after_error=String(e?.message??e);else throw new AggregateError([error,e],'STANDALONE_TOOL_AUTHORITY_AFTER_FAILURE',{cause:error});}else throw e;}
   if(failed)throw error;return result;
  }finally{busy=false;}
 };
}
