import test from 'node:test';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync,rmSync,statSync} from 'node:fs';
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

test('resource_prepare失败持久保存原错误码和cause，但保留未解决intent并禁止重发、phone与settle',async()=>{
 let prepares=0,settles=0;
 const secret='sk-private-fixture-token-never-journal';
 const wire=Object.assign(Error(secret),{code:'ADB_SHELL_V2_SOCKET'}),command=Object.assign(Error(secret),{code:'NATIVE_PHONE_COMMAND_UNKNOWN',cause:wire});
 const failure=Object.assign(Error(secret),{code:'NATIVE_PHONE_COMMAND_CLOSE_UNKNOWN',cause:command,diagnostics:{private_value:secret}});
 await using(async(tools,calls,runDir)=>{
  let thrown;try{await tools.prepare();}catch(error){thrown=error;}
  assert.equal(thrown?.message,'AGENT_TOOL_COMMIT_UNKNOWN_READBACK_REQUIRED');assert.equal(thrown?.externalEffect,'unknown');
  const folder=join(runDir,'agent-tools','preflight'),names=readdirSync(folder),intentName=names.find(name=>name.endsWith('.intent.json'));
  assert.ok(intentName);const key=intentName.slice(0,-'.intent.json'.length),failureName=key+'.failure.json';
  assert.ok(names.includes(failureName),'a failed prepare needs a durable diagnostic separate from its unresolved intent');
  assert.equal(names.includes(key+'.result.json'),false,'diagnostics must not manufacture a successful result');
  const diagnostic=JSON.parse(readFileSync(join(folder,failureName),'utf8')),intent=JSON.parse(readFileSync(join(folder,intentName),'utf8'));
  assert.equal(diagnostic.operation,'resource_prepare');assert.equal(diagnostic.scope_key,intent.scope_key);assert.deepEqual(diagnostic.scope,intent.scope);
  assert.equal(diagnostic.error_code,'NATIVE_PHONE_COMMAND_CLOSE_UNKNOWN');assert.deepEqual(diagnostic.cause_codes,['NATIVE_PHONE_COMMAND_UNKNOWN','ADB_SHELL_V2_SOCKET']);assert.ok(Number.isFinite(Date.parse(diagnostic.observed_at)));
  assert.equal(statSync(join(folder,failureName)).mode&0o777,0o600);assert.equal(readFileSync(join(folder,failureName),'utf8').includes(secret),false);
  assert.deepEqual((await tools.inspect()).pending_write_readbacks,[{operation:'resource_prepare',readback_operations:[]}]);
  await assert.rejects(()=>tools.prepare(),/AGENT_TOOL_COMMIT_UNKNOWN_READBACK_REQUIRED/);await assert.rejects(()=>tools.phone('foreground'),/READBACK_REQUIRED/);await assert.rejects(()=>tools.settle({execution_stopped:true}),/READBACK_REQUIRED/);
  assert.equal(prepares,1);assert.equal(settles,0);assert.equal(calls.length,0);
 },{scope:{activity:'preflight'},primitives:{prepare:async()=>{prepares++;throw failure;},settle:async()=>{settles++;return {};}}});
});

