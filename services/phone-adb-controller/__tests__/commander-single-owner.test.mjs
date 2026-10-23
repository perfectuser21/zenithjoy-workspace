import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openClawCommander} from '../activity-commander.mjs';
import {runSkillAgent} from '../leadgen-skill-agent.mjs';
import {handleRpc} from '../leadgen-rpc.mjs';
import {runWorkflow} from '../leadgen-workflow.mjs';

test('同Workflow各节点判断与Skill接手使用同一个work-commander负责人',async()=>{
 const calls=[],home=mkdtempSync(join(tmpdir(),'single-commander-'));
 const scope={run_id:'same-workflow__a1',source_commit:'a'.repeat(40),binding_id:'binding-one'};
 const commander=openClawCommander({home,execute:async(command,args)=>{
  calls.push(args);return {stdout:JSON.stringify({status:'ok',payloads:[{text:JSON.stringify({action:'continue',reason:'监督原Workflow'})}]})};
 }});
 try{
  await commander({...scope,activity:'preflight',phase:'before'});
  await commander({...scope,activity:'qualification',phase:'after'});
  await runSkillAgent({...scope,protocol:'leadgen-activity-v1',activity_key:'qualification',nonce:'b'.repeat(48),deadline_ms:Date.now()+20000,
   broker_host:'mmv',broker_request_path:'/private/tmp/fixture/request.json',broker_tool_path:'/private/tmp/fixture/tool.mjs',mode:'repair',method:{name:'fixture',version:'0.1.0',text:'isolated fixture'}},
   {home,verifyWorkspace:()=>true,execute:async(_command,args)=>{calls.push(args);return {code:1,stdout:'',stderr:'isolated transport has no child'};}});
  assert.equal(calls.length,3);
  for(const args of calls){assert.equal(args[args.indexOf('--agent')+1],'work-commander');assert.ok(args.includes('--session-key'));}
  const owners=calls.map(args=>args[args.indexOf('--session-key')+1]);
  assert.equal(new Set(owners).size,1,'Activity与Skill不能另建负责人');
  const other=[];await openClawCommander({home,execute:async(_cmd,args)=>{other.push(args);return {stdout:JSON.stringify({status:'ok',payloads:[{text:'{"action":"continue","reason":"另任务"}'}]})};}})({...scope,run_id:'another-workflow__a1',activity:'preflight'});
  assert.notEqual(other[0][other[0].indexOf('--session-key')+1],owners[0]);
  await openClawCommander({home,execute:async(_cmd,args)=>{other.push(args);return {stdout:JSON.stringify({status:'ok',payloads:[{text:'{"action":"continue","reason":"另一绑定"}'}]})};}})({...scope,binding_id:'binding-two',activity:'preflight'});
  assert.notEqual(other[1][other[1].indexOf('--session-key')+1],owners[0],'同名run不同冻结绑定不能共享上下文');
 }finally{rmSync(home,{recursive:true,force:true});}
});

test('负责人CLI超时结果未知时不再次咨询、不派Skill、不清理原资源',async()=>{
 const home=mkdtempSync(join(tmpdir(),'owner-timeout-'));
 let consulted=0,cleaned=0,recovered=0,quarantined=0;
 const commander=openClawCommander({home,execute:async()=>{consulted++;const error=Error('timeout');error.code='ETIMEDOUT';throw error;}});
 try{const result=await runWorkflow({context:{run_id:'owner-timeout__a1',binding_id:'timeout-binding',source_commit:'a'.repeat(40)},activities:[{key:'qualification'},{key:'cleanup'}],
  handlers:{qualification:async()=>({}),cleanup:async()=>{cleaned++;return {};}},commander,record:async()=>{},
  recover:async()=>{recovered++;return {status:'completed',execution_stopped:true};},quarantine:async()=>{quarantined++;return {verified:true};}});
 assert.equal(consulted,1);assert.equal(cleaned,0);assert.equal(recovered,0);assert.equal(quarantined,1);assert.equal(result.status,'failed');
 }finally{rmSync(home,{recursive:true,force:true});}
});

test('清理前负责人终态未知也不能把强制cleanup当作释放证明',async()=>{
 let cleaned=0,quarantined=0;
 const result=await runWorkflow({context:{run_id:'cleanup-owner'},activities:[{key:'qualification'},{key:'cleanup'}],
  handlers:{qualification:async()=>({}),cleanup:async()=>{cleaned++;return {};}},
  commander:async receipt=>{if(receipt.activity==='cleanup'){const error=Error('COMMANDER_OWNER_TURN_UNRESOLVED');error.executionStopped=false;throw error;}return {action:'continue',reason:'原任务'};},
  record:async()=>{},quarantine:async()=>{quarantined++;return {verified:true};}});
 assert.equal(cleaned,0);assert.equal(quarantined,1);assert.equal(result.status,'failed');
});

