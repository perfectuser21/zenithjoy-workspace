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
 await new Promise((resolve,reject)=>{server.once('error',e=>reject(Error('fixture setup: '+e.message)));server.listen(0,'127.0.0.1',resolve);});
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const port=server.address().port,dir=mkdtempSync(join(tmpdir(),'staging-port-model-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 // Only the child fixture's legacy 53910 transport maps to this real private listener.
 // Other parallel tests keep their original process environments and listeners.
 writeFileSync(join(dir,'listen.cjs'),`const net=require('node:net'),listen=net.Server.prototype.listen;net.Server.prototype.listen=function(...a){if(a[0]===53910){a[0]=${port};if(typeof a[1]==='function')a.splice(1,0,'127.0.0.1');}return listen.apply(this,a);};`);
 writeFileSync(join(dir,'node'),`#!/bin/sh\nif [ "\${FAIL_MOCK_START:-0}" = 1 ] && [ "$1" = "-e" ]; then case "$2" in *http.createServer*) exit 9;; esac; fi\nexec ${quote(process.execPath)} "$@"\n`,{mode:0o700});
 writeFileSync(join(dir,'curl'),`#!${process.execPath}\nconst {spawnSync}=require('node:child_process');const a=process.argv.slice(2).map(x=>x.replace('http://localhost:53910/','http://127.0.0.1:${port}/'));const r=spawnSync('/usr/bin/curl',a,{stdio:'inherit'});process.exit(r.status??1);\n`,{mode:0o700});
 return {port,env:{PATH:dir+':'+process.env.PATH,NODE_OPTIONS:(process.env.NODE_OPTIONS||'')+' --require '+JSON.stringify(join(dir,'listen.cjs'))}};
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
function version(port){
 return new Promise((resolve,reject)=>http.get('http://127.0.0.1:'+port+'/version',{agent:false},res=>{
  let body='';res.on('data',b=>body+=b);res.on('end',()=>resolve(JSON.parse(body)));
 }).on('error',reject));
}

test('real staging smoke owns an independent port when the former fixed port is occupied',async t=>{
 const f=await occupied(t,'unrelated-local-fixture');
 const result=await invoke(f.env);
 assert.equal(result.status,0,result.stdout+result.stderr);
 assert.match(result.stdout,/FAIL=0/);
 assert.equal((await version(f.port)).sha,'unrelated-local-fixture','must not terminate the unrelated listener');
});

test('failed mock startup cannot borrow a successful version response from another process',async t=>{
 const f=await occupied(t,'prodprod00000');
 const result=await invoke({...f.env,FAIL_MOCK_START:'1'});
 assert.notEqual(result.status,0,'a foreign version response cannot prove this mock started');
 assert.match(result.stderr,/mock production server failed to start/);
 assert.doesNotMatch(result.stdout,/▶ 危险路径/,'setup failure must stop before workflow assertions');
 assert.equal((await version(f.port)).sha,'prodprod00000');
});
