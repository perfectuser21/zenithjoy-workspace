#!/usr/bin/env node
const CDP = require('chrome-remote-interface');
const { Client } = require('pg');
const fs = require('fs');

const NODE_PC_HOST = '100.97.242.124';
const PORT = 19224;

const dbClient = new Client({
  host: 'localhost', port: 5432, user: 'n8n_user',
  password: 'n8n_password_2025', database: 'social_media_raw'
});

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
      `SELECT id, work_id FROM zenithjoy.publish_logs WHERE platform_post_id = $1 AND platform = 'xiaohongshu' LIMIT 1`,
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
    console.error('[小红书] publish_logs 关联失败（非致命）: ' + e.message);
    return null;
  }
}

function parseNumber(str) {
  if (!str) return 0;
  const s = String(str).replace(/,/g, '').trim();
  if (s.includes('万')) return Math.floor(parseFloat(s) * 10000);
  if (s.includes('w')) return Math.floor(parseFloat(s) * 10000);
  if (s.includes('k')) return Math.floor(parseFloat(s) * 1000);
  return parseInt(s) || 0;
}

async function extractPageData(Runtime) {
  const { result } = await Runtime.evaluate({
    expression: `
      (function() {
        const rows = document.querySelectorAll('tbody tr');
        const data = [];
        rows.forEach(row => {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 10) {
            const firstCellText = cells[0]?.innerText || '';
            const lines = firstCellText.split('\\n');
            let title = '';
            let publishTime = '';
            for (const line of lines) {
              if (line.includes('发布于')) {
                const match = line.match(/发布于([\\d-]+\\s*[\\d:]+)/);
                if (match) publishTime = match[1];
              } else if (line.length > 5 && !line.includes('详情数据')) {
                title = line.trim();
              }
            }
            // 尝试从第一列链接提取 note_id（URL 格式：/explore/<note_id>）
            const link = cells[0]?.querySelector('a[href*="explore"]') ||
                         cells[0]?.querySelector('a[href*="note"]');
            let noteId = '';
            if (link) {
              const href = link.href || link.getAttribute('href') || '';
              const noteMatch = href.match(/\\/explore\\/([a-f0-9]{24})/i) ||
                                href.match(/\\/note\\/([a-f0-9]{24})/i) ||
                                href.match(/noteId=([a-f0-9]{24})/i);
              if (noteMatch) noteId = noteMatch[1];
            }
            if (title && title.length >= 3) {
              data.push({
                title: title.substring(0, 200),
                publishTime: publishTime,
                noteId: noteId,
                exposure: cells[1]?.innerText?.trim() || '0',
                views: cells[2]?.innerText?.trim() || '0',
                likes: cells[4]?.innerText?.trim() || '0',
                comments: cells[5]?.innerText?.trim() || '0',
                favorites: cells[6]?.innerText?.trim() || '0',
                shares: cells[8]?.innerText?.trim() || '0'
              });
            }
          }
        });
        return JSON.stringify(data);
      })()
    `
  });
  return result.value ? JSON.parse(result.value) : [];
}

