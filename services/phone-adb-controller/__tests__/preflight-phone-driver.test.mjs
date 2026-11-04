import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';import {createHash} from 'node:crypto';
const root=dirname(new URL('../leadgen-handlers.mjs',import.meta.url).pathname),hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
async function rig(t,trees){
 const {createPreflightPhoneDriver}=await import('../preflight-phone-driver.mjs'),{startPreflightLocalLeaves}=await import('../preflight-local-leaves.mjs');
 const directory=mkdtempSync(join(tmpdir(),'preflight-driver-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const local=await startPreflightLocalLeaves({root,directory,python:{path:'/usr/bin/python3',sha256:hash('/usr/bin/python3')},sourceFiles:{'preflight-local-step.py':hash(join(root,'preflight-local-step.py'))},deadlineMs:Date.now()+10000});t.after(()=>local.close());
 let index=0;const calls=[];const adb=async(...args)=>{calls.push(args);if(args.join(' ')==='shell dumpsys window')return 'mCurrentFocus=Window{abc u0 com.ss.android.ugc.aweme/.MainActivity}\n';if(args[0]==='pull'){writeFileSync(args[2],trees[Math.min(index++,trees.length-1)]);return '';}if(args[0]==='shell'&&['uiautomator','input'].includes(args[1]))return '';throw Error('UNEXPECTED_ADB:'+args.join(' '));};
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
