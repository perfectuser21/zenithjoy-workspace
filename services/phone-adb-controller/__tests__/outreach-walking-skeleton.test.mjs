import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHandlers,runWorkflow} from '../leadgen-workflow.mjs';

// 全部账号、订单、模板和发送XML为明示fake，测试不访问手机/网络/生产库。
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'fake-outreach-'));
 const registry=join(dir,'accounts.tsv');writeFileSync(registry,'jinoshengyuan-work\tlangzi63485\n');
 const stateDir=join(dir,'bin-harvest/state');mkdirSync(stateDir,{recursive:true});
 const events=[];
 const env={HOME:dir,WFR_RUN_DIR:dir,P:'jinoshengyuan-work',SERIAL:'FAKE6983',WFR_TAG:'fake104',LEADGEN_LINE:'jinuo',WF_BRAIN_WORKFLOW:'douyin_lead_outreach',LEADGEN_SEND:'1',LEADGEN_LIMIT:'1',DOUYIN_ACCOUNT_REGISTRY:registry};
 const order={id:'e92b90f1-19d1-4121-a434-96e0ee46a493',line_key:'jinuo',douyin_id:'1873867835',profile_url:'https://v.douyin.com/FAKEONLY/',script_id:'fake-approved-B',script_version:'B',message:'测试批准正文',sender_douyin_id:'langzi63485'};
 const rpc=async body=>{events.push(body);const op=body.request?.op;
  if(op==='claim_outreach')return {result:[order]};
  if(op==='prepare_outreach')return {result:{prepared:true,order}};
  if(op==='write_outreach')return {result:{written:true,id:order.id}};
  if(op==='outreach_readback')return {result:{verified:true,failures:0,rows:[{...order,send_status:'已发送'}]}};
  if(op==='release_outreach')return {result:{released:0}};
  if(body.kind==='outreach_policy')return {result:{line_key:'jinuo',profile:env.P,sender_douyin_id:'langzi63485',daily_cap:60,order_limit:1,template:{id:order.script_id,version:'B',message:order.message}}};
  throw Error('unexpected fake RPC '+JSON.stringify(body));};
 const execute=async(cmd,args)=>{events.push({cmd,args});let stdout='';
  const action=args.find(x=>['preflight','lock-acquire','lock-refresh','lock-release','account-current','close-app','return-safe-desktop','private-message-send','ui-evidence'].includes(x));
  if(cmd==='adb')stdout=args.includes('get-state')?'device\n':args.includes('telephony.registry')?'mCallState=0\n':'';
  if(action==='preflight')stdout='serial=FAKE6983\n';
  if(action?.startsWith('lock-'))stdout='lock='+({'lock-acquire':'acquired','lock-refresh':'refreshed','lock-release':'released'}[action])+'\n';
  if(action==='account-current')stdout='douyin_id=langzi63485\n';
  if(action==='private-message-send')stdout='send_status=sent\nsender_douyin_id=langzi63485\ntarget_douyin_id=1873867835\n';
  return {code:0,stdout,stderr:''};};
 return {dir,env,events,order,rpc,execute,clean:()=>rmSync(dir,{recursive:true,force:true})};
}
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
