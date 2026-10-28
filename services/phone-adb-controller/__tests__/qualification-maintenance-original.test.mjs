import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync,realpathSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {digest} from '../runtime-definition.mjs';
import {authorityFixture} from './helpers/qualification-maintenance-fixture.mjs';
const api=await import('../qualification-maintenance-original.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return null;throw e;});
const hash=raw=>createHash('sha256').update(raw).digest('hex');
function fixture(t) {
 const home=realpathSync(mkdtempSync(join(tmpdir(),'maintenance-original-')));t.after(()=>rmSync(home,{recursive:true,force:true}));
 const {scope}=authorityFixture(),root=join(home,'.local/share/zenithjoy');
 const privateDir=join(root,'candidate-acceptance',scope.run_tag);
 const run=join(root,'phone-candidate-runs','b'.repeat(40),'ledger','douyin_video_processing-'+scope.run_tag);
 const put=(path,value)=>{mkdirSync(dirname(path),{recursive:true,mode:0o700});writeFileSync(path,typeof value==='string'?value:JSON.stringify(value),{mode:0o600});};
 const producer={schema_version:2,workflow_key:'douyin_video_discovery',run_tag:scope.producer_run,source_commit:'beb37370c047a13013aa0cc997a0fecc09534dde',snapshot_sha256:'fe7da095eb9184ae5eba9c71af78b7c679a6f752509e5e8c5ed1a5a4288fee67',progress_sha256:'fbbee23e36623307ab19ca9abbfb1626e6b94a00e05439dad6f3add8174646bc',profile:scope.profile,serial:scope.serial,line:scope.line_key,company_id:scope.company_id,tenant_id:scope.tenant_id,company_config_version:14,policy_id:scope.policy_id,video_ids:scope.video_ids};
 const rawDescriptor=JSON.stringify(producer);put(join(privateDir,'producer-descriptor-v2.json'),rawDescriptor);
 const source='original source bytes\r\n';put(join(run,'runtime','worker.mjs'),source);
 const manifest={schema_version:1,source_repo:'perfectuser21/zenithjoy-workspace',source_commit:scope.consumer_source,files:[{path:'services/phone-adb-controller/worker.mjs',deployed_path:'worker.mjs',content_sha256:hash(source)}]};
 put(join(run,'runtime','deployment-manifest.json'),manifest);put(join(run,'workflow.plan'),'qualification\n');put(join(run,'step-dod.json'),{steps:[]});
 const slots=['preflight','dedup','qualification','collection','cleanup'];
 const body={schema_version:1,deployment:{...manifest,target:'xian-m4',release_id:'release',observation_id:'observation'},release:{id:'release'},workflow_version:{id:'workflow-version',payload_sha256:'w'.repeat(64),payload:{workflow_id:'workflow'}},
  run_identity:{capability:'douyin_video_processing',tag:scope.run_tag,profile:scope.profile,serial:scope.serial,run_id:'douyin_video_processing-'+scope.run_tag},
  sampling_input:{schema_version:1,workflow_key:'douyin_video_processing',run_tag:scope.run_tag,profile:scope.profile,serial:scope.serial,line:scope.line_key,source_run:scope.producer_run,comment_limit:5,collection_budget_s:480},producer_descriptor:producer,
  activities:slots.map((slot,i)=>({reference:{slot_key:slot,reference_id:'ref'+i,activity_id:'act'+i},version:{id:'version'+i,source_commit:scope.consumer_source,payload:{steps:[]}}})),
  files:Object.fromEntries(['workflow.plan','step-dod.json','runtime/worker.mjs','runtime/deployment-manifest.json'].map(p=>[p,hash(readFileSync(join(run,p)))]))};
 const frozen={...body,snapshot_sha256:digest(body)};scope.snapshot_sha256=frozen.snapshot_sha256;put(join(run,'run-definition.json'),frozen);
 const runId=body.run_identity.run_id+'__a1';
 const bindingBody={release_id:'release',observation_id:'observation',workflow_id:'workflow',workflow_definition_version_id:'workflow-version',snapshot_sha256:'w'.repeat(64),runtime_snapshot_sha256:scope.snapshot_sha256,source_kind:'external',external_origin:'zenithjoy:xian-m4',attempt_key:'a1',actor:'runtime:phone-adb-controller',expected_path:body.activities.map(a=>({reference_id:a.reference.reference_id,activity_id:a.reference.activity_id,activity_definition_version_id:a.version.id,required:true}))};
 put(join(run,'run-bindings/a1.request.json'),{run_id:runId,body:bindingBody,runtime_snapshot_sha256:scope.snapshot_sha256});
 put(join(run,'run-bindings/a1.ack.json'),{binding:{id:scope.binding_id,run_id:runId,...bindingBody,task_run_id:null}});
 const intent={tag:scope.run_tag,task_id:scope.original_task_id,source_commit:scope.consumer_source,source_run:scope.producer_run,public_entry:join(root,'phone-candidates',scope.consumer_source,'runtime','leadgen-run.sh'),global_seconds:1800,collection_seconds:480,video_limit:1,comment_limit:5,allow_dm:false,local_preflight:{code:0,stdout:'lock=free\n'}};
 put(join(privateDir,'launch-intent.json'),intent);
 const result={tag:scope.run_tag,task_id:scope.original_task_id,source_commit:scope.consumer_source,source_run:scope.producer_run,pid:63509,process_identity:{pid:63509,ppid:63503,pgid:63509,start_identity:'1793139546:402740'},private:privateDir,log:join(privateDir,'public-entry.out'),expected_run_dir:run,started_at_ms:1793139546403,one_launch_only:true,descriptor_sha256:hash(rawDescriptor),actor:scope.original_actor};
 put(join(privateDir,'launch-result.json'),result);
 const common={run_id:runId,source_commit:scope.consumer_source,profile:scope.profile,serial:scope.serial,owner:scope.run_tag,task_id:null};
 for(let i=0;i<7;i++) {
  const id='11111111-1111-4111-8111-'+String(i+1).padStart(12,'0');
  put(join(run,'native-operations',id+'.json'),{...common,version:1,operation_id:id,run_dir:run,activity:i===6?'qualification':'preflight',status:'unknown',execution_stopped:false,pid:64000+i,pgid:64000+i,start_identity:'1793139562:'+i,wait_code:i===6?5:0,wait_signal:null,processes:[{pid:64000+i,pgid:64000+i,start_identity:'1793139562:'+i,termination:{confirmed:false}}]});
 }
 const split={status:'failed',source_commit:scope.consumer_source,run_id:runId,task_id:null,binding_id:scope.binding_id,profile:scope.profile,sampling_input:body.sampling_input,results:slots.map((activity,i)=>({activity,status:i<2?'completed':i===2?'failed':'blocked',...(i===2?{error:'OLD_EXECUTION_TERMINATION_UNKNOWN'}:{})}))};
 put(join(run,'split-result.json'),split);put(join(run,'activity-qualification.json'),{activity:'qualification',status:'failed',attempt:1,error:'OLD_EXECUTION_TERMINATION_UNKNOWN',execution_stopped:false});
 put(join(run,scope.run_tag+'-qualification-progress.json'),{run:scope.run_tag,source_commit:scope.consumer_source,leased_video_ids:scope.video_ids,qualified_video_ids:[],videos:[{video_id:scope.video_ids[0],settled:false,attempts:1}]});
 put(join(run,'qualification.tsv'),`AUDIO\\t${scope.video_ids[0]}\\t/private/tmp/openclaw-phone/evidence/${scope.profile}/${scope.run_tag}-v${scope.video_ids[0]}-qualification-record.16k.wav\nQUAL\t${scope.video_ids[0]}\tpending\taudio_upload_failed\n`);
 put(join(run,scope.run_tag+'-recording-'+scope.video_ids[0]+'.json'),{run:scope.run_tag,video_id:scope.video_ids[0],record_started_stdout:'record_started pid=82964 path=/private/tmp/record.rec.mkv',native_audio_restored:{state:'started',uid:10061}});
 put(join(run,scope.run_tag+'-intake-readback.json'),{verified:true,source_run:scope.producer_run,source_commit:producer.source_commit,consumer_source_commit:scope.consumer_source,producer_descriptor:producer,video_ids:['7700112581541257551',...scope.video_ids],eligible_video_ids:scope.video_ids,rows:[{video_id:scope.video_ids[0]},{video_id:'7700112581541257551'}],skipped:[{video_id:'7700112581541257551',reason:'producer_scope'}]});
 put(join(run,'activity-events.jsonl'),JSON.stringify({...common,binding_id:scope.binding_id,workflow_key:'douyin_video_processing',sampling_input:body.sampling_input,activity:'qualification',phase:'failed'})+'\n');
 const change=(path,fn)=>{const x=JSON.parse(readFileSync(path));fn(x);put(path,x);};
 return {home,scope,run,privateDir,put,change};
}
test('读取完整旧文件和ACK但不洗掉UNKNOWN或冒认PID无birth已停止',t=>{
 const f=fixture(t);assert.equal(typeof api?.readMaintenanceOriginal,'function');
 const before=readFileSync(join(f.run,'qualification.tsv'));
 const r=api.readMaintenanceOriginal(f.scope,{home:f.home});
 assert.equal(r.native_records.length,7);assert.equal(r.frozen.files['runtime/worker.mjs'],hash('original source bytes\r\n'));
 assert.equal(r.qualification.execution_stopped,false);assert.deepEqual(r.intake.video_ids,['7700112581541257551','7689863996204591985']);
 assert.ok(r.tracked.some(p=>p.pid===63509&&p.start_identity==='1793139546:402740'));
 assert.deepEqual(r.pid_only.map(p=>p.pid).sort((a,b)=>a-b),[63503,82964]);
 assert.ok(r.raw_manifest.some(p=>p.path.endsWith('runtime/worker.mjs')&&p.sha256===hash('original source bytes\r\n')));
 assert.deepEqual(readFileSync(join(f.run,'qualification.tsv')),before);
});
for(const [name,mutate]of [
 ['启动Task错',f=>f.change(join(f.privateDir,'launch-result.json'),x=>x.task_id='other')],
 ['私信许可变真',f=>f.change(join(f.privateDir,'launch-intent.json'),x=>x.allow_dm=true)],
 ['启动目录逃逸',f=>f.change(join(f.privateDir,'launch-result.json'),x=>x.expected_run_dir=f.home)],
 ['ACK绑定错',f=>f.change(join(f.run,'run-bindings/a1.ack.json'),x=>x.binding.id='other')],
 ['冻结源文件被改',f=>f.put(join(f.run,'runtime/worker.mjs'),'changed')],
 ['冻结路径符号链接',f=>{const p=join(f.run,'runtime/worker.mjs');const b=readFileSync(p);rmSync(p);f.put(join(f.home,'outside'),b.toString());symlinkSync(join(f.home,'outside'),p);}],
 ['出现collection native',f=>{const dir=join(f.run,'native-operations'),file=join(dir,readdirSync(dir)[0]);f.change(file,x=>x.activity='collection');}],
 ['native birth缺失',f=>{const dir=join(f.run,'native-operations');f.change(join(dir,readdirSync(dir)[0]),x=>{delete x.start_identity;});}],
 ['脱离原公司producer',f=>f.change(join(f.privateDir,'producer-descriptor-v2.json'),x=>x.company_id='other')],
 ['截掉上游第二视频',f=>f.change(join(f.run,f.scope.run_tag+'-intake-readback.json'),x=>{x.video_ids=[...f.scope.video_ids];})],
 ['不明native附件',f=>f.put(join(f.run,'native-operations','untracked.txt'),'unknown')],
 ['额外stdout资格结论',f=>f.put(join(f.run,'qualification.tsv'),'QUAL\tother\tmatched\n')],
])test(name+'拒绝原件适配',t=>{const f=fixture(t);mutate(f);assert.equal(typeof api?.readMaintenanceOriginal,'function');assert.throws(()=>api.readMaintenanceOriginal(f.scope,{home:f.home}),/MAINTENANCE_/);});
for(const activity of ['collection','cleanup'])for(const phase of ['before','execution']) {
 test(`${activity}.${phase}同scope事件也不能被blocked split覆盖`,t=>{
  const f=fixture(t),path=join(f.run,'activity-events.jsonl');
  const event=JSON.parse(readFileSync(path,'utf8').trim());
  f.put(path,readFileSync(path,'utf8')+JSON.stringify({...event,activity,phase})+'\n');
  assert.throws(()=>api.readMaintenanceOriginal(f.scope,{home:f.home}),/MAINTENANCE_/);
 });
}
