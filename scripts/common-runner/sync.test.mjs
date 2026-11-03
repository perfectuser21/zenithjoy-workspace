import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const script=fs.readFileSync(new URL('./sync.mjs',import.meta.url));
test('固定公共源生成完整依赖闭包，脱离源码后校验仍能拒绝字节篡改',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'runner-source-'));
 try{
  const source=path.join(temp,'cecelia'),dest=path.join(temp,'consumer');
  const moduleRoot=path.join(source,'packages/brain/src/orchestrator');fs.mkdirSync(moduleRoot,{recursive:true});
  fs.writeFileSync(path.join(moduleRoot,'activity-runtime.js'),"import {value} from './dependency.js';export const run=value;\n");
  fs.writeFileSync(path.join(moduleRoot,'dependency.js'),'export const value=42;\n');fs.writeFileSync(path.join(moduleRoot,'runner-commander-bridge.js'),'export const bridge=1;\n');
  const git=args=>execFileSync('git',['-C',source,...args],{stdio:'pipe'});
  git(['init','--initial-branch=cp-11030830-common-runner-fixture']);git(['add','.']);const tree=git(['write-tree']).toString().trim();const commit=git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit-tree',tree,'-m','fixture']).toString().trim();git(['update-ref','refs/heads/cp-11030830-common-runner-fixture',commit]);
  fs.mkdirSync(path.join(dest,'scripts/common-runner'),{recursive:true});const copied=path.join(dest,'scripts/common-runner/sync.mjs');fs.writeFileSync(copied,script);
  execFileSync(process.execPath,[copied,'--source',source]);execFileSync(process.execPath,[copied,'--check']);
  const root=path.join(dest,'services/phone-adb-controller/common-runner');
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'source.json')));assert.match(manifest.revision,/^[a-f0-9]{40}$/);
  assert.deepEqual(Object.keys(manifest.files).sort(),['activity-runtime.js','dependency.js','package.json','runner-commander-bridge.js']);
  assert.equal(fs.readFileSync(path.join(root,'dependency.js'),'utf8'),'export const value=42;\n');
  fs.writeFileSync(path.join(root,'dependency.js'),'export const value=99;\n');
  assert.throws(()=>execFileSync(process.execPath,[copied,'--check'],{stdio:'pipe'}),/Command failed/);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
