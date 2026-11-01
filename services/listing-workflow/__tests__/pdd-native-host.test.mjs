import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const host=new URL('../controller-host.py',import.meta.url).pathname;
const native=new URL('../pdd-native-host.py',import.meta.url).pathname;
function run(body){const script=`import json,pathlib,tempfile\ng={'__name__':'test'}\nexec(pathlib.Path(${JSON.stringify(host)}).read_text(),g)\nexec(pathlib.Path(${JSON.stringify(native)}).read_text(),g)\n${body}`;const r=spawnSync('python3',['-c',script],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}
test('changed UI after visual approval cannot trigger a native tap',()=>{
 const r=run(`g['context']=lambda *a,**kw:g['fresh_xml'](a[0],a[1])\ng['control_ok']=lambda *a,**kw:{}\ng['read_evidence']=lambda *a:{'sha256':'approved'}\ng['fresh_xml']=lambda *a:(None,{'sha256':'changed'})\nc={'profile':'pddrun','lastFrame':{'screenSha256':'approved','xmlSha256':'old','at':g['time'].time()}}\ntry:g['native_action'](c,{'action':'navigate','jobId':'job','label':'上传图片','approvedScreenSha256':'approved'})\nexcept ValueError as e:print(json.dumps({'error':str(e)}))`);assert.equal(r.error,'APPROVED_UI_CHANGED');
});
test('owned draft does not authorize back from an unrelated or unknown page',()=>{
 const r=run(`g['context']=lambda *a,**kw:g['fresh_xml'](a[0],a[1])\nclass Screen:\n def facts(self):return {'form':False,'counts':{},'storeName':None}\ng['fresh_xml']=lambda *a:(Screen(),{'path':'before'})\ntry:g['native_action']({'draft':{'owned':True}},{'action':'back','jobId':'job'})\nexcept ValueError as e:print(json.dumps({'error':str(e)}))`);assert.equal(r.error,'UNOWNED_FORM_BACK_REFUSED');
});
test('device ADB timeout is unknown and never becomes a retryable ordinary failure',()=>{
 const r=run(`g['subprocess'].run=lambda args,**kw:type('R',(),{'stdout':'5037'})() if 'adb-existing-route.py' in str(args) else (_ for _ in ()).throw(g['subprocess'].TimeoutExpired('adb',40))\ntry:g['adb']({'binding':{'controllerPath':'/trusted/controller','serial':'S'},'deadline':g['time'].monotonic()+120},['shell','monkey'])\nexcept Exception as e:print(json.dumps({'error':str(e),'unknown':getattr(e,'remoteUnknown',False)}))`);assert.equal(r.unknown,true);
});

test('an unchanged full screenshot still cannot authorize an overlapped homepage target',()=>{
 const r=run(`g['context']=lambda *a,**kw:g['fresh_xml'](a[0],a[1])\ng['control_ok']=lambda *a,**kw:{}\ng['read_evidence']=lambda *a:{'sha256':'approved','path':'current'}\nclass S:\n def navigate(self,*a):return {'label':'商品管理','bounds':[1,1,2,2]}\n def homepage_animation_mask(self,*a):raise ValueError('TARGET_OVERLAP_AMBIGUOUS')\ng['fresh_xml']=lambda *a:(S(),{'sha256':'tree','path':'before'})\nc={'profile':'pddrun','ownedMedia':[],'lastFrame':{'screenSha256':'approved','xmlSha256':'tree','at':g['time'].time()}}\ntry:g['native_action'](c,{'action':'navigate','jobId':'job','label':'商品管理','approvedScreenSha256':'approved'})\nexcept ValueError as e:print(json.dumps({'error':str(e)}))`);assert.equal(r.error,'TARGET_OVERLAP_AMBIGUOUS');
});

test('navigation waits for a lagging native tree without dispatching another tap',()=>{const r=run(`calls=[]\nclass S:\n def __init__(self,ready):self.ready=ready\n def labels(self,*a):return [1] if self.ready else []\n def facts(self):return {'counts':{'在售中':47}}\n def form(self):return self.ready\ndef fresh(*a):\n calls.append(1);return S(len(calls)>1),{'path':'tree'+str(len(calls))}\ng['fresh_xml']=fresh;g['time'].sleep=lambda *a:None\ns,e=g['navigation_destination']({},'商品管理','job');print(json.dumps({'reads':len(calls),'path':e['path']}))`);assert.deepEqual(r,{reads:2,path:'tree2'});});

test('a foreground switch after screenshot approval is rejected before any native effect',()=>{const r=run(`g['held']=lambda c:None\ng['current_package']=lambda *a:'com.other.app'\ntry:g['final_window_guard']({'lastFrame':{'windowRaw':'approved'}},'job','tree')\nexcept ValueError as e:print(json.dumps({'error':str(e)}))`);assert.equal(r.error,'FINAL_WINDOW_CHANGED');});

test('an unapproved new form cannot release its lease until the empty form exit is observed',()=>{const r=run(`g['held']=lambda c:None\ntry:g['phone_cleanup']({'expectNewForm':True,'ownedMedia':[]})\nexcept ValueError as e:print(json.dumps({'error':str(e)}))`);assert.equal(r.error,'EMPTY_FORM_CLEANUP_REQUIRED');});

test('one session cannot reuse a previous empty-form exit for another new form',()=>{const r=run(`g['context']=lambda *a,**kw:g['fresh_xml'](a[0],a[1])\ntry:g['native_action']({'newFormEntryIntent':{'jobId':'first'},'emptyFormExitedVerified':True},{'action':'navigate','label':'发布商品','jobId':'second'})\nexcept ValueError as e:print(json.dumps({'error':str(e)}))`);assert.equal(r.error,'NEW_FORM_ALREADY_ATTEMPTED');});
test('a pending empty-form back is reconciled rather than sent a second time',()=>{const r=run(`g['context']=lambda *a,**kw:g['fresh_xml'](a[0],a[1])\nclass S:\n def facts(self):return {'form':True,'counts':{},'storeName':None}\n def field(self,key):return {'value':'1' if key=='inventory' else ''}\ng['fresh_xml']=lambda *a:(S(),{'path':'before','sha256':'tree'})\ntry:g['native_action']({'expectNewForm':True,'ownedMedia':[],'emptyFormBackIntent':{'jobId':'first'}},{'action':'back','jobId':'second'})\nexcept ValueError as e:print(json.dumps({'error':str(e)}))`);assert.equal(r.error,'EMPTY_FORM_EXIT_REQUIRES_READBACK');});
