import test from 'node:test';import assert from 'node:assert/strict';
const implementation=await import('../native-phone-preflight-adapter.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
test('原preflight adb签名需要有限原生命令适配入口',()=>assert.equal(typeof implementation.createNativePhonePreflightAdapter,'function'));
import {mkdtempSync,rmSync,readFileSync,lstatSync,writeFileSync,symlinkSync,realpathSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';import {createHash,randomUUID} from 'node:crypto';
import {createPreflightPhoneDriver} from '../preflight-phone-driver.mjs';import {startPreflightLocalLeaves} from '../preflight-local-leaves.mjs';import {preflightTestPython} from './helpers/preflight-test-python.mjs';
const png=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360606060000000050001a5f645400000000049454e44ae426082','hex');
const own=readFileSync(new URL('./fixtures/real-0930-own-profile-cold-start.xml',import.meta.url));
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
function fixture(t,{purpose='preflight',width=1080,height=2560,trees=[own]}={}){
 const evidenceRoot=realpathSync(mkdtempSync(join(tmpdir(),'native-preflight-adapter-')));t.after(()=>rmSync(evidenceRoot,{recursive:true,force:true}));
 const context={owner:'fixture_owner',evidenceRoot,purpose,width,height,deadlineMs:Date.now()+20000},calls=[],hostCalls=[],reads=[];let focus='com.ss.android.ugc.aweme/.MainActivity',index=0,commandError,readError,nonzero=false;
 const io={command:async(operation,args)=>{calls.push({operation,args});if(commandError)throw commandError;let text=operation==='model'?'MODEL\n':operation==='telecom'?'mCallState=0\n':operation==='home-resolve'?'com.fixture.launcher/.Home\n':'';if(operation==='close-app'||operation==='keyevent')focus='com.fixture.launcher/.Home';if(['foreground','window'].includes(operation))text='mCurrentFocus=Window{abc u0 '+focus+'}\n';return {code:nonzero?1:0,stdout:Buffer.from(text),stderr:Buffer.alloc(0),reviewed_command_returned:true};},readEvidence:async remote=>{reads.push(remote);if(readError)throw readError;return remote.endsWith('.png')?png:trees[Math.min(index++,trees.length-1)];}};
 const adapter=implementation.createNativePhonePreflightAdapter({context,io,hostAdb:async(...args)=>{hostCalls.push(args);return args[0]==='version'?'Android Debug Bridge version 1.0.41\n':'device\n';}});
 const driver=local=>createPreflightPhoneDriver({...context,adb:adapter.adb,local,profile:'fixture',serial:'SERIAL',model:'MODEL',expectedAccount:'44997267357',assertResources:async()=>{}});
 return {context,adapter,driver,io,calls,hostCalls,reads,failCommand:error=>commandError=error,failRead:error=>readError=error,setNonzero:()=>nonzero=true};
}
async function local(t){const directory=mkdtempSync(join(tmpdir(),'native-preflight-ui-')),root=dirname(new URL('../preflight-local-leaves.mjs',import.meta.url).pathname);t.after(()=>rmSync(directory,{recursive:true,force:true}));const leaves=await startPreflightLocalLeaves({root,directory,python:{path:preflightTestPython,sha256:hash(preflightTestPython)},sourceFiles:{'preflight-local-step.py':hash(join(root,'preflight-local-step.py'))},deadlineMs:Date.now()+20000});t.after(()=>leaves.close());return leaves;}
test('原driver通过适配器执行型号/通话/唤醒/解锁/monkey、原XML账户独立解析和证据发布',async t=>{
 const r=fixture(t),d=r.driver(await local(t));assert.match(await r.adapter.adb('version'),/1\.0\.41/);
 assert.match(await d.run('preflight'),/call_state=0/);await d.run('wake');await d.run('unlock');await d.run('open-app');
 const result=await d.run('account-current','fixture_owner-account');assert.match(result,/douyin_id=44997267357/);assert.deepEqual(readFileSync(join(r.context.evidenceRoot,'fixture_owner-account-profile.xml')),own);
 assert.ok(r.calls.some(c=>c.operation==='open-app'));assert.deepEqual(r.calls.filter(c=>['wake','unlock'].includes(c.operation)).map(c=>c.operation),['wake','wake','unlock']);assert.equal(r.reads.length,1);assert.equal(r.calls.some(c=>c.operation==='tap'),false);
});
test('原driver鲜UI我按钮导航后重新解析身份，foreign拒绝仍保原现场',async t=>{
 const r=fixture(t,{trees:[Buffer.from('<hierarchy><node content-desc="我，按钮" bounds="[910,2400][1030,2500]"/></hierarchy>'),own]}),d=r.driver(await local(t));await d.run('account-current','fixture_owner-account');assert.deepEqual(r.calls.filter(c=>c.operation==='tap'),[{operation:'tap',args:['970','2450']}]);assert.equal(r.reads.length,2);
 const bad=fixture(t,{trees:[readFileSync(new URL('./fixtures/real-0930-foreign-profile-after-dm.xml',import.meta.url))]});await assert.rejects(bad.driver(await local(t)).run('account-current','fixture_owner-account'),/PREFLIGHT_ACCOUNT_NAVIGATION_REFUSED/);assert.equal(bad.calls.some(c=>['tap','open-app'].includes(c.operation)),false);
});
test('原cleanup独立检查launcher，PNG经实际本地O_EXCL写入并校验原尺寸',async t=>{
 const r=fixture(t,{purpose:'cleanup',width:1,height:1}),d=r.driver({});assert.match(await d.run('close-app'),/com.fixture.launcher/);assert.match(await d.run('return-safe-desktop'),/foreground_package=com.fixture.launcher/);
 const path=(await d.run('snapshot-evidence','fixture_owner-screen')).trim();assert.deepEqual(readFileSync(path),png);assert.equal(lstatSync(path).mode&0o777,0o600);assert.ok(r.calls.some(c=>c.operation==='screenshot-file'));assert.ok(r.calls.some(c=>c.operation==='keyevent'&&c.args[0]==='3'));
});
test('非精确命令、其他owner路径、未生产remote、过界tap均0IO拒绝',async t=>{
 const r=fixture(t),remote='/sdcard/preflight-'+randomUUID()+'.xml';
 for(const args of [['shell','sh','-c','id'],['shell','monkey','-p','other','-c','android.intent.category.LAUNCHER','1'],['shell','input','tap','1080','2'],['shell','input','tap','01','2'],['shell','input','keyevent','4'],['shell','uiautomator','dump','/sdcard/other.xml'],['pull',remote,join(r.context.evidenceRoot,'other_owner-x-'+randomUUID()+'.xml')],['-s','OTHER','get-state'],['get-state','extra']])await assert.rejects(r.adapter.adb(...args),/NATIVE_PREFLIGHT_ADAPTER_/);
 assert.equal(r.calls.length+r.hostCalls.length+r.reads.length,0);
});
test('自产remote一次消费、目标存在或软链零RECV，已拉文件不覆盖',async t=>{
 const r=fixture(t),remote='/sdcard/preflight-'+randomUUID()+'.xml',path=join(r.context.evidenceRoot,'fixture_owner-ui-'+randomUUID()+'.xml');await r.adapter.adb('shell','uiautomator','dump',remote);writeFileSync(path,'original');await assert.rejects(r.adapter.adb('pull',remote,path),/EXISTS/);assert.equal(r.reads.length,0);assert.equal(readFileSync(path,'utf8'),'original');
 const link=join(r.context.evidenceRoot,'fixture_owner-ui-'+randomUUID()+'.xml');symlinkSync(path,link);await assert.rejects(r.adapter.adb('pull',remote,link),/EXISTS/);assert.equal(r.reads.length,0);
 const fresh=join(r.context.evidenceRoot,'fixture_owner-ui-'+randomUUID()+'.xml');await r.adapter.adb('pull',remote,fresh);assert.deepEqual(readFileSync(fresh),own);assert.equal(lstatSync(fresh).mode&0o777,0o600);await assert.rejects(r.adapter.adb('pull',remote,join(r.context.evidenceRoot,'fixture_owner-ui-'+randomUUID()+'.xml')),/PULL_SCOPE/);await assert.rejects(r.adapter.adb('shell','uiautomator','dump',remote),/REMOTE_SCOPE/);assert.equal(r.reads.length,1);
});
test('通道未知后不重投不追加设备读；已返回非零退出保持已知失败',async t=>{
 const r=fixture(t);r.failCommand(Error('UNKNOWN_WIRE'));await assert.rejects(r.adapter.adb('shell','getprop','ro.product.model'),/UNKNOWN_WIRE/);await assert.rejects(r.adapter.adb('get-state'),/UNKNOWN/);assert.equal(r.calls.length,1);assert.equal(r.hostCalls.length,0);
 const known=fixture(t);known.setNonzero();await assert.rejects(known.adapter.adb('shell','getprop','ro.product.model'),/COMMAND_EXIT/);assert.equal(known.adapter.snapshot().unknown,false);assert.equal(await known.adapter.adb('get-state'),'device\n');
 const read=fixture(t),remote='/sdcard/preflight-'+randomUUID()+'.xml';await read.adapter.adb('shell','uiautomator','dump',remote);read.failRead(Error('RECV_UNKNOWN'));await assert.rejects(read.adapter.adb('pull',remote,join(read.context.evidenceRoot,'fixture_owner-ui-'+randomUUID()+'.xml')),/RECV_UNKNOWN/);await assert.rejects(read.adapter.adb('shell','getprop','ro.product.model'),/UNKNOWN/);assert.equal(read.calls.length,1);
});
test('RECV后的排他目标竞态不覆盖；大包及Worker样式JSON不能充当bytes',async t=>{
 const raced=fixture(t),remote='/sdcard/preflight-'+randomUUID()+'.xml',path=join(raced.context.evidenceRoot,'fixture_owner-ui-'+randomUUID()+'.xml');await raced.adapter.adb('shell','uiautomator','dump',remote);raced.io.readEvidence=async()=>{writeFileSync(path,'racer');return own;};await assert.rejects(raced.adapter.adb('pull',remote,path),/EXISTS/);assert.equal(readFileSync(path,'utf8'),'racer');
 for(const invalid of [Buffer.alloc(5*1024*1024+1),{bytes:own,reviewed_command_returned:true}]){const r=fixture(t),source='/sdcard/preflight-'+randomUUID()+'.xml';await r.adapter.adb('shell','uiautomator','dump',source);r.io.readEvidence=async()=>invalid;await assert.rejects(r.adapter.adb('pull',source,join(r.context.evidenceRoot,'fixture_owner-ui-'+randomUUID()+'.xml')),/RECV/);assert.equal(r.adapter.snapshot().unknown,true);await assert.rejects(r.adapter.adb('get-state'),/UNKNOWN/);}
});
test('并发未返RECV时不接新动作，seal后不发布文件或补手机读',async t=>{
 const r=fixture(t),remote='/sdcard/preflight-'+randomUUID()+'.xml',path=join(r.context.evidenceRoot,'fixture_owner-ui-'+randomUUID()+'.xml');await r.adapter.adb('shell','uiautomator','dump',remote);let release,arrived;const held=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>arrived=resolve);r.io.readEvidence=async()=>{arrived();await held;return own;};const pull=r.adapter.adb('pull',remote,path),rejected=assert.rejects(pull,/CLOSED/);await ready;await assert.rejects(r.adapter.adb('get-state'),/BUSY/);r.adapter.seal();release();await rejected;assert.throws(()=>lstatSync(path),/ENOENT/);assert.equal(r.hostCalls.length,0);assert.equal(r.adapter.snapshot().remote_execution_stopped,'not_attested');
});
test('不承认未经过Code检查的command结果，错误后不准后续host/device调用',async t=>{
 const r=fixture(t);r.io.command=async()=>({code:0,stdout:Buffer.from('MODEL'),stderr:Buffer.alloc(0)});await assert.rejects(r.adapter.adb('shell','getprop','ro.product.model'),/COMMAND_RESULT/);await assert.rejects(r.adapter.adb('get-state'),/UNKNOWN/);assert.equal(r.hostCalls.length,0);
});
