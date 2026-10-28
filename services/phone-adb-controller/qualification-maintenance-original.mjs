// 原353失败现场只读适配；不把归档的UNKNOWN转换为停止证明。
import {readFileSync,lstatSync,realpathSync,readdirSync} from 'node:fs';
import {resolve,join,relative,sep} from 'node:path';
import {homedir} from 'node:os';
import {isDeepStrictEqual} from 'node:util';
import {readFrozen,digest} from './runtime-definition.mjs';
import {readBinding,expectedPath} from './runtime-binding.mjs';
import {verifyBeforeJudgeEvidence} from './qualification-maintenance-beforejudge.mjs';
import {SUPPORTED_QUALIFICATION_SOURCE} from './qualification-maintenance-evidence.mjs';
const need=value=>{if(!value)throw Error('MAINTENANCE_ORIGINAL_UNPROVEN');};
const safeRelative=p=>typeof p==='string'&&!p.startsWith('/')&&p.split('/').every(x=>x&&!['.','..'].includes(x));
const pid=p=>Number.isSafeInteger(p)&&p>1;
const birth=b=>/^\d+:\d{1,6}$/.test(b||'');

export function readMaintenanceOriginal(scope,{home=homedir()}={}) {
 try{return readOriginal(scope,home);}catch{throw Error('MAINTENANCE_ORIGINAL_UNPROVEN');}
}
function readOriginal(s,home) {
 need(s?.consumer_source===SUPPORTED_QUALIFICATION_SOURCE&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(s.run_tag||'')
  &&Array.isArray(s.video_ids)&&s.video_ids.length===1&&/^\d{16,24}$/.test(s.video_ids[0]));
 home=resolve(home);need(home===realpathSync(home));
 let bytes=0;const reads=new Map();
 const path=rel=>{
  need(safeRelative(rel));let file=home;
  for(const piece of rel.split('/')){file=join(file,piece);const st=lstatSync(file);need(!st.isSymbolicLink()&&st.uid===process.getuid()&&(st.mode&0o022)===0);}
  need(file.startsWith(home+sep));return file;
 };
 const raw=rel=>{
  const file=path(rel),st=lstatSync(file);need(st.isFile()&&st.size<=8*1024*1024);
  const data=readFileSync(file);bytes+=data.length;need(bytes<=96*1024*1024);
  const before=reads.get(rel);need(!before||before.equals(data));reads.set(rel,data);return data;
 };
 const json=rel=>JSON.parse(raw(rel).toString('utf8'));
 const base='.local/share/zenithjoy',privateRel=base+'/candidate-acceptance/'+s.run_tag;
 const launch_intent=json(privateRel+'/launch-intent.json'),launch_result=json(privateRel+'/launch-result.json');
 for(const item of [launch_intent,launch_result])need(item.tag===s.run_tag&&item.task_id===s.original_task_id
  &&item.source_commit===s.consumer_source&&item.source_run===s.producer_run);
 need(launch_intent.global_seconds===1800&&launch_intent.collection_seconds===480&&launch_intent.video_limit===1
  &&launch_intent.comment_limit===5&&launch_intent.allow_dm===false&&launch_intent.local_preflight?.code===0
  &&launch_intent.local_preflight.stdout==='lock=free\n'
  &&launch_intent.public_entry===join(home,base,'phone-candidates',s.consumer_source,'runtime/leadgen-run.sh'));
 const launch=launch_result.process_identity;
 need(launch_result.actor===s.original_actor&&launch_result.one_launch_only===true&&pid(launch_result.pid)
  &&launch?.pid===launch_result.pid&&pid(launch.ppid)&&launch.pgid===launch.pid&&birth(launch.start_identity)
  &&Number.isSafeInteger(launch_result.started_at_ms)&&launch_result.started_at_ms>0
  &&Math.abs(launch_result.started_at_ms-(Number(launch.start_identity.split(':')[0])*1000+Number(launch.start_identity.split(':')[1])/1000))<10000
  &&launch_result.private===join(home,privateRel)&&launch_result.log===join(home,privateRel,'public-entry.out'));
 const runRel=relative(home,launch_result.expected_run_dir||'');
 need(new RegExp('^\\.local/share/zenithjoy/phone-candidate-runs/[a-f0-9]{40}/ledger/douyin_video_processing-'+s.run_tag+'$').test(runRel)
  &&launch_result.expected_run_dir===join(home,runRel));
 const runDir=path(runRel),frozenRaw=json(runRel+'/run-definition.json');
 need(frozenRaw.snapshot_sha256===s.snapshot_sha256&&frozenRaw.files&&typeof frozenRaw.files==='object'
  &&Object.keys(frozenRaw.files).length>0&&Object.keys(frozenRaw.files).length<=1024);
 for(const [file,hash]of Object.entries(frozenRaw.files))need(safeRelative(file)&&digest(raw(runRel+'/'+file))===hash);
 const frozen=readFrozen(runDir);need(isDeepStrictEqual(frozen,frozenRaw));
 const deployment=frozen.deployment;
 need(deployment.source_commit===s.consumer_source&&deployment.source_repo==='perfectuser21/zenithjoy-workspace'
  &&deployment.target===s.host&&Array.isArray(deployment.files)&&deployment.files.length>0);
 const deployed=new Set();
 for(const entry of deployment.files) {
  need(safeRelative(entry.deployed_path)&&!deployed.has(entry.deployed_path));deployed.add(entry.deployed_path);
  need(frozen.files['runtime/'+entry.deployed_path]===entry.content_sha256);
 }
 const fixedFiles=new Set(['workflow.plan','step-dod.json','runtime/deployment-manifest.json',...[...deployed].map(p=>'runtime/'+p)]);
 need(Object.keys(frozen.files).length===fixedFiles.size&&Object.keys(frozen.files).every(p=>fixedFiles.has(p)));
 const manifest=json(runRel+'/runtime/deployment-manifest.json');
 need(manifest.source_commit===s.consumer_source&&manifest.source_repo===deployment.source_repo&&isDeepStrictEqual(manifest.files,deployment.files));
 const descriptorRaw=raw(privateRel+'/producer-descriptor-v2.json');
 need(digest(descriptorRaw)===launch_result.descriptor_sha256&&isDeepStrictEqual(JSON.parse(descriptorRaw),frozen.producer_descriptor));
 const request=json(runRel+'/run-bindings/a1.request.json');json(runRel+'/run-bindings/a1.ack.json');
 const binding=readBinding(runDir,'a1',frozen),runId='douyin_video_processing-'+s.run_tag+'__a1';
 const expected={release_id:frozen.release.id,observation_id:deployment.observation_id,workflow_id:frozen.workflow_version.payload.workflow_id,
  workflow_definition_version_id:frozen.workflow_version.id,snapshot_sha256:frozen.workflow_version.payload_sha256,
  runtime_snapshot_sha256:s.snapshot_sha256,source_kind:'external',external_origin:'zenithjoy:'+s.host,attempt_key:'a1',
  actor:'runtime:phone-adb-controller',expected_path:expectedPath(frozen,json(runRel+'/step-dod.json'))};
 need(request.run_id===runId&&isDeepStrictEqual(request.body,expected)&&binding.id===s.binding_id&&binding.run_id===runId&&binding.task_id===null);
 const nativeRel=runRel+'/native-operations',nativeDir=path(nativeRel),nativeNames=readdirSync(nativeDir).sort();
 need(nativeNames.length===7&&nativeNames.every(n=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.json$/.test(n)));
 const native_records=nativeNames.map(n=>{
  const record=json(nativeRel+'/'+n);
  need(n===record.operation_id+'.json'&&record.run_dir===runDir&&record.run_id===runId
   &&record.owner===s.run_tag&&record.source_commit===s.consumer_source&&record.profile===s.profile&&record.serial===s.serial
   &&record.task_id===null&&record.status==='unknown'&&record.execution_stopped===false
   &&['preflight','qualification'].includes(record.activity)&&pid(record.pid)&&pid(record.pgid)&&birth(record.start_identity)
   &&record.wait_code===(record.activity==='qualification'?5:0)&&record.wait_signal===null
   &&Array.isArray(record.processes)&&record.processes.length>0&&record.processes.length<=512);
  need(record.processes.every(p=>pid(p.pid)&&pid(p.pgid)&&birth(p.start_identity))
   &&record.processes.some(p=>p.pid===record.pid&&p.start_identity===record.start_identity&&p.pgid===record.pgid));
  return record;
 });
 need(native_records.filter(n=>n.activity==='qualification').length===1);
 const split=json(runRel+'/split-result.json'),qualification=json(runRel+'/activity-qualification.json');
 const progress=json(runRel+'/'+s.run_tag+'-qualification-progress.json'),tsv=raw(runRel+'/qualification.tsv').toString('utf8');
 verifyBeforeJudgeEvidence({scope:s,frozen,split,qualification,native_records,progress,tsv});
 const recording=json(runRel+'/'+s.run_tag+'-recording-'+s.video_ids[0]+'.json');
 need(recording.run===s.run_tag&&recording.video_id===s.video_ids[0]);
 const captureMatches=[...(recording.record_started_stdout||'').matchAll(/(?:^| )pid=([1-9][0-9]*)(?= |$)/g)];
 need(captureMatches.length===1&&pid(Number(captureMatches[0][1])));
 const intake=json(runRel+'/'+s.run_tag+'-intake-readback.json');
 need(intake.verified===true&&intake.source_run===s.producer_run&&intake.source_commit===frozen.producer_descriptor.source_commit
  &&intake.consumer_source_commit===s.consumer_source&&isDeepStrictEqual(intake.producer_descriptor,frozen.producer_descriptor)
  &&isDeepStrictEqual(intake.eligible_video_ids,s.video_ids)&&Array.isArray(intake.video_ids)&&new Set(intake.video_ids).size===intake.video_ids.length
  &&Array.isArray(intake.rows)&&isDeepStrictEqual(intake.rows.map(r=>r.video_id).sort(),[...intake.video_ids].sort())
  &&Array.isArray(intake.skipped)&&isDeepStrictEqual([...intake.eligible_video_ids,...intake.skipped.map(r=>r.video_id)].sort(),[...intake.video_ids].sort()));
 const eventRaw=raw(runRel+'/activity-events.jsonl').toString('utf8');
 need(eventRaw.endsWith('\n'));const activity_events=eventRaw.trimEnd().split('\n').map(line=>JSON.parse(line));
 need(activity_events.length>0&&activity_events.every(e=>e.run_id===runId&&e.binding_id===s.binding_id&&e.task_id===null
  &&e.source_commit===s.consumer_source&&e.profile===s.profile&&e.workflow_key==='douyin_video_processing'
  &&isDeepStrictEqual(e.sampling_input,frozen.sampling_input)));
 const identities=[{pid:launch.pid,pgid:launch.pgid,start_identity:launch.start_identity},...native_records.flatMap(n=>n.processes.map(p=>({pid:p.pid,pgid:p.pgid,start_identity:p.start_identity})))];
 const tracked=[...new Map(identities.map(p=>[p.pid+':'+p.start_identity,p])).values()];
 const pid_only=[{pid:launch.ppid,origin:'launch_parent'},{pid:Number(captureMatches[0][1]),origin:'capture_client'}];
 need(isDeepStrictEqual(readdirSync(nativeDir).sort(),nativeNames));
 // 第二遍核全部已读原字节，禁止把读到一半变化的现场拼成一个“完整”包。
 for(const [rel,data]of reads)need(data.equals(readFileSync(path(rel))));
 const raw_manifest=[...reads].map(([path,data])=>({path,bytes:data.length,sha256:digest(data)}));
 return {frozen,split,qualification,native_records,progress,tsv,launch_intent,launch_result,recording,intake,activity_events,raw_manifest,tracked,pid_only};
}