test('prepare failure诊断只记录规范code并限制cause深度，拒绝任意message、stack和diagnostics',async()=>{
 const secret='sk-private-fixture-token-never-journal';
 const chain=Array.from({length:7},(_,index)=>Object.assign(Error(secret),{code:'NATIVE_PHONE_CAUSE_'+index}));for(let index=0;index<chain.length-1;index++)chain[index].cause=chain[index+1];
 const failure=Object.assign(Error(secret),{code:'TOKEN='+secret,cause:chain[0],diagnostics:{value:secret}});
 await using(async(tools,_calls,runDir)=>{
  await assert.rejects(()=>tools.prepare(),/AGENT_TOOL_COMMIT_UNKNOWN_READBACK_REQUIRED/);
  const folder=join(runDir,'agent-tools','preflight'),name=readdirSync(folder).find(value=>value.endsWith('.failure.json'));assert.ok(name);
  const text=readFileSync(join(folder,name),'utf8'),diagnostic=JSON.parse(text);assert.equal(diagnostic.error_code,null);assert.deepEqual(diagnostic.cause_codes,['NATIVE_PHONE_CAUSE_0','NATIVE_PHONE_CAUSE_1','NATIVE_PHONE_CAUSE_2','NATIVE_PHONE_CAUSE_3']);assert.equal(text.includes(secret),false);assert.equal(Object.hasOwn(diagnostic,'stack'),false);assert.equal(Object.hasOwn(diagnostic,'message'),false);assert.equal(Object.hasOwn(diagnostic,'diagnostics'),false);
 },{scope:{activity:'preflight'},primitives:{prepare:async()=>{throw failure;}}});
});

 test('预检首轮上下文提供已准入bootstrap和真实空参schema，账号仍须原生读取',async()=>using(async tools=>{
 await tools.prepare();const context=await tools.inspect();
 assert.equal(context.bootstrap.company_config_admitted,true);
 assert.deepEqual(context.bootstrap.next_required_intent,{type:'phone',command:'wake',args:[]});
 assert.deepEqual(context.tool_contract.business.company_config,{input_keys:[]});
 assert.deepEqual(context.tool_contract.phone['account-current'],{args:[]});
 assert.equal(context.account,null);
 await assert.rejects(()=>tools.business('company_config',{company_id:'foreign'}),/INPUT_SCOPE/);
 await assert.rejects(()=>tools.phone('account-current','invented'),/PREFLIGHT_ARGS/);
 },{scope:scope('preflight'),primitives:{inspect:async()=>({company:{company_id:'server-company',tenant_id:'server-tenant',device_binding:{profile:'fixture'}},account:null}),validatePhone:async(_command,args)=>{if(args.length)throw Error('PREFLIGHT_ARGS');return [];}}}));

test('失败open-app不推进bootstrap到账号读取，已准入资源不能掩盖原生失败',async()=>using(async tools=>{
 await tools.prepare();await tools.phone('wake');await tools.phone('unlock');
 await assert.rejects(()=>tools.phone('open-app'),/NATIVE_OPEN_FAILED/);
 const context=await tools.inspect();assert.equal(context.bootstrap.next_required_intent.command,'open-app');
 assert.deepEqual(context.bootstrap.native_phone_steps_completed,['wake','unlock']);assert.equal(context.account,null);
},{scope:scope('preflight'),primitives:{inspect:async()=>({company:{company_id:'server-company',tenant_id:'server-tenant',device_binding:{profile:'fixture'}},account:null}),validatePhone:async()=>[],phone:async command=>{if(command==='open-app')throw Error('NATIVE_OPEN_FAILED');return '';}}}));

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const nextTurn=()=>new Promise(resolve=>setImmediate(resolve));

test('同一在飞心跳确认成功后手机动作重新准入，只派发一次，不误报提交未知',async()=>{
 const entered=deferred(),finish=deferred();let actions=0,guards=0;
 await using(async tools=>{
  const heartbeat=tools.heartbeat();await entered.promise;
  let settled=false;const phone=tools.phone('open-app').then(value=>{settled=true;return {value};},error=>{settled=true;return {error};});
  await nextTurn();assert.equal(settled,false,'仍在飞的心跳不是提交未知，phone应等同一轮确认');assert.equal(actions,0);
  const previous=guards;finish.resolve({renewed:true});await heartbeat;
  const outcome=await phone;assert.equal(outcome.error,undefined);assert.equal(actions,1);assert.ok(guards>previous,'确认后仍须新鲜资源准入');
  assert.deepEqual((await tools.inspect()).pending_write_readbacks,[]);
 },{scope:scope('preflight'),primitives:{assertResources:async()=>{guards++;return true;},heartbeat:async()=>{entered.resolve();return finish.promise;},validatePhone:async()=>[],phone:async()=>{actions++;return '';}}});
});

test('等待失败心跳不得派手机、重发心跳或消除未决intent',async()=>{
 const entered=deferred(),finish=deferred();let actions=0,refreshes=0;
 await using(async tools=>{
  const heartbeat=tools.heartbeat().catch(error=>error);await entered.promise;
  const phone=tools.phone('open-app').then(()=>null,error=>error);await nextTurn();
  finish.reject(Object.assign(Error('lease acknowledgement lost'),{code:'CENTRAL_LOCK_UNKNOWN'}));
  assert.match((await heartbeat).message,/UNKNOWN/);assert.match((await phone).message,/UNKNOWN/);
  assert.equal(actions,0);assert.equal(refreshes,1);
  assert.deepEqual((await tools.inspect()).pending_write_readbacks,[{operation:'resource_heartbeat',readback_operations:[]}]);
  await assert.rejects(()=>tools.phone('open-app'),/UNKNOWN/);assert.equal(actions,0);
 },{scope:scope('preflight'),primitives:{heartbeat:async()=>{refreshes++;entered.resolve();return finish.promise;},validatePhone:async()=>[],phone:async()=>{actions++;return '';}}});
});

