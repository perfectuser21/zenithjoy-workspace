// Execute the actual YAML selector; do not parse a shell array as a Node argv.
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
export const repository=resolve(fileURLToPath(new URL('../../../../..',import.meta.url)));
const name='node --test scripts/openclaw + services/phone-adb-controller + deploy-phone-adb-controller workflow 契约测试';
export function openclawStep(workflow){
 const steps=workflow.jobs['openclaw-scripts-test'].steps.filter(step=>step.name===name);
 assert.equal(steps.length,1,'the required OpenClaw selector must have one actual YAML step');return steps[0];
}
export function captureNodeArgs(command,{cwd=repository,shard=1}={}){
 const dir=mkdtempSync(join(tmpdir(),'actual-node-selector-'));
 try{
  const trace=join(dir,'args');writeFileSync(join(dir,'node'),'#!/bin/sh\nprintf "%s\\0" __NODE_CALL__ "$@" >> "$CAPTURE_ARGS"\n',{mode:0o755});
  const code=command.replace(/\$\{\{\s*matrix.shard\s*\}\}/g,String(shard));
  const result=spawnSync('/bin/bash',['-e','-o','pipefail','-c',code],{cwd,env:{...process.env,PATH:dir+':'+process.env.PATH,CAPTURE_ARGS:trace},encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);assert.equal(result.signal,null);
  const words=readFileSync(trace,'utf8').split('\0').filter(Boolean);
  assert.equal(words.filter(word=>word==='__NODE_CALL__').length,1,'the selector must invoke Node exactly once');
  assert.equal(words.shift(),'__NODE_CALL__');return words;
 }finally{rmSync(dir,{recursive:true,force:true});}
}
