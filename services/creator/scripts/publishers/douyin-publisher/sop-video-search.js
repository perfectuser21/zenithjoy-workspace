#!/usr/bin/env node
/**
 * 抖音对标视频筛选 SOP
 *
 * 用法:
 *   node douyin-publisher/sop-video-search.js [--topic "一人公司"] [--round-limit 30]
 *
 * 前提：Chrome 已以调试模式启动且已登录抖音
 *   open -a "Google Chrome" --args --remote-debugging-port=19222
 *
 * 输出：~/.platform-data/douyin-competitor/videos-{topic}-{timestamp}.json
 */
'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { KEYWORD_ROUNDS } = require('./sop-keywords');

// ─── 常量 ──────────────────────────────────────────────────────
const CDP_HOST = process.env.DOUYIN_CDP_HOST || 'http://localhost:19222';
const OUT_DIR = path.join(os.homedir(), '.platform-data', 'douyin-competitor');

// 二筛评分维度（每项 0-2 分）
const SCORING_DIMENSIONS = [
  'audienceMatch',    // 目标人群匹配
  'replicability',   // 可复刻性（结构清晰）
  'monetizationFit', // 承接明确
  'aiAlignment',     // 与智能体能力契合
];

// ─── 纯函数 ────────────────────────────────────────────────────

/**
 * 推断内容形式
 * 基于 aweme 元数据做简单分类（无法做到完全准确，人工可后续修正）
 */
function inferContentType(aweme) {
  const desc = (aweme.desc || '').toLowerCase();
  const images = aweme.image_post_info?.images?.length ?? 0;

  if (images > 0) return '图文';
  if (desc.includes('对话') || desc.includes('采访')) return '对话';
  if (desc.includes('字幕') || desc.includes('配音')) return '字幕';
  if (desc.includes('混剪') || desc.includes('剪辑')) return '混剪';
  // 无法确定时默认口播
  return '口播';
}

/**
 * 解析单条 aweme 为视频记录
 */
function parseVideo(aweme, round, keyword) {
  const author = aweme.author || {};
  const stats = aweme.statistics || {};
  const uid = author.uid || author.sec_uid || '';

  const videoUrl = aweme.share_url
    || (aweme.aweme_id ? `https://www.douyin.com/video/${aweme.aweme_id}` : '');
  const profileUrl = uid ? `https://www.douyin.com/user/${uid}` : '';

  // 发布时间：Unix 秒 → ISO
  const publishTime = aweme.create_time
    ? new Date(aweme.create_time * 1000).toISOString()
    : '';

  // 时长：毫秒 → 秒
  const durationMs = aweme.video?.duration ?? aweme.duration ?? 0;
  const durationSec = Math.round(durationMs / 1000);

  return {
    round,
    keyword,
    creatorName: author.nickname || '',
    profileUrl,
    videoTitle: aweme.desc || '',
    videoUrl,
    publishTime,
    duration: durationSec,
    contentType: inferContentType(aweme),
    diggCount: stats.digg_count ?? 0,
    commentCount: stats.comment_count ?? 0,
    collectCount: stats.collect_count ?? 0,
    shareCount: stats.share_count ?? 0,
    notes: '', // 爆点/结构/金句/转化钩子，人工或后续 AI 补填
    _awemeId: aweme.aweme_id || '',
    _uid: uid,
  };
}

/**
 * 视频去重
 * 优先按 videoUrl，缺失时用 creatorName+videoTitle+publishTime 组合
 */
