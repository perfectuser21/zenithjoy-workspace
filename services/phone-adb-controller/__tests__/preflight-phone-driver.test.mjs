import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';import {createHash} from 'node:crypto';
const root=dirname(new URL('../leadgen-handlers.mjs',import.meta.url).pathname),hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
async function rig(t,trees){
 const {createPreflightPhoneDriver}=await import('../preflight-phone-driver.mjs'),{startPreflightLocalLeaves}=await import('../preflight-local-leaves.mjs');
 const directory=mkdtempSync(join(tmpdir(),'preflight-driver-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const local=await startPreflightLocalLeaves({root,directory,python:{path:'/usr/bin/python3',sha256:hash('/usr/bin/python3')},sourceFiles:{'preflight-local-step.py':hash(join(root,'preflight-local-step.py'))},deadlineMs:Date.now()+10000});t.after(()=>local.close());
 let index=0;const calls=[];const adb=async(...args)=>{calls.push(args);if(args.join(' ')==='shell dumpsys window displays')return 'mCurrentFocus=Window{abc u0 com.ss.android.ugc.aweme/.MainActivity}\n';if(args[0]==='pull'){writeFileSync(args[2],trees[Math.min(index++,trees.length-1)]);return '';}if(args[0]==='shell'&&['uiautomator','input'].includes(args[1]))return '';throw Error('UNEXPECTED_ADB:'+args.join(' '));};
 const driver=createPreflightPhoneDriver({adb,local,evidenceRoot:directory,owner:'fixture_run',profile:'fixture',serial:'SERIAL',model:'MODEL',expectedAccount:'44997267357',deadlineMs:Date.now()+10000,assertResources:async()=>{}});
 return {driver,calls,directory};
}
const fixture=name=>readFileSync(new URL('./fixtures/'+name,import.meta.url),'utf8');
test('parent preflight reads actual own profile and never navigates a foreign/partial profile',{skip:process.platform!=='darwin'},async t=>{
 const r=await rig(t,[fixture('real-0930-own-profile-cold-start.xml')]);const result=await r.driver.run('account-current','fixture_run-account');assert.match(result,/douyin_id=44997267357/);assert.equal(r.calls.some(a=>a.includes('input')),false);
 for(const xml of [fixture('real-0930-foreign-profile-after-dm.xml'),'<hierarchy><node text="抖音号：44997267357"/></hierarchy>']){
  const bad=await rig(t,[xml]);await assert.rejects(()=>bad.driver.run('account-current','fixture_run-account'),/PREFLIGHT_ACCOUNT_NAVIGATION_REFUSED/);assert.equal(bad.calls.some(a=>a.includes('input')||a.includes('monkey')),false);
 }
});
test('parent preflight taps only a single actual Me bound and rechecks landing identity',{skip:process.platform!=='darwin'},async t=>{
 const r=await rig(t,['<hierarchy><node content-desc="我，按钮" bounds="[910,2400][1030,2500]"/></hierarchy>',fixture('real-0930-own-profile-cold-start.xml')]);
 await r.driver.run('account-current','fixture_run-account');assert.deepEqual(r.calls.filter(a=>a.includes('input')),[['shell','input','tap','970','2450']]);
 const bad=await rig(t,['<hierarchy><node content-desc="我，按钮" bounds="[910,2400][1030,2500]"/></hierarchy>',fixture('real-0930-foreign-profile-after-dm.xml')]);await assert.rejects(()=>bad.driver.run('account-current','fixture_run-account'),/PREFLIGHT_ACCOUNT_NAVIGATION_REFUSED/);
});
test('preflight checks actual serial/model/call state before any mutation and refuses busy or wrong targets',async()=>{
 const {createPreflightPhoneDriver}=await import('../preflight-phone-driver.mjs');
 for(const bad of ['none','model','call']){
  const calls=[],adb=async(...args)=>{calls.push(args);return args[0]==='get-state'?'device\n':args.join(' ')==='shell getprop ro.product.model'?(bad==='model'?'WRONG':'MODEL')+'\n':args.join(' ')==='shell dumpsys telephony.registry'?'mCallState='+(bad==='call'?'1':'0')+'\n':'mCurrentFocus=Window{abc u0 com.ss.android.ugc.aweme/.MainActivity}\n';};
  const driver=createPreflightPhoneDriver({adb,local:{},evidenceRoot:'/unused',owner:'fixture_run',profile:'fixture',serial:'SERIAL',model:'MODEL',expectedAccount:'actual',deadlineMs:Date.now()+10000,assertResources:async()=>{}});
  if(bad==='none'){const result=await driver.run('preflight');assert.match(result,/serial=SERIAL/);assert.match(result,/call_state=0/);}
  else await assert.rejects(()=>driver.run('preflight'),/PREFLIGHT_TARGET_MODEL|PREFLIGHT_CALL_NOT_IDLE/);
  assert.equal(calls.some(a=>a.includes('input')||a.includes('monkey')),false);
 }
});
test('account admission reads current displays instead of stale LAST ANR full-window focus',async()=>{
 const {createPreflightPhoneDriver}=await import('../preflight-phone-driver.mjs');const calls=[];
 const driver=createPreflightPhoneDriver({adb:async(...args)=>{calls.push(args);if(args.join(' ')==='shell dumpsys window')return 'LAST ANR mCurrentFocus=Window{old u0 com.ss.android.ugc.aweme/.MainActivity}\n';if(args.join(' ')==='shell dumpsys window displays')return 'mCurrentFocus=Window{new u0 com.other.app/.Home}\n';throw Error('UNEXPECTED_DEVICE_ACTION');},local:{},evidenceRoot:'/unused',owner:'fixture_run',expectedAccount:'actual',deadlineMs:Date.now()+10000,assertResources:async()=>{}});
 await assert.rejects(()=>driver.run('account-current','fixture_run-account'),/PREFLIGHT_ACCOUNT_NAVIGATION_REFUSED/);assert.deepEqual(calls,[['shell','dumpsys','window','displays']]);
});
test('wake and unlock use only fixed checked primitives; lost ownership stops before every device command',async()=>{
 const {createPreflightPhoneDriver}=await import('../preflight-phone-driver.mjs');let lost=false;const calls=[];
 const driver=createPreflightPhoneDriver({adb:async(...a)=>{calls.push(a);return a[0]==='get-state'?'device\n':a.includes('getprop')?'MODEL\n':'';},local:{},evidenceRoot:'/unused',owner:'fixture_run',profile:'fixture',serial:'SERIAL',model:'MODEL',deadlineMs:Date.now()+10000,assertResources:async()=>{if(lost)throw Error('OWNER_LOST');}});
 await driver.run('wake');await driver.run('unlock');assert.deepEqual(calls.filter(a=>a.includes('input')||a.includes('wm')),[['shell','input','keyevent','224'],['shell','input','keyevent','224'],['shell','wm','dismiss-keyguard']]);
 const before=calls.length;lost=true;await assert.rejects(()=>driver.run('wake'),/OWNER_LOST/);assert.equal(calls.length,before);
});
test('cleanup domain only closes its app and verifies actual resolved HOME focus',async()=>{
 const {createPreflightPhoneDriver}=await import('../preflight-phone-driver.mjs'),calls=[];
 const driver=createPreflightPhoneDriver({purpose:'cleanup',adb:async(...a)=>{calls.push(a);return a[0]==='get-state'?'device\n':a.includes('getprop')?'MODEL\n':a.includes('resolve-activity')?'com.hihonor.android.launcher/.Home\n':a.includes('dumpsys')?'mCurrentFocus=Window{abc u0 com.hihonor.android.launcher/.Home}\n':'';},local:{},evidenceRoot:'/unused',owner:'fixture_run',profile:'fixture',serial:'SERIAL',model:'MODEL',deadlineMs:Date.now()+10000,assertResources:async()=>{}});
 assert.match(await driver.run('close-app'),/foreground=.*com.hihonor.android.launcher/);assert.match(await driver.run('return-safe-desktop'),/foreground_package=com.hihonor.android.launcher/);
 assert.deepEqual(calls.filter(a=>a.includes('force-stop')||a.includes('input')),[['shell','am','force-stop','com.ss.android.ugc.aweme'],['shell','input','keyevent','3']]);
});
test('snapshot evidence is pulled by owned primitives into the bound run path, invalid PNG refuses',async t=>{
 const {createPreflightPhoneDriver}=await import('../preflight-phone-driver.mjs');const dir=mkdtempSync(join(tmpdir(),'preflight-png-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const png=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360606060000000050001a5f645400000000049454e44ae426082','hex');let bad=false;
 const driver=createPreflightPhoneDriver({purpose:'cleanup',adb:async(...a)=>{if(a[0]==='pull')writeFileSync(a[2],bad?Buffer.from('invalid'):png);return '';},local:{},evidenceRoot:dir,owner:'fixture_run',deadlineMs:Date.now()+10000,assertResources:async()=>{}});
 const path=await driver.run('snapshot-evidence','fixture_run-desktop');assert.equal(path.trim(),join(dir,'fixture_run-desktop.png'));assert.deepEqual(readFileSync(path.trim()),png);
 bad=true;await assert.rejects(()=>driver.run('snapshot-evidence','fixture_run-invalid'),/PREFLIGHT_PNG_INVALID/);
});
test('open-app is an explicit checked operation; account reader never silently launches an app',async()=>{
 const {createPreflightPhoneDriver}=await import('../preflight-phone-driver.mjs'),calls=[];
 const driver=createPreflightPhoneDriver({adb:async(...a)=>{calls.push(a);return a[0]==='get-state'?'device\n':a.includes('getprop')?'MODEL\n':a.includes('dumpsys')?'mCurrentFocus=Window{abc u0 com.ss.android.ugc.aweme/.MainActivity}\n':'';},local:{},evidenceRoot:'/unused',owner:'fixture_run',profile:'fixture',serial:'SERIAL',model:'MODEL',deadlineMs:Date.now()+10000,assertResources:async()=>{}});
 assert.match(await driver.run('open-app'),/foreground=.*com.ss.android.ugc.aweme/);assert.deepEqual(calls.filter(a=>a.includes('monkey')),[['shell','monkey','-p','com.ss.android.ugc.aweme','-c','android.intent.category.LAUNCHER','1']]);
});
test('cleanup rejects a historical launcher name when the actual current package is another app',async()=>{
 const {createPreflightPhoneDriver}=await import('../preflight-phone-driver.mjs');
 const driver=createPreflightPhoneDriver({purpose:'cleanup',adb:async(...a)=>a[0]==='get-state'?'device\n':a.includes('getprop')?'MODEL\n':a.includes('resolve-activity')?'com.hihonor.android.launcher/.Home\n':a.includes('dumpsys')?'mCurrentFocus=Window{current u0 com.other.app/.Screen}\noldWindow com.hihonor.android.launcher/.Home\n':'',local:{},evidenceRoot:'/unused',owner:'fixture_run',model:'MODEL',deadlineMs:Date.now()+10000,assertResources:async()=>{}});
 await assert.rejects(()=>driver.run('return-safe-desktop'),/PREFLIGHT_CLEANUP_HOME/);
});
test('new preflight PNG validation rejects intact signatures with corrupted CRC or truncated image rows',async()=>{
 const {assertPreflightPng}=await import('../preflight-phone-driver.mjs');
 const png=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360606060000000050001a5f645400000000049454e44ae426082','hex');assert.deepEqual(assertPreflightPng(png),{width:1,height:1});const bad=Buffer.from(png);bad[48]^=1;assert.throws(()=>assertPreflightPng(bad),/PREFLIGHT_PNG_INVALID/);
});
