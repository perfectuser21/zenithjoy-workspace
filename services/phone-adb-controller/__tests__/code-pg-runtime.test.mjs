import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,cpSync,readFileSync,writeFileSync,rmSync,existsSync,realpathSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {digest} from '../runtime-definition.mjs';
import {RPC_FILES} from '../leadgen-client.mjs';
import {rpcFailureReceipt} from '../leadgen-rpc.mjs';
import {installPreflightPg,preflightPgDeployment,prepareFrozenCodePg} from '../preflight-pg-dependencies.mjs';
const source=fileURLToPath(new URL('../',import.meta.url)),commit='a'.repeat(40);
test('隔离Code101/102/103从真实冻结ACK装载唯一固定PG；缺包、篡改及身份环境漂移拒绝',async()=>{
 assert.ok(existsSync(join(source,'code-pg-runtime.mjs')),'Code RPC必须接入固定PG消费者，不能继承checkout父node_modules');
 const top=realpathSync(mkdtempSync(join(tmpdir(),'code-pg-frozen-'))),candidate=join(top,'candidate');mkdirSync(candidate,{mode:0o700});
 try{
  cpSync(source,candidate,{recursive:true,filter:p=>!p.split('/').some(v=>['__tests__','node_modules','_dependencies'].includes(v))});
  await installPreflightPg({runtimeRoot:candidate,sourceCommit:commit});
  const dependency=preflightPgDeployment({runtimeRoot:candidate,sourceCommit:commit});
  for(const workflow of ['douyin_video_discovery','douyin_video_processing','douyin_comment_scoring']){
   const tag='fixture_'+workflow,run=workflow+'-'+tag,dir=join(top,run),runtime=join(dir,'runtime');mkdirSync(dir,{mode:0o700});cpSync(candidate,runtime,{recursive:true,filter:p=>!p.split('/').includes('_dependencies')});chmodSync(runtime,0o700);
   const identity={lock_sha256:dependency.lock_sha256,package_lock_sha256:dependency.package_lock_sha256};
   const deployment={source_commit:commit,observation_id:'55555555-5555-4555-8555-555555555555',target:'mmv',dependencies:{preflight_pg:dependency},environment:'staging:'+commit};
   writeFileSync(join(runtime,'deployment-manifest.json'),JSON.stringify(deployment));writeFileSync(join(candidate,'deployment-manifest.json'),JSON.stringify(deployment));
   const files=Object.fromEntries(['code-pg-runtime.mjs','leadgen-db-connect.js','deployment-manifest.json'].filter(f=>existsSync(join(runtime,f))).map(f=>['runtime/'+f,digest(readFileSync(join(runtime,f)))]));
   const body={deployment,release:{target:'mmv',id:'22222222-2222-4222-8222-222222222222'},workflow_version:{id:'33333333-3333-4333-8333-333333333333',payload_sha256:'b'.repeat(64),payload:{key:workflow,workflow_id:'44444444-4444-4444-4444-444444444444'}},code_pg:identity,run_identity:{capability:workflow,tag,run_id:run,profile:workflow==='douyin_comment_scoring'?'mmv-scoring':'cloud-phone-test',serial:workflow==='douyin_comment_scoring'?'none':'47.100.213.173:10001'},files};
   body.code_observer_scope={schema_version:1,consumed_task_payload:{},claim:{claimed_by:'fixture-owner',claimed_at:new Date().toISOString()},task_id:'11111111-1111-4111-8111-111111111111',workflow_key:workflow,run_tag:tag,profile:body.run_identity.profile,serial:body.run_identity.serial,line:'yuesheng',run_start_ts:Math.floor(Date.now()/1000),run_max_seconds:1800};
   const frozen={...body,snapshot_sha256:digest(body)};
   await prepareFrozenCodePg({sourceRuntimeRoot:candidate,runtimeRoot:runtime,frozen,expectedDeployment:dependency});
   const save=()=>writeFileSync(join(dir,'run-definition.json'),JSON.stringify(frozen));save();
   mkdirSync(join(dir,'run-bindings'),{mode:0o700});
   const request={run_id:run+'__a1',runtime_snapshot_sha256:frozen.snapshot_sha256,body:{actor:'runtime:phone-adb-controller',runtime_snapshot_sha256:frozen.snapshot_sha256,external_origin:'zenithjoy:mmv',source_kind:'external',attempt_key:'a1',release_id:body.release.id,observation_id:deployment.observation_id,workflow_id:body.workflow_version.payload.workflow_id,workflow_definition_version_id:body.workflow_version.id,snapshot_sha256:body.workflow_version.payload_sha256,expected_path:[{reference_id:'r',activity_id:'a',activity_definition_version_id:'v'}]}};
   const ack={binding:{id:'66666666-6666-4666-8666-666666666666',run_id:request.run_id,...request.body,task_run_id:null,payload:request.body,payload_sha256:digest(request.body)}};
   writeFileSync(join(dir,'run-bindings/a1.request.json'),JSON.stringify(request));writeFileSync(join(dir,'run-bindings/a1.ack.json'),JSON.stringify(ack));
   const env={WFR_RUN_DIR:dir,WFR_ATTEMPT:'a1',WF_HOME:runtime,WFR_HOSTKEY:'mmv',WF_BRAIN_WORKFLOW:workflow,WFR_TAG:tag,P:body.run_identity.profile,SERIAL:body.run_identity.serial,LEADGEN_LINE:'yuesheng',LEADGEN_EXECUTION_MODE:'code',WF_BRAIN_TASK_ID:body.code_observer_scope.task_id,WF_RUN_START_TS:String(body.code_observer_scope.run_start_ts),WF_RUN_MAX_SECONDS:'1800'};
   const input={source:{commit,files:RPC_FILES.map(path=>({path,sha256:digest(readFileSync(join(runtime,path)))})),execution:{run:tag,run_id:request.run_id,profile:env.P,line:'yuesheng'}}};
   const api=await import(pathToFileURL(join(runtime,'code-pg-runtime.mjs')));
   assert.throws(()=>createRequire(join(runtime,'leadgen-db-connect.js')).resolve('pg'),{code:'MODULE_NOT_FOUND'},'隔离冻结目录不能借checkout依赖冒通过');
   assert.equal(api.requiresCodeRpcPool({runtimeRoot:runtime}),true);
   const pg=api.loadCodeRpcPool({runtimeRoot:runtime,input,env});assert.equal(typeof pg.Pool,'function');
   assert.throws(()=>api.loadCodeRpcPool({runtimeRoot:runtime,input,env:{}}),/CODE_PG_/);
   if(workflow==='douyin_comment_scoring'){const aliasEnv={...env,BRAIN_TASK_ID:env.WF_BRAIN_TASK_ID};delete aliasEnv.WF_BRAIN_TASK_ID;assert.equal(typeof api.loadCodeRpcPool({runtimeRoot:runtime,input,env:aliasEnv}).Pool,'function','103仅真实Task别名仍消费同一冻结/ACK');}
   const pool=new pg.Pool({max:1});await pool.end();
   const rpc=await import(pathToFileURL(join(runtime,'leadgen-rpc.mjs')));
   const previous=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
   try{
    await assert.rejects(rpc.handleRpc({...input,kind:'offline_unknown_kind'}),/RPC_KIND_INVALID/);
    const originalQuery=pg.Pool.prototype.query,originalConnect=pg.Pool.prototype.connect;
    pg.Pool.prototype.query=async()=>{throw Error('OFFLINE_DB_BOUNDARY_REACHED');};pg.Pool.prototype.connect=async()=>{throw Error('OFFLINE_DB_BOUNDARY_REACHED');};
    try{
     await assert.rejects(rpc.handleRpc({...input,kind:'keywords',line:'yuesheng',run:tag}),/OFFLINE_DB_BOUNDARY_REACHED/);
     await assert.rejects(rpc.handleRpc({...input,kind:'queue',request:{op:'history',line:'yuesheng',run:tag}}),/OFFLINE_DB_BOUNDARY_REACHED/);
     const probes=await rpc.handleRpc({...input,kind:'verify',workflow,stage:'offline_unknown_stage',line:'yuesheng',run:tag,metrics:{}});
     assert.equal(probes.ok,true,'正式checks/JSON schema/steps模块可在空父级解析');
    }finally{pg.Pool.prototype.query=originalQuery;pg.Pool.prototype.connect=originalConnect;}
   }finally{for(const[k,v]of Object.entries(previous))if(v===undefined)delete process.env[k];else process.env[k]=v;}
   for(const change of [{NODE_PATH:'/poison'},{NODE_OPTIONS:'--require=/poison'},{NODE_PG_FORCE_NATIVE:'1'},{WF_BRAIN_TASK_ID:'foreign'},{BRAIN_TASK_ID:'22222222-2222-4222-8222-222222222222'},{WFR_TAG:'foreign'},{P:'foreign'},{LEADGEN_LINE:'foreign'},{WF_BRAIN_WORKFLOW:'douyin_lead_outreach'}])assert.throws(()=>api.loadCodeRpcPool({runtimeRoot:runtime,input,env:{...env,...change}}),/CODE_PG_|PREFLIGHT_PG_/);
   assert.throws(()=>api.loadCodeRpcPool({runtimeRoot:runtime,input:{source:{...input.source,commit:'b'.repeat(40)}},env}),/CODE_PG_/);
   const ackFile=join(dir,'run-bindings/a1.ack.json'),ackBytes=readFileSync(ackFile);ack.binding.run_id='foreign';writeFileSync(ackFile,JSON.stringify(ack));assert.throws(()=>api.loadCodeRpcPool({runtimeRoot:runtime,input,env}),/CODE_PG_/);writeFileSync(ackFile,ackBytes);
   const originalDefinition=readFileSync(join(dir,'run-definition.json'));
   const agentBody={...body,execution_mode:'agent'};agentBody.workflow_version={payload:{key:workflow}};writeFileSync(join(dir,'run-definition.json'),JSON.stringify({...agentBody,snapshot_sha256:digest(agentBody)}));
   assert.equal(api.requiresCodeRpcPool({runtimeRoot:runtime}),false,'真实冻结agent模式不误走Code loader');writeFileSync(join(dir,'run-definition.json'),originalDefinition);
   const peer=await import(pathToFileURL(join(candidate,'code-pg-runtime.mjs')));assert.equal(peer.requiresCodeRpcPool({runtimeRoot:candidate}),false,'独立远端peer无本地run，沿原路径');
   for(const task of ['foreign']){const changed=structuredClone(ack);changed.binding.task_id=task;writeFileSync(ackFile,JSON.stringify(changed));assert.throws(()=>api.loadCodeRpcPool({runtimeRoot:runtime,input,env}),/CODE_PG_/);}writeFileSync(ackFile,ackBytes);
   for(const change of [{task_run_id:'foreign'},{source_kind:'internal'},{payload_sha256:'0'.repeat(64)},{runtime_snapshot_sha256:'0'.repeat(64)}]){writeFileSync(ackFile,JSON.stringify({binding:{...ack.binding,...change}}));assert.throws(()=>api.loadCodeRpcPool({runtimeRoot:runtime,input,env}),/CODE_PG_/);}writeFileSync(ackFile,ackBytes);
   for(const change of [{claim:null},{run_start_ts:1,run_max_seconds:1}]){const invalid=structuredClone(body);Object.assign(invalid.code_observer_scope,change);writeFileSync(join(dir,'run-definition.json'),JSON.stringify({...invalid,snapshot_sha256:digest(invalid)}));assert.throws(()=>api.loadCodeRpcPool({runtimeRoot:runtime,input,env}),/CODE_PG_/);}writeFileSync(join(dir,'run-definition.json'),originalDefinition);
   const changedScope=structuredClone(body);changedScope.code_observer_scope.task_id='77777777-7777-4777-8777-777777777777';writeFileSync(join(dir,'run-definition.json'),JSON.stringify({...changedScope,snapshot_sha256:digest(changedScope)}));assert.throws(()=>api.loadCodeRpcPool({runtimeRoot:runtime,input,env:{...env,WF_BRAIN_TASK_ID:changedScope.code_observer_scope.task_id}}),/CODE_PG_/);writeFileSync(join(dir,'run-definition.json'),originalDefinition);
   const file=join(runtime,'_dependencies/preflight-pg/node_modules/pg/lib/index.js'),bytes=readFileSync(file);writeFileSync(file,'throw Error("TAMPER_MUST_NOT_EXECUTE")');assert.throws(()=>api.loadCodeRpcPool({runtimeRoot:runtime,input,env}),/PREFLIGHT_PG_/);rmSync(file);assert.throws(()=>api.loadCodeRpcPool({runtimeRoot:runtime,input,env}),/PREFLIGHT_PG_/);writeFileSync(file,bytes,{mode:0o600});
   const manifest=join(runtime,'_dependencies/preflight-pg/manifest.json'),original=readFileSync(manifest);writeFileSync(manifest,'{}');assert.throws(()=>api.loadCodeRpcPool({runtimeRoot:runtime,input,env}),/PREFLIGHT_PG_/);writeFileSync(manifest,original);
   frozen.code_pg={...identity,lock_sha256:'f'.repeat(64)};frozen.snapshot_sha256=digest(Object.fromEntries(Object.entries(frozen).filter(([k])=>k!=='snapshot_sha256')));save();assert.throws(()=>api.loadCodeRpcPool({runtimeRoot:runtime,input,env}),/CODE_PG_|PREFLIGHT_PG_/);
  }
 }finally{rmSync(top,{recursive:true,force:true});}
});

