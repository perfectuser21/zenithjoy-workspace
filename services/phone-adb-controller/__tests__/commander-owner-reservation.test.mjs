import {gatewayFixture} from './fixtures/commander-gateway-response.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,mkdirSync,symlinkSync,existsSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const modulePath=fileURLToPath(new URL('../activity-commander.mjs',import.meta.url));
const transportPath=fileURLToPath(new URL('../leadgen-skill-agent.mjs',import.meta.url));
const scope={run_id:'persistent-owner__a1',binding_id:'binding-one',source_commit:'a'.repeat(40)};
function child(home,mode){
 const script=`import {appendFileSync} from 'node:fs';
 import {openClawCommander} from ${JSON.stringify(modulePath)};
 import {runSkillAgent} from ${JSON.stringify(transportPath)};
 const home=process.argv[1],mode=process.argv[2],scope=${JSON.stringify(scope)};
 const execute=async()=>{appendFileSync(home+'/launches','launch\\n');const e=Error('transport timeout');e.code='ETIMEDOUT';throw e;};
 try{if(mode==='consult')await openClawCommander({home,execute})({...scope,activity:'scoring',phase:'before'});
 else await runSkillAgent({...scope,protocol:'leadgen-activity-v1',activity_key:'scoring',nonce:'b'.repeat(48),deadline_ms:Date.now()+20000,broker_host:'mmv',broker_request_path:'/private/tmp/fixture/request.json',broker_tool_path:'/private/tmp/fixture/tool.mjs',mode:'repair',method:{name:'fixture',version:'0.1.0',text:'fixture'}},{home,verifyWorkspace:()=>true,execute});
 }catch(error){process.stdout.write(error.message);}`;
 return execFileSync(process.execPath,['--input-type=module','-e',script,home,mode],{encoding:'utf8'});
}

test('真实子进程重启不清未知owner，咨询与Skill接手均零新增CLI',()=>{
 const home=mkdtempSync(join(tmpdir(),'owner-restart-'));
 try{
  child(home,'consult');
  assert.match(child(home,'consult'),/COMMANDER_OWNER_TURN_UNRESOLVED/);
  assert.match(child(home,'handoff'),/COMMANDER_OWNER_TURN_UNRESOLVED/);
  assert.equal(readFileSync(join(home,'launches'),'utf8').trim().split('\n').length,1);
 }finally{rmSync(home,{recursive:true,force:true});}
});

test('Skill父调用未知后新进程不能继续咨询同一owner',()=>{
 const home=mkdtempSync(join(tmpdir(),'owner-handoff-restart-'));
 try{
  child(home,'handoff');
  assert.match(child(home,'consult'),/COMMANDER_OWNER_TURN_UNRESOLVED/);
  assert.equal(readFileSync(join(home,'launches'),'utf8').trim().split('\n').length,1);
 }finally{rmSync(home,{recursive:true,force:true});}
});

function isolated(t){const home=mkdtempSync(join(tmpdir(),'owner-boundaries-'));t.after(()=>rmSync(home,{recursive:true,force:true}));return home;}
async function reservationApi(){return import('../activity-commander.mjs');}
function pending(home,session){return join(home,'.openclaw/leadgen-owner-turns',session.split(':').at(-1)+'.pending.json');}

test('真实并发进程共享reservation时只允许一个未回执的CLI',{timeout:10000},async t=>{
 const home=isolated(t);
 const script=`import {appendFileSync} from 'node:fs';import {openClawCommander} from ${JSON.stringify(modulePath)};
 const gatewayFixture=(body,args)=>{body.runId=JSON.parse(args[args.indexOf('--params')+1]).idempotencyKey;body.summary='completed';return JSON.stringify(body);};
 const home=process.argv[1];
 try{await openClawCommander({home,execute:async(_cmd,args)=>{appendFileSync(home+'/launches','launch\\n');process.send('entered');await new Promise(r=>process.once('message',r));return {stdout:gatewayFixture({status:'ok',payloads:[{text:'{\"action\":\"continue\",\"reason\":\"原run\"}'}]},args)};}})(${JSON.stringify(scope)});process.send('returned');}
 catch(error){process.stdout.write(error.message);}finally{process.disconnect();}`;
 const first=spawn(process.execPath,['--input-type=module','-e',script,home,'first'],{stdio:['ignore','pipe','pipe','ipc']});
 t.after(()=>{if(first.exitCode===null)first.kill();});
 await once(first,'message');
 assert.match(child(home,'consult'),/COMMANDER_OWNER_TURN_UNRESOLVED/);
 assert.equal(readFileSync(join(home,'launches'),'utf8').trim().split('\n').length,1);
 const ended=once(first,'exit');first.send('release');assert.equal((await ended)[0],0);
 const {openClawCommander}=await reservationApi();let launched=0;
 await openClawCommander({home,execute:async(_cmd,args)=>{launched++;return {stdout:gatewayFixture({status:'ok',payloads:[{text:'{\"action\":\"continue\",\"reason\":\"后续节点\"}'}]},args)};}})(scope);
 assert.equal(launched,1,'已读回当前owner才能开始下一turn');
});

