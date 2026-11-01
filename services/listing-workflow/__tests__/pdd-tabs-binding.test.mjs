import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createNativeTransport} from '../pdd-native.mjs';
const commit='a'.repeat(40),candidate=`/Users/operator/.local/share/zenithjoy/phone-candidates/${commit}/runtime/douyin-phone-adb`;
const names=['douyin-phone-adb','phone-lock-lib.sh','phone-lock-helper.py','text-input-focus.py'];
function binding(){const bundle=Object.fromEntries(names.map(n=>[n,'b'.repeat(64)]));return {controllerPath:candidate,controllerReleaseCommit:commit,controllerBundleFiles:bundle,controllerSha256:bundle['douyin-phone-adb'],focusSha256:bundle['text-input-focus.py']};}
function local(t,b){const root=mkdtempSync(join(tmpdir(),'tabs-binding-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const calls=[],bridge={binding:b,host:async(action)=>{calls.push(action);return {ok:true};}};return {calls,native:createNativeTransport({root,allowDraftWrites:true},bridge)};}
test('legacy tabs在本地明确拒绝且host调用0次',async t=>{
 const b=binding();b.controllerPath='/Users/operator/bin-harvest/douyin-phone-adb';delete b.controllerReleaseCommit;delete b.controllerBundleFiles;
 const f=local(t,b);await assert.rejects(f.native.audit('tabs',{approvedScreenSha256:'c'.repeat(64)}),/OWNER_SWIPE_BINDING_UNVERIFIED/);assert.deepEqual(f.calls,[]);
});
const base=new URL('../',import.meta.url).pathname;
test('真实Python legacy tabs在intent或设备effect之前拒绝',()=>{
 const script=`import pathlib,json\ng={'__name__':'test'}\nfor name in ['controller-host.py','pdd-native-ui.py','pdd-audit-navigation.py']:exec(pathlib.Path(${JSON.stringify(base)},name).read_text(),g)\nevents=[];g['store']=lambda *a:events.append('intent');g['control_ok']=lambda *a,**kw:events.append('effect')\nc={'binding':{'controllerPath':'/Users/operator/bin-harvest/douyin-phone-adb'},'owner':'me','lastForegroundRaw':'Window{f6c554e u0 com.xunmeng.merchant/com.xunmeng.merchant.goods_management.GoodsManagementActivity}'}\ns=g['Screen'](pathlib.Path(${JSON.stringify(base+'__tests__/fixtures/pdd-r19-goods-tabs.xml')}).read_text(),1200,2664)\nc['remoteRoot']='/tmp/unused';c['lastFrame']={'xmlSha256':'tree','screenSha256':'pixels','windowRaw':c['lastForegroundRaw']}\nbefore={'path':'before.xml','sha256':'tree'};g['audit_tab_source']=lambda *a:(s,before);g['final_window_guard']=lambda *a,**kw:None;g['observe']=lambda *a:{}\ntry:g['audit_navigation'](c,{'action':'audit-tabs','jobId':'j'},s,before,{});error=None\nexcept Exception as e:error=str(e)\nprint(json.dumps({'error':error,'events':events,'hasIntent':bool(c.get('auditIntents'))}))`;
 const r=spawnSync('python3',['-c',script],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),{error:'OWNER_SWIPE_BINDING_UNVERIFIED',events:[],hasIntent:false});
});
