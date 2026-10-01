'use strict';

const { validateInput } = require('./comment-activities.js');
const { txt } = require('./sort-comments-lib.js');

const RAW_COMMENT_FIELDS = ['原始评论ID', '运行批次', '采集时间', '命中关键词', '来源视频',
  '评论作品视频链接', '评论原文', '评论者昵称', '用户主页标识', '抖音号', '主页链接',
  '账号类型', '留言时间', '主页IP', '地区', '处理状态'];

// 显式字段优先；旧池对象只带拼串时仍可使用。不读TSV、账号配置或历史评分。
function identity(fields) {
  const parts = txt(fields.用户主页标识).split(' | ');
  const dyid = txt(fields.抖音号 !== undefined ? fields.抖音号 : (parts[0] && !parts[0].startsWith('http') ? parts[0] : ''));
  const purl = txt(fields.主页链接 !== undefined ? fields.主页链接 : parts.find(value => value.startsWith('http')));
  const atype = txt(fields.账号类型 !== undefined ? fields.账号类型 : parts[2]);
  const nick = txt(fields.评论者昵称);
  const comment = txt(fields.评论原文);
  return { nick, dyid, purl, atype, comment,
    profile: fields.用户主页标识 !== undefined ? txt(fields.用户主页标识) : [dyid, purl, atype].filter(Boolean).join(' | ') };
}

function rawCommentId(fields) {
  const { nick, dyid, comment } = identity(fields);
  return `${nick}|${dyid || 'noid'}|${comment.slice(0, 20)}`;
}

function sameRawComment(left, right) {
  const a = identity(left), b = identity(right);
  return a.nick === b.nick && a.comment === b.comment && a.profile === b.profile
    && a.dyid === b.dyid && a.purl === b.purl && a.atype === b.atype;
}

function poolFields(input, fields, { now, asTime }) {
  const value = name => txt(fields[name]);
  const { nick, dyid, purl, atype, comment, profile } = identity(fields);
  const vurl = value('评论作品视频链接');
  return {
    原始评论ID: rawCommentId(fields), 运行批次: input.run_tag,
    采集时间: asTime('采集时间', now), 命中关键词: value('命中关键词'),
    来源视频: value('来源视频').slice(0, 100),
    评论作品视频链接: vurl.startsWith('http') ? vurl : '',
    评论原文: comment, 评论者昵称: nick, 用户主页标识: profile,
    抖音号: dyid, 主页链接: purl, 账号类型: atype,
    留言时间: value('留言时间'), 主页IP: value('主页IP').trim(), 地区: value('地区'),
    处理状态: '待分拣',
  };
}

async function persistRawComments(input, deps = {}) {
  const route = validateInput(input);
  if (input.comments.length && (!(deps.seen instanceof Map) || typeof deps.postPool !== 'function'
      || typeof deps.now !== 'string' || typeof deps.asTime !== 'function')) {
    throw new Error('落池缺少显式存储依赖/去重表/时间上下文');
  }
  const comments = [], pending_comments = [], evidence = [];
  const outputRows = new Map();
  const metrics = { comments_written: 0, duplicates: 0, pending: 0 };
  let fatal = false;
  for (const source of input.comments) {
    const fields = poolFields(input, source.fields, deps);
    const rawid = fields.原始评论ID;
    const hit = deps.seen.get(rawid);
    let id;
    let duplicate = false;
    try {
      if (hit) {
        if (hit.conflict || !hit.fields || !sameRawComment(hit.fields, fields)) {
          throw Object.assign(new Error('旧原始评论ID发生冲突'), { failure_class: 'fatal', reason_code: 'rawid_conflict' });
        }
        id = hit.id;
        if (typeof id !== 'string' || !id.trim()) throw new Error('历史落池记录没有持久化ID');
        duplicate = true;
      } else {
        const result = await deps.postPool(fields);
        id = result && result.data && result.data.record && result.data.record.record_id;
        if (!result || result.code !== 0 || typeof id !== 'string' || !id.trim()) {
          throw new Error('原始评论落池未确认');
        }
        deps.seen.set(rawid, { id, fields: structuredClone(fields) });
        metrics.comments_written++;
      }
      if (duplicate) metrics.duplicates++;
      if (!outputRows.has(id)) {
        const row = { ...structuredClone(source), source_id: source.source_id || source.id,
          id, fields, persist_status: 'completed' };
        comments.push(row);
        outputRows.set(id, row);
      } else if (outputRows.get(id).verdict === undefined && source.verdict !== undefined) {
        // 同内容只结算一次，但不能因未评分源先出现而丢掉后续评分。
        const row = outputRows.get(id);
        row.verdict = structuredClone(source.verdict);
        if (source.score_status !== undefined) row.score_status = source.score_status;
        else delete row.score_status;
      }
      evidence.push({ source_id: source.source_id || source.id, comment_id: id, rawid,
        status: 'completed', duplicate });
    } catch (error) {
      const permanent = error && error.failure_class === 'fatal';
      fatal ||= permanent;
      metrics.pending++;
      pending_comments.push({ ...structuredClone(source), source_id: source.source_id || source.id,
        persist_status: 'pending' });
      evidence.push({ source_id: source.source_id || source.id, rawid, status: 'pending',
        failure_class: permanent ? 'fatal' : 'retryable',
        ...(permanent ? { reason_code: 'rawid_conflict' } : {}) });
    }
  }
  return {
    schema_version: 1, run_tag: input.run_tag, line_key: route.key,
    status: metrics.pending ? (metrics.pending === input.comments.length ? 'failed' : 'partial') : 'completed',
    failure_class: metrics.pending ? (fatal ? 'fatal' : 'retryable') : null,
    outputs: { comments, pending_comments }, metrics, evidence,
  };
}

// 旧手机采收入口的纯转换边界；行号作源ID，旧rawid去重仍由落池活动负责。
function harvestTsvInput(tsv, { run_tag = 'manual', line_key } = {}) {
  const comments = String(tsv).split('\n').flatMap((line, index) => {
    if (!line.startsWith('LEAD\t')) return [];
    const [, nick = '', dyid = '', atype = '', comment = '', cdate = '', region = '',
      video = '', kw = '', pip = '', purl = '', vurl = ''] = line.replace(/\r$/, '').split('\t');
    return [{ id: `harvest:${index + 1}`, fields: {
      评论者昵称: nick, 抖音号: dyid, 账号类型: atype, 评论原文: comment,
      留言时间: cdate, 地区: region, 来源视频: video, 命中关键词: kw, 主页IP: pip,
      主页链接: purl, 评论作品视频链接: vurl,
      用户主页标识: [dyid, purl, atype].filter(Boolean).join(' | '),
    } }];
  });
  return { run_tag, line_key, comments };
}

module.exports = { persistRawComments, harvestTsvInput, rawCommentId, sameRawComment, RAW_COMMENT_FIELDS };
