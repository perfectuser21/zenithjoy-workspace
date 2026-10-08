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
