import test from'node:test';import assert from'node:assert/strict';import{spawnSync}from'node:child_process';
const files=['controller-host.py','pdd-native-ui.py','pdd-native-host.py'].map(x=>new URL('../'+x,import.meta.url).pathname);
function run(mode){const script=`import pathlib,tempfile,json,base64,types,hashlib
h={'__name__':'test'}
for p in ${JSON.stringify(files)}:exec(pathlib.Path(p).read_text(),h)
mode=${JSON.stringify(mode)}
with tempfile.TemporaryDirectory() as root:
 def label(text):return '<node package="com.xunmeng.merchant" class="android.widget.TextView" text="'+text+'" enabled="true" bounds="[0,0][100,50]"/>'
 def field(name,value):return '<node>'+label(name)+'<node package="com.xunmeng.merchant" class="android.widget.EditText" text="'+value+'" enabled="true" bounds="[100,100][300,150]"/></node>'
 xml=('<hierarchy>'+''.join(label(x) for x in ['发布商品','商品轮播图','保存草稿','提交并上架'])+field('商品标题','changed' if mode=='nonempty' else '')+field('拼单价','')+field('库存','1')+'</hierarchy>').encode();digest=hashlib.sha256(xml).hexdigest()
 c={'binding':{'width':1200,'height':2664},'owner':'owner','remoteRoot':root,'newFormEntryIntent':{'jobId':'new'},'baselineCounts':{'在售中':47,'发布中':0,'草稿箱':5},'lastForegroundRaw':'foreground=  mCurrentFocus=Window{owned u0 com.xunmeng.merchant/com.xunmeng.merchant.goods_management.GoodsManagementActivity}','draft':{'owner':'owner','owned':True,'values':{},'exitedVerified':False,'backIntent':{'jobId':'back','commandFinished':True,'before':{'path':'before.xml','sha256':digest}}}}
 job={'status':'finished','pid':999999999,'owner':'owner','command':'back','exitCode':0,'remoteUnknown':mode=='unknown'};pathlib.Path(root,'job-back-back.json').write_text(json.dumps(job))
 if mode=='upload':c['galleryUploadIntent']={'jobId':'upload'}
 if mode=='pending':c['pendingPicker']={'jobId':'select'}
 if mode=='changed-count':c['baselineCounts']['草稿箱']=4
 if mode=='bad-before':c['draft']['backIntent']['before']['sha256']='0'*64
 current=types.SimpleNamespace(form=lambda:False,labels=lambda x:[1] if x=='商品管理' else [],facts=lambda:{'counts':{'在售中':47,'发布中':0,'草稿箱':5}})
 h['read_evidence']=lambda *a:{'path':'before.xml','sha256':digest,'bytesBase64':base64.b64encode(xml).decode()}
 h['subprocess'].run=lambda *a,**k:types.SimpleNamespace(stdout='999999999 1' if mode=='live' else '123 1')
 try:h['confirm_empty_owned_exit'](c,current,{'path':'after.xml','sha256':'after'})
 except ValueError:pass
 print(json.dumps({'verified':c['draft']['exitedVerified'],'unknown':c['draft'].get('internalAutoSaveUnknown'),'proof':c['draft'].get('emptyDirectExitReadback')}))
`;const r=spawnSync('python3',['-c',script],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}
test('a truly empty owned form may exit directly after proven completed back and fresh native list readback',()=>{const r=run('ok');assert.equal(r.verified,true);assert.equal(r.unknown,true);assert.ok(r.proof.path);});
for(const mode of['nonempty','upload','pending','changed-count','bad-before','unknown','live'])test(`empty owned exit is not accepted for ${mode}`,()=>{assert.equal(run(mode).verified,false);});
