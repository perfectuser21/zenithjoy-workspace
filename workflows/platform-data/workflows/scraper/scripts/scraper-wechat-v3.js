#!/usr/bin/env node
/**
 * 公众号采集器 V3 - 微信公众平台
 * 通过文本解析提取发表记录
 */
const CDP = require('chrome-remote-interface');
const { Client } = require('pg');
const fs = require('fs');
const crypto = require('crypto');

const NODE_PC_HOST = '100.97.242.124';
const PORT = 19229;

const dbClient = new Client({
  host: 'localhost',
  port: 5432,
  user: 'cecelia',
  password: 'CeceliaUS2026',
  database: 'social_media_raw'
});

async function ensureSchema() {
  try {
    console.error('[公众号] 初始化数据库 schema...');
    await dbClient.query(`CREATE SCHEMA IF NOT EXISTS wechat`);
    await dbClient.query(`
      CREATE TABLE IF NOT EXISTS wechat.daily_snapshots (
        scraped_at TIMESTAMPTZ NOT NULL,
        scraped_date DATE NOT NULL,
        content_id TEXT NOT NULL,
        title TEXT NOT NULL,
        publish_time TIMESTAMPTZ,
        views INT,
        likes INT,
        comments INT,
        shares INT,
        extra_data JSONB,
        PRIMARY KEY (content_id, scraped_date)
      )
    `);
    await dbClient.query(`
      SELECT create_hypertable('wechat.daily_snapshots', 'scraped_at', if_not_exists => TRUE)
    `);
    console.error('[公众号] Schema 初始化完成');
  } catch (e) {
    console.error('[公众号] Schema 初始化错误: ' + e.message);
  }
}

