import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {bindAuthorizationIntent as bind} from '../leadgen-authorization-intent.mjs';
import {validateAuthorization} from '../activity-104-context.mjs';
const moduleUrl=new URL('../leadgen-authorization-intent.mjs',import.meta.url).href;
const hash=b=>createHash('sha256').update(b).digest('hex');
const task='11111111-1111-4111-8111-111111111111',run='22222222-2222-4222-8222-222222222222';
const otherTask='33333333-3333-4333-8333-333333333333',otherRun='44444444-4444-4444-8444-444444444444';
const canonical=x=>JSON.stringify(x,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v)+'\n';
function fixture(t){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'authorization-intent-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const stateRoot=path.join(root,'machine-authorizations');fs.mkdirSync(stateRoot,{mode:0o700});
 const message='明确标记的离线批准测试，不是真实外发授权。';
 const scope={company_id:'company-fixture',tenant_id:'tenant-fixture',line:'line-fixture',account:'sender-fixture',sender_id:'sender-fixture',host:'mmv',profile:'profile-fixture',serial:'hardware-fixture',adb_serial:'127.0.0.1:15555',policy_id:'policy-fixture',policy_version:34,message_sha256:hash(message),scope:{record_id:'record-fixture',comment_id:'comment-fixture',lead_id:'lead-fixture',target_douyin_id:'target-fixture',profile_url:'https://www.douyin.com/user/fixture',source_102_run:'source102-fixture',source_103_run:'source103-fixture'}};
 const intent={schema:'leadgen-send-authorization-intent/v1',machine_id:'fixture-mmv',decision_id:'decision-fixture',authorizing_root_task_id:'55555555-5555-4555-8555-555555555555',scope,message,message_sha256:hash(message),max_new_recipients:1,max_send_attempts:1,test_execution_daily_cap:100,company_policy_changed:false,requires_current_pause_and_daily_count_readback:true};
 const intentPath=path.join(root,'intent.json');
 const writeIntent=()=>{fs.writeFileSync(intentPath,JSON.stringify(intent),{mode:0o600});fs.chmodSync(intentPath,0o600);return {path:intentPath,sha256:hash(fs.readFileSync(intentPath))};};
 const args={intentAsset:writeIntent(),stateRoot,machineId:intent.machine_id,taskId:task,runId:run,expectedScope:structuredClone(scope)};
 return {root,stateRoot,intentPath,intent,args,writeIntent,dir:()=>path.join(stateRoot,args.intentAsset.sha256)};
}
function assertNoConsumption(f){assert.deepEqual(fs.readdirSync(f.stateRoot),[]);}
test('生成与原validator兼容的准确Task授权资产和固定scope receipt',t=>{
 const f=fixture(t),result=bind(f.args);assert.equal(result.recovered,false);
 const asset=JSON.parse(fs.readFileSync(result.authorization_asset.path));assert.equal(asset.root_task_id,task);assert.equal(asset.message,f.intent.message);assert.equal(asset.test_execution_daily_cap,100);
 assert.equal(validateAuthorization({root_task_id:task,authorization_asset:result.authorization_asset}).decision_id,f.intent.decision_id);
 const receipt=JSON.parse(fs.readFileSync(result.binding_receipt.path));assert.equal(receipt.task_id,task);assert.equal(receipt.run_id,run);assert.equal(receipt.authorizing_root_task_id,f.intent.authorizing_root_task_id);assert.deepEqual(receipt.scope,f.args.expectedScope);
 for(const file of [result.authorization_asset,result.binding_receipt]){assert.equal(hash(fs.readFileSync(file.path)),file.sha256);assert.equal(fs.statSync(file.path).mode&0o777,0o600);}
 assert.equal(fs.statSync(f.dir()).mode&0o777,0o700);
});
test('同Task/run完整恢复只读原件，不更新内容/mtime/inode',t=>{
 const f=fixture(t),first=bind(f.args),before=[first.authorization_asset,first.binding_receipt].map(x=>({bytes:fs.readFileSync(x.path),stat:fs.statSync(x.path,{bigint:true})}));
 const again=bind(f.args);assert.equal(again.recovered,true);assert.deepEqual(again.authorization_asset,first.authorization_asset);assert.deepEqual(again.binding_receipt,first.binding_receipt);
 for(const [i,x]of [again.authorization_asset,again.binding_receipt].entries()){assert.deepEqual(fs.readFileSync(x.path),before[i].bytes);const st=fs.statSync(x.path,{bigint:true});assert.equal(st.mtimeNs,before[i].stat.mtimeNs);assert.equal(st.ino,before[i].stat.ino);}
});
for(const change of [{taskId:otherTask},{runId:otherRun},{taskId:otherTask,runId:otherRun}])test('不同Task/run不能再次消费 '+JSON.stringify(change),t=>{const f=fixture(t);bind(f.args);assert.throws(()=>bind({...f.args,...change}));assert.equal(fs.readdirSync(f.stateRoot).length,1);});
for(const key of ['company_id','tenant_id','account','sender_id','host','profile','serial','adb_serial','policy_id','message_sha256'])test('可信scope逐项不符拒绝 '+key,t=>{const f=fixture(t);f.args.expectedScope[key]+='-changed';assert.throws(()=>bind(f.args));assertNoConsumption(f);});
for(const key of ['record_id','comment_id','lead_id','target_douyin_id','profile_url','source_102_run','source_103_run'])test('原订单来源逐项不符拒绝 '+key,t=>{const f=fixture(t);f.args.expectedScope.scope[key]+='-changed';assert.throws(()=>bind(f.args));assertNoConsumption(f);});
for(const [key,value]of [['max_new_recipients',2],['max_send_attempts',2],['test_execution_daily_cap',101],['company_policy_changed',true],['requires_current_pause_and_daily_count_readback',false],['message','wrong'],['machine_id','other-machine'],['schema','other'],['extra',true]])test('拒绝无效批准字段 '+key,t=>{const f=fixture(t);f.intent[key]=value;f.args.intentAsset=f.writeIntent();assert.throws(()=>bind(f.args));assertNoConsumption(f);});
test('传入machineId不符拒绝',t=>{const f=fixture(t);assert.throws(()=>bind({...f.args,machineId:'other-machine'}));assertNoConsumption(f);});
test('原intent摘要不符与危险正文在消费前拒绝',t=>{const f=fixture(t);fs.appendFileSync(f.intentPath,' ');assert.throws(()=>bind(f.args));assertNoConsumption(f);f.intent.message='bad\ntext';f.intent.message_sha256=hash(f.intent.message);f.intent.scope.message_sha256=f.intent.message_sha256;f.args.expectedScope=structuredClone(f.intent.scope);f.args.intentAsset=f.writeIntent();assert.throws(()=>bind(f.args));assertNoConsumption(f);});
for(const stage of ['empty','asset_only','receipt_only','pending_file'])test('中断半绑定不补写 '+stage,t=>{
 const f=fixture(t);if(stage==='empty')fs.mkdirSync(f.dir(),{mode:0o700});else{const r=bind(f.args);if(stage==='asset_only')fs.unlinkSync(r.binding_receipt.path);if(stage==='receipt_only')fs.unlinkSync(r.authorization_asset.path);if(stage==='pending_file')fs.writeFileSync(path.join(f.dir(),'.pending'),'unfinished',{mode:0o600});}
 const before=fs.readdirSync(f.dir()).sort();assert.throws(()=>bind(f.args));assert.deepEqual(fs.readdirSync(f.dir()).sort(),before);
});
test('receipt/body+sha联动篡改不能由receipt自证',t=>{
 const f=fixture(t),r=bind(f.args);const a=JSON.parse(fs.readFileSync(r.authorization_asset.path));a.max_send_attempts=2;fs.writeFileSync(r.authorization_asset.path,canonical(a));const receipt=JSON.parse(fs.readFileSync(r.binding_receipt.path));receipt.authorization_asset.sha256=hash(fs.readFileSync(r.authorization_asset.path));fs.writeFileSync(r.binding_receipt.path,canonical(receipt));assert.throws(()=>bind(f.args));
});
test('同摘要原intent换路径不能冒充原绑定恢复',t=>{const f=fixture(t);bind(f.args);const second=path.join(f.root,'same-intent.json');fs.writeFileSync(second,fs.readFileSync(f.intentPath),{mode:0o600});assert.throws(()=>bind({...f.args,intentAsset:{...f.args.intentAsset,path:second}}));});
for(const kind of ['intent_symlink','intent_hardlink','intent_mode','state_symlink','state_mode','reservation_symlink'])test('拒绝不安全文件来源 '+kind,t=>{
 const f=fixture(t);
 if(kind==='intent_symlink'){const p=path.join(f.root,'intent-link');fs.symlinkSync(f.intentPath,p);f.args.intentAsset.path=p;}
 if(kind==='intent_hardlink')fs.linkSync(f.intentPath,path.join(f.root,'intent-link'));
 if(kind==='intent_mode')fs.chmodSync(f.intentPath,0o644);
 if(kind==='state_symlink'){const p=path.join(f.root,'state-link');fs.symlinkSync(f.stateRoot,p);f.args.stateRoot=p;}
 if(kind==='state_mode')fs.chmodSync(f.stateRoot,0o755);
 if(kind==='reservation_symlink'){const other=path.join(f.root,'other');fs.mkdirSync(other,{mode:0o700});fs.symlinkSync(other,f.dir());}
 assert.throws(()=>bind(f.args));
});
test('恢复也拒绝产物软链接或权限漂移',t=>{const f=fixture(t),r=bind(f.args);fs.chmodSync(r.binding_receipt.path,0o644);assert.throws(()=>bind(f.args));fs.chmodSync(r.binding_receipt.path,0o600);const saved=path.join(f.root,'saved');fs.renameSync(r.authorization_asset.path,saved);fs.symlinkSync(saved,r.authorization_asset.path);assert.throws(()=>bind(f.args));});
function child(args,barrier){const code=`import fs from 'node:fs';import {setTimeout} from 'node:timers/promises';import {bindAuthorizationIntent} from ${JSON.stringify(moduleUrl)};let b='';for await(const c of process.stdin)b+=c;const x=JSON.parse(b);fs.writeFileSync(x.barrier+'.'+x.args.taskId,'ready');const until=Date.now()+5000;while(!fs.existsSync(x.barrier)){if(Date.now()>until)process.exit(24);await setTimeout(5);}try{console.log(JSON.stringify(bindAuthorizationIntent(x.args)));}catch{process.exitCode=23;}`;const p=spawn(process.execPath,['--input-type=module','-e',code],{stdio:['pipe','pipe','pipe']});let stdout='';p.stdout.on('data',c=>stdout+=c);const done=new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',code=>resolve({code,stdout}));});p.stdin.end(JSON.stringify({args,barrier}));return done;}
test('同一barrier放行两个独立进程，两Task只能一个完整绑定成功',async t=>{
 const f=fixture(t),barrier=path.join(f.root,'start');const pending=[child(f.args,barrier),child({...f.args,taskId:otherTask,runId:otherRun},barrier)];
 const deadline=Date.now()+5000;while(![task,otherTask].every(id=>fs.existsSync(barrier+'.'+id))){assert.ok(Date.now()<deadline,'child readiness deadline');await new Promise(r=>setTimeout(r,5));}
 fs.writeFileSync(barrier,'go');const results=await Promise.all(pending);assert.deepEqual(results.map(r=>r.code).sort((a,b)=>a-b),[0,23]);const winner=JSON.parse(results.find(r=>r.code===0).stdout);assert.equal(winner.recovered,false);assert.equal(fs.readdirSync(f.stateRoot).length,1);const receipt=JSON.parse(fs.readFileSync(winner.binding_receipt.path));assert.ok([task,otherTask].includes(receipt.task_id));
});
test('占用目录及最终提交都持久化，receipt发布前auth已fsync',t=>{
 const f=fixture(t),events=[];const original={openSync:fs.openSync,fsyncSync:fs.fsyncSync,linkSync:fs.linkSync};const paths=new Map();
 try{fs.openSync=(p,...args)=>{const fd=original.openSync(p,...args);paths.set(fd,String(p));return fd;};fs.fsyncSync=fd=>{events.push(['fsync',paths.get(fd)]);return original.fsyncSync(fd);};fs.linkSync=(a,b)=>{events.push(['publish',String(b)]);return original.linkSync(a,b);};
  const r=bind(f.args);const publish=events.findIndex(e=>e[0]==='publish');assert.ok(publish>0);assert.ok(events.slice(0,publish).some(e=>e[1]===f.stateRoot));assert.ok(events.slice(0,publish).some(e=>e[1]===r.authorization_asset.path));assert.ok(events.slice(publish+1).some(e=>e[0]==='fsync'&&e[1]===f.dir()));
 }finally{Object.assign(fs,original);}
});

for(const stage of ['before_publish','after_publish'])test('真实子进程中断后拒绝恢复且不补写 '+stage,async t=>{
 const f=fixture(t);const code=`import fs from 'node:fs';import {bindAuthorizationIntent} from ${JSON.stringify(moduleUrl)};let body='';for await(const c of process.stdin)body+=c;const {args,stage}=JSON.parse(body);const link=fs.linkSync;fs.linkSync=(...v)=>{if(stage==='after_publish')link(...v);process.exit(27);};bindAuthorizationIntent(args);`;
 const p=spawn(process.execPath,['--input-type=module','-e',code],{stdio:['pipe','ignore','pipe']});const done=new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',resolve);});p.stdin.end(JSON.stringify({args:f.args,stage}));assert.equal(await done,27);
 const before=fs.readdirSync(f.dir()).sort();assert.ok(before.includes('.binding-receipt.pending'));assert.throws(()=>bind(f.args));assert.deepEqual(fs.readdirSync(f.dir()).sort(),before);assert.throws(()=>bind({...f.args,taskId:otherTask,runId:otherRun}));
});
