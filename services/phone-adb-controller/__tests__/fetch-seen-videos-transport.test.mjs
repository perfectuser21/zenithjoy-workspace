import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const { routeOf } = createRequire(import.meta.url)('../line-routes.js');
const route=routeOf('jinuo');
const entry=fileURLToPath(new URL('../fetch-seen-videos.js',import.meta.url));
const id1='1234567890123456789',id2='2234567890123456789';

async function fixture(t, options={}) {
  const home=mkdtempSync(join(tmpdir(),'seen-history-transport-'));
  const calls=[];
  const server=createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    const target=new URL(new URL(req.url,'http://fixture').searchParams.get('target'));
    calls.push({target,method:req.method,body:body?JSON.parse(body):null,authorization:req.headers.authorization});
    res.setHeader('Content-Type','application/json');
    if(target.pathname==='/open-apis/auth/v3/tenant_access_token/internal'){
      res.statusCode=options.authStatus||200;
      res.end(JSON.stringify(options.authBody||{code:0,tenant_access_token:'fixture-token'}));return;
    }
    assert.equal(target.pathname,`/open-apis/bitable/v1/apps/${route.base}/tables/${route.video}/records`);
    const page=target.searchParams.has('page_token')?1:0;
    res.statusCode=options.recordsStatus||200;
    if(options.badJson){res.end('{broken');return;}
    res.end(JSON.stringify(options.pages?.[page]||options.recordsBody||{code:0,data:{items:[
      {fields:{视频ID:id1}},{fields:{视频ID:[{text:id2}]}},{fields:{视频ID:'id未取到'}},
    ],has_more:false}}));
  });
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const endpoint=`http://127.0.0.1:${server.address().port}`;
  const preload=join(home,'http-only-fixture.cjs');
  writeFileSync(preload,`const fs=require('node:fs'),path=require('node:path');
const read=fs.readFileSync;fs.readFileSync=function(file,...args){if(String(file).endsWith('clawdbot.json')){fs.writeFileSync(path.join(process.env.HOME,'private-config-attempt'),'blocked');throw Error('private config prohibited by fixture');}return read.call(this,file,...args);};
const originalFetch=globalThis.fetch;globalThis.fetch=(value,options)=>{const url=new URL(String(value));
if(url.origin!=='https://open.feishu.cn'||(!url.pathname.startsWith('/open-apis/bitable/v1/apps/${route.base}/tables/${route.video}/records')&&url.pathname!=='/open-apis/auth/v3/tenant_access_token/internal'))throw Error('nonfixture network prohibited');
return originalFetch(process.env.FIXTURE_HTTP+'/proxy?target='+encodeURIComponent(url.href),options);};`);
  t.after(async()=>{server.closeAllConnections();await new Promise(done=>server.close(done));rmSync(home,{recursive:true,force:true});});
  const env={HOME:home,PATH:'/usr/bin:/bin',NODE_OPTIONS:'--require='+preload,FIXTURE_HTTP:endpoint};
  const credentials={FEISHU_APP_ID:'fixture-app',FEISHU_APP_SECRET:'fixture-secret',FEISHU_ACCOUNT:'jinoshengyuan'};
  function mirror(content="export FEISHU_APP_ID='mirror-app'\nFEISHU_APP_SECRET=mirror-secret\n",mode=0o600){
    mkdirSync(join(home,'.credentials'),{recursive:true});writeFileSync(join(home,'.credentials/feishu.env'),content,{mode});
  }
  function run(line='jinuo',extra={}){
    return new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,[entry,line],{env:{...env,...extra}});
      let stdout='',stderr='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
      child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);
      child.on('error',reject);child.on('close',(code,signal)=>resolve({code,signal,stdout,stderr}));
    });
  }
  return {home,calls,credentials,mirror,run,privateConfigAttempted:()=>existsSync(join(home,'private-config-attempt'))};
}

test('显式环境凭据真实HTTP读取固定业务线历史，保留既有缺ID占位',async t=>{
  const f=await fixture(t);const r=await f.run('jinuo',f.credentials);
  assert.equal(r.code,0,r.stderr);assert.equal(r.stdout,`${id1}\n${id2}\nid未取到\n`);
  assert.deepEqual(f.calls[0].body,{app_id:'fixture-app',app_secret:'fixture-secret'});
  assert.equal(f.calls[1].authorization,'Bearer fixture-token');assert.equal(f.privateConfigAttempted(),false);
});

