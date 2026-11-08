import test from 'node:test';
import assert from 'node:assert/strict';
const subject=await import('../raw-turn-budget.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
test('预检模型不能独占232秒Worker窗口；观察和原生工具有固定余量',()=>{
 assert.equal(typeof subject.rawModelTurnDeadline,'function');
 const now=100000,request={activity_key:'preflight',worker_deadline_ms:now+232000};
 const deadline=subject.rawModelTurnDeadline(request,now);
 assert.ok(deadline<=now+60000);assert.ok(request.worker_deadline_ms-deadline>=40000);
 assert.equal(subject.rawModelTurnDeadline(request,now+200000),null);
 assert.equal(request.worker_deadline_ms,now+232000);
});

import {readFileSync,mkdtempSync,mkdirSync,copyFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,dirname,resolve} from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
function packagedImport(paths){
 const folder=mkdtempSync(join(tmpdir(),'preflight-package-'));
 try{
  for(const path of paths){const target=join(folder,path);mkdirSync(dirname(target),{recursive:true});copyFileSync(join(root,path),target);}
  copyFileSync(join(root,'package.json'),join(folder,'package.json'));
  symlinkSync(resolve(root,'../../node_modules'),join(folder,'node_modules'),'dir');
  const run=spawnSync(process.execPath,['--input-type=module','-e',"await import('./official-agent-control.mjs')"],{cwd:folder,encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
 }finally{rmSync(folder,{recursive:true,force:true});}
}
for(const list of ['MMV_JS_FILES','DEVICE_NODE_FILES','RPC_FILES'])test('正式'+list+'打包后可真实加载Caller全部本地依赖',()=>{
 const deploy=readFileSync(join(root,'deploy.sh'),'utf8'),body=deploy.match(new RegExp('^'+list+'=\\(([\\s\\S]*?)\\)','m'))?.[1];
 assert.ok(body,'missing deploy package '+list);
 packagedImport(body.replace(/#[^\n]*/g,'').trim().split(/\s+/));
});

import {collectMethods} from '../../../scripts/product-map/leadgen-methods.mjs';
import {RPC_FILES} from '../leadgen-client.mjs';import {verifyRpcSource} from '../leadgen-rpc.mjs';import {createHash} from 'node:crypto';
test('正式Activity冻结预算真实字节且接收端拒缺依赖',()=>{
 const repo=resolve(root,'../..'),methods=collectMethods(repo);let packages=0;
 const budget='services/phone-adb-controller/raw-turn-budget.mjs',bytes=readFileSync(join(repo,budget));
 const changed=collectMethods(repo,{read:path=>path===budget?Buffer.concat([bytes,Buffer.from('\n// changed fixture source')]):readFileSync(join(repo,path))});
 for(const [key,activity] of Object.entries(methods.activities)){
  if(!activity.code_bindings.some(b=>b.path.endsWith('/official-agent-control.mjs')))continue;
  const binding=activity.code_bindings.find(b=>b.path===budget);
  assert.equal(binding?.sha256,createHash('sha256').update(bytes).digest('hex'),key);
  assert.notEqual(changed.activities[key].code_digest,activity.code_digest,key+' must bind actual budget bytes');packages++;
 }
 assert.ok(packages>0);
 const source={commit:'a'.repeat(40),files:RPC_FILES.map(path=>({path,sha256:createHash('sha256').update(readFileSync(join(root,path))).digest('hex')}))};
 const read=path=>path.endsWith('deployment-manifest.json')?Buffer.from(JSON.stringify({source_commit:source.commit})):readFileSync(path);
 verifyRpcSource(source,{base:root,read});
 assert.throws(()=>verifyRpcSource({...source,files:source.files.filter(f=>f.path!=='raw-turn-budget.mjs')},{base:root,read}),/RPC_SOURCE_DEPENDENCY_MISSING:raw-turn-budget/);
});
