import { mkdirSync,writeFileSync,readFileSync,existsSync } from 'node:fs';
import { hostname } from 'node:os';
import { join,basename } from 'node:path';
import { deploymentTarget } from '../../runtime-host.mjs';
import { digest,registerRun } from '../../runtime-definition.mjs';
// 原设备预算/回执测试使用已完成prepare的合法运行目录；真实prepare由独立HTTP E2E覆盖。
export function seedFrozen(dir,planPath,env={}){
  mkdirSync(dir,{recursive:true});const plan=planPath?readFileSync(planPath):Buffer.from('WF_CAP=test\n');
  const steps=Buffer.from(JSON.stringify({steps:[]}));
  const activities=['preflight','discovery','qualification','collection','scoring','delivery','outreach','cleanup'].map((slot,i)=>({
    reference:{reference_id:`reference-${i}`,slot_key:slot,sequence_no:i+1,activity_id:slot==='collection'?'9b8988e9-a22d-483c-a101-8091728b9e04':slot==='preflight'?'d27e18c9-709f-4c44-899c-85d6fb83671b':`activity-${slot}`,activity_version_id:`av-${i}`},
    version:{id:`av-${i}`,payload:{steps:env.steps?.[slot]||[]}},implementations:[],
  }));
  const files={'workflow.plan':digest(plan),'step-dod.json':digest(steps)};
  const names=['runtime-host.mjs','wf-run.sh','wf-run-lib.sh','wf-limits.sh','batch2.sh','harvest-keyword.sh','harvest-keyword-lib.sh','workflow-result.sh','runtime-definition.mjs','runtime-release.mjs','runtime-binding.mjs','runtime-outbox.mjs','runtime-receipts.mjs','ledger.mjs','step-judge.mjs','discover-keyword.sh','discover-benchmark.sh','douyin-phone-adb','phone-lock-lib.sh','phone-lock-helper.py','locate-element.py','wall-report.sh','wall-lib.sh'];
  const overrides={'harvest-keyword.sh':env.HARVEST_KEYWORD,'douyin-phone-adb':env.C|| (env.HOME&&join(env.HOME,'.local/bin/douyin-phone-adb')),'wall-report.sh':env.WALL_REPORT};
  mkdirSync(join(dir,'runtime'),{recursive:true});
  for(const name of names){
    const source=overrides[name]||new URL(`../../${name}`,import.meta.url).pathname;
    const bytes=existsSync(source)?readFileSync(source):Buffer.from('#!/bin/sh\nexit 0\n');
    writeFileSync(join(dir,'runtime',name),bytes,{mode:0o755});files[`runtime/${name}`]=digest(bytes);
  }
  const body={schema_version:2,release:{id:'release-fixture',target:deploymentTarget(hostname())},deployment:{observation_id:'observation-fixture',target:deploymentTarget(hostname())},workflow_version:{id:'workflow-version',payload_sha256:'d'.repeat(64),payload:{workflow_id:'b1000000-0000-4000-8000-000000000001',contract:{capability:env.runIdentity?.capability}}},activities,files,...(env.runIdentity?{run_identity:env.runIdentity}:{})};
  const snapshot={...body,snapshot_sha256:digest(body)};
  writeFileSync(join(dir,'workflow.plan'),plan);writeFileSync(join(dir,'step-dod.json'),steps);writeFileSync(join(dir,'run-definition.json'),JSON.stringify(snapshot));
  const host=deploymentTarget(hostname());const runId=env.runIdentity?.run_id||env.runId||basename(dir);
  mkdirSync(join(dir,'run-bindings'),{recursive:true});
  for(const attempt of ['a0','a1']){
    const body={release_id:snapshot.release.id,observation_id:snapshot.deployment.observation_id,workflow_id:snapshot.workflow_version.payload.workflow_id,workflow_definition_version_id:snapshot.workflow_version.id,snapshot_sha256:snapshot.workflow_version.payload_sha256,runtime_snapshot_sha256:snapshot.snapshot_sha256,source_kind:'external',external_origin:`zenithjoy:${host}`,attempt_key:attempt,actor:'runtime:phone-adb-controller',expected_path:activities.map(a=>({reference_id:a.reference.reference_id,activity_id:a.reference.activity_id,activity_definition_version_id:a.version.id,required:true}))};
    const run_id=`${runId}__${attempt}`;
    writeFileSync(join(dir,'run-bindings',`${attempt}.request.json`),JSON.stringify({run_id,endpoint:`http://fixture/api/brain/runs/${run_id}/definition`,body,runtime_snapshot_sha256:snapshot.snapshot_sha256}));
    writeFileSync(join(dir,'run-bindings',`${attempt}.ack.json`),JSON.stringify({binding:{id:`binding-${attempt}`,run_id,...body}}));
  }
  writeFileSync(join(dir,'run-bindings/reservation.json'),JSON.stringify({attempt_key:'a1',skip_words:[],started:false}));
}
export function seedRunner(env,args){
  const i=args.indexOf('--tag');const date=new Date();const pad=v=>String(v).padStart(2,'0');const tag=i>=0?args[i+1]:`auto${pad(date.getMonth()+1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}`;
  const cap=args[0]==='benchmark_link_acquisition'?'benchmark_link_acquisition':'keyword_acquisition';
  const wf=cap==='keyword_acquisition'?'social-keyword-leadgen':'social-benchmark-leadgen';
  const home=env.WFR_HOME||join(env.HOME,'.config','zenithjoy');const runDir=join(home,'ledger',`${wf}-crontab-${tag}`);
  const positional=args.filter((x,i)=>!x.startsWith('--') && !(i>0&&['--tag','--commander','--sources'].includes(args[i-1])));
  const runIdentity={capability:cap,tag,profile:positional[1]||'p1',serial:positional[2]||'SER1',run_id:`${wf}-crontab-${tag}`};
  seedFrozen(runDir,join(env.WF_PLAN_DIR,`${cap}.plan`),{...env,runIdentity});registerRun(join(home,'run-index'),runDir,runIdentity);
}
