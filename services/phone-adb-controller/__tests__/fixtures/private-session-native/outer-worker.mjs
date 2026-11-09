// Isolated outer process group. Startup itself is the real production main.
import fs from 'node:fs';
import {join} from 'node:path';
import {setup,cleanupSetupFailure} from '../epoch-resume-native/setup.mjs';
let r;
try {
  r=await setup('positive');
  console.log(JSON.stringify({event:'realm',root:r.root,runtime:r.runtime}));
  const {plan,path}=await r.prepare();
  const result=await r.main.applyResumePlan({planPath:path},r.applyDeps);
  const ready=JSON.parse(fs.readFileSync(join(plan.execution_directory,'startup-ready.json')));
  const reserved=JSON.parse(fs.readFileSync(join(plan.execution_directory,'startup-reserved.json')));
  const receipts=fs.readFileSync(join(r.runtime,'verifier-subprocess.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  if(result.status!=='fenced'||receipts.filter(x=>x.code===0).length!==2)throw Error('REAL_STARTUP_DUAL_FRESH_REQUIRED');
  console.log(JSON.stringify({event:'ready',root:r.root,runtime:r.runtime,planPath:path,plan,ready,reserved,worker_pid:process.pid,verifier_successes:2,field_actions:0}));
  // The parent test owns one deliberate process-group SIGTERM. No local signal
  // handler converts that group cleanup into a supervisor stop request.
  await new Promise(()=>{setInterval(()=>{},1000);});
} catch(error) {
  console.error(error.stack);
  if(r)await r.close();else await cleanupSetupFailure();
  process.exitCode=1;
}
