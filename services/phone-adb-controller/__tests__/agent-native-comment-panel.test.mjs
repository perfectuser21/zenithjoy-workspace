import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const recipient=createRequire(import.meta.url)('../queued-recipient-evidence.js');
const xml=readFileSync(new URL('./fixtures/honor-e1b-recipient/returned.xml',import.meta.url),'utf8');
const parse=value=>recipient.parseNativeCommentXml(value);
function mutate(operation){
 const p=spawnSync('python3',['-c',`import sys,json,xml.etree.ElementTree as E
v=json.load(sys.stdin);t=E.fromstring(v['xml']);parents={c:p for p in t.iter() for c in p};pkg='com.ss.android.ugc.aweme'
def find(rid):return next(n for n in t.iter('node') if n.get('resource-id')==pkg+':id/'+rid)
if v['operation']=='outside':
 n=find('fod');copy=E.fromstring(E.tostring(n));copy.set('content-desc','其他页面昵称,其他文字,今天, · 其它,回复 按钮');t.append(copy)
elif v['operation']=='input_outside':
 n=find('e1b');parents[n].remove(n);t.append(n)
elif v['operation']=='duplicate_viewport':
 n=find('rj=');parents[n].append(E.fromstring(E.tostring(n)))
elif v['operation']=='input_overlaps_viewport':
 find('e1b').set('bounds','[0,2400][1200,2500]')
elif v['operation']=='viewport_outside_panel':
 find('rj=').set('bounds','[0,0][1200,2480]')
elif v['operation']=='missing_viewport_bounds':
 find('rj=').set('bounds','[0,0][0,0]')
elif v['operation']=='duplicate_avatar':
 n=find('avatar');parents[n].append(E.fromstring(E.tostring(n)))
print(E.tostring(t,encoding='unicode'))`],{input:JSON.stringify({xml,operation}),encoding:'utf8'});
 assert.equal(p.status,0,p.stderr);return p.stdout;
}
test('Agent点头像前复用严格Honor面板，并识别同row无昵称desc的原生avatar按钮',()=>{
 const p=parse(xml);assert.equal(p.strict_layout,true);assert.equal(p.rows.length,1);
 assert.deepEqual(p.rows[0],{nickname:'测试评论人',author:false,body:'测试完整评论 首评',time:'今天',region:'测试',x:'111',y:'1258',nickname_b64:Buffer.from('测试评论人').toString('base64')});
});
test('Agent枚举只取原唯一panel内评论，不选页面其它FrameLayout',()=>{
 const p=parse(mutate('outside'));assert.equal(p.rows.length,1);assert.equal(p.rows[0].nickname,'测试评论人');
});
for(const [name,value] of [['missing_panel',xml.replace(':id/jqh',':id/unrelated')],['mixed_layout',xml.replaceAll(':id/fod',':id/fhn')],['input_outside',null]])test('Agent头像选择前拒绝'+name,()=>assert.throws(()=>parse(value??mutate('input_outside')),/RECIPIENT_/));
test('同row头像歧义不产生点击坐标',()=>{
 const p=parse(mutate('duplicate_avatar'));assert.equal(p.rows.length,1);assert.equal(p.rows[0].x,undefined);assert.equal(p.rows[0].y,undefined);
});

test('服务端滚动区域来自严格评论panel内唯一真实RecyclerView，排除输入与关闭区',()=>{
 assert.deepEqual(parse(xml).scroll_viewport,{left:0,top:1172,right:1200,bottom:2480});
});
for(const operation of ['duplicate_viewport','input_overlaps_viewport','viewport_outside_panel','missing_viewport_bounds'])test('不向Agent暴露不安全滚动区域 '+operation,()=>{
 assert.equal(parse(mutate(operation)).scroll_viewport,null);
});
