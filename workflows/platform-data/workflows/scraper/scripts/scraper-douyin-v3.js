#!/usr/bin/env node
/**
 * 抖音采集器 V6
 * 1. 采集作品列表
 * 2. 尝试获取每篇作品近 30 天分日数据
 * 3. 写入 douyin.post_daily_stats
 */
const CDP = require('chrome-remote-interface');
const { Client } = require('pg');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

function ingestToUS(platform, items) {
  return new Promise((resolve) => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const mapped = items.map(item => ({
        content_id: item.content_id || '',
        scraped_date: today,
        title: item.title || '',
        views: item.views || 0,
        likes: item.likes || 0,
        comments: item.comments || 0,
        shares: item.shares || 0,
        extra_data: item.extra_data || {}
      })).filter(i => i.content_id);
      if (!mapped.length) return resolve({ skipped: true });
      const body = JSON.stringify({ platform, items: mapped });
      const req = http.request({
        hostname: '100.71.151.105', port: 5200, path: '/api/snapshots/ingest',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      }, res => {
        let d = ''; res.on('data', c => d += c);
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ raw: d }); } });
      });
      req.on('error', e => resolve({ error: e.message }));
      req.write(body); req.end();
    } catch (e) { resolve({ error: e.message }); }
  });
}
const {
  sleep,
  rangeLastNDays,
  ensurePostDailyStatsTable,
  upsertDailyStats,
  collectDailyArrays,
  normalizeDailyItem,
  writeJsonFile,
} = require('./daily-stats-helpers');

const NODE_PC_HOST = '100.97.242.124';
const PORT = 19222;
const DATA_DIR = path.join(os.homedir(), '.platform-data');
const TEST_ONE = process.env.TEST_ONE === '1';
const MAX_ITEMS = Number(process.env.MAX_ITEMS || 0);

const dbClient = new Client({
  host: 'localhost',
  port: 5432,
  user: 'cecelia',
  password: 'CeceliaUS2026',
  database: 'social_media_raw',
});

function formatPublishTimeFromUnix(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}年${String(d.getMonth() + 1).padStart(2, '0')}月${String(d.getDate()).padStart(2, '0')}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

async function fetchJsonViaPage(Runtime, url, options = {}) {
  const expression = `
    (async function() {
      try {
        const resp = await fetch(${JSON.stringify(url)}, ${JSON.stringify({
          credentials: 'include',
          ...options,
        })});
        const text = await resp.text();
        return JSON.stringify({
          ok: resp.ok,
          status: resp.status,
          url: resp.url,
          body: text,
        });
      } catch (error) {
        return JSON.stringify({ error: error.message });
      }
    })()
  `;
  const { result } = await Runtime.evaluate({ expression, awaitPromise: true });
  return JSON.parse(result.value);
}

async function fetchWorkList(Runtime) {
  const allItems = [];
  const seen = new Set();
  let pageNum = 0;
  let cursor = 0;

  while (pageNum < 20) {
    pageNum += 1;
    const url = `https://creator.douyin.com/janus/douyin/creator/pc/work_list?page_size=20&page_number=${pageNum}&work_status=all&max_cursor=${cursor}`;
    const response = await fetchJsonViaPage(Runtime, url, {
      headers: { Accept: 'application/json' },
    });

    if (response.error) throw new Error(`work_list 调用失败: ${response.error}`);

    const payload = JSON.parse(response.body);
    const items = payload.aweme_list || payload.item_list || payload.data?.aweme_list || payload.data?.item_list || [];
    if (!items.length) break;

    for (const item of items) {
      const title = item.desc || item.caption || item.title || item.share_info?.share_title || '';
      const awemeId = item.aweme_id || item.item_id || item.statistics?.aweme_id;
      if (!title || !awemeId) continue;

      const key = `${awemeId}`;
      if (seen.has(key)) continue;
      seen.add(key);

      allItems.push({
        aweme_id: String(awemeId),
        item_id: String(item.item_id || awemeId),
        title: title.substring(0, 200),
        publishTime: formatPublishTimeFromUnix(item.create_time),
        stats: item.statistics || {},
        raw: item,
      });
    }

    const hasMore = payload.has_more || items.length >= 20;
    cursor = payload.max_cursor || payload.cursor || cursor + items.length;
    if (!hasMore) break;
    await sleep(800);
  }

  return allItems;
}

function buildDailyCandidates(item, windowRange) {
  const base = {
    start_date: windowRange.startDateCompact,
    end_date: windowRange.endDateCompact,
  };
  const itemId = item.aweme_id;
  return [
    {
      name: 'item_performance_by_item_id',
      url: 'https://creator.douyin.com/janus/douyin/creator/data/item_analysis/item_performance',
      body: { ...base, item_id: itemId, metric_type: 1 },
    },
    {
      name: 'item_trend_item_id',
      url: 'https://creator.douyin.com/janus/douyin/creator/data/item_analysis/item_trend',
      body: { ...base, item_id: itemId },
    },
    {
      name: 'item_trend_aweme_ids',
      url: 'https://creator.douyin.com/janus/douyin/creator/data/item_analysis/item_trend',
      body: { ...base, aweme_ids: [itemId] },
    },
    {
      name: 'item_data_trend_item_id',
      url: 'https://creator.douyin.com/janus/douyin/creator/data/item_analysis/item_data_trend',
      body: { ...base, item_id: itemId },
    },
    {
      name: 'item_daily_item_id',
      url: 'https://creator.douyin.com/janus/douyin/creator/data/item_analysis/item_daily',
      body: { ...base, item_id: itemId },
    },
    {
      name: 'item_detail_item_id',
      url: 'https://creator.douyin.com/janus/douyin/creator/data/item_analysis/item_detail',
      body: { ...base, item_id: itemId },
    },
    {
      name: 'item_overview_item_id',
      url: 'https://creator.douyin.com/janus/douyin/creator/data/item_analysis/item_overview',
      body: { ...base, item_id: itemId },
    },
  ];
}

