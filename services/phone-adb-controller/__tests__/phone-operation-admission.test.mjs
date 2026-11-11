import {spawnSync} from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,readdirSync,lstatSync,mkdirSync,writeFileSync,readFileSync,rmSync,renameSync,chmodSync,copyFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createPhoneOperationAdmission,isPhoneOperationAdmission} from '../phone-operation-admission.mjs';
import {freezePreflightProfile} from '../preflight-control-scope.mjs';
import {createOfficialCliClosure,isOfficialCliOperationStopped} from '../official-cli-closure.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url))),sha=b=>createHash('sha256').update(b).digest('hex');
function fixture(t,{programs={}}={}){
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'usb-operation-')));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const template=JSON.parse(readFileSync(join(root,'config/collection-phone-hosts.json'))).hosts.find(h=>h.profile==='xiaolongxia');
 const env={HOME:dir,WFR_RUN_DIR:dir,P:template.profile,SERIAL:template.serial,WFR_TAG:'usb-test',DOUYIN_PHONE_REGISTRY:join(dir,'phones.tsv')};
 writeFileSync(env.DOUYIN_PHONE_REGISTRY,'#profile\tserial\tmodel\twidth\theight\tenabled\nxiaolongxia\tANGYVB4311010223\tMAA-AN00\t1200\t2664\ttrue\n',{mode:0o600});
 const lockRoot=join(dir,'.local/share/zenithjoy/phone-locks');mkdirSync(lockRoot,{recursive:true,mode:0o700});mkdirSync(join(lockRoot,template.serial+'.lock'),{mode:0o700});
 writeFileSync(join(lockRoot,template.serial+'.lock/owner'),env.WFR_TAG,{mode:0o600});writeFileSync(join(lockRoot,template.serial+'.guard'),'',{mode:0o600});
 const policyFile=join(dir,'adb-service.json'),policy=template.policy;
 writeFileSync(policyFile,JSON.stringify(Object.fromEntries(['schema_version','host_id','transport','endpoint','forbidden_ports','adb_bin'].map(k=>[k,policy[k]]))),{mode:0o600});
 const taskId='11111111-1111-4111-8111-111111111111',binding={run_id:'run__a1',id:'22222222-2222-4222-8222-222222222222'};
 const files={};for(const p of ['phone-operation-admission.mjs','preflight-native-domain.mjs','collection-leaf-producer.mjs','config/collection-phone-hosts.json','config/native-phone-command-sources.json','config/native-phone-reviews/xiaolongxia-sdk35-xian-m4.md'])files['runtime/'+p]=sha(readFileSync(join(root,p)));
 for(const name of readdirSync(root)){const path=join(root,name);if(lstatSync(path).isFile())files['runtime/'+name]=sha(readFileSync(path));}
 const executables=Object.fromEntries(Object.entries({zsh:'/bin/zsh',node:process.execPath,python:'/usr/bin/python3',...programs}).map(([name,p])=>{let path=realpathSync(p);if(lstatSync(path).mode&0o022){const target=join(dir,'pinned-'+name);writeFileSync(target,readFileSync(path),{flag:'wx',mode:0o700});path=realpathSync(target);}return [name,{path,sha256:sha(readFileSync(path))}];}));
 const claim={claimed_by:'common-runner',claimed_at:'2026-11-11T08:00:00.000Z'};
 const frozen={snapshot_sha256:'a'.repeat(64),deployment:{source_commit:'b'.repeat(40)},files,native_claim:claim,agent_input:{task_id:taskId,profile:template.profile,serial:template.serial,run_tag:env.WFR_TAG,workflow_key:'douyin_video_discovery'},preflight_profile:freezePreflightProfile({env}),discovery_phone_scope:{...template,run_id:binding.run_id,executables,policy_binding:{usb_local:{protocol:'usb-local-lease/v1',device_sdk:35,transport:{serial:template.serial,transport_id:'11',usb_path:'0-1'},daemon:{pid:111,uid:process.getuid(),endpoint:policy.endpoint,start_identity:'birth',command:'fixed adb server',executable:policy.adb_realpath,executable_sha256:policy.adb_sha256,policy_path:policyFile,policy_sha256:sha(readFileSync(policyFile))}}}}};
 const scope={activity:'preflight',task_id:taskId,run_id:binding.run_id,binding_id:binding.id,snapshot_sha256:frozen.snapshot_sha256,source_commit:frozen.deployment.source_commit,profile:template.profile,serial:template.serial,run:env.WFR_TAG,workflow:'douyin_video_discovery',worker_deadline_ms:Date.now()+20000,receipt_deadline_ms:Date.now()+25000,deadline_ms:Date.now()+30000};
 const central={device_name:template.serial,locked_by:taskId,lease_version:'123',expires_at:new Date(Date.now()+30000).toISOString(),expired:false};
 const live={host:'xian-m4',birth:'birth',sdk:'35',transportId:'11',usb:'0-1',closed:false,pending:0,stop:true,claim:structuredClone(claim),central:structuredClone(central),starts:0,reads:0,inventoryReads:0};
 const dependencies={domainClosure:()=>live.closed&&live.stop&&live.pending===0?Object.freeze({}):null,actualHost:()=>live.host,readDaemon:d=>{assert.equal(d.start_identity,live.birth,'daemon birth must remain exact');return structuredClone(d);},inventory:async()=>{live.inventoryReads++;return {wire_complete:true,socket_closed:true,peer_eof:true,pending:0,response:template.serial+' device usb:'+live.usb+' transport_id:'+live.transportId+'\n'};},startDomain:async()=>{live.starts++;return {environment:()=>({WFR_COLLECTION_LEAF_SOCKET:'/fixture.sock',WFR_COLLECTION_LEAF_NONCE:'fixture'}),adb:async()=>{live.reads++;return live.sdk;},close:async()=>{live.closed=true;return {execution_stopped:live.stop,pending:live.pending};},snapshot:()=>({execution_stopped:live.closed&&live.stop,pending:live.pending})};}};
 const context={root,env,frozen,state:{},scope,binding,taskId,assertAuthority:async()=>({authorized:true,claim:structuredClone(live.claim),central:structuredClone(live.central)})};
 return {context,dependencies,live,dir,lockRoot,create:()=>createPhoneOperationAdmission(context,dependencies)};
}
test('USB真实边界的状态模型区分元数据准备、物理准入与真实关闭',async t=>{
 const f=fixture(t),a=f.create();assert.equal(isPhoneOperationAdmission(a,f.context),true);assert.equal(isPhoneOperationAdmission({...a},f.context),false);
 assert.equal(await a.prepare(),true);assert.equal(f.live.reads,0);assert.equal(f.live.starts,1);
 assert.equal((await a.assert({phase:'before',resourceOnly:false})).authorized,true);assert.equal(f.live.reads,1);assert.ok(f.live.inventoryReads>=2);
 assert.equal(a.environment().WFR_COLLECTION_LEAF_SOCKET,'/fixture.sock');
 assert.equal((await a.close()).execution_stopped,true);assert.equal(f.live.closed,true);assert.equal((await a.close()).execution_stopped,true);
 await assert.rejects(()=>a.assert(),/PHONE_OPERATION_CLOSED_OR_CHANGED/);
});
for(const [name,change]of [
 ['wrong-host',f=>{f.live.host='mmv';}],['changed-daemon',f=>{f.live.birth='reused';}],['wrong-claim',f=>{f.live.claim.claimed_at='different';}],['wrong-central-owner',f=>{f.live.central.locked_by='foreign';}],['expired-central',f=>{f.live.central.expires_at=new Date(0).toISOString();}],['bad-lease-version',f=>{f.live.central.lease_version='unknown';}],['missing-central-expiry',f=>{delete f.live.central.expires_at;}],['invalid-central-expiry',f=>{f.live.central.expires_at='invalid';}],['missing-expired-flag',f=>{delete f.live.central.expired;}],['string-expired-flag',f=>{f.live.central.expired='false';}],['wrong-transport-id',f=>{f.live.transportId='12';}],['wrong-usb-path',f=>{f.live.usb='1-2';}],['changed-local-owner',f=>{writeFileSync(join(f.lockRoot,f.context.env.SERIAL+'.lock/owner'),'foreign');}],['changed-local-inode',f=>{const p=join(f.lockRoot,f.context.env.SERIAL+'.lock/owner');renameSync(p,p+'.old');writeFileSync(p,f.context.env.WFR_TAG,{mode:0o600});}],['unknown-state',f=>{f.context.state.executionUnknown=true;}],['source-snapshot-drift',f=>{f.context.frozen.files['runtime/phone-operation-admission.mjs']='0'.repeat(64);}],['policy-raw-drift',f=>{writeFileSync(f.context.frozen.discovery_phone_scope.policy_binding.usb_local.daemon.policy_path,'{}');}],['untrusted-policy-mode',f=>{chmodSync(f.context.frozen.discovery_phone_scope.policy_binding.usb_local.daemon.policy_path,0o644);}]
])test('USB准入拒绝并保持unknown '+name,async t=>{const f=fixture(t),a=f.create();await a.prepare();await a.assert({phase:'before',resourceOnly:false});change(f);await assert.rejects(()=>a.assert({phase:'before',resourceOnly:false}));assert.equal((await a.close()).execution_stopped,false);assert.equal(f.live.closed,true);assert.equal(f.context.state.executionUnknown,true);});
for(const [name,change]of [['pending-producer',f=>{f.live.pending=1;}],['unconfirmed-close',f=>{f.live.stop=false;}],['close-authority-revoked',f=>{f.live.claim.claimed_by='foreign';}]])test('SDK/外层exit0不能洗白USB关闭 '+name,async t=>{const f=fixture(t),a=f.create();await a.prepare();change(f);assert.equal((await a.close()).execution_stopped,false);assert.equal(a.snapshot().unknown,true);});
for(const [name,change]of [['wrong-policy-host',s=>{s.policy.host_id='mmv';}],['wrong-port',s=>{s.policy.endpoint='tcp:127.0.0.1:5042';}],['wrong-profile',s=>{s.profile='legacy';}],['wrong-serial',s=>{s.serial='foreign';}],['wrong-sdk-declaration',s=>{s.policy_binding.usb_local.device_sdk=31;}],['no-binding',s=>{s.policy_binding=null;}]])test('USB不把任意schema1当受支持设备 '+name,t=>{const f=fixture(t);change(f.context.frozen.discovery_phone_scope);assert.throws(()=>f.create(),/PHONE_OPERATION_(?:SCOPE|USB_SCOPE)/);assert.equal(f.live.starts,0);});
test('缺品牌的USB CLI调用不能借任意assertAdmission回调获取执行能力',t=>{const f=fixture(t);assert.throws(()=>createOfficialCliClosure({...f.context,assertAdmission:async()=>({authorized:true})}),/OFFICIAL_CLI_ADMISSION/);});

