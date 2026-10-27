import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

function fixture(mode){return new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,[fileURLToPath(new URL('./fixtures/native-ipc-harness.mjs',import.meta.url)),mode],{stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';const timer=setTimeout(()=>child.kill('SIGKILL'),22000);
 child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
 child.once('error',reject);child.once('close',(code,signal)=>{clearTimeout(timer);try{
  assert.equal(code,0,'fixture setup/lifetime must succeed: '+stderr);assert.equal(signal,null);
  resolve(JSON.parse(stdout.trim()));
 }catch(e){reject(e);}});
});}
for(const mode of ['fast','slow-children'])test('真实controller/scoped version的2秒IPC不被'+mode+'观察器阻塞',
 {skip:process.platform!=='darwin',timeout:25000},async()=>{
  const value=await fixture(mode);
  assert.equal(value.observer_marker_exists,true,'actual observer subprocess must be reached');
  assert.equal(value.error,undefined,'native result and OS stop proof remain independent');
  const output=JSON.parse(value.result.stdout.trim());
  assert.equal(output.code,0,'real controller version must return within the original 2s: '+output.stderr);
  assert.equal(value.result.code,0,value.result.stderr);
  assert.ok(value.lifecycle.leaves.length>0,'actual parent-produced ADB leaves must run');
  assert.equal(value.lifecycle.complete,true);assert.equal(value.lifecycle.requests_returned,true);
  assert.equal(value.proof.execution_stopped,false,'observed-only is not a full OS stop proof');
  assert.equal(value.proof.status,'unknown');
 });
