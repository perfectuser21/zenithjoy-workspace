import test from 'node:test';
import assert from 'node:assert/strict';
import { createStandaloneScoringTools } from '../standalone-scoring-tools.mjs';

const comment = '10000000-0000-4000-8000-000000000001';
const lead = '10000000-0000-4000-8000-000000000002';
const order = '10000000-0000-4000-8000-000000000003';
const company = { company_id: '10000000-0000-4000-8000-000000000004', tenant_id: '10000000-0000-4000-8000-000000000005', version: 34, policy_id: 'company-v34' };
const scope = { workflow_key: 'douyin_comment_scoring', line: 'yuesheng', profile: 'mmv-scoring', serial: 'none', run_tag: 'scoring-one', source_run: 'committed-source', limit: 1, company };

function fixture(override = {}) {
  const calls = [];
  const results = {
    company_config: { ...company, run_id: scope.run_tag },
    score_scope: { ids: [comment], sources: { [comment]: scope.source_run } },
    score: { scored: 1, ids: [comment], blocked: 0 },
    score_readback: { verified: true, failures: 0, ids: [comment] },
    policy_review: { verified: true, ids: [comment] },
    mark_leads: { marked: 1, blocked: 0, ids: [comment], lead_ids: [lead] },
    mark_readback: { verified: true, failures: 0, ids: [comment], lead_ids: [lead] },
    bridge_outreach: { verified: true, unknown: 0, ids: [order] },
    bridge_readback: { verified: true, failures: 0, ids: [order], states: { [order]: 'confirmed' } },
    ...override,
  };
  const rpc = async ({ kind, request }) => {
    assert.equal(kind, 'queue');
    calls.push(request);
    const output = results[request.op];
    if (output instanceof Error) throw output;
    return { ok: true, result: output };
  };
  const tools = createStandaloneScoringTools({ scope, rpc, assertAuthority: async () => {} });
  return { ...tools, calls, invoke: operation => tools.call('business', { operation }) };
}

test('103 单步工具核对原公司和数据，只消费固定来源并收执可独立确认的配送', async () => {
  const { invoke, call, readEvidence, calls } = fixture();
  await assert.rejects(call('phone', {}), /STANDALONE_SCORING_OPERATION/);
  await assert.rejects(call('business', { operation: 'score_scope', input: { source_run: 'other' } }), /STANDALONE_SCORING_INPUT/);
  await assert.rejects(invoke('mark_leads'), /STANDALONE_SCORING_SEQUENCE/);
  assert.equal(await readEvidence(), null);
  for (const operation of ['score_scope','score','score_readback','mark_leads','mark_readback','bridge_outreach','bridge_readback']) await invoke(operation);
  const receipt = await readEvidence();
  assert.deepEqual(receipt, { comment_ids: [comment], lead_ids: [lead], delivery_states: { [order]: 'confirmed' } });
  assert.equal(calls.filter(request => request.op === 'score').length, 1);
  assert.ok(calls.every(request => request.line === scope.line && request.run === scope.run_tag && request.source_run === scope.source_run && request.limit === 1));
  assert.deepEqual(calls.find(request => request.op === 'bridge_outreach').comment_ids, [comment]);
});

test('103 空队列、公司漂移或未知配送不能生成完成证据', async () => {
  const empty = fixture({ score_scope: { ids: [], sources: {} } });
  assert.deepEqual(await empty.invoke('score_scope'), { ids: [], sources: {} });
  await assert.rejects(empty.invoke('score'), /STANDALONE_SCORING_NO_ELIGIBLE/);
  assert.equal(await empty.readEvidence(), null);
  const wrong = fixture({ company_config: { ...company, version: 35, run_id: scope.run_tag } });
  await assert.rejects(wrong.invoke('score_scope'), /STANDALONE_SCORING_COMPANY/);
  assert.deepEqual(wrong.calls.map(request => request.op), ['company_config']);
  const uncertain = fixture({ bridge_outreach: new Error('uncertain') });
  for (const op of ['score_scope','score','score_readback','mark_leads','mark_readback']) await uncertain.invoke(op);
  await assert.rejects(uncertain.invoke('bridge_outreach'), /uncertain/);
  await assert.rejects(uncertain.invoke('bridge_outreach'), /STANDALONE_SCORING_ALREADY_ATTEMPTED/);
  assert.equal(await uncertain.readEvidence(), null);
});

test('103 评分回执丢失时只允许用原评分身份读回', async () => {
  const { invoke, calls } = fixture({ score: new Error('uncertain') });
  await invoke('score_scope');
  await assert.rejects(invoke('score'), /uncertain/);
  await assert.rejects(invoke('score'), /STANDALONE_SCORING_ALREADY_ATTEMPTED/);
  assert.equal((await invoke('score_readback')).verified, true);
  assert.deepEqual(calls.slice(-2).map(request => request.op), ['score_readback','policy_review']);
  assert.equal(calls.at(-1).claim, scope.run_tag);
});
