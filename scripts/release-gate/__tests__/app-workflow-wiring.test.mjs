import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const load = name => JSON.parse(execFileSync('python3',['-c',
  'import json,sys,yaml; d=yaml.safe_load(open(sys.argv[1])); d["on"]=d.pop(True,d.get("on")); print(json.dumps(d))',
  fileURLToPath(new URL(`../../../.github/workflows/${name}.yml`,import.meta.url))],{encoding:'utf8'}));
for (const [name,target] of [['promote-dashboard-prod','dashboard'],['promote-staff-hub-prod-hk','staff-hub']]) {
  test(`${target} dispatch and reusable callers cannot bypass same-SHA admission`,()=>{
    const w=load(name);
    for(const trigger of ['workflow_dispatch','workflow_call']) {
      assert.equal(w.on[trigger].inputs.sha.required,true);
      assert.equal(w.on[trigger].inputs.acceptance_run_key.required,true);
    }
    assert.equal(w.jobs.admission.uses,'./.github/workflows/release-admission.yml');
    assert.equal(w.jobs.admission.with.targets,target);
    const deploy=Object.values(w.jobs).find(j=>j.runs_on || j['runs-on']);
    assert.ok([deploy.needs].flat().includes('admission'));
    assert.equal(deploy.env.DEPLOY_SHA,'${{ needs.admission.outputs.sha }}');
    assert.equal(deploy.concurrency,undefined);
    assert.equal(w.on.workflow_call.inputs.coordinated.type,'boolean');
    assert.equal(w.on.workflow_dispatch.inputs.coordinated,undefined);
    assert.equal(w.concurrency['cancel-in-progress'],false);
    assert.equal(w.concurrency.group,`\${{ inputs.coordinated && format('zenithjoy-nested-{0}-${target}', github.run_id) || 'zenithjoy-production-hk' }}`);
  });
}
test('all delegates to the same single-target deployment paths with one candidate',()=>{
  const w=load('promote-all-prod');
  assert.equal(w.jobs.admission.uses,'./.github/workflows/release-admission.yml');
  assert.equal(w.jobs.admission.with.targets,'api,dashboard');
  for(const [job,workflow] of [['promote-backend','promote-prod-hk'],['promote-frontend','promote-dashboard-prod']]) {
    assert.equal(w.jobs[job].uses,`./.github/workflows/${workflow}.yml`);
    assert.equal(w.jobs[job].with.sha,'${{ needs.admission.outputs.sha }}');
    assert.ok([w.jobs[job].needs].flat().includes('admission'));
    assert.equal(w.jobs[job].steps,undefined);
    assert.equal(w.jobs[job].with.coordinated,true);
  }
  assert.equal(w.jobs['release-tag'].env.DEPLOY_SHA,'${{ needs.admission.outputs.sha }}');
  assert.equal(w.concurrency?.group,'zenithjoy-production-hk');
});
test('dashboard rollback serializes against every HK production deployment',()=>{
  const w=load('rollback-dashboard-prod');
  assert.deepEqual(w.concurrency,{group:'zenithjoy-production-hk','cancel-in-progress':false});
  assert.equal(w.jobs['rollback-dashboard'].concurrency,undefined);
});