test('正式获客RPC调用同一work-commander且来源不匹配时零派发',async()=>{
 const calls=[];const receipt={run_id:'rpc-workflow__a1',binding_id:'rpc-binding',source_commit:'a'.repeat(40),activity:'preflight',phase:'before'};
 const home=mkdtempSync(join(tmpdir(),'owner-workspace-'));
 for(const directory of ['.openclaw/commander','openclaw-root/workspaces-root/clawd-work-commander'])for(const file of ['AGENTS.md','skills/workflow-commander/SKILL.md']){
  const target=join(home,directory,file);mkdirSync(join(target,'..'),{recursive:true});writeFileSync(target,readFileSync(new URL('../commander/'+file,import.meta.url)));
 }
 const deps={verify:()=>{},commanderHome:home,commanderExecute:async(_cmd,args)=>{calls.push(args);return {stdout:JSON.stringify({status:'ok',payloads:[{text:'{"action":"continue","reason":"原任务"}'}]})};}};
 try{
 const ok=await handleRpc({source:{commit:receipt.source_commit},kind:'commander',receipt},deps);
 assert.equal(ok.decision.action,'continue');assert.equal(calls.length,1);
 await assert.rejects(()=>handleRpc({source:{commit:'b'.repeat(40)},kind:'commander',receipt},deps),/COMMANDER_SOURCE_MISMATCH/);
 assert.equal(calls.length,1);
 writeFileSync(join(home,'.openclaw/commander/AGENTS.md'),'drift');
 await assert.rejects(()=>handleRpc({source:{commit:receipt.source_commit},kind:'commander',receipt},deps),/COMMANDER_WORKSPACE_DRIFT/);
 assert.equal(calls.length,1);
 }finally{rmSync(home,{recursive:true,force:true});}
});


test('真实Workflow main在原stop文件存在时保留partial，不进入业务handler',async t=>{
 const {spawnSync}=await import('node:child_process');
 const home=mkdtempSync(join(tmpdir(),'commander-main-stop-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
 const root=join(home,'runtime');mkdirSync(root);writeFileSync(join(home,'stop'),'stop');
 const script=`import vm from 'node:vm';import * as fs from 'node:fs';import * as path from 'node:path';import * as url from 'node:url';import assert from 'node:assert/strict';
 const directory=process.argv[1],root=path.join(directory,'runtime');
 const filename=path.join(root,'leadgen-workflow.mjs'),env={WFR_RUN_DIR:directory,WFR_RUN_ID:'original-run',WFR_ATTEMPT:'a1',WF_HOME:root,WF_BRAIN_WORKFLOW:'fixture',WF_RUN_START_TS:String(Math.floor(Date.now()/1000)),WF_RUN_MAX_SECONDS:'120',WF_STOP_FILE:path.join(directory,'stop')};
 let ended;const done=new Promise(r=>ended=r);
 const fakeProcess={env,argv:[process.execPath,filename],execPath:process.execPath,stdout:{write:()=>ended()},stderr:{write:()=>ended()}};
 const context=vm.createContext({process:fakeProcess,console,Buffer,setTimeout,clearTimeout,Date});
 const frozen={deployment:{source_commit:'a'.repeat(40)},activities:[{reference:{slot_key:'work'},version:{payload:{contract:{key:'work',budget:{max_duration_s:60}}}}}]};
 const modules={
  'node:fs':fs,'node:path':path,'node:url':url,
  './activity-commander.mjs':{runWorkflow:async options=>{let result;try{result=await options.handlers.work();}catch(error){fs.writeFileSync(path.join(directory,'actual-error.json'),JSON.stringify({name:error.name,message:error.message}));throw error;}assert.equal(result.status,'partial');return {status:'partial',results:[]};}},
  './leadgen-handlers.mjs':{parseCollection:()=>{},createHandlers:()=>({state:{},work:async()=>{throw Error('business after stop');}})},
  './collection-phone-scope.mjs':{collectionEvidenceProof:()=>null},
  './discovery-phone-scope.mjs':{discoveryCleanupEvidence:()=>null},
  './activity-skill-recovery.mjs':{createActivityRecovery:()=>()=>{throw Error('recovery after stop');}},
  './runtime-definition.mjs':{readFrozen:()=>frozen,assertCommentSampling:()=>{}},
  './runtime-binding.mjs':{readBinding:()=>({run_id:'original-run__a1',id:'fixed-binding'})},
  './leadgen-client.mjs':{createRpc:()=>async()=>({}),execInput:async()=>({code:0,stdout:'WFR_EVIDENCE_STATUS=sent'})},
  './leadgen-discovery.mjs':{verifyDiscoveryFilterEvidence:()=>{throw Error('unexpected filter verifier after stop');}},
  './discovery-metrics.js':{default:{verifyArchivedObservations:()=>{throw Error('unexpected metrics verifier after stop');}}},
  './line-routes.js':{default:{routeOf:()=>{throw Error('unexpected line routing after stop');}}},
  './discovery-cleanup-readback.mjs':{verifyCleanupReadback:()=>{throw Error('unexpected cleanup verifier after stop');}},
  './commander-model-receipt.mjs':{summarizeCommanderEvidence:()=>{throw Error('unexpected model verifier after stop');}},
  './step-judge.mjs':{judgeSteps:()=>{throw Error('unexpected verifier');}}
 };
 const source=fs.readFileSync(process.argv[2],'utf8');
 const module=new vm.SourceTextModule(source,{context,identifier:url.pathToFileURL(filename).href,initializeImportMeta:meta=>meta.url=url.pathToFileURL(filename).href});
 const cached=new Map();await module.link(name=>{assert.ok(modules[name],'unreviewed module import '+name);if(!cached.has(name)){const values=modules[name];cached.set(name,new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v]of Object.entries(values))this.setExport(k,v);},{context}));}return cached.get(name);});
 await module.evaluate();await Promise.race([done,new Promise((_,reject)=>setTimeout(()=>reject(Error('main did not terminate')),2000))]);
 assert.ok(fs.existsSync(path.join(directory,'split-result.json')),'real main failed: '+(fs.existsSync(path.join(directory,'actual-error.json'))?fs.readFileSync(path.join(directory,'actual-error.json'),'utf8'):'before handler'));
 assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'split-result.json'))).status,'partial');
 `;
 const result=spawnSync(process.execPath,['--experimental-vm-modules','--input-type=module','-e',script,home,new URL('../leadgen-workflow.mjs',import.meta.url).pathname],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr+result.stdout);
});
