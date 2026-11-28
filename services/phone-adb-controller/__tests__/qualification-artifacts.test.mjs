import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {verifyQualificationArtifacts} from '../qualification-artifacts.mjs';
const python=realpathSync('/usr/bin/python3'),sha=b=>createHash('sha256').update(b).digest('hex');
const program=new URL('../qualification-artifacts.py',import.meta.url).pathname;
const vid='7707600173446204723',run='producer-run',owner='owned-lease';
function fixture(){
 const root=mkdtempSync(join(realpathSync(tmpdir()),'qualification-native-')),native=join(root,'native'),runtime=join(root,'runtime');mkdirSync(native);mkdirSync(runtime);
 const asset=(name,raw)=>{const path=join(native,name);writeFileSync(path,raw);return {path,sha256:sha(raw)};};
 const json=(name,value)=>asset(name,Buffer.from(JSON.stringify(value)));
 const eid=run+'-qual-record',client='a'.repeat(64),server='b'.repeat(64),sidecars={};
 const side=(name,raw)=>{sidecars[name]=asset(name,Buffer.from(raw));return name;};
 const fields={path:'/native/'+eid+'.rec.mkv',capture_audio_mode:'playback_dup',capture_audio_sdk:'34',playback_proof_kind:'native_audio',playback_package:'com.ss.android.ugc.aweme',native_audio_state:'started',native_audio_foreign_started:'0',capture_runtime_client_sha256:client,capture_runtime_server_sha256:server,native_audio_uid:'10203',native_audio_pid:'1234',audio_streams:'1'};
 for(const [key,suffix,raw]of [['native_audio_uid_owners_file','owners.txt','package:com.ss.android.ugc.aweme uid:10203'],['native_audio_evidence_file','audio.txt','AudioPlaybackConfiguration u/pid:10203/1234 state:started mutedState:none'],['playback_foreground_file','foreground.txt','com.ss.android.ugc.aweme/.DetailActivity'],['capture_audio_sdk_evidence_file','sdk.txt','34'],['capture_runtime_evidence_file','runtime.json',JSON.stringify({stage:{evidence_id:eid,serial:'127.0.0.1:15555',owner,execution_stop_unknown:false}})]]){
  const name=side(eid+'.'+suffix,raw);fields[key]=name;fields[key==='capture_runtime_evidence_file'?'capture_runtime_evidence_sha256':key.slice(0,-5)+'_sha256']=sidecars[name].sha256;
 }
 const stdout=f=>Object.entries(f).map(([k,v])=>k+'='+v).join('\n');
 const start={args:['record-start',eid,'60',vid],exit_code:0,stdout:stdout(fields)},stop={args:['record-stop',eid],exit_code:0,stdout:stdout(fields)};
 const link={args:['current-video-link',run+'-link'],exit_code:0,stdout:'video_id='+vid+'\ncontent_id='+vid+'\ncontent_type=video\nresolved_url=https://www.douyin.com/video/'+vid+'\nreopen_url=snssdk1128://aweme/detail/'+vid};
 const wav=Buffer.alloc(44+32000);wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(32000,40);for(let i=44;i<wav.length;i+=2)wav.writeInt16LE(123,i);
 const spec={video_id:vid,expected_run:run,evidence_id:eid,serial:'127.0.0.1:15555',local_owner:owner,required_seconds:1,client_sha256:client,server_sha256:server,start:json('start.json',start),stop:json('stop.json',stop),video_identity:json('link.json',link),wav:asset('audio.wav',wav),asr:json('asr.json',{http_status:200,body:{request_id:'actual-request',output:{output:{sentence:{text:'native transcript'}}}}}),asr_audio_sha256:sha(wav),sidecars};
 const controller=join(runtime,'douyin-phone-adb'),policy=join(root,'adb-policy.json'),registry=join(root,'registry.tsv'),runtimePolicy=join(runtime,'runtime/runtime-policy-sdk33.json');mkdirSync(join(runtime,'runtime'));writeFileSync(controller,'fixed controller');writeFileSync(policy,JSON.stringify({schema_version:1,host_id:'mmv',transport:'tcp',endpoint:'tcp:127.0.0.1:5044',forbidden_ports:[]}));writeFileSync(registry,'#schema=v2\nprofile\tserial\tenabled\ncloud\t127.0.0.1:15555\ttrue\n');writeFileSync(runtimePolicy,JSON.stringify({schema:'scrcpy-sdk33-pinned-v1',version:'3.3.4',client_sha256:client,server_sha256:server}));writeFileSync(join(runtime,'qualification-artifacts.py'),readFileSync(program));
 const context={host:'mmv',transport:'local',profile:'cloud',serial:'PHYSICAL1',adb_serial:'127.0.0.1:15555',account:'12345',runtime_root:runtime,phone_controller:controller,phone_controller_sha256:sha(readFileSync(controller)),adb_host_config:policy,adb_host_config_sha256:sha(readFileSync(policy)),phone_registry:registry,phone_registry_sha256:sha(readFileSync(registry)),verification:{artifact_checker:{command:[python,'unused-legacy-helper'],sha256:{[python]:sha(readFileSync(python))}},qualification_sha256:{'qualification-artifacts.py':sha(readFileSync(program)),'qualification-artifacts.mjs':sha(readFileSync(new URL('../qualification-artifacts.mjs',import.meta.url)))},runtime_sha256:{'runtime/runtime-policy-sdk33.json':sha(readFileSync(runtimePolicy)),'qualification-artifacts.py':sha(readFileSync(program))},'102':{video_ids:[vid]}},tasks:{'102':{task_id:'new-task',run_id:'new-execution',run_tag:run}},native_root:native};
 const input={context,spec,videoId:vid,originRun:run,platformAccounts:[{profile:'cloud',device_serial:'PHYSICAL1',douyin_id:'12345',enabled:true,verification_status:'verified'}]};
 const env={...process.env,ZJ_ADB_HOST_CONFIG:policy,DOUYIN_PHONE_REGISTRY:registry};
 const rewrite=(key,value)=>{spec[key]=json(key+'.json',value);};
 return {root,native,runtime,input,env,spec,start,stop,link,fields,asset,json,rewrite,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
async function check(f){return verifyQualificationArtifacts(f.input,{env:f.env,pythonBin:python});}
const accepted=r=>['capture_or_valid_cache','asr_error_classification','native_video_identity'].every(k=>r[k]==='passed');
async function rejected(f){try{assert.equal(accepted(await check(f)),false);}catch(e){if(e.code==='ERR_ASSERTION')throw e;assert.match(e.message,/^[A-Z_]+/);}}
test('original 4-argument VID and strict native link admit EID without embedded VID in actual Python',()=>{const f=fixture();try{const r=spawnSync(python,[program],{input:JSON.stringify({kind:'recording',spec:f.spec}),encoding:'utf8',timeout:5000});assert.equal(r.status,0);const proof=JSON.parse(r.stdout);assert.equal(accepted(proof),true,JSON.stringify(proof));}finally{f.cleanup();}});
test('physical account and separately pinned ADB route accept real Python originals without VID in EID',async()=>{const f=fixture();try{const r=await check(f);assert.equal(accepted(r),true);assert.equal(r.device_binding.physical_serial,'PHYSICAL1');assert.equal(r.device_binding.adb_serial,'127.0.0.1:15555');assert.equal(r.audio_seconds,1);}finally{f.cleanup();}});
const mutations={
 'wrong pinned host':f=>{const p=f.input.context.adb_host_config;const x=JSON.parse(readFileSync(p));x.host_id='xian-m4';writeFileSync(p,JSON.stringify(x));f.input.context.adb_host_config_sha256=sha(readFileSync(p));},
 'remote transport is not local binding':f=>{f.input.context.transport='ssh';},
 'physical serial used as ADB':f=>{f.spec.serial='PHYSICAL1';},
 'wrong physical account':f=>{f.input.context.serial='OTHER';},
 'unverified frozen account':f=>{f.input.platformAccounts[0].verification_status='unknown';},
 'wrong registry mapping':f=>{writeFileSync(f.input.context.phone_registry,'profile\tserial\tenabled\ncloud\tOTHER\ttrue\n');f.input.context.phone_registry_sha256=sha(readFileSync(f.input.context.phone_registry));},
 'fake interpreter digest':f=>{f.input.context.verification.artifact_checker.sha256[python]='f'.repeat(64);},
 'fake registry digest':f=>{f.input.context.phone_registry_sha256='f'.repeat(64);},
 'environment not from pinned transport':f=>{delete f.env.ZJ_ADB_HOST_CONFIG;},
 'foreign producer run':f=>{f.input.originRun='foreign-run';},
 'foreign requested VID':f=>{f.input.videoId='7707600173446204000';},
 'missing original fourth argument':f=>{f.start.args.pop();f.rewrite('start',f.start);},
 'wrong original fourth VID':f=>{f.start.args[3]='7707600173446204000';f.rewrite('start',f.start);},
 'fake successful link':f=>{f.link.stdout='https://www.douyin.com/video/7707600173446204000';f.rewrite('video_identity',f.link);},
 'bare URL cannot replace native fields':f=>{f.link.stdout='https://www.douyin.com/video/'+vid;f.rewrite('video_identity',f.link);},
 'contradictory native fields':f=>{f.link.stdout=f.link.stdout.replace('content_id='+vid,'content_id=7707600173446204000');f.rewrite('video_identity',f.link);},
 'duplicate registry profile':f=>{writeFileSync(f.input.context.phone_registry,'profile\tserial\tenabled\ncloud\t127.0.0.1:15555\ttrue\ncloud\t127.0.0.1:15555\ttrue\n');f.input.context.phone_registry_sha256=sha(readFileSync(f.input.context.phone_registry));},
 'duplicate frozen accounts':f=>{f.input.platformAccounts.push({...f.input.platformAccounts[0]});},
 'failed native link never causes network replay':f=>{f.link.exit_code=2;f.link.stderr='LINK_RESOLVE_DNS_TIMEOUT';f.rewrite('video_identity',f.link);},
 'different stop EID':f=>{f.stop.args[1]+='-other';f.rewrite('stop',f.stop);},
 'wrong stage owner':f=>{const name=f.fields.capture_runtime_evidence_file;f.spec.sidecars[name]=f.json(name,{stage:{evidence_id:f.spec.evidence_id,serial:f.spec.serial,owner:'foreign',execution_stop_unknown:false}});f.fields.capture_runtime_evidence_sha256=f.spec.sidecars[name].sha256;f.start.stdout=f.stop.stdout=Object.entries(f.fields).map(([k,v])=>k+'='+v).join('\n');f.rewrite('start',f.start);f.rewrite('stop',f.stop);},
 'unknown stage despite successful receipts':f=>{const name=f.fields.capture_runtime_evidence_file;f.spec.sidecars[name]=f.json(name,{stage:{evidence_id:f.spec.evidence_id,serial:f.spec.serial,owner,execution_stop_unknown:true}});f.fields.capture_runtime_evidence_sha256=f.spec.sidecars[name].sha256;f.start.stdout=f.stop.stdout=Object.entries(f.fields).map(([k,v])=>k+'='+v).join('\n');f.rewrite('start',f.start);f.rewrite('stop',f.stop);},
 'unknown stop':f=>{f.stop.exit_code=124;f.rewrite('stop',f.stop);},
 'ASR from different wav':f=>{f.spec.asr_audio_sha256='c'.repeat(64);},
 'mutually forged runtime hashes':f=>{f.spec.client_sha256='c'.repeat(64);f.fields.capture_runtime_client_sha256='c'.repeat(64);f.start.stdout=f.stop.stdout=Object.entries(f.fields).map(([k,v])=>k+'='+v).join('\n');f.rewrite('start',f.start);f.rewrite('stop',f.stop);},
 'tampered original bytes':f=>{writeFileSync(f.spec.wav.path,'tampered');},
};
for(const [name,mutate]of Object.entries(mutations))test(name,async()=>{const f=fixture();try{mutate(f);await rejected(f);}finally{f.cleanup();}});
function guard(c,activity,kind,args){const r=spawnSync(python,[program],{input:JSON.stringify({kind:'recovery_guard',context:c,activity,tool_kind:kind,args}),encoding:'utf8',timeout:5000});return {code:r.status,...JSON.parse(r.stdout)};}
function recovery(f){const manifest=f.json('producer-manifest.json',{schema:'activity-evidence/v1',identity:{task_id:'old-task',run_id:'old-execution',run_tag:run,workflow:'102'}});const proof={qualification_evidence:{[vid]:f.spec}};const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;f.input.context.recovery={mode:'qualification-readonly-v1',producer:{task_id:'old-task',run_id:'old-execution',run_tag:run},producer_manifest:manifest,proof_sha256:sha(JSON.stringify(canonical(proof))),collection:{video_id:vid,person_index:1},protected_basenames:['producer-run-qual-record.rec.mkv'],output_root:join(f.root,'outputs')};mkdirSync(f.input.context.recovery.output_root);return proof;}
test('recovery host guard permits exact old proof and read-only inspection, denies new capture/model dispatch',()=>{const f=fixture();try{const proof=recovery(f);const c=f.input.context;assert.equal(guard(c,'qualification','proof',[JSON.stringify(proof)]).code,0);assert.equal(guard(c,'qualification','business',[JSON.stringify({op:'inspect_videos'})]).code,0);for(const [kind,args]of [['qualify',[vid,f.spec.wav.path]],['phone',['record-start','new',60,vid]],['phone',['record-extract-audio','new']],['metrics',[]],['fetch-native',['old.mkv']],['business',[JSON.stringify({op:'renew_video'})]],['proof',['{}']]])assert.notEqual(guard(c,'qualification',kind,args).code,0);delete c.recovery.mode;assert.notEqual(guard(c,'qualification','proof',[JSON.stringify(proof)]).code,0);}finally{f.cleanup();}});
test('recovery collection retains exact unused canonical row1 domain and protects original fetch/output files',()=>{const f=fixture();try{recovery(f);const c=f.input.context,eid=run+'-v'+vid+'-collection-person1-t1';assert.equal(guard(c,'collection','phone',['commenter-identity','1','1','1',eid]).code,0);assert.equal(guard(c,'collection','fetch-native',[eid+'.xml']).code,0);assert.notEqual(guard(c,'collection','fetch-native',[run+'-qual-record.rec.mkv']).code,0);assert.notEqual(guard(c,'collection','phone',['commenter-identity','1','1','1',eid.replace('person1','person2')]).code,0);writeFileSync(join(f.native,eid+'.xml'),'already produced');assert.notEqual(guard(c,'collection','phone',['commenter-identity','1','1','1',eid]).code,0);writeFileSync(join(c.recovery.output_root,eid+'.xml'),'already copied');assert.notEqual(guard(c,'collection','fetch-native',[eid+'.xml']).code,0);}finally{f.cleanup();}});
test('real generated collection profile, returned and native-link filenames keep exact row1 boundary',()=>{const f=fixture();try{recovery(f);const c=f.input.context,prefix=run+'-v'+vid+'-collection-';for(const name of ['person1-t1-profile.xml','person1-t1-returned.xml','after-card1-t1-scratch-result.xml'])assert.equal(guard(c,'collection','fetch-native',[prefix+name]).code,0,name);for(const name of ['person11-t1-profile.xml','after-card11-t1-scratch-result.xml'])assert.notEqual(guard(c,'collection','fetch-native',[prefix+name]).code,0,name);}finally{f.cleanup();}});

test('different interpreter cannot replace the frozen artifact interpreter',async()=>{const f=fixture();try{await assert.rejects(verifyQualificationArtifacts(f.input,{env:f.env,pythonBin:'/bin/false'}),/QUALIFICATION_PYTHON_UNBOUND/);}finally{f.cleanup();}});

test('recovery permits only its newly frozen evidence slot without enlarging comment quota',()=>{const f=fixture();try{recovery(f);const c=f.input.context;c.comment_limit=1;c.recovery.collection.person_index=2;const prefix=run+'-v'+vid+'-collection-';assert.equal(guard(c,'collection','phone',['commenter-identity','1','1','1',prefix+'person2-t1']).code,0);assert.equal(guard(c,'collection','phone',['current-video-link',prefix+'after-card2']).code,0);for(const slot of [1,3])assert.notEqual(guard(c,'collection','phone',['commenter-identity','1','1','1',prefix+'person'+slot+'-t1']).code,0);for(const index of [true,'2',0,-1,9007199254740992]){c.recovery.collection.person_index=index;assert.notEqual(guard(c,'collection','phone',['commenter-identity','1','1','1',prefix+'person2-t1']).code,0);}}finally{f.cleanup();}});

test('Python rejects floating point recovery slot and existing slot2 native originals',()=>{const f=fixture();try{recovery(f);const c=f.input.context;c.recovery.collection.person_index=2;const eid=run+'-v'+vid+'-collection-person2-t1';const payload=JSON.stringify({kind:'recovery_guard',context:c,activity:'collection',tool_kind:'phone',args:['commenter-identity','1','1','1',eid]}).replace('"person_index":2','"person_index":2.0');const r=spawnSync(python,[program],{input:payload,encoding:'utf8'});assert.notEqual(r.status,0);writeFileSync(join(f.native,eid+'-profile.xml'),'old original');assert.notEqual(guard(c,'collection','phone',['commenter-identity','1','1','1',eid]).code,0);}finally{f.cleanup();}});

test('轻盈资格准备复用冻结 Python 校验和五帧校验，绑定实际音频与视频号',async t=>{
  const {createStandaloneQualificationEvidenceReader}=await import('../standalone-qualification-preparation.mjs');
  const {execInput}=await import('../leadgen-client.mjs');
  const f=fixture(),directory=realpathSync(f.root);
  t.after(f.cleanup);
  const ref=(relative,bytes)=>{
    const file=join(directory,relative);
    writeFileSync(file,bytes,{mode:0o600});
    return {path:file,sha256:sha(bytes)};
  };
  mkdirSync(join(directory,'receipts'),{mode:0o700});
  mkdirSync(join(directory,'runtime/leadgen-foundation/sources'),{recursive:true});
  const archive='runtime/leadgen-foundation/sources/102.json';
  const archiveRef=ref(archive,readFileSync(new URL('../leadgen-foundation/sources/102.json',import.meta.url)));
  const pythonRef=ref('runtime/qualification-artifacts.py',readFileSync(program));
  const runtimeRef=ref('runtime/runtime/runtime-policy-sdk33.json',JSON.stringify({
    client_sha256:f.spec.client_sha256,server_sha256:f.spec.server_sha256,
  }));
  const epoch=ref('epoch.json',JSON.stringify({resource:{serial:'device',profile:'cloud',adb_serial:f.spec.serial}}));
  const recording=ref('native/recording.mkv','本地录制夹具');
  const sheet=ref('receipts/sheet.jpg','五帧图夹具');
  const panels=['A','B','C','D','E'].map((label,i)=>{
    const frame='receipts/'+label+'.png';
    return {label,pts_seconds:i,frame,sha256:ref(frame,'本地帧 '+label).sha256};
  });
  const spec={...f.spec,recording,coverage_image:sheet,
    coverage_json:ref('receipts/coverage.json',JSON.stringify({panels,recording,sheet_sha256:sheet.sha256})),
    visual_observations:[{label:'C',text:'画面显示软件界面'}],
  };
  delete spec.asr;
  const identity={workflow:'102',task_id:'task',run_id:'run',run_tag:owner};
  const saved=ref('native/qualification-proof.json',JSON.stringify({
    schema:'activity-evidence/v1',identity,qualification_evidence:{[vid]:spec},
  }));
  const reader=createStandaloneQualificationEvidenceReader({runDirectory:directory,runIdentity:identity,execute:execInput,
    frozen:{standalone_skill:{deadline_ms:Date.now()+60000},
      collection_phone_scope:{serial:'device',profile:'cloud',policy_binding:{epoch_fence:epoch},
        executables:{python:{path:python,sha256:sha(readFileSync(python))}}},
      files:{[archive]:archiveRef.sha256,'runtime/qualification-artifacts.py':pythonRef.sha256,
        'runtime/runtime/runtime-policy-sdk33.json':runtimeRef.sha256},
    },
  });
  const proof={path:'native/qualification-proof.json',sha256:saved.sha256};
  const input=[vid,spec.wav.path];
  const prepared=await reader(proof,input);
  assert.equal(prepared.audio_sha256,spec.wav.sha256);
  assert.equal(prepared.duration_seconds,1);
  assert.equal(prepared.visual.frames[0].text,'画面显示软件界面');
  await assert.rejects(reader(proof,[vid,join(directory,'not-my-audio.wav')]),{code:'STANDALONE_COLLECTION_PREPARE_PROOF'});
  writeFileSync(join(directory,'receipts/C.png'),'篡改');
  await assert.rejects(reader(proof,input),{code:'STANDALONE_COLLECTION_PREPARE_ARTIFACT'});
});
