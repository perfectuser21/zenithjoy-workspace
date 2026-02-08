const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://100.97.242.124:19228'
  });

  const pages = await browser.pages();
  const page = pages[0];
  
  console.log('连接成功');
  
  let postListData = null;
  
  // 设置拦截（在导航前）
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('post/post_list')) {
      try {
        const contentType = response.headers()['content-type'];
        if (contentType && contentType.includes('json')) {
          postListData = await response.json();
          console.log('✅ 捕获到 post_list API');
        }
      } catch (e) {
        console.log('解析失败:', e.message);
      }
    }
  });
  
  // 1. 先导航到空白页
  console.log('1. 导航到空白页...');
  await page.goto('about:blank');
  await page.waitForTimeout(1000);
  
  // 2. 再导航到作品列表（强制新请求）
  console.log('2. 导航到作品列表...');
  await page.goto('https://channels.weixin.qq.com/platform/post/list', {
    waitUntil: 'networkidle0',
    timeout: 60000
  });
  
  console.log('3. 等待数据加载...');
  await page.waitForTimeout(10000);
  
  if (postListData) {
    const fs = require('fs');
    const filename = '/tmp/channels-postlist-latest.json';
    fs.writeFileSync(filename, JSON.stringify(postListData, null, 2));
    console.log(`\n✅ 已保存: ${filename}`);
    
    if (postListData.data?.list) {
      const list = postListData.data.list;
      console.log(`\n总共 ${list.length} 条作品`);
      
      // 统计类型
      const types = {};
      list.forEach(item => {
        const t = item.desc.media[0]?.mediaType;
        types[t] = (types[t] || 0) + 1;
      });
      
      console.log('类型分布:');
      Object.entries(types).forEach(([type, count]) => {
        const name = type === '4' ? '视频' : type === '2' ? '图文' : `类型${type}`;
        console.log(`  ${name} (mediaType=${type}): ${count} 条`);
      });
      
      // 查找图文
      const imagePosts = list.filter(i => i.desc.media[0]?.mediaType !== 4);
      if (imagePosts.length > 0) {
        console.log(`\n🎉 发现 ${imagePosts.length} 条图文作品！`);
        const img = imagePosts[0];
        console.log('\n第一条图文:');
        console.log('  mediaType:', img.desc.media[0].mediaType);
        console.log('  标题:', img.desc.description.substring(0, 60));
        console.log('  完播率:', img.fullPlayRate);
        console.log('  平均播放时长:', img.avgPlayTimeSec);
        console.log('  快速翻页率:', img.fastFlipRate);
        
        // 保存示例
        fs.writeFileSync('/tmp/channels-image-post.json', JSON.stringify(img, null, 2));
        console.log('\n图文示例已保存: /tmp/channels-image-post.json');
      } else {
        console.log('\n⚠️ 未找到图文作品（可能还在作品列表的后面）');
        console.log('显示前3条作品的mediaType:');
        list.slice(0, 3).forEach((item, i) => {
          console.log(`  ${i+1}. ${item.desc.media[0]?.mediaType} - ${item.desc.description.substring(0, 40)}`);
        });
      }
    }
  } else {
    console.log('\n❌ 未捕获到数据');
  }
  
  await browser.disconnect();
  
})().catch(console.error);
