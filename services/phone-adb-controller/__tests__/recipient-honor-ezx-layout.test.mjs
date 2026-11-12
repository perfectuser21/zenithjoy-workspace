import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const {parseNative,parseNativeCommentXml}=createRequire(import.meta.url)('../queued-recipient-evidence.js');
const profile=readFileSync(new URL('./fixtures/honor-ezx-recipient/profile.xml',import.meta.url),'utf8');
const returned=readFileSync(new URL('./fixtures/honor-ezx-recipient/returned.xml',import.meta.url),'utf8');
const scope={nickname:'测试评论人',douyinId:'fixture-account-102',commentBody:'测试完整评论 首评',commentEncoding:'xml_raw'};
const parse=(p=profile,r=returned,s=scope)=>parseNative(p,r,s);
function mutate(op){
 const r=spawnSync('python3',['-c',`import sys,json,xml.etree.ElementTree as E
v=json.load(sys.stdin);t=E.fromstring(v['xml']);pkg='com.ss.android.ugc.aweme';op=v['op'];parents={c:a for a in t.iter() for c in a}
def get(id):return next(n for n in t.iter('node') if n.get('resource-id')==pkg+':id/'+id)
if op=='duplicate_input':parents[get('ezx')].append(E.fromstring(E.tostring(get('ezx'))))
elif op=='duplicate_panel':t.append(E.fromstring(E.tostring(get('jn+'))))
elif op=='duplicate_comment':parents[get('fmu')].append(E.fromstring(E.tostring(get('fmu'))))
elif op=='input_outside_panel':n=get('ezx');parents[n].remove(n);t.append(n)
elif op=='card_outside_panel':n=get('fmu');parents[n].remove(n);t.append(n)
elif op=='close_outside_panel':n=get('back_btn');parents[n].remove(n);t.append(n)
print(E.tostring(t,encoding='unicode'))`],{input:JSON.stringify({xml:returned,op}),encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout;
}
test('Honor原生ezx布局本轮真实完整原生树：ezx/fmu同面板，核同UID昵称全文',()=>{
 const r=parse();assert.equal(r.native_profile_verified,true);assert.equal(r.returned_comment_verified,true);
});
for(const [name,p,r,s] of [
 ['UID错',profile.replace('抖音号：fixture-account-102','抖音号：fixture-account-other'),returned,scope],
 ['昵称错',profile,returned,{...scope,nickname:'另一个人'}],
 ['正文错',profile,returned,{...scope,commentBody:'测试完整评论 错正文'}],
 ['同资源错包',profile,returned.replace('package="com.ss.android.ugc.aweme"','package="other"'),scope],
 ['评论头缺失',profile,returned.replace('695条评论','搜索结果'),scope],
 ['关闭缺失',profile,returned.replace('content-desc="关闭"','content-desc="返回"'),scope],
 ['放大缺失',profile,returned.replace('content-desc="放大评论区"','content-desc="搜索"'),scope],
 ['输入框错class',profile,returned.replace('class="android.widget.EditText"','class="android.widget.TextView"'),scope],
 ['面板错class',profile,returned.replace('resource-id="com.ss.android.ugc.aweme:id/jn+" class="android.widget.FrameLayout"','resource-id="com.ss.android.ugc.aweme:id/jn+" class="android.widget.LinearLayout"'),scope],
 ['相关搜索冒正文',profile,returned.replace('测试评论人,测试完整评论 首评,','测试评论人,别的评论,'),scope],
 ['错误行资源',profile,returned.replaceAll(':id/fmu',':id/video_desc'),scope],
 ['混合ety与fmu',profile,returned.replace(':id/ezx',':id/ety'),scope],
 ['混合ezx与fhn',profile,returned.replaceAll(':id/fmu',':id/fhn'),scope],
])test('Honor原生ezx布局原件拒绝'+name,()=>assert.throws(()=>parse(p,r,s),/RECIPIENT_/));
for(const op of ['duplicate_input','duplicate_panel','duplicate_comment','input_outside_panel','card_outside_panel','close_outside_panel'])test('Honor原生ezx布局混页或歧义拒绝'+op,()=>assert.throws(()=>parse(profile,mutate(op)),/RECIPIENT_/));

for(const [name,xml] of [
 ['跨布局input',returned.replace(':id/ezx',':id/e19')],
 ['跨布局comment',returned.replaceAll(':id/fmu',':id/fpa')],
 ['跨布局panel',returned.replace(':id/jn+',':id/jqe')],
 ['跨布局expand',returned.replace(':id/kh4',':id/kkg')],
 ['仅comment无支持input',returned.replace(':id/ezx',':id/unrelated')],
])test('Honor原生ezx布局拒绝'+name,()=>assert.throws(()=>parse(profile,xml),/RECIPIENT_/));

test('Honor ezx 原生枚举与身份验证共用新布局',()=>{const r=parseNativeCommentXml(returned);assert.equal(r.rows.length,5);assert.equal(r.rows[0].nickname,scope.nickname);assert.equal(r.rows[0].body,scope.commentBody);assert.equal(r.footer_reached,false);});
