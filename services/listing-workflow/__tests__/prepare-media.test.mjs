import test from'node:test';import assert from'node:assert/strict';import{spawnSync}from'node:child_process';
const files=['controller-host.py','pdd-native-host.py'].map(x=>new URL('../'+x,import.meta.url).pathname);
function run(mode){const script=`import pathlib,json,tempfile,time,types,base64,hashlib
h={'__name__':'test'}
for p in ${JSON.stringify(files)}:exec(pathlib.Path(p).read_text(),h)
with tempfile.TemporaryDirectory() as t:
 mode=${JSON.stringify(mode)};effects=[];errors=[];b=b'\\xff\\xd8\\xffimage';digest=hashlib.sha256(b).hexdigest()
 c={'owner':'owner','profile':'pddrun','remoteRoot':t,'binding':{'controllerPath':'/trusted/controller','serial':'SERIAL','materialPreparationAuthorized':mode!='unauthorized','storeName':'target'},'ownedMedia':[],'deadline':time.monotonic()+120,'materialPolicy':{'allowedDigests':[digest]}}
 if mode=='after-form':c['newFormEntryIntent']={'jobId':'entry'}
 if mode=='after-context':c['closedContext']={'startedAt':1}
 q={'action':'prepare-media','jobId':'job','name':'IMG_20261101_120000_1.jpg','sha256':digest,'bytesBase64':base64.b64encode(b).decode()}
 h['context']=lambda *a,**kw:(_ for _ in ()).throw(ValueError('BUSINESS_CONTEXT_MUST_NOT_RUN'))
 h['held']=lambda c:None;h['call_idle']=lambda c:None;h['verify_files']=lambda c:None
 def package(c,job):
  c['lastForegroundRaw']='foreground=  mCurrentFocus=Window{abc u0 com.xunmeng.merchant/com.xunmeng.merchant.goods_management.GoodsManagementActivity}\\n'
  if mode=='wrong-activity':c['lastForegroundRaw']='foreground=  mCurrentFocus=Window{abc u0 com.xunmeng.merchant/com.xunmeng.merchant.ui.NewPageActivity}\\n'
  return 'private.app' if mode=='private-package' else 'com.xunmeng.merchant'
 h['current_package']=package
 class Screen:
  def form(self):return False
  def facts(self):return {'form':False,'storeName':'other' if mode=='wrong-store' else None,'counts':{'在售中':47}}
 h['fresh_xml']=lambda *a:(Screen(),{'path':'before','sha256':'tree'})
 def adb(c,args,check=True):
  if 'ro.serialno' in args:return types.SimpleNamespace(returncode=0,stdout=b'WRONG' if mode=='wrong-serial' else b'SERIAL')
  return types.SimpleNamespace(returncode=1 if 'test' in args else 0,stdout=b'No result found.')
 h['adb']=adb
 class Process:
  pid=1234
  def __init__(self,*a,**kw):
   saved=json.loads((pathlib.Path(t)/'config.json').read_text());assert saved['ownedMedia'][0]['phonePlanned'];effects.append('push');self.returncode=1 if mode=='lost-response' else 0
  def communicate(self,**kw):return b'media_push=ok',b''
 h['subprocess'].Popen=Process
 h['phone_readback']=lambda c:{'media':[dict(c['ownedMedia'][0],phoneSha256=digest)]}
 h['organize_owned_album']=lambda c:(effects.append('organize') or {'verified':True})
 try:
  h['native_action'](c,q)
  if mode=='ok':h['native_action'](c,dict(q,action='prepare-album'))
 except Exception as e:errors.append({'message':str(e),'unknown':getattr(e,'remoteUnknown',False)})
 if mode in {'ok','lost-response'}:
  try:h['native_action'](c,q)
  except Exception as e:errors.append({'message':str(e)})
 print(json.dumps({'effects':effects,'errors':errors,'businessProofCreated':bool(c.get('storeProof') or c.get('closedContext'))}))
`;
const r=spawnSync('python3',['-c',script],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}
test('authorized material preparation persists push intent and organizes before any business context exists',()=>{const r=run('ok');assert.deepEqual(r.effects,['push','organize'],JSON.stringify(r));assert.equal(r.businessProofCreated,false);assert.equal(r.errors.at(-1).message,'STAGED_MEDIA_ALREADY_EXISTS');});
for(const[mode,message]of[['unauthorized','MATERIAL_PREPARATION_NOT_AUTHORIZED'],['after-form','MATERIAL_PREPARATION_PHASE_CLOSED'],['after-context','MATERIAL_PREPARATION_PHASE_CLOSED'],['private-package','MATERIAL_PREPARATION_FOREGROUND_UNSAFE'],['wrong-activity','MATERIAL_PREPARATION_FOREGROUND_UNSAFE'],['wrong-serial','HARDWARE_SERIAL_MISMATCH'],['wrong-store','WRONG_STORE']])test(`preparation refuses ${mode} without any device push`,()=>{const r=run(mode);assert.deepEqual(r.effects,[]);assert.equal(r.errors[0].message,message);});
test('pre-context push with a lost response stays unknown and cannot replay',()=>{const r=run('lost-response');assert.deepEqual(r.effects,['push'],JSON.stringify(r));assert.equal(r.errors[0].unknown,true);assert.equal(r.errors.at(-1).message,'STAGED_MEDIA_ALREADY_EXISTS');});
