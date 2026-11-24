import test from 'node:test';
import assert from 'node:assert/strict';
import { createStandaloneScoringTools } from '../standalone-scoring-tools.mjs';

const comment = '10000000-0000-4000-8000-000000000001';
const lead = '10000000-0000-4000-8000-000000000002';
const order = '10000000-0000-4000-8000-000000000003';
const score = { grade:'A', policy_evidence:{
  audience_id:'audience-1', comment_signal:'评论原文', exclusion_rule:null,
  matched_rule:'rule-1', reason:'依据本轮冻结规则', video_signal:'视频原文',
} };
const inputSha = 'b'.repeat(64);
const company = { company_id: '10000000-0000-4000-8000-000000000004', tenant_id: '10000000-0000-4000-8000-000000000005', version: 34, policy_id: 'company-v34' };
const scope = { workflow_key: 'douyin_comment_scoring', line: 'yuesheng', profile: 'mmv-scoring', serial: 'none', run_tag: 'scoring-one', source_run: 'committed-source', limit: 1, company };

function fixture(override = {}) {
  const calls = [];
  const results = {
    company_config: { ...company, run_id: scope.run_tag },
    score_committed_scope: { ids: [comment], sources: { [comment]: scope.source_run } },
    score_input: { comment_id:comment, input_sha256:inputSha, source_run:scope.source_run },
    score_submit: { scored:1, ids:[comment], verified:true, model_call_count:0 },
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
  return { ...tools, calls, invoke: operation => tools.call('business', {
    operation, ...(operation === 'score_submit' ? {input:score} : {}),
  }) };
}

test('103 单步工具核对原公司和数据，只消费固定来源并收执可独立确认的配送', async () => {
  const { invoke, call, readEvidence, calls } = fixture();
  await assert.rejects(call('phone', {}), /STANDALONE_SCORING_OPERATION/);
  await assert.rejects(call('business', { operation: 'score_scope', input: { source_run: 'other' } }), /STANDALONE_SCORING_INPUT/);
  await assert.rejects(invoke('mark_leads'), /STANDALONE_SCORING_SEQUENCE/);
  assert.equal(await readEvidence(), null);
  for (const operation of ['score_scope','score_input','score_submit','score_readback','mark_leads','mark_readback','bridge_outreach','bridge_readback']) await invoke(operation);
  const receipt = await readEvidence();
  assert.deepEqual(receipt, { comment_ids: [comment], lead_ids: [lead], delivery_states: { [order]: 'confirmed' } });
  assert.equal(calls.filter(request => request.op === 'score_submit').length, 1);
  assert.ok(calls.every(request => request.line === scope.line && request.run === scope.run_tag && request.source_run === null && request.limit === 1));
  assert.equal(calls.find(request => request.op === 'score_committed_scope').committed_origin_run, scope.source_run);
  assert.deepEqual(calls.find(request => request.op === 'bridge_outreach').comment_ids, [comment]);
});

test('103 空队列、公司漂移或未知配送不能生成完成证据', async () => {
  const empty = fixture({ score_committed_scope: { ids: [], sources: {} } });
  assert.deepEqual(await empty.invoke('score_scope'), { ids: [], sources: {} });
  await assert.rejects(empty.invoke('score_input'), /STANDALONE_SCORING_NO_ELIGIBLE/);
  assert.equal(await empty.readEvidence(), null);
  const missingSource = fixture({ score_committed_scope: new Error('COMMITTED_PARTIAL_POLICY_MISMATCH') });
  await assert.rejects(missingSource.invoke('score_scope'), { code:'STANDALONE_SCORING_SOURCE_POLICY_MISMATCH' });
  assert.equal(await missingSource.readEvidence(), null);
  const wrong = fixture({ company_config: { ...company, version: 35, run_id: scope.run_tag } });
  await assert.rejects(wrong.invoke('score_scope'), /STANDALONE_SCORING_COMPANY/);
  assert.deepEqual(wrong.calls.map(request => request.op), ['company_config']);
  const uncertain = fixture({ bridge_outreach: new Error('uncertain') });
  for (const op of ['score_scope','score_input','score_submit','score_readback','mark_leads','mark_readback']) await uncertain.invoke(op);
  await assert.rejects(uncertain.invoke('bridge_outreach'), /uncertain/);
  await assert.rejects(uncertain.invoke('bridge_outreach'), /STANDALONE_SCORING_ALREADY_ATTEMPTED/);
  assert.equal(await uncertain.readEvidence(), null);
});

test('103 评分回执丢失时只允许用原评分身份读回', async () => {
  const { invoke, calls } = fixture({ score_submit: new Error('uncertain') });
  await invoke('score_scope');
  await invoke('score_input');
  await assert.rejects(invoke('score_submit'), /uncertain/);
  await assert.rejects(invoke('score_submit'), /STANDALONE_SCORING_ALREADY_ATTEMPTED/);
  assert.equal((await invoke('score_readback')).verified, true);
  assert.deepEqual(calls.slice(-2).map(request => request.op), ['score_readback','policy_review']);
  assert.equal(calls.at(-1).claim, scope.run_tag);
});

test('103 由当前 Codex Agent 按冻结输入评分，宿主工具只读输入和提交本轮结论', async () => {
  const hash = 'b'.repeat(64);
  const policy_evidence = {
    audience_id: 'audience-1', comment_signal: '评论原文', exclusion_rule: null,
    matched_rule: 'rule-1', reason: '依据本轮冻结规则', video_signal: '视频原文',
  };
  const run = fixture({
    score_committed_scope: { ids: [comment], sources: { [comment]: scope.source_run } },
    score_input: { comment_id: comment, input_sha256: hash, source_run: scope.source_run },
    score_submit: { verified: true, model_call_count: 0, scored: 1, ids: [comment] },
  });
  await run.invoke('score_scope');
  await assert.rejects(run.invoke('score'), /STANDALONE_SCORING_INPUT/);
  const input = await run.invoke('score_input');
  assert.equal(input.input_sha256, hash);
  await run.call('business', { operation: 'score_submit', input: { grade: 'A', policy_evidence } });
  const operations = run.calls.map(request => request.op);
  assert.deepEqual(operations, ['company_config', 'score_committed_scope', 'score_input', 'score_submit']);
  assert.deepEqual(run.calls.at(-1).committed_partial_ids, [comment]);
  assert.equal(run.calls.at(-1).input_sha256, hash);
});
