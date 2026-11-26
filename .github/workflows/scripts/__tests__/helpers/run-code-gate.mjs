import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Execute the real aggregate step, including its GitHub-provided JSON environment.
export function runCodeGate(workflow, openclawResult, overrides = {}) {
  const needs = { changes: { result: 'success', outputs: Object.fromEntries(Object.keys(workflow.jobs.changes.outputs).map(key => [key, 'false'])) } };
  for (const job of workflow.jobs['l3-passed'].needs.filter(job => job !== 'changes')) {
    const condition = workflow.jobs[job].if;
    const selected = !condition || Function('needs', 'return (' + condition + ')')(needs);
    needs[job] = { result: selected ? 'success' : 'skipped' };
  }
  needs['openclaw-scripts-test']={result:openclawResult};
  for(const [job,result] of Object.entries(overrides)) {
    if(result === null) delete needs[job]; else needs[job]={result};
  }
  const step=workflow.jobs['l3-passed'].steps.find(step=>step.run);
  const render=value=>value.replace(/\$\{\{\s*([^}]+?)\s*\}\}/g,(_,expression)=>{
    if(expression==='toJSON(needs)')return JSON.stringify(needs);
    return expression.split('.').reduce((value,key)=>value?.[key],{needs})??'';
  });
  const env={...process.env};
  for(const [key,value]of Object.entries(step.env??{}))env[key]=render(String(value));
  return spawnSync('bash',['-e','-o','pipefail','-c',render(step.run)],{cwd:fileURLToPath(new URL('../../../../../',import.meta.url)),env,encoding:'utf8',timeout:5000});
}