test('心跳等待到原截止后成功也不得派手机或扩展原scope',async()=>{
 const entered=deferred(),finish=deferred();let expired=false,actions=0;
 const deadline=Date.now()+30000;
 await using(async tools=>{
  const heartbeat=tools.heartbeat();await entered.promise;
  const phone=tools.phone('open-app').then(()=>null,error=>error);await nextTurn();
  expired=true;finish.resolve({renewed:true});await heartbeat;
  assert.match((await phone).message,/DEADLINE/);assert.equal(actions,0);
  assert.equal((await tools.inspect()).scope.deadline_ms,deadline);
 },{scope:{...scope('preflight'),deadline_ms:deadline},primitives:{assertResources:async()=>{if(expired)throw Error('AGENT_TOOL_DEADLINE');return true;},heartbeat:async()=>{entered.resolve();return finish.promise;},validatePhone:async()=>[],phone:async()=>{actions++;return '';}}});
});

test('心跳后并发手机请求只有一个占槽，fresh guard期间新心跳不得插队',async()=>{
 const entered=deferred(),finish=deferred(),phoneGuard=deferred(),guardRelease=deferred();let phase='heartbeat',guards=0,actions=0,refreshes=0;
 await using(async tools=>{
  const heartbeat=tools.heartbeat();await entered.promise;
  const a=tools.phone('open-app').then(()=>({ok:true}),error=>({error}));
  const b=tools.phone('open-app').then(()=>({ok:true}),error=>({error}));
  phase='phone';finish.resolve({renewed:true});await heartbeat;
  const admitted=await Promise.race([phoneGuard.promise.then(()=>true),Promise.all([a,b]).then(()=>false)]);
  assert.equal(admitted,true,'等待成功后应进入phone的新鲜准入，而非拒绝两个请求');
  const during=await tools.heartbeat();assert.deepEqual(during,{deferred:true});assert.equal(refreshes,1);
  guardRelease.resolve();const outcomes=await Promise.all([a,b]);
  assert.equal(outcomes.filter(x=>x.ok).length,1);assert.equal(actions,1);
 },{scope:scope('preflight'),primitives:{assertResources:async()=>{guards++;if(phase==='phone'&&guards===2){phoneGuard.resolve();await guardRelease.promise;}return true;},heartbeat:async()=>{refreshes++;entered.resolve();return finish.promise;},validatePhone:async()=>[],phone:async()=>{actions++;return '';}}});
});

test('business异步准入期间先占操作槽，手机不得与稍后提交的写入交叉',async()=>{
 const entered=deferred(),release=deferred();let firstGuard=true,actions=0,writes=0;
 await using(async tools=>{
  const business=tools.business('discover',{video});await entered.promise;
  const phone=tools.phone('open-search').then(()=>null,error=>error);
  await nextTurn();const beforeRelease=actions;
  release.resolve();await business;
  const error=await phone;assert.equal(beforeRelease,0);assert.match(error?.message||'',/BUSY|UNKNOWN/);assert.equal(writes,1);
  await tools.phone('open-search');assert.equal(actions,1);
 },{primitives:{assertResources:async()=>{if(firstGuard){firstGuard=false;entered.resolve();await release.promise;}return true;},validatePhone:async()=>[],phone:async()=>{actions++;return '';},queue:async()=>{writes++;return {inserted:true};}}});
});

test('异步phone准入越过worker原截止时不得发指令，即使scope收尾窗尚未结束',async t=>{
 const now=Date.now(),entered=deferred(),release=deferred();let actions=0;
 t.mock.timers.enable({apis:['Date'],now});
 await using(async tools=>{
  const phone=tools.phone('open-app').then(()=>null,error=>error);await entered.promise;
  t.mock.timers.setTime(now+2000);release.resolve();
  const error=await phone;assert.match(error?.message||'',/DEADLINE/);assert.equal(actions,0);
 },{scope:{...scope('preflight'),worker_deadline_ms:now+1000,deadline_ms:now+10000},primitives:{validatePhone:async()=>{entered.resolve();await release.promise;return [];},phone:async()=>{actions++;return '';}}});
});