test('无账户标记的既有0600凭据镜像保持明确line只读兼容',async t=>{
  const f=await fixture(t);f.mirror();const r=await f.run('jinuo');assert.equal(r.code,0,r.stderr);
  assert.deepEqual(f.calls[0].body,{app_id:'mirror-app',app_secret:'mirror-secret'});assert.equal(f.privateConfigAttempted(),false);
});

test('显式环境优先于镜像，不混用两个来源的凭据',async t=>{
  const f=await fixture(t);f.mirror();const r=await f.run('jinuo',f.credentials);assert.equal(r.code,0,r.stderr);
  assert.deepEqual(f.calls[0].body,{app_id:'fixture-app',app_secret:'fixture-secret'});
  const partial=await f.run('jinuo',{FEISHU_APP_ID:'fixture-app'});assert.equal(partial.code,1);assert.equal(f.calls.length,2);
});

test('错误账户标记、本地宽权限镜像或缺凭据均在HTTP前拒绝，禁止私有cfg回退',async t=>{
  const f=await fixture(t);
  const wrong=await f.run('jinuo',{...f.credentials,FEISHU_ACCOUNT:'main'});assert.equal(wrong.code,1);assert.equal(f.calls.length,0);
  f.mirror("FEISHU_APP_ID=mirror-app\nFEISHU_APP_SECRET=mirror-secret\n",0o644);
  const mode=await f.run('jinuo');assert.equal(mode.code,1);assert.equal(f.calls.length,0);
  rmSync(join(f.home,'.credentials/feishu.env'));
  const absent=await f.run('jinuo');assert.equal(absent.code,1);assert.equal(f.privateConfigAttempted(),false);assert.equal(f.calls.length,0);
});

test('镜像中的错误账户标记拒绝，镜像不是可执行shell脚本',async t=>{
  const f=await fixture(t);f.mirror("FEISHU_APP_ID=mirror-app\nFEISHU_APP_SECRET=mirror-secret\nFEISHU_ACCOUNT=main\n");
  assert.equal((await f.run()).code,1);assert.equal(f.calls.length,0);
  rmSync(join(f.home,'.credentials/feishu.env'));
  f.mirror("FEISHU_APP_ID=$(touch injected)\nFEISHU_APP_SECRET=mirror-secret\n");
  assert.equal((await f.run()).code,1);assert.equal(existsSync(join(f.home,'injected')),false);assert.equal(f.calls.length,0);
});

test('明确不存在视频池的业务线返回真空历史，未配置路由仍拒绝',async t=>{
  const f=await fixture(t);const empty=await f.run('yuesheng');assert.equal(empty.code,0,empty.stderr);assert.equal(empty.stdout,'');
  const invalid=await f.run('unknown-line',f.credentials);assert.equal(invalid.code,1);assert.equal(f.calls.length,0);
  assert.equal(f.privateConfigAttempted(),false);
});

for(const [name,options] of [
  ['认证HTTP失败',{authStatus:503}],['认证业务失败',{authBody:{code:999}}],
  ['历史HTTP失败',{recordsStatus:500}],['历史业务失败',{recordsBody:{code:999,data:{items:[]}}}],
  ['历史缺items',{recordsBody:{code:0,data:{}}}],['坏JSON',{badJson:true}],
  ['分页不推进',{recordsBody:{code:0,data:{items:[],has_more:true,page_token:''}}}],
  ['分页标记缺失',{recordsBody:{code:0,data:{items:[]}}}],
  ['分页标记null',{recordsBody:{code:0,data:{items:[{fields:{视频ID:id1}}],has_more:null}}}],
  ['分页标记字符串',{recordsBody:{code:0,data:{items:[],has_more:'false'}}}],
])test(`${name}必须非零退出，不能伪造空历史`,async t=>{
  const f=await fixture(t,options);const r=await f.run('jinuo',f.credentials);assert.equal(r.code,1);assert.equal(r.stdout,'');
  assert.equal(f.privateConfigAttempted(),false);assert.ok(f.calls.length>=1);
});

test('真实历史分页安全编码cursor，只有全部读回成功才输出ID',async t=>{
  const token='cursor + 中文';const f=await fixture(t,{pages:[
    {code:0,data:{items:[{fields:{视频ID:id1}}],has_more:true,page_token:token}},
    {code:0,data:{items:[{fields:{视频ID:id2}}],has_more:false}},
  ]});const r=await f.run('jinuo',f.credentials);assert.equal(r.code,0,r.stderr);assert.equal(r.stdout,`${id1}\n${id2}\n`);
  assert.equal(f.calls[2].target.searchParams.get('page_token'),token);
});
