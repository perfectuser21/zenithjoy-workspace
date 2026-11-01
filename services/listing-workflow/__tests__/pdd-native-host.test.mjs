import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const host=new URL('../controller-host.py',import.meta.url).pathname;
const native=new URL('../pdd-native-host.py',import.meta.url).pathname;
function run(body){const script=`import json,pathlib,tempfile\ng={'__name__':'test'}\nexec(pathlib.Path(${JSON.stringify(host)}).read_text(),g)\nexec(pathlib.Path(${JSON.stringify(native)}).read_text(),g)\n${body}`;const r=spawnSync('python3',['-c',script],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}
test('changed UI after visual approval cannot trigger a native tap',()=>{
 const r=run(`g['context']=lambda *a,**kw:None\ng['control_ok']=lambda *a,**kw:{}\ng['read_evidence']=lambda *a:{'sha256':'approved'}\ng['fresh_xml']=lambda *a:(None,{'sha256':'changed'})\nc={'profile':'pddrun','lastFrame':{'screenSha256':'approved','xmlSha256':'old','at':g['time'].time()}}\ntry:g['native_action'](c,{'action':'navigate','jobId':'job','label':'上传图片','approvedScreenSha256':'approved'})\nexcept ValueError as e:print(json.dumps({'error':str(e)}))`);assert.equal(r.error,'APPROVED_UI_CHANGED');
});
test('owned draft does not authorize back from an unrelated or unknown page',()=>{
 const r=run(`g['context']=lambda *a,**kw:None\nclass Screen:\n def facts(self):return {'form':False,'counts':{},'storeName':None}\ng['fresh_xml']=lambda *a:(Screen(),{'path':'before'})\ntry:g['native_action']({'draft':{'owned':True}},{'action':'back','jobId':'job'})\nexcept ValueError as e:print(json.dumps({'error':str(e)}))`);assert.equal(r.error,'UNOWNED_FORM_BACK_REFUSED');
});
test('device ADB timeout is unknown and never becomes a retryable ordinary failure',()=>{
 const r=run(`g['subprocess'].run=lambda args,**kw:type('R',(),{'stdout':'5037'})() if 'adb-existing-route.py' in str(args) else (_ for _ in ()).throw(g['subprocess'].TimeoutExpired('adb',40))\ntry:g['adb']({'binding':{'controllerPath':'/trusted/controller','serial':'S'},'deadline':g['time'].monotonic()+120},['shell','monkey'])\nexcept Exception as e:print(json.dumps({'error':str(e),'unknown':getattr(e,'remoteUnknown',False)}))`);assert.equal(r.unknown,true);
});

test('an unchanged full screenshot still cannot authorize an overlapped homepage target',()=>{
 const r=run(`g['context']=lambda *a,**kw:None\ng['control_ok']=lambda *a,**kw:{}\ng['read_evidence']=lambda *a:{'sha256':'approved','path':'current'}\nclass S:\n def navigate(self,*a):return {'label':'商品管理','bounds':[1,1,2,2]}\n def homepage_animation_mask(self,*a):raise ValueError('TARGET_OVERLAP_AMBIGUOUS')\ng['fresh_xml']=lambda *a:(S(),{'sha256':'tree','path':'before'})\nc={'profile':'pddrun','ownedMedia':[],'lastFrame':{'screenSha256':'approved','xmlSha256':'tree','at':g['time'].time()}}\ntry:g['native_action'](c,{'action':'navigate','jobId':'job','label':'商品管理','approvedScreenSha256':'approved'})\nexcept ValueError as e:print(json.dumps({'error':str(e)}))`);assert.equal(r.error,'TARGET_OVERLAP_AMBIGUOUS');
});
