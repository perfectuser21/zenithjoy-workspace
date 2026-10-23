import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';
const source=readFileSync(new URL('../smoke/structured-workbench-smoke.sh',import.meta.url),'utf8');
const failFunction=source.match(/^fail\(\) \{[^\n]+\}$/m)[0];
const start=source.indexOf('start_api() {'),end=source.indexOf('\nlogin_cookie()',start);
const startFunction=source.slice(start,end);
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function fixture(t,{foreign=false}={}){
 const top=mkdtempSync(join(tmpdir(),'workbench-owner-')),bin=join(top,'bin'),app=join(top,'owned-api.cjs'),pidFile=join(top,'child.pid');mkdirSync(bin);
 const server=createServer(()=>{});server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;
 if(!foreign)await new Promise(r=>server.close(r));
 writeFileSync(app,`const fs=require('fs'),net=require('net');fs.writeFileSync(process.env.TEST_CHILD_PID,String(process.pid));const s=net.createServer(()=>{});s.on('error',e=>fs.writeFileSync(process.env.TEST_CHILD_PID+'.error',e.code));s.listen(Number(process.env.PORT),'127.0.0.1');setInterval(()=>{},1000);`);
 writeFileSync(join(bin,'node'),'#!/bin/sh\ncase "$1" in apps/api/dist/index.js) exec "$TEST_REAL_NODE" "$TEST_CHILD_APP" "$@";; *) exec "$TEST_REAL_NODE" "$@";; esac\n',{mode:0o755});
 for(const name of ['curl','sleep'])writeFileSync(join(bin,name),'#!/bin/sh\nexit '+(name==='curl'?'1':'0')+'\n',{mode:0o755});
 let pid;
 try{
  const r=spawnSync('/bin/bash',['-c',failFunction+'\n'+startFunction+'\nstart_api "$1" "$2"','fixture',String(port),join(top,'api.log')],{encoding:'utf8',timeout:5000,env:{...process.env,PATH:bin+':'+process.env.PATH,TEST_REAL_NODE:process.execPath,TEST_CHILD_APP:app,TEST_CHILD_PID:pidFile}});
  for(let n=0;n<100&&!existsSync(pidFile);n++)await pause(10);
  if(existsSync(pidFile))pid=Number(readFileSync(pidFile,'utf8'));
  return {status:r.status,stderr:r.stderr,launched:!!pid,childAlive:!!pid&&alive(pid),foreignListening:foreign&&server.listening};
 }finally{
  if(pid&&alive(pid)){
   // Only this test's exact fixture executable may be cleaned; never kill by port.
   const command=execFileSync('ps',['-p',String(pid),'-o','command='],{encoding:'utf8'});
   assert.ok(command.includes(app),'refuse unrelated process');process.kill(pid,'SIGTERM');
  }
  if(server.listening)await new Promise(r=>server.close(r));
  rmSync(top,{recursive:true,force:true});
 }
}
test('真实非HTTP外来listener占用时不得启动API child，且外来listener不被杀',async t=>{const r=await fixture(t,{foreign:true});assert.equal(r.status,1,r.stderr);assert.equal(r.foreignListening,true);assert.equal(r.launched,false,'raw occupied port must be rejected before starting own API');});
test('真实本人API就绪失败且保活时必须停止并回收本人child',async t=>{const r=await fixture(t);assert.equal(r.status,1,r.stderr);assert.equal(r.launched,true);assert.equal(r.childAlive,false,'failed API child must not survive its owner');});
