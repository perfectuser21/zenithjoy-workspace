import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';

const manifestPath = new URL('./fixtures/leadgen-historical-evidence-index.json', import.meta.url);
const expected = {
  douyin_video_discovery: ['preflight', 'collect_videos', 'cleanup'],
  douyin_video_processing: ['preflight', 'dedup', 'qualification', 'collection', 'cleanup'],
  douyin_comment_scoring: ['scoring', 'mark_leads'],
  douyin_lead_outreach: ['preflight', 'send_dm', 'write_back', 'cleanup'],
};

test('历史样本索引覆盖四个流程全部活动引用，并显式限定为旧代码证据', () => {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.kind, 'historical_code_evidence_index');
  assert.equal(manifest.current_skill_verified, false);
  assert.equal(manifest.integrity_check.business_outcome_confirmed, false);
  assert.match(manifest.integrity_check.verified_at, /^2026-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.match(manifest.source_commit, /^[a-f0-9]{40}$/);
  assert.deepEqual(Object.keys(manifest.workflows).sort(), Object.keys(expected).sort());
  let receipts = 0;
  let files = 0;
  for (const [workflow, keys] of Object.entries(expected)) {
    const entry = manifest.workflows[workflow];
    assert.deepEqual(Object.keys(entry.activities).sort(), [...keys].sort());
    assert.match(entry.ledger_dir, /^~\/\.config\/zenithjoy\/ledger\//);
    assert.ok(['xian-m4', 'mmv'].includes(entry.host));
    assert.ok(entry.readbacks.length > 0);
    receipts += keys.length;
    files += keys.length + entry.readbacks.length;
    for (const readback of entry.readbacks) {
      assert.match(readback.file, /^[\w-]+-readback\.json$/);
      assert.match(readback.sha256, /^[a-f0-9]{64}$/);
    }
    for (const [key, item] of Object.entries(entry.activities)) {
      assert.deepEqual(Object.keys(item).sort(), ['file', 'sha256', 'status', 'verified']);
      assert.equal(item.file, `activity-${key}.json`);
      assert.match(item.sha256, /^[a-f0-9]{64}$/);
      assert.equal(item.status, 'completed');
      assert.equal(item.verified, true);
    }
  }
  assert.equal(manifest.integrity_check.activity_receipts_checked, receipts);
  assert.equal(manifest.integrity_check.files_checked, files);
  assert.equal(manifest.outreach_receipt.delivery_verified, false);
  assert.equal(manifest.outreach_receipt.message_delta_verified, true);
  assert.equal(manifest.run_candidates.owner_labeled, false);
  for (const workflow of Object.keys(expected)) {
    const candidates = manifest.run_candidates.entries.filter(item => item.workflow === workflow);
    assert.deepEqual(candidates.map(item => item.observed_outcome).sort(), ['fail', 'pass']);
    for (const candidate of candidates) {
      assert.ok(candidate.run_id.startsWith(workflow + '-'));
      for (const key of [...candidate.failed_activities, ...candidate.skipped_activities]) {
        assert.ok(expected[workflow].includes(key), `${workflow}: unexpected activity ${key}`);
      }
    }
  }
  const outreachPass = manifest.run_candidates.entries.find(item => item.workflow === 'douyin_lead_outreach' && item.observed_outcome === 'pass');
  assert.ok(outreachPass.skipped_activities.includes('send_dm'), 'pass must not be misreported as a sent message');
});

test('仅关联现存离线测试文件，不把模拟测试描述为真机样本', () => {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.test_examples.kind, 'offline_tests_not_live_skill_runs');
  for (const path of manifest.test_examples.paths) {
    assert.match(path, /^services\/phone-adb-controller\/__tests__\/[\w.-]+\.test\.mjs$/);
    assert.ok(existsSync(resolve(path)), `missing test example: ${path}`);
  }
});

test('索引活动顺序与仓库当前合同一致，合同变动时不能静默沿用旧映射', async () => {
  const {parse} = await import('yaml');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const [workflow, entry] of Object.entries(manifest.workflows)) {
    const contract = parse(readFileSync(`product-map/contracts/${workflow}.yaml`, 'utf8'));
    assert.equal(contract.brain_workflow_key, workflow);
    const actual = contract.activities.map(activity => activity.key ?? activity.ref.split('.').at(-1));
    assert.deepEqual(actual, Object.keys(entry.activities));
  }
});