test('坏文件、目录与symlink pending均deny-only且不删除原件',async t=>{
 const {reserveWorkflowCommanderTurn,assertWorkflowOwnerAvailable,workflowCommanderSession}=await reservationApi();
 for(const kind of ['malformed','empty','directory','symlink']){
  const home=isolated(t);assertWorkflowOwnerAvailable(scope,{home});const file=pending(home,workflowCommanderSession(scope));
  if(kind==='directory')mkdirSync(file);else if(kind==='symlink'){const target=join(home,'authority');writeFileSync(target,'do not change');symlinkSync(target,file);}else writeFileSync(file,kind==='empty'?'':'{broken');
  await assert.rejects(reserveWorkflowCommanderTurn(scope,{home}),/COMMANDER_OWNER_TURN_UNRESOLVED/);
  assert.throws(()=>assertWorkflowOwnerAvailable(scope,{home}),/COMMANDER_OWNER_TURN_UNRESOLVED/);assert.equal(existsSync(file),true);
 }
});

test('过期或旧nonce pending不能按TTL清除，返回错nonce也不释放',async t=>{
 const {reserveWorkflowCommanderTurn,assertWorkflowOwnerAvailable,workflowCommanderSession}=await reservationApi();const home=isolated(t),turn=await reserveWorkflowCommanderTurn(scope,{home});
 const file=pending(home,workflowCommanderSession(scope)),original=JSON.parse(readFileSync(file));
 const changed={...original,started_at:'1970-01-01T00:00:00.000Z',transport_nonce:'old-nonce'};writeFileSync(file,JSON.stringify(changed));
 await assert.rejects(turn.returned('official response'),/COMMANDER_OWNER_TURN_UNRESOLVED/);await turn.close();
 assert.throws(()=>assertWorkflowOwnerAvailable(scope,{home}),/COMMANDER_OWNER_TURN_UNRESOLVED/);
 assert.deepEqual(JSON.parse(readFileSync(file)),changed);
});

test('旧已返回turn不能清掉同owner新reservation，已返回旁证不能解锁pending',async t=>{
 const {reserveWorkflowCommanderTurn,assertWorkflowOwnerAvailable,workflowCommanderSession}=await reservationApi();const home=isolated(t);
 const first=await reserveWorkflowCommanderTurn(scope,{home});await first.returned('first official');await first.close();
 const next=await reserveWorkflowCommanderTurn(scope,{home}),file=pending(home,workflowCommanderSession(scope)),bytes=readFileSync(file);
 assert.equal(readdirSync(join(home,'.openclaw/leadgen-owner-turns')).filter(x=>x.endsWith('.returned.json')).length,1);
 assert.throws(()=>assertWorkflowOwnerAvailable(scope,{home}),/COMMANDER_OWNER_TURN_UNRESOLVED/);
 await assert.rejects(first.returned('late old response'),/COMMANDER_OWNER_TURN_UNRESOLVED/);assert.deepEqual(readFileSync(file),bytes);
 await next.returned('next official');await next.close();assert.doesNotThrow(()=>assertWorkflowOwnerAvailable(scope,{home}));
});

