'use strict';
const fs=require('fs');
const crypto=require('crypto');
const {routeOf}=require('./line-routes.js');
const {computeDailyCap}=require('./dm-rate-ramp-lib.js');
const {txt}=require('./next-outreach-lib.js');
const lib=require('./next-outreach-lib.js');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const validId=v=>typeof v==='string'&&/^[A-Za-z0-9_.-]{1,64}$/.test(v);
const recordId=v=>typeof v==='string'&&/^rec[A-Za-z0-9]{6,40}$/.test(v);
function sender(route,profile,id){if(!route.profiles.includes(profile)||!validId(id))throw Error('触达profile或账号绑定缺失');}
async function request(url,opts,fetcher,deadlineAt=Infinity){const remaining=deadlineAt-Date.now();if(remaining<=0)throw Error('BRIDGE_DEADLINE');const r=await fetcher(url,{...opts,signal:AbortSignal.timeout(Math.max(1,Math.min(15000,Math.floor(remaining))))});if(!r.ok)throw Error('触达批准话术HTTP失败');const b=await r.json();if(b.code!==0)throw Error('触达批准话术API失败');return b;}

// 仅中央端读取1Password导出的私有账号缓存；设备RPC不能提交自拟模板。
async function outreachPolicy(input,{fetcher=fetch,env=process.env,read=fs.readFileSync,now=new Date()}={}){
 const route=routeOf(input.line);sender(route,input.profile,input.sender_douyin_id);
 const cache=env.LEADGEN_FEISHU_CREDENTIALS||require('path').join(require('os').homedir(),'.credentials/leadgen-feishu-accounts.json');
 const acc=JSON.parse(read(cache,'utf8'))[route.account];
 if(!acc?.appId||!acc.appSecret)throw Error('触达批准话术账号绑定缺失');
 const ramp=JSON.parse(read(require('path').join(__dirname,'config/leadgen-outreach-rate-ramp.json'),'utf8'))[input.profile];
 if(!ramp)throw Error('触达日上限配置缺失');const cap=computeDailyCap(ramp,now);
 if(!Number.isSafeInteger(cap)||cap<1||cap>1000)throw Error('触达日上限无效');
 const token=(await request('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({app_id:acc.appId,app_secret:acc.appSecret})},fetcher)).tenant_access_token;
 if(!token)throw Error('触达话术授权失败');
 const rows=[];let page='';for(let i=0;i<5;i++){
  const b=await request(`https://open.feishu.cn/open-apis/bitable/v1/apps/${route.base}/tables/${route.script}/records?page_size=100${page?'&page_token='+encodeURIComponent(page):''}`,{headers:{Authorization:'Bearer '+token}},fetcher);
  rows.push(...(b.data?.items||[]));if(!b.data?.has_more){page='';break;}page=b.data.page_token;if(!page)throw Error('触达话术分页损坏');
 }if(page)throw Error('触达话术分页超界');
 // 首条沿既有序号0的B版本；不存在或启用重复版本均停止，不改正文。
 const enabled=rows.filter(r=>txt(r.fields?.['启用状态'])==='启用'&&txt(r.fields?.['子版本'])==='B');
 if(enabled.length!==1)throw Error('触达B话术未启用或不唯一');
 const row=enabled[0],message=txt(row.fields['话术正文']),id=txt(row.fields['话术ID']);
 if(!id||!message||message.length>600||/[\r\n"&<>]/.test(message))throw Error('触达批准话术不符合真实sender合同');
 return {line_key:route.key,profile:input.profile,sender_douyin_id:input.sender_douyin_id,daily_cap:cap,order_limit:1,template:{id,record_id:row.record_id,version:'B',message,message_sha256:hash(message)}};
}

// 原Feishu订单字段、分类/等级/去重语义复用；仅为四活动提供单条原子区入口。
// prepared标记是永久发送预留，40分钟旧悬空回收不能将其重新排队。
async function withOrderLock(line,fn,{directory=require('path').join(require('os').homedir(),'.config/zenithjoy/outreach-order-locks')}={}){
 const path=require('path').join(directory,line+'.lock');
 fs.mkdirSync(require('path').dirname(path),{recursive:true,mode:0o700});
 try{fs.mkdirSync(path,{mode:0o700});}catch(e){if(e.code==='EEXIST')throw Error('触达原订单领单锁忙');throw e;}
 try{return await fn();}finally{fs.rmdirSync(path);}
}
async function orderClient(route,{env=process.env,fetcher=fetch,read=fs.readFileSync,deadlineAt=Infinity}={}){
 const cache=env.LEADGEN_FEISHU_CREDENTIALS||require('path').join(require('os').homedir(),'.credentials/leadgen-feishu-accounts.json');
 const acc=JSON.parse(read(cache,'utf8'))[route.account];if(!acc?.appId||!acc.appSecret)throw Error('触达1Password批准账号缓存缺失');
 const tok=(await request('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({app_id:acc.appId,app_secret:acc.appSecret})},fetcher,deadlineAt)).tenant_access_token;
 if(!tok)throw Error('触达授权失败');
 const headers={Authorization:'Bearer '+tok,'Content-Type':'application/json'};
 const base=`https://open.feishu.cn/open-apis/bitable/v1/apps/${route.base}/tables/${route.lead}/records`;
 const api=(url,opts={},callDeadline=Infinity)=>request(url,{headers,...opts},fetcher,Math.min(deadlineAt,callDeadline));
 return {
  async all({deadlineAt:callDeadline=Infinity}={}){let page='',out=[];for(let i=0;i<30;i++){const b=await api(base+'?page_size=100&automatic_fields=true'+(page?'&page_token='+encodeURIComponent(page):''),{},callDeadline);out.push(...(b.data?.items||[]));if(!b.data?.has_more)return out;page=b.data.page_token;if(!page)throw Error('触达订单分页损坏');}throw Error('触达订单分页超界');},
  async fields(){let page='',out=[];for(let n=0;n<5;n++){const b=await api(base.replace(/\/records$/,'/fields')+'?page_size=100'+(page?'&page_token='+encodeURIComponent(page):''));out.push(...(b.data?.items||[]));if(!b.data?.has_more)return out;page=b.data.page_token;if(!page)throw Error('触达字段分页损坏');}throw Error('触达字段分页超界');},
  async post(fields){return (await api(base,{method:'POST',body:JSON.stringify({fields})})).data?.record;},
  async get(id){if(!recordId(id))throw Error('触达原订单ID无效');return (await api(base+'/'+id)).data?.record;},
  async put(id,fields){if(!recordId(id))throw Error('触达原订单ID无效');await api(base+'/'+id,{method:'PUT',body:JSON.stringify({fields})});}
 };
}
function marker(kind,run,source){return `[104 ${kind}:${run}:${source}]`;}
function receiptValid(input,line,source){const r=input.receipt;
 if(!r||r.version!==1||r.line!==line||r.run!==input.run||r.id!==input.id||r.source_commit!==source||!recordId(r.id)||!validId(r.profile)||!validId(r.sender_douyin_id)||!validId(r.target_douyin_id)||!r.script_id||!['A1','A2','B'].includes(r.script_version)||!/^https:\/\/(?:v|www)\.douyin\.com\/[A-Za-z0-9._/-]+$/.test(r.profile_url||'')||!/^[a-f0-9]{64}$/.test(r.message_sha256||'')||r.message_delta_verified!==true||r.delivery_verified!==false||!['sent','restricted','rate_limited'].includes(r.outcome))throw Error('触达本轮原始证明缺失或不符');
 for(const [key,suffix]of Object.entries({typed:'typed.xml',sent:'sent.xml',risk:'risk.xml',send_foreground:'send-foreground.txt',risk_foreground:'risk-foreground.txt'})){
  const f=r.raw_evidence?.[key];if(f?.file!==input.run+'-a2-dm-1-'+suffix||!/^[a-f0-9]{64}$/.test(f.sha256||''))throw Error('触达原始证明不完整');
 }return r;
}
async function outreachRequest(input,{sourceCommit,client,policy=outreachPolicy,lock=withOrderLock,eligibleOrders,pool,freezeCompanyConfig}={}){
 const route=routeOf(input.line),run=input.run;
 if(!/^[a-zA-Z0-9_-]{1,64}$/.test(run||'')||!/^[a-f0-9]{40}$/.test(sourceCommit||''))throw Error('触达正式运行来源证明缺失');
 if(input.op==='claim_outreach')sender(route,input.profile,input.sender_douyin_id);
 if(['write_outreach','outreach_readback'].includes(input.op))receiptValid(input,route.key,sourceCommit);
 if(input.op!=='claim_outreach'&&!recordId(input.id))throw Error('触达原订单ID无效');
 const api=client||await orderClient(route);
 return lock(route.key,async()=>{
  if(input.op==='claim_outreach'){
   if(input.limit!==1)throw Error('触达必须显式首单范围');const p=await policy(input),all=await api.all();
   const qualified=new Set(await (eligibleOrders||((route,all,input)=>require('./leadgen-outreach-bridge.js').eligibleOrders(route,all,input,{pool,freezeCompanyConfig})))(route,all,input));
   const reserved=lib.reservedRecipientSet(all);
   const rows=all.filter(r=>qualified.has(r.record_id)&&txt(r.fields?.['状态'])==='待触达'&&lib.classifyPending(r.fields)==='ok'&&lib.gradeAllowed(lib.leadGrade(r.fields),route.outreachGrades)&&!reserved.has(lib.extractLead(r.fields).dyid.toLowerCase()));
   rows.sort((a,b)=>(Number(b.fields['重复命中次数'])||0)-(Number(a.fields['重复命中次数'])||0)||lib.gradeRank(lib.leadGrade(a.fields))-lib.gradeRank(lib.leadGrade(b.fields)));
   if(!rows.length)return [];
   const pick=rows[0],lead=lib.extractLead(pick.fields),fields={'状态':'触达中','话术ID':p.template.id,'话术版本':p.template.version,'话术内容':p.template.message,'实际分发号':input.profile+'('+input.sender_douyin_id+')','回复结果':marker('claim',run,sourceCommit)};
   await api.put(pick.record_id,fields);const back=await api.get(pick.record_id);
   if(!back||Object.entries(fields).some(([key,v])=>txt(back.fields?.[key])!==v))throw Error('触达原订单预写读回不符');
   return [{id:pick.record_id,line_key:route.key,douyin_id:lead.dyid,profile_url:lead.profileUrl,sender_douyin_id:input.sender_douyin_id,script_id:p.template.id,script_version:p.template.version,message:p.template.message}];
  }
  const row=await api.get(input.id),f=row?.fields||{},reply=txt(f['回复结果']);
  if(input.op==='release_outreach'){
   if(txt(f['状态'])==='触达中'&&reply===marker('claim',run,sourceCommit)){await api.put(input.id,{'状态':'待触达','回复结果':'[104 清场释放未准备订单:'+run+']'});return {released:1};}
   return {released:0};
  }
  if(input.op==='prepare_outreach'){
   sender(route,input.profile,input.sender_douyin_id);
   const same=fields=>txt(fields['状态'])==='触达中'&&txt(fields['实际分发号'])===input.profile+'('+input.sender_douyin_id+')'&&txt(fields['话术ID'])===input.script_id&&txt(fields['话术版本'])===input.script_version&&hash(txt(fields['话术内容']))===input.message_sha256&&lib.extractLead(fields).dyid.toLowerCase()===String(input.target_douyin_id||'').toLowerCase()&&lib.extractLead(fields).profileUrl===input.profile_url;
   if(reply!==marker('claim',run,sourceCommit)||!same(f))throw Error('触达无首次发送许可证或订单已变化');
   const prepared=marker('prepared',run,sourceCommit);await api.put(input.id,{'回复结果':prepared});const back=await api.get(input.id);
   if(txt(back?.fields?.['回复结果'])!==prepared||!same(back?.fields||{}))throw Error('触达永久预留回执未知');
   return {prepared:true,order:{id:input.id}};
  }
  const receipt=receiptValid(input,route.key,sourceCommit);
  const identity=txt(f['实际分发号'])===receipt.profile+'('+receipt.sender_douyin_id+')'&&lib.extractLead(f).dyid.toLowerCase()===receipt.target_douyin_id.toLowerCase()&&lib.extractLead(f).profileUrl===receipt.profile_url&&txt(f['话术ID'])===receipt.script_id&&txt(f['话术版本'])===receipt.script_version&&hash(txt(f['话术内容']))===receipt.message_sha256;
  const final=marker(receipt.outcome,run,sourceCommit)+' '+receipt.message_sha256+' 送达未证';
  const expected={'状态':receipt.outcome==='sent'?'已触达':'触达受阻','发送状态':receipt.outcome==='sent'?'已发送':'发送失败','成功触达':receipt.outcome==='sent'?'待确认':'否','回复结果':final};
  if(input.op==='write_outreach'){
   if(reply!==marker('prepared',run,sourceCommit)||!identity)throw Error('触达写回与原订单永久预留不符');
   await api.put(input.id,{...expected,'触达时间':new Date(Date.now()+8*3600e3).toISOString().replace('T',' ').slice(0,16)+'(UTC+8)'});return {written:true,id:input.id};
  }
  if(input.op==='outreach_readback'){const verified=identity&&Object.entries(expected).every(([k,v])=>txt(f[k])===v);return {verified,failures:verified?0:1};}
  throw Error('触达未知原订单操作');
 });
}
module.exports={outreachPolicy,outreachRequest,withOrderLock,receiptValid,orderClient};
