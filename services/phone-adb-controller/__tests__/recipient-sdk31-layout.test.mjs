import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const {parseNative}=createRequire(import.meta.url)('../queued-recipient-evidence.js');
const profile=readFileSync(new URL('./fixtures/sdk31-recipient/profile.xml',import.meta.url),'utf8');
const returned=readFileSync(new URL('./fixtures/sdk31-recipient/returned.xml',import.meta.url),'utf8');
const scope={nickname:'七彩人生1226',douyinId:'2088600354',commentBody:'程序该不会是你发明的吧？',commentEncoding:'xml_raw'};
const parse=(p=profile,r=returned,s=scope)=>parseNative(p,r,s);
function mutate(op){
 const r=spawnSync('python3',['-c',`import sys,json,xml.etree.ElementTree as E
v=json.load(sys.stdin);t=E.fromstring(v['xml']);pkg='com.ss.android.ugc.aweme';op=v['op'];parents={c:a for a in t.iter() for c in a}
def get(id):return next(n for n in t.iter('node') if n.get('resource-id')==pkg+':id/'+id)
if op=='duplicate_input':parents[get('e19')].append(E.fromstring(E.tostring(get('e19'))))
elif op=='duplicate_panel':t.append(E.fromstring(E.tostring(get('jqe'))))
elif op=='duplicate_comment':parents[get('fpa')].append(E.fromstring(E.tostring(get('fpa'))))
elif op=='input_outside_panel':n=get('e19');parents[n].remove(n);t.append(n)
elif op=='card_outside_panel':n=get('fpa');parents[n].remove(n);t.append(n)
elif op=='close_outside_panel':n=get('back_btn');parents[n].remove(n);t.append(n)
print(E.tostring(t,encoding='unicode'))`],{input:JSON.stringify({xml:returned,op}),encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout;
}
test('SDK31本轮真实完整原生树：e19/fpa同面板，核同UID昵称全文',()=>{
 const r=parse();assert.equal(r.native_profile_verified,true);assert.equal(r.returned_comment_verified,true);
});
for(const [name,p,r,s] of [
 ['UID错',profile.replace('抖音号：2088600354','抖音号：2088600355'),returned,scope],
 ['昵称错',profile,returned,{...scope,nickname:'另一个人'}],
 ['正文错',profile,returned,{...scope,commentBody:'程序该不会是你发明的吧！'}],
 ['同资源错包',profile,returned.replace('package="com.ss.android.ugc.aweme"','package="other"'),scope],
 ['评论头缺失',profile,returned.replace('23条评论','搜索结果'),scope],
 ['关闭缺失',profile,returned.replace('content-desc="关闭"','content-desc="返回"'),scope],
 ['放大缺失',profile,returned.replace('content-desc="放大评论区"','content-desc="搜索"'),scope],
 ['输入框错class',profile,returned.replace('class="android.widget.EditText"','class="android.widget.TextView"'),scope],
 ['面板错class',profile,returned.replace('resource-id="com.ss.android.ugc.aweme:id/jqe" class="android.widget.FrameLayout"','resource-id="com.ss.android.ugc.aweme:id/jqe" class="android.widget.LinearLayout"'),scope],
 ['相关搜索冒正文',profile,returned.replace('七彩人生1226,程序该不会是你发明的吧？,','七彩人生1226,别的评论,').replace('ai办公软件免费版','程序该不会是你发明的吧？'),scope],
 ['错误行资源',profile,returned.replaceAll(':id/fpa',':id/video_desc'),scope],
 ['混合ety与fpa',profile,returned.replace(':id/e19',':id/ety'),scope],
 ['混合e19与fhn',profile,returned.replaceAll(':id/fpa',':id/fhn'),scope],
])test('SDK31原件拒绝'+name,()=>assert.throws(()=>parse(p,r,s),/RECIPIENT_/));
for(const op of ['duplicate_input','duplicate_panel','duplicate_comment','input_outside_panel','card_outside_panel','close_outside_panel'])test('SDK31混页或歧义拒绝'+op,()=>assert.throws(()=>parse(profile,mutate(op)),/RECIPIENT_/));
