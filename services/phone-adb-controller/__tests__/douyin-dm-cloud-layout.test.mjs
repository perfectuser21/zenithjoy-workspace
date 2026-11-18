// 当前云机真实树仅脱敏文本；焦点/IME变化属于明确标记的离线变体，不能当真机验收。
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const helper=new URL('../text-input-focus.py',import.meta.url).pathname;
const fixture=new URL('./fixtures/dm-focus/chat-cloud-r4-redacted.xml',import.meta.url);
const chat=readFileSync(fixture,'utf8');
const old=readFileSync(new URL('./fixtures/dm-focus/chat-7883-unfocused.xml',import.meta.url),'utf8');
function mutate(xml,body) {
 const r=spawnSync('python3',['-c',`import sys,copy,xml.etree.ElementTree as E
root=E.fromstring(sys.stdin.read())
pkg="com.ss.android.ugc.aweme"
def by(rid): return next(n for n in root.iter("node") if n.get("resource-id")==pkg+":id/"+rid)
def parent(node): return next(n for n in root.iter() if node in list(n))
${body}
print(E.tostring(root,encoding="unicode"))`],{input:xml,encoding:'utf8',timeout:5000});
 assert.equal(r.status,0,r.stderr);return r.stdout;
}
function check(base,current,focused=false) {
 const d=mkdtempSync(join(tmpdir(),'dm-cloud-layout-'));
 try {writeFileSync(join(d,'base.xml'),base);writeFileSync(join(d,'current.xml'),current);
  return spawnSync('python3',[helper,focused?'douyin-dm-focused':'douyin-dm-locate',join(d,'base.xml'),join(d,'current.xml')],{encoding:'utf8',timeout:5000});
 } finally {rmSync(d,{recursive:true,force:true});}
}
const focused=()=>mutate(chat,'by("msg_et").set("focused","true")');
test('完整r4脱敏原件有固定来源SHA，原未聚焦状态可定位',()=>{
 const provenance=JSON.parse(readFileSync(new URL('./fixtures/dm-focus/chat-cloud-r4-provenance.json',import.meta.url),'utf8'));
 assert.equal(provenance.original_sha256,'658135de74bb13e9467b398a2d932db3cf5796f8e5c1457399479b84c1bb92bf');
 assert.equal(createHash('sha256').update(chat).digest('hex'),provenance.fixture_sha256);
 const r=check(chat,chat);assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),{bounds:'[82,1123][500,1192]',focused:false});
});
test('新签名离线焦点变体：唯一安全输入聚焦后通过，取fresh bounds',()=>{
 const current=mutate(focused(),'by("msg_et").set("bounds","[82,700][500,769]")');
 const r=check(chat,current,true);assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),{bounds:'[82,700][500,769]',focused:true});
});
test('旧完整签名保持可定位',()=>{const r=check(old,old);assert.equal(r.status,0,r.stderr);});
test('键盘前后不能从旧签名换成新签名，即使两者各自有效',()=>{assert.equal(check(old,chat).status,2);assert.equal(check(chat,old).status,2);});
test('新签名隐私提示变化仍拒绝baseline/current上下文更换',()=>{assert.equal(check(chat,mutate(chat,'by("st+").set("text","不同会话提示")')).status,2);});
for(const [attr,value] of [['password','true'],['enabled','false'],['focusable','false'],['clickable','false'],['editable','false']])
 test(`新签名拒绝不安全输入 ${attr}`,()=>{assert.equal(check(chat,mutate(chat,`by("msg_et").set(${JSON.stringify(attr)},${JSON.stringify(value)})`)).status,2);});
for(const rid of ['mdk','d98','v6m','st+','msg_et']) {
 test(`拒绝签名节点重复 ${rid}`,()=>{assert.equal(check(chat,mutate(chat,`n=by(${JSON.stringify(rid)});parent(n).append(copy.deepcopy(n))`)).status,2);});
 test(`拒绝签名节点跨包 ${rid}`,()=>{assert.equal(check(chat,mutate(chat,`by(${JSON.stringify(rid)}).set("package","other.package")`)).status,2);});
 test(`拒绝签名节点类型错误 ${rid}`,()=>{assert.equal(check(chat,mutate(chat,`by(${JSON.stringify(rid)}).set("class","android.widget.Button")`)).status,2);});
}
for(const [rid,replacement] of [['mdk','l+='],['d98','d2_'],['v6m','v54'],['st+','sv_'],['st+','x+7']])
 test(`拒绝逐ID混搭 ${rid}/${replacement}`,()=>{assert.equal(check(chat,mutate(chat,`by(${JSON.stringify(rid)}).set("resource-id",pkg+":id/"+${JSON.stringify(replacement)})`)).status,2);});
for(const [label,body] of [
 ['root换父','n=by("mdk");parent(n).remove(n);by("d98").append(n)'],
 ['隐私移出消息列表','n=by("st+");parent(n).remove(n);by("d98").append(n)'],
 ['输入移出容器','n=by("msg_et");parent(n).remove(n);root.append(n)'],
 ['frame跨包','parent(by("mdk")).set("package","other.package")'],
 ['frame类型','parent(by("mdk")).set("class","android.widget.LinearLayout")'],
 ['frame新增ID','parent(by("mdk")).set("resource-id",pkg+":id/changed")'],
 ['容器后代跨包','by("thv").set("package","other.package")'],
 ['空隐私','by("st+").set("text","")'],
 ['无效输入bounds','by("msg_et").set("bounds","[0,0][0,0]")'],
 ['混入另一签名根','n=copy.deepcopy(by("mdk"));n.set("resource-id",pkg+":id/l+=");parent(by("mdk")).append(n)'],
]) test(`新签名保留结构保护 ${label}`,()=>{assert.equal(check(chat,mutate(chat,body)).status,2);});
for(const value of ['false','unknown']) test(`未可信聚焦 ${value} 不允许focused通过`,()=>{
 const r=check(chat,mutate(chat,`by("msg_et").set("focused",${JSON.stringify(value)})`),true);assert.notEqual(r.status,0);
});
test('冲突焦点拒绝，不能因msg_et focused而放行另一输入',()=>{
 const current=mutate(focused(),'n=copy.deepcopy(by("msg_et"));n.set("resource-id",pkg+":id/other_input");by("d98").append(n)');assert.equal(check(chat,current,true).status,2);
});