function deduplicateVideos(videos) {
  const seen = new Set();
  return videos.filter(v => {
    const key = v.videoUrl
      || `${v.creatorName}::${v.videoTitle}::${v.publishTime}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 对单条视频打二筛分数（0-8分，每维度 0-2）
 * @param {object} video
 * @param {string} topic
 * @returns {{ scores: object, total: number }}
 */
function scoreVideo(video, topic) {
  const text = `${video.videoTitle} ${video.creatorName}`.toLowerCase();
  const topicWords = topic.split(/[\s\/，,]+/).filter(Boolean);

  // 1. 目标人群匹配
  const audienceMatch = topicWords.some(w => text.includes(w.toLowerCase()))
    ? 2
    : text.includes('创业') || text.includes('个人') ? 1 : 0;

  // 2. 可复刻性（结构关键词：钩子/痛点/方案/案例/行动号召）
  const structureWords = [
    '钩子', '痛点', '方案', '案例', '行动', '步骤', '方法', '技巧', '教程',
    '手把手', '保姆级', '分享', '复盘', '拆解', '原来', '原理',
  ];
  const structureHits = structureWords.filter(w => text.includes(w)).length;
  const replicability = structureHits >= 3 ? 2 : structureHits >= 1 ? 1 : 0;

  // 3. 承接明确（私域/咨询/训练营等）
  const monetizeWords = [
    '私域', '训练营', '陪跑', '咨询', '课程', '变现', '加微', '合作',
    '预约', '报名', '招募', '社群', '入群', '资料', '领取', '免费',
  ];
  const monetizeHits = monetizeWords.filter(w => text.includes(w)).length;
  const monetizationFit = monetizeHits >= 2 ? 2 : monetizeHits >= 1 ? 1 : 0;

  // 4. 与智能体能力契合
  const aiWords = [
    'AI', '智能体', '自动化', '文案', '脚本', '选题', '内容分发', '配图',
    '运营', '助理', '机器人', '工具', '效率', 'ChatGPT', '大模型',
  ];
  const aiHits = aiWords.filter(w => text.includes(w)).length;
  const aiAlignment = aiHits >= 2 ? 2 : aiHits >= 1 ? 1 : 0;

  const scores = { audienceMatch, replicability, monetizationFit, aiAlignment };
  const total = Object.values(scores).reduce((s, v) => s + v, 0);
  return { scores, total };
}

/**
 * 二筛并打分，返回含评分的视频列表（降序）
 */
function applySecondaryFilter(videos, topic) {
  return videos
    .map(v => {
      const { scores, total } = scoreVideo(v, topic);
      const replicablePoints = buildReplicablePoints(v, scores);
      const fitReason = buildFitReason(v, scores, topic);
      return { ...v, scores, totalScore: total, replicablePoints, fitReason };
    })
    .filter(v => v.totalScore >= 3) // 总分 >= 3（满分8）才进入二筛
    .sort((a, b) => b.totalScore - a.totalScore);
}

/**
 * 自动生成可复刻要点（基于现有字段，人工可后续补充）
 */
function buildReplicablePoints(video, scores) {
  const points = [];
  if (scores.replicability === 2) points.push('结构清晰（钩子→痛点→方案→案例→行动号召）');
  else if (scores.replicability === 1) points.push('有部分结构要素');
  if (scores.monetizationFit >= 1) points.push('含承接/转化钩子');
  if (scores.aiAlignment >= 1) points.push('AI/智能体相关内容');
  if (video.contentType === '口播') points.push('口播形式，易复制');
  return points.join('；') || '待人工补充';
}

/**
 * 自动生成入选理由
 */
function buildFitReason(video, scores, topic) {
  const reasons = [];
  if (scores.audienceMatch === 2) reasons.push(`精准匹配 topic="${topic}"`);
  else if (scores.audienceMatch === 1) reasons.push(`部分匹配 topic="${topic}"`);
  if (scores.aiAlignment >= 1) reasons.push('与智能体/AI能力契合');
  if (scores.monetizationFit >= 1) reasons.push('有清晰承接路径');
  return reasons.join('，') || '综合评分达标';
}

/**
 * 打印视频表格
 */
function printVideoTable(videos, title) {
  console.log(`\n${'─'.repeat(80)}`);
  console.log(`  ${title}（共 ${videos.length} 条）`);
  console.log('─'.repeat(80));
  videos.forEach((v, i) => {
    const score = v.totalScore !== undefined ? `  [得分:${v.totalScore}/8]` : '';
    console.log(
      `${String(i + 1).padStart(3)}. [R${v.round}]「${v.keyword}」${score}`
    );
    console.log(`     标题: ${v.videoTitle.slice(0, 60)}`);
    console.log(
      `     作者: ${v.creatorName}  |  形式: ${v.contentType}  |  时长: ${v.duration}s`
    );
    console.log(
      `     点赞: ${v.diggCount}  评论: ${v.commentCount}  发布: ${v.publishTime.slice(0, 10)}`
    );
    console.log(`     视频: ${v.videoUrl}`);
    if (v.replicablePoints) console.log(`     可复刻: ${v.replicablePoints}`);
    if (v.fitReason) console.log(`     入选理由: ${v.fitReason}`);
    console.log();
  });
  console.log('─'.repeat(80));
}

// ─── I/O 函数 ──────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function checkLogin(page) {
  return page.evaluate(async () => {
    try {
      const resp = await fetch('https://www.douyin.com/passport/account/info/v2/', {
        credentials: 'include',
      });
      const data = await resp.json();
      if (data.status_code === 0) return true;
      if (data.data && (data.data.avatar_url || data.data.app_id)) return true;
      return false;
    } catch {
      return false;
    }
  });
}

async function waitForLogin(page) {
  console.log('\n[!] 未检测到登录，请在浏览器中完成抖音登录（扫码/手机号均可）...\n');
  await page.goto('https://www.douyin.com', { waitUntil: 'domcontentloaded', timeout: 15000 });
  for (let i = 0; i < 36; i++) {
    await sleep(5000);
    if (await checkLogin(page)) {
      console.log('[OK] 登录成功！\n');
      return;
    }
  }
  throw new Error('登录超时（3 分钟），请重新运行脚本');
}

/**
 * 抓取单个关键词的视频列表（按最多点赞，type=0 综合）
 */
async function fetchVideos(page, keyword, limit) {
  const videos = [];
  let cursor = 0;
  let pageNum = 0;

  while (videos.length < limit) {
    pageNum++;
    const params = new URLSearchParams({
      keyword,
      type: '0',
      count: '10',
      cursor: String(cursor),
      aid: '6383',
      channel: 'channel_pc_web',
      sort_type: '1', // 1=最多点赞
      publish_time: '1', // 一周内（7天）
    });
    const url = `https://www.douyin.com/aweme/v1/web/discover/search/?${params}`;

    const raw = await page.evaluate(async (fetchUrl) => {
      const resp = await fetch(fetchUrl, { credentials: 'include' });
      return resp.text();
    }, url);

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      console.log(`    第 ${pageNum} 页：响应解析失败，停止翻页`);
      break;
    }

    if (data.status_code !== 0) {
      throw new Error(
        `抖音 API 错误 status_code=${data.status_code}，message=${data.message || '未知'}`
      );
    }

    const awemeList = data.aweme_list || data.aweme_infos || [];
    if (!awemeList.length) {
      console.log(`    第 ${pageNum} 页：无更多结果`);
      // 若结果不足且仍在第一页，提示已宽松为10天（仅放宽一次，由调用者决策）
      if (pageNum === 1) {
        console.log('    [提示] 结果较少，可尝试 publish_time=2（10天内）');
      }
      break;
    }

    // 本地按点赞数降序排序（API 一般已排序，此处二次保险）
    const sorted = [...awemeList].sort(
      (a, b) =>
        (b.statistics?.digg_count ?? 0) - (a.statistics?.digg_count ?? 0)
    );

    for (const aweme of sorted) {
      videos.push(aweme);
    }

    console.log(`    第 ${pageNum} 页：已采集 ${videos.length} / ${limit} 条视频`);

    if (!data.has_more || videos.length >= limit) break;
    cursor = data.cursor ?? 0;
    await sleep(900);
  }

  return videos.slice(0, limit);
}

