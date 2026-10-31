import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {createServer as createHTTPServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync,execFileSync,spawn} from 'node:child_process';
const source=readFileSync(new URL('../smoke/structured-workbench-smoke.sh',import.meta.url),'utf8');
const failFunction=source.match(/^fail\(\) \{[^\n]+\}$/m)[0];
const helper=fileURLToPath(new URL('../smoke/lib/workbench-api-process.sh',import.meta.url));
const startFunction='source "'+helper+'"';
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function fixture(t,{foreign=false,http=false,healthy=false,drift='',ignoreTerm=false,hanging=false,adjacentExtra=false,transientMs=0}={}){
 const top=mkdtempSync(join(tmpdir(),'workbench-owner-')),bin=join(top,'bin'),app=join(top,'owned-api.cjs'),pidFile=join(top,'child.pid');mkdirSync(bin);
 const server=http?createHTTPServer((q,r)=>r.end('healthy')):createServer(()=>{});server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;
 if(!foreign)await new Promise(r=>server.close(r));
 const transientHolder=transientMs?await occupiedPortFor(transientMs,port):null;
 const extra=adjacentExtra?createServer():null;if(extra){extra.listen(port+2,'127.0.0.1');await once(extra,'listening');}
 writeFileSync(app,`const fs=require('fs'),http=require('http');fs.writeFileSync(process.env.TEST_CHILD_PID,String(process.pid));if(process.env.TEST_IGNORE_TERM==='1')process.on('SIGTERM',()=>fs.writeFileSync(process.env.TEST_CHILD_PID+'.term','seen'));const s=http.createServer((q,r)=>{if(process.env.TEST_HEALTH_HANG==='1')return;r.statusCode=process.env.TEST_CHILD_HEALTHY==='1'?200:503;r.end('health');});s.on('error',e=>fs.writeFileSync(process.env.TEST_CHILD_PID+'.error',e.code));s.listen(Number(process.env.PORT),()=>console.log('Works Management API + Agent WS running on port '+process.env.PORT));setInterval(()=>{},1000);`);
 writeFileSync(join(bin,'node'),'#!/bin/sh\ncase "$1" in apps/api/dist/index.js) exec "$TEST_REAL_NODE" "$TEST_CHILD_APP" "$@";; *) exec "$TEST_REAL_NODE" "$@";; esac\n',{mode:0o755});
 writeFileSync(join(bin,'curl'),'#!/bin/sh\nexec /usr/bin/curl --max-time 1 "$@"\n',{mode:0o755});
 writeFileSync(join(bin,'sleep'),'#!/bin/sh\nexec /bin/sleep 0.03\n',{mode:0o755});
 let pid;
 try{
  const trap="trap '"+'printf "%s" "${API_PID:-}" > "$TEST_STARTED_PID"'+"' EXIT";
  const mutation=drift==='birth'?'API_START_ID=changed':drift==='parent'?'API_OWNER_PID=0':':';
  const command=[failFunction,startFunction,trap,'start_api "$1" "$2"',mutation,'workbench_stop_started_child',adjacentExtra?'start_api "$3" "$4"; workbench_stop_started_child':''].filter(Boolean).join('\n');
  const startedAt=performance.now();
  const r=spawnSync('/bin/bash',['-c',command,'fixture',String(port),join(top,'api.log'),String(port+1),join(top,'mutation.log')],{encoding:'utf8',timeout:hanging?45000:5000,env:{...process.env,PATH:bin+':'+process.env.PATH,TEST_REAL_NODE:process.execPath,TEST_CHILD_APP:app,TEST_CHILD_PID:pidFile,TEST_STARTED_PID:join(top,'started.pid'),TEST_CHILD_HEALTHY:healthy?'1':'0',TEST_IGNORE_TERM:ignoreTerm?'1':'0',TEST_HEALTH_HANG:hanging?'1':'0'}});
  for(let n=0;n<100&&!existsSync(pidFile);n++)await pause(10);
  const started=readFileSync(join(top,'started.pid'),'utf8');if(started)pid=Number(started);
  return {duration:performance.now()-startedAt,error:r.error,extraListening:extra?.listening,status:r.status,stderr:r.stderr,launched:!!pid,childAlive:!!pid&&alive(pid),foreignListening:foreign&&server.listening,termSeen:existsSync(pidFile+'.term')};
 }finally{
  if(pid&&alive(pid)){
   // Only this test's exact fixture executable may be cleaned; never kill by port.
   const command=execFileSync('ps',['-p',String(pid),'-o','command='],{encoding:'utf8'});
   assert.ok(command.includes(app),'refuse unrelated process');process.kill(pid,'SIGTERM');
  }
  if(extra?.listening)await new Promise(r=>extra.close(r));
  if(transientHolder?.exitCode===null)transientHolder.kill();
  if(server.listening)await new Promise(r=>server.close(r));
  rmSync(top,{recursive:true,force:true});
 }
}
test('真实非HTTP外来listener占用时不得启动API child，且外来listener不被杀',async t=>{const r=await fixture(t,{foreign:true});assert.equal(r.status,1,r.stderr);assert.equal(r.foreignListening,true);assert.equal(r.launched,false,'raw occupied port must be rejected before starting own API');});
test('真实本人API就绪失败且保活时必须停止并回收本人child',async t=>{const r=await fixture(t);assert.equal(r.status,1,r.stderr);assert.equal(r.launched,true);assert.equal(r.childAlive,false,'failed API child must not survive its owner');});

