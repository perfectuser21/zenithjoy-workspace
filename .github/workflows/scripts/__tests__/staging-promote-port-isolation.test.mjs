import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../../../',import.meta.url));
const script=join(root,'.github/workflows/scripts/smoke/staging-promote-workflow-smoke.sh');
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
async function occupied(t,sha){
 const server=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({sha}));});
 await new Promise((resolve,reject)=>{server.once('error',e=>reject(Error('fixture setup: '+e.message)));server.listen(53910,resolve);});
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 return server;
}
function invoke(env={}){
 return new Promise((resolve,reject)=>{
  const input={...process.env,...env};delete input.NODE_TEST_CONTEXT;
  const child=spawn('bash',[script],{cwd:root,env:input,detached:true});let stdout='',stderr='';
  const timer=setTimeout(()=>{process.kill(-child.pid,'SIGTERM');reject(Error('local smoke fixture exceeded 35s'));},35000);
  child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
  child.once('error',e=>{clearTimeout(timer);reject(e);});
  child.once('close',(status,signal)=>{clearTimeout(timer);resolve({status,signal,stdout,stderr});});
 });
}
function version(){
 return new Promise((resolve,reject)=>http.get('http://localhost:53910/version',{agent:false},res=>{
  let body='';res.on('data',b=>body+=b);res.on('end',()=>resolve(JSON.parse(body)));
 }).on('error',reject));
}

test('real staging smoke owns an independent port when the former fixed port is occupied',async t=>{
 await occupied(t,'unrelated-local-fixture');
 const result=await invoke();
 assert.equal(result.status,0,result.stdout+result.stderr);
 assert.match(result.stdout,/FAIL=0/);
 assert.equal((await version()).sha,'unrelated-local-fixture','must not terminate the unrelated listener');
});

test('failed mock startup cannot borrow a successful version response from another process',async t=>{
 await occupied(t,'prodprod00000');
 const dir=mkdtempSync(join(tmpdir(),'staging-node-failure-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 writeFileSync(join(dir,'node'),`#!/bin/sh\nif [ "$1" = "-e" ]; then case "$2" in *http.createServer*) exit 9;; esac; fi\nexec ${quote(process.execPath)} "$@"\n`,{mode:0o700});
 const result=await invoke({PATH:dir+':'+process.env.PATH});
 assert.notEqual(result.status,0,'a foreign version response cannot prove this mock started');
 assert.match(result.stderr,/mock production server failed to start/);
 assert.doesNotMatch(result.stdout,/▶ 危险路径/,'setup failure must stop before workflow assertions');
 assert.equal((await version()).sha,'prodprod00000');
});
