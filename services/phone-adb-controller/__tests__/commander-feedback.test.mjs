import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {cpSync,mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const source=resolve('services/phone-adb-controller/commander');
const read=p=>JSON.parse(readFileSync(p));
function fixture(t){
 const home=mkdtempSync(join(tmpdir(),'feedback-protocol-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
 const dir=join(home,'commander');cpSync(source,dir,{recursive:true});
 const input={text:'中文',flag:false};const definition={release_id:'release-test',snapshot_sha256:'a'.repeat(64),expected_path:[{reference_id:'ref',activity_id:'activity',required:true},{reference_id:'ref',activity_id:'activity',step_id:'step',required:true}]};
 const e={protocol:'commander-v2',task_id:'1234abcd-0000-4000-8000-000000000001',run_id:'wfd-feedback',attempt:1,owner_epoch:1,workflow_key:'report.generic',definition,input,input_sha256:createHash('sha256').update(JSON.stringify({flag:false,text:'中文'})).digest('hex'),contract:{execution_profile:'codex_agent',resources:{},activities:[{key:'report',by:'agent'}]},recovery:{max_attempts:1},deadline_at:new Date(Date.now()+600000).toISOString(),cleanup_deadline_at:new Date(Date.now()+900000).toISOString()};
 const file=join(home,'envelope.json');writeFileSync(file,JSON.stringify(e));
 const token=join(home,'token');writeFileSync(token,'fixture-token-never-log',{mode:0o600});
 const env={...process.env,HOME:home,WF_V2_NO_WORKER:'1',WF_INTERNAL_TOKEN_FILE:token,WF_BRAIN_URL:'http://127.0.0.1:1'};
 const run=join(home,'wf-agent-runs',e.run_id);
 const call=(command,data)=>spawnSync('python3',[join(dir,'wf-v2.py'),command,run],{env,encoding:'utf8',input:data&&JSON.stringify(data)});
 let r=spawnSync('python3',[join(dir,'wf-v2-io.py'),'manifest',dir,JSON.stringify({'release-test':{workflow_key:e.workflow_key,snapshot_sha256:definition.snapshot_sha256}})],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 r=spawnSync('bash',[join(dir,'wf-launch.sh'),'--envelope',file,'--parent-session','agent:work-commander:feedback'],{env,encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr);
 const asyncCall=command=>new Promise((resolve,reject)=>{const p=spawn('python3',[join(dir,'wf-v2.py'),command,run],{env});let stdout='',stderr='';p.stdout.on('data',x=>stdout+=x);p.stderr.on('data',x=>stderr+=x);p.on('error',reject);p.on('exit',status=>resolve({status,stdout,stderr}));});
 return {home,dir,run,env,e,call,asyncCall};
}
const fact=()=>({type:'activity_completed',data:{reference_id:'ref',activity_id:'activity',step_id:'step',started_at:'2026-10-13T10:00:00Z',ended_at:'2026-10-13T10:00:01Z',outcome:'pass',evidence:{path:'report.json',sha256:'a'.repeat(64)}}});
async function server(t,f,handler){
 const s=createServer((req,res)=>{let body='';req.on('data',x=>body+=x);req.on('end',()=>handler(JSON.parse(body),req,res));});
 await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>s.close(r)));f.env.WF_BRAIN_URL='http://127.0.0.1:'+s.address().port;return s;
}
test('非法活动在分seq前拒绝，原产物/预算不变，同attempt纠正使用原next seq',t=>{
 const f=fixture(t),events=join(f.run,'events.json'),original=readFileSync(events,'utf8');
 const artifact=join(f.run,'report.json');writeFileSync(artifact,'original report\n');const frozen=readFileSync(join(f.run,'envelope.json'),'utf8');
 const invalid=[d=>d.outcome='completed',d=>d.outcome=true,d=>d.reference_id='other',d=>d.step_id='other',d=>d.activity_id='other',d=>d.started_at='not-date',d=>d.started_at='2026-10-13',d=>d.ended_at='2026-10-12T10:00:00Z',d=>delete d.ended_at,d=>d.evidence=[],d=>d.evidence={},d=>d.model={}];
 for(const change of invalid){const event=fact();change(event.data);const r=f.call('event',event);assert.notEqual(r.status,0,JSON.stringify(event));assert.equal(readFileSync(events,'utf8'),original);}
 assert.notEqual(f.call('event',{type:'activity_completed',data:[]}).status,0);
 const r=f.call('event',fact());assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(JSON.parse(r.stdout).seq,read(events).length);
 assert.equal(readFileSync(join(f.run,'envelope.json'),'utf8'),frozen);assert.equal(readFileSync(artifact,'utf8'),'original report\n');
 for(const outcome of ['fail','skipped','unknown']){const e=fact();e.data.outcome=outcome;assert.equal(f.call('event',e).status,0);}
 const started={type:'activity_started',data:{reference_id:'ref',step_id:null,started_at:'2026-10-13T10:00:00Z',outcome:'unknown',evidence:{}}};assert.equal(f.call('event',started).status,0);
 assert.match(readFileSync(join(f.run,'msg.txt'),'utf8'),/pass\|fail\|skipped\|unknown/);
});
test('HTTP错误/伪2xx不ACK，CLI显示真实pending；合法同seq回执才前进',async t=>{
 const f=fixture(t);let mode='503';const received=[];
 await server(t,f,(event,req,res)=>{assert.equal(req.headers.authorization,'Bearer fixture-token-never-log');received.push(event);
  if(/^\d+$/.test(mode)){res.statusCode=Number(mode);res.end('fixture-token-never-log'.repeat(100));return;}
  const body=mode==='empty'?{}:mode==='wrong-seq'?{accepted:true,seq:event.seq+1}:mode==='string-seq'?{accepted:true,seq:String(event.seq)}:mode==='false'?{accepted:false,seq:event.seq}:{[mode]:true,seq:event.seq};res.end(JSON.stringify(body));
 });
 for(mode of ['503','500','401','422','empty','wrong-seq','string-seq','false']){
  const r=await f.asyncCall('replay');assert.notEqual(r.status,0,mode);const result=JSON.parse(r.stdout);assert.equal(result.replayed,false);assert.equal(result.ack_seq,0);assert.ok(result.pending>0);assert.equal(result.failed_seq,1);assert.ok(result.error.code);assert.equal(existsSync(join(f.run,'feedback-ack.json')),false);
  assert.equal(JSON.stringify(read(join(f.run,'feedback-replay.json'))).includes('fixture-token'),false);
 }
 mode='accepted';let r=await f.asyncCall('replay');assert.equal(r.status,0,r.stdout);assert.equal(JSON.parse(r.stdout).pending,0);assert.equal(read(join(f.run,'feedback-ack.json')).seq,read(join(f.run,'events.json')).length);
 const before=received.length;r=await f.asyncCall('replay');assert.equal(r.status,0);assert.equal(received.length,before);
});
test('服务端已commit但响应丢失，重放原seq与原内容，duplicate才ACK',async t=>{
 const f=fixture(t),committed=new Map();let calls=0;
 await server(t,f,(event,req,res)=>{calls++;if(!committed.has(event.seq)){committed.set(event.seq,event);res.destroy();return;}assert.deepEqual(event,committed.get(event.seq));res.end(JSON.stringify({duplicate:true,seq:event.seq}));});
 const original=readFileSync(join(f.run,'events.json'),'utf8');assert.notEqual((await f.asyncCall('replay')).status,0);assert.equal(existsSync(join(f.run,'feedback-ack.json')),false);
 assert.equal((await f.asyncCall('replay')).status,0);assert.equal(committed.size,1);assert.equal(calls,2);assert.equal(readFileSync(join(f.run,'events.json'),'utf8'),original);
});
test('旧毒事件保持原字节pending，worker不因运输失败改delivery或追加终态',async t=>{
 const f=fixture(t),events=join(f.run,'events.json');const old=read(events);const poisoned=fact();poisoned.data.outcome='completed';old.push({...old[0],seq:2,...poisoned});
 const delivery={status:'completed',outputs:{report:'original'},cleanup:{completed:true},input:f.e.input};old.push({...old[0],seq:3,type:'delivery',data:delivery});writeFileSync(events,JSON.stringify(old));writeFileSync(join(f.run,'delivery.json'),JSON.stringify(delivery));writeFileSync(join(f.run,'feedback-ack.json'),JSON.stringify({seq:1}));
 const before=readFileSync(events,'utf8'),deliveryBefore=readFileSync(join(f.run,'delivery.json'),'utf8');
 await server(t,f,(event,req,res)=>{assert.equal(event.seq,2);res.statusCode=422;res.end('{"error":"invalid outcome"}');});
 assert.equal((await f.asyncCall('worker')).status,0);assert.equal(readFileSync(events,'utf8'),before);assert.equal(readFileSync(join(f.run,'delivery.json'),'utf8'),deliveryBefore);assert.equal(read(join(f.run,'feedback-ack.json')).seq,1);assert.equal(existsSync(join(f.run,'execution-failure.json')),false);
 const status=f.call('status');assert.equal(status.status,0,status.stdout);assert.equal(JSON.parse(status.stdout).feedback.pending,2);assert.equal(JSON.parse(status.stdout).feedback.failed_seq,2);assert.notEqual((await f.asyncCall('replay')).status,0);
});
