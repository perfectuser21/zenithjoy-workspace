import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
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
test('dashboard rollback uses trusted verified-content controller instead of mutable legacy rollback',()=>{
 const w=load('rollback-dashboard-prod'),j=w.jobs['rollback-dashboard'];
 assert.equal(j.if,"github.ref == 'refs/heads/main'");
 assert.ok(j.steps.some(s=>s.uses==='actions/checkout@v4'));
 const remote=j.steps.find(s=>s.uses==='appleboy/ssh-action@v1.0.3');
 assert.match(remote.with.script,/frontend-release\.sh[" ]+--rollback/);
 assert.doesNotMatch(remote.with.script,/\$REPO\/rollback\.sh/);
});


test('Hong Kong API releases keep matching staging and Brain acceptance after private canvas retirement', () => {
  const staging = load('deploy-staging-hk');
  const promote = load('promote-prod-hk');
  assert.equal(staging.on.workflow_dispatch?.inputs?.video_tools, undefined);
  for (const trigger of ['workflow_dispatch', 'workflow_call']) {
    assert.equal(promote.on[trigger].inputs.video_tools, undefined);
  }
  assert.equal(promote.jobs.admission.uses, './.github/workflows/release-admission.yml');
  assert.equal(promote.jobs.admission.with.video_tools_live, undefined);
  assert.ok(promote.jobs['promote-prod-hk'].needs.includes('admission'));
  assert.ok(promote.jobs['promote-prod-hk'].steps.some(step => step.name === 'Confirm promotion'));
  const flags = [staging.jobs['deploy-staging-hk'], promote.jobs['promote-prod-hk']];
  assert.ok(flags.every(job => job.steps.every(step => !/hk-canvas-(production|staging)\.sh/.test(step.run || ''))));
  const admission = load('release-admission');
  assert.equal(admission.on.workflow_call.inputs.video_tools_live, undefined);
  assert.ok(admission.jobs.admission.steps.some(step => step.name === 'Verify exact candidate staging runs'));
  assert.ok(admission.jobs.admission.steps.some(step => step.name === 'Read frozen business acceptance from Brain' && step.if === undefined));
  for (const workflow of ['deploy-creative-canvas-staging', 'video-tools-live-acceptance']) {
    assert.equal(existsSync(new URL(`../../../.github/workflows/${workflow}.yml`, import.meta.url)), false);
  }
});
