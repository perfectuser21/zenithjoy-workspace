import test from'node:test';import assert from'node:assert/strict';import{spawnSync}from'node:child_process';
const files=['controller-host.py','pdd-media-picker.py','pdd-gallery-actions.py'].map(x=>new URL('../'+x,import.meta.url).pathname);
function run(mode){const script=`import pathlib,json,tempfile,base64
h={'__name__':'test'}
for p in ${JSON.stringify(files)}:exec(pathlib.Path(p).read_text(),h)
with tempfile.TemporaryDirectory() as t:
 mode=${JSON.stringify(mode)};calls=[];errors=[];menu=mode!='closed-stuck';window='com.xunmeng.merchant/MultiGraphSelectorNewActivity'
 c={'owner':'owner','remoteRoot':t,'draft':{'owned':True,'owner':'owner','values':{},'formWindow':'owned-form'},'binding':{'width':1200,'height':2664},'ownedMedia':[{'mediaId':'1'},{'mediaId':'2'},{'mediaId':'3'}],'phoneAlbum':{'name':'owned'},'lastForegroundRaw':window}
 class Picker:
  def gallery_control(self,*a):return {'bounds':[0,121,1173,267]}
  def gallery_images(self,*a):return [{'selectedNumber':None} for i in range(3)]
 h['picker_current']=lambda *a:('com.xunmeng.merchant',Picker(),{'path':'before.xml','sha256':'tree'},{'path':'before.png','sha256':'approved'})
 h['gallery_menu_is_open']=lambda *a:menu
 h['owned_album_inventory']=lambda *a:c['phoneAlbum'];h['final_window_guard']=lambda *a,**kw:None
 class Form:
  def form(self):return True
  def field(self,key):return {'value':'1' if key=='inventory' else ''}
  def empty_carousel(self):return {'template':'empty'}
 h['Screen']=lambda *a:Form();h['PickerTree']=lambda *a:Picker()
 def control(c,command,args,job,**kw):
  saved=json.loads((pathlib.Path(t)/'config.json').read_text());assert saved['pendingPicker']['action']=='gallery-back';calls.append(command)
  if mode=='unknown':
   error=ValueError('LOST_BACK');error.remoteUnknown=True;raise error
  return {'status':'finished','exitCode':0,'remoteUnknown':False}
 h['control_ok']=control;h['expect_context_transition']=lambda *a,**kw:None
 def observe(c,q):
  global menu
  role='gallery' if mode in {'two-phases','closed-stuck'} and len(calls)==1 else 'form'
  if role=='gallery':menu=False
  return {'package':'com.xunmeng.merchant','foregroundRaw':window if role=='gallery' else 'owned-form','facts':{'form':role=='form'},'tree':{'path':'after.xml','sha256':'after','bytesBase64':base64.b64encode(b'<hierarchy/>').decode()},'picture':{'path':'after.png','sha256':'after'}}
 h['observe']=observe
 for i in range(2):
  try:r=h['gallery_action'](c,{'action':'gallery-back','jobId':'job'+str(i),'approvedScreenSha256':'approved'})
  except Exception as e:errors.append(str(e));continue
  if r.get('status')=='owned-form-returned':break
 print(json.dumps({'calls':calls,'errors':errors,'history':c.get('galleryBackCleanup',[]),'pending':c.get('pendingPicker')}))
`;
const r=spawnSync('python3',['-c',script],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}
test('R17 overlapping album title cannot turn cleanup into a coordinate tap; first hardware back may directly return form',()=>{const r=run('direct-form');assert.deepEqual(r.calls,['back']);assert.equal(r.history.length,1);assert.equal(r.history[0].outcome,'owned-form');assert.equal(r.pending,null);});
test('only a proven menu-close in the same gallery permits one second independently persisted hardware back',()=>{const r=run('two-phases');assert.deepEqual(r.calls,['back','back']);assert.deepEqual(r.history.map(x=>x.outcome),['menu-closed','owned-form']);assert.equal(r.pending,null);});
test('an unknown back cannot be dispatched again',()=>{const r=run('unknown');assert.deepEqual(r.calls,['back']);assert.ok(r.pending);});
test('a back from a closed gallery which did not leave cannot be dispatched again',()=>{const r=run('closed-stuck');assert.deepEqual(r.calls,['back']);assert.ok(r.pending);});
