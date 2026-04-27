#!/usr/bin/env node
/**
 * 抖音对标账号筛选 SOP
 *
 * 用法:
 *   node douyin-publisher/sop-account-search.js [--topic "一人公司"] [--round-limit 20]
 *
 * 前提：Chrome 已以调试模式启动且已登录抖音
 *   open -a "Google Chrome" --args --remote-debugging-port=19222
 *
 * 输出：~/.platform-data/douyin-competitor/accounts-{topic}-{timestamp}.json
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

// 账号二筛条件
const SECONDARY_FILTER = {
  followersMin: 5000,
  followersMax: 20000,
  minRecentVideos: 15, // 近30天估算
};

// ─── 纯函数 ────────────────────────────────────────────────────

/**
 * 解析视频搜索结果中的 author 字段，转为账号记录
 * @param {object} aweme 单条视频
 * @param {number} round 轮次
 * @param {string} keyword 关键词
 * @returns {object}
 */
function parseAuthorFromAweme(aweme, round, keyword) {
  const author = aweme.author || {};
  const uid = author.uid || author.sec_uid || '';
  const uniqueId = author.unique_id || author.short_id || '';
  const profileUrl = uid
    ? `https://www.douyin.com/user/${uid}`
    : '';

  // 取两条代表视频（当前视频 + 无法提前知道第二条，先填 share_url）
  const videoUrl1 = aweme.share_url
    || (aweme.aweme_id ? `https://www.douyin.com/video/${aweme.aweme_id}` : '');

  return {
    round,
    keyword,
    creatorName: author.nickname || '',
    douyinId: uniqueId,
    profileUrl,
    bio: author.signature || '',
    followers: author.follower_count ?? 0,
    following: author.following_count ?? 0,
    workCount: author.aweme_count ?? 0,
    videoUrl1,
    videoUrl2: '', // 后续如有第二条同一作者视频可补填
    _uid: uid,
  };
}

/**
 * 格式化粉丝数
 */
function formatFollowers(n) {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return String(n);
}

/**
 * 二筛：根据 topic 和筛选条件过滤账号
 * @param {object[]} accounts 初筛账号列表
 * @param {string} topic 目标主题
 * @returns {object[]}
 */
function applySecondaryFilter(accounts, topic) {
  return accounts.filter(acc => {
    // 粉丝数范围（优先，非硬性）
    const inFollowerRange =
      acc.followers >= SECONDARY_FILTER.followersMin &&
      acc.followers <= SECONDARY_FILTER.followersMax;

    // 作品数估算近30天更新 >= 15（workCount 作为估算依据）
    const hasRecentActivity = acc.workCount >= SECONDARY_FILTER.minRecentVideos;

    // 定位匹配：bio 或 creatorName 包含 topic 相关词
    const topicWords = topic.split(/[\s\/，,]+/);
    const bioText = `${acc.bio} ${acc.creatorName}`.toLowerCase();
    const matchesTopic = topicWords.some(w => w && bioText.includes(w.toLowerCase()));

    // 有变现/承接链路关键词
    const monetizationKeywords = [
      '私域', '训练营', '陪跑', '咨询', '产品', '课程', '变现', '服务',
      '合作', '加微', '联系', '预约', '报名', '招募', '入群', '社群',
    ];
    const hasMonetization = monetizationKeywords.some(w => acc.bio.includes(w));

    return inFollowerRange && hasRecentActivity && (matchesTopic || hasMonetization);
  });
}

/**
 * 打印账号表格到终端
 */
