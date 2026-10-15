import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadContractsFromDisk, validateContracts } from '../../../scripts/product-map/contracts-lib.mjs';
import { planFor } from '../../../scripts/product-map/wf-plan.mjs';

const workflows = {
  douyin_video_discovery: ['preflight', 'collect_videos', 'cleanup'],
  douyin_video_processing: ['preflight', 'dedup', 'qualification', 'collection', 'cleanup'],
  douyin_comment_scoring: ['scoring', 'mark_leads'],
  douyin_lead_outreach: ['preflight', 'send_dm', 'write_back', 'cleanup'],
};

test('正式入口加载凭据后保留显式Brain地址，并核新旧MMV精确主机与独立评分身份', async t => {
  // 隔离的进程入口夹具，不连接Brain、不操作手机、不作为业务验收证据。
  const home = mkdtempSync(join(tmpdir(), 'leadgen-entry-env-'));
  try {
    const app = join(home, 'app');
    for (const dir of [app, join(app, 'plans'), join(home, '.credentials'), join(home, '.local/bin')]) mkdirSync(dir, { recursive: true });
    copyFileSync(new URL('../leadgen-run.sh', import.meta.url), join(app, 'leadgen-run.sh'));
    writeFileSync(join(home, '.credentials/brain.env'), 'BRAIN_URL=http://wrong-mirror.invalid:5221\nFIXTURE_CREDENTIAL_LOADED=1\n');
    const plan = 'WF_RUNNER=leadgen-workflow.mjs\nWF_MISSING=\nWF_BRAIN_WORKFLOW=fixture\nWF_CONTRACT_RAW_SHA256=fixture\nWF_ACTIVITY_REFS=fixture\nWF_STEP_SPEC=fixture\n';
    writeFileSync(join(app, 'plans/douyin_comment_scoring.plan'), plan);
    writeFileSync(join(app, 'runtime-receipts.mjs'), `import {mkdirSync,writeFileSync,copyFileSync} from 'node:fs';
import {join} from 'node:path';
if(process.argv[2]==='prepare'){
 const dir=process.env.WFR_RUN_DIR; mkdirSync(join(dir,'runtime'),{recursive:true});
 copyFileSync(process.argv[1],join(dir,'runtime/runtime-receipts.mjs'));
 writeFileSync(join(dir,'workflow.plan'),${JSON.stringify(plan)});
 writeFileSync(join(dir,'runtime/leadgen-workflow.mjs'), 'console.log(JSON.stringify({brain:process.env.BRAIN_URL,loaded:process.env.FIXTURE_CREDENTIAL_LOADED,host:process.env.WFR_HOSTKEY,localRpc:process.env.LEADGEN_LOCAL_RPC,profile:process.env.P,serial:process.env.SERIAL}));');
}else if(process.argv[2]==='bind-run')console.log('WFR_ATTEMPT=fixture; WFR_SKIP_WORDS=');
else process.exit(1);
`);
    const cases = [
      {host:'aad17-2',explicit:true}, {host:'aad17-2',explicit:false},
      {host:'r10-7',explicit:true}, {host:'r10-7',explicit:false},
      {host:'r10-70',error:'执行机未登记'},
      {host:'r10-7',profile:'phone-profile',error:'MMV只执行独立评论评分'},
      {host:'r10-7',serial:'phone-serial',error:'MMV只执行独立评论评分'},
      ...['douyin_video_discovery','douyin_video_processing','douyin_lead_outreach'].map(flow=>({host:'r10-7',flow,error:'MMV只执行独立评论评分'})),
    ];
    for (const [index, row] of cases.entries()) await t.test(JSON.stringify(row), () => {
      writeFileSync(join(home, '.local/bin/hostname'), '#!/bin/sh\nprintf "'+row.host+'\\n"\n', {mode:0o755});
      const env = { ...process.env, HOME: home, ZDOTDIR: home, WFR_HOME: join(home, 'case-'+index) };
      delete env.BRAIN_URL;
      if (row.explicit) env.BRAIN_URL = 'http://registered-brain.invalid:5221';
      const out = spawnSync('/bin/zsh', [join(app, 'leadgen-run.sh'), row.flow||'douyin_comment_scoring', row.profile||'mmv-scoring', row.serial||'none', 'fixture', 'fixture'], { env, encoding: 'utf8' });
      if (row.error) {
        assert.equal(out.status,1,out.stderr);
        assert.ok(out.stderr.includes(row.error),out.stderr);
        assert.equal(out.stdout.trim(),'','禁止身份必须在业务prepare前退出');
        return;
      }
      assert.equal(out.status, 0, out.stderr);
      const receipt = JSON.parse(out.stdout.trim().split('\n').at(-1));
      assert.equal(receipt.brain, row.explicit ? env.BRAIN_URL : 'http://wrong-mirror.invalid:5221');
      assert.equal(receipt.loaded, '1', '保留地址不能跳过凭据加载');
      assert.equal(receipt.host,'mmv');assert.equal(receipt.localRpc,'1');
      assert.equal(receipt.profile,'mmv-scoring');assert.equal(receipt.serial,'none');
    });
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('四流程可分别组装，仍归同一智能获客能力，每个活动有Commander绑定', () => {
  const ctx = loadContractsFromDisk();
  assert.deepEqual(validateContracts(ctx), []);
  for (const [key, slots] of Object.entries(workflows)) {
    const doc = ctx.contracts[key];
    assert.ok(doc, `缺正式契约: ${key}`);
    assert.equal(doc.capability, 'keyword_acquisition');
    assert.equal(doc.brain_workflow_key, key);
    const plan = planFor(ctx, key);
    assert.equal(plan.ok, true, plan.errors?.join('\n'));
    assert.deepEqual(plan.activities.map(a => a.key), slots);
    assert.equal(plan.env.WF_RUNNER, 'leadgen-workflow.mjs');
    assert.equal(plan.env.WF_MISSING, '');
    for (const a of plan.activities) assert.equal(a.commander.entry, 'activity-commander.mjs');
  }
});

test('阶段执行必须带真实Commander回执，模型不可达不能冒充已上岗，清场仍执行', async () => {
  const { runActivity } = await import('../activity-commander.mjs');
  const events = [];
  let executed = 0;
  const result = await runActivity({
    activity: { key: 'source', budget: { max_duration_s: 5 } },
    context: { run_id: 'test', workflow_key: 'douyin_video_discovery' },
    execute: async () => { executed++; return { cards: 2 }; },
    commander: async receipt => { events.push(receipt); return { action: 'continue', reason: '已核实' }; },
    record: async receipt => events.push(receipt),
  });
  assert.equal(executed, 1);
  assert.equal(result.status, 'completed');
  assert.ok(events.some(e => e.phase === 'before'));
  assert.ok(events.some(e => e.phase === 'after'));
  await assert.rejects(runActivity({
    activity: { key: 'source', budget: { max_duration_s: 5 } }, context: {},
    execute: async () => { executed++; }, commander: async () => { throw Error('AUTH_UNAVAILABLE'); },
    record: async () => {},
  }), /AUTH_UNAVAILABLE/);
  assert.equal(executed, 1);
  let cleaned = false;
  const cleanup = await runActivity({
    activity: { key: 'cleanup', budget: { max_duration_s: 5 } }, context: {},
    execute: async () => { cleaned = true; return { lock_released: true }; },
    commander: async () => { throw Error('AUTH_UNAVAILABLE'); }, record: async () => {},
  });
  assert.equal(cleaned, true);
  assert.equal(cleanup.commander_status, 'unavailable');
});
