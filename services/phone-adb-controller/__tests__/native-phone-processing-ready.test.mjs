import {nativePhoneTestPython} from './helpers/native-phone-test-python.mjs';
import {nativePhoneTestMediaBinary} from './helpers/native-phone-test-media.mjs';
// Readiness is Code assembly only. The genuine loopback Source is an isolated
// fixture; no Worker result, phone grant, database outcome or credential is read.
import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync,realpathSync} from 'node:fs';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {usingNative102Queue} from './fixtures/native-102-queue-fixture.mjs';
import {createProcessingRecordingLoopbackFixture} from './helpers/native-processing-recording-loopback.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
test('ready checks fixed assembly, sampling, actual binary pins and readers without issuing work',async t=>usingNative102Queue(t,async f=>{
 const scope=f.activate('qualification'),claim=f.routes.get('/api/brain/tasks/'+scope.task_id);
 await createProcessingRecordingLoopbackFixture(t,{runtimeOverride:f.root,serialOverride:scope.serial,scopeOverride:{...scope,broker_host:'mmv',device_sdk:31,epoch:1,claim:{claimed_by:claim.claimed_by,claimed_at:claim.claimed_at},cleanup_deadline_ms:scope.receipt_deadline_ms},prepareSource:({source})=>{for(const row of source.files){const old=f.source.files.find(r=>r.path===row.path);if(old)old.sha256=row.sha256;else f.source.files.push(row);}source.files=structuredClone(f.source.files);}});
 const api=await f.load('native-phone-processing.mjs');for(const path of api.NATIVE_PHONE_PROCESSING_ASSEMBLY_FILES)if(!f.source.files.some(r=>r.path===path))f.source.files.push({path,sha256:sha(readFileSync(join(f.root,path)))});
 const env={...f.env,WF_BRAIN_WORKFLOW:'douyin_video_processing',WFR_TAG:scope.run,P:scope.profile,SERIAL:scope.serial,LEADGEN_LINE:scope.line,LEADGEN_COMMENT_LIMIT:'1'},defs=await f.load('runtime-definition.mjs'),executables=Object.fromEntries(['python','ffmpeg','ffprobe'].map(name=>{const path=name==='python'?nativePhoneTestPython():nativePhoneTestMediaBinary(name);return [name,{path,sha256:sha(readFileSync(path))}];})),frozen={sampling_input:defs.commentSamplingInput(env),collection_phone_scope:{executables}};let reads=0;
 const options={root:f.root,source:f.source,env,createPool:f.createPool,frozen,credentials:{openrouter:()=>{reads++;throw Error('READINESS_CANNOT_READ_KEYS');},dashscope:()=>{reads++;throw Error('READINESS_CANNOT_READ_KEYS');}}};
 const before=f.allocated(),make=extra=>api.createNativePhoneProcessing({...options,...extra});assert.equal(make().ready(),true);assert.equal(reads,0);assert.equal(f.allocated(),before);
 for(const name of ['native-phone-managed-recording.mjs','native-scrcpy-adb-bridge.mjs','native-phone-credentials.mjs','leadgen-agent-artifacts.mjs'])assert.equal(make({source:{...f.source,files:f.source.files.filter(r=>r.path!==name)}}).ready(),false,name);
 const wrongBinary=structuredClone(frozen);wrongBinary.collection_phone_scope.executables.ffmpeg.sha256='0'.repeat(64);assert.equal(make({frozen:wrongBinary}).ready(),false);
 const noBinary=structuredClone(frozen);delete noBinary.collection_phone_scope.executables.ffprobe;assert.equal(make({frozen:noBinary}).ready(),false);
 const wrongSample=structuredClone(frozen);wrongSample.sampling_input.comment_limit=2;assert.equal(make({frozen:wrongSample}).ready(),false);assert.equal(make({frozen:{collection_phone_scope:frozen.collection_phone_scope}}).ready(),false);
 assert.equal(make({env:{...env,QUEUED_VIDEO_RECORD_SECONDS:'0'}}).ready(),false);assert.equal(make({credentials:{openrouter:options.credentials.openrouter}}).ready(),false);assert.equal(reads,0);assert.equal(f.allocated(),before);
 const ds=f.activate('dedup'),base={directory:f.makeDirectory('missing-hook-body'),assertAuthority:async()=>{throw Error('NO_AUTHORITY_DISPATCH');},resources:async()=>{throw Error('NO_RESOURCE_DISPATCH');}};await assert.rejects(make().prepareActivity(ds,base),/ACTIVITY_HOOKS/);assert.equal(f.allocated(),before);
}));
