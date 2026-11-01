import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runMaintenanceInstall,guardChannel} from '../maintenance-install-backend.mjs';

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