// ─── 主流程 ────────────────────────────────────────────────────

async function main() {
  // ── 参数解析 ──
  const args = process.argv.slice(2);
  const topicIdx = args.indexOf('--topic');
  const topic = topicIdx >= 0 ? args[topicIdx + 1] : '一人公司';
  const limitIdx = args.indexOf('--round-limit');
  const roundLimit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 30;

  console.log('\n== 抖音对标视频筛选 SOP ==');
  console.log(`   Topic    : ${topic}`);
  console.log(`   每轮上限 : ${roundLimit} 条视频`);
  console.log(`   关键词轮次: ${KEYWORD_ROUNDS.length} 轮`);
  console.log(`   CDP      : ${CDP_HOST}\n`);

  // ── 连接浏览器 ──
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_HOST);
  } catch {
    console.error(`\n[ERR] 无法连接到 Chrome（${CDP_HOST}）`);
    console.error('  请先启动 Chrome 调试模式：');
    console.error('  open -a "Google Chrome" --args --remote-debugging-port=19222\n');
    process.exit(1);
  }

  const contexts = browser.contexts();
  const context = contexts[0] || (await browser.newContext());
  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();

  console.log('[OK] 已连接到浏览器');

  try {
    await page.goto('https://www.douyin.com', {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
  } catch {
    /* 忽略超时 */
  }
  await sleep(1500);

  if (!(await checkLogin(page))) {
    await waitForLogin(page);
  } else {
    console.log('[OK] 抖音已登录\n');
  }

  // ── 逐轮采集（初筛） ──
  const rawVideos = [];

  for (const roundConfig of KEYWORD_ROUNDS) {
    console.log(
      `\n[Round ${roundConfig.round}] ${roundConfig.label}（${roundConfig.keywords.length} 个关键词）`
    );

    for (const keyword of roundConfig.keywords) {
      console.log(`  搜索: 「${keyword}」`);
      try {
        const awemeList = await fetchVideos(page, keyword, roundLimit);
        for (const aweme of awemeList) {
          rawVideos.push(parseVideo(aweme, roundConfig.round, keyword));
        }
      } catch (e) {
        console.error(`  [WARN] 关键词「${keyword}」采集失败：${e.message}`);
      }
      await sleep(1200);
    }
  }

  // ── 去重 ──
  const dedupPool = deduplicateVideos(rawVideos);
  console.log(
    `\n[初筛] 共采集 ${rawVideos.length} 条原始视频，去重后 ${dedupPool.length} 条`
  );
  printVideoTable(dedupPool.slice(0, 5), '初筛前5预览');

  // ── 二筛评分 ──
  const primaryScreening = dedupPool; // 保存完整初筛用于输出
  const secondaryPool = applySecondaryFilter(dedupPool, topic);
  console.log(`\n[二筛] 评分 >= 3/8 的视频：${secondaryPool.length} 条`);

  // ── 最终池（10-15条）──
  const finalPool = secondaryPool.slice(0, 15);
  console.log(`\n[最终] 收录 ${finalPool.length} 条对标视频`);
  printVideoTable(finalPool, '最终对标视频池');

  // ── 执行报告 ──
  const report = {
    topic,
    executedAt: new Date().toISOString(),
    roundLimit,
    rounds: KEYWORD_ROUNDS.map(r => ({
      round: r.round,
      label: r.label,
      keywordsCount: r.keywords.length,
    })),
    rawCount: rawVideos.length,
    dedupCount: dedupPool.length,
    secondaryCount: secondaryPool.length,
    finalCount: finalPool.length,
    scoringDimensions: SCORING_DIMENSIONS,
    secondaryFilterNote: '总分 >= 3/8 进入二筛，最终取前15条',
    deduplicationNote: '按 videoUrl 优先，缺失用 creatorName+videoTitle+publishTime 组合',
  };

  // ── 写入 JSON ──
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const timestamp = Date.now();
  const safeTopic = topic.replace(/[^\w一-鿿]/g, '_');
  const outFile = path.join(OUT_DIR, `videos-${safeTopic}-${timestamp}.json`);

  const output = {
    primaryScreening,
    dedupPool,
    finalPool,
    report,
  };

  fs.writeFileSync(outFile, JSON.stringify(output, null, 2), 'utf8');
  console.log(`\n[保存] 结果已写入：${outFile}`);
  console.log('\n== 视频筛选完成 ==\n');
}

if (require.main === module) {
  main().catch(e => {
    console.error('\n[ERR] 脚本异常：', e.message);
    process.exit(1);
  });
}
