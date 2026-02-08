const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://100.97.242.124:19228'
  });

  const pages = await browser.pages();
  const page = pages[0];
  
  console.log('连接成功，当前URL:', await page.url());
  
  let postListData = null;
  let statsData = null;
  
  // 拦截 API
  page.on('response', async (response) => {
    const url = response.url();
    
    try {
      if (url.includes('post/post_list') && response.headers()['content-type']?.includes('json')) {
        postListData = await response.json();
        console.log('✅ 捕获 post_list API');
      }
      
      if (url.includes('statistic/new_post_total_data') && response.headers()['content-type']?.includes('json')) {
        statsData = await response.json();
        console.log('✅ 捕获 statistic API');
      }
    } catch (e) {}
  });
  
  // 导航到作品列表
  console.log('导航到作品列表...');
  await page.goto('https://channels.weixin.qq.com/platform/post/list', { 
    waitUntil: 'domcontentloaded', 
    timeout: 30000 
  });
  
  // 等待 API
  await page.waitForTimeout(8000);
  
  // 保存数据
  const fs = require('fs');
  
  if (postListData) {
    fs.writeFileSync('/tmp/channels-postlist-full.json', JSON.stringify(postListData, null, 2));
    console.log('\n✅ post_list 已保存: /tmp/channels-postlist-full.json');
    
    // 分析字段
    if (postListData.data?.list && postListData.data.list.length > 0) {
      const item = postListData.data.list[0];
      console.log('\n第一条作品的所有字段:');
      console.log(JSON.stringify(item, null, 2).substring(0, 2000));
      
      console.log('\n所有作品的字段统计:');
      const allFields = new Set();
      postListData.data.list.forEach(item => {
        Object.keys(item).forEach(key => allFields.add(key));
      });
      console.log('字段数:', allFields.size);
      console.log('字段列表:', Array.from(allFields).sort());
    }
  } else {
    console.log('❌ 未捕获到 post_list API');
  }
  
  if (statsData) {
    fs.writeFileSync('/tmp/channels-stats.json', JSON.stringify(statsData, null, 2));
    console.log('\n✅ 统计数据已保存: /tmp/channels-stats.json');
  }
  
  await browser.disconnect();
  console.log('\n✅ 完成');
  
})().catch(console.error);
