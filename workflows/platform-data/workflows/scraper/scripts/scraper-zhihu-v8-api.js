#!/usr/bin/env node
/**
 * 知乎 API 完整采集器（分页获取所有数据）
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
        content_id: String(item.id || item.question_id || ''),
        scraped_date: today,
        title: item.title || item.excerpt || '',
        views: item.voteup_count || item.views || 0,
        likes: item.voteup_count || 0,
        comments: item.comment_count || item.comments || 0,
        shares: 0,
        extra_data: { type: item.type, favorites: item.favorites_count || 0 }
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
const PORT = 19229;

// 第二个连接：cecelia 数据库，用于 zenithjoy.publish_logs 关联
const zenithjoyClient = new Client({
  host: 'localhost',
  port: 5432,
  user: 'cecelia',
  password: 'CeceliaUS2026',
  database: 'cecelia'
});

// 通过 platform_post_id 关联 zenithjoy.publish_logs，回填 metrics
async function linkWorkId(platformPostId, metrics) {
  try {
    const result = await zenithjoyClient.query(
      `SELECT id, work_id FROM zenithjoy.publish_logs WHERE platform_post_id = $1 AND platform = 'zhihu' LIMIT 1`,
      [String(platformPostId)]
    );
    if (result.rows.length === 0) return null;

    const { id, work_id } = result.rows[0];
    await zenithjoyClient.query(
      `UPDATE zenithjoy.publish_logs SET metrics = $1 WHERE id = $2`,
      [JSON.stringify(metrics), id]
    );
    return work_id;
  } catch (e) {
    console.error('[知乎] publish_logs 关联失败（非致命）: ' + e.message);
    return null;
  }
}

async function scrapeZhihuComplete() {
  let client;

  // 尝试连接 zenithjoy 数据库（失败不影响主流程）
  let zenithjoyConnected = false;
  try {
    await zenithjoyClient.connect();
    zenithjoyConnected = true;
    console.error('[知乎] zenithjoy 数据库连接成功');
  } catch (e) {
    console.error('[知乎] zenithjoy 数据库连接失败（将跳过 work_id 关联）: ' + e.message);
  }

  try {
    console.log('[知乎] 连接到浏览器...');
    client = await CDP({ host: NODE_PC_HOST, port: PORT, timeout: 30000 });
    const { Runtime, Page } = client;
    await Runtime.enable();
    await Page.enable();

    console.log('[知乎] 导航到创作中心...');
    await Page.navigate({ url: 'https://www.zhihu.com/creator/manage/creation/all' });
    await new Promise(r => setTimeout(r, 5000));

    const allItems = [];

    // 1. 获取文章（分页，每次20条）
    console.log('\n[知乎] 开始采集文章...');
    let articleOffset = 0;
    let hasMoreArticles = true;
    while (hasMoreArticles) {
      const apiUrl = `https://www.zhihu.com/api/v4/creators/creations/v2/article?start=0&end=0&limit=20&offset=${articleOffset}&need_co_creation=1&sort_type=created`;
      console.log(`  请求文章 offset=${articleOffset}...`);

      const { result } = await Runtime.evaluate({
        expression: `
          (async function() {
            try {
              const resp = await fetch('${apiUrl}', {
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

      const data = JSON.parse(result.value);
      if (data.error || !data.data || data.data.length === 0) {
        hasMoreArticles = false;
      } else {
        console.log(`  ✅ 获取到 ${data.data.length} 条文章`);
        allItems.push(...data.data);
        articleOffset += data.data.length;

        // 如果返回少于20条，说明已到末尾
        if (data.data.length < 20) hasMoreArticles = false;
      }

      await new Promise(r => setTimeout(r, 1000));
    }

    console.log(`\n文章总计: ${allItems.filter(i => i.type === 'article').length} 条`);

    // 2. 获取视频
    console.log('\n[知乎] 开始采集视频...');
    const videoUrl = 'https://www.zhihu.com/api/v4/creators/creations/v2/zvideo?start=0&end=0&limit=20&offset=0&need_co_creation=1&sort_type=created';
    const videoResult = await Runtime.evaluate({
      expression: `
        (async function() {
          try {
            const resp = await fetch('${videoUrl}', {
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

    const videoData = JSON.parse(videoResult.result.value);
    if (videoData.data) {
      console.log(`  ✅ 获取到 ${videoData.data.length} 条视频`);
      allItems.push(...videoData.data);
    }

    await new Promise(r => setTimeout(r, 1000));

    // 3. 获取想法
    console.log('\n[知乎] 开始采集想法...');
    const pinUrl = 'https://www.zhihu.com/api/v4/creators/creations/v2/pin?start=0&end=0&limit=30&offset=0&need_co_creation=1&sort_type=created';
    const pinResult = await Runtime.evaluate({
      expression: `
        (async function() {
          try {
            const resp = await fetch('${pinUrl}', {
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

    const pinData = JSON.parse(pinResult.result.value);
    if (pinData.data) {
      console.log(`  ✅ 获取到 ${pinData.data.length} 条想法`);
      allItems.push(...pinData.data);
    }

    // 统计
    const stats = {
      total: allItems.length,
      article: allItems.filter(i => i.type === 'article').length,
      zvideo: allItems.filter(i => i.type === 'zvideo').length,
      pin: allItems.filter(i => i.type === 'pin').length
    };

    console.log('\n' + '='.repeat(60));
    console.log('采集完成:');
    console.log(`  文章: ${stats.article} 条`);
    console.log(`  视频: ${stats.zvideo} 条`);
    console.log(`  想法: ${stats.pin} 条`);
    console.log(`  总计: ${stats.total} 条`);
    console.log('='.repeat(60));

    // 关联 zenithjoy.publish_logs（通过 item.id → platform_post_id → work_id）
    let workIdLinked = 0;
    if (zenithjoyConnected) {
      for (const item of allItems) {
        if (item.id) {
          const metrics = {
            views: item.voteup_count || item.read_count || 0,
            likes: item.voteup_count || 0,
            comments: item.comment_count || 0,
            shares: item.share_count || 0
          };
          const workId = await linkWorkId(item.id, metrics);
          if (workId) {
            item.work_id = workId;
            workIdLinked++;
          }
        }
      }
      console.error('[知乎] work_id 关联完成: ' + workIdLinked + ' 条');
    }

    // 保存原始数据
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputFile = `/home/xx/.platform-data/zhihu_${timestamp}.json`;

    const outputData = {
      platform: '知乎',
      platform_code: 'zhihu',
      count: allItems.length,
      work_id_linked: workIdLinked,
      scraped_at: new Date().toISOString(),
      items: allItems
    };

    fs.writeFileSync(outputFile, JSON.stringify(outputData, null, 2));
    console.log(`\n✅ 数据已保存到: ${outputFile}`);

    // 保存一份到 /tmp 方便查看
    fs.writeFileSync('/tmp/zhihu-complete-data.json', JSON.stringify(outputData, null, 2));
    console.log('✅ 副本已保存到: /tmp/zhihu-complete-data.json');

    const ingestResult = await ingestToUS('zhihu', allItems);
    console.log('[知乎] 已推送到美国 API: ' + JSON.stringify(ingestResult));

  } catch (error) {
    console.error('[知乎] 采集失败:', error);
    process.exit(1);
  } finally {
    if (client) await client.close();
    if (zenithjoyConnected) try { await zenithjoyClient.end(); } catch (e) {}
  }
}

scrapeZhihuComplete().then(() => {
  console.log('\n✅ 采集完成');
  process.exit(0);
}).catch(error => {
  console.error('❌ 执行失败:', error);
  process.exit(1);
});
