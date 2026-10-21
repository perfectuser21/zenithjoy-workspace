// 离线回归：真实handler→真实execInput→原逐视频脚本；只替换手机和数据库边界。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,readdirSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHandlers} from '../leadgen-handlers.mjs';
import {execInput} from '../leadgen-client.mjs';
import {invokeNativeActivity} from '../leadgen-workflow.mjs';

const root=new URL('../',import.meta.url).pathname;
const videos=['7681632828384394202','7681632828384394203'];
async function runCase({innerTimeout=false}={}){
 const dir=mkdtempSync(join(tmpdir(),'native-skill-handoff-red-'));
 const ctl=join(dir,'fixture-phone');
 writeFileSync(ctl,`#!/usr/bin/env node
const fs=require('fs'),p=require('path'),a=process.argv.slice(2),d=process.env.FIXTURE_PHONE_DIR;
if(a[2]==='--lock-owner')a.splice(2,2);
const command=a[2],args=a.slice(3);fs.appendFileSync(p.join(d,'calls'),JSON.stringify({command,args})+'\\n');
if(command==='lock-refresh')console.log('lock=refreshed owner=handoff-red ttl=300s');
else if(command==='open-video')fs.writeFileSync(p.join(d,'active'),args[0]);
else if(command==='current-video-link')console.log('content_type=video\\nvideo_id='+fs.readFileSync(p.join(d,'active'),'utf8'));
else if(command==='open-comments')console.log('comments_opened=1\\ncomment_count=1');
else if(command==='collect-comments'){
 if(process.env.FIXTURE_INNER_TIMEOUT==='1'){
  // 控制器内层有界子操作返回124。原qv_collect会把它折成6，不能失去停止未知事实。
  console.error('fixture inner bounded child timeout');process.exitCode=124;
 }else console.log('exhausted=1');
}
`,{mode:0o755});
 const env={...process.env,HOME:dir,WFR_RUN_DIR:dir,WFR_TAG:'handoff-red',WFR_RUN_ID:'run-red',WFR_ATTEMPT:'a1',P:'work',SERIAL:'NO-DEVICE',LEADGEN_LINE:'jinuo',DOUYIN_PHONE_ADB:ctl,FIXTURE_PHONE_DIR:dir,FIXTURE_INNER_TIMEOUT:innerTimeout?'1':'0',HARVEST_KEYWORD_TESTING:'1'};
 const actions=[];
 const handlers=createHandlers({root,env,taskId:'handoff-red-task',sourceCommit:'a'.repeat(40),
  rpc:async({request:q})=>({result:q.op==='company_config'?{company_id:'fixture-company',version:1}:q.op==='claim_videos'?videos.map(video_id=>({video_id,video_url:'https://www.douyin.com/video/'+video_id,judgment_status:'matched',judgment_config:{company_id:'fixture-company',version:1}})):q.op==='comment_history'?{version:1,status:'verified',line:'jinuo',line_key:'jinuo',run:'handoff-red',source_run:null,video_id:q.video_id,video_url:q.video_url,rows:[]}:q.op==='collect'?{comments:0,inserted:0,history_verified:0,coverage:0}:q.op==='comment_history_readback'?{verified:true,video_id:q.video_id,ids:[],history_verified:0}:{}}),
  execute:async(command,args,opts)=>{const result=await execInput(command,args,opts);if(args[1]==='collection')actions.push({receipt:opts.receipt,result});return result;}});
 try{
  handlers.state.currentActivity='qualification';await handlers.qualification();
  handlers.state.currentActivity='collection';handlers.state.budgetDeadline=Date.now()+30000;
  const result=await invokeNativeActivity(()=>handlers.collection(),handlers.state);
  const calls=readFileSync(join(dir,'calls'),'utf8').trim().split('\n').map(JSON.parse);
  const receipts=existsSync(join(dir,'native-operations'))?readdirSync(join(dir,'native-operations')).map(p=>JSON.parse(readFileSync(join(dir,'native-operations',p),'utf8'))):[];
  return {result,actions,calls,receipts,state:handlers.state};
 }finally{rmSync(dir,{recursive:true,force:true});}
}

test('真实逐视频collection必须登记同run/activity的每次原生执行，不能绕过receipt',async()=>{
 const r=await runCase();assert.equal(r.result.videos_processed,2,'先证明真实原脚本已执行到完成，不能setup失败冒红');
 assert.equal(r.actions.length,2);
 for(const action of r.actions){assert.ok(action.receipt,'videoAction目前漏receipt');assert.equal(action.receipt.activity,'collection');assert.equal(action.receipt.runId,'run-red__a1');}
 assert.equal(r.receipts.filter(x=>x.activity==='collection').length,2);
});

test('内层controller124折成业务code6后仍须粘滞unknown，禁止下一视频或Skill并发接管',async()=>{
 const r=await runCase({innerTimeout:true});assert.equal(r.actions[0].result.code,6,'必须覆盖原生产qv_collect吞内层124的路径');
 assert.equal(r.result.status,'partial');
 assert.equal(r.state.executionUnknown,true,'内层超时丢失，不能把业务失败当确认停机');
 assert.equal(r.result.execution_stopped,false);
 assert.equal(r.calls.filter(x=>x.command==='open-video').length,3,'两次资格identity后仅允许第一个collection，不能操作下个视频');
});
