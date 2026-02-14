#!/usr/bin/env node
/**
 * 视频号采集器 V3 - 通过 API 拦截获取数据
 */
const CDP = require('chrome-remote-interface');
const { Client } = require('pg');
const fs = require('fs');

const NODE_PC_HOST = '100.97.242.124';
const PORT = 19228;

const dbClient = new Client({
  host: 'localhost', port: 5432, user: 'n8n_user',
  password: 'n8n_password_2025', database: 'social_media_raw'
});

async function scrapeChannels() {
  let client;
  const allItems = [];
  const seen = new Set();

  try {
    await dbClient.connect();
    client = await CDP({ host: NODE_PC_HOST, port: PORT, timeout: 60000 });
    const { Runtime, Page, Network } = client;
    await Runtime.enable();
    await Page.enable();
    await Network.enable();

    let postListData = null;

    // 拦截 post_list API
    Network.responseReceived(async (params) => {
      const url = params.response.url;
      if (url.includes('post/post_list') || url.includes('post_list')) {
        try {
          const { body } = await Network.getResponseBody({ requestId: params.requestId });
          console.error('[视频号] 捕获 post_list API');
          postListData = body;
        } catch (e) {}
      }
    });

    // Check login
    console.error('[视频号] 检查登录状态...');
    const { result: urlCheck } = await Runtime.evaluate({ expression: 'window.location.href' });
    if (urlCheck.value.includes('login')) {
      console.log(JSON.stringify({ success: false, platform: '视频号', error: '未登录' }));
      await client.close();
      await dbClient.end();
      return;
    }

    // Navigate and wait for API
    console.error('[视频号] 导航并等待 API...');
    await Page.navigate({ url: 'https://channels.weixin.qq.com/platform/post/list' });
    await new Promise(r => setTimeout(r, 15000));

    if (!postListData) {
      console.error('[视频号] 未捕获到 API 数据');
      console.log(JSON.stringify({ success: false, platform: '视频号', error: '未捕获到数据' }));
      await client.close();
      await dbClient.end();
      return;
    }

    // Parse API data
    console.error('[视频号] 解析 API 数据...');
    const apiResult = JSON.parse(postListData);
    
    if (apiResult.errCode !== 0 || !apiResult.data?.list) {
      console.error('[视频号] API 返回错误');
      console.log(JSON.stringify({ success: false, platform: '视频号', error: 'API错误' }));
      await client.close();
      await dbClient.end();
      return;
    }

    const list = apiResult.data.list;
    console.error('[视频号] 获取到 ' + list.length + ' 条');

    for (const item of list) {
      const title = item.desc?.description || item.desc?.shortTitle?.[0]?.shortTitle || '';
      if (!title) continue;

      // Parse create time
      let publishTime = '';
      if (item.createTime) {
        const d = new Date(item.createTime * 1000);
        publishTime = d.getFullYear() + '年' +
          String(d.getMonth()+1).padStart(2,'0') + '月' +
          String(d.getDate()).padStart(2,'0') + '日 ' +
          String(d.getHours()).padStart(2,'0') + ':' +
          String(d.getMinutes()).padStart(2,'0');
      }

      const key = title.substring(0, 50);
      if (!seen.has(key)) {
        seen.add(key);
        allItems.push({
          title: title.substring(0, 200),
          publishTime,
          views: item.readCount || 0,
          likes: item.likeCount || 0,
          comments: item.commentCount || 0,
          shares: item.forwardCount || 0,
          favorites: item.favCount || 0
        });
      }
    }

    console.error('[视频号] 总共: ' + allItems.length + ' 条');

    // Save to database
    for (const item of allItems) {
      try {
        let publishTime = null;
        const match = item.publishTime.match(/(\d{4})年(\d{2})月(\d{2})日/);
        if (match) {
          publishTime = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00+08:00`).toISOString();
        }
        await dbClient.query(`
          INSERT INTO content_master (platform, title, publish_time, content_type_normalized, first_seen_at)
          VALUES ($1, $2, $3, $4, NOW())
          ON CONFLICT (platform, title, publish_time) DO UPDATE SET updated_at = NOW()
        `, ['channels', item.title, publishTime, '视频']);
      } catch (e) {}
    }

    // Save to JSON
    const output = { success: true, platform: '视频号', platform_code: 'channels', count: allItems.length, items: allItems };
    const filename = '/home/xx/.platform-data/channels_' + Date.now() + '.json';
    fs.writeFileSync(filename, JSON.stringify(output, null, 2));
    console.error('[视频号] 保存到 ' + filename);
    console.log(JSON.stringify({ success: true, platform: '视频号', count: allItems.length }));

    await client.close();
    await dbClient.end();
  } catch (e) {
    console.error('[视频号] 错误: ' + e.message);
    console.log(JSON.stringify({ success: false, platform: '视频号', error: e.message }));
    if (client) try { await client.close(); } catch (e) {}
    if (dbClient) try { await dbClient.end(); } catch (e) {}
  }
}

scrapeChannels();
