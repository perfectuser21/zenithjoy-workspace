const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://100.97.242.124:19228'
  });

  const pages = await browser.pages();
  const page = pages[0];
  
  console.log('检查页面显示的作品...');
  
  // 获取页面上显示的作品时间
  const displayedPosts = await page.evaluate(() => {
    const posts = [];
    
    // 查找所有作品卡片
    document.querySelectorAll('[class*="item"], [class*="card"], [class*="post"]').forEach((card, i) => {
      const text = card.innerText;
      // 查找日期（格式：2025年12月17日 或 2026年02月08日）
      const dateMatch = text.match(/(\d{4})年(\d{2})月(\d{2})日/);
      if (dateMatch) {
        posts.push({
          index: i,
          date: `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`,
          text: text.substring(0, 100)
        });
      }
    });
    
    return posts.slice(0, 10); // 前10条
  });
  
  console.log('\n页面显示的前 10 条作品:');
  displayedPosts.forEach(p => {
    console.log(`${p.index + 1}. ${p.date} - ${p.text.split('\n')[0]}`);
  });
  
  // 滚动页面
  console.log('\n滚动页面加载更多...');
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
  });
  
  await page.waitForTimeout(3000);
  
  // 再次检查
  const moreDisplayed = await page.evaluate(() => {
    const posts = [];
    document.querySelectorAll('[class*="item"], [class*="card"], [class*="post"]').forEach((card) => {
      const text = card.innerText;
      const dateMatch = text.match(/(\d{4})年(\d{2})月(\d{2})日/);
      if (dateMatch) {
        posts.push(`${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`);
      }
    });
    return posts;
  });
  
  console.log(`\n滚动后共 ${moreDisplayed.length} 条作品`);
  
  // 查找今天的
  const today = '2026-02-08';
  const todayPosts = moreDisplayed.filter(d => d === today);
  if (todayPosts.length > 0) {
    console.log(`✅ 找到 ${todayPosts.length} 条今天的作品！`);
  } else {
    console.log(`❌ 页面上也没有今天（${today}）的作品`);
    console.log('最新的日期:', moreDisplayed[0]);
  }
  
  await browser.disconnect();
  
})().catch(console.error);
