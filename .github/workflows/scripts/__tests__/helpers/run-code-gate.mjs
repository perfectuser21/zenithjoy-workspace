import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Execute the real aggregate step, including its GitHub-provided JSON environment.
export function runCodeGate(workflow, openclawResult) {
  const needs=Object.fromEntries(workflow.jobs['l3-passed'].needs.map(job=>[job,{result:workflow.jobs[job]?.if?'skipped':'success'}]));
  needs.changes={result:'success',outputs:Object.fromEntries(Object.keys(workflow.jobs.changes.outputs).map(key=>[key,'false']))};
  needs['openclaw-scripts-test']={result:openclawResult};
  const step=workflow.jobs['l3-passed'].steps.find(step=>step.run);
  const render=value=>value.replace(/\$\{\{\s*([^}]+?)\s*\}\}/g,(_,expression)=>{
    if(expression==='toJSON(needs)')return JSON.stringify(needs);
    return expression.split('.').reduce((value,key)=>value?.[key],{needs})??'';
  });
  const env={...process.env};
  for(const [key,value]of Object.entries(step.env??{}))env[key]=render(String(value));
  return spawnSync('bash',['-e','-o','pipefail','-c',render(step.run)],{cwd:fileURLToPath(new URL('../../../../../',import.meta.url)),env,encoding:'utf8',timeout:5000});
}
