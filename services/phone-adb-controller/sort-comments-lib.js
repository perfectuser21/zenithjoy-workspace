// sort-comments-lib.js —— 一条池记录判完之后「该怎么落账」的纯逻辑
//
// 从 sort-comments.js 抽出来，为的是能被测——顺序错没错，只有注入假飞书跑一遍才看得出来，
// grep 源码抓不住。同时这个文件必须能在任何目录 require 干净（不读配置、不发请求），
// 否则 CI 的 node --test 一 require 就炸（keyword-enabled-lib.js 已经栽过一次）。
//
// ## 为什么顺序这么要紧
//
// 0923 线上对账：池里 518 条标着「进入最终线索=true」，线索表里对得上的只有 372 条，
// 差 146 条（金诺 41、悦升 105）。原实现先把池推成「已分拣+true」再去写线索表，
// 写失败只打一行 LEAD_FAIL；而下一轮扫池的入口是 `处理状态 !== "待分拣" → 跳过`，
// 于是这条永远不会被再捞一次：池子账面说进了线索表，线索表里查无此人，
// 两本账对不上而且没有任何人会发现。
//
// 把其中 3 条孤儿原样复刻回写，三条全 code=0 成功；同日真跑一轮悦升分拣，
// 41 判定 / 29 搬入 / 0 异常——数据和判定链都没问题，是失败之后没法重试。
//
// 铁律：**池状态永远是最后一步**，只在线索真落地之后才推进。失败就让它留在
// 「待分拣」，下一轮自然重试——代价是重判一次（多一次模型调用），比起一条线索
// 永久消失便宜得多。

'use strict';

const { buildLeadCoreFields } = require('./lead-fields-lib.js');

const txt = (v) => (Array.isArray(v)
  ? v.map((x) => x.text || x.name || x).join('')
  : (v && v.text) || (v && v.name) || String(v == null ? '' : v));

/** 判定结果里要写回池的那几列（不含处理状态——它是最后一步） */
function verdictFields(verdict, keep, note) {
  return {
    业务相关性: verdict.relevance,
    意向等级: verdict.grade,
    AI判定理由: '[Jev] ' + (verdict.reason || '') + (note ? ' ' + note : ''),
    排除原因: keep ? '' : (verdict.reason || '判定不相关'),
  };
}

/** 飞书返回是否算成功（抛异常的情况在调用处 catch） */
const okRes = (res) => !!res && res.code === 0;

/**
 * 结算一条已判定的池记录。
 *
 * @param {{id:string, fields:object}} a.row       池记录
 * @param {{relevance:string, grade:string, reason:string}} a.verdict 判定结果
 * @param {{putPool:Function, postLead:Function, putLead:Function}} a.deps 三个写操作（注入，便于测真行为）
 * @param {object}   a.route      line-routes 的那一条；客户语义 intent/audience/tier 从这里取
 * @param {Map}      a.seen       去重表：昵称|抖音号 → {id, dup}
 * @param {string}   a.now        时间戳文本
 * @param {Function} a.asLeadTime 线索表时间列的类型自适应
 * @returns {{moved:number, duped:number, retryable:boolean, reason:string}}
 */
