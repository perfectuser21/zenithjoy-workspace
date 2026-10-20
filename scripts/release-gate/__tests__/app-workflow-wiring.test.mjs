import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse} from 'yaml';
const load = name => parse(readFileSync(new URL(`../../../.github/workflows/${name}.yml`,import.meta.url),'utf8'));
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
    assert.deepEqual(deploy.concurrency,{group:'zenithjoy-production-hk','cancel-in-progress':false});
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
  }
  assert.equal(w.jobs['release-tag'].env.DEPLOY_SHA,'${{ needs.admission.outputs.sha }}');
  assert.notEqual(w.concurrency?.group,'zenithjoy-production-hk');
});
test('dashboard rollback serializes against every HK production deployment',()=>{
  const w=load('rollback-dashboard-prod');
  assert.deepEqual(w.jobs['rollback-dashboard'].concurrency,{group:'zenithjoy-production-hk','cancel-in-progress':false});
});