function nativeFailureProcess(home,mode){
 const script=`import {readFileSync,writeFileSync,existsSync,readdirSync} from 'node:fs';import {join} from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
 import {openClawCommander,runWorkflow,assertWorkflowOwnerAvailable} from ${JSON.stringify(modulePath)};
 import {runSkillAgent} from ${JSON.stringify(transportPath)};
 const home=process.argv[1],mode=process.argv[2],scope=${JSON.stringify(scope)};let cleaned=0,quarantined=0,result,error;
 if(mode==='consult-not-started'){
  result=await runWorkflow({context:scope,activities:[{key:'scoring'},{key:'cleanup'}],handlers:{scoring:async()=>{throw Error('must not execute');},cleanup:async()=>{cleaned++;return {};}},commander:openClawCommander({home}),record:async()=>{},quarantine:async()=>{quarantined++;return {verified:true};}});
 }else if(mode==='handoff-not-started'||mode==='forged-start-failure'){
  result=await runSkillAgent({...scope,protocol:'leadgen-activity-v1',activity_key:'scoring',nonce:'c'.repeat(48),deadline_ms:Date.now()+20000,broker_host:'mmv',broker_request_path:'/private/tmp/fixture/request.json',broker_tool_path:'/private/tmp/fixture/tool.mjs',mode:'repair',method:{name:'fixture',version:'0.1.0',text:'fixture'}},{home,verifyWorkspace:()=>true,...(mode==='forged-start-failure'?{execute:async(_cmd,args)=>{throw Error('EXECUTION_START_FAILED');}}:{})});
 }else{
  const execute=async()=>{await promisify(execFile)(process.execPath,['-e','require("fs").writeFileSync('+JSON.stringify(join(home,'actually-started'))+',"started")']);readFileSync(join(home,'missing-after-process'));};
  try{await openClawCommander({home,execute})(scope);}catch(e){error={execution_stopped:e.executionStopped};}
 }
 let available=true;try{assertWorkflowOwnerAvailable(scope,{home});}catch{available=false;}
 const directory=join(home,'.openclaw/leadgen-owner-turns'),files=readdirSync(directory);
 process.stdout.write(JSON.stringify({result,error,cleaned,quarantined,available,actually_started:existsSync(join(home,'actually-started')),not_started:files.filter(x=>x.endsWith('.not_started.json')).map(x=>JSON.parse(readFileSync(join(directory,x),'utf8'))),pending:files.filter(x=>x.endsWith('.pending.json'))}));`;
 return JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script,home,mode],{encoding:'utf8',env:{...process.env,PATH:home},timeout:10000}));
}

test('真实原生pre-spawn失败后可沿原cleanup退路清场，但整体仍failed',t=>{
 const r=nativeFailureProcess(isolated(t),'consult-not-started');
 assert.equal(r.result.status,'failed');assert.equal(r.cleaned,1);assert.equal(r.quarantined,0);assert.equal(r.available,true);assert.equal(r.pending.length,0);
 assert.equal(r.not_started.length,3,'业务前与cleanup前后均是真实未spawn失败，不伪returned成功');
 for(const record of r.not_started)assert.equal(record.status,'not_started');
});

test('Skill父真实未spawn可让原owner清理，已保留的launch预留不改写',t=>{
 const home=isolated(t),r=nativeFailureProcess(home,'handoff-not-started');
 assert.equal(r.result.status,'blocked');assert.equal(r.result.execution_stopped,true);assert.equal(r.available,true);assert.equal(r.not_started.length,1);assert.equal(r.pending.length,0);
 const runs=join(home,'.openclaw/leadgen-activity-runs');const dir=join(runs,readdirSync(runs)[0]);assert.equal(existsSync(join(dir,'launch-reserved.json')),true);assert.equal(existsSync(join(dir,'agent-request.json')),true);assert.equal(existsSync(join(dir,'spawn-receipt.json')),false);
});

test('已真实执行后的FS ENOENT与伪未启动错误都不能解锁owner',t=>{
 const fs=nativeFailureProcess(isolated(t),'post-start-filesystem');assert.equal(fs.actually_started,true);assert.equal(fs.error.execution_stopped,false);assert.equal(fs.available,false);assert.equal(fs.not_started.length,0);assert.equal(fs.pending.length,1);
 const forged=nativeFailureProcess(isolated(t),'forged-start-failure');assert.equal(forged.result.status,'unknown');assert.equal(forged.result.execution_stopped,false);assert.equal(forged.available,false);assert.equal(forged.not_started.length,0);assert.equal(forged.pending.length,1);
});