test('等待心跳到原截止只结束waiter，原heartbeat保持一次且自行结算原intent',async t=>{
 const now=Date.now(),entered=deferred(),finish=deferred();let refreshes=0,actions=0;
 t.mock.timers.enable({apis:['Date','setTimeout'],now});
 await using(async tools=>{
  const heartbeat=tools.heartbeat();await entered.promise;
  const phone=tools.phone('open-app').then(()=>null,error=>error);await nextTurn();
  t.mock.timers.tick(1001);const error=await phone;assert.match(error?.message||'',/DEADLINE/);
  assert.equal(actions,0);assert.equal(refreshes,1);assert.equal(tools.heartbeat(),heartbeat,'等待超时不得换job或重发');
  assert.deepEqual((await tools.inspect()).pending_write_readbacks,[{operation:'resource_heartbeat',readback_operations:[]}]);
  finish.resolve({renewed:true});await heartbeat;assert.equal(refreshes,1);
  assert.deepEqual((await tools.inspect()).pending_write_readbacks,[]);
  await assert.rejects(()=>tools.phone('open-app'),/DEADLINE/);assert.equal(actions,0);
 },{scope:{...scope('preflight'),worker_deadline_ms:now+1000,deadline_ms:now+10000},primitives:{heartbeat:async()=>{refreshes++;entered.resolve();return finish.promise;},validatePhone:async()=>[],phone:async()=>{actions++;return '';}}});
});

test('已提交discover在飞心跳期间读回等待确认，只读一次且不重发写入',async()=>{
 const entered=deferred(),finish=deferred();
 await using(async(tools,calls)=>{
  await tools.business('discover',{video});
  const heartbeat=tools.heartbeat();await entered.promise;
  let settled=false;const readback=tools.business('discover_readback',{video}).then(value=>{settled=true;return {value};},error=>{settled=true;return {error};});
  await nextTurn();const before={settled,readbacks:calls.filter(c=>c.op==='discover_readback').length};
  finish.resolve({renewed:true});await heartbeat;const outcome=await readback;
  assert.deepEqual(before,{settled:false,readbacks:0});assert.equal(outcome.error,undefined);assert.equal(outcome.value.metrics_verified,true);
  assert.deepEqual(calls.map(c=>c.op),['discover','discover_readback']);
  assert.deepEqual((await tools.inspect()).pending_write_readbacks,[]);
 },{primitives:{heartbeat:async()=>{entered.resolve();return finish.promise;}}});
});

for(const kind of ['business','phone'])test(kind+'等待链式心跳的当前确认后才执行一次',async()=>{
 const entered=deferred(),first=deferred(),second=deferred();let refreshes=0,actions=0;
 await using(async tools=>{
  const heartbeat=tools.heartbeat();await entered.promise;
  const following=heartbeat.then(()=>tools.heartbeat());
  let settled=false;const operation=(kind==='business'?tools.business('discover_readback',{video}):tools.phone('ui-evidence')).then(value=>{settled=true;return {value};},error=>{settled=true;return {error};});
  first.resolve({renewed:true});await nextTurn();const before={settled,refreshes,actions};
  second.resolve({renewed:true});await following;const outcome=await operation;
  assert.deepEqual(before,{settled:false,refreshes:2,actions:0});assert.equal(outcome.error,undefined);assert.equal(actions,1);
  assert.deepEqual((await tools.inspect()).pending_write_readbacks,[]);
 },{primitives:{heartbeat:async()=>{if(++refreshes===1){entered.resolve();return first.promise;}return second.promise;},queue:async()=>{actions++;return {metrics_verified:true};},phone:async()=>{actions++;return {native:true};}}});
});

test('真实两个business并发仍拒绝后者且只提交一个写入',async()=>{
 const entered=deferred(),finish=deferred();let writes=0;
 await using(async tools=>{
  const first=tools.business('discover',{video});await entered.promise;
  const second=tools.business('discover',{video:{...video,videoId:'2234567890123456'}}).then(()=>null,error=>error);
  const error=await second;finish.resolve({inserted:true});await first;
  assert.match(error?.message||'',/OPERATION_BUSY/);assert.equal(writes,1);
 },{primitives:{queue:async()=>{writes++;entered.resolve();return finish.promise;}}});
});

