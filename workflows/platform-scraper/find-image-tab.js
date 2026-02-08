const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://100.97.242.124:19228'
  });

  const pages = await browser.pages();
  const page = pages[0];
  
  console.log('当前URL:', await page.url());
  
  // 截图当前页面
  await page.screenshot({ path: '/tmp/channels-current.png', fullPage: true });
  console.log('截图: /tmp/channels-current.png');
  
  // 查找所有包含"图文"或"视频"的文本元素
  const tabs = await page.evaluate(() => {
    const results = [];
    const allElements = document.querySelectorAll('*');
    
    allElements.forEach(el => {
      const text = el.innerText?.trim();
      if (text && (
        text.includes('最近视频') || 
        text.includes('最近图文') ||
        text === '图文' || 
        text === '视频' ||
        text.includes('图片')
      ) && text.length < 50) {
        // 获取元素信息
        results.push({
          text: text,
          tagName: el.tagName,
          className: el.className,
          id: el.id,
          clickable: el.onclick !== null || el.style.cursor === 'pointer'
        });
      }
    });
    
    // 去重
    const unique = [];
    const seen = new Set();
    results.forEach(r => {
      const key = r.text + r.tagName;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(r);
      }
    });
    
    return unique;
  });
  
  console.log('\n找到的标签/按钮:');
  tabs.forEach((t, i) => {
    console.log(`${i+1}. "${t.text}" (${t.tagName}) ${t.clickable ? '✓ 可点击' : ''}`);
  });
  
  // 尝试点击"最近图文"
  console.log('\n尝试点击...');
  const clickResult = await page.evaluate(() => {
    const allElements = Array.from(document.querySelectorAll('*'));
    
    // 先找"最近图文"
    let target = allElements.find(el => el.innerText?.trim() === '最近图文');
    
    // 如果没有，找只有"图文"的
    if (!target) {
      target = allElements.find(el => {
        const text = el.innerText?.trim();
        return text === '图文' && el.tagName !== 'BODY' && el.tagName !== 'HTML';
      });
    }
    
    if (target) {
      target.click();
      return { success: true, text: target.innerText?.trim() };
    }
    
    return { success: false };
  });
  
  if (clickResult.success) {
    console.log(`✅ 已点击: "${clickResult.text}"`);
    
    // 等待加载
    await page.waitForTimeout(5000);
    
    // 再次截图
    await page.screenshot({ path: '/tmp/channels-after-click.png', fullPage: true });
    console.log('点击后截图: /tmp/channels-after-click.png');
    
  } else {
    console.log('❌ 未找到可点击的图文标签');
  }
  
  await browser.disconnect();
  
})().catch(console.error);