test('Code PG固定失败码可诊断，任意路径SQL和未知后缀不得跨RPC边界',()=>{
 for(const [code,error]of [['CODE_PG_SCOPE_INVALID','RPC_CODE_PG_SCOPE_INVALID'],['CODE_PG_ENVIRONMENT_ROUTE','RPC_CODE_PG_ENVIRONMENT_ROUTE'],['PREFLIGHT_PG_FILE_DIGEST','RPC_CODE_PG_DEPENDENCY_UNVERIFIED'],['PREFLIGHT_PG_FILE_MISSING','RPC_CODE_PG_DEPENDENCY_UNVERIFIED']])assert.deepEqual(rpcFailureReceipt(Error(code)),{ok:false,error});
 for(const code of ['PREFLIGHT_PG_FAKE_TOKEN_SECRET','CODE_PG_SCOPE_INVALID /secret/path token=hidden','SELECT password FROM credentials','MODULE_NOT_FOUND'])assert.deepEqual(rpcFailureReceipt(Error(code)),{ok:false,error:'RPC_OPERATION_FAILED'});
});

test('Code prepare前预算CLI由实际模块路径装载，不使用stdin伪脚本或重设已有起点',()=>{
 const env={...process.env,LEADGEN_EXECUTION_MODE:'code',WF_RUN_MAX_SECONDS:'1800'};delete env.WFR_RUN_DIR;delete env.WF_RUN_START_TS;delete env.LEADGEN_EXECUTION_TRANSPORT;delete env.LEADGEN_MAX_TURNS;
 const script=`import {pathToFileURL} from 'node:url';const {initializeCodeBudget}=await import(pathToFileURL(process.argv[1]+'/code-observer-authority.mjs'));console.log(JSON.stringify(initializeCodeBudget({env:process.env})));`;
 const run=spawnSync(process.execPath,['--input-type=module','--eval',script,source],{env,encoding:'utf8',timeout:10000});assert.equal(run.status,0,run.stderr);const value=JSON.parse(run.stdout);assert.equal(value.run_max_seconds,1800);assert.ok(Math.abs(value.run_start_ts-Math.floor(Date.now()/1000))<5);
});

