import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {syncBuiltinESMExports} from 'node:module';
import {using} from './fixtures/official-control-fixture.mjs';

const ledger=f=>join(f.journalDirectory,fs.readdirSync(f.journalDirectory).find(n=>/^official-authority-.*\.jsonl$/.test(n)));
const events=f=>fs.readFileSync(ledger(f),'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s));
function observe(f,hook=()=>{}){
 const original=fs.fsyncSync,fdIdentity=fs.statSync(ledger(f));let syncs=[];
 fs.fsyncSync=fd=>{const st=fs.fstatSync(fd);if(st.dev===fdIdentity.dev&&st.ino===fdIdentity.ino){const rows=events(f);syncs.push(rows);hook(rows,fd);}return original(fd);};syncBuiltinESMExports();
 return {syncs,restore(){fs.fsyncSync=original;syncBuiltinESMExports();}};
}
function claimed(f){f.routes.get('/api/brain/tasks/'+f.q.task_id).claimed_at='2026-11-06T00:00:00.000Z';}
const expected=['read_intent','read_returned','read_intent','read_returned','read_intent','read_returned','read_intent','read_returned','raw_parent_authority','task_claim_projected'];

test('readonly claim returns only after all ten original events share one durable sync and all four HTTP sockets close',async()=>using(async f=>{
 claimed(f);const sockets=[];let control,proofReturned=false;const directory=join(f.journalDirectory,'socket-control');fs.mkdirSync(directory,{mode:0o700});
 control=f.createControl({...f.options,journalDirectory:directory,httpRequest:(opts,cb)=>{const req=f.options.httpRequest(opts,cb);req.once('socket',s=>{const row={closed:false};s.once('close',()=>row.closed=true);sockets.push(row);});return req;}});
 const g={...f,journalDirectory:directory};let called=0;const io=observe(g,rows=>{called++;assert.equal(proofReturned,false);if(rows.at(-1)?.event==='task_claim_projected'){assert.equal(sockets.length,4);assert.ok(sockets.every(s=>s.closed));}});
 try{const claim=await control.readAuthorizedTaskClaim(f.q);proofReturned=true;assert.equal(claim.id,f.q.task_id);assert.equal(f.count(),4);assert.equal(called,1,'only readonly projection may group ten records into one sync');assert.deepEqual(io.syncs[0].map(r=>r.event),expected,'all ten records must already exist at the sole durability boundary');assert.deepEqual(events(g).map(r=>r.event),expected);}finally{io.restore();await control.close();}
},{rawTransport:true}));

test('nonprojecting parent authorization retains original per-event durability',async()=>using(async f=>{
 const io=observe(f);try{assert.equal(await f.instance.authorizeParentContext(f.q),true);assert.equal(io.syncs.length,9);assert.deepEqual(io.syncs.map(x=>x.at(-1).event),expected.slice(0,9));}finally{io.restore();}
},{rawTransport:true}));

test('parallel readonly claims each flush before projection without deferring simultaneous ordinary authorization',async()=>using(async f=>{
 claimed(f);const io=observe(f);let returned=0;
 try{const jobs=[f.instance.readAuthorizedTaskClaim(f.q).then(x=>{returned++;assert.ok(io.syncs.some(rows=>rows.some(r=>r.event==='task_claim_projected')));return x;}),f.instance.readAuthorizedTaskClaim(f.q).then(x=>{returned++;return x;}),f.instance.authorizeParentContext(f.q)];const values=await Promise.all(jobs);assert.equal(returned,2);assert.equal(values[2],true);assert.equal(f.count(),12);assert.equal(events(f).length,29);assert.equal(events(f).filter(r=>r.event==='task_claim_projected').length,2);assert.equal(io.syncs.length,11,'two private groups plus nine ordinary immediately durable records');}finally{io.restore();}
},{rawTransport:true}));

for(const mode of ['withdraw','invalidAV','source-changed'])test('readonly claim '+mode+' flushes all observed events but issues no projection',async()=>using(async f=>{
 claimed(f);const sourcePath=join(f.runtimeRoot,'commander/AGENTS.md'),original=fs.readFileSync(sourcePath);let control=f.instance;
 if(mode==='withdraw')f.routes.get('/api/brain/tasks/'+f.q.task_id).status='paused';
 if(mode==='invalidAV')f.routes.get('/api/brain/activities/a1/versions/av1').version.payload.implementation_bindings[0].status='revoked';
 if(mode==='source-changed'){const directory=join(f.journalDirectory,'source-change');fs.mkdirSync(directory,{mode:0o700});control=f.createControl({...f.options,journalDirectory:directory,httpRequest:(opts,cb)=>f.options.httpRequest(opts,res=>{if(opts.path.includes('/activities/'))res.once('end',()=>fs.writeFileSync(sourcePath,Buffer.concat([original,Buffer.from('\nsource changed\n')])));cb(res);})});}
 const g={...f,journalDirectory:mode==='source-changed'?join(f.journalDirectory,'source-change'):f.journalDirectory},io=observe(g);
 try{await assert.rejects(control.readAuthorizedTaskClaim(f.q));assert.equal(io.syncs.length,1);assert.equal(events(g).some(r=>r.event==='task_claim_projected'),false);assert.equal(f.count(),mode==='withdraw'?3:4);}finally{io.restore();fs.writeFileSync(sourcePath,original);if(control!==f.instance)await control.close();}
},{rawTransport:true}));

for(const mode of ['fsync-fails','inode-swapped'])test('readonly '+mode+' cannot return proof or claim stopped after flush failure',async()=>using(async f=>{
 claimed(f);const path=ledger(f);let swaps=0;const io=observe(f,rows=>{if(rows.at(-1)?.event==='task_claim_projected'){if(mode==='inode-swapped'){/* inode precheck must occur before fsync, so test replacement during final write below */}else throw Error('OWNED_TEST_SYNC_FAILURE');}});
 const originalWrite=fs.writeSync;
 if(mode==='inode-swapped'){fs.writeSync=(fd,bytes,...args)=>{const n=originalWrite(fd,bytes,...args);if(String(bytes).includes('task_claim_projected')&&!swaps++){fs.renameSync(path,path+'.old');fs.writeFileSync(path,'', {mode:0o600});}return n;};syncBuiltinESMExports();}
 try{await assert.rejects(f.instance.readAuthorizedTaskClaim(f.q),/JOURNAL/);assert.equal(f.instance.snapshot().execution_unknown,true);}finally{fs.writeSync=originalWrite;io.restore();syncBuiltinESMExports();}
 const stopped=await f.instance.close();assert.equal(stopped.execution_stopped,false);assert.equal(stopped.execution_unknown,true);
},{rawTransport:true}));

test('seal concurrent with HTTP read flushes its pending intent before job.done and close; no proof escapes',async()=>using(async f=>{
 claimed(f);const io=observe(f);let returned=false;const work=f.instance.readAuthorizedTaskClaim(f.q).then(()=>{returned=true;});work.catch(()=>{});
 try{await f.firstRequest;const stopped=await f.instance.close();await assert.rejects(work,/CLOSED/);assert.equal(returned,false);assert.equal(stopped.pending,0);assert.equal(io.syncs.length,2,'cancelled getter must flush before the separate close flush');assert.ok(io.syncs.some(rows=>rows.some(r=>r.event==='read_intent')));assert.equal(events(f).some(r=>r.event==='task_claim_projected'),false);}finally{io.restore();}
},{rawTransport:true,delay:true}));

// A synchronous IO fault hook models seal during the final durability boundary;
// no production injection capability or ambient deferral flag is added.
test('seal inside final flush is rechecked before readonly projection returns',async()=>using(async f=>{
 claimed(f);let sealed=false;const io=observe(f,rows=>{if(rows.at(-1)?.event==='task_claim_projected'){sealed=true;f.instance.seal();}});
 try{await assert.rejects(f.instance.readAuthorizedTaskClaim(f.q),/CLOSED/);assert.equal(sealed,true);assert.equal(io.syncs.length,1);assert.equal((await f.instance.close()).pending,0);}finally{io.restore();}
},{rawTransport:true}));

test('journal directory permissions changed during readonly fsync cannot produce proof',async()=>using(async f=>{
 claimed(f);const io=observe(f,rows=>{if(rows.at(-1)?.event==='task_claim_projected')fs.chmodSync(f.journalDirectory,0o755);});
 try{await assert.rejects(f.instance.readAuthorizedTaskClaim(f.q),/JOURNAL/);assert.equal(f.instance.snapshot().execution_unknown,true);}finally{io.restore();fs.chmodSync(f.journalDirectory,0o700);}
},{rawTransport:true}));

test('readonly flush crossing the original absolute deadline cannot return a projection',async()=>using(async f=>{
 claimed(f);const directory=join(f.journalDirectory,'flush-deadline');fs.mkdirSync(directory,{mode:0o700});const end=Date.now()+1000,control=f.createControl({...f.options,journalDirectory:directory,deadlineMs:end});let reached=false;
 const io=observe({...f,journalDirectory:directory},rows=>{if(rows.at(-1)?.event==='task_claim_projected'){reached=true;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,Math.max(1,end-Date.now()+20));}});
 try{await assert.rejects(control.readAuthorizedTaskClaim(f.q),/DEADLINE/);assert.equal(reached,true);assert.equal(io.syncs.length,1);assert.equal(f.count(),4);}finally{io.restore();await control.close();}
},{rawTransport:true}));
