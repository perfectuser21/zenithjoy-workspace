#!/usr/bin/env node
/**
 * 微博采集器 V3 - 使用 API 获取阅读量
 * API: /ajax/statuses/mymblog?uid={uid}&page={page}
 * 字段: reads_count = 阅读量
 */
const CDP = require('chrome-remote-interface');
const { Client } = require('pg');
const fs = require('fs');
const http = require('http');

function ingestToUS(platform, items) {
  return new Promise((resolve) => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const mapped = items.map(item => ({
        content_id: item.weiboId || item.id || item.mid || '',
        scraped_date: today,
        title: item.content || item.title || item.text || '',
        views: item.views || item.reads_count || 0,
        likes: item.likes || item.attitudes_count || 0,
        comments: item.comments || item.comments_count || 0,
        shares: item.reposts || item.reposts_count || 0,
        extra_data: { publishTime: item.publishTime }
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

const NODE_PC_HOST = '100.97.242.124';
const PORT = 19227;
const USER_ID = '8429936541';

const dbClient = new Client({
  host: 'localhost', port: 5432, user: 'n8n_user',
  password: 'n8n_password_2025', database: 'social_media_raw'
});

const zenithjoyClient = new Client({
  host: 'localhost', port: 5432, user: 'cecelia',
  password: 'CeceliaUS2026', database: 'cecelia'
});

async function linkWorkId(platformPostId, metrics) {
  try {
    const result = await zenithjoyClient.query(
      `SELECT id, work_id FROM zenithjoy.publish_logs WHERE platform_post_id = $1 AND platform = 'weibo' LIMIT 1`,
      [platformPostId]
    );
    if (result.rows.length === 0) return null;
    const { id, work_id } = result.rows[0];
    await zenithjoyClient.query(
      `UPDATE zenithjoy.publish_logs SET metrics = $1 WHERE id = $2`,
      [JSON.stringify(metrics), id]
    );
    return work_id;
  } catch (e) {
    console.error('[微博] publish_logs 关联失败（非致命）: ' + e.message);
    return null;
  }
}

async function scrapeWeibo() {
  let client;
  const allItems = [];
  const seen = new Set();
  let zenithjoyConnected = false;

  try {
    await dbClient.connect();
    try {
      await zenithjoyClient.connect();
      zenithjoyConnected = true;
    } catch (e) {
      console.error('[微博] zenithjoy DB 连接失败（非致命）: ' + e.message);
    }
    client = await CDP({ host: NODE_PC_HOST, port: PORT, timeout: 30000 });
    const { Runtime, Page } = client;
    await Runtime.enable();
    await Page.enable();

    console.error('[微博] 导航到用户主页...');
    await Page.navigate({ url: 'https://weibo.com/u/' + USER_ID });
    await new Promise(r => setTimeout(r, 5000));

    // 使用 API 获取所有微博
    console.error('[微博] 通过 API 获取数据...');
    let pageNum = 0;
    const maxPages = 10;

    while (pageNum < maxPages) {
      pageNum++;
      console.error('[微博] 获取第 ' + pageNum + ' 页...');

      const { result } = await Runtime.evaluate({
        expression: `
          (async function() {
            try {
              const resp = await fetch('https://weibo.com/ajax/statuses/mymblog?uid=${USER_ID}&page=${pageNum}&feature=0', {
                credentials: 'include',
                headers: { 'Accept': 'application/json' }
              });
              const data = await resp.json();
              return JSON.stringify(data);
            } catch(e) {
              return JSON.stringify({ error: e.message });
            }
          })()
        `,
        awaitPromise: true
      });

      const apiData = JSON.parse(result.value);
      
      if (apiData.error) {
        console.error('[微博] API 错误: ' + apiData.error);
        break;
      }

      const posts = apiData.data?.list || [];
      
      if (posts.length === 0) {
        console.error('[微博] 没有更多数据');
        break;
      }

      console.error('[微博] 本页获取 ' + posts.length + ' 条');

      for (const post of posts) {
        try {
          const title = post.text_raw || post.text || '';
          if (!title || title.length < 3) continue;

          // 解析发布时间
          let publishTime = '';
          if (post.created_at) {
            const d = new Date(post.created_at);
            publishTime = d.getFullYear() + '年' + 
              String(d.getMonth()+1).padStart(2,'0') + '月' + 
              String(d.getDate()).padStart(2,'0') + '日 ' + 
              String(d.getHours()).padStart(2,'0') + ':' + 
              String(d.getMinutes()).padStart(2,'0');
          }

          // 提取统计数据
          const views = post.reads_count || 0;
          const likes = post.attitudes_count || 0;
          const comments = post.comments_count || 0;
          const reposts = post.reposts_count || 0;

          const key = title.substring(0, 50) + '|' + publishTime;
          if (!seen.has(key) && publishTime) {
            seen.add(key);
            allItems.push({
              title: title.replace(/<[^>]*>/g, '').substring(0, 200),
              publishTime,
              views,
              likes,
              comments,
              reposts,
              weiboId: post.mid || post.id || ''
            });
          }
        } catch (e) {
          console.error('  解析失败: ' + e.message);
        }
      }

      // 检查是否有更多
      if (posts.length < 20) {
        console.error('[微博] 数据获取完成');
        break;
      }

      await new Promise(r => setTimeout(r, 500));
    }

    console.error('[微博] API 获取完成，共 ' + allItems.length + ' 条');

    // 保存到数据库
    const today = new Date().toISOString().split('T')[0];
    let newCount = 0, snapshotCount = 0;

    for (const item of allItems) {
      try {
        const match = item.publishTime.match(/(\d{4})年(\d{2})月(\d{2})日\s+(\d{2}):(\d{2})/);
        if (!match) continue;
        const [_, year, month, day, hour, min] = match;
        const publishTime = new Date(`${year}-${month}-${day}T${hour}:${min}:00+08:00`).toISOString();

        const masterResult = await dbClient.query(`
          INSERT INTO content_master (platform, title, publish_time, content_type_normalized, first_seen_at)
          VALUES ($1, $2, $3, $4, NOW())
          ON CONFLICT (platform, title, publish_time) DO UPDATE SET updated_at = NOW()
          RETURNING id, tracking_status
        `, ['weibo', item.title, publishTime, '图文']);

        const masterId = masterResult.rows[0].id;
        const trackingStatus = masterResult.rows[0].tracking_status;
        newCount++;

        if (trackingStatus === 'active') {
          await dbClient.query(`
            INSERT INTO content_snapshots (content_master_id, snapshot_date, snapshot_at, views, likes, comments, shares)
            VALUES ($1, $2, NOW(), $3, $4, $5, $6)
            ON CONFLICT (content_master_id, snapshot_date) DO UPDATE SET
              views = EXCLUDED.views, likes = EXCLUDED.likes, comments = EXCLUDED.comments, 
              shares = EXCLUDED.shares, snapshot_at = NOW()
          `, [masterId, today, item.views, item.likes, item.comments, item.reposts]);
          snapshotCount++;
        }
      } catch (e) {
        console.error('  保存失败: ' + e.message);
      }
    }

    // 关联 zenithjoy.publish_logs（通过 platform_post_id → work_id）
    let workIdLinked = 0;
    if (zenithjoyConnected) {
      for (const item of allItems) {
        if (item.weiboId) {
          const metrics = {
            views: item.views || 0,
            likes: item.likes || 0,
            comments: item.comments || 0,
            reposts: item.reposts || 0
          };
          const workId = await linkWorkId(item.weiboId, metrics);
          if (workId) {
            item.work_id = workId;
            workIdLinked++;
          }
        }
      }
      console.error('[微博] work_id 关联完成: ' + workIdLinked + ' 条');
    }

    const totalViews = allItems.reduce((sum, i) => sum + (i.views || 0), 0);
    const output = { success: true, platform: '微博', platform_code: 'weibo',
      count: allItems.length, new_content: newCount, snapshots: snapshotCount,
      work_id_linked: workIdLinked, total_views: totalViews,
      scraped_at: new Date().toISOString(), items: allItems };

    const filename = '/home/xx/.platform-data/weibo_' + Date.now() + '.json';
    fs.writeFileSync(filename, JSON.stringify(output, null, 2));
    console.error('[微博] 保存到 ' + filename);
    console.error('[微博] 总阅读量: ' + totalViews);
    const ingestResult = await ingestToUS('weibo', allItems);
    console.error('[微博] 已推送到美国 API: ' + JSON.stringify(ingestResult));
    console.log(JSON.stringify({ success: true, platform: '微博', count: allItems.length, total_views: totalViews, work_id_linked: workIdLinked }));

    await client.close();
    await dbClient.end();
    if (zenithjoyConnected) await zenithjoyClient.end();
  } catch (e) {
    console.error('[微博] 错误: ' + e.message);
    console.log(JSON.stringify({ success: false, platform: '微博', error: e.message }));
    if (client) try { await client.close(); } catch (e) {}
    if (dbClient) try { await dbClient.end(); } catch (e) {}
    try { await zenithjoyClient.end(); } catch (e) {}
    process.exit(1);
  }
}

scrapeWeibo();
