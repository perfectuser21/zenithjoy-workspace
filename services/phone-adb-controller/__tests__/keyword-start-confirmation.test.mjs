import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, statSync, chmodSync, symlinkSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { keywordFixture } from './keyword-workflow-cli-fixture.mjs';
import { cli, service } from './workflow-cli-fixture.mjs';
const entry=join(service,'keyword-workflow.js'), runtime=process.env.CECELIA_ACTIVITY_RUNTIME;
const sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
async function prepare(t, { block=false, badCapability=false, referenceOnly=false }={}) {
  const f=await keywordFixture(t);
  f.startup=join(f.home,'startup.json');f.id=randomUUID();f.contract=join(f.home,'compiled.json');
  const bindings=JSON.parse(readFileSync(join(service,'plans/keyword_workflow.bindings.json'),'utf8'));
  if(badCapability || referenceOnly){
    bindings.capability='benchmark_link_acquisition';bindings.source.contract='product-map/contracts/benchmark_link_acquisition.yaml';
    bindings.trigger_inputs.push('BenchmarkAccount');
    if(referenceOnly){bindings.select=['preflight'];bindings.activities={preflight:bindings.activities.preflight};}
  }
  const bindingsPath=join(f.home,'confirmation.bindings.json');writeFileSync(bindingsPath,JSON.stringify(bindings));
  const compiledCLI=spawnSync(process.execPath,[join(service,'../../scripts/product-map/wf-plan.mjs'),bindings.capability,'--json','--bindings',bindingsPath],{encoding:'utf8'});
  assert.equal(compiledCLI.status,0,compiledCLI.stderr);
  const compiled=JSON.parse(compiledCLI.stdout);
  writeFileSync(f.contract,JSON.stringify(compiled));f.compiled=compiled;
  if(block){const p=join(f.home,'.local/bin/douyin-phone-adb');const source=readFileSync(p,'utf8');
    writeFileSync(p,source.replace("case 'preflight':", "case 'preflight': while(!fs.existsSync(path.join(home,'release')))await new Promise(done=>setTimeout(done,20));"));}
  f.preload=join(f.home,'count-spawns.cjs');
  writeFileSync(f.preload,`const fs=require('node:fs'),cp=require('node:child_process');const old=cp.spawn;
cp.spawn=function(file,args,...rest){if(args?.[0]===${JSON.stringify(runtime)})fs.appendFileSync(${JSON.stringify(join(f.home,'runtime-calls'))},'runtime\\n');return old.call(this,file,args,...rest);};`);
  f.env.NODE_OPTIONS=(f.env.NODE_OPTIONS||'')+' --require '+f.preload;
  f.args=['--runtime',runtime,'--contract',f.contract,'--receipt',f.receiptPath,'--startup-receipt',f.startup,'--startup-id',f.id];
  f.confirm=async (input=f.input, args=[], path=f.startup,id=f.id,helperEntry=entry)=>{
    const trap=join(f.home,'helper-trap.cjs');
    writeFileSync(trap,`const fs=require('node:fs');const blocked=()=>{fs.appendFileSync(${JSON.stringify(join(f.home,'helper-side-effects'))},'called\\n');throw Error('只读模式不得执行');};
for(const name of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])require('node:child_process')[name]=blocked;
require('node:net').Socket.prototype.connect=blocked;globalThis.fetch=blocked;`);
    const out=await cli(helperEntry,['--confirm-start','--contract',f.contract,'--startup-receipt',path,'--startup-id',id,...args],
      {env:{...f.env,NODE_OPTIONS:'--require '+trap},input});
    assert.equal(out.signal,null);assert.equal(out.stderr,'');assert.equal(out.stdout.trim().split('\n').length,1);
    assert.equal(existsSync(join(f.home,'helper-side-effects')),false,'helper不得运行执行器/编译器/设备/数据库');
    return {out,value:JSON.parse(out.stdout)};
  };
  return f;
}
async function started(f,running){
 for(let i=0;i<150;i++){if(existsSync(f.startup))return JSON.parse(readFileSync(f.startup,'utf8'));if(running.done)break;await sleep(20);}
 throw Error('同一实际keyword CLI未发布原生START: '+JSON.stringify(running.output));
}
function launch(f){const state={done:false};state.promise=cli(entry,f.args,{env:f.env,input:f.input}).then(output=>{state.output=output;state.done=true;return output;});return state;}
function terminal(f,out){assert.equal(out.code,0,out.stdout);assert.equal(out.stdout.trim().split('\n').length,1);
 assert.deepEqual(JSON.parse(out.stdout),JSON.parse(readFileSync(f.receiptPath,'utf8')));
 assert.equal(readFileSync(join(f.home,'runtime-calls'),'utf8'),'runtime\n','同一入口必须仅启动一次原生执行器');}

