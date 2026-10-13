import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createHandlers,runWorkflow} from '../leadgen-workflow.mjs';

// 全部账号、订单、模板和发送XML为明示fake，测试不访问手机/网络/生产库。
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'fake-outreach-'));
 const registry=join(dir,'accounts.tsv');writeFileSync(registry,'jinoshengyuan-work\tlangzi63485\n');
 const stateDir=join(dir,'bin-harvest/state');mkdirSync(stateDir,{recursive:true});
 const events=[];
 const env={HOME:dir,WFR_RUN_DIR:dir,P:'jinoshengyuan-work',SERIAL:'FAKE6983',WFR_TAG:'fake104',LEADGEN_LINE:'jinuo',WF_BRAIN_WORKFLOW:'douyin_lead_outreach',LEADGEN_SEND:'1',LEADGEN_LIMIT:'1',DOUYIN_ACCOUNT_REGISTRY:registry,PHONE_EVIDENCE_ROOT:join(dir,'fake-evidence')};
 const order={id:'recFAKEONLY123',line_key:'jinuo',douyin_id:'1873867835',profile_url:'https://v.douyin.com/FAKEONLY/',script_id:'fake-approved-B',script_version:'B',message:'测试批准正文',sender_douyin_id:'langzi63485'};
 const rpc=async body=>{events.push(body);const op=body.request?.op;
  if(op==='claim_outreach')return {result:[order]};
  if(op==='prepare_outreach')return {result:{prepared:true,order}};
  if(op==='write_outreach')return {result:{written:true,id:order.id}};
  if(op==='outreach_readback')return {result:{verified:true,failures:0,rows:[{...order,send_status:'已发送'}]}};
  if(op==='release_outreach')return {result:{released:0}};
  if(body.kind==='outreach_policy')return {result:{line_key:'jinuo',profile:env.P,sender_douyin_id:'langzi63485',daily_cap:60,order_limit:1,template:{id:order.script_id,version:'B',message:order.message}}};
  throw Error('unexpected fake RPC '+JSON.stringify(body));};
 const execute=async(cmd,args,opts)=>{events.push({cmd,args,opts});let stdout='';
  const action=args.find(x=>['preflight','lock-acquire','lock-refresh','lock-release','account-current','close-app','return-safe-desktop','private-message-send','ui-evidence'].includes(x));
  if(cmd==='adb')stdout=args.includes('get-state')?'device\n':args.includes('telephony.registry')?'mCallState=0\n':'';
  if(action==='preflight')stdout='serial=FAKE6983\n';
  if(action?.startsWith('lock-'))stdout='lock='+({'lock-acquire':'acquired','lock-refresh':'refreshed','lock-release':'released'}[action])+'\n';
  if(action==='account-current')stdout='douyin_id=langzi63485\n';
  if(action==='private-message-send'){
   const base=join(env.PHONE_EVIDENCE_ROOT,env.P);mkdirSync(base,{recursive:true});const raw=join(base,'fake104-a2-dm-1-sent.xml');
   const input=text=>`<node text="${text}" class="android.widget.EditText" resource-id="com.ss.android.ugc.aweme:id/msg_et"/>`;
   const sent='<hierarchy>'+input('')+'<node text="测试批准正文" class="android.widget.TextView"/></hierarchy>';
   writeFileSync(raw,sent);const typed=join(base,'fake104-a2-dm-1-typed.xml');writeFileSync(typed,'<hierarchy>'+input(order.message)+'</hierarchy>');
   const risk=join(base,'fake104-a2-dm-1-risk.xml');writeFileSync(risk,sent);const fg=join(base,'fake104-a2-dm-1-send-foreground.txt'),rfg=join(base,'fake104-a2-dm-1-risk-foreground.txt');writeFileSync(fg,'mCurrentFocus com.ss.android.ugc.aweme/FakeChatActivity');writeFileSync(rfg,'mCurrentFocus com.ss.android.ugc.aweme/FakeChatActivity');
   stdout='send_status=sent\nmessage_delta_verified=true\nsender_douyin_id=langzi63485\ntarget_douyin_id=1873867835\nmessage_sha256='+createHash('sha256').update(order.message).digest('hex')+'\nsent_ui_evidence='+raw+'\ntyped_ui_evidence='+typed+'\nrisk_ui_evidence='+risk+'\nsend_foreground_evidence='+fg+'\nrisk_foreground_evidence='+rfg+'\n';
  }
  return {code:0,stdout,stderr:''};};
 return {dir,env,events,order,rpc,execute,sourceCommit:'f'.repeat(40),clean:()=>rmSync(dir,{recursive:true,force:true})};
}
const legacyDay=()=>{const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());return ['year','month','day'].map(k=>p.find(x=>x.type===k).value).join('');};
for(const stateFile of ['halt','count'])test('104遵守已有YYYYMMDD '+stateFile+'文件，不能绕过旧风控/额度',async()=>{
 const f=fixture();try{writeFileSync(join(f.env.HOME,'bin-harvest/state',`dm-${stateFile}-${f.env.P}-${legacyDay()}.txt`),stateFile==='count'?'60':'fake real-risk halt');
 const h=createHandlers({root:f.dir,...f});await assert.rejects(h.preflight(),/风险|日发送上限/);
 assert.ok(!f.events.some(e=>e.request?.op==='claim_outreach'||e.args?.includes('private-message-send')));
 }finally{f.clean();}
});
test('104授权新流程通过预检、永久预留、唯一一次真sender调用、写回及Commander清场',async()=>{
 const f=fixture();try{const h=createHandlers({root:f.dir,...f});const receipts=[];
 const out=await runWorkflow({activities:['preflight','send_dm','write_back','cleanup'].map(key=>({key})),context:{},handlers:h,
  commander:async r=>{receipts.push(r);return {action:'continue',reason:'fake证据'};},record:async()=>{}});
 assert.equal(out.status,'completed',JSON.stringify(out));
 const ops=f.events.filter(e=>e.request).map(e=>e.request.op);
 assert.ok(ops.indexOf('prepare_outreach')>=0);
 const sends=f.events.filter(e=>e.args?.includes('private-message-send'));assert.equal(sends.length,1);
 assert.ok(f.events.findIndex(e=>e.request?.op==='prepare_outreach')<f.events.findIndex(e=>e.args?.includes('private-message-send')));
 assert.ok(ops.includes('write_outreach')&&ops.includes('outreach_readback'));
 assert.equal(receipts.filter(r=>r.phase==='after').length,4);
 }finally{f.clean();}
});
test('104准备提交回执丢失必须不发，清场不得把可能prepared订单重新排队',async()=>{
 const f=fixture();try{const h=createHandlers({root:f.dir,...f,rpc:async b=>{
  if(b.request?.op==='prepare_outreach')throw Error('fake COMMIT reply lost');return f.rpc(b);}});
 await h.preflight();await assert.rejects(h.send_dm(),/reply lost/);await h.cleanup();
 assert.equal(f.events.filter(e=>e.args?.includes('private-message-send')).length,0);
 assert.ok(!f.events.some(e=>e.request?.op==='release_outreach'&&e.request.release_prepared===true));
 }finally{f.clean();}
});
test('真实发送后write回复丢失，仅独立原订单读回恢复，不再次调用sender',async()=>{
 const f=fixture();try{const h=createHandlers({root:f.dir,...f,rpc:async b=>{
  if(b.request?.op==='write_outreach'){await f.rpc(b);throw Error('fake write commit reply lost');}return f.rpc(b);}});
 await h.preflight();await h.send_dm();const back=await h.write_back();assert.equal(back.outreach_readback_failures,0);
 assert.equal(f.events.filter(e=>e.args?.includes('private-message-send')).length,1);
 }finally{f.clean();}
});
test('完整原sender拥有480s子预算，但仍夹紧本activity剩余且不改变普通命令120s',async()=>{
 for(const remaining of [null,45000]){
 const f=fixture();try{const h=createHandlers({root:f.dir,...f});await h.preflight();
 if(remaining!==null)h.state.budgetDeadline=Date.now()+remaining;
 await h.send_dm();const send=f.events.find(e=>e.args?.includes('private-message-send'));
 if(remaining===null){assert.equal(send.opts.maxDurationS,480);assert.equal(send.opts.timeoutMs,480000);}
 else {assert.ok(send.opts.timeoutMs>0&&send.opts.timeoutMs<=remaining);}
 assert.ok(f.events.filter(e=>e.args?.includes('close-app')).every(e=>e.opts.timeoutMs<=120000));
 }finally{f.clean();}
 }
});
test('冻结rate合同不得绕过手机已有更低live cap，原调参文件保持原字节',async()=>{
 const f=fixture();try{
 const cfgDir=join(f.env.HOME,'bin-harvest/config');mkdirSync(cfgDir,{recursive:true});
 const raw=JSON.stringify({[f.env.P]:{mode:'daily_step',start_date:'2026-10-13',base_per_day:1,step_per_day:0,ceiling_per_day:1}});
 writeFileSync(join(cfgDir,'dm-rate-ramp.json'),raw);writeFileSync(join(f.env.HOME,'bin-harvest/state',`dm-count-${f.env.P}-${legacyDay()}.txt`),'1');
 const h=createHandlers({root:f.dir,...f});await assert.rejects(h.preflight(),/日发送上限/);
 assert.equal(readFileSync(join(cfgDir,'dm-rate-ramp.json'),'utf8'),raw);
 assert.ok(!f.events.some(e=>e.request?.op==='claim_outreach'||e.args?.includes('private-message-send')));
 }finally{f.clean();}
});
