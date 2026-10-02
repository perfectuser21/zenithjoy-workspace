import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import YAML from 'yaml';
const file=new URL('../../../.github/workflows/pilot-release-verification.yml',import.meta.url);
const revision='e42c76127768d408c471cd0e1085a6b2de5e2029';
function config(){assert.ok(existsSync(file),'独立完整发布验证caller必须存在');return YAML.parse(readFileSync(file,'utf8'));}
test('完整发布caller名称与路径固定，仅main push/手动触发，不借PR影响结果',()=>{
 const w=config();assert.equal(w.name,'Pilot release verification');
 assert.deepEqual(Object.keys(w.on).sort(),['push','workflow_dispatch']);assert.deepEqual(w.on.push.branches,['main']);
 assert.equal(w.on.push.paths,undefined);assert.equal(w.concurrency,undefined);
 assert.equal(w.jobs.verify.if,"github.ref == 'refs/heads/main'");
});
test('完整发布只传四项固定来源输入，工具uses与tooling_revision同一40位SHA',()=>{
 const j=config().jobs.verify;
 assert.equal(j.uses,`perfectuser21/cecelia/.github/workflows/pilot-release-verification.yml@${revision}`);
 assert.deepEqual(j.with,{source_repo:'perfectuser21/zenithjoy-workspace',scope:'zenithjoy',head_revision:'${{ github.sha }}',tooling_revision:revision});
 assert.equal(j['continue-on-error'],undefined);assert.equal(j.needs,'caller-contract');
});
test('发布caller只传三项显式secret，保read权限和实际main拒绝闸',()=>{
 const w=config();assert.deepEqual(w.permissions,{contents:'read',actions:'read'});
 assert.deepEqual(w.jobs.verify.secrets,{TS_AUTHKEY:'${{ secrets.TS_AUTHKEY }}',CECELIA_INTERNAL_TOKEN:'${{ secrets.CECELIA_INTERNAL_TOKEN }}',BRAIN_DEPLOY_URL:'${{ secrets.BRAIN_DEPLOY_URL }}'});
 const guard=w.jobs['caller-contract'].steps.find(s=>s.env?.RUN_REF==='${{ github.ref }}');
 assert.equal(guard.run,'test "$RUN_REF" = refs/heads/main');
});
test('发布协议断言在现有PR检查和自身main检查永久执行，旧影响caller保留',()=>{
 const command='node --test scripts/ci/__tests__/pilot-release-workflow.test.mjs';
 const w=config(),legacy=YAML.parse(readFileSync(new URL('../../../.github/workflows/implementation-impact.yml',import.meta.url),'utf8'));
 assert.ok(w.jobs['caller-contract'].steps.some(s=>s.run===command));
 assert.ok(legacy.jobs['caller-contract'].steps.some(s=>s.run===command));
 assert.ok(legacy.on.pull_request);assert.match(legacy.jobs.impact.uses,/\/implementation-impact.yml@[a-f0-9]{40}$/);
});
