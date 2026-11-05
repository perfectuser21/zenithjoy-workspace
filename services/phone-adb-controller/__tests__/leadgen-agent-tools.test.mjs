import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const module=await import('../leadgen-agent-tools.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const scope=(activity='collect_videos')=>({workflow:'douyin_video_discovery',activity,run:'agent_fixture',run_id:'douyin_video_discovery-agent_fixture__a1',task_id:'28f30d70-7248-434b-a1d4-29afed626017',binding_id:'00000000-0000-4000-8000-000000000001',source_commit:'a'.repeat(40),snapshot_sha256:'b'.repeat(64),profile:'fixture',serial:'fixture-serial',line:'yuesheng',source_run:null,limit:2,comment_limit:5,deadline_ms:Date.now()+30000});
async function using(fn,overrides={}){
  assert.equal(typeof module.createLeadgenAgentTools,'function','必须存在不经业务handler的正式受控原语入口');
  const runDir=mkdtempSync(join(tmpdir(),'agent-tools-')),calls=[];
  const primitives={assertResources:async()=>true,prepare:async()=>({}),settle:async()=>({status:'completed',videos:1}),release:async()=>({released:true}),
    phone:async(command,...args)=>{calls.push({command,args});return {native:true};},
    queue:async(op,input)=>{calls.push({op,input});return {inserted:true,metrics_verified:true,status:'pending'};},
    validateInput:async(op,input)=>input,inspect:async()=>({}),...overrides.primitives};
  const tools=module.createLeadgenAgentTools({scope:{...scope(),...overrides.scope},runDir,primitives});
  try{await fn(tools,calls,runDir);}finally{rmSync(runDir,{recursive:true,force:true});}
}
const video={videoId:'1234567890123456',videoUrl:'https://www.douyin.com/video/1234567890123456',metrics:{comment_total:{value:2}}};
test('scope和配额由server拥有；Agent不能覆盖公司、run、截止或策略',async()=>using(async(t,calls)=>{
  for(const key of ['line','run','source_run','task_id','source_commit','limit','deadline_ms','policy'])await assert.rejects(()=>t.business('discover',{video,[key]:'foreign'}),/INPUT|SCOPE/);
  await t.business('discover',{video});
  assert.equal(calls.length,1);assert.equal(calls[0].input.line,'yuesheng');assert.equal(calls[0].input.run,'agent_fixture');assert.equal(calls[0].input.limit,2);
}));
test('原生confirmed0在持久队列调用之前被拒绝，不制造视频任务',async()=>using(async(t,calls)=>{
  await assert.rejects(()=>t.business('discover',{video:{...video,metrics:{comment_total:{value:0}}}}),/CONFIRMED_ZERO_COMMENTS/);assert.equal(calls.length,0);
}));
test('工具按Activity分配，不能调用整段业务、resume、发送或修改锁',async()=>using(async(t,calls)=>{
  for(const op of ['score','collect','resume','send_dm','claim_videos'])await assert.rejects(()=>t.business(op,{}),/OPERATION/);
  for(const command of ['collect-comments','private-message-send','lock-acquire','lock-release','account-switch'])await assert.rejects(()=>t.phone(command),/PHONE/);
  assert.equal(calls.length,0);
}));
test('持久intent防止未知写入重发；新实例也只许对应读回',async()=>{
  let writes=0;
  await using(async(t,_calls,runDir)=>{
  await assert.rejects(()=>t.business('discover',{video}),/UNKNOWN/);
  const again=module.createLeadgenAgentTools({scope:(await t.inspect()).scope,runDir,primitives:{assertResources:async()=>true,validateInput:async(_op,x)=>x,queue:async()=>{writes++;throw Error('不得重发');},inspect:async()=>({})}});
  await assert.rejects(()=>again.business('discover',{video}),/READBACK_REQUIRED/);
  assert.equal(writes,1);
  },{primitives:{queue:async()=>{writes++;throw Object.assign(Error('COMMIT_UNKNOWN'),{externalEffect:'unknown'});}}});
});
test('已确认写入重入返回原回执，不重新调用；输入变更拒绝',async()=>using(async(t,calls)=>{
  const a=await t.business('discover',{video}),b=await t.business('discover',{video});assert.deepEqual(a,b);assert.equal(calls.length,1);
  await assert.rejects(()=>t.business('discover',{video:{...video,title:'changed'}}),/IDENTITY_REUSED/);
}));
test('未收到独立停止证明不得settle或释放，Agent文本不能提交Activity状态',async()=>using(async(t,calls)=>{
  await assert.rejects(()=>t.settle({execution_stopped:false}),/TERMINATION/);
  await assert.rejects(()=>t.release({execution_stopped:false}),/TERMINATION/);
  assert.equal(t.getResult(),null);
  await assert.rejects(()=>t.business('complete',{status:'completed'}),/OPERATION/);
  await t.settle({execution_stopped:true});assert.deepEqual(t.getResult(),{status:'completed',videos:1});assert.equal(calls.length,0);
}));
test('未知写入只开放与原intent精确对应的纯SELECT读回，读回不能洗掉隔离',async()=>{
  const calls=[];
  await using(async(t)=>{
    await assert.rejects(()=>t.business('discover',{video}),/UNKNOWN/);
    assert.equal(t.canReadback('discover_readback',{video}),true);
    assert.equal(t.canReadback('discover_readback',{video:{...video,videoId:'2234567890123456'}}),false);
    assert.equal(t.canReadback('score_recovery',{ids:[]}),false);
    const readback=await t.business('discover_readback',{video});assert.equal(readback.metrics_verified,true);
    await assert.rejects(()=>t.settle({execution_stopped:true}),/UNKNOWN/);
    await assert.rejects(()=>t.business('discover',{video:{...video,videoId:'2234567890123456'}}),/UNKNOWN/);
  },{primitives:{queue:async(op,input)=>{calls.push({op,input});if(op==='discover')throw Error('lost acknowledgement');return {metrics_verified:true,recovered:true,status:'pending'};}}});
  assert.deepEqual(calls.map(c=>c.op),['discover','discover_readback']);
});
test('同VID首批partial与后批累计合并，最终零新增ACK不抹掉真实累计覆盖',()=>{
  assert.equal(typeof module.mergeAgentCollectionRows,'function');assert.equal(typeof module.aggregateAgentCollectionCommit,'function');
  const vid='1234567890123456',record=(id,body)=>({video_id:vid,row:{douyinId:id,commentBody:body}}),first=record('person1','咨询价格'),second=record('person2','如何联系');
  let rows=module.mergeAgentCollectionRows({previous:[],fresh:[first],videoId:vid,limit:2});
  let stored=module.aggregateAgentCollectionCommit({previousInserted:0,receipt:{video_id:vid,inserted:1,comments:1,history_verified:0,coverage:1},videoId:vid,comments:1,historical:0});
  rows=module.mergeAgentCollectionRows({previous:rows,fresh:[second],videoId:vid,limit:2});
  stored=module.aggregateAgentCollectionCommit({previousInserted:stored.inserted,receipt:{video_id:vid,inserted:1,comments:2,history_verified:0,coverage:2},videoId:vid,comments:2,historical:0});
  const final=module.aggregateAgentCollectionCommit({previousInserted:stored.inserted,receipt:{video_id:vid,inserted:0,comments:2,history_verified:0,coverage:2},videoId:vid,comments:2,historical:0});
  assert.equal(rows.length,2);assert.equal(final.inserted,2);assert.equal(final.coverage,2);
  assert.equal(module.mergeAgentCollectionRows({previous:rows,fresh:[first],videoId:vid,limit:2}).length,2);
  assert.throws(()=>module.mergeAgentCollectionRows({previous:rows,fresh:[record('person3','更多')],videoId:vid,limit:2}),/LIMIT/);
  assert.throws(()=>module.aggregateAgentCollectionCommit({previousInserted:2,receipt:{video_id:vid,inserted:1,comments:2,history_verified:0,coverage:2},videoId:vid,comments:2,historical:0}),/COMMIT/);
});
test('server续期每次新鲜执行，未知续期永久阻止原生动作和settle',async()=>{
  let refreshes=0;
  await using(async t=>{
    assert.equal(typeof t.heartbeat,'function');
    await t.heartbeat();await t.heartbeat();assert.equal(refreshes,2);
    await assert.rejects(()=>t.heartbeat(),/UNKNOWN/);
    await assert.rejects(()=>t.phone('ui-evidence'),/UNKNOWN/);
    await assert.rejects(()=>t.settle({execution_stopped:true}),/UNKNOWN/);
  },{primitives:{heartbeat:async()=>{if(++refreshes===3)throw Error('lost lease ACK');return {renewed:true};}}});
});

test('可信scope可使用规范云serial；连接或改ADB服务仍不在Agent白名单',async()=>using(async(t,calls)=>{
 assert.equal((await t.inspect()).scope.serial,'47.100.213.173:10001');
 for(const command of ['connect','disconnect','start-server','kill-server'])await assert.rejects(()=>t.phone(command),/PHONE/);
 assert.equal(calls.length,0);
},{scope:{serial:'47.100.213.173:10001',profile:'cloud-phone-test'}}));