test('真实外来HTTP listener也拒绝且不杀外来进程',async t=>{const r=await fixture(t,{foreign:true,http:true});assert.equal(r.status,1,r.stderr);assert.equal(r.foreignListening,true);assert.equal(r.launched,false);});
test('本人真实listen回调与HTTP就绪同时通过，正常收尾回收child',async t=>{const r=await fixture(t,{healthy:true});assert.equal(r.status,0,r.stderr);assert.equal(r.launched,true);assert.equal(r.childAlive,false);});
for(const drift of ['birth','parent'])test('本人child的'+drift+'身份漂移拒绝发信号且保留unknown',async t=>{const r=await fixture(t,{healthy:true,drift});assert.equal(r.status,1);assert.match(r.stderr,/WORKBENCH_CHILD_STOP_IDENTITY_UNKNOWN/);assert.equal(r.childAlive,true);});
test('本人failed child实际忽略TERM时仍同身份有界KILL并wait回收',async t=>{const r=await fixture(t,{ignoreTerm:true});assert.equal(r.status,1,r.stderr);assert.equal(r.termSeen,true);assert.equal(r.childAlive,false);});

test('p+2由外来listener持有时，p及p+1实际本人API均可就绪并回收',async t=>{const r=await fixture(t,{healthy:true,adjacentExtra:true});assert.equal(r.status,0,r.stderr);assert.equal(r.extraListening,true);assert.equal(r.childAlive,false);});
test('本人HTTP health真实不返回时40秒deadline仍收束并回收本人child',async t=>{const r=await fixture(t,{hanging:true});assert.equal(r.error,undefined);assert.equal(r.status,1,r.stderr);assert.ok(r.duration>=39000&&r.duration<44000,String(r.duration));assert.equal(r.childAlive,false);});

async function occupiedPortFor(ms,specifiedPort){
 let port=specifiedPort;
 if(!port){const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');port=reservation.address().port;await new Promise(r=>reservation.close(r));}
 const holder=spawn(process.execPath,['-e',`const net=require('net');const s=net.createServer();s.listen(${port},'127.0.0.1',()=>{console.log('ready');setTimeout(()=>s.close(()=>process.exit(0)),${ms})})`],{stdio:['ignore','pipe','pipe']});
 await once(holder.stdout,'data');return specifiedPort?holder:{port,holder};
}
test('A29 夹具退出后端口短暂占用，A30 有界等释放再启动',async t=>{
 const r=await fixture(t,{healthy:true,transientMs:400});
 assert.equal(r.status,0,r.stderr);assert.equal(r.launched,true);assert.equal(r.childAlive,false);
 assert.ok(r.duration>=200,'必须真实等待上一段释放端口');
});
test('外来 listener 长占端口仍须在两秒内明确失败，不清理外来进程',async t=>{
 const {port,holder}=await occupiedPortFor(5000);t.after(()=>{if(holder.exitCode===null)holder.kill();});
 const started=performance.now();
 const r=spawnSync('/bin/bash',['-c',failFunction+'\n'+startFunction+'\nworkbench_wait_port_available "$1"','fixture',String(port)],{encoding:'utf8',timeout:5000});
 assert.equal(r.status,1,r.stderr);assert.match(r.stderr,/WORKBENCH_PORT_STILL_BUSY/);
 assert.ok(performance.now()-started<3000,'端口占用不能无界等待');assert.equal(holder.exitCode,null,'不得杀外来进程');
});