test('真实阻塞整批CLI：终态前独立只读确认完整调度身份，唯一原生执行器', {timeout:60000},async t=>{
 const f=await prepare(t,{block:true}), running=launch(f);
 try{
   const start=await started(f,running);assert.equal(running.done,false);
   const {out,value}=await f.confirm();assert.equal(out.code,0,out.stdout);
   assert.deepEqual(value,{schema_version:1,event_type:'WF_RUN_START_CONFIRMED',run_tag:f.input.run_tag,
     capability:'keyword_acquisition',line_key:f.input.line_key,profile:f.input.device.profile,serial:f.input.device.serial,
     startup_id:f.id,workflow:f.compiled.contract.workflow,contract_sha256:sha(f.compiled.contract),
     input_sha256:start.input_sha256,at:start.at});
   const normalized={...f.input,videos:[],comments:[],workflow_artifacts:{},return_to_results:true,execution:f.input.execution||{}};
   assert.equal(value.input_sha256,sha(normalized));assert.equal(statSync(f.startup).mode&0o777,0o600);
 }finally{writeFileSync(join(f.home,'release'),'');await running.promise;}
 terminal(f,running.output);
 const portable=join(f.home,'portable');mkdirSync(join(portable,'plans'),{recursive:true});
 const deploy=readFileSync(join(service,'deploy.sh'),'utf8');
 for(const path of ['keyword-workflow.js','keyword-workflow-control.js','plans/keyword_workflow.contract.json']){
   assert.ok(deploy.includes(path),'只读helper依赖必须已在真实部署清单');copyFileSync(join(service,path),join(portable,path));
 }
 assert.equal((await f.confirm(f.input,[],f.startup,f.id,join(portable,'keyword-workflow.js'))).out.code,0,'真实平铺部署闭包可只读确认，无compiler和runtime');

});

test('快终态历史START绑定本轮nonce，拒绝错误调度身份、契约与损坏文件', {timeout:60000},async t=>{
 const f=await prepare(t);const out=await launch(f).promise;terminal(f,out);
 const raw=readFileSync(f.startup,'utf8'), start=JSON.parse(raw);
 assert.equal((await f.confirm()).out.code,0,'快终态不得漏START');
 for(const [name,change] of [
  ['TAG',x=>{x.run_tag='other-tag';x.device.lock_holder=x.run_tag;}],
  ['profile',x=>x.device.profile='other-profile'],['serial',x=>x.device.serial='other-serial'],
  ['line',x=>x.line_key='other'],['keywords',x=>x.keywords[0].word='别的词'],
  ['execution',x=>x.execution={different:true}],['account',x=>x.account.sender_id='other-account'],['capability',x=>x.capability='benchmark_link_acquisition'],
  ['缺profile',x=>delete x.device.profile],['缺serial',x=>delete x.device.serial],['缺账号',x=>delete x.account],
 ]){const input=structuredClone(f.input);change(input);const checked=await f.confirm(input);assert.equal(checked.out.code,1,name);assert.equal(checked.value.status,'failed');}
 assert.equal((await f.confirm(f.input,[],f.startup,randomUUID())).out.code,1,'同TAG旧nonce不能当本次');
 assert.equal((await f.confirm(f.input,[],join(f.home,'missing-start'))).out.code,1);
 const originalContract=readFileSync(f.contract,'utf8');const changed=structuredClone(f.compiled);changed.contract.workflow='other-workflow';writeFileSync(f.contract,JSON.stringify(changed));
 assert.equal((await f.confirm()).out.code,1,'错误契约workflow不能确认');writeFileSync(f.contract,originalContract);
 const altered=structuredClone(f.compiled);altered.contract.activities[0].budget.max_duration_s++;
 writeFileSync(f.contract,JSON.stringify(altered));assert.equal((await f.confirm()).out.code,1,'相同workflow错误契约摘要不能确认');writeFileSync(f.contract,originalContract);
 for(const [name,change] of [['schema',x=>x.schema_version=2],['type',x=>x.event_type='ACTIVITY_STARTED'],['cursor',x=>x.cursor=2],
   ['tag',x=>x.run_tag='wrong'],['workflow',x=>x.workflow='wrong'],['id',x=>x.startup_id=randomUUID()],
   ['at',x=>x.at='not-a-date'],['noTimezone',x=>x.at='2026-10-03T01:00:00'],['badDate',x=>x.at='2026-02-30T00:00:00.000Z'],
   ['contractSHA',x=>x.contract_sha256='0'.repeat(64)],['inputSHA',x=>x.input_sha256='0'.repeat(64)]]){
   const value=structuredClone(start);change(value);writeFileSync(f.startup,JSON.stringify(value));assert.equal((await f.confirm()).out.code,1,name);
 }
 writeFileSync(f.startup,'{');assert.equal((await f.confirm()).out.code,1,'malformed');writeFileSync(f.startup,raw);
 chmodSync(f.startup,0o644);assert.equal((await f.confirm()).out.code,1,'权限必须0600');chmodSync(f.startup,0o600);
 const alias=join(f.home,'symlink-start');symlinkSync(f.startup,alias);assert.equal((await f.confirm(f.input,[],alias)).out.code,1,'symlink不是普通凭证');
 assert.equal((await f.confirm()).out.code,0);
 const second=await cli(entry,[...f.args.slice(0,-1),randomUUID()],{env:f.env,input:f.input});assert.equal(second.code,1,'已有文件必须失败');
 assert.equal(JSON.parse(second.stdout).reason_code,'event_sink_failed');assert.equal(readFileSync(f.startup,'utf8'),raw,'不得覆写同TAG旧START');
});

