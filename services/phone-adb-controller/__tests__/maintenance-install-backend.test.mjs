import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {runMaintenanceInstall,guardChannel} from '../maintenance-install-backend.mjs';
import {TOOLS} from '../deployment-transport.mjs';

const sha='a'.repeat(40);
const uuid=n=>`${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const candidate={source_commit:sha,environment:`staging:${sha}`,business_runtime_status:'not_evaluated',
 release_ids:{mmv:uuid(1),'xian-m4':uuid(2)},observation_ids:{mmv:uuid(3),'xian-m4':uuid(4)}};
const request=async path=>{
 const host=path.includes(candidate.release_ids.mmv)?'mmv':'xian-m4';
 return {deployed:true,actual_matches:true,gaps:[],current_observation_id:candidate.observation_ids[host]};
};

test('守卫子进程必须继承真实租锁和回执 FD',()=>{
 let observed;
 guardChannel('check',{env:{WF_DEPLOY_LOCK_FD:'4',WF_DEPLOY_RESPONSE_FD:'7'},
  exec:(file,args,options)=>{observed={file,args,options};}});
 assert.equal(observed.args.at(-1),'check');
 assert.equal(observed.options.stdio[4],4);
 assert.equal(observed.options.stdio[7],7);
});

test('Workflow 安全模式通过租锁 wrapper 进入 prepare，常规候选路径不变',()=>{
 const source=readFileSync(new URL('../../../.github/workflows/deploy-phone-adb-controller.yml',import.meta.url),'utf8');
 assert.match(source,/DEPLOY_ENTRY=\(node "\$TOOL_CHECKOUT\/services\/phone-adb-controller\/deployment-prepare[.]mjs"\)/);
 assert.match(source,/if \[\[ "\$DEPLOY_MODE" == maintenance-install \|\| "\$DEPLOY_MODE" == maintenance-recover \]\]; then\s+DEPLOY_ENTRY=\(python3 "\$TOOL_CHECKOUT\/services\/phone-adb-controller\/deployment-guard[.]py" "\$\{DEPLOY_ENTRY\[@\]\}"\)/);
 assert.match(source,/DEPLOY_LOG=\$\("\$\{DEPLOY_ENTRY\[@\]\}"/);
 assert.match(source,/export WF_PHONE_TOOL_SHA="\$TOOL_SHA"/);
});

test('安全-only 双机候选门禁后才调用唯一 M4 事务，且不走正式部署',async()=>{
 const actions=[],calls=[],tx='phone-safety-'+sha.slice(0,24);
 const result=await runMaintenanceInstall({root:'/fixture',sha,attemptKey:'fixture',request,candidate,
  guardFn:action=>actions.push(action),stageToolsFn:()=>actions.push('stage'),
  transportFn:()=>({call:(...args)=>{calls.push(args);return{transaction:tx,source_commit:sha,secured:true};}})});
 assert.deepEqual(actions,['check','stage','admit','complete']);
 assert.deepEqual(calls,[['xian-m4','maintenance-install-host.py','install',tx,{source_commit:sha}]]);
 assert.equal(result.production_release_unchanged,true);
 assert.equal(result.business_runtime_status,'not_evaluated');
});

test('候选 gate 不完整时不 stage、不 admit、不执行主机动作',async()=>{
 const actions=[];
 await assert.rejects(runMaintenanceInstall({root:'/fixture',sha,request:async()=>({deployed:true,actual_matches:true,gaps:['missing']}),candidate,
  guardFn:action=>actions.push(action),stageToolsFn:()=>actions.push('stage'),transportFn:()=>{throw Error('transport must not run');}}),/gate/);
 assert.deepEqual(actions,[]);
});

test('恢复事务必须绑定同一固定 SHA，错事务不得触发远端动作',async()=>{
 const actions=[];
 await assert.rejects(runMaintenanceInstall({root:'/fixture',sha,request,action:'recover',
  transaction:'phone-safety-'+'b'.repeat(24),guardFn:a=>actions.push(a),
  stageToolsFn:()=>actions.push('stage'),transportFn:()=>{throw Error('transport must not run');}}),/事务ID/);
 assert.deepEqual(actions,[]);
});

test('远端结果未知时不完成部署 guard，原事务保持可恢复',async()=>{
 const actions=[];
 await assert.rejects(runMaintenanceInstall({root:'/fixture',sha,request,candidate,
  guardFn:action=>actions.push(action),stageToolsFn:()=>actions.push('stage'),
  transportFn:()=>({call:()=>{throw Error('M4 disconnected');}})}),/M4 disconnected/);
 assert.deepEqual(actions,['check','stage','admit']);
});

test('旧固定事务仅用受审新工具闭包恢复，事务和原来源保持不变',async()=>{
 const sourceSha='3fe8783b021fd9fa1a8cd4242d79a3c703c6c21b',toolSha='b'.repeat(40);
 const actions=[],tx='phone-safety-'+sourceSha.slice(0,24);
 const result=await runMaintenanceInstall({root:'/old',sha:sourceSha,toolRoot:'/new',toolSha,
  action:'recover',transaction:tx,request,
  readSourceFn:(_root,_sha,path)=>Buffer.from(path.endsWith('/maintenance-install-host.py')&&_sha===toolSha?'repaired':'original'),
  guardFn:action=>actions.push(action),stageToolsFn:(root,sha)=>actions.push(['stage',root,sha]),
  transportFn:sha=>{actions.push(['transport',sha]);return{call:(host,name,action,transaction,input)=>{
   assert.deepEqual([host,name,action,transaction,input],['xian-m4','maintenance-install-host.py','recover',tx,{source_commit:sourceSha}]);
   return{transaction:tx,source_commit:sourceSha,secured:true};}};}});
 assert.equal(TOOLS.includes('maintenance-install-host.py'),true);
 assert.deepEqual(actions,['check',['stage','/new',toolSha],['transport',toolSha],'admit','complete']);
 assert.equal(result.source_commit,sourceSha);
});

test('跨来源恢复若非原3fe事务或其他工具也变化，任何远端动作前拒绝',async()=>{
 const sourceSha='3fe8783b021fd9fa1a8cd4242d79a3c703c6c21b',toolSha='b'.repeat(40);
 for(const [sha,changed] of [['a'.repeat(40),false],[sourceSha,true]]){
  const actions=[];
  await assert.rejects(runMaintenanceInstall({root:'/old',sha,toolRoot:'/new',toolSha,
   action:'recover',transaction:'phone-safety-'+sha.slice(0,24),request,
   readSourceFn:(_root,_sha,path)=>Buffer.from(_sha===toolSha&&
    (path.endsWith('/maintenance-install-host.py')||(changed&&path.endsWith('/deployment-service.py')))?'changed':'original'),
   guardFn:action=>actions.push(action),stageToolsFn:()=>actions.push('stage'),transportFn:()=>{throw Error('transport must not run');}}),/工具|来源/);
  assert.deepEqual(actions,[]);
 }
});

// Original public repository bytes, frozen at 3fe, keep this test independent of
// shallow CI Git history. The production profile verifies their SHA256 values.
const originalGuardSources=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/review-guard-3fe-source.json.gz',import.meta.url))));
function guardRecoveryFixture(mutate=()=>{}){
 const original='3fe8783b021fd9fa1a8cd4242d79a3c703c6c21b',toolSha='b'.repeat(40),actions=[];
 const before={},after={};
 for(const name of TOOLS){
  before[name]=Buffer.from(originalGuardSources[name]??('original:'+name));
  after[name]=['maintenance-install-host.py','deployment-maintenance.py','input-runtime-release.py'].includes(name)
   ?readFileSync(new URL('../'+name,import.meta.url)):before[name];
 }
 mutate({before,after});
 const args={root:'/original',sha:original,toolRoot:'/reviewed',toolSha,action:'recover',
  transaction:'phone-safety-'+original.slice(0,24),request,
  readSourceFn:(_root,revision,path)=>(revision===original?before:after)[path.split('/').at(-1)],
  guardFn:action=>actions.push(action),stageToolsFn:()=>actions.push('stage'),
  transportFn:()=>({call:()=>({transaction:'phone-safety-'+original.slice(0,24),source_commit:original,secured:true})})};
 return{args,actions};
}
test('原3fe可通过精确受审三文件profile恢复，保留原事务和来源',async()=>{
 const f=guardRecoveryFixture();const result=await runMaintenanceInstall(f.args);
 assert.equal(result.recovery_compatibility,'review-guard-snapshot-v1');
 assert.equal(result.source_commit,f.args.sha);
 assert.deepEqual(f.actions,['check','stage','admit','complete']);
});
for(const [label,mutate]of [
 ['旧maintenance摘要',x=>x.before['deployment-maintenance.py']=Buffer.from('unapproved original')],
 ['新maintenance摘要',x=>x.after['deployment-maintenance.py']=Buffer.concat([x.after['deployment-maintenance.py'],Buffer.from('\n# foreign')])],
 ['旧input摘要',x=>x.before['input-runtime-release.py']=Buffer.from('unapproved original')],
 ['新input摘要',x=>x.after['input-runtime-release.py']=Buffer.concat([x.after['input-runtime-release.py'],Buffer.from('\n# foreign')])],
 ['新host摘要',x=>x.after['maintenance-install-host.py']=Buffer.concat([x.after['maintenance-install-host.py'],Buffer.from('\n# foreign')])],
 ['第四个TOOLS成员',x=>x.after['deployment-service.py']=Buffer.from('foreign tool')],
])test('精确guard恢复profile拒绝'+label+'漂移且无远端动作',async()=>{
 const f=guardRecoveryFixture(mutate);await assert.rejects(runMaintenanceInstall(f.args),/闭包|profile|摘要/);
 assert.deepEqual(f.actions,[]);
});
test('guard profile仍拒绝其他source/install/transaction',async()=>{
 for(const change of [{sha:'c'.repeat(40)},{action:'install'},{transaction:'phone-safety-'+'c'.repeat(24)}]){
  const f=guardRecoveryFixture();await assert.rejects(runMaintenanceInstall({...f.args,...change}));
  assert.deepEqual(f.actions,[]);
 }
});
