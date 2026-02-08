const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://100.97.242.124:19228'
  });

  const pages = await browser.pages();
  const page = pages[0];
  
  const url = await page.url();
  console.log(`当前 URL: ${url}`);
  
  // 检查是否已登录
  const isLoggedIn = url.includes('/home') || url.includes('/post') || url.includes('/data');
  
  if (isLoggedIn) {
    console.log('✅ 已登录，可以继续');
  } else {
    console.log('❌ 未登录，等待扫码...');
    console.log('请在浏览器中扫码登录视频号创作者平台');
    console.log('登录后，我会继续分析');
  }
  
  // 等待用户登录（检查 URL 变化）
  console.log('\n监听登录状态（60秒超时）...');
  
  try {
    await page.waitForFunction(
      () => {
        const url = window.location.href;
        return url.includes('/home') || url.includes('/post') || url.includes('/data');
      },
      { timeout: 60000 }
    );
    
    console.log('\n✅ 登录成功！');
    const newUrl = await page.url();
    console.log(`新 URL: ${newUrl}`);
    
    // 截图
    await page.screenshot({ path: '/tmp/channels-logged-in.png' });
    console.log('截图已保存: /tmp/channels-logged-in.png');
    
  } catch (e) {
    console.log('\n⏰ 60秒超时，用户可能还未登录');
    console.log('如果已登录，请手动刷新页面');
  }
  
  await browser.disconnect();
  
})().catch(console.error);
