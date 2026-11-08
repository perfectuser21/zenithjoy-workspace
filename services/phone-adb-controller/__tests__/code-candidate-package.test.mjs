import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {collectMethods} from '../../../scripts/product-map/leadgen-methods.mjs';
import {RPC_FILES} from '../leadgen-client.mjs';
import {verifyRpcSource} from '../leadgen-rpc.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const modules=['code-pg-runtime.mjs','code-observer-authority.mjs','code-observer-commander.mjs'];
const entries=['leadgen-workflow.mjs','leadgen-rpc.mjs','official-agent-control.mjs',...modules];
const hash=b=>createHash('sha256').update(b).digest('hex');
function load(folder){
 const env={...process.env};
 for(const key of ['NODE_PATH','NODE_OPTIONS','NODE_PG_FORCE_NATIVE'])delete env[key];
 return spawnSync(process.execPath,['--input-type=module','-e',
  `for(const file of ${JSON.stringify(entries)})await import('./'+file)`],
 {cwd:folder,env,encoding:'utf8',timeout:30000});
}
test('正式MMV完整发布包可离线加载Code入口，不借父级node_modules',()=>{
 const script=readFileSync(join(root,'deploy.sh'),'utf8');
 const loop=script.match(/MMV_RUNTIME_FILES=\(\)\nfor f in ([^\n]+); do/);
 assert.ok(loop,'missing actual final package assembly');
 const names=[...loop[1].matchAll(/\$\{([A-Z_]+)\[@\]\}/g)].map(m=>m[1]);
 assert.ok(names.length>0);
 const files=[...new Set(names.flatMap(name=>{
  const text=script.match(new RegExp('^'+name+'=\\(([\\s\\S]*?)\\)','m'))?.[1];
  assert.ok(text,'missing actual deploy array '+name);
  return text.replace(/#[^\n]*/g,'').trim().split(/\s+/);
 }))];
 const folder=mkdtempSync(join(tmpdir(),'code-package-'));
 try{
  for(const file of files){const target=join(folder,file);mkdirSync(dirname(target),{recursive:true});copyFileSync(join(root,file),target);}
  copyFileSync(join(root,'package.json'),join(folder,'package.json'));
  const result=load(folder);assert.equal(result.status,0,result.stderr);
  for(const file of modules){
   const target=join(folder,file),bytes=readFileSync(target);rmSync(target);
   const rejected=load(folder);assert.notEqual(rejected.status,0,'漏发'+file+'必须使真实导入失败');
   assert.match(rejected.stderr,/ERR_MODULE_NOT_FOUND|Cannot find module/);
   // Restore exact source bytes for the next independent missing-file case.
   copyFileSync(join(root,file),target);assert.deepEqual(readFileSync(target),bytes);
  }
 }finally{rmSync(folder,{recursive:true,force:true});}
});
test('Code新增闭包必须由接收端及全部Activity真实源码摘要共同约束',()=>{
 const repo=resolve(root,'../..'),methods=collectMethods(repo);
 const source={commit:'a'.repeat(40),files:RPC_FILES.map(path=>({path,sha256:hash(readFileSync(join(root,path)))}))};
 const read=path=>path.endsWith('deployment-manifest.json')?Buffer.from(JSON.stringify({source_commit:source.commit})):readFileSync(path);
 verifyRpcSource(source,{base:root,read});
 for(const file of modules){
  assert.throws(()=>verifyRpcSource({...source,files:source.files.filter(f=>f.path!==file)},{base:root,read}),new RegExp('RPC_SOURCE_DEPENDENCY_MISSING:'+file));
  const path='services/phone-adb-controller/'+file,bytes=readFileSync(join(repo,path));
  const changed=collectMethods(repo,{read:p=>p===path?Buffer.concat([bytes,Buffer.from('\n// isolated digest mutation')]):readFileSync(join(repo,p))});
  for(const [key,activity] of Object.entries(methods.activities)){
   assert.equal(activity.code_bindings.find(b=>b.path===path)?.sha256,hash(bytes),key);
   assert.notEqual(changed.activities[key].code_digest,activity.code_digest,key+' must freeze '+file);
  }
 }
});
