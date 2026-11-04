import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const id = '11111111-1111-1111-1111-111111111111';

async function fixture(fetch) {
  let extension, input;
  const app = {registerExtension(value) { extension = value; }};
  const context = vm.createContext({fetch, FormData, console, crypto, document: {createElement(tag) { assert.equal(tag,'input'); input = {click() {}, remove() {}}; return input; }}});
  const module = new vm.SourceTextModule(await readFile(new URL('custom_nodes/zenithjoy/web/remake.js', root),'utf8'), {context});
  await module.link(async name => { assert.equal(name,'../../scripts/app.js'); return new vm.SyntheticModule(['app'],function(){this.setExport('app',app);},{context}); });
  await module.evaluate();
  class Node { constructor(){this.widgets = ['参考视频ID','产品图片ID','背景图片ID','人脸图片ID'].map(name=>({name,value:''}));} addWidget(type,name,value,callback,options) { const w={type,name,value,callback,options}; this.widgets.push(w); return w; } setDirtyCanvas(){} }
  await extension.beforeRegisterNodeDef(Node, {name:'ZenithJoyWanRemake'});
  const node = new Node(); node.onNodeCreated();
  return {node, field:name=>node.widgets.find(w=>w.name===name), async choose(name,file) { node.widgets.find(w=>w.name===name).callback(); input.files=[file]; await input.onchange(); }};
}

test('upload widget uses absolute staff-cookie endpoint and persists only asset UUID', async()=>{
  let finish, calls=[];
  const f=await fixture(async(path,options)=>{calls.push({path,options});await new Promise(resolve=>{finish=resolve;});return {ok:true,json:async()=>({id,kind:'video',name:'source.mp4'})};});
  const upload=f.choose('上传参考视频',new File(['data'],'source.mp4',{type:'video/mp4'}));
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(f.field('参考视频ID').value,'上传中');
  assert.equal(calls[0].path,'/api/video-tools/uploads');
  assert.equal(calls[0].options.credentials,'include');
  assert.equal(calls[0].options.method,'POST');
  assert.ok(calls[0].options.body instanceof FormData);
  assert.equal(calls[0].options.headers,undefined);
  finish();await upload;
  assert.equal(f.field('参考视频ID').value,id);
  assert.match(f.field('素材上传状态').value,/source.mp4/);
  assert.match(f.field('素材上传状态').value,/生成新版本/);
  assert.equal(f.field('上传参考视频').options.serialize,false);
});

test('wrong role or network failure restores previous asset and shows bounded actionable error', async()=>{
  const f=await fixture(async()=>({ok:true,json:async()=>({id,kind:'image',name:'wrong.png'})}));
  f.field('参考视频ID').value=id;
  await f.choose('上传参考视频',new File(['x'],'source.mp4',{type:'video/mp4'}));
  assert.equal(f.field('参考视频ID').value,id);
  assert.match(f.field('素材上传状态').value,/视频/);
  const g=await fixture(async()=>({ok:false,status:413,json:async()=>({error:'too large'})}));
  await g.choose('上传参考视频',new File(['x'],'source.mp4',{type:'video/mp4'}));
  assert.match(g.field('素材上传状态').value,/413/);
  assert.equal(g.field('参考视频ID').value,'');
});

test('workflow exposes remake plus SaveVideo and ships with Docker image', async()=>{
  const graph=JSON.parse(await readFile(new URL('workflows/video-remake-wan.json',root),'utf8'));
  const remake=graph.nodes.find(n=>n.type==='ZenithJoyWanRemake');
  const save=graph.nodes.find(n=>n.type==='SaveVideo');
  assert.ok(remake);assert.ok(save);assert.equal(remake.widgets_values[0],'');
  assert.ok(graph.links.some(link=>link[1]===remake.id && link[3]===save.id && link[5]==='VIDEO'));
  const docker=await readFile(new URL('Dockerfile',root),'utf8');assert.match(docker,/COPY infrastructure\/comfyui\/workflows\/video-remake-wan.json/);
  const identifiers=await readFile(new URL('custom_nodes/zenithjoy/web/identifiers.js',root),'utf8');assert.match(identifiers,/ZenithJoyWanRemake/);
});

test('removing a node during upload never writes its completion into detached widgets', async()=>{
  let finish;
  const f=await fixture(async()=>{await new Promise(resolve=>{finish=resolve;});return {ok:true,json:async()=>({id,kind:'video'})};});
  const upload=f.choose('上传参考视频',new File(['x'],'source.mp4',{type:'video/mp4'}));
  await new Promise(resolve=>setTimeout(resolve,0));
  f.node.onRemoved();finish();await upload;
  assert.equal(f.field('参考视频ID').value,'上传中');
});

test('completed task ID is exposed without serializing an extra execution input', async()=>{
  const f=await fixture(async()=>{});
  f.node.onExecuted({text:[id]});
  assert.equal(f.field('视频任务ID（可复制）').value,id);
  assert.equal(f.field('视频任务ID（可复制）').options.serialize,false);
});