test('原生真实START不能将错误能力契约确认成keyword_acquisition', {timeout:60000},async t=>{
 const f=await prepare(t,{badCapability:true});
 const out=await nativeStart(f);assert.equal(out.code,0,out.stdout);assert.deepEqual(JSON.parse(out.stdout),JSON.parse(readFileSync(f.receiptPath,'utf8')));
 assert.equal(JSON.parse(readFileSync(f.startup,'utf8')).contract_sha256,sha(f.compiled.contract));
 assert.equal((await f.confirm()).out.code,1,'摘要正确仍必须核业务能力');
});

test('独立确认模式要求显式契约与成对UUID；原运行参数在调用执行器前拒绝', {timeout:60000},async t=>{
 const f=await prepare(t);
 for(const args of [
  ['--confirm-start','--startup-receipt',f.startup,'--startup-id',f.id],
  ['--confirm-start','--contract',f.contract,'--startup-receipt',f.startup],
  ['--confirm-start','--contract',f.contract,'--startup-id',f.id],
  ['--runtime',runtime,'--contract',f.contract,'--startup-receipt',f.startup],
  ['--runtime',runtime,'--contract',f.contract,'--startup-id',f.id],
  [...f.args.slice(0,-1),'bad-id'],[...f.args,'--startup-id',f.id],
  [...f.args.slice(0,6),'--startup-receipt',f.receiptPath,'--startup-id',f.id],
 ]){const out=await cli(entry,args,{env:f.env,input:f.input});assert.equal(out.code,1,JSON.stringify(args));}
 assert.equal(existsSync(join(f.home,'runtime-calls')),false,'非法参数不得启动runtime');assert.equal(existsSync(f.startup),false);
 assert.equal((await f.confirm(f.input,['--bindings','does-not-exist'])).out.code,1,'helper不能编译默认契约');
});

async function nativeStart(f){
 const context={...f.input,videos:[],comments:[],workflow_artifacts:{},return_to_results:true,execution:f.input.execution||{}};
 return cli(runtime,['--cwd',service,'--receipt',f.receiptPath,'--startup-receipt',f.startup,'--startup-id',f.id],
   {env:f.env,input:{contract:f.compiled.contract,input:context}});
}
test('真实benchmark仅引用keyword预检：源cap全keyword仍不能误认根workflow', {timeout:60000},async t=>{
 const f=await prepare(t,{referenceOnly:true});
 assert.ok(f.compiled.contract.activities.every(a=>a.source_contract.capability==='keyword_acquisition'));
 assert.notEqual(f.compiled.contract.workflow,JSON.parse(readFileSync(join(service,'plans/keyword_workflow.contract.json'),'utf8')).contract.workflow);
 const out=await nativeStart(f);assert.equal(out.code,0,out.stdout);
 const checked=await f.confirm();assert.equal(checked.out.code,1,'根workflow不同即使所有活动源cap都是keyword也不得确认');
 assert.equal(checked.value.reason_code,'workflow_capability_mismatch');
 const rejected=await launch(f).promise;assert.equal(rejected.code,1);assert.equal(JSON.parse(rejected.stdout).reason_code,'workflow_capability_mismatch');
 assert.equal(existsSync(join(f.home,'runtime-calls')),false,'错误根workflow在原生执行器前拒绝');
});
