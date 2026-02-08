const puppeteer = require('puppeteer-core');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://100.97.242.124:19228'
  });

  const pages = await browser.pages();
  const page = pages[0];

  console.log('当前URL:', await page.url());

  let imagePostData = null;

  // 监听 post_list API
  page.on('response', async (response) => {
    const url = response.url();

    if (url.includes('post/post_list') && response.headers()['content-type']?.includes('json')) {
      try {
        const data = await response.json();

        if (data && data.data && data.data.list && data.data.list.length > 0) {
          // 检查是否包含图文（mediaType 不是 4）
          const hasImagePost = data.data.list.some(item => item.mediaType !== 4);

          if (hasImagePost) {
            console.log('\n✅ 捕获到图文数据！');
            imagePostData = data;

            // 保存完整响应
            fs.writeFileSync('/tmp/channels-image-post-api.json', JSON.stringify(data, null, 2));
            console.log('已保存: /tmp/channels-image-post-api.json');

            // 提取第一个图文的字段
            const firstImagePost = data.data.list.find(item => item.mediaType !== 4);
            if (firstImagePost) {
              console.log('\n图文字段列表:');
              console.log(Object.keys(firstImagePost).sort().join(', '));

              console.log('\n图文示例数据:');
              console.log(JSON.stringify(firstImagePost, null, 2));
            }
          }
        }
      } catch (e) {
        // 忽略非 JSON 响应
      }
    }
  });

  // 刷新页面触发 API
  console.log('\n刷新页面以触发 API...');
  await page.reload({ waitUntil: 'networkidle0', timeout: 30000 });

  // 等待 API 响应
  await page.waitForTimeout(3000);

  if (!imagePostData) {
    console.log('\n⚠️ 未捕获到图文数据，尝试点击图文 tab...');

    // 点击图文 tab
    const clicked = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('*'));
      const tab = elements.find(el => el.innerText?.trim() === '图文' && el.tagName === 'A');
      if (tab) {
        tab.click();
        return true;
      }
      return false;
    });

    if (clicked) {
      console.log('已点击图文 tab，等待响应...');
      await page.waitForTimeout(5000);
    }
  }

  if (imagePostData) {
    console.log('\n✅ 成功捕获图文数据');
  } else {
    console.log('\n❌ 未能捕获图文数据');

    // 获取页面文本用于调试
    const pageText = await page.evaluate(() => document.body.innerText);
    console.log('\n页面文本（前500字符）:');
    console.log(pageText.substring(0, 500));
  }

  await browser.disconnect();

})().catch(console.error);