test('USB首次物理准入必须亲读SDK35，声明不能代替实际值',async t=>{const f=fixture(t),a=f.create();f.live.sdk='31';await a.prepare();await assert.rejects(()=>a.assert({phase:'before',resourceOnly:false}),/PHONE_OPERATION_USB_SDK/);assert.equal((await a.close()).execution_stopped,false);assert.equal(f.live.closed,true);});
test('USB worker绝对截止耗尽后拒绝新动作并仍关闭本人producer',async t=>{const f=fixture(t);f.context.scope.worker_deadline_ms=Date.now()+60;f.context.scope.receipt_deadline_ms=Date.now()+250;f.context.scope.deadline_ms=Date.now()+350;const a=f.create();await a.prepare();await new Promise(r=>setTimeout(r,70));await assert.rejects(()=>a.assert({phase:'before',resourceOnly:false}),/CLOSED_OR_CHANGED/);assert.equal((await a.close()).execution_stopped,false);assert.equal(f.live.closed,true);});
test('prepare后来源漂移失败仍必须封闭已经创建的真实producer',async t=>{const f=fixture(t),start=f.dependencies.startDomain;f.dependencies.startDomain=async(...args)=>{const d=await start(...args);f.context.frozen.snapshot_sha256='0'.repeat(64);return d;};const a=f.create();await assert.rejects(()=>a.prepare());assert.equal((await a.close()).execution_stopped,false);assert.equal(f.live.closed,true);});
test('序列化的domain关闭JSON不能代替本进程producer关闭品牌',async t=>{const f=fixture(t);f.dependencies.domainClosure=()=>null;const a=f.create();await a.prepare();assert.equal((await a.close()).execution_stopped,false);assert.equal(a.snapshot().unknown,true);});

