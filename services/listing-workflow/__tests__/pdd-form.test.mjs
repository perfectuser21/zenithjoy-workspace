import test from 'node:test';
import assert from 'node:assert/strict';
async function resolver(){try{return await import('../pdd-form.mjs');}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;}}
const node=(text,bounds,extra='')=>`<node text="${text}" package="com.xunmeng.merchant" class="android.widget.TextView" bounds="${bounds}" ${extra}/>`;
const field=(label,y)=>`<node class="android.view.View">${node(label,`[10,${y}][100,${y+30}]`)}<node text="" package="com.xunmeng.merchant" class="android.widget.EditText" enabled="true" bounds="[120,${y}][400,${y+40}]"/></node>`;
function form(extra=''){return `<hierarchy><node package="com.xunmeng.merchant" class="android.view.View">${node('发布商品','[10,10][150,50]')}${node('商品轮播图','[10,60][150,90]')}${node('上传图片','[10,100][150,130]')}${field('商品标题',150)}${field('拼单价',220)}${field('库存',290)}${node('保存草稿','[10,500][200,550]')}${node('提交并上架','[220,500][450,550]')}${extra}</node></hierarchy>`;}
test('resolves visible fields using label ancestry, including after layout and screen size changes',async()=>{
 const {resolvePddForm}=await resolver();assert.equal(typeof resolvePddForm,'function');const r=resolvePddForm(form(),{width:500,height:600});assert.equal(r.status,'observed');assert.equal(r.requiresVisualReview,true);assert.deepEqual(r.anchors.title.bounds,[120,150,400,190]);assert.deepEqual(r.anchors.publish.bounds,[220,500,450,550]);
 const moved=resolvePddForm(form().replace('[120,150][400,190]','[140,170][450,215]'),{width:600,height:800});assert.deepEqual(moved.anchors.title.bounds,[140,170,450,215]);
});
test('ignores hidden duplicate nodes but rejects two visible matching submit buttons',async()=>{
 const {resolvePddForm}=await resolver();assert.equal(typeof resolvePddForm,'function');assert.equal(resolvePddForm(form(node('提交并上架','[0,0][0,0]')),{width:500,height:600}).status,'observed');
 const r=resolvePddForm(form(node('提交并上架','[10,400][150,450]')),{width:500,height:600});assert.equal(r.status,'unknown');assert.ok(r.reasons.includes('AMBIGUOUS_ANCHOR:publish'));
});
test('wrong package, absent form fields, malicious XML and invalid dimensions cannot produce actionable anchors',async()=>{
 const {resolvePddForm}=await resolver();assert.equal(typeof resolvePddForm,'function');for(const xml of [form().replaceAll('com.xunmeng.merchant','other.app'),'<hierarchy/>','<!DOCTYPE x [<!ENTITY s SYSTEM "file:///etc/passwd">]><hierarchy>&s;</hierarchy>'])assert.equal(resolvePddForm(xml,{width:500,height:600}).status,'unknown');
 assert.equal(resolvePddForm(form(),{width:0,height:600}).status,'unknown');
});
