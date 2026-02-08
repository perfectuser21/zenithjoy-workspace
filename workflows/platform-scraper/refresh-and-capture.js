const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://100.97.242.124:19228'
  });

  const pages = await browser.pages();
  const page = pages[0];
  
  console.log('开始刷新页面...');
  
  let postListData = null;
  
  // 设置拦截
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('post/post_list') && !postListData) {
      try {
        const contentType = response.headers()['content-type'];
        if (contentType && contentType.includes('json')) {
          postListData = await response.json();
          console.log('✅ 捕获到 post_list API');
        }
      } catch (e) {}
    }
  });
  
  // 硬刷新（清除缓存）
  const client = await page.target().createCDPSession();
  await client.send('Network.clearBrowserCache');
  console.log('✅ 已清除缓存');
  
  // 刷新页面
  await page.reload({ waitUntil: 'networkidle0', timeout: 60000 });
  console.log('✅ 页面已刷新');
  
  // 等待数据
  await page.waitForTimeout(5000);
  
  if (postListData) {
    const fs = require('fs');
    fs.writeFileSync('/tmp/channels-postlist-fresh.json', JSON.stringify(postListData, null, 2));
    console.log('\n✅ 已保存: /tmp/channels-postlist-fresh.json');
    
    if (postListData.data?.list) {
      const list = postListData.data.list;
      console.log(`\n总共 ${list.length} 条作品`);
      
      // 显示最新的 5 条
      console.log('\n最新 5 条作品:');
      list.slice(0, 5).forEach((item, i) => {
        const date = new Date(item.createTime * 1000);
        const dateStr = date.toISOString().split('T')[0];
        const mediaType = item.desc.media[0]?.mediaType;
        const typeStr = mediaType === 4 ? '视频' : mediaType === 2 ? '图文' : `类型${mediaType}`;
        
        console.log(`${i+1}. [${typeStr}] ${dateStr} - ${item.desc.description.substring(0, 40)}`);
      });
      
      // 查找图文
      const imagePosts = list.filter(i => i.desc.media[0]?.mediaType !== 4);
      if (imagePosts.length > 0) {
        console.log(`\n🎉 发现 ${imagePosts.length} 条图文作品！`);
        imagePosts.forEach((img, i) => {
          const date = new Date(img.createTime * 1000);
          console.log(`\n图文 ${i+1}:`);
          console.log(`  标题: ${img.desc.description.substring(0, 60)}`);
          console.log(`  日期: ${date.toISOString()}`);
          console.log(`  mediaType: ${img.desc.media[0].mediaType}`);
          console.log(`  完播率: ${img.fullPlayRate}`);
          console.log(`  平均播放时长: ${img.avgPlayTimeSec}`);
        });
        
        // 保存第一条图文
        fs.writeFileSync('/tmp/channels-image-post.json', JSON.stringify(imagePosts[0], null, 2));
        console.log('\n图文示例已保存: /tmp/channels-image-post.json');
      } else {
        console.log('\n⚠️ 还是没有找到图文作品');
        
        // 检查今天的作品
        const today = new Date().toISOString().split('T')[0];
        const todayPosts = list.filter(i => {
          const d = new Date(i.createTime * 1000).toISOString().split('T')[0];
          return d === today;
        });
        console.log(`今天（${today}）的作品数: ${todayPosts.length}`);
      }
    }
  } else {
    console.log('\n❌ 未捕获到数据');
  }
  
  await browser.disconnect();
  
})().catch(console.error);
