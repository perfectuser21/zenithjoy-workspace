#!/usr/bin/env node
/**
 * 今日头条采集器 V3 - 修复日期解析
 */
const CDP = require('chrome-remote-interface');
const { Client } = require('pg');
const fs = require('fs');

const NODE_PC_HOST = '100.97.242.124';
const PORT = 19225;

const dbClient = new Client({
  host: 'localhost', port: 5432, user: 'n8n_user',
  password: 'n8n_password_2025', database: 'social_media_raw'
});

async function scrapeToutiao() {
  let client;
  const allItems = [];
  const seen = new Set();

  try {
    await dbClient.connect();
    client = await CDP({ host: NODE_PC_HOST, port: PORT, timeout: 30000 });
    const { Runtime, Page } = client;
    await Runtime.enable();
    await Page.enable();

    console.error('[今日头条] 导航到内容管理页面...');
    await Page.navigate({ url: 'https://mp.toutiao.com/profile_v4/manage/content/all' });
    await new Promise(r => setTimeout(r, 6000));

    // 获取总数和总页数
    const { result: infoRes } = await Runtime.evaluate({
      expression: `(function(){ 
        const totalMatch = document.body.innerText.match(/共\\s*(\\d+)\\s*条内容/);
        const total = totalMatch ? parseInt(totalMatch[1]) : 0;
        const pageItems = document.querySelectorAll('.fake-pagination-item');
        let maxPage = 1;
        pageItems.forEach(el => {
          const num = parseInt(el.innerText);
          if (!isNaN(num) && num > maxPage) maxPage = num;
        });
        return JSON.stringify({ total, maxPage });
      })()`
    });
    const pageInfo = JSON.parse(infoRes.value);
    console.error('[今日头条] 共 ' + pageInfo.total + ' 条内容，' + pageInfo.maxPage + ' 页');

    const maxPages = Math.min(pageInfo.maxPage, 20);
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      console.error('[今日头条] 采集第 ' + pageNum + '/' + maxPages + ' 页...');

      if (pageNum > 1) {
        await Runtime.evaluate({
          expression: `
            (function() {
              const items = document.querySelectorAll('.fake-pagination-item');
              for (const item of items) {
                if (item.innerText.trim() === '${pageNum}') {
                  item.click();
                  return 'clicked ' + pageNum;
                }
              }
              const icons = document.querySelectorAll('.fake-pagination-item-icon');
              const nextIcon = icons[icons.length - 1];
              if (nextIcon && !nextIcon.classList.contains('disabled')) {
                nextIcon.click();
                return 'clicked next';
              }
              return 'no click';
            })()
          `
        });
        await new Promise(r => setTimeout(r, 2000));
      }

      // 提取当前页数据 - 修复日期解析
      const { result } = await Runtime.evaluate({
        expression: `
          (function() {
            const items = [];
            const cards = document.querySelectorAll('.genre-item');
            const now = new Date();
            const currentMonth = now.getMonth() + 1;
            const currentYear = now.getFullYear();
            
            for (const card of cards) {
              const text = card.innerText || '';
              const lines = text.split('\\n').map(l => l.trim()).filter(l => l);
              
              let title = '';
              let publishTime = '';
              let views = 0;
              let reads = 0;
              let likes = 0;
              let comments = 0;
              
              if (lines[0] && lines[0].length > 5 && !lines[0].match(/^\\d/)) {
                title = lines[0];
              }
              
              // 修复日期解析
              for (const line of lines) {
                let match = line.match(/(\\d{2})-(\\d{2})\\s+(\\d{2}):(\\d{2})/);
                if (match) {
                  const month = parseInt(match[1]);
                  const day = match[2];
                  const hour = match[3];
                  const minute = match[4];
                  
                  // 如果月份大于当前月份，说明是去年的内容
                  let year = currentYear;
                  if (month > currentMonth) {
                    year = currentYear - 1;
                  }
                  
                  publishTime = year + '年' + String(month).padStart(2,'0') + '月' + day + '日 ' + hour + ':' + minute;
                  break;
                }
                if (line.includes('昨天')) {
                  const t = line.match(/(\\d{2}):(\\d{2})/);
                  if (t) {
                    const d = new Date();
                    d.setDate(d.getDate() - 1);
                    publishTime = d.getFullYear() + '年' + String(d.getMonth()+1).padStart(2,'0') + '月' + String(d.getDate()).padStart(2,'0') + '日 ' + t[1] + ':' + t[2];
                    break;
                  }
                }
              }
              
              for (const line of lines) {
                if (line.includes('展现') || line.includes('阅读')) {
                  const viewMatch = line.match(/展现\\s*([\\d,.万]+)/);
                  const readMatch = line.match(/阅读\\s*([\\d,.万]+)/);
                  const likeMatch = line.match(/点赞\\s*([\\d,.万]+)/);
                  const commentMatch = line.match(/评论\\s*([\\d,.万]+)/);
                  
                  if (viewMatch) views = parseNum(viewMatch[1]);
                  if (readMatch) reads = parseNum(readMatch[1]);
                  if (likeMatch) likes = parseNum(likeMatch[1]);
                  if (commentMatch) comments = parseNum(commentMatch[1]);
                  break;
                }
              }
              
              if (title && title.length > 3) {
                items.push({ title: title.substring(0, 200), publishTime, views, reads, likes, comments });
              }
            }
            
            function parseNum(str) {
              if (!str) return 0;
              const s = String(str).replace(/,/g, '').trim();
              if (s.includes('万')) return Math.floor(parseFloat(s) * 10000);
              return parseInt(s) || 0;
            }
            
            return JSON.stringify(items);
          })()
        `
      });

      const pageItems = JSON.parse(result.value);
      console.error('[今日头条] 第 ' + pageNum + ' 页: ' + pageItems.length + ' 条');

      let newOnPage = 0;
      for (const item of pageItems) {
        const key = item.title.substring(0, 50);
        if (!seen.has(key)) {
          seen.add(key);
          allItems.push(item);
          newOnPage++;
        }
      }
      
      if (newOnPage === 0 && pageNum > 2) {
        console.error('[今日头条] 没有新数据，停止');
        break;
      }
    }

    console.error('[今日头条] 总共采集 ' + allItems.length + ' 条');

    // 保存到数据库
    const today = new Date().toISOString().split('T')[0];
    let newCount = 0, snapshotCount = 0;

    for (const item of allItems) {
      try {
        if (!item.publishTime) continue;
        
        const match = item.publishTime.match(/(\d{4})年(\d{2})月(\d{2})日\s+(\d{2}):(\d{2})/);
        if (!match) continue;
        const [_, year, month, day, hour, min] = match;
        const publishTime = new Date(`${year}-${month}-${day}T${hour}:${min}:00+08:00`).toISOString();

        const masterResult = await dbClient.query(`
          INSERT INTO content_master (platform, title, publish_time, content_type_normalized, first_seen_at)
          VALUES ($1, $2, $3, $4, NOW())
          ON CONFLICT (platform, title, publish_time) DO UPDATE SET updated_at = NOW()
          RETURNING id, tracking_status
        `, ['toutiao', item.title, publishTime, '微头条']);

        const masterId = masterResult.rows[0].id;
        const trackingStatus = masterResult.rows[0].tracking_status;
        newCount++;

        if (trackingStatus === 'active') {
          await dbClient.query(`
            INSERT INTO content_snapshots (content_master_id, snapshot_date, snapshot_at, views, likes, comments)
            VALUES ($1, $2, NOW(), $3, $4, $5)
            ON CONFLICT (content_master_id, snapshot_date) DO UPDATE SET
              views = EXCLUDED.views, likes = EXCLUDED.likes, comments = EXCLUDED.comments, snapshot_at = NOW()
          `, [masterId, today, item.views, item.likes, item.comments]);
          snapshotCount++;
        }
      } catch (e) {
        console.error('  保存失败: ' + e.message);
      }
    }

    const totalViews = allItems.reduce((sum, i) => sum + (i.views || 0), 0);
    const output = { success: true, platform: '今日头条', platform_code: 'toutiao',
      count: allItems.length, new_content: newCount, snapshots: snapshotCount,
      total_views: totalViews,
      scraped_at: new Date().toISOString(), items: allItems };

    const filename = '/home/xx/.platform-data/toutiao_' + Date.now() + '.json';
    fs.writeFileSync(filename, JSON.stringify(output, null, 2));
    console.error('[今日头条] 保存到 ' + filename);
    console.error('[今日头条] 总展现量: ' + totalViews);
    console.log(JSON.stringify({ success: true, platform: '今日头条', count: allItems.length, total_views: totalViews }));

    await client.close();
    await dbClient.end();
  } catch (e) {
    console.error('[今日头条] 错误: ' + e.message);
    console.log(JSON.stringify({ success: false, platform: '今日头条', error: e.message }));
    if (client) try { await client.close(); } catch (e) {}
    if (dbClient) try { await dbClient.end(); } catch (e) {}
    process.exit(1);
  }
}

scrapeToutiao();
