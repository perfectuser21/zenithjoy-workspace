import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {createOutreachHandlers} from '../leadgen-outreach.mjs';

const require=createRequire(import.meta.url);
const route=require('../line-routes.js').routeOf('jinuo');
function fixture(mode){
 const home=mkdtempSync(join(tmpdir(),'outreach-mode-'));
 const profile='jinoshengyuan-work',sender='sender123',serial='SERIAL',run='fake104';
 const scope=mode==='exact'?{schema_version:1,record_id:'recEXACT123456',comment_id:'comment123',company_id:'company-test',source_run:'source102',mark_run:'mark103',target_douyin_id:'target123',line_key:'jinuo',run_tag:run,profile,serial}:null;
 const state={source_commit:'a'.repeat(40),account:sender,outreach_scope:scope,company_config:{company_id:'company-test',tenant_id:'tenant-test',version:1,product_ids:[],policy_id:'policy-test',runtime_config:{contact_rules:{ssot:'feishu',feishu_base:route.base,orders_table:route.lead,approved_scripts_table:route.script},platform_accounts:[{profile,verification_status:'verified',enabled:true,douyin_id:sender,device_serial:serial}]}}};
 const env={HOME:home,P:profile,SERIAL:serial,WFR_TAG:run,LEADGEN_LINE:'jinuo',LEADGEN_SEND:'1',LEADGEN_LIMIT:'1',LEADGEN_OUTREACH_MODE:mode,WFR_RUN_DIR:home};
 const rpc=async()=>({result:{line_key:'jinuo',profile,sender_douyin_id:sender,daily_cap:10,template:{id:'script-B',version:'B',message:'批准内容'}}});
 return {home,scope,state,env,rpc,clean:()=>rmSync(home,{recursive:true,force:true})};
}

test('104 exact 模式RPC若回错飞书记录，手机发送和额度写入前拒绝',async()=>{
 const f=fixture('exact');let phoneCalls=0;
 try{
  const handlers=createOutreachHandlers({env:f.env,state:f.state,rpc:f.rpc,phone:async()=>{phoneCalls++;},queue:async()=>[{id:'recOTHER123456',line_key:'jinuo',douyin_id:'target123',sender_douyin_id:'sender123',script_id:'script-B',script_version:'B',message:'批准内容'}]});
  await handlers.preflight();
  await assert.rejects(handlers.send_dm(),/OUTREACH_SCOPE_ORDER_MISMATCH/);
  assert.equal(phoneCalls,0);
 }finally{f.clean();}
});

test('104普通模式预检及空队列保持原skipped语义，不要求精确scope',async()=>{
 const f=fixture('company_queue');let input;
 try{
  const handlers=createOutreachHandlers({env:f.env,state:f.state,rpc:f.rpc,phone:async()=>{throw Error('手机不应执行');},queue:async(_op,request)=>{input=request;return [];}});
  await handlers.preflight();
  const result=await handlers.send_dm();
  assert.equal(result.status,'skipped');
  assert.equal(input.outreach_mode,'company_queue');
  assert.equal(input.outreach_scope,null);
 }finally{f.clean();}
});