for(const kind of ['business','phone'])test('心跳失败时等待的'+kind+'不得提交或消除未知',async()=>{
 const entered=deferred(),finish=deferred();let writes=0,actions=0,unknown=0,refreshes=0;
 await using(async tools=>{
  const heartbeat=tools.heartbeat().catch(error=>error);await entered.promise;
  const operation=(kind==='business'?tools.business('discover',{video}):tools.phone('ui-evidence')).then(()=>null,error=>error);
  await nextTurn();finish.reject(Error('lost lease acknowledgement'));
  assert.match((await heartbeat).message,/UNKNOWN/);assert.match((await operation).message,/UNKNOWN/);
  assert.equal(writes,0);assert.equal(actions,0);assert.equal(refreshes,1);assert.equal(unknown,1);
  assert.deepEqual((await tools.inspect()).pending_write_readbacks,[{operation:'resource_heartbeat',readback_operations:[]}]);
  await assert.rejects(()=>tools.business('discover',{video}),/UNKNOWN/);await assert.rejects(()=>tools.phone('ui-evidence'),/UNKNOWN/);
  assert.equal(writes,0);assert.equal(actions,0);
 },{primitives:{heartbeat:async()=>{refreshes++;entered.resolve();return finish.promise;},resourceUnknown:()=>unknown++,queue:async()=>{writes++;return {};},phone:async()=>{actions++;return {};}}});
});

for(const kind of ['business','phone'])test(kind+'等心跳只能使用原worker截止，不借用收尾窗口',async t=>{
 const now=Date.now(),entered=deferred(),finish=deferred();let effects=0;
 t.mock.timers.enable({apis:['Date','setTimeout'],now});
 await using(async tools=>{
  const heartbeat=tools.heartbeat();await entered.promise;
  const operation=(kind==='business'?tools.business('discover',{video}):tools.phone('ui-evidence')).then(()=>null,error=>error);
  await nextTurn();t.mock.timers.tick(1001);const error=await operation;
  const pending=(await tools.inspect()).pending_write_readbacks;
  finish.resolve({renewed:true});await heartbeat;
  assert.match(error?.message||'',/DEADLINE/);assert.equal(effects,0);
  assert.deepEqual(pending,[{operation:'resource_heartbeat',readback_operations:[]}]);
  const original=(await tools.inspect()).scope;assert.equal(original.worker_deadline_ms,now+1000);assert.equal(original.deadline_ms,now+10000);
 },{scope:{worker_deadline_ms:now+1000,deadline_ms:now+10000},primitives:{heartbeat:async()=>{entered.resolve();return finish.promise;},queue:async()=>{effects++;return {};},phone:async()=>{effects++;return {};}}});
});

for(const kind of ['business','phone'])test(kind+'先入槽时同tick心跳保持deferred，不交叉执行',async()=>{
 const entered=deferred(),finish=deferred();let effects=0,refreshes=0;
 await using(async tools=>{
  const operation=kind==='business'?tools.business('discover',{video}):tools.phone('ui-evidence');
  const heartbeat=tools.heartbeat();await entered.promise;
  const result=await heartbeat;finish.resolve();await operation;
  assert.deepEqual(result,{deferred:true});assert.equal(effects,1);assert.equal(refreshes,0);
 },{primitives:{heartbeat:async()=>{refreshes++;return {};},queue:async()=>{effects++;entered.resolve();await finish.promise;return {};},phone:async()=>{effects++;entered.resolve();await finish.promise;return {};}}});
});

for(const boundary of ['resources','input'])test('心跳结束后'+boundary+'异步校验跨worker截止不得发起业务',async t=>{
 const now=Date.now(),heartbeatEntered=deferred(),heartbeatFinish=deferred(),validationEntered=deferred(),validationFinish=deferred();let validating=false,writes=0;
 t.mock.timers.enable({apis:['Date'],now});
 const validate=async()=>{if(validating){validationEntered.resolve();await validationFinish.promise;}return true;};
 await using(async tools=>{
  const heartbeat=tools.heartbeat();await heartbeatEntered.promise;
  const business=tools.business('discover',{video}).then(()=>null,error=>error);
  validating=true;heartbeatFinish.resolve({renewed:true});await heartbeat;await validationEntered.promise;
  t.mock.timers.setTime(now+1100);validationFinish.resolve();
  const error=await business;assert.equal(error?.message,'AGENT_TOOL_DEADLINE');assert.equal(writes,0);
  assert.deepEqual((await tools.inspect()).pending_write_readbacks,[]);
  const original=(await tools.inspect()).scope;assert.equal(original.worker_deadline_ms,now+1000);assert.equal(original.deadline_ms,now+10000);
 },{scope:{worker_deadline_ms:now+1000,deadline_ms:now+10000},primitives:{heartbeat:async()=>{heartbeatEntered.resolve();return heartbeatFinish.promise;},assertResources:boundary==='resources'?validate:async()=>true,validateInput:async(_op,input)=>{if(boundary==='input')await validate();return input;},queue:async()=>{writes++;return {inserted:true};}}});
});

