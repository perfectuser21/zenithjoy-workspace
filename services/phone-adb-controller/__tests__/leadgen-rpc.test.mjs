import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {RPC_FILES} from '../leadgen-client.mjs';
import {verifyRpcSource,handleRpc} from '../leadgen-rpc.mjs';

function fixture(){
  const commit='a'.repeat(40),base='/verified';const bytes=Buffer.from('fixed source');
  const hash=createHash('sha256').update(bytes).digest('hex');
  const source={commit,files:RPC_FILES.map(path=>({path,sha256:hash}))};
  const read=path=>path===resolve(base,'deployment-manifest.json')?JSON.stringify({source_commit:commit}):bytes;
  return {source,options:{read,base}};
}
test('跨机RPC核对所有27依赖固定字节，缺依赖/篡改/旧版均拒绝',()=>{
  const f=fixture();verifyRpcSource(f.source,f.options);
  assert.throws(()=>verifyRpcSource({...f.source,commit:'b'.repeat(40)},f.options),/REVISION_MISMATCH/);
  assert.throws(()=>verifyRpcSource({...f.source,files:f.source.files.filter(r=>r.path!=='step-judge.mjs')},f.options),/DEPENDENCY_MISSING/);
  assert.throws(()=>verifyRpcSource({...f.source,files:f.source.files.filter(r=>r.path!=='queued-comment-history.js')},f.options),/DEPENDENCY_MISSING/);
  assert.throws(()=>verifyRpcSource({...f.source,files:f.source.files.map((r,i)=>i===0?{...r,sha256:'b'.repeat(64)}:r)},f.options),/BYTES_MISMATCH/);
});
test('非法路径不能被RPC读取为凭据',()=>{
  const f=fixture();let touched=false;
  const read=path=>{if(path.includes('.credentials'))touched=true;return f.options.read(path);};
  assert.throws(()=>verifyRpcSource({...f.source,files:[{path:'../.credentials/brain.env',sha256:'a'.repeat(64)}]},{...f.options,read}),/PATH_INVALID/);
  assert.equal(touched,false);
});
test('版本未验证前，不建PG连接也不触发业务动作',async()=>{
  let used=false;
  await assert.rejects(handleRpc({kind:'queue',source:{}},{verify:()=>{throw Error('UNVERIFIED');},pool:{query:async()=>{used=true;}}}),/UNVERIFIED/);
  assert.equal(used,false);
});

test('真实RPC CLI历史短链调用不自import死锁，缺helper源字节在PG前拒绝',async()=>{
 const {mkdtempSync,writeFileSync,readFileSync,mkdirSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {spawnSync}=await import('node:child_process');
 const root=resolve('services/phone-adb-controller'),d=mkdtempSync(join(tmpdir(),'history-rpc-cli-')),vid='7646309328911907195';
 mkdirSync(join(d,'bin'));writeFileSync(join(d,'bin/curl'),'#!/bin/sh\nprintf "HTTP/2 302\\r\\nLocation: https://www.douyin.com/video/'+vid+'\\r\\n\\r\\n"\n',{mode:0o755});
 const queries=join(d,'queries');
 writeFileSync(join(d,'preload.cjs'),`const fs=require('fs'),Module=require('module');const read=fs.readFileSync;fs.readFileSync=function(p,...args){if(String(p).endsWith('/deployment-manifest.json'))return JSON.stringify({source_commit:'${'a'.repeat(40)}'});return read.call(this,p,...args)};Module.syncBuiltinESMExports();const load=Module._load;Module._load=function(id,parent,...args){if(id==='./leadgen-db-connect.js')return {getPool:()=>({end:async()=>{},query:async(sql)=>{fs.appendFileSync(${JSON.stringify(queries)},JSON.stringify(sql)+'\\n');if(sql.includes('SELECT video_id,video_url,title'))return {rows:[{video_id:'${vid}',video_url:'https://v.douyin.com/current/',url_bindings:1,title:'actual'}]};if(sql.includes('source_video_url=$2'))return {rows:[]};if(sql.includes('source_video=$2'))return {rows:[{id:'11111111-1111-4111-8111-111111111111',douyin_id:'person123',comment_body:'完整正文',source_video_url:'https://v.douyin.com/old/'}]};throw Error('UNEXPECTED_SQL')}})};return load.call(this,id,parent,...args)};`);
 const input={kind:'queue',source:{commit:'a'.repeat(40),files:RPC_FILES.map(path=>({path,sha256:createHash('sha256').update(readFileSync(join(root,path))).digest('hex')}))},request:{op:'comment_history',line:'jinuo',run:'new102',source_run:'source101',video_id:vid,video_url:'https://v.douyin.com/current/'}};
 const invoke=payload=>spawnSync(process.execPath,['--require',join(d,'preload.cjs'),join(root,'leadgen-rpc.mjs')],{input:JSON.stringify(payload),encoding:'utf8',timeout:10000,env:{...process.env,PATH:join(d,'bin')+':'+process.env.PATH,PGHOST:'invalid-history-test.local',PGPASSWORD:''}});
 const r=invoke(input);assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);const result=JSON.parse(r.stdout);assert.equal(result.ok,true);assert.equal(result.result.rows.length,1);assert.equal(result.result.url_proofs[0].video_id,vid);
 const before=readFileSync(queries,'utf8');assert.ok(before.split('\n').filter(Boolean).map(sql=>JSON.parse(sql)).every(sql=>sql.startsWith('SELECT')));
 const bad=invoke({...input,source:{...input.source,files:input.source.files.filter(f=>f.path!=='queued-comment-history.js')}});assert.equal(bad.status,1);assert.match(bad.stdout,/RPC_SOURCE_DEPENDENCY_MISSING:queued-comment-history.js/);assert.equal(readFileSync(queries,'utf8'),before,'未核来源不可触PG');
});
