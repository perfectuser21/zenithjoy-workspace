#!/usr/bin/env node
/**
 * 快手采集器 V3 - 视频管理页面采集
 * URL: https://cp.kuaishou.com/article/manage/video
 * API: /rest/cp/works/v2/video/pc/photo/list
 * 
 * 通过滚动触发 API 调用获取所有数据
 */
const CDP = require('chrome-remote-interface');
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const NODE_PC_HOST = '100.97.242.124';
const PORT = 19223;
const DATA_DIR = path.join(process.env.HOME, '.platform-data');

const dbClient = new Client({
  host: 'localhost',
  port: 5432,
  user: 'n8n_user',
  password: 'n8n_password_2025',
  database: 'social_media_raw'
});

// 解析数字（支持万、亿等单位）
function parseNumber(str) {
  if (!str) return 0;
  if (typeof str === 'number') return str;
  const s = String(str).replace(/,/g, '').trim();
  if (s.includes('亿')) return Math.floor(parseFloat(s) * 100000000);
  if (s.includes('万')) return Math.floor(parseFloat(s) * 10000);
  return parseInt(s.replace(/[^\d]/g, '')) || 0;
}

// 格式化时间为统一格式 YYYY年MM月DD日 HH:MM
function formatTime(input) {
  if (!input) return '';

  // 已经是目标格式
  if (/\d{4}年\d{2}月\d{2}日\s+\d{2}:\d{2}/.test(String(input))) {
    return String(input);
  }

  // 格式: 2026-01-17 23:24:52 或 2026-01-17 23:24
  const match1 = String(input).match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
  if (match1) {
    return `${match1[1]}年${match1[2]}月${match1[3]}日 ${match1[4]}:${match1[5]}`;
  }

  // Unix 时间戳（秒或毫秒）
  if (/^\d{10,13}$/.test(String(input))) {
    const ts = String(input).length === 13 ? parseInt(input) : parseInt(input) * 1000;
    const d = new Date(ts);
    return `${d.getFullYear()}年${String(d.getMonth() + 1).padStart(2, '0')}月${String(d.getDate()).padStart(2, '0')}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  return '';
}

// 解析发布时间为 ISO 格式（用于数据库）
function parseTimeToISO(publishTime) {
  if (!publishTime) return null;
  const match = publishTime.match(/(\d{4})年(\d{2})月(\d{2})日\s+(\d{2}):(\d{2})/);
  if (!match) return null;
  const [_, year, month, day, hour, min] = match;
  return new Date(`${year}-${month}-${day}T${hour}:${min}:00+08:00`).toISOString();
}

async function scrapeKuaishou() {
  let client;
  const allItems = [];
  const seen = new Set();

  try {
    await dbClient.connect();
    console.error('[快手] 数据库连接成功');

    client = await CDP({ host: NODE_PC_HOST, port: PORT, timeout: 30000 });
    const { Runtime, Page, Network } = client;
    await Runtime.enable();
    await Page.enable();
    await Network.enable();

    // 捕获所有 API 响应
    const allApiData = [];
    let totalFromApi = 0;
    
    Network.responseReceived(async (params) => {
      const url = params.response.url;
      if (url.includes('/rest/cp/works/v2/video/pc/photo/list')) {
        try {
          const { body } = await Network.getResponseBody({ requestId: params.requestId });
          const data = JSON.parse(body);
          if (data.data && data.data.list) {
            allApiData.push(data.data.list);
            if (data.data.total) totalFromApi = data.data.total;
            console.error(`[快手] API 数据 #${allApiData.length}: ${data.data.list.length} 条 (总计: ${allApiData.flat().length})`);
          }
        } catch (e) {}
      }
    });

    console.error('[快手] 导航到视频管理页面...');
    await Page.navigate({ url: 'https://cp.kuaishou.com/article/manage/video' });
    await new Promise(r => setTimeout(r, 8000));

    // 检查当前 URL
    const { result: urlResult } = await Runtime.evaluate({
      expression: 'window.location.href'
    });
    console.error('[快手] 当前 URL: ' + urlResult.value);

    // 等待初始 API 响应
    await new Promise(r => setTimeout(r, 3000));
    console.error('[快手] 初始 API 捕获: ' + allApiData.length);
    console.error('[快手] 页面总数: ' + totalFromApi);

    // 通过滚动触发更多 API 调用
    console.error('[快手] 开始滚动加载...');
    
    const maxScrolls = 50;
    let scrollPosition = 0;

    for (let i = 0; i < maxScrolls; i++) {
      // 检查是否已获取全部数据
      const currentItemCount = allApiData.flat().length;
      if (totalFromApi > 0 && currentItemCount >= totalFromApi) {
        console.error('[快手] 已获取全部数据 (' + currentItemCount + '/' + totalFromApi + ')');
        break;
      }

      // 滚动 main 容器
      scrollPosition += 600;
      await Runtime.evaluate({
        expression: `
          (function() {
            const main = document.querySelector('.el-main');
            if (main) {
              main.scrollTop = ${scrollPosition};
              main.dispatchEvent(new Event('scroll'));
            }
          })()
        `
      });

      // 每5次滚动等待更长时间
      if ((i + 1) % 5 === 0) {
        await new Promise(r => setTimeout(r, 2000));
        console.error(`[快手] 滚动 ${i + 1}: 当前 ${allApiData.flat().length}/${totalFromApi} 条`);
      } else {
        await new Promise(r => setTimeout(r, 800));
      }
    }

    // 最后等待所有响应完成
    await new Promise(r => setTimeout(r, 3000));

    console.error('[快手] 滚动完成，API 响应数: ' + allApiData.length);

    // 处理所有捕获的数据
    for (const list of allApiData) {
      processListItems(list, allItems, seen);
    }

    console.error('[快手] 去重后数据: ' + allItems.length + ' / ' + totalFromApi + ' 条');

    // 保存到数据库
    const today = new Date().toISOString().split('T')[0];
    let newCount = 0, snapshotCount = 0;

    for (const item of allItems) {
      try {
        const publishTimeISO = parseTimeToISO(item.publishTime);
        if (!publishTimeISO) {
          console.error('[快手] 跳过无时间记录: ' + item.title.substring(0, 30));
          continue;
        }

        const masterResult = await dbClient.query(`
          INSERT INTO content_master (platform, title, publish_time, content_type_normalized, first_seen_at)
          VALUES ($1, $2, $3, $4, NOW())
          ON CONFLICT (platform, title, publish_time) DO UPDATE SET updated_at = NOW()
          RETURNING id, tracking_status
        `, ['kuaishou', item.title, publishTimeISO, '视频']);

        const masterId = masterResult.rows[0].id;
        const trackingStatus = masterResult.rows[0].tracking_status;
        newCount++;

        if (trackingStatus === 'active') {
          await dbClient.query(`
            INSERT INTO content_snapshots (content_master_id, snapshot_date, snapshot_at, views, likes, comments, shares, favorites)
            VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7)
            ON CONFLICT (content_master_id, snapshot_date) DO UPDATE SET
              views = EXCLUDED.views, likes = EXCLUDED.likes, comments = EXCLUDED.comments,
              shares = EXCLUDED.shares, favorites = EXCLUDED.favorites, snapshot_at = NOW()
          `, [masterId, today, item.views || 0, item.likes || 0, item.comments || 0, item.shares || 0, item.favorites || 0]);
          snapshotCount++;
        }
      } catch (e) {
        console.error('[快手] 保存失败: ' + e.message);
      }
    }

    console.error('[快手] 数据库: 内容 ' + newCount + ' 条, 快照 ' + snapshotCount + ' 条');

    // 保存 JSON 文件
    const output = {
      success: true,
      platform: '快手',
      platform_code: 'kuaishou',
      count: allItems.length,
      total_on_page: totalFromApi,
      new_content: newCount,
      snapshots: snapshotCount,
      scraped_at: new Date().toISOString(),
      items: allItems
    };

    const filename = path.join(DATA_DIR, 'kuaishou_' + Date.now() + '.json');

    // 确保目录存在
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    fs.writeFileSync(filename, JSON.stringify(output, null, 2));
    console.error('[快手] 数据已保存到 ' + filename);

    // 输出最终结果
    console.log(JSON.stringify({
      success: true,
      platform: '快手',
      count: allItems.length,
      total: totalFromApi,
      new_content: newCount,
      snapshots: snapshotCount,
      file: filename
    }));

    await client.close();
    await dbClient.end();

  } catch (e) {
    console.error('[快手] 错误: ' + e.message);
    console.error(e.stack);
    console.log(JSON.stringify({
      success: false,
      platform: '快手',
      error: e.message
    }));
    if (client) try { await client.close(); } catch (ex) {}
    if (dbClient) try { await dbClient.end(); } catch (ex) {}
    process.exit(1);
  }
}

// 处理列表项
function processListItems(list, allItems, seen) {
  if (!Array.isArray(list)) return;

  for (const item of list) {
    // 快手字段映射:
    // title: 标题
    // uploadTime: 发布时间 (格式: 2026-01-27 18:09)
    // playCount: 播放量
    // likeCount: 点赞量
    // commentCount: 评论量
    
    const title = item.title || item.caption || item.desc || '';
    if (!title) continue;

    const uploadTime = item.uploadTime || item.createTime || item.publishTime || '';
    const publishTime = formatTime(uploadTime);

    const views = parseNumber(item.playCount || item.viewCount || 0);
    const likes = parseNumber(item.likeCount || 0);
    const comments = parseNumber(item.commentCount || 0);
    const shares = parseNumber(item.shareCount || 0);
    const favorites = parseNumber(item.collectCount || item.favoriteCount || 0);

    const key = title.substring(0, 50) + '|' + publishTime;
    if (!seen.has(key) && title) {
      seen.add(key);
      allItems.push({
        title: title.substring(0, 200),
        publishTime,
        views,
        likes,
        comments,
        shares,
        favorites,
        workId: item.workId || item.publishId || item.photoId || ''
      });
    }
  }
}

scrapeKuaishou();
