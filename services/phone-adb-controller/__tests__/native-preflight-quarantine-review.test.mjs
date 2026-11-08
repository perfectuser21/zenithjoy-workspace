import test from 'node:test';import assert from 'node:assert/strict';
const subject=await import('../native-preflight-quarantine-review.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
test('通用预检只读隔离审查必须有正式入口，不能复用cloudN专属authority',()=>{
 assert.equal(typeof subject.inspectReview,'function');assert.equal(typeof subject.planReview,'function');assert.equal(typeof subject.applyReview,'function');
});
test('原Worker已派发或只读证据缺失时必须拒绝，不能信输入stopped=true',()=>{
 assert.equal(typeof subject.verifyPreflightEvidence,'function');
 assert.throws(()=>subject.verifyPreflightEvidence({execution_stopped:true,readonly:true}),/REVIEW/);
});

import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const helper=fileURLToPath(new URL('../native-preflight-quarantine-lock.py',import.meta.url));
function localCase(code){return execFileSync('python3',['-I','-c',String.raw`
import importlib.util, tempfile, pathlib, json, os
spec=importlib.util.spec_from_file_location('review',${JSON.stringify(helper)})
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as d:
 root=pathlib.Path(d).resolve()/'durable';legacy=pathlib.Path(d).resolve()/'legacy'
 root.mkdir(mode=0o700);legacy.mkdir(mode=0o700)
 (root/'.migration-complete.json').write_text(json.dumps({'schema_version':1,'state':'complete','legacy_root':str(legacy)}));(root/'.migration-complete.json').chmod(0o600)
 serial='synthetic:10001';review_id='11111111-1111-4111-8111-111111111111'
 guard=root/(serial+'.guard');guard.touch(mode=0o600);os.link(guard,legacy/guard.name)
 active=root/(serial+'.lock');active.mkdir(mode=0o700)
 fields={'owner':'synthetic-owner\n','standalone_review_required':'synthetic-owner\n','preflight_epoch':'synthetic-epoch\n','preflight_proof_required':'synthetic-epoch\n','preflight_quarantined':'synthetic-epoch\n','acquired_at':'123\n'}
 for name,value in fields.items():
  p=active/name;p.write_text(value);p.chmod(0o600)
 facts={'original_execution_stopped':False,'observer':{'remote_unknown_preserved':True}}
 tx=m.Transaction(str(root),serial,review_id)
 def good(): pass
 def fails(action,expected):
  try: action()
  except Exception as e:
   assert expected in str(e),(expected,str(e));return
  raise AssertionError('accepted '+expected)
 try:
${code.split('\n').map(line=>'  '+line).join('\n')}
 finally: tx.close()
`],{encoding:'utf8',stdio:['ignore','pipe','pipe']});}

test('双根真实guard与inodeCAS迁移，只移动本地屏障，旧unknown和全部原字段保持',()=>localCase(`
plan=tx.plan(facts,good);before=active.stat().st_ino
result=tx.apply(facts,good)
assert not active.exists() and tx.retired.stat().st_ino==before
assert result['central_write_performed'] is False and result['original_execution_stopped'] is False
assert json.loads(m.read(tx.journal/'plan.json'))['facts']==facts
assert {p.name:m.read(p).decode() for p in tx.retired.iterdir()}==fields
assert tx.apply(facts,good)==result
`));
test('plan后任何owner字段或epoch漂移均拒，保留原屏障',()=>localCase(`
tx.plan(facts,good)
(active/'preflight_epoch').write_text('foreign\\n')
fails(lambda:tx.apply(facts,good),'LOCK_FIELDS')
assert active.exists() and not tx.retired.exists()
`));
test('相同字段但新inode冒名屏障不能通过CAS',()=>localCase(`
tx.plan(facts,good);saved=root/'original';active.rename(saved);active.mkdir(mode=0o700)
for name,value in fields.items():
 p=active/name;p.write_text(value);p.chmod(0o600)
fails(lambda:tx.apply(facts,good),'LOCK_DRIFT')
assert active.exists() and saved.exists()
`));
test('双根guard任一换inode即拒，不迁移屏障',()=>localCase(`
tx.plan(facts,good);other=legacy/guard.name;other.unlink();other.touch(mode=0o600)
fails(lambda:tx.apply(facts,good),'GUARD_DRIFT')
assert active.exists()
`));
test('持有双根同inode guard期间第二执行者不能进入',()=>localCase(`
fails(lambda:m.Transaction(str(root),serial,review_id),'temporarily unavailable')
assert active.exists()
`));
test('rename后丢返回可读回intent恢复，绝不重放原活动',()=>localCase(`
tx.plan(facts,good);count=[0]
def lose_ack():
 count[0]+=1
 if count[0]==4: raise ValueError('SYNTHETIC_ACK_LOST')
fails(lambda:tx.apply(facts,lose_ack),'SYNTHETIC_ACK_LOST')
assert not active.exists() and tx.retired.exists() and not (tx.journal/'apply.returned.json').exists()
assert (tx.journal/'apply.intent.json').exists()
assert tx.apply(facts,good)['state']=='superseded'
`));
test('rename后出现新owner时重入failclosed，不碰新owner',()=>localCase(`
tx.plan(facts,good);tx.apply(facts,good);active.mkdir(mode=0o700)
(active/'owner').write_text('new-owner\\n')
fails(lambda:tx.apply(facts,good),'LOCK_LOCATION')
assert (active/'owner').read_text()=='new-owner\\n' and tx.retired.exists()
`));
test('每一checkpoint授权拒绝即中止，intent未知不当成功',()=>localCase(`
tx.plan(facts,good);count=[0]
def denied():
 count[0]+=1
 if count[0]==3: raise ValueError('AUTHORITY_DRIFT')
fails(lambda:tx.apply(facts,denied),'AUTHORITY_DRIFT')
assert active.exists() and not tx.retired.exists()
assert not (tx.journal/'apply.returned.json').exists()
`));
test('journal插入不明文件后不得apply',()=>localCase(`
tx.plan(facts,good);(tx.journal/'foreign').touch()
fails(lambda:tx.apply(facts,good),'JOURNAL_INVENTORY')
assert active.exists()
`));
test('已有intent内容不匹配不得重放',()=>localCase(`
tx.plan(facts,good);m.durable(tx.journal/'apply.intent.json',{'foreign':True})
fails(lambda:tx.apply(facts,good),'INTENT_DRIFT')
assert active.exists()
`));

import {mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';
import {callerClosed,observerClosed,nativeClosed,inventory,sha,canonical,reviewedSourceHashes} from '../native-preflight-quarantine-evidence.mjs';
function fixture(work){const root=realpathSync(mkdtempSync(join(tmpdir(),'preflight-review-test-'))),write=(name,value)=>{const p=join(root,name);mkdirSync(dirname(p),{recursive:true,mode:0o700});writeFileSync(p,typeof value==='string'?value:JSON.stringify(value),{mode:0o600});};try{return work({root,write});}finally{rmSync(root,{recursive:true,force:true});}}
const identity={task_id:'11111111-1111-4111-8111-111111111111',run_id:'synthetic__a1',binding_id:'22222222-2222-4222-8222-222222222222',source_commit:'a'.repeat(40),profile:'synthetic',serial:'synthetic:10001',owner:'synthetic',epoch:'33333333-3333-4333-8333-333333333333'};
function workerFixture(write){
 const paths=['skill-primary/preflight/official-control','commander-preflight/caller/official-control','commander-cleanup/caller/official-control'];
 const turn={index:0,official_run_id:'raw-synthetic',source_session_id:'source',source_session_key:'key',execution_session_id:'execution',dispatched:false,accepted:false,official_terminal:false,recovered:false};
 const stop={...turn,event:'raw_stop_verified',session_id:'execution',status:'not_started',official_execution_stopped:true,external_effect_unknown:false,previous_caller_stop_unproven:false,transport_proofs:[]};
 const snapshot={sealed:true,pending:0,execution_stopped:true,caller_execution_stopped:true,execution_unknown:false,external_effect_unknown:false,previous_caller_stop_unproven:false,final_record_failed:false};
 for(const [i,p]of paths.entries()){write(p+'/ledger','');write(p+'/official-caller-final-1111.json',{...identity,snapshot,not_recovery_authority:true,journal_closed:true,evidence_complete:true,ledger:{file:'ledger',sha256:sha(''),bytes:0},artifacts:[],raw_turns:i===0?[turn]:[]});}
 write(paths[0]+'/official-authority-1111.jsonl',JSON.stringify(stop)+'\n');return {paths,turn,stop,snapshot};
}
test('Worker从未派发正证与三个Caller封闭必须联合成立',()=>fixture(({root,write})=>{
 const f=workerFixture(write);callerClosed(root,inventory(root),identity);
 write(f.paths[0]+'/official-authority-1111.jsonl','');assert.throws(()=>callerClosed(root,inventory(root),identity),/RAW_STOP/);
 write(f.paths[0]+'/official-authority-1111.jsonl',JSON.stringify(f.stop)+'\n');
 write(f.paths[0]+'/official-caller-final-1111.json',{...identity,snapshot:f.snapshot,not_recovery_authority:true,journal_closed:true,evidence_complete:true,ledger:{file:'ledger',sha256:sha(''),bytes:0},artifacts:[],raw_turns:[{...f.turn,dispatched:true}]});assert.throws(()=>callerClosed(root,inventory(root),identity),/WORKER_DISPATCHED/);
}));
test('Caller引用原件hash变动或封闭false拒绝',()=>fixture(({root,write})=>{
 const f=workerFixture(write);write(f.paths[1]+'/ledger','changed');assert.throws(()=>callerClosed(root,inventory(root),identity),/CALLER_ARTIFACT/);
 write(f.paths[1]+'/ledger','');write(f.paths[2]+'/official-caller-final-1111.json',{...identity,snapshot:{...f.snapshot,caller_execution_stopped:false},not_recovery_authority:true,journal_closed:true,evidence_complete:true,ledger:{file:'ledger',sha256:sha(''),bytes:0},artifacts:[],raw_turns:[]});assert.throws(()=>callerClosed(root,inventory(root),identity),/CALLER_CLOSED/);
}));
function observerFixture(write){
 const closed={request_closed:true,websocket_closed:true,socket_closed:true},receipt={successful_tool_names_array:true,successful_tool_names_empty:true,rerouted_false:true,expected_session_id_matches:true,run_id_matches:true};
 const leaf={code:0,signal:null,closing:true,process_closed:true,stdin_closed:true,stdout_closed:true,stderr_closed:true,fd_closed:true};
 const evidence={domain:'runner-official-observer/v1',sdk:{sealed:true,pending:0,execution_unknown:true},control:{sealed:true,pending:0,execution_stopped:true,caller_execution_stopped:true},owner:{sealed:true,pending:0,execution_unknown:true,calibration:{positive_closed:true,fork_denied:true},leaves:[{...leaf,purpose:'calibration-positive'},{...leaf,purpose:'calibration-negative',code:1},{...leaf,purpose:'owner'}]}};
 const event={phase:'commander_domain_closed',evidence:{domain:'runner-phone-observer/v1',execution_stopped:false,activities:[{activity:'preflight',evidence}]}};
 write('activity-events.jsonl',JSON.stringify(event)+'\n');const prefix='commander-preflight/sdk/synthetic';write(prefix+'.agent.rpc.json',{...closed,dispatched:true});write(prefix+'.agent.wait.rpc.json',{...closed,dispatched:true,response_received:true});write(prefix+'.agent.response.json',{agent_meta:{provider_matches:true,model_matches:true,agent_harness_id_matches:true},receipt});write(prefix+'.agent.wait.response.json',{receipt:{...receipt,declared:true}});return {event,evidence,prefix,receipt};
}
test('Observer远端unknown保留，仅本地全部封闭+无工具回执允许非干扰',()=>fixture(({root,write})=>{
 const f=observerFixture(write),result=observerClosed(root,inventory(root),identity);assert.equal(result.remote_execution_stopped,false);assert.equal(result.remote_unknown_preserved,true);
 write(f.prefix+'.agent.response.json',{agent_meta:{provider_matches:true,model_matches:true,agent_harness_id_matches:true},receipt:{...f.receipt,successful_tool_names_empty:false}});assert.throws(()=>observerClosed(root,inventory(root),identity),/OBSERVER_TOOL_OR_DELIVERY/);
}));
test('Observer本地owner或transport未封闭必须拒',()=>fixture(({root,write})=>{
 const f=observerFixture(write);f.evidence.owner.leaves[2].fd_closed=false;write('activity-events.jsonl',JSON.stringify(f.event)+'\n');assert.throws(()=>observerClosed(root,inventory(root),identity),/OWNER_PROCESS_OPEN/);
 f.evidence.owner.leaves[2].fd_closed=true;write('activity-events.jsonl',JSON.stringify(f.event)+'\n');write(f.prefix+'.agent.rpc.json',{dispatched:true,request_closed:true,websocket_closed:false,socket_closed:true});assert.throws(()=>observerClosed(root,inventory(root),identity),/OBSERVER_TRANSPORT_OPEN/);
}));
function nativeFixture(root,write){
 const boundary='darwin-sandbox-deny-process-fork-v1',leaf={code:0,signal:null,tainted:false,boundary,request_returned:true,ended_at:'synthetic'};
 const ledger=i=>join(root,i+'.jsonl');for(const i of ['local','adb'])write(i+'.jsonl',Array.from({length:2},()=>[{event:'intent'},{event:'started',pid:1},{event:'returned',pid:1,code:0,signal:null,tainted:false}]).flat().map(JSON.stringify).join('\n')+'\n');
 const physical={domain:'parent-preflight-local-nofork-v1',execution_stopped:true,pending:0,command_failures:0,local:{sealed:true,execution_stopped:true,leaves:[{...leaf,operation:'lock'},{...leaf,operation:'route'}],ledger:ledger('local')},adb:{complete:true,requests_returned:true,leaves:[{...leaf,argv_sha256:sha(JSON.stringify(['version']))},{...leaf,argv_sha256:sha(JSON.stringify(['-H','127.0.0.1','-P','5037','-s',identity.serial,'get-state']))}],ledger:ledger('adb')}};
 write('preflight-native-domain-close.jsonl',JSON.stringify({...identity,activity:'preflight',official_stopped:true,resource_unknown:false,physical,control:{sealed:true,pending:0,execution_stopped:true}})+'\n');
 const prefix='native-phone/preflight/command-0',command={operation:'sdk',error_code:null,scope:{...identity,endpoint:'tcp:127.0.0.1:5037'},wire_snapshot:{sealed:true,pending:0,open_sockets:0,unknown:false,wire_complete:true}};write(prefix+'.native.json',command);
 const frame=t=>Buffer.from(Buffer.byteLength(t).toString(16).padStart(4,'0')+t),wire=[frame('host-serial:'+identity.serial+':features'),frame('host:transport:'+identity.serial),frame("shell,v2,raw:exec /system/bin/getprop 'ro.build.version.sdk'"),Buffer.from([4,0,0,0,0])];for(const [i,b]of wire.entries())write(prefix+'/write-'+i+'.intent.json',{bytes:b.length,sha256:sha(b)});
 write('runtime/config/native-phone-command-sources.json',{device_sources:[{profile:identity.profile,serial:identity.serial,program_files:[{path:'/synthetic/readonly',sha256:sha('readonly')}]}]});write('native-phone/preflight/source/read-0.intent.json',{id:0,path:'/synthetic/readonly'});write('native-phone/preflight/source/read-0.returned.json',{id:0,path:'/synthetic/readonly',sha256:sha('readonly'),peer_eof:true,socket_closed:true});return {command,prefix};
}
test('手机native只读literal wire正证；修改为输入/未知源码读取/额外域必须拒绝',()=>fixture(({root,write})=>{
 const f=nativeFixture(root,write);nativeClosed(root,inventory(root),identity);
 write(f.prefix+'/write-2.intent.json',{bytes:2,sha256:sha('input tap')});assert.throws(()=>nativeClosed(root,inventory(root),identity),/PHONE_WIRE/);
 nativeFixture(root,write);write('native-phone/preflight/source/read-0.unknown.json',{});assert.throws(()=>nativeClosed(root,inventory(root),identity),/SOURCE_READ_UNKNOWN/);
}));
test('预检以外任何手机生产者与未返回read均拒',()=>fixture(({root,write})=>{
 nativeFixture(root,write);write('native-phone/cleanup/command-0.native.json',{});assert.throws(()=>nativeClosed(root,inventory(root),identity),/EXTRA_PRODUCER/);
}));
test('审查source字节族不能通过导出引用扩大',()=>{assert.ok(Object.isFrozen(reviewedSourceHashes));for(const a of Object.values(reviewedSourceHashes))assert.ok(Object.isFrozen(a));});

function reviewTask(){return {id:'44444444-4444-4444-8444-444444444444',status:'in_progress',claimed_by:'synthetic-reviewer',claimed_at:'2026-11-09T00:00:00Z',payload:{native_preflight_quarantine_review:{protocol:'native-preflight-quarantine-review/v1',original:{...identity,run_id:'douyin_video_discovery-synthetic__a1'},run_dir:'/synthetic/run',archive_path:'/synthetic/original.tar.gz',archive_sha256:'b'.repeat(64),launcher:{source_path:'/synthetic/source',source_sha256:'c'.repeat(64),started_path:'/synthetic/started',started_sha256:'d'.repeat(64),exit_path:'/synthetic/exit',exit_sha256:'e'.repeat(64)}}}};}
test('维护Task必须实际active claim，不能给stopped/readonly true旗标授权',()=>{
 const task=reviewTask(),valid=subject.validateReviewTask(task,task.id);assert.equal(valid.claim.claimed_by,task.claimed_by);
 for(const mutate of [t=>t.claimed_by=null,t=>t.status='completed',t=>t.payload.native_preflight_quarantine_review.execution_stopped=true,t=>t.payload.native_preflight_quarantine_review.original.task_id=t.id,t=>t.payload.native_preflight_quarantine_review.archive_sha256='']){const other=structuredClone(task);mutate(other);assert.throws(()=>subject.validateReviewTask(other,other.id),/PREFLIGHT_REVIEW/);}
});
test('公网/非只读Brain路径在任何fetch之前拒绝',async()=>{
 for(const p of ['/api/brain/device-locks/release','http://foreign/api/brain/device-locks','/api/brain/tasks/../../secrets'])await assert.rejects(subject.readBrain(p),/BRAIN_PATH/);
});
test('原件archive真实读回hash全集；tar链接或路径逃逸拒绝',()=>localCase(`
import tarfile,io
archive=root/'original.tar';data=b'original-unknown-preserved'
with tarfile.open(archive,'w') as out:
 entry=tarfile.TarInfo('ledger/evidence.json');entry.size=len(data);out.addfile(entry,io.BytesIO(data))
archive.chmod(0o600);got=m.archive_manifest(str(archive))
assert got['files']=={'evidence.json':{'sha256':m.digest(data),'bytes':len(data)}}
assert got['sha256']==m.digest(m.read(archive))
for name,link in [('ledger/../../escape',False),('ledger/link',True)]:
 with tarfile.open(archive,'w') as out:
  entry=tarfile.TarInfo(name)
  if link: entry.type=tarfile.SYMTYPE;entry.linkname='/foreign'
  out.addfile(entry)
 fails(lambda:m.archive_manifest(str(archive)),'ARCHIVE_TYPE')
`));
