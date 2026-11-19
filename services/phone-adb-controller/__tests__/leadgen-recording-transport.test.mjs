import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';
import {foundationFixture} from './helpers/leadgen-foundation-fixture.mjs';
import {prepareLeadgenHost} from '../leadgen-foundation/adapter.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
async function fixture({usb=false,asr=true,wrongHardware=false,wrongTransport=false,wrongOwner=false}={}){
 const f=await foundationFixture('102');
 try{
  const config=JSON.parse(fs.readFileSync(f.environment.LEADGEN_HOST_CONFIG)),c=config.bindings.customer.context;
  if(usb)c.adb_serial=c.serial;
  for(const name of ['leadgen-db-connect.js','discovery-metrics.js','leadgen-committed-partial.js','leadgen-policy-review.js','leadgen-outreach-bridge.js']){
   const bytes='module.exports={};\n';fs.writeFileSync(path.join(c.runtime_root,name),bytes);c.verification.runtime_sha256[name]=hash(bytes);
  }
  fs.writeFileSync(f.environment.LEADGEN_HOST_CONFIG,JSON.stringify(config));f.environment.LEADGEN_HOST_CONFIG_SHA256=hash(fs.readFileSync(f.environment.LEADGEN_HOST_CONFIG));
  const a=await prepareLeadgenHost(f),root=a.profile.cwd,context=a.context,run=context.tasks['102'].run_tag,video=context.verification['102'].video_ids[0],eid=run+'-v'+video+'-capture';
  const put=(name,value)=>{const bytes=Buffer.isBuffer(value)?value:Buffer.from(typeof value==='string'?value:JSON.stringify(value)),file=path.join(root,name);fs.writeFileSync(file,bytes);return {path:file,sha256:hash(bytes)};};
  const sidecars={},side=(name,value)=>{sidecars[name]=put(name,value);return name;};
  const sdk=side(eid+'.sdk','34'),owners=side(eid+'.owners','package:com.ss.android.ugc.aweme uid:10001');
  const audio=side(eid+'.audio','AudioPlaybackConfiguration state:started u/pid:10001/123 mutedState:none');
  const foreground=side(eid+'.foreground','com.ss.android.ugc.aweme/.MainActivity');
  const runtime=side(eid+'.runtime.json',{stage:{evidence_id:eid,serial:wrongTransport?'foreign:15555':context.adb_serial,owner:wrongOwner?'foreign-owner':context.local_owner,execution_stop_unknown:false}});
  const fields={path:path.join(root,eid+'.rec.mkv'),capture_audio_mode:'playback_dup',capture_audio_sdk:'34',playback_proof_kind:'native_audio',playback_package:'com.ss.android.ugc.aweme',native_audio_state:'started',native_audio_foreign_started:'0',capture_runtime_client_sha256:'a'.repeat(64),capture_runtime_server_sha256:'b'.repeat(64),native_audio_uid:'10001',native_audio_pid:'123',native_audio_uid_owners_file:owners,native_audio_evidence_file:audio,playback_foreground_file:foreground,capture_audio_sdk_evidence_file:sdk,capture_runtime_evidence_file:runtime};
  for(const [key,name]of Object.entries({...fields}))if(key.endsWith('_file'))fields[key==='capture_runtime_evidence_file'?'capture_runtime_evidence_sha256':key.slice(0,-5)+'_sha256']=sidecars[name].sha256;
  const receipt=args=>({exit_code:0,args,stdout:Object.entries({...fields,audio_streams:'1'}).map(([k,v])=>k+'='+v).join(' ')});
  const wav=Buffer.alloc(44+32000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(32000,40);for(let i=44;i<wav.length;i+=2)wav.writeInt16LE(100,i);
  const spec={video_id:video,expected_run:run,serial:wrongHardware?'foreign-hardware':context.serial,local_owner:context.local_owner,evidence_id:eid,required_seconds:1,client_sha256:'a'.repeat(64),server_sha256:'b'.repeat(64),sidecars,start:put('start.json',receipt(['record-start',eid])),stop:put('stop.json',receipt(['record-stop',eid])),wav:put('capture.wav',wav),video_identity:put('link.json',{exit_code:0,args:['current-video-link',run+'-link'],stdout:'https://www.douyin.com/video/'+video})};
  if(asr){spec.asr=put('asr.json',{http_status:200,body:{request_id:'fixture-request',output:{output:{sentence:{text:'fixture transcript'}}}}});spec.asr_audio_sha256=spec.wav.sha256;}
  const proof=JSON.parse(fs.readFileSync(context.verification.proof_manifest_path));proof.qualification_evidence={[video]:spec};fs.writeFileSync(context.verification.proof_manifest_path,JSON.stringify(proof));
  const policy={company_id:context.company_id,tenant_id:context.tenant_id,version:context.verification.policy_version,policy_id:context.verification.policy_id};
  const snapshot={...policy,config_status:'enabled',runtime_config:{routing:{line_key:context.line},platform_accounts:[{profile:context.profile,enabled:true,verification_status:'verified',device_serial:context.serial,douyin_id:context.account}]}};
  put('fixture-pg.json',{snapshot:{...policy,run_id:run,snapshot},video:{video_id:video,judgment_status:'matched',judgment_config:policy,process_status:'处理中:'+run}});
  // Only the DB transport is replaced. Actual outer main and original Python checker remain unchanged.
  fs.writeFileSync(context.credentials.database,JSON.stringify({DATABASE_URL:'postgresql://unused@127.0.0.1:1/unused'}));
  fs.writeFileSync(path.join(root,'activity-host-pg.mjs'),`import fs from 'node:fs';const data=JSON.parse(fs.readFileSync(new URL('./fixture-pg.json',import.meta.url)));export async function loadActivityHostPg(){return {Pool:class {async connect(){return {query:async sql=>({rows:sql.includes('current_database()')?[{database:'zenithjoy',read_only:'on'}]:sql.includes('company_config_runs')?[data.snapshot]:sql.includes('leadgen_videos')?[data.video]:[]}),release(){}};}async end(){}}};}`);
  const request={...context.tasks['102'],workflow:'102',activity:'qualification',attempt:1,nonce:'fixture',context,checks:['company_policy_scope','persisted_qualification','capture_or_valid_cache','asr_error_classification','native_video_identity']};
  const {main}=await import(pathToFileURL(path.join(root,'production-readback-local.mjs')));return {f,a,spec,run:()=>main(request)};
 }catch(error){f.close();throw error;}
}
for(const usb of [false,true])test('actual qualification outer and original inner checker agree for '+(usb?'USB':'cloud transport'),async()=>{
 const f=await fixture({usb});try{const proof=f.a.context.verification.proof_manifest_path,before=fs.readFileSync(proof),r=await f.run();assert.deepEqual(fs.readFileSync(proof),before);assert.equal(r.outcome,'passed',JSON.stringify(r));assert.equal(f.spec.serial,f.a.context.serial);}finally{f.f.close();}
});
for(const option of ['wrongHardware','wrongTransport','wrongOwner'])test('qualification refuses '+option+' without weakening original identities',async()=>{
 const f=await fixture({[option]:true});try{const r=await f.run();assert.equal(r.outcome,'blocked');if(option==='wrongHardware')assert.equal(r.output.readback_error,'QUALIFICATION_ARTIFACT_SCOPE_MISMATCH');else assert.equal(r.checks.find(x=>x.id==='capture_or_valid_cache').evidence[0].observation.proofs[0].reason,'CAPTURE_STAGE_OWNER_UNVERIFIED');}finally{f.f.close();}
});
test('transport adaptation does not turn missing ASR into qualification success',async()=>{
 const f=await fixture({asr:false});try{const r=await f.run();assert.equal(r.outcome,'blocked');assert.equal(r.checks.find(x=>x.id==='capture_or_valid_cache').status,'passed');assert.equal(r.checks.find(x=>x.id==='persisted_qualification').status,'failed');}finally{f.f.close();}
});
