import test from'node:test';import assert from'node:assert/strict';import{spawnSync}from'node:child_process';
const files=['controller-host.py','pdd-media-picker.py','pdd-gallery-actions.py'].map(x=>new URL('../'+x,import.meta.url).pathname);
function run(mode){const script=`import pathlib,json,tempfile
h={'__name__':'test'}
for p in ${JSON.stringify(files)}:exec(pathlib.Path(p).read_text(),h)
with tempfile.TemporaryDirectory() as t:
 mode=${JSON.stringify(mode)};taps=[]
 approved='e2a2d9d91990f86a07c896efb287bae803e09332147df48d41d08d995afadf28';observed='6a0f8e886b4df9badfa72504ab034692bbe7732ada4e32ae4f0c86614b40ab3f'
 relation={'approvedScreenSha256':approved,'observedScreenSha256':observed,'approvedTreeSha256':'tree','observedTreeSha256':'tree','windowRaw':'same-window','pixelComparison':{'mode':'entire-app-except-native-system-status-bar','statusBarMask':[0,0,1200,121]}}
 c={'owner':'owner','remoteRoot':t,'draft':{'owned':True},'ownedMedia':[{'mediaId':'8001','sha256':'source'}],'lastForegroundRaw':'com.xunmeng.merchant/MultiGraphSelectorNewActivity','lastFrame':{'screenSha256':approved,'xmlSha256':'tree','windowRaw':'same-window'}}
 png={'path':'observed.png','sha256':observed,'approvalRelation':relation}
 def current(*a):
  if mode in {'app-changed','window-changed','tree-changed'}:raise ValueError({'app-changed':'APPROVED_APP_PIXELS_CHANGED','window-changed':'APPROVED_WINDOW_CHANGED','tree-changed':'APPROVED_UI_CHANGED'}[mode])
  return 'com.xunmeng.merchant',object(),{'path':'tree.xml','sha256':'tree'},png
 h['picker_current']=current;h['gallery_candidates']=lambda *a:[{'checkbox':[50,100,100,150],'bounds':[0,100,100,200],'selectedNumber':None,'imageSha256':'candidate','contentSha256':'content','imageSize':[100,100]}]
 h['final_window_guard']=lambda *a,**kw:None
 def tap(*a,**kw):taps.append(1);raise ValueError('TEST_EFFECT_BOUNDARY')
 h['control_ok']=tap
 q={'jobId':'job','action':'gallery-select','approvedScreenSha256':approved,'visualBinding':{'mediaId':'8001','sourceSha256':'source','imageSha256':'candidate','approvedScreenSha256':approved}}
 if mode=='forged-current':q['visualBinding']['approvedScreenSha256']=observed
 if mode=='wrong-request':q['approvedScreenSha256']='other'
 if mode=='wrong-frame':c['lastFrame']['screenSha256']='other'
 if mode=='wrong-source':q['visualBinding']['sourceSha256']='private'
 if mode=='wrong-id':q['visualBinding']['mediaId']='other'
 if mode=='wrong-image':q['visualBinding']['imageSha256']='other'
 try:h['gallery_action'](c,q);error=None
 except Exception as e:error=str(e)
 pending=c.get('pendingPicker',{})
 print(json.dumps({'error':error,'taps':len(taps),'relation':pending.get('approvalRelation'),'approvedUnchanged':c['lastFrame']['screenSha256']==approved}))
`;
const r=spawnSync('python3',['-c',script],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}
test('R17 admitted status-bar-only image change keeps original approval and a distinct observed frame at one tap boundary',()=>{const r=run('status-bar');assert.equal(r.error,'TEST_EFFECT_BOUNDARY');assert.equal(r.taps,1);assert.equal(r.approvedUnchanged,true);assert.equal(r.relation.approvedScreenSha256,'e2a2d9d91990f86a07c896efb287bae803e09332147df48d41d08d995afadf28');assert.equal(r.relation.observedScreenSha256,'6a0f8e886b4df9badfa72504ab034692bbe7732ada4e32ae4f0c86614b40ab3f');});
for(const mode of['forged-current','wrong-request','wrong-frame','wrong-source','wrong-id','wrong-image','app-changed','window-changed','tree-changed'])test(`gallery frame relation refuses ${mode} before any tap`,()=>{assert.equal(run(mode).taps,0);});

test('trusted picker admission records the original approval separately from the already-validated observed PNG',()=>{const paths=['controller-host.py','pdd-media-picker.py','pdd-media-actions.py'].map(x=>new URL('../'+x,import.meta.url).pathname);const script=`import pathlib,json,base64\nh={'__name__':'test'}\nfor p in ${JSON.stringify(paths)}:exec(pathlib.Path(p).read_text(),h)\nc={'profile':'pddrun','binding':{'width':1200,'height':2664},'lastFrame':{'screenSha256':'approved','xmlSha256':'tree','windowRaw':'same-window','evidence':['approved.png','approved.xml']}}\nh['held']=lambda *a:None;h['call_idle']=lambda *a:None;h['approval']=lambda *a:None\ndef package(c,*a):c['lastForegroundRaw']='same-window';return 'com.xunmeng.merchant'\nh['current_package']=package\nh['fresh_xml']=lambda *a:(None,{'path':'current.xml','sha256':'tree','bytesBase64':base64.b64encode(b'<hierarchy/>').decode()})\nh['control_ok']=lambda *a,**kw:None;h['read_evidence']=lambda *a:{'path':'observed.png','sha256':'observed'}\nh['Screen']=lambda *a:object();h['PickerTree']=lambda *a:object();h['context_role']=lambda *a:'gallery';h['require_session_context']=lambda *a:None;h['require_store']=lambda *a:None\nh['app_pixel_comparison']=lambda *a:{'mode':'entire-app-except-native-system-status-bar','statusBarMask':[0,0,1200,121]}\nc['lastFrame']['windowRaw']='foreground=  mCurrentFocus=Window{abc u0 com.xunmeng.merchant/com.xunmeng.merchant.media.MultiGraphSelectorNewActivity}\\n'\ndef package(c,*a):c['lastForegroundRaw']=c['lastFrame']['windowRaw'];return 'com.xunmeng.merchant'\nh['current_package']=package\nr=h['picker_current'](c,{'action':'gallery-select','jobId':'job','approvedScreenSha256':'approved'})\nprint(json.dumps({'approved':c['lastFrame']['screenSha256'],'relation':r[3].get('approvalRelation')}))`;const r=spawnSync('python3',['-c',script],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);const x=JSON.parse(r.stdout);assert.equal(x.approved,'approved');assert.equal(x.relation.approvedScreenSha256,'approved');assert.equal(x.relation.observedScreenSha256,'observed');assert.equal(x.relation.pixelComparison.mode,'entire-app-except-native-system-status-bar');});