test('云epoch准入保持原关闭语义，外部未知不伪装为本CLI生产者仍活',async t=>{const f=fixture(t);f.context.frozen.discovery_phone_scope.policy.schema_version=2;const a=f.create();await a.prepare();f.context.state.executionUnknown=true;assert.equal((await a.close()).execution_stopped,true);assert.equal(f.live.starts,0);await assert.rejects(()=>a.assert());});

test('丢失调用上下文及JSON不能取得USB准入品牌',t=>{const f=fixture(t),a=f.create();assert.equal(isPhoneOperationAdmission(a),false);assert.equal(isPhoneOperationAdmission({},f.context),false);assert.equal(isPhoneOperationAdmission(a,{...f.context,env:{...f.context.env,WFR_TAG:'foreign'}}),false);});

test('实际USB准入接入官方CLI，元数据子进程真实close才授予本次停止品牌',async t=>{const f=fixture(t),a=f.create(),facade=createOfficialCliClosure({...f.context,operationAdmission:a});await facade.prepare();const command=join(root,'douyin-phone-adb'),args=['--profile',f.context.env.P,'runtime-contract'],receipt={runDir:f.dir,operationId:'usb-meta',runId:f.context.binding.run_id,taskId:f.context.taskId,profile:f.context.env.P,serial:f.context.env.SERIAL,sourceCommit:f.context.frozen.deployment.source_commit,owner:f.context.env.WFR_TAG,activity:'preflight'};const r=await facade.execute(command,args,{receipt,timeoutMs:10000});const context={command,args,receipt,root,frozen:f.context.frozen};assert.equal(isOfficialCliOperationStopped(r,context),true);assert.equal(isOfficialCliOperationStopped({...r},context),false);assert.equal((await facade.close()).execution_stopped,true);assert.equal(f.live.closed,true);assert.equal(f.live.reads,0,'元数据不应探测手机SDK');});