test('未知写入worker截止后仍只开放原目标SELECT读回，outer截止后拒绝',async t=>{
 const now=Date.now(),operations=[];
 t.mock.timers.enable({apis:['Date'],now});
 await using(async tools=>{
  await assert.rejects(()=>tools.business('discover',{video}),/UNKNOWN/);
  t.mock.timers.setTime(now+1100);
  await assert.rejects(()=>tools.business('discover_readback',{video:{...video,videoId:'2234567890123456'}}),/UNKNOWN/);
  const readback=await tools.business('discover_readback',{video});assert.equal(readback.metrics_verified,true);
  await assert.rejects(()=>tools.business('discover',{video}),/UNKNOWN/);
  assert.deepEqual(operations,['discover','discover_readback']);
  assert.deepEqual((await tools.inspect()).pending_write_readbacks,[{operation:'discover',readback_operations:['discover_readback']}]);
  t.mock.timers.setTime(now+10000);
  await assert.rejects(()=>tools.business('discover_readback',{video}),/DEADLINE/);
  assert.deepEqual(operations,['discover','discover_readback']);
 },{scope:{worker_deadline_ms:now+1000,deadline_ms:now+10000},primitives:{queue:async op=>{operations.push(op);if(op==='discover')throw Error('lost write acknowledgement');return {metrics_verified:true};}}});
});

for(const boundary of ['resources','input'])test(boundary+'异步校验自身失败仍传播原错误而非吞掉后放行',async t=>{
 const now=Date.now();let writes=0;
 t.mock.timers.enable({apis:['Date'],now});
 const failure=Error('NATIVE_ADMISSION_REJECTED'),reject=async()=>{await nextTurn();t.mock.timers.setTime(now+1100);throw failure;};
 await using(async tools=>{
  await assert.rejects(()=>tools.business('discover',{video}),error=>error===failure);assert.equal(writes,0);
 },{scope:{worker_deadline_ms:now+1000,deadline_ms:now+10000},primitives:{assertResources:boundary==='resources'?reject:async()=>true,validateInput:boundary==='input'?reject:async(_op,input)=>input,queue:async()=>{writes++;return {};}}});
});


test('intent真实落盘耗时跨worker截止不发队列，原未决记录保留',async t=>{
 const now=Date.now(),realFsync=fs.fsyncSync;let armed=false,writes=0,expiredDuringSync=false;
 t.mock.timers.enable({apis:['Date'],now});
 t.mock.method(fs,'fsyncSync',fd=>{realFsync(fd);if(armed){armed=false;expiredDuringSync=true;t.mock.timers.setTime(now+1100);}});
 syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 await using(async(tools,_calls,runDir)=>{
  await assert.rejects(()=>tools.business('discover',{video}),error=>error.message==='AGENT_TOOL_DEADLINE');
  assert.equal(expiredDuringSync,true);assert.equal(writes,0);
  assert.deepEqual((await tools.inspect()).pending_write_readbacks,[{operation:'discover',readback_operations:['discover_readback']}]);
  const names=readdirSync(join(runDir,'agent-tools','collect_videos'));assert.equal(names.filter(n=>n.endsWith('.intent.json')).length,1);assert.equal(names.some(n=>n.endsWith('.result.json')),false);
  await assert.rejects(()=>tools.business('discover',{video}),/UNKNOWN/);assert.equal(writes,0);
 },{scope:{worker_deadline_ms:now+1000,deadline_ms:now+10000},primitives:{validateInput:async(_op,input)=>{armed=true;return input;},queue:async()=>{writes++;return {};}}});
});
