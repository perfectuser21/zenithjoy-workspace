const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://100.97.242.124:19228'
  });

  const pages = await browser.pages();
  const page = pages[0];
  
  console.log('连接成功');
  
  let captured = false;
  let postListData = null;
  
  // 设置拦截
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('post/post_list') && !captured) {
      try {
        postListData = await response.json();
        captured = true;
        console.log('✅ 捕获到 post_list API');
      } catch (e) {}
    }
  });
  
  // 清除缓存
  const client = await page.target().createCDPSession();
  await client.send('Network.clearBrowserCache');
  await client.send('Network.clearBrowserCookies');
  console.log('✅ 已清除缓存');
  
  // 硬刷新页面
  console.log('正在刷新页面...');
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
  
  // 等待数据
  await page.waitForTimeout(10000);
  
  if (postListData) {
    const fs = require('fs');
    fs.writeFileSync('/tmp/channels-postlist-latest.json', JSON.stringify(postListData, null, 2));
    console.log('\n✅ 已保存: /tmp/channels-postlist-latest.json');
    
    // 分析类型
    const types = {};
    postListData.data.list.forEach(item => {
      const t = item.desc.media[0]?.mediaType;
      types[t] = (types[t] || 0) + 1;
    });
    
    console.log(`\n总共 ${postListData.data.list.length} 条作品`);
    console.log('类型分布:', types);
    
    // 找图文
    const imagePost = postListData.data.list.find(i => i.desc.media[0]?.mediaType !== 4);
    if (imagePost) {
      console.log('\n🎉 发现图文作品！');
      console.log('mediaType:', imagePost.desc.media[0].mediaType);
      console.log('标题:', imagePost.desc.description.substring(0, 50));
      
      // 保存单独的图文示例
      fs.writeFileSync('/tmp/channels-image-post.json', JSON.stringify(imagePost, null, 2));
      console.log('图文示例已保存: /tmp/channels-image-post.json');
    } else {
      console.log('\n⚠️ 还是没有图文作品');
    }
  } else {
    console.log('\n❌ 未捕获到数据');
  }
  
  await browser.disconnect();
  
})().catch(console.error);