async function scrapeWechat() {
  let client;
  const allItems = [];
  const seen = new Set();

  try {
    await dbClient.connect();
    await ensureSchema();

    client = await CDP({ host: NODE_PC_HOST, port: PORT, timeout: 30000 });
    const { Runtime, Page } = client;
    await Runtime.enable();
    await Page.enable();

    // Check login
    console.error('[公众号] 检查登录状态...');
    const { result: urlCheck } = await Runtime.evaluate({ expression: 'window.location.href' });
    if (urlCheck.value.includes('login') || urlCheck.value.includes('scanlogin')) {
      console.log(JSON.stringify({ success: false, platform: '公众号', error: '未登录' }));
      await client.close();
      await dbClient.end();
      return;
    }

    // Navigate to publish list
    console.error('[公众号] 导航到发表记录...');
    await Page.navigate({ url: 'https://mp.weixin.qq.com/cgi-bin/appmsgpublish?sub=list&begin=0&count=50&token=772780177&lang=zh_CN' });
    await new Promise(r => setTimeout(r, 8000));

    // Parse text content
    console.error('[公众号] 解析页面内容...');
    const { result } = await Runtime.evaluate({
      expression: `
        (function() {
          const text = document.body.innerText;
          const lines = text.split('\\n').map(l => l.trim()).filter(l => l);
          const items = [];
          
          let i = 0;
          while (i < lines.length) {
            // 查找日期行 (2025年12月31日)
            const dateMatch = lines[i].match(/^(\\d{4})年(\\d{1,2})月(\\d{1,2})日$/);
            if (dateMatch) {
              const publishTime = lines[i];
              i++;
              
              // 跳过 "已发表"
              if (lines[i] === '已发表') i++;
              
              // 下一行是标题
              if (i < lines.length && lines[i].length > 5 && !lines[i].match(/^\\d+$/)) {
                const title = lines[i];
                i++;
                
                // 接下来 6 个数字是统计数据: 阅读 在看 点赞 分享 收藏 留言
                const stats = [];
                while (stats.length < 6 && i < lines.length) {
                  if (lines[i].match(/^\\d+$/)) {
                    stats.push(parseInt(lines[i]));
                  }
                  i++;
                }
                
                items.push({
                  title: title.substring(0, 200),
                  publishTime,
                  views: stats[0] || 0,       // 阅读
                  watching: stats[1] || 0,    // 在看
                  likes: stats[2] || 0,       // 点赞
                  shares: stats[3] || 0,      // 分享
                  favorites: stats[4] || 0,   // 收藏
                  comments: stats[5] || 0     // 留言
                });
              }
            } else {
              i++;
            }
          }
          
          return JSON.stringify(items);
        })()
      `
    });

    let items = JSON.parse(result.value || '[]');
    console.error('[公众号] 第一次解析: ' + items.length + ' 条');

    // 滚动到底部加载更多内容
    console.error('[公众号] 滚动加载更多...');
    await Runtime.evaluate({
      expression: 'window.scrollTo(0, document.body.scrollHeight)'
    });
    await new Promise(r => setTimeout(r, 3000));

    // 第二次解析
    const { result: moreResult } = await Runtime.evaluate({
      expression: `
        (function() {
          const text = document.body.innerText;
          const lines = text.split('\\n').map(l => l.trim()).filter(l => l);
          const items = [];

          let i = 0;
          while (i < lines.length) {
            const dateMatch = lines[i].match(/^(\\d{4})年(\\d{1,2})月(\\d{1,2})日$/);
            if (dateMatch) {
              const publishTime = lines[i];
              i++;
              if (lines[i] === '已发表') i++;
              if (i < lines.length && lines[i].length > 5 && !lines[i].match(/^\\d+$/)) {
                const title = lines[i];
                i++;
                const stats = [];
                while (stats.length < 6 && i < lines.length) {
                  if (lines[i].match(/^\\d+$/)) {
                    stats.push(parseInt(lines[i]));
                  }
                  i++;
                }
                items.push({
                  title: title.substring(0, 200),
                  publishTime,
                  views: stats[0] || 0,
                  watching: stats[1] || 0,
                  likes: stats[2] || 0,
                  shares: stats[3] || 0,
                  favorites: stats[4] || 0,
                  comments: stats[5] || 0
                });
              }
            } else {
              i++;
            }
          }
          return JSON.stringify(items);
        })()
      `
    });

    const moreItems = JSON.parse(moreResult.value || '[]');
    console.error('[公众号] 第二次解析: ' + moreItems.length + ' 条');

    // 如果第二次解析到更多文章，用新结果替换
    if (moreItems.length > items.length) {
      items = moreItems;
      console.error('[公众号] 采用第二次解析结果');
    }

    console.error('[公众号] 最终解析到: ' + items.length + ' 条');

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    for (const item of items) {
      // 检查发布时间是否在 30 天内
      const match = item.publishTime.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
      if (match) {
        const publishDate = new Date(`${match[1]}-${match[2]}-${match[3]}`);
        if (publishDate < thirtyDaysAgo) {
          console.error('[公众号] 遇到 30 天前的文章，停止采集');
          break;
        }
      }

      const key = item.title.substring(0, 50);
      if (!seen.has(key)) {
        seen.add(key);
        allItems.push(item);
      }
    }

    // Check for next page and load more
    let hasMore = true;
    let page = 1;
    while (hasMore && page < 5) {
      const { result: nextCheck } = await Runtime.evaluate({
        expression: `document.body.innerText.includes('下一页')`
      });
      
      if (!nextCheck.value) {
        hasMore = false;
        break;
      }

      page++;
      console.error('[公众号] 加载第 ' + page + ' 页...');
      
      await Runtime.evaluate({
        expression: `
          const nextBtn = document.querySelector('.weui-desktop-pagination__nav--next, a:contains("下一页")');
          if (nextBtn) nextBtn.click();
        `
      });
      await new Promise(r => setTimeout(r, 3000));

      // Parse again
      const { result: moreResult } = await Runtime.evaluate({
        expression: `
          (function() {
            const text = document.body.innerText;
            const lines = text.split('\\n').map(l => l.trim()).filter(l => l);
            const items = [];
            
            let i = 0;
            while (i < lines.length) {
              const dateMatch = lines[i].match(/^(\\d{4})年(\\d{1,2})月(\\d{1,2})日$/);
              if (dateMatch) {
                const publishTime = lines[i];
                i++;
                if (lines[i] === '已发表') i++;
                if (i < lines.length && lines[i].length > 5 && !lines[i].match(/^\\d+$/)) {
                  const title = lines[i];
                  i++;
                  const stats = [];
                  while (stats.length < 6 && i < lines.length) {
                    if (lines[i].match(/^\\d+$/)) stats.push(parseInt(lines[i]));
                    i++;
                  }
                  items.push({
                    title: title.substring(0, 200),
                    publishTime,
                    views: stats[0] || 0,
                    watching: stats[1] || 0,
                    likes: stats[2] || 0,
                    shares: stats[3] || 0,
                    favorites: stats[4] || 0,
                    comments: stats[5] || 0
                  });
                }
              } else {
                i++;
              }
            }
            return JSON.stringify(items);
          })()
        `
      });

      const moreItems = JSON.parse(moreResult.value || '[]');
      let newCount = 0;
      for (const item of moreItems) {
        const key = item.title.substring(0, 50);
        if (!seen.has(key)) {
          seen.add(key);
          allItems.push(item);
          newCount++;
        }
      }
      if (newCount === 0) hasMore = false;
    }

    console.error('[公众号] 总共: ' + allItems.length + ' 条');

    // Save to database
    const scrapedAt = new Date().toISOString();
    const scrapedDate = new Date().toISOString().split('T')[0];
    let savedCount = 0;

    for (const item of allItems) {
      try {
        const match = item.publishTime.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
        if (!match) continue;

        const publishTime = new Date(`${match[1]}-${String(match[2]).padStart(2,'0')}-${String(match[3]).padStart(2,'0')}T00:00:00+08:00`).toISOString();

        // 生成 content_id
        const content_id = crypto.createHash('md5')
          .update(`${item.title}|${item.publishTime}`)
          .digest('hex');

        // 构建 extra_data
        const extraData = {
          content_type: 'article',
          platform_stats: {
            read_count: item.views,
            watching_count: item.watching || 0,
            like_count: item.likes,
            share_count: item.shares || 0,
            favorite_count: item.favorites || 0,
            comment_count: item.comments
          },
          raw_publish_time: item.publishTime
        };

        await dbClient.query(`
          INSERT INTO wechat.daily_snapshots (
            scraped_at, scraped_date, content_id, title,
            publish_time, views, likes, comments, shares,
            extra_data
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (content_id, scraped_date)
          DO UPDATE SET
            scraped_at = EXCLUDED.scraped_at,
            views = EXCLUDED.views,
            likes = EXCLUDED.likes,
            comments = EXCLUDED.comments,
            shares = EXCLUDED.shares,
            extra_data = EXCLUDED.extra_data
        `, [
          scrapedAt, scrapedDate, content_id, item.title,
          publishTime, item.views, item.likes, item.comments, item.shares || 0,
          JSON.stringify(extraData)
        ]);
        savedCount++;
      } catch (e) {
        console.error('[公众号] 保存失败: ' + e.message);
      }
    }

    console.error('[公众号] 保存到数据库: ' + savedCount + ' 条');

    // Save to JSON
    const output = {
      success: true,
      platform: '公众号',
      platform_code: 'wechat',
      count: allItems.length,
      saved: savedCount,
      scraped_at: scrapedAt,
      items: allItems
    };
    const filename = '/home/xx/.platform-data/wechat_' + Date.now() + '.json';
    fs.writeFileSync(filename, JSON.stringify(output, null, 2));
    console.error('[公众号] 保存到 ' + filename);
    console.log(JSON.stringify({ success: true, platform: '公众号', count: allItems.length, saved: savedCount }));

    await client.close();
    await dbClient.end();
  } catch (e) {
    console.error('[公众号] 错误: ' + e.message);
    console.log(JSON.stringify({ success: false, platform: '公众号', error: e.message }));
    if (client) try { await client.close(); } catch (e) {}
    if (dbClient) try { await dbClient.end(); } catch (e) {}
  }
}

scrapeWechat();
