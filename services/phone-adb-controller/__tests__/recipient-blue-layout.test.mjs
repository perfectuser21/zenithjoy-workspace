import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const {parseNative}=createRequire(import.meta.url)('../queued-recipient-evidence.js');
const profile=readFileSync(new URL('./fixtures/blue-recipient/profile.xml',import.meta.url),'utf8');
const returned=readFileSync(new URL('./fixtures/blue-recipient/returned.xml',import.meta.url),'utf8');
const scope={nickname:'浴火重生',douyinId:'1812513381',commentBody:'工信部这个怎么报考 首评',commentEncoding:'xml_raw'};
const parse=(p=profile,r=returned,s=scope)=>parseNative(p,r,s);
function mutate(op){
 const r=spawnSync('python3',['-c',`import sys,json,xml.etree.ElementTree as E
v=json.load(sys.stdin);t=E.fromstring(v['xml']);pkg='com.ss.android.ugc.aweme';op=v['op'];parents={c:a for a in t.iter() for c in a}
def get(id):return next(n for n in t.iter('node') if n.get('resource-id')==pkg+':id/'+id)
if op=='duplicate_input':parents[get('eyi')].append(E.fromstring(E.tostring(get('eyi'))))
elif op=='duplicate_panel':t.append(E.fromstring(E.tostring(get('jn1'))))
elif op=='duplicate_comment':parents[get('flq')].append(E.fromstring(E.tostring(get('flq'))))
elif op=='input_outside_panel':n=get('eyi');parents[n].remove(n);t.append(n)
elif op=='card_outside_panel':n=get('flq');parents[n].remove(n);t.append(n)
elif op=='close_outside_panel':n=get('back_btn');parents[n].remove(n);t.append(n)
print(E.tostring(t,encoding='unicode'))`],{input:JSON.stringify({xml:returned,op}),encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout;
}
test('蓝第三布局本轮真实完整原生树：eyi/flq同面板，核同UID昵称全文',()=>{
 const r=parse();assert.equal(r.native_profile_verified,true);assert.equal(r.returned_comment_verified,true);
});
for(const [name,p,r,s] of [
 ['UID错',profile.replace('抖音号：1812513381','抖音号：1812513382'),returned,scope],
 ['昵称错',profile,returned,{...scope,nickname:'另一个人'}],
 ['正文错',profile,returned,{...scope,commentBody:'工信部这个怎么报考 别的正文'}],
 ['同资源错包',profile,returned.replace('package="com.ss.android.ugc.aweme"','package="other"'),scope],
 ['评论头缺失',profile,returned.replace('1条评论','搜索结果'),scope],
 ['关闭缺失',profile,returned.replace('content-desc="关闭"','content-desc="返回"'),scope],
 ['放大缺失',profile,returned.replace('content-desc="放大评论区"','content-desc="搜索"'),scope],
 ['输入框错class',profile,returned.replace('class="android.widget.EditText"','class="android.widget.TextView"'),scope],
 ['面板错class',profile,returned.replace('resource-id="com.ss.android.ugc.aweme:id/jn1" class="android.widget.FrameLayout"','resource-id="com.ss.android.ugc.aweme:id/jn1" class="android.widget.LinearLayout"'),scope],
 ['相关搜索冒正文',profile,returned.replace('浴火重生,工信部这个怎么报考 首评,','浴火重生,别的评论,').replace('ai办公软件免费版','工信部这个怎么报考 首评'),scope],
 ['错误行资源',profile,returned.replaceAll(':id/flq',':id/video_desc'),scope],
 ['混合ety与flq',profile,returned.replace(':id/eyi',':id/ety'),scope],
 ['混合eyi与fhn',profile,returned.replaceAll(':id/flq',':id/fhn'),scope],
])test('蓝第三布局原件拒绝'+name,()=>assert.throws(()=>parse(p,r,s),/RECIPIENT_/));
for(const op of ['duplicate_input','duplicate_panel','duplicate_comment','input_outside_panel','card_outside_panel','close_outside_panel'])test('蓝第三布局混页或歧义拒绝'+op,()=>assert.throws(()=>parse(profile,mutate(op)),/RECIPIENT_/));

for(const [name,xml] of [
 ['跨布局input',returned.replace(':id/eyi',':id/e19')],
 ['跨布局comment',returned.replaceAll(':id/flq',':id/fpa')],
 ['跨布局panel',returned.replace(':id/jn1',':id/jqe')],
 ['跨布局expand',returned.replace(':id/ki8',':id/kkg')],
 ['仅comment无支持input',returned.replace(':id/eyi',':id/unrelated')],
])test('蓝第三布局拒绝'+name,()=>assert.throws(()=>parse(profile,xml),/RECIPIENT_/));