test('真实MMV Code103 wrapper在prepare前统一Task别名，冲突或缺失提前拒绝',()=>{
 const top=realpathSync(mkdtempSync(join(tmpdir(),'code103-task-alias-'))),runtime=join(top,'runtime'),home=join(top,'home'),task='11111111-1111-4111-8111-111111111111';
 try{
  cpSync(source,runtime,{recursive:true,filter:p=>!p.split('/').some(v=>['__tests__','node_modules','_dependencies'].includes(v))});
  mkdirSync(join(home,'.local/bin'),{recursive:true});writeFileSync(join(home,'.local/bin/hostname'),'#!/bin/sh\nprintf "r10-7\\n"\n',{mode:0o700});
  writeFileSync(join(runtime,'runtime-receipts.mjs'),`console.log('OFFLINE_PREPARE_CAPTURE='+JSON.stringify({command:process.argv[2],task:process.env.WF_BRAIN_TASK_ID,alias:process.env.BRAIN_TASK_ID}));process.exit(42);`);
  writeFileSync(join(runtime,'plans/douyin_comment_scoring.plan'),'WF_RUNNER=leadgen-workflow.mjs\nWF_BRAIN_WORKFLOW=douyin_comment_scoring\nWF_CONTRACT_RAW_SHA256=fixture\nWF_ACTIVITY_REFS="[]"\nWF_STEP_SPEC=fixture\n');
  const env={...process.env,HOME:home,WFR_HOME:join(top,'ledger'),LEADGEN_EXECUTION_MODE:'code',WF_RUN_MAX_SECONDS:'1800'};
  for(const key of ['WF_BRAIN_TASK_ID','BRAIN_TASK_ID','WFR_BRAIN_TASK_ID','WFR_RUN_DIR','WF_RUN_START_TS','LEADGEN_EXECUTION_TRANSPORT','LEADGEN_MAX_TURNS'])delete env[key];
  const launch=changes=>spawnSync('/bin/zsh',[join(runtime,'leadgen-run.sh'),'douyin_comment_scoring','mmv-scoring','none','yuesheng','alias_fixture'],{env:{...env,...changes},encoding:'utf8',timeout:10000});
  const valid=launch({BRAIN_TASK_ID:task});assert.equal(valid.status,42,valid.stderr);const capture=JSON.parse(valid.stdout.split('OFFLINE_PREPARE_CAPTURE=')[1].split('\n')[0]);assert.equal(capture.command,'prepare');assert.equal(capture.task,task,'真实CLI必须先统一WF任务身份再进入prepare');
  for(const changes of [{},{WF_BRAIN_TASK_ID:task,BRAIN_TASK_ID:'22222222-2222-4222-8222-222222222222'}]){const denied=launch(changes);assert.notEqual(denied.status,42);assert.doesNotMatch(denied.stdout,/OFFLINE_PREPARE_CAPTURE=/,'缺失或冲突Task不得抵达prepare');}
 }finally{rmSync(top,{recursive:true,force:true});}
});
