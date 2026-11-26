import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {mkdtempSync,readFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const load=()=>import('../device-epoch-fence-diagnostics.mjs');
const frame=(id,data)=>{const b=Buffer.alloc(5);b[0]=id;b.writeUInt32LE(data.length,1);return Buffer.concat([b,data]);};
async function fixture(mode='ok'){
 const services=[],server=createServer(s=>{let buffer=Buffer.alloc(0),phase=0;s.on('error',()=>{});s.on('data',b=>{buffer=Buffer.concat([buffer,b]);while(buffer.length>=4){
  if(phase===2){buffer=Buffer.alloc(0);return;}
  const n=parseInt(buffer.subarray(0,4).toString(),16);if(!Number.isInteger(n)||buffer.length<4+n)return;
  const service=buffer.subarray(4,4+n).toString();buffer=buffer.subarray(4+n);services.push(service);
  if(service.endsWith(':features')){s.end('OKAY0008shell_v2');return;}
  if(phase===0){phase=1;s.write('OKAY');continue;}
  phase=2;const wire=Buffer.concat([Buffer.from('OKAY'),frame(1,Buffer.from('31\n')),...(mode==='missing-exit'?[]:[frame(3,Buffer.from([0]))]),...(mode==='trailing'?[Buffer.from('x')]:[])]);s.end(wire);
 }});});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 return {services,endpoint:`tcp:127.0.0.1:${server.address().port}`,close:()=>new Promise(r=>server.close(r))};
}
for(const mode of ['ok','missing-exit','trailing'])test(`固定只读诊断 ${mode} 保留 wire，且不签历史停止`,async()=>{
 const {runDiagnostic}=await load(),f=await fixture(mode),dir=mkdtempSync(join(realpathSync(tmpdir()),'fence-diag-'));let reads=0;
 const scope={endpoint:f.endpoint,serial:'47.100.213.173:10001',maintenance_task_id:'1b0c2057-e381-4c65-bce5-bc93774fcf04'};
 try{const result=await runDiagnostic({query:'sdk',scope,directory:dir,readAuthority:async()=>{reads++;return {scope,lease_until:new Date(Date.now()+60000).toISOString()};}});
 assert.equal(result.wire_complete,mode==='ok');assert.equal(result.original_execution_stopped,false);assert.equal(result.remote_quiescence,'unknown');assert.ok(reads>=2);
 assert.deepEqual(f.services,['host-serial:47.100.213.173:10001:features','host:transport:47.100.213.173:10001','shell,v2,raw:exec /system/bin/getprop ro.build.version.sdk']);
 assert.ok(readFileSync(join(dir,'socket-1.raw')).length);const terminal=JSON.parse(readFileSync(join(dir,'diagnostic.json')));assert.equal(terminal.pending,0);assert.equal(terminal.open_sockets,0);
 }finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});
test('调用者不能注入命令或修改远端，authority 不符不得连接',async()=>{
 const {runDiagnostic,DIAGNOSTIC_COMMANDS}=await load();assert.deepEqual(Object.keys(DIAGNOSTIC_COMMANDS),['sdk','boot_id','processes','input','activity','window']);
 for(const v of Object.values(DIAGNOSTIC_COMMANDS))assert.ok(!/\b(?:input (?:tap|keyevent)|monkey|rm|connect|disconnect)\b/.test(v));
 const directory=mkdtempSync(join(realpathSync(tmpdir()),'fence-noauth-'));try{
 await assert.rejects(runDiagnostic({query:'exec reboot',scope:{},directory,readAuthority:async()=>({})}),/DIAGNOSTIC_QUERY/);
 const result=await runDiagnostic({query:'sdk',scope:{endpoint:'tcp:127.0.0.1:1',serial:'x',maintenance_task_id:'1b0c2057-e381-4c65-bce5-bc93774fcf04'},directory,readAuthority:async()=>({})});assert.equal(result.wire_complete,false);assert.equal(result.error_code,'DIAGNOSTIC_AUTHORITY');
 }finally{rmSync(directory,{recursive:true,force:true});}
});
test('旧listener PID/start换代在下一connect/write前拒绝，不再发命令',async()=>{
 const {runDiagnostic}=await load(),f=await fixture(),directory=mkdtempSync(join(realpathSync(tmpdir()),'fence-daemon-'));let reads=0;const scope={endpoint:f.endpoint,serial:'47.100.213.173:10001',maintenance_task_id:'1b0c2057-e381-4c65-bce5-bc93774fcf04',old_daemon:{pid:91186,start_identity:'old'}};
 try{const result=await runDiagnostic({query:'sdk',scope,directory,readAuthority:async()=>({scope:++reads>=3?{...scope,old_daemon:{pid:91187,start_identity:'new'}}:scope,lease_until:new Date(Date.now()+60000).toISOString()})});assert.equal(result.wire_complete,false);assert.equal(result.error_code,'DIAGNOSTIC_AUTHORITY');assert.deepEqual(f.services,['host-serial:47.100.213.173:10001:features']);}finally{await f.close();rmSync(directory,{recursive:true,force:true});}
});
test('authority读回期间已收到EXIT/EOF仍正确收回，不把可选CloseStdin当失败',async()=>{
 const {runDiagnostic}=await load(),f=await fixture(),directory=mkdtempSync(join(realpathSync(tmpdir()),'fence-eof-'));const scope={endpoint:f.endpoint,serial:'47.100.213.173:10001',maintenance_task_id:'1b0c2057-e381-4c65-bce5-bc93774fcf04'};
 try{const r=await runDiagnostic({query:'sdk',scope,directory,readAuthority:async()=>{await new Promise(r=>setTimeout(r,15));return {scope,lease_until:new Date(Date.now()+60000).toISOString()};}});assert.equal(r.wire_complete,true);assert.equal(r.exit_code,0);}finally{await f.close();rmSync(directory,{recursive:true,force:true});}
});
test('云机身份读回等待已收到 EXIT 后的有效权属复核', async () => {
 const {readEpochDeviceIdentity}=await import('../device-epoch-fence-admission.mjs');
 const f=await fixture(), directory=mkdtempSync(join(realpathSync(tmpdir()),'fence-cloud-identity-'));
 const scope={endpoint:f.endpoint,serial:'127.0.0.1:15555',maintenance_task_id:'1b0c2057-e381-4c65-bce5-bc93774fcf04'};
 let delayed=false;
 try {
  const serial=await readEpochDeviceIdentity({query:'hardware_serial',scope,directory,readAuthority:async()=>{
   if (!delayed && f.services.some(service=>service.startsWith('shell,v2,raw:'))) {
    delayed=true;
    await delay(5250);
   }
   return {scope,lease_until:new Date(Date.now()+60000).toISOString()};
  }});
  assert.equal(delayed,true);
  assert.equal(serial,'31');
  const result=JSON.parse(readFileSync(join(directory,'diagnostic.json')));
  assert.equal(result.wire_complete,true);
  assert.equal(result.open_sockets,0);
  assert.equal(result.pending,0);
 } finally {
  await f.close();
  rmSync(directory,{recursive:true,force:true});
 }
});
test('云机身份读回遵守外层已到期的准入期限', async () => {
 const {readEpochDeviceIdentity}=await import('../device-epoch-fence-admission.mjs');
 const f=await fixture(), directory=mkdtempSync(join(realpathSync(tmpdir()),'fence-cloud-budget-'));
 const scope={endpoint:f.endpoint,serial:'127.0.0.1:15555',maintenance_task_id:'1b0c2057-e381-4c65-bce5-bc93774fcf04'};
 try {
  await assert.rejects(readEpochDeviceIdentity({query:'hardware_serial',scope,directory,
   readBudget:{deadlineMs:Date.now()-1},readAuthority:async()=>{throw Error('unexpected authority read');}
  }),{code:'EPOCH_ADMISSION_DEADLINE'});
  assert.deepEqual(f.services,[]);
 } finally {
  await f.close();
  rmSync(directory,{recursive:true,force:true});
 }
});
test('补充诊断固定只读活动与元数据；proc路径仅接受维护scope整数PID',async()=>{
 const {compileDiagnosticCommand,SUPPLEMENTAL_DIAGNOSTIC_COMMANDS,PROCESS_DIAGNOSTIC_COMMANDS}=await load();
 assert.equal(compileDiagnosticCommand('activity_starter',{}),'exec /system/bin/dumpsys activity starter');
 assert.match(SUPPLEMENTAL_DIAGNOSTIC_COMMANDS.exit_guardian_metadata,/^exec \/system\/bin\/toybox sha256sum /);
 for(const q of Object.keys(PROCESS_DIAGNOSTIC_COMMANDS)){const command=compileDiagnosticCommand(q,{diagnostic_process_pid:195});assert.match(command,/\/proc\/195\//);assert.ok(!command.includes('environ'));for(const bad of ['195;reboot',0,-1,1.1,undefined])assert.throws(()=>compileDiagnosticCommand(q,{diagnostic_process_pid:bad}),/DIAGNOSTIC_PROCESS_PID/);}
 assert.throws(()=>compileDiagnosticCommand('cat /proc/195/environ',{}),/DIAGNOSTIC_QUERY/);
});
test('不完整补采JSON不能以CLI exit0被误认作成功；单query仍固定枚举',async()=>{
 const {diagnosticExitCode,validateDiagnosticQuery}=await import('../device-epoch-fence-review.mjs');assert.equal(diagnosticExitCode({diagnostics:[{wire_complete:false,exit_code:null}]}),2);assert.equal(diagnosticExitCode({diagnostics:[{wire_complete:true,exit_code:1}]}),2);assert.equal(diagnosticExitCode({diagnostics:[{wire_complete:true,exit_code:0}]}),0);assert.equal(validateDiagnosticQuery('exit_guardian_metadata'),'exit_guardian_metadata');assert.throws(()=>validateDiagnosticQuery('sh -c reboot'),/DIAGNOSTIC_QUERY/);
});
