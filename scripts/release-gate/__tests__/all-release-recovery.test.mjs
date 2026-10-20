import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const load=name=>JSON.parse(execFileSync('python3',['-c','import json,sys,yaml;d=yaml.safe_load(open(sys.argv[1]));d["on"]=d.pop(True,d.get("on"));print(json.dumps(d))',`.github/workflows/${name}.yml`],{encoding:'utf8'}));
test('整体前端失败精确恢复本轮API旧版本，整体仍为失败且不打成功tag',()=>{
 const all=load('promote-all-prod');const r=all.jobs['recover-backend'];
 assert.equal(r?.uses,'./.github/workflows/rollback-prod.yml');
 assert.ok(r.needs.includes('promote-backend')&&r.needs.includes('promote-frontend'));
 assert.equal(r.with.sha,'${{ needs.promote-backend.outputs.previous_sha }}');
 assert.equal(r.with.coordinated,true);
 assert.match(r.if,/promote-frontend.result == 'failure'/);
 assert.match(r.if,/promote-backend.result == 'success'/);
 assert.ok(!all.jobs['release-tag'].if);
 assert.equal(load('promote-prod-hk').on.workflow_call.outputs.previous_sha.value,'${{ jobs.promote-prod-hk.outputs.previous_sha }}');
});
test('API回退不可与其他生产发布交错，内部恢复不自锁',()=>{
 const w=load('rollback-prod');assert.equal(w.on.workflow_dispatch.inputs.coordinated,undefined);
 assert.equal(w.on.workflow_call.inputs.coordinated.type,'boolean');
 assert.equal(w.concurrency.group,"${{ inputs.coordinated && format('zenithjoy-nested-{0}-api-rollback', github.run_id) || 'zenithjoy-production-hk' }}");
});
