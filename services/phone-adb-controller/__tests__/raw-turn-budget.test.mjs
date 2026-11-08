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

import {readFileSync,mkdtempSync,mkdirSync,copyFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
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
