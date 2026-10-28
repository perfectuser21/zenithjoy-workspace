// Synthetic host-only observation races; no phone, ADB or production process.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL,fileURLToPath} from 'node:url';
const source=fileURLToPath(new URL('../native-operation-receipt.mjs',import.meta.url));
const shim=String.raw`const fs=require('fs'),cp=require('child_process'),p=require('path');
const args=process.argv.slice(2),mode=args.at(-1),pid=args.at(-2),dir=process.env.NATIVE_RACE_DIR,scenario=process.env.NATIVE_RACE_CASE;
const log=x=>fs.appendFileSync(p.join(dir,'events.jsonl'),JSON.stringify({at:Date.now(),observer_pid:process.pid,mode,pid,...x})+'\n');
const inspector=['identity','children','group'].includes(mode);
log({event:'start',kind:inspector?'inspector':'watcher'});
if(!inspector&&scenario==='late-watcher'){
 fs.writeFileSync(p.join(dir,'watcher-started'),'1');process.on('SIGTERM',()=>{});
 setTimeout(()=>{process.stdout.write('READY\nEXIT\n');log({event:'end',kind:'watcher'});},700);
}else if(inspector){
 if(scenario==='held-pipe'&&mode==='children'){
  cp.spawn(process.execPath,['-e',"setTimeout(()=>process.stdout.write('[]'),1800);setTimeout(()=>process.exit(0),2200)"],{stdio:['ignore','inherit','inherit']});
  setTimeout(()=>{},3500);
 }
 let delay=mode==='children'?120:0;
 if(scenario==='pending-start'&&mode==='identity')delay=350;
 if(scenario==='slow-identity'&&mode==='identity')delay=2600;
 setTimeout(()=>{
  if(scenario==='malformed'&&mode==='children'){process.stdout.write('{bad-json');log({event:'end',kind:'inspector',malformed:true});return;}
  if(scenario==='held-pipe'&&mode==='children')return;
  const r=cp.spawnSync('/usr/bin/python3',args,{encoding:'utf8',timeout:1000});
  if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);log({event:'end',kind:'inspector'});process.exitCode=r.status||0;
 },delay);
}else{
 const c=cp.spawn('/usr/bin/python3',args,{stdio:'inherit'});let done=false;
 const ttl=setTimeout(()=>c.kill('SIGKILL'),5000);
 process.on('SIGTERM',()=>c.kill('SIGTERM'));
 c.once('error',()=>{clearTimeout(ttl);process.exitCode=2;});
 c.once('close',code=>{done=true;clearTimeout(ttl);log({event:'end',kind:'watcher'});process.exitCode=code||0;});
}
`;
const fixture=String.raw`import assert from 'node:assert/strict';
import fs from 'node:fs';import {spawn} from 'node:child_process';import {join} from 'node:path';import {performance} from 'node:perf_hooks';
const {beginNativeOperation,receiptPath}=await import(process.env.NATIVE_OBSERVER_URL);
const dir=process.env.NATIVE_RACE_DIR,scenario=process.env.NATIVE_RACE_CASE;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const events=()=>{try{return fs.readFileSync(join(dir,'events.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);}catch{return [];}};
const waitFor=async fn=>{const deadline=performance.now()+2500;while(!fn()){if(performance.now()>deadline)throw Error('synthetic prerequisite missing');await sleep(5);}};
// Root is real and detached, but always self-exits within4s even if driver fails.
const root=spawn(process.execPath,['-e',"process.stdout.write('READY\\n');setTimeout(()=>process.exit(0),4000);setInterval(()=>{},1000)"],{detached:true,stdio:['ignore','pipe','ignore']});
const closed=new Promise(r=>root.once('close',r));let rootClosed=false;void closed.then(()=>rootClosed=true);
const ready=new Promise((resolve,reject)=>{root.stdout.once('data',resolve);root.once('error',reject);});
const op=beginNativeOperation({runDir:dir,operationId:'synthetic-race',runId:'synthetic__a1',taskId:'synthetic-only',profile:'synthetic',serial:'NO-DEVICE',sourceCommit:'a'.repeat(40),owner:'synthetic-owner',activity:'preflight'});
let elapsed,terminalStable=false,startReturned=false,stopReturned=false,proof,maxChildren=0,scanCount=0,terminalBytes,stopElapsed;
const stopOnce=async()=>{const start=performance.now();const value=await op.stop(null,0,null);stopElapsed=performance.now()-start;proof=value;stopReturned=true;terminalBytes??=fs.readFileSync(receiptPath(dir,'synthetic-race'));return value;};
try{
 await ready;
 const startedAt=performance.now();const starting=op.started(root.pid).then(()=>{startReturned=true;});
 if(scenario==='pending-start'){
  await waitFor(()=>events().some(e=>e.mode==='identity'&&e.event==='start'));
  root.kill('SIGKILL');await closed;
  await Promise.all([starting,stopOnce()]);
 }else if(scenario==='late-watcher'){
  await waitFor(()=>fs.existsSync(join(dir,'watcher-started')));
  root.kill('SIGKILL');await closed;
  // Simulate a driver scheduling pause longer than the old 700ms watcher timer.
  // Late output must be ordered by the terminal receipt, not wall-clock luck.
  await sleep(900);
  await Promise.all([starting,stopOnce()]);
 }else{
  await starting;
  // For malformed, give polling an opportunity to consume the bad observation.
  if(scenario==='malformed')await waitFor(()=>events().some(e=>e.malformed));else await sleep(scenario==='singleflight'?700:200);
  fs.writeFileSync(join(dir,'stop-marker'),String(Date.now()));
  root.kill('SIGKILL');await closed;
  const stopStart=performance.now();const first=op.stop(null,0,null),second=op.stop(null,0,null);
  const [a,b]=await Promise.all([first,second]);assert.equal(a.ended_at,b.ended_at,'concurrent stop must wait for the same terminal observation');proof=a;stopElapsed=performance.now()-stopStart;stopReturned=true;terminalBytes=fs.readFileSync(receiptPath(dir,'synthetic-race'));
 }
 elapsed=performance.now()-startedAt;
 const file=receiptPath(dir,'synthetic-race'),before=terminalBytes||fs.readFileSync(file);
 await sleep(scenario==='held-pipe'?2400:scenario==='late-watcher'?1000:scenario==='pending-start'?800:200);
 terminalStable=before.equals(fs.readFileSync(file));
 const marker=Number(fs.existsSync(join(dir,'stop-marker'))?fs.readFileSync(join(dir,'stop-marker'),'utf8'):Infinity);
 const active=new Set();for(const e of events().filter(e=>e.mode==='children'&&e.at<marker)){
  if(e.event==='start'){active.add(e.observer_pid);scanCount++;maxChildren=Math.max(maxChildren,active.size);}else active.delete(e.observer_pid);
 }
 const lateWatcher=events().some(e=>e.kind==='watcher'&&e.event==='end'&&e.at>Date.parse(proof.ended_at));
 console.log(JSON.stringify({scenario,lateWatcher,stopElapsed,startReturned,stopReturned,elapsed,terminalStable,maxChildren,scanCount,status:proof.status,execution_stopped:proof.execution_stopped,rootClosed}));
}finally{
 if(!rootClosed)root.kill('SIGKILL');await closed;
 // Stop owns observer cancellation; no broad kill or arbitrary process-group kill.
 await op.stop(null,0,null).catch(()=>{});
}
`;
async function runCase(scenario){
 const dir=mkdtempSync(join(tmpdir(),'native-race-candidate-')),bin=join(dir,'bin');mkdirSync(bin);
 writeFileSync(join(bin,'python3'),'#!'+process.execPath+'\n'+shim,{mode:0o755});
 const entry=join(dir,'fixture.mjs');writeFileSync(entry,fixture);
 try{return await new Promise((resolve,reject)=>{
  const c=spawn(process.execPath,[entry],{env:{...process.env,PATH:bin+':'+process.env.PATH,NATIVE_RACE_DIR:dir,NATIVE_RACE_CASE:scenario,NATIVE_OBSERVER_URL:pathToFileURL(source).href},stdio:['ignore','pipe','pipe']});let out='',err='';
  // TTL4s root + watcher TTL5s is below this driver bound. No detached survivors.
  const timer=setTimeout(()=>c.kill('SIGKILL'),12000);c.stdout.on('data',b=>out+=b);c.stderr.on('data',b=>err+=b);c.once('error',reject);c.once('close',(code,signal)=>{clearTimeout(timer);if(code!==0||signal)reject(Error('fixture failed '+code+'/'+signal+': '+err));else{try{resolve(JSON.parse(out.trim()));}catch(e){reject(e);}}});
 });}finally{rmSync(dir,{recursive:true,force:true});}
}
for(const scenario of ['singleflight','pending-start','late-watcher','malformed','slow-identity','held-pipe'])test('真实合成原生观察竞态：'+scenario,{timeout:15000},async()=>{
 const r=await runCase(scenario);assert.equal(r.startReturned,true);assert.equal(r.stopReturned,true);assert.equal(r.rootClosed,true);assert.equal(r.terminalStable,true);assert.equal(r.status,'unknown');assert.equal(r.execution_stopped,false);
 assert.ok(r.elapsed<6000,'bounded observation must not hang: '+r.elapsed);
 if(scenario==='late-watcher')assert.equal(r.lateWatcher,true,'late READY/EXIT must actually happen after terminal receipt');
 if(['pending-start','late-watcher','held-pipe'].includes(scenario))assert.ok(r.stopElapsed<1500,'original1s tail plus scheduling tolerance remains bounded');
 if(scenario==='singleflight'){assert.ok(r.scanCount>=2,'actual slow scans must be reached');assert.equal(r.maxChildren,1,'poller cannot overlap children inspections before stop');}
});
