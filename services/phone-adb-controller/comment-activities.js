'use strict';

// 阶段3：显式评论对象 → 活动结果。模型和存储是边界依赖；本模块不扫描池、不读账号配置。
const { routeOf } = require('./line-routes.js');
const { TARGET_PROFILES } = require('./judge-video.js');
const { judgeComment, GRADES } = require('./judge-comment.js');
const { settlePending, verdictFields, txt } = require('./sort-comments-lib.js');

function validateInput(input) {
  if (!input || typeof input.run_tag !== 'string' || !input.run_tag.trim()) {
    throw new Error('活动输入缺 run_tag');
  }
  const route = routeOf(input.line_key);
  if (!Array.isArray(input.comments)) throw new Error('活动输入 comments 必须为数组');
  const ids = new Set();
  for (const row of input.comments) {
    if (!row || typeof row.id !== 'string' || !row.id.trim()
        || !row.fields || typeof row.fields !== 'object' || Array.isArray(row.fields)) {
      throw new Error('评论必须有非空 id 和 fields 对象');
    }
    if (ids.has(row.id)) throw new Error('评论 id 重复: ' + row.id);
    ids.add(row.id);
  }
  return route;
}

function validVerdict(verdict) {
  return verdict && GRADES.includes(verdict.grade)
    && verdict.relevance === (verdict.grade === '不相关' ? '不相关' : '相关');
}

function validateDeliveryInput(input) {
  const route = validateInput(input);
  for (const row of input.comments) {
    if (row.verdict !== undefined && (!validVerdict(row.verdict) || row.score_status === 'pending')) {
      throw new Error('配送收到非法或未完成的评分结果: ' + row.id);
    }
  }
  return route;
}

function activityResult(input, comments, metrics, evidence, pending) {
  return {
    schema_version: 1, run_tag: input.run_tag, line_key: routeOf(input.line_key).key,
    status: pending ? (pending === comments.length ? 'failed' : 'partial') : 'completed',
    failure_class: pending ? 'retryable' : null,
    outputs: { comments }, metrics, evidence,
  };
}

async function scoreComments(input, { judge = judgeComment, judgeOptions = {} } = {}) {
  const route = validateInput(input);
  const profile = TARGET_PROFILES[route.key];
  if (!profile) throw new Error('该业务线未配置目标客户画像');
  const comments = [];
  const evidence = [];
  const metrics = { comments_scored: 0, pending: 0, grades: { A: 0, B: 0, C: 0, 不相关: 0 } };
  for (const source of input.comments) {
    const row = structuredClone(source);
    // 重判失败不能带着上轮 verdict 冒充本轮判定成功。
    delete row.verdict;
    delete row.delivery_status;
    try {
      const verdict = await judge(txt(row.fields['评论原文']), txt(row.fields['来源视频']), profile,
        { ...judgeOptions, comment_id: row.id });
      if (!validVerdict(verdict)) throw new Error('评分结果不在四档闭集内');
      row.verdict = { grade: verdict.grade, relevance: verdict.relevance, reason: verdict.reason || '' };
      row.score_status = 'completed';
      metrics.comments_scored++;
      metrics.grades[verdict.grade]++;
      evidence.push({ comment_id: row.id, status: 'completed', grade: verdict.grade });
    } catch (_) {
      row.score_status = 'pending';
      metrics.pending++;
      evidence.push({ comment_id: row.id, status: 'pending', failure_class: 'retryable' });
    }
    comments.push(row);
  }
  return activityResult(input, comments, metrics, evidence, metrics.pending);
}

// 配送的这一单元结算已落池评论；原始评论落池仍由 push-raw-comments 完成。
// 评分可在落池之前独立调用，配送时 id 是持久化池记录 id。
async function deliverComments(input, deps = {}) {
  const route = validateDeliveryInput(input);
  const storage = deps.deps || {};
  const scored = input.comments.some(row => row.verdict !== undefined);
  if (scored && (!(deps.seen instanceof Map) || typeof deps.asLeadTime !== 'function'
      || typeof deps.now !== 'string'
      || ['putPool', 'postLead', 'putLead'].some(k => typeof storage[k] !== 'function'))) {
    throw new Error('配送缺少显式存储依赖/去重表/时间上下文');
  }
  const comments = [];
  const evidence = [];
  const metrics = { leads_written: 0, duplicates_highlighted: 0, pending: 0, unscored: 0 };
  const settle = deps.settle || settlePending;
  const permanentFailures = [];
  const writesFor = (commentId, failure) => {
    const call = async (name, ...args) => {
      try { return await storage[name](...args); }
      catch (error) {
        if (error.failure_class === 'fatal') failure.error = error;
        throw error;
      }
    };
    return {
      postLead: async fields => {
        const result = await call('postLead', fields, commentId);
        if (result && result.code === 0) {
          if (!(result.data && result.data.record && result.data.record.record_id)) {
            throw new Error('线索写入未返回 record_id');
          }
          metrics.leads_written++;
        }
        return result;
      },
      putLead: async (id, fields) => {
        const result = await call('putLead', id, fields, commentId);
        if (result && result.code === 0) metrics.duplicates_highlighted++;
        return result;
      },
      putPool: async (id, fields) => {
        const result = await call('putPool', id, fields);
        if (!result || result.code !== 0) throw new Error('评论池写入未确认');
        return result;
      },
    };
  };
  for (const source of input.comments) {
    const row = structuredClone(source);
    if (!row.verdict) {
      row.delivery_status = 'unscored';
      metrics.unscored++;
      evidence.push({ comment_id: row.id, status: 'unscored' });
      comments.push(row);
      continue;
    }
    if (deps.settled_ids instanceof Set && deps.settled_ids.has(row.id)) {
      row.delivery_status = 'completed';
      evidence.push({ comment_id: row.id, status: 'completed', replay: true });
      comments.push(row);
      continue;
    }
    const failure = {};
    const writes = writesFor(row.id, failure);
    try {
      let result;
      if (deps.lead_receipts instanceof Map && deps.lead_receipts.has(row.id)) {
        // 线索落地但池回执失败：本次只补池，不把同一条评论再算成重复意向。
        await writes.putPool(row.id, { 处理状态: '已分拣', 进入最终线索: true,
          ...verdictFields(row.verdict, true) });
        result = { retryable: false };
      } else {
        result = await settle({ row, verdict: row.verdict, deps: writes, route,
          seen: deps.seen, now: deps.now, asLeadTime: deps.asLeadTime });
      }
      row.delivery_status = result.retryable ? 'pending' : 'completed';
      if (result.retryable) metrics.pending++;
    } catch (_) {
      row.delivery_status = 'pending';
      metrics.pending++;
    }
    evidence.push({ comment_id: row.id, status: row.delivery_status,
      ...(row.delivery_status === 'pending' ? { failure_class: failure.error ? 'fatal' : 'retryable',
        ...(failure.error ? { reason_code: failure.error.reason_code || 'storage_rejected' } : {}) } : {}) });
    if (row.delivery_status === 'pending' && failure.error) permanentFailures.push(failure.error);
    comments.push(row);
  }
  const result = activityResult(input, comments, metrics, evidence, metrics.pending);
  if (permanentFailures.length) {
    result.failure_class = 'fatal';
    result.reason_code = permanentFailures[0].reason_code || 'storage_rejected';
  }
  return result;
}

module.exports = { scoreComments, deliverComments, validateInput, validateDeliveryInput };
