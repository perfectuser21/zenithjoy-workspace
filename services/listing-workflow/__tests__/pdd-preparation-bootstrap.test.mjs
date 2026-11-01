import test from'node:test';import assert from'node:assert/strict';import{spawnSync}from'node:child_process';
const files=['controller-host.py','pdd-native-host.py','pdd-cleanup-navigation.py','pdd-native-ui.py'].map(x=>new URL('../'+x,import.meta.url).pathname);
function run(mode){const script=`import pathlib,json,base64,types
h={'__name__':'test'}
for p in ${JSON.stringify(files)}:exec(pathlib.Path(p).read_text(),h)
mode=${JSON.stringify(mode)}
def xml(ad,extra=''):
 return '<hierarchy><node package="com.xunmeng.merchant" class="android.widget.TextView" text="商品管理" bounds="[100,10][200,50]"/><node package="com.xunmeng.merchant" class="android.widget.TextView" text="在售中(47)" bounds="[0,60][100,90]"/><node package="com.xunmeng.merchant" class="android.widget.TextView" text="发布中(0)" bounds="[110,60][210,90]"/><node package="com.xunmeng.merchant" class="android.widget.TextView" text="'+ad+'" bounds="[0,100][400,130]"/><node resource-id="bottomButtonId" bounds="[0,490][500,600]"><node package="com.xunmeng.merchant" class="android.widget.TextView" text="发布商品" bounds="[300,500][450,550]"/></node>'+extra+'</hierarchy>'
original=xml('25个待审视频');changed=xml('读书月广告')
if mode=='focused':changed=xml('ad','<node class="android.widget.EditText" focused="true" bounds="[0,150][100,200]"/>')
if mode=='modal':changed=xml('ad','<node package="com.xunmeng.merchant" class="android.widget.Button" text="确定" bounds="[0,150][100,200]"/>')
if mode=='missing-list':changed=changed.replace('商品管理','unknown')
window='foreground=  mCurrentFocus=Window{abc u0 com.xunmeng.merchant/com.xunmeng.merchant.goods_management.GoodsManagementActivity}\\n'
c={'binding':{'serial':'SERIAL','width':500,'height':600},'lastForegroundRaw':window,'lastFrame':{'windowRaw':window,'xmlSha256':'approved-tree','evidence':['approved.png','approved.xml']}};reads=[];held=[]
h['held']=lambda c:held.append(1)
h['adb']=lambda c,args:types.SimpleNamespace(stdout=b'OTHER' if mode=='serial' else b'SERIAL')
h['read_evidence']=lambda c,p:{'sha256':'approved-tree','bytesBase64':base64.b64encode(original.encode()).decode()}
def package(c,job):
 reads.append(1)
 if mode=='window' or (mode=='late-window' and len(reads)>1):c['lastForegroundRaw']=window.replace('abc','other')
 return 'other.app' if mode=='package' else 'com.xunmeng.merchant'
h['current_package']=package;h['fresh_xml']=lambda *a:(h['Screen'](changed,500,600),{'path':'final.xml','sha256':'changed-tree'})
try:r=h['preparation_bootstrap_guard'](c,{'jobId':'job'},h['Screen'](original,500,600),{'path':'before.xml','sha256':'approved-tree'});error=None
except Exception as e:r=None;error=str(e)
print(json.dumps({'error':error,'reads':len(reads),'held':len(held),'result':r}))`;
const r=spawnSync('python3',['-c',script],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}
test('preparation-only hardware back tolerates changed advertising with two live list identities and final window/locks',()=>{const r=run('advertising');assert.equal(r.error,null);assert.equal(r.reads,2);assert.ok(r.held>=2);assert.ok(r.result.evidence.includes('final.xml'));});
for(const mode of['focused','modal','missing-list','serial','window','late-window','package'])test(`preparation-only list back refuses ${mode}`,()=>{assert.match(run(mode).error,/BOOTSTRAP|HARDWARE_SERIAL|WRONG_LIST_PAGE/);});
