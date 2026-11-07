import test from 'node:test';import assert from 'node:assert/strict';
import {createServer,request as requestHttp} from 'node:http';import {mkdirSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';import {join} from 'node:path';
import {using} from './fixtures/official-control-fixture.mjs';
async function brain(f,probe,{windowMs}={}){
 const trace=[],sockets=new Set(),closed=[],states={warm:false,reply:null};let active=0,max=0,requestIndex=0;
 const server=createServer((req,res)=>{active++;max=Math.max(max,active);const row={path:req.url,at:Date.now(),active};trace.push(row);res.setHeader('Content-Type','application/json');res.setHeader('Connection','close');res.once('close',()=>active--);const value=f.routes.get(req.url);const send=()=>res.end(JSON.stringify(value??{}));if(!value)res.statusCode=404;if(states.reply)states.reply(req,res,send);else send();});
 server.on('connection',s=>{sockets.add(s);s.once('close',()=>sockets.delete(s));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const directory=join(f.journalDirectory,'head-parallel');mkdirSync(directory,{mode:0o700});const control=f.createControl({...f.options,...(windowMs?{deadlineMs:Date.now()+windowMs,cleanupDeadlineMs:Date.now()+windowMs+500}:{}),journalDirectory:directory,httpRequest:(opts,cb)=>{assert.equal(opts.method,'GET');const tag=states.tag?.(++requestIndex);const req=requestHttp({...opts,port:server.address().port,...(tag?{headers:{...opts.headers,'X-Owned-Test-Stream':tag}}:{})},cb);req.once('socket',s=>s.once('close',()=>closed.push({path:opts.path,at:Date.now()})));return req;}});
 try{await probe({control,trace,closed,states,directory,max:()=>max,reset(){trace.length=0;closed.length=0;max=0;requestIndex=0;}});}finally{await control.close();for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));}
}
function claim(f){f.routes.get('/api/brain/tasks/'+f.q.task_id).claimed_at='2026-11-06T00:00:00.000Z';}

test('second readonly B overlaps only binding and WF, then dispatches fresh Task followed by AV after head closure',async()=>using(async f=>{
 claim(f);await brain(f,async g=>{await g.control.readAuthorizedTaskClaim(f.q);g.reset();g.states.reply=(req,res,send)=>setTimeout(send,20);await g.control.readAuthorizedTaskClaim(f.q);assert.equal(g.trace.length,4);assert.equal(g.max(),2,'only the first two facts overlap after a completely validated first B');assert.equal(g.trace[0].path.endsWith('/definition'),true);assert.equal(g.trace[1].path.includes('/workflows/'),true);assert.equal(g.trace[2].path.includes('/tasks/'),true);assert.equal(g.trace[3].path.includes('/activities/'),true);assert.ok(g.closed.some(c=>c.path===g.trace[0].path&&c.at<=g.trace[2].at));assert.ok(g.closed.some(c=>c.path===g.trace[1].path&&c.at<=g.trace[2].at));assert.ok(g.closed.some(c=>c.path===g.trace[2].path&&c.at<=g.trace[3].at));
 const ledger=join(g.directory,readdirSync(g.directory).find(n=>/^official-authority-.*\.jsonl$/.test(n))),rows=readFileSync(ledger,'utf8').trim().split('\n').map(s=>JSON.parse(s));assert.equal(rows.length,20);for(const row of rows.filter(r=>r.event==='read_intent'||r.event==='read_returned')){assert.ok(Number.isSafeInteger(row.at));if(row.event==='read_returned')assert.ok(Number.isSafeInteger(row.response_ended_at)&&row.response_ended_at<=row.at);}});
},{rawTransport:true}));

for(const mode of ['withdraw-before-B','implementation-revoked','binding-pointer','scope-mismatch','wf-activity-pointer'])test('warm readonly B '+mode+' uses fresh facts and rejects unknown paths without fallback',async()=>using(async f=>{
 claim(f);await brain(f,async g=>{await g.control.readAuthorizedTaskClaim(f.q);g.reset();const task=f.routes.get('/api/brain/tasks/'+f.q.task_id);
  if(mode==='withdraw-before-B')task.status='paused';
  if(mode==='implementation-revoked')f.routes.get('/api/brain/activities/a1/versions/av1').version.payload.implementation_bindings[0].status='revoked';
  if(mode==='binding-pointer')f.routes.get('/api/brain/runs/'+f.q.run_id+'/definition').binding.workflow_id='foreign';
  if(mode==='scope-mismatch')task.payload.company_line='foreign';
  if(mode==='wf-activity-pointer')f.routes.get('/api/brain/workflows/w1/versions/wv1').version.payload.activities[0].activity_id='foreign';
  await assert.rejects(g.control.readAuthorizedTaskClaim(f.q));assert.equal(g.trace.length,mode==='binding-pointer'?2:mode==='implementation-revoked'?4:3);assert.equal(g.trace.some(r=>r.path.includes('foreign')),false);assert.equal(g.closed.length,g.trace.length);
 });
},{rawTransport:true}));

test('slow WF followed by Task pause is rejected, preserving the excluded all-four-parallel counterexample',async()=>using(async f=>{
 claim(f);await brain(f,async g=>{await g.control.readAuthorizedTaskClaim(f.q);g.reset();let paused=false;g.states.reply=(req,res,send)=>{if(req.url.includes('/workflows/')){setTimeout(()=>{f.routes.get('/api/brain/tasks/'+f.q.task_id).status='paused';paused=true;},20);setTimeout(send,80);}else send();};await assert.rejects(g.control.readAuthorizedTaskClaim(f.q),/TASK_SCOPE/);assert.equal(paused,true);assert.equal(g.trace.length,3);assert.equal(g.trace.at(-1).path.includes('/tasks/'),true);assert.equal(g.closed.length,3);});
},{rawTransport:true}));

test('slow Task followed by implementation withdrawal is rejected by a later actual AV GET',async()=>using(async f=>{
 claim(f);await brain(f,async g=>{await g.control.readAuthorizedTaskClaim(f.q);g.reset();let revoked=false;g.states.reply=(req,res,send)=>{if(req.url.includes('/tasks/')){setTimeout(()=>{f.routes.get('/api/brain/activities/a1/versions/av1').version.payload.implementation_bindings[0].status='revoked';revoked=true;},20);setTimeout(send,80);}else send();};await assert.rejects(g.control.readAuthorizedTaskClaim(f.q),/METHOD_BINDING/);assert.equal(revoked,true);assert.equal(g.trace.length,4);assert.equal(g.trace.at(-1).path.includes('/activities/'),true);assert.ok(g.closed.find(r=>r.path.includes('/tasks/')).at<=g.trace.at(-1).at);});
},{rawTransport:true}));

for(const fault of ['status','json','oversize'])test('warm head '+fault+' failure cancels the other actually pending owned response and closes both sockets',async()=>using(async f=>{
 claim(f);await brain(f,async g=>{await g.control.readAuthorizedTaskClaim(f.q);g.reset();const pending=[];g.states.reply=(req,res)=>{pending.push({req,res});if(pending.length!==2)return;const wf=pending.find(r=>r.req.url.includes('/workflows/')),binding=pending.find(r=>r.req.url.endsWith('/definition'));binding.res.write('{');if(fault==='status'){wf.res.statusCode=500;wf.res.end('{}');}if(fault==='json')wf.res.end('{bad');if(fault==='oversize')wf.res.end(JSON.stringify({padding:'x'.repeat(2*1024*1024)}));};await assert.rejects(g.control.readAuthorizedTaskClaim(f.q));assert.equal(pending.length,2,'both requests actually reached the owned server');assert.equal(g.trace.length,2);assert.equal(g.closed.length,2);assert.equal(g.control.snapshot().pending,0);});
},{rawTransport:true}));

test('seal during two pending head reads cancels both before close can attest stopped',async()=>using(async f=>{
 claim(f);await brain(f,async g=>{await g.control.readAuthorizedTaskClaim(f.q);g.reset();let ready;const both=new Promise(r=>ready=r);g.states.reply=(req,res)=>{res.write('{');if(g.trace.length===2)ready();};let returned=false;const work=g.control.readAuthorizedTaskClaim(f.q).then(()=>{returned=true;});work.catch(()=>{});await both;const stopped=await g.control.close();await assert.rejects(work,/CLOSED/);assert.equal(returned,false);assert.equal(g.closed.length,2);assert.equal(stopped.pending,0);assert.equal(stopped.execution_stopped,true);});
},{rawTransport:true}));

test('Source changed after parallel head is still rejected by the original final Source sampling',async()=>using(async f=>{
 claim(f);const path=join(f.runtimeRoot,'commander/AGENTS.md'),original=readFileSync(path);try{await brain(f,async g=>{await g.control.readAuthorizedTaskClaim(f.q);g.reset();g.states.reply=(req,res,send)=>{if(req.url.includes('/activities/'))writeFileSync(path,Buffer.concat([original,Buffer.from('\nowned drift\n')]));send();};await assert.rejects(g.control.readAuthorizedTaskClaim(f.q),/SOURCE/);assert.equal(g.trace.length,4);assert.equal(g.closed.length,4);});}finally{writeFileSync(path,original);}
},{rawTransport:true}));

test('deadline with both head HTTP responses genuinely hanging cancels both and returns no projection',async()=>using(async f=>{
 claim(f);await brain(f,async g=>{await g.control.readAuthorizedTaskClaim(f.q);g.reset();let bothReached=false;g.states.reply=(req,res)=>{res.write('{');if(g.trace.length===2)bothReached=true;};let returned=false;const work=g.control.readAuthorizedTaskClaim(f.q).then(()=>{returned=true;});work.catch(()=>{});await assert.rejects(work,/DEADLINE/);const stopped=await g.control.close();assert.equal(bothReached,true);assert.equal(returned,false);assert.equal(g.closed.length,2);assert.equal(stopped.pending,0);assert.equal(stopped.execution_stopped,true);},{windowMs:2000});
},{rawTransport:true}));

test('one failed warm head cancels only its own pending read, not a concurrent healthy B',async()=>using(async f=>{
 claim(f);await brain(f,async g=>{await g.control.readAuthorizedTaskClaim(f.q);g.reset();g.states.tag=index=>index<=2?'failing':'healthy';const failed=[];
 g.states.reply=(req,res,send)=>{if(req.headers['x-owned-test-stream']!=='failing'){send();return;}failed.push({req,res});if(failed.length===2){failed.find(r=>r.req.url.endsWith('/definition')).res.write('{');const wf=failed.find(r=>r.req.url.includes('/workflows/'));wf.res.statusCode=500;wf.res.end('{}');}};
 const results=await Promise.allSettled([g.control.readAuthorizedTaskClaim(f.q),g.control.readAuthorizedTaskClaim(f.q)]);assert.equal(results[0].status,'rejected');assert.equal(results[1].status,'fulfilled');assert.equal(results[1].value.id,f.q.task_id);assert.equal(failed.length,2);assert.equal(g.trace.length,6);assert.equal(g.closed.length,6);assert.equal(g.control.snapshot().pending,0);});
},{rawTransport:true}));
