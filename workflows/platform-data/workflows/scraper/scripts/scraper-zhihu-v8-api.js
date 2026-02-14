#!/usr/bin/env node
/**
 * 知乎 API 完整采集器（分页获取所有数据）
 */
const CDP = require('chrome-remote-interface');
const fs = require('fs');

const NODE_PC_HOST = '100.97.242.124';
const PORT = 19229;

async function scrapeZhihuComplete() {
  let client;

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

    // 保存原始数据
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputFile = `/home/xx/.platform-data/zhihu_${timestamp}.json`;

    const outputData = {
      platform: '知乎',
      platform_code: 'zhihu',
      count: allItems.length,
      scraped_at: new Date().toISOString(),
      items: allItems
    };

    fs.writeFileSync(outputFile, JSON.stringify(outputData, null, 2));
    console.log(`\n✅ 数据已保存到: ${outputFile}`);

    // 保存一份到 /tmp 方便查看
    fs.writeFileSync('/tmp/zhihu-complete-data.json', JSON.stringify(outputData, null, 2));
    console.log('✅ 副本已保存到: /tmp/zhihu-complete-data.json');

  } catch (error) {
    console.error('[知乎] 采集失败:', error);
    process.exit(1);
  } finally {
    if (client) await client.close();
  }
}

scrapeZhihuComplete().then(() => {
  console.log('\n✅ 采集完成');
  process.exit(0);
}).catch(error => {
  console.error('❌ 执行失败:', error);
  process.exit(1);
});
