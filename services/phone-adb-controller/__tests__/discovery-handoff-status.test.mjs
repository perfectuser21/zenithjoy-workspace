import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHandlers } from '../leadgen-workflow.mjs';
import { digest } from '../runtime-definition.mjs';

const source = 'source101';
const sha = 'a'.repeat(40);
const videoId = '7702282902591241139';

function fixture(t, { status, collectStatus, verified }) {
  const home = mkdtempSync(join(tmpdir(), 'discovery-handoff-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const upstream = join(home, `douyin_video_discovery-${source}`);
  const current = join(home, 'douyin_video_processing-process102');
  mkdirSync(upstream);
  mkdirSync(current);
  for (const [dir, capability, tag] of [
    [upstream, 'douyin_video_discovery', source],
    [current, 'douyin_video_processing', 'process102'],
  ]) {
    const definition = {
      files: {},
      deployment: { source_commit: sha },
      run_identity: { capability, tag, profile: 'work', run_id: `${capability}-${tag}` },
    };
    writeFileSync(join(dir, 'run-definition.json'), JSON.stringify({
      ...definition, snapshot_sha256: digest(definition),
    }));
  }
  const video = { videoId, title: '原生视频', author: '原作者' };
  writeFileSync(join(upstream, 'discovery-progress.json'), JSON.stringify({
    run: source, profile: 'work', videos: [video], captures: [video],
  }));
  writeFileSync(join(upstream, 'split-result.json'), JSON.stringify({
    status, run_id: `douyin_video_discovery-${source}__a1`,
    workflow_key: 'douyin_video_discovery', source_commit: sha, profile: 'work',
    evidence_status: 'sent',
    results: [{ activity: 'collect_videos', status: collectStatus,
      verification: { verified } }],
  }));
  const own = join(home, 'own.json');
  writeFileSync(own, JSON.stringify({ nicknames: [], ids: [] }));
  const calls = [];
  const env = { HOME: home, WFR_RUN_DIR: current, WFR_TAG: 'process102',
    P: 'work', LEADGEN_LINE: 'jinuo', LEADGEN_SOURCE_RUN: source,
    OWN_ACCOUNTS_CONF: own };
  const handlers = createHandlers({ root: home, env, rpc: async ({ request }) => {
    calls.push(request.op);
    if (request.op === 'company_config') return { result: {
      company_id: 'fake-jinuo', version: 1,
    } };
    if (request.op === 'inspect_videos') return { result: [{ video_id: videoId,
      line_key: 'jinuo', judgment_status: 'pending', process_status: '待判定' }] };
    if (request.op === 'claim_videos') return { result: [{ video_id: videoId,
      judgment_status: 'pending' }] };
    return { result: {} };
  } });
  return { handlers, calls };
}

for (const scenario of [
  { status: 'failed', collectStatus: 'failed', verified: false },
  { status: 'partial', collectStatus: 'completed', verified: true },
  { status: 'completed', collectStatus: 'failed', verified: false },
  { status: 'completed', collectStatus: 'completed', verified: false },
]) {
  test(`102 不领取未验收 101：${JSON.stringify(scenario)}`, async t => {
    const f = fixture(t, scenario);
    await assert.rejects(f.handlers.dedup(), /101.*验收|上游.*终态/);
    assert.equal(f.calls.includes('inspect_videos'), false);
    assert.equal(f.calls.includes('claim_videos'), false);
  });
}

test('102 接受同 SHA 且已验收的 101 来源', async t => {
  const f = fixture(t, { status: 'completed', collectStatus: 'completed', verified: true });
  const dedup = await f.handlers.dedup();
  assert.equal(dedup.eligible, 1);
  assert.deepEqual(f.handlers.state.intakeVideoIds, [videoId]);
  assert.equal(f.calls.includes('inspect_videos'), true);
});
