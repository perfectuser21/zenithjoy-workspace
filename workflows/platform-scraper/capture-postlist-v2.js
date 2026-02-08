const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://100.97.242.124:19228'
  });

  const pages = await browser.pages();
  const page = pages[0];
  
  console.log('连接成功，当前URL:', await page.url());
  
  let postListData = null;
  
  // 拦截 API
  page.on('response', async (response) => {
    const url = response.url();
    
    try {
      if (url.includes('post/post_list') && response.headers()['content-type']?.includes('json')) {
        postListData = await response.json();
        console.log('✅ 捕获 post_list API');
      }
    } catch (e) {}
  });
  
  // 先导航到首页
  console.log('导航到首页...');
  await page.goto('https://channels.weixin.qq.com/platform', { 
    waitUntil: 'domcontentloaded', 
    timeout: 30000 
  });
  
  await page.waitForTimeout(2000);
  
  // 再导航到作品列表（触发新的 API 请求）
  console.log('导航到作品列表...');
  await page.goto('https://channels.weixin.qq.com/platform/post/list', { 
    waitUntil: 'domcontentloaded', 
    timeout: 30000 
  });
  
  // 等待 API
  await page.waitForTimeout(10000);
  
  // 保存数据
  const fs = require('fs');
  
  if (postListData) {
    fs.writeFileSync('/tmp/channels-postlist-full.json', JSON.stringify(postListData, null, 2));
    console.log('\n✅ post_list 已保存: /tmp/channels-postlist-full.json');
    
    // 分析内容类型
    if (postListData.data?.list && postListData.data.list.length > 0) {
      console.log(`\n总共 ${postListData.data.list.length} 条作品`);
      
      const mediaTypes = {};
      postListData.data.list.forEach(item => {
        const type = item.desc.media[0]?.mediaType || item.desc.mediaType;
        mediaTypes[type] = (mediaTypes[type] || 0) + 1;
      });
      
      console.log('\n内容类型分布:');
      Object.entries(mediaTypes).forEach(([type, count]) => {
        const typeName = type === '4' ? '视频' : type === '2' ? '图文（推测）' : `类型${type}`;
        console.log(`  ${typeName}: ${count} 条`);
      });
      
      // 找第一个图文作品
      const imagePost = postListData.data.list.find(item => {
        const type = item.desc.media[0]?.mediaType || item.desc.mediaType;
        return type !== 4;
      });
      
      if (imagePost) {
        console.log('\n图文作品示例:');
        console.log('mediaType:', imagePost.desc.media[0]?.mediaType);
        console.log('标题:', imagePost.desc.description?.substring(0, 50));
        console.log('完播率:', imagePost.fullPlayRate);
        console.log('平均播放时长:', imagePost.avgPlayTimeSec);
        console.log('快速翻页率:', imagePost.fastFlipRate);
        console.log('\n图文所有字段:');
        console.log(JSON.stringify(imagePost, null, 2).substring(0, 2000));
      } else {
        console.log('\n⚠️ 未找到图文作品');
      }
    }
  } else {
    console.log('❌ 未捕获到 post_list API');
  }
  
  await browser.disconnect();
  console.log('\n✅ 完成');
  
})().catch(console.error);