async function settlePending({ row, verdict, deps, route, seen, now, asLeadTime }) {
  const f = row.fields;
  const keep = verdict.relevance === '相关'; // 0914 理念：相关即留档（含 C 级），仅同行/广告排除

  // ── 判定不相关：终态，一次写完，不碰线索表 ──
  if (!keep) {
    await deps.putPool(row.id, { 处理状态: '已分拣', 进入最终线索: false, ...verdictFields(verdict, false) });
    return { moved: 0, duped: 0, retryable: false, reason: '判定不相关' };
  }

  const nick = txt(f['评论者昵称']);
  const [dyid, purl] = txt(f['用户主页标识']).split(' | ');
  const comment = txt(f['评论原文']);
  const videoCaption = txt(f['来源视频']);

  // 失败时把原因写回池，但**处理状态保持不动**，下一轮还扫得到它。
  // 不写的话，人看到的只是一条一直「待分拣」的记录，无从判断是卡住了还是没轮到。
  const parkForRetry = async (why) => {
    try {
      await deps.putPool(row.id, verdictFields(verdict, true, `⚠️搬运线索表失败(${why})，保持待分拣下轮重试`));
    } catch (_) { /* 连这一步都写不进去时别再抛，调用方按 retryable 计数就够了 */ }
    return { moved: 0, duped: 0, retryable: true, reason: why };
  };

  const hit = (dyid && seen.get(dyid.trim())) || seen.get(nick);

  // ── 重复客户 = 强意向信号：高亮已有行，不新建 ──
  if (hit) {
    const newDup = (hit.dup || 0) + 1;
    let res;
    try {
      res = await deps.putLead(hit.id, {
        重复命中次数: newDup,
        重复轨迹: `[再现${newDup}] 又在《${videoCaption.slice(0, 40)}》评论: ${comment.slice(0, 50)} (${verdict.grade}级判定)`,
      });
    } catch (e) {
      return parkForRetry(String((e && e.message) || e).slice(0, 80));
    }
    // 原实现这里连返回值都不看：hit.id 失效（上一轮建行时 record_id 没取到）就静默丢一条，
    // 而且 dup 也没加上，账面完全看不出来。
    if (!okRes(res)) return parkForRetry(`dup ${res && res.code} ${(res && res.msg) || ''}`.trim());

    hit.dup = newDup;
    await deps.putPool(row.id, { 处理状态: '已分拣', 进入最终线索: true, ...verdictFields(verdict, true) });
    return { moved: 0, duped: 1, retryable: false, reason: '重复高亮' };
  }

  // ── 新客户：先建线索行 ──
  //
  // 客户语义跟着 route 走。原实现写死的是金诺的值（"考证人群"/"证书/学习/求职"/"精准词"），
  // 于是悦升（企业 AI 部署）线索表里每一条都写着"考证人群"——主理人按人群筛选时看到的
  // 是另一家客户的标签。未配就留空：回落成某个具体值，等于把一家客户的标签盖到另一家头上。
  let res;
  try {
    res = await deps.postLead({
      '抖音获客-线索表': nick,
      ...buildLeadCoreFields({ nick, dyid, purl, comment, video: videoCaption, vurl: txt(f['评论作品视频链接']) }),
      IP属地: txt(f['地区']),
      留言时间: txt(f['留言时间']),
      业务线: route.line,
      关键词层级: route.tier || '',
      搜索意图: route.intent || '',
      目标人群: route.audience || '',
      AI判断理由: `[${verdict.grade}级] ` + (verdict.reason || ''),
      状态: '待触达',
      发送状态: '未发送',
      搜索账号: '池转入(自动判定)',
      采集时间: asLeadTime('采集时间', now),
      合规核验状态: '自动判定分级入表(' + now + ')｜评论区采集｜仅内部写入,未触达。',
    });
  } catch (e) {
    return parkForRetry(String((e && e.message) || e).slice(0, 80));
  }
  if (!okRes(res)) return parkForRetry(`${res && res.code} ${(res && res.msg) || ''}`.trim());

  // 0915 修真 bug：seen 是 Map，原代码误用 Set 的 add 抛 TypeError，每轮搬第一条后即断
  const leadId = res.data && res.data.record && res.data.record.record_id;
  seen.set(nick, { id: leadId, dup: 0 });
  if (dyid) seen.set(dyid.trim(), { id: leadId, dup: 0 });

  // ── 线索落地了，这才推进池状态 ──
  await deps.putPool(row.id, { 处理状态: '已分拣', 进入最终线索: true, ...verdictFields(verdict, true) });
  return { moved: 1, duped: 0, retryable: false, reason: '' };
}

module.exports = { settlePending, verdictFields, txt };