function printAccountTable(accounts, title) {
  console.log(`\n${'─'.repeat(70)}`);
  console.log(`  ${title}（共 ${accounts.length} 个）`);
  console.log('─'.repeat(70));
  accounts.forEach((acc, i) => {
    console.log(
      `${String(i + 1).padStart(3)}. [R${acc.round}] ${acc.keyword} → ${acc.creatorName}`
    );
    console.log(
      `     粉丝: ${formatFollowers(acc.followers)}  作品: ${acc.workCount}  抖音号: ${acc.douyinId || '未知'}`
    );
    if (acc.bio) console.log(`     简介: ${acc.bio.slice(0, 60)}`);
    console.log(`     主页: ${acc.profileUrl}`);
    if (acc.videoUrl1) console.log(`     代表视频: ${acc.videoUrl1}`);
    console.log();
  });
  console.log('─'.repeat(70));
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
      return data.status_code === 0;
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
 * 通过视频搜索 API 采集作者信息
 * type=0 综合搜索（视频）
 */
async function fetchAuthorsFromVideoSearch(page, keyword, limit) {
  const authors = [];
  const seenUids = new Set();
  let cursor = 0;
  let pageNum = 0;

  while (authors.length < limit) {
    pageNum++;
    const params = new URLSearchParams({
      keyword,
      type: '0',
      count: '10',
      cursor: String(cursor),
      aid: '6383',
      channel: 'channel_pc_web',
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
      break;
    }

    // 按点赞数排序（靠前的已是最多点赞，API 本身已排序，再做一次本地排序保险）
    const sorted = [...awemeList].sort(
      (a, b) =>
        (b.statistics?.digg_count ?? 0) - (a.statistics?.digg_count ?? 0)
    );

    for (const aweme of sorted) {
      const uid = aweme.author?.uid || aweme.author?.sec_uid || '';
      if (uid && !seenUids.has(uid)) {
        seenUids.add(uid);
        authors.push(aweme);
      }
    }

    console.log(
      `    第 ${pageNum} 页：已采集 ${authors.length} / ${limit} 个独立作者`
    );

    if (!data.has_more || authors.length >= limit) break;
    cursor = data.cursor ?? 0;
    await sleep(900);
  }

  return authors.slice(0, limit);
}

// ─── 主流程 ────────────────────────────────────────────────────

async function main() {
  // ── 参数解析 ──
  const args = process.argv.slice(2);
  const topicIdx = args.indexOf('--topic');
  const topic = topicIdx >= 0 ? args[topicIdx + 1] : '一人公司';
  const limitIdx = args.indexOf('--round-limit');
  const roundLimit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 20;

  console.log('\n== 抖音对标账号筛选 SOP ==');
  console.log(`   Topic    : ${topic}`);
  console.log(`   每轮上限 : ${roundLimit} 个作者`);
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
    /* 忽略超时，继续检测登录 */
  }
  await sleep(1500);

  if (!(await checkLogin(page))) {
    await waitForLogin(page);
  } else {
    console.log('[OK] 抖音已登录\n');
  }

  // ── 逐轮采集（初筛） ──
  const primaryScreening = [];
  const seenProfileUrls = new Set();

  for (const roundConfig of KEYWORD_ROUNDS) {
    console.log(
      `\n[Round ${roundConfig.round}] ${roundConfig.label}（${roundConfig.keywords.length} 个关键词）`
    );

    for (const keyword of roundConfig.keywords) {
      console.log(`  搜索: 「${keyword}」`);
      try {
        const awemeList = await fetchAuthorsFromVideoSearch(page, keyword, roundLimit);

        for (const aweme of awemeList) {
          const acc = parseAuthorFromAweme(aweme, roundConfig.round, keyword);
          if (acc.profileUrl && !seenProfileUrls.has(acc.profileUrl)) {
            seenProfileUrls.add(acc.profileUrl);
            primaryScreening.push(acc);
          }
        }
      } catch (e) {
        console.error(`  [WARN] 关键词「${keyword}」采集失败：${e.message}`);
      }

      await sleep(1200);
    }
  }

  console.log(`\n[初筛] 共采集到 ${primaryScreening.length} 个去重账号`);
  printAccountTable(primaryScreening.slice(0, 10), '初筛前10（预览）');

  // ── 二筛 ──
  const secondaryScreening = applySecondaryFilter(primaryScreening, topic);
  console.log(`\n[二筛] 通过筛选条件：${secondaryScreening.length} 个账号`);
  printAccountTable(secondaryScreening, '二筛结果');

  // ── 最终池（5-10个）──
  const finalPool = secondaryScreening.slice(0, 10);
  console.log(`\n[最终] 收录 ${finalPool.length} 个对标账号`);
  printAccountTable(finalPool, '最终对标账号池');

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
    primaryCount: primaryScreening.length,
    secondaryCount: secondaryScreening.length,
    finalCount: finalPool.length,
    secondaryFilterCriteria: {
      followersRange: `${SECONDARY_FILTER.followersMin}-${SECONDARY_FILTER.followersMax}`,
      minRecentVideos: SECONDARY_FILTER.minRecentVideos,
      topicMatchNote: `定位匹配 topic="${topic}"`,
      monetizationCheck: '包含变现/承接链路关键词',
    },
  };

  // ── 写入 JSON ──
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const timestamp = Date.now();
  const safeTopic = topic.replace(/[^\w一-鿿]/g, '_');
  const outFile = path.join(OUT_DIR, `accounts-${safeTopic}-${timestamp}.json`);

  const output = {
    primaryScreening,
    secondaryScreening,
    finalPool,
    report,
  };

  fs.writeFileSync(outFile, JSON.stringify(output, null, 2), 'utf8');
  console.log(`\n[保存] 结果已写入：${outFile}`);
  console.log('\n== 账号筛选完成 ==\n');
}

if (require.main === module) {
  main().catch(e => {
    console.error('\n[ERR] 脚本异常：', e.message);
    process.exit(1);
  });
}
