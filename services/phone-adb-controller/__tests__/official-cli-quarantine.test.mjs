import test from 'node:test';
import {preflightTestPython} from './helpers/preflight-test-python.mjs';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {createOfficialCliClosure} from '../official-cli-closure.mjs';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,lstatSync,realpathSync,rmSync,renameSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,''),hash=b=>createHash('sha256').update(b).digest('hex');
function rig(t,{owner='run'}={}){
 const directory=realpathSync(mkdtempSync(join(tmpdir(),'cli-quarantine-')));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const lockRoot=join(directory,'.local/share/zenithjoy/phone-locks'),lock=join(lockRoot,'serial.lock');mkdirSync(lock,{recursive:true,mode:0o700});writeFileSync(join(lockRoot,'serial.guard'),'',{mode:0o600});writeFileSync(join(lock,'owner'),owner+'\n',{mode:0o600});
 const executables={zsh:{path:'/bin/zsh'},python:{path:realpathSync(preflightTestPython)},node:{path:realpathSync(process.execPath)}};for(const p of Object.values(executables))p.sha256=hash(readFileSync(p.path));
 const files={};for(const name of readdirSync(root))if(lstatSync(join(root,name)).isFile())files['runtime/'+name]=hash(readFileSync(join(root,name)));
 const taskId='11111111-1111-4111-8111-111111111111',binding={run_id:'run__a1',id:'22222222-2222-4222-8222-222222222222'},env={HOME:directory,WFR_RUN_DIR:directory,P:'fixture',SERIAL:'serial',WFR_TAG:'run',WFR_ATTEMPT:'a1'},frozen={snapshot_sha256:'a'.repeat(64),deployment:{source_commit:'b'.repeat(40)},files,agent_input:{task_id:taskId,profile:'fixture',serial:'serial',run_tag:'run',workflow_key:'douyin_video_processing'},collection_phone_scope:{run_id:binding.run_id,profile:'fixture',serial:'serial',policy:{schema_version:2},executables}},scope={activity:'collection',task_id:taskId,run_id:binding.run_id,binding_id:binding.id,snapshot_sha256:frozen.snapshot_sha256,source_commit:frozen.deployment.source_commit,profile:'fixture',serial:'serial',run:'run',workflow:'douyin_video_processing',worker_deadline_ms:Date.now()+20000,receipt_deadline_ms:Date.now()+25000,deadline_ms:Date.now()+30000};let revoked=false,admissions=0;
 const facade=createOfficialCliClosure({root,env,frozen,binding,taskId,scope,assertAdmission:async()=>{admissions++;if(revoked)throw Object.assign(Error('TASK_REVOKED'),{resourceUnknown:true});return {authorized:true};}});
 const receipt={runDir:directory,operationId:'original',runId:binding.run_id,taskId,profile:'fixture',serial:'serial',sourceCommit:frozen.deployment.source_commit,owner:'run',activity:'collection'};
 return {facade,lock,lockRoot,scope,receipt,directory,admissions:()=>admissions,revoke(){revoked=true;}};
}
const darwin={skip:process.platform!=='darwin'};
test('same original owner is protected after unknown, cancellation, seal and business expiry without phone dispatch',darwin,async t=>{
 const r=rig(t);await r.facade.prepare();assert.equal(typeof r.facade.quarantine,'function');
 mkdirSync(join(r.directory,'native-operations'),{mode:0o700});writeFileSync(join(r.directory,'native-operations','original.unknown'),'sticky',{mode:0o600});await assert.rejects(r.facade.execute(join(root,'douyin-phone-adb'),['--profile','fixture','foreground'],{receipt:r.receipt}),/PREVIOUS_UNKNOWN/);
 r.revoke();await r.facade.close();const before=r.facade.snapshot(),count=r.admissions(),now=Date.now;let result;try{Date.now=()=>r.scope.deadline_ms+1000;result=await r.facade.quarantine();}finally{Date.now=now;}
 assert.equal(result.verified,true);assert.equal(result.physical_actions,0);assert.equal(result.local_protection_only,true);assert.equal(readFileSync(join(r.lock,'standalone_review_required'),'utf8').trim(),'run');assert.equal(r.admissions(),count,'protecting a captured owner never re-authorizes revoked business');assert.equal(r.facade.snapshot().unknown,true);assert.equal(r.facade.snapshot().execution_stopped,before.execution_stopped);assert.deepEqual(readdirSync(join(r.directory,'native-operations')).filter(n=>n.endsWith('.json')),[],'no normal CLI or phone operation starts');
});
test('wrong owner and replaced original LockDir inode cannot receive a protection marker',darwin,async t=>{
 for(const change of ['owner','inode']){const r=rig(t);await r.facade.prepare();if(change==='owner')writeFileSync(join(r.lock,'owner'),'foreign\n',{mode:0o600});else{renameSync(r.lock,r.lock+'-original');mkdirSync(r.lock,{mode:0o700});writeFileSync(join(r.lock,'owner'),'run\n',{mode:0o600});}await r.facade.close();await assert.rejects(r.facade.quarantine(),/QUARANTINE/);assert.equal(existsSync(join(r.lock,'standalone_review_required')),false);}
});
test('foreign owner at capture and extra scope arguments cannot write a marker',darwin,async t=>{
 const foreign=rig(t,{owner:'foreign'});await foreign.facade.prepare();await foreign.facade.close();assert.deepEqual(await foreign.facade.quarantine(),{verified:false,not_owned:true,physical_actions:0});assert.equal(existsSync(join(foreign.lock,'standalone_review_required')),false);
 const r=rig(t);await r.facade.prepare();await r.facade.close();await assert.rejects(r.facade.quarantine({owner:'foreign',task_id:'other'}),/QUARANTINE/);assert.equal(existsSync(join(r.lock,'standalone_review_required')),false);
});

test('quarantine fixture honors a pinned physical interpreter and rejects a forking launcher under nofork',darwin,async t=>{
 const directory=realpathSync(mkdtempSync(join(tmpdir(),'quarantine-python-shim-')));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const probed=spawnSync('/usr/bin/python3',['-I','-S','-c','import os,sys;print(os.path.realpath(sys.executable))'],{encoding:'utf8'});assert.equal(probed.status,0,probed.stderr);
 const physical=realpathSync(process.env.PREFLIGHT_TEST_PYTHON_BIN||probed.stdout.trim()),shim=join(directory,'forking-python');
 const quoted="'"+physical.replaceAll("'","'\\''")+"'";writeFileSync(shim,'#!/bin/sh\n'+quoted+' "$@" &\nwait "$!"\n',{mode:0o700});
 const childEnv={...process.env};delete childEnv.NODE_TEST_CONTEXT;
 const run=python=>spawnSync(process.execPath,['--test','--test-name-pattern=^same original owner is protected',fileURLToPath(import.meta.url)],{env:{...childEnv,PREFLIGHT_TEST_PYTHON_BIN:python},encoding:'utf8',timeout:20000});
 const bad=run(shim);assert.notEqual(bad.status,0,'fixture must consume the explicitly selected shim so the real nofork boundary can reject its child: '+bad.stdout+bad.stderr);assert.match(bad.stdout+bad.stderr,/OFFICIAL_CLI_QUARANTINE_UNKNOWN/);
 const good=run(physical);assert.equal(good.status,0,good.stdout+good.stderr);
});