function parseDailyStatsResponse(payload) {
  const matches = collectDailyArrays(payload);
  for (const match of matches) {
    const normalized = match.items
      .map((entry) => normalizeDailyItem(entry))
      .filter(Boolean);
    if (normalized.length) {
      return {
        sourcePath: match.path,
        dailyItems: normalized,
      };
    }
  }
  return null;
}

async function fetchDailyStatsForItem(Runtime, item, windowRange) {
  const attempts = [];

  for (const candidate of buildDailyCandidates(item, windowRange)) {
    const response = await fetchJsonViaPage(Runtime, candidate.url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(candidate.body),
    });

    if (response.error) {
      attempts.push({ candidate: candidate.name, error: response.error });
      continue;
    }

    let payload;
    try {
      payload = JSON.parse(response.body);
    } catch (error) {
      attempts.push({ candidate: candidate.name, status: response.status, error: '响应不是 JSON' });
      continue;
    }

    const parsed = parseDailyStatsResponse(payload);
    attempts.push({
      candidate: candidate.name,
      status: response.status,
      sourcePath: parsed?.sourcePath || null,
      discoveredRows: parsed?.dailyItems?.length || 0,
    });

    if (parsed?.dailyItems?.length) {
      return {
        ok: true,
        candidate: candidate.name,
        sourcePath: parsed.sourcePath,
        dailyItems: parsed.dailyItems,
        attempts,
      };
    }
  }

  return { ok: false, attempts };
}

async function main() {
  let client;

  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    await dbClient.connect();
    await ensurePostDailyStatsTable(dbClient, 'douyin');

    client = await CDP({ host: NODE_PC_HOST, port: PORT, timeout: 30000 });
    const { Runtime, Page } = client;
    await Runtime.enable();
    await Page.enable();

    console.error('[抖音] 导航到作品管理页面...');
    await Page.navigate({ url: 'https://creator.douyin.com/creator-micro/content/manage' });
    await sleep(5000);

    const items = await fetchWorkList(Runtime);
    const selectedItems = TEST_ONE
      ? items.slice(0, 1)
      : (MAX_ITEMS > 0 ? items.slice(0, MAX_ITEMS) : items);
    const windowRange = rangeLastNDays(30);
    const failures = [];
    const successes = [];
    let totalDays = 0;

    console.error(`[抖音] 作品列表获取完成，共 ${items.length} 篇，本次处理 ${selectedItems.length} 篇`);

    for (let i = 0; i < selectedItems.length; i += 1) {
      const item = selectedItems[i];
      console.error(`[抖音] [${i + 1}/${selectedItems.length}] 处理 ${item.aweme_id} ${item.title.slice(0, 40)}`);

      const dailyResult = await fetchDailyStatsForItem(Runtime, item, windowRange);
      if (!dailyResult.ok) {
        failures.push({
          post_id: item.aweme_id,
          title: item.title,
          attempts: dailyResult.attempts,
        });
        continue;
      }

      let savedDays = 0;
      for (const dailyItem of dailyResult.dailyItems) {
        await upsertDailyStats(dbClient, 'douyin', {
          post_id: item.aweme_id,
          title: item.title,
          stat_date: dailyItem.stat_date,
          views: dailyItem.views,
          likes: dailyItem.likes,
          comments: dailyItem.comments,
          shares: dailyItem.shares,
          extra_data: {
            source_candidate: dailyResult.candidate,
            source_path: dailyResult.sourcePath,
            aweme_id: item.aweme_id,
            item_id: item.item_id,
            raw_daily_item: dailyItem.extra_data,
          },
        });
        savedDays += 1;
      }

      totalDays += savedDays;
      successes.push({
        post_id: item.aweme_id,
        title: item.title,
        days: savedDays,
        candidate: dailyResult.candidate,
        source_path: dailyResult.sourcePath,
      });
      await sleep(600);
    }

    const outputFile = path.join(DATA_DIR, `douyin_daily_stats_${Date.now()}.json`);
    writeJsonFile(outputFile, {
      success: true,
      platform: 'douyin',
      scraped_at: new Date().toISOString(),
      total_items: items.length,
      processed_items: selectedItems.length,
      success_items: successes.length,
      total_days: totalDays,
      successes,
      failures,
    });

    const ingestItems = items.map(i => ({
      content_id: i.aweme_id || crypto.createHash('md5').update(i.title||'').digest('hex').substring(0,16),
      title: i.title || '',
      views: i.stats?.play_count || 0, likes: i.stats?.digg_count || 0,
      comments: i.stats?.comment_count || 0, shares: i.stats?.share_count || 0, extra_data: {}
    }));
    const ingestResult = await ingestToUS('douyin', ingestItems);
    console.error('[抖音] 已推送到美国 API: ' + JSON.stringify(ingestResult));
    console.log(JSON.stringify({
      success: true,
      platform: '抖音',
      processed_items: selectedItems.length,
      success_items: successes.length,
      total_days: totalDays,
      output_file: outputFile,
    }));
  } catch (error) {
    console.error('[抖音] 错误: ' + error.message);
    console.log(JSON.stringify({ success: false, platform: '抖音', error: error.message }));
    process.exitCode = 1;
  } finally {
    if (client) {
      try {
        await client.close();
      } catch (error) {
      }
    }
    try {
      await dbClient.end();
    } catch (error) {
    }
  }
}

main();