async function scrapeXiaohongshu() {
  let client;
  const allItems = [];

  // 尝试连接 zenithjoy 数据库（失败不影响主流程）
  let zenithjoyConnected = false;
  try {
    await zenithjoyClient.connect();
    zenithjoyConnected = true;
    console.error('[小红书] zenithjoy 数据库连接成功');
  } catch (e) {
    console.error('[小红书] zenithjoy 数据库连接失败（将跳过 work_id 关联）: ' + e.message);
  }

  try {
    await dbClient.connect();
    client = await CDP({ host: NODE_PC_HOST, port: PORT, timeout: 30000 });
    const { Runtime, Page } = client;
    await Runtime.enable();
    await Page.enable();

    console.error('[小红书] 导航到数据分析页面...');
    await Page.navigate({ url: 'https://creator.xiaohongshu.com/statistics/data-analysis' });
    await new Promise(r => setTimeout(r, 5000));

    // 获取总页数
    const { result: pageCountRes } = await Runtime.evaluate({
      expression: `(function() { const n=[]; document.querySelectorAll('.d-pagination-page.d-clickable').forEach(e=>{const x=parseInt(e.innerText);if(!isNaN(x))n.push(x)}); return Math.max(...n,1); })()`
    });
    const totalPages = pageCountRes.value;
    console.error('[小红书] 共 ' + totalPages + ' 页');

    for (let page = 1; page <= totalPages; page++) {
      console.error('[小红书] 采集第 ' + page + '/' + totalPages + ' 页...');

      if (page > 1) {
        // 点击页码：文本以页码开头（因为实际是 "2\n2" 格式）
        const { result: clickRes } = await Runtime.evaluate({
          expression: `
            (function() {
              const pages = document.querySelectorAll('.d-pagination-page.d-clickable');
              for (const p of pages) {
                const text = p.innerText.trim();
                if (text.startsWith('${page}')) {
                  p.click();
                  return 'clicked ' + ${page};
                }
              }
              return 'not found ' + ${page};
            })()
          `
        });
        console.error('  点击结果: ' + clickRes.value);
        await new Promise(r => setTimeout(r, 3000));
      }

      const pageData = await extractPageData(Runtime);
      console.error('  采集到 ' + pageData.length + ' 条');

      pageData.forEach(item => item._page = page);
      allItems.push(...pageData);

      await new Promise(r => setTimeout(r, 500));
    }

    console.error('[小红书] 总共采集 ' + allItems.length + ' 条数据');

    // 按标题+发布时间去重
    const uniqueItems = [];
    const seen = new Set();
    for (const item of allItems) {
      const key = item.title + '|' + item.publishTime;
      if (!seen.has(key)) { seen.add(key); uniqueItems.push(item); }
    }
    console.error('[小红书] 去重后 ' + uniqueItems.length + ' 条数据');

    const today = new Date().toISOString().split('T')[0];
    let newCount = 0;
    let snapshotCount = 0;

    for (const item of uniqueItems) {
      try {
        let publishTime = null;
        if (item.publishTime) {
          const match = item.publishTime.match(/(\d{4}-\d{2}-\d{2})\s*(\d{2}:\d{2})?/);
          if (match) publishTime = new Date(match[1] + 'T' + (match[2] || '12:00') + ':00+08:00').toISOString();
        }
        if (!publishTime) continue;

        const masterResult = await dbClient.query(`
          INSERT INTO content_master (platform, title, publish_time, content_type_normalized, first_seen_at)
          VALUES ($1, $2, $3, $4, NOW())
          ON CONFLICT (platform, title, publish_time) DO UPDATE SET updated_at = NOW()
          RETURNING id, tracking_status
        `, ['xiaohongshu', item.title, publishTime, '图文']);

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
          `, [masterId, today, parseNumber(item.views), parseNumber(item.likes),
              parseNumber(item.comments), parseNumber(item.shares), parseNumber(item.favorites)]);
          snapshotCount++;
        }
      } catch (e) {
        console.error('  保存失败: ' + e.message);
      }
    }

    // 关联 zenithjoy.publish_logs（通过 noteId → platform_post_id → work_id）
    let workIdLinked = 0;
    if (zenithjoyConnected) {
      for (const item of uniqueItems) {
        if (item.noteId) {
          const metrics = {
            views: parseNumber(item.views),
            likes: parseNumber(item.likes),
            comments: parseNumber(item.comments),
            shares: parseNumber(item.shares),
            favorites: parseNumber(item.favorites)
          };
          const workId = await linkWorkId(item.noteId, metrics);
          if (workId) {
            item.work_id = workId;
            workIdLinked++;
          }
        }
      }
      console.error('[小红书] work_id 关联完成: ' + workIdLinked + ' 条');
    }

    const output = { success: true, platform: '小红书', platform_code: 'xiaohongshu',
      count: uniqueItems.length, new_content: newCount, snapshots: snapshotCount,
      work_id_linked: workIdLinked,
      scraped_at: new Date().toISOString(), items: uniqueItems };

    const filename = '/home/xx/.platform-data/xiaohongshu_' + Date.now() + '.json';
    fs.writeFileSync(filename, JSON.stringify(output, null, 2));
    console.error('[小红书] 数据已保存到 ' + filename);
    console.log(JSON.stringify({ success: true, platform: '小红书', count: uniqueItems.length, new_content: newCount, snapshots: snapshotCount, work_id_linked: workIdLinked }));

    await client.close();
    await dbClient.end();
    if (zenithjoyConnected) await zenithjoyClient.end();
  } catch (e) {
    console.error('[小红书] 错误: ' + e.message);
    console.log(JSON.stringify({ success: false, platform: '小红书', error: e.message }));
    if (client) try { await client.close(); } catch (e) {}
    if (dbClient) try { await dbClient.end(); } catch (e) {}
    if (zenithjoyConnected) try { await zenithjoyClient.end(); } catch (e) {}
    process.exit(1);
  }
}

scrapeXiaohongshu();
