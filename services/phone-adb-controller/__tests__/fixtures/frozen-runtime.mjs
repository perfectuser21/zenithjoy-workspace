import { mkdirSync,writeFileSync,readFileSync } from 'node:fs';
import { join } from 'node:path';
import { digest } from '../../runtime-definition.mjs';
// 原设备预算/回执测试使用已完成prepare的合法运行目录；真实prepare由独立HTTP E2E覆盖。
export function seedFrozen(dir,planPath){
  mkdirSync(dir,{recursive:true});const plan=planPath?readFileSync(planPath):Buffer.from('WF_CAP=test\n');
  const steps=Buffer.from(JSON.stringify({steps:[]}));
  const activities=['preflight','discovery','qualification','collection','scoring','delivery','outreach','cleanup'].map((slot,i)=>({
    reference:{reference_id:`reference-${i}`,slot_key:slot,sequence_no:i+1,activity_id:slot==='collection'?'9b8988e9-a22d-483c-a101-8091728b9e04':slot==='preflight'?'d27e18c9-709f-4c44-899c-85d6fb83671b':`activity-${slot}`,activity_version_id:`av-${i}`},
    version:{id:`av-${i}`,payload:{steps:[]}},implementations:[],
  }));
  const body={schema_version:1,workflow_version:{id:'workflow-version',payload:{workflow_id:'b1000000-0000-4000-8000-000000000001'}},activities,files:{'workflow.plan':digest(plan),'step-dod.json':digest(steps)}};
  writeFileSync(join(dir,'workflow.plan'),plan);writeFileSync(join(dir,'step-dod.json'),steps);writeFileSync(join(dir,'run-definition.json'),JSON.stringify({...body,snapshot_sha256:digest(body)}));
}
export function seedRunner(env,args){
  const i=args.indexOf('--tag');const date=new Date();const pad=v=>String(v).padStart(2,'0');const tag=i>=0?args[i+1]:`auto${pad(date.getMonth()+1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}`;
  const cap=args[0]==='benchmark_link_acquisition'?'benchmark_link_acquisition':'keyword_acquisition';
  const wf=cap==='keyword_acquisition'?'social-keyword-leadgen':'social-benchmark-leadgen';
  seedFrozen(join(env.WFR_HOME||join(env.HOME,'.config','zenithjoy'),'ledger',`${wf}-crontab-${tag}`),join(env.WF_PLAN_DIR,`${cap}.plan`));
}
