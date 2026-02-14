#!/usr/bin/env node
/**
 * 抖音采集器 V5 - 增加详细性能指标 (title匹配)
 * APIs:
 * - work_list: 基础数据
 * - item_performance: 详细性能数据 (通过title匹配)
 */
const CDP = require('chrome-remote-interface');
const { Client } = require('pg');
const fs = require('fs');

const NODE_PC_HOST = '100.97.242.124';
const PORT = 19222;

const dbClient = new Client({
  host: 'localhost', port: 5432, user: 'cecelia',
  password: 'CeceliaUS2026', database: 'social_media_raw'
});

async function scrapeDouyin() {
  let client;
  const allItems = [];
  const seen = new Set();

  try {
    await dbClient.connect();
    client = await CDP({ host: NODE_PC_HOST, port: PORT, timeout: 30000 });
    const { Runtime, Page, Network } = client;
    await Runtime.enable();
    await Page.enable();
    await Network.enable();

    // 捕获 API 响应
    const apiResponses = [];
    Network.responseReceived(async (params) => {
      if (params.response.url.includes('work_list') || params.response.url.includes('aweme/list')) {
        try {
          const { body } = await Network.getResponseBody({ requestId: params.requestId });
          apiResponses.push({ url: params.response.url, body });
        } catch (e) {}
      }
    });

    console.error('[抖音] 导航到作品管理页面...');
    await Page.navigate({ url: 'https://creator.douyin.com/creator-micro/content/manage' });
    await new Promise(r => setTimeout(r, 5000));

    // 获取总作品数
    const { result: totalRes } = await Runtime.evaluate({
      expression: `(function(){ const m = document.body.innerText.match(/共\\s*(\\d+)\\s*个作品/); return m ? parseInt(m[1]) : 0; })()`
    });
    const totalWorks = totalRes.value;
    console.error('[抖音] 共 ' + totalWorks + ' 个作品');

    // 直接调用 API 获取所有数据
    console.error('[抖音] 通过 API 获取数据...');
    let cursor = 0;
    let pageNum = 0;
    const maxPages = 20; // 防止无限循环

    while (pageNum < maxPages) {
      pageNum++;
      console.error('[抖音] 获取第 ' + pageNum + ' 页数据 (cursor=' + cursor + ')...');

      const { result } = await Runtime.evaluate({
        expression: `
          (async function() {
            try {
              const resp = await fetch('https://creator.douyin.com/janus/douyin/creator/pc/work_list?page_size=20&page_number=${pageNum}&work_status=all&max_cursor=${cursor}', {
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
        console.error('[抖音] API 错误: ' + apiData.error);
        break;
      }

      // 解析数据 - 尝试多种可能的字段名
      const items = apiData.aweme_list || apiData.item_list || apiData.data?.aweme_list || apiData.data?.item_list || [];
      
      if (items.length === 0) {
        console.error('[抖音] 没有更多数据');
        break;
      }

      console.error('[抖音] 本页获取 ' + items.length + ' 条');

      for (const item of items) {
        // 提取标题
        const title = item.desc || item.title || item.share_info?.share_title || '';
        if (!title) continue;

        // 提取发布时间
        let publishTime = '';
        if (item.create_time) {
          const d = new Date(item.create_time * 1000);
          publishTime = `${d.getFullYear()}年${String(d.getMonth()+1).padStart(2,'0')}月${String(d.getDate()).padStart(2,'0')}日 ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        }

        // 提取统计数据
        const stats = item.statistics || item.stats || {};
        const views = stats.play_count || stats.view_count || 0;
        const likes = stats.digg_count || stats.like_count || 0;
        const comments = stats.comment_count || 0;
        const shares = stats.share_count || 0;
        const favorites = stats.collect_count || stats.favorite_count || 0;

        const key = title.substring(0, 50) + '|' + publishTime;
        if (!seen.has(key)) {
          seen.add(key);
          allItems.push({
            title: title.substring(0, 200),
            publishTime,
            views,
            likes,
            comments,
            shares,
            favorites,
            aweme_id: item.aweme_id || item.item_id || ''
          });
        }
      }

      // 检查是否有更多数据
      const hasMore = apiData.has_more || (items.length >= 20);
      cursor = apiData.max_cursor || apiData.cursor || (cursor + items.length);

      if (!hasMore) {
        console.error('[抖音] API 返回 has_more=false，停止');
        break;
      }

      await new Promise(r => setTimeout(r, 1000)); // 避免请求过快
    }

    console.error('[抖音] API 获取完成，共 ' + allItems.length + ' 条');
    // 获取详细性能数据
    console.error('[抖音] 获取详细性能数据 (item_performance API)...');
    const detailsMap = new Map();
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30); // 最近90天

      const startDateStr = startDate.toISOString().split('T')[0].replace(/-/g, '');
      const endDateStr = endDate.toISOString().split('T')[0].replace(/-/g, '');

      const { result: perfResult } = await Runtime.evaluate({
        expression: `
          (async function() {
            try {
              const resp = await fetch('https://creator.douyin.com/janus/douyin/creator/data/item_analysis/item_performance', {
                method: 'POST',
                credentials: 'include',
                headers: {
                  'Content-Type': 'application/json',
                  'Accept': 'application/json'
                },
                body: JSON.stringify({
                  start_date: '${startDateStr}',
                  end_date: '${endDateStr}',
                  genres: [1,2,3,4,5,8],
                  primary_verticals: ["体育","摄影摄像","随拍","科技","职场","艺术","电影","财经"],
                  metric_type: 1
                })
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

      const perfData = JSON.parse(perfResult.value);

      if (perfData.error) {
        console.error('[抖音] 性能数据 API 错误: ' + perfData.error);
      } else {
        const perfItems = perfData.data?.items || perfData.items || [];
        console.error('[抖音] 获取到 ' + perfItems.length + ' 条详细性能数据');

        // 使用title作为key (取前100个字符避免太长)
        for (const item of perfItems) {
          const titleKey = (item.title || '').trim().substring(0, 100);
          if (titleKey) {
            detailsMap.set(titleKey, {
              average_play_duration: item.average_play_duration || null,
              bounce_rate_2s: item.bounce_rate_2s || null,
              completion_rate_5s: item.completion_rate_5s || null,
              completion_rate: item.completion_rate || null,
              cover_click_rate: item.cover_click_rate || null,
              homepage_visits: item.homepage_visits || 0,
              follower_growth: item.follower_growth || 0
            });
          }
        }
      }
    } catch (e) {
      console.error('[抖音] 获取详细数据失败: ' + e.message);
    }

    // 合并详细数据到 allItems (通过title匹配)
    let mergedCount = 0;
    for (const item of allItems) {
      const titleKey = item.title.trim().substring(0, 100);
      if (detailsMap.has(titleKey)) {
        const details = detailsMap.get(titleKey);
        Object.assign(item, details);
        mergedCount++;
      }
    }
    console.error('[抖音] 详细数据合并完成，成功匹配 ' + mergedCount + ' 条');


    // 如果 API 获取失败或数据太少，fallback 到页面采集
    if (allItems.length < 10) {
      console.error('[抖音] API 数据不足，使用页面采集 fallback...');
      
      // 滚动加载
      let lastHeight = 0;
      for (let i = 0; i < 50; i++) {
        await Runtime.evaluate({ expression: 'window.scrollTo(0, document.body.scrollHeight)' });
        await new Promise(r => setTimeout(r, 1500));

        const { result: heightRes } = await Runtime.evaluate({ expression: 'document.body.scrollHeight' });
        if (heightRes.value === lastHeight && i > 10) break;
        lastHeight = heightRes.value;
      }

      // DOM 提取
      const { result: domResult } = await Runtime.evaluate({
        expression: `
          (function() {
            const items = [];
            const cards = document.querySelectorAll('[class*="video-card"], [class*="content-item"]');
            for (const card of cards) {
              const text = card.innerText;
              const timeMatch = text.match(/(\\d{4})年(\\d{2})月(\\d{2})日\\s+(\\d{2}):(\\d{2})/);
              if (!timeMatch) continue;
              
              let views = 0, likes = 0, comments = 0, shares = 0, favorites = 0;
              const metrics = card.querySelectorAll('[class*="metric-item"]');
              for (const m of metrics) {
                const label = m.textContent || '';
                const val = parseInt(label.replace(/[^\\d]/g, '')) || 0;
                if (label.includes('播放')) views = val;
                else if (label.includes('点赞')) likes = val;
                else if (label.includes('评论')) comments = val;
                else if (label.includes('分享')) shares = val;
                else if (label.includes('收藏')) favorites = val;
              }
              
              let title = '';
              const titleEl = card.querySelector('[class*="title"]');
              if (titleEl) title = titleEl.textContent.trim();
              if (!title) {
                const lines = text.split('\\n').filter(l => l.length > 15 && l.length < 300 && !l.match(/^\\d/));
                title = lines[0] || '';
              }
              
              if (title) {
                items.push({ title: title.substring(0, 200), publishTime: timeMatch[0], views, likes, comments, shares, favorites });
              }
            }
            return JSON.stringify(items);
          })()
        `
      });

      const domItems = JSON.parse(domResult.value);
      for (const item of domItems) {
        const key = item.title.substring(0, 50) + '|' + item.publishTime;
        if (!seen.has(key)) {
          seen.add(key);
          allItems.push(item);
        }
      }
      console.error('[抖音] DOM 补充后共 ' + allItems.length + ' 条');
    }

    // 保存到数据库 (新逻辑)
    const scrapedAt = new Date();
    const scrapedDate = scrapedAt.toISOString().split('T')[0];
    let savedCount = 0;

    for (const item of allItems) {
      try {
        // 解析发布时间
        const match = item.publishTime.match(/(\d{4})年(\d{2})月(\d{2})日\s+(\d{2}):(\d{2})/);
        if (!match) continue;
        const [_, year, month, day, hour, min] = match;
        const publishTime = new Date(`${year}-${month}-${day}T${hour}:${min}:00+08:00`).toISOString();

        // 构建 extra_data（包含所有提取的字段 + 性能数据）
        const extraData = {
          aweme_id: item.aweme_id,
          title: item.title,
          publishTime: item.publishTime,
          views: item.views,
          likes: item.likes,
          comments: item.comments,
          shares: item.shares,
          favorites: item.favorites,
          // 性能数据（如果有）
          average_play_duration: item.average_play_duration || null,
          bounce_rate_2s: item.bounce_rate_2s || null,
          completion_rate_5s: item.completion_rate_5s || null,
          completion_rate: item.completion_rate || null,
          cover_click_rate: item.cover_click_rate || null,
          homepage_visits: item.homepage_visits || null,
          follower_growth: item.follower_growth || null
        };

        // 插入或更新
        await dbClient.query(`
          INSERT INTO douyin.daily_snapshots (
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
          scrapedAt, scrapedDate, item.aweme_id, item.title,
          publishTime, item.views, item.likes, item.comments, item.shares,
          JSON.stringify(extraData)
        ]);
        savedCount++;
      } catch (e) {
        console.error('[抖音] 保存失败:', item.title?.substring(0, 30), e.message);
      }
    }

    console.error('[抖音] 保存完成:', savedCount, '/' + allItems.length);

    const output = {
      success: true,
      platform: '抖音',
      platform_code: 'douyin',
      count: allItems.length,
      new_content: newCount,
      snapshots: snapshotCount,
      detailed_metrics_merged: mergedCount,
      scraped_at: new Date().toISOString(),
      items: allItems
    };

    const filename = '/home/xx/.platform-data/douyin_' + Date.now() + '.json';
    fs.writeFileSync(filename, JSON.stringify(output, null, 2));
    console.error('[抖音] 数据已保存到 ' + filename);
    console.log(JSON.stringify({
      success: true,
      platform: '抖音',
      count: allItems.length,
      new_content: newCount,
      snapshots: snapshotCount,
      detailed_metrics: mergedCount
    }));

    await client.close();
    await dbClient.end();
  } catch (e) {
    console.error('[抖音] 错误: ' + e.message);
    console.log(JSON.stringify({ success: false, platform: '抖音', error: e.message }));
    if (client) try { await client.close(); } catch (e) {}
    if (dbClient) try { await dbClient.end(); } catch (e) {}
    process.exit(1);
  }
}

scrapeDouyin();