test('已合法释放central与业务unknown不抹掉实际USB producer关闭事实',async t=>{const f=fixture(t),a=f.create();await a.prepare();await a.assert({phase:'before',resourceOnly:false});f.live.central.locked_by=null;f.context.state.executionUnknown=true;assert.equal((await a.close()).execution_stopped,true);assert.equal(f.live.closed,true);assert.equal(f.context.state.executionUnknown,true);});

for(const identity of ['daemon','owner'])test('最后authority等待期间USB身份漂移必须在放行前拒绝 '+identity,async t=>{
 const f=fixture(t),original=f.context.assertAuthority;let armed=false,calls=0;
 f.context.assertAuthority=async request=>{const proof=await original(request);if(armed&&++calls===2){if(identity==='daemon')f.live.birth='replaced-after-final-source';else writeFileSync(join(f.lockRoot,f.context.env.SERIAL+'.lock/owner'),'foreign-after-final-source');}return proof;};
 const a=f.create();t.after(()=>a.close());await a.prepare();await a.assert({phase:'before',resourceOnly:false});armed=true;
 await assert.rejects(()=>a.assert({phase:'before',resourceOnly:false}));assert.equal(calls,2);assert.equal(f.context.state.executionUnknown,true);
});

test('可写宿主Node必须先冻结私有不可写副本再进入真实CLI固定运行时核验',async t=>{
 const directory=realpathSync(mkdtempSync(join(tmpdir(),'usb-writable-node-')));t.after(()=>rmSync(directory,{recursive:true,force:true}));const source=join(directory,'node');copyFileSync(process.execPath,source);chmodSync(source,0o770);
 const f=fixture(t,{programs:{node:source}}),a=f.create(),facade=createOfficialCliClosure({...f.context,operationAdmission:a});t.after(()=>facade.close());await facade.prepare();
 const pinned=f.context.frozen.discovery_phone_scope.executables.node;assert.notEqual(pinned.path,source);assert.equal(lstatSync(pinned.path).mode&0o022,0);assert.equal(lstatSync(source).mode&0o777,0o770);assert.equal(pinned.sha256,sha(readFileSync(source)));const version=spawnSync(pinned.path,['--version'],{env:{PATH:'/usr/bin:/bin'},encoding:'utf8',timeout:5000});assert.equal(version.status,0,version.stderr);assert.equal(version.stdout.trim(),process.version);assert.equal((await facade.close()).execution_stopped,true);
});
