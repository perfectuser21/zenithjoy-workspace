const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://100.97.242.124:19227'
  });
  
  const pages = await browser.pages();
  const page = pages[1];
  await page.bringToFront();
  
  const uid = '8429936541';
  
  console.log('📋 分析微博字段结构\n');
  
  // 1. 获取普通微博的一条数据
  console.log('【1】普通微博区 API 字段:');
  console.log('API: /ajax/statuses/mymblog\n');
  
  const weiboResponse = await page.evaluate(async (u) => {
    try {
      const res = await fetch(`https://weibo.com/ajax/statuses/mymblog?uid=${u}&page=1&feature=0`, {
        credentials: 'include'
      });
      return await res.json();
    } catch (e) {
      return null;
    }
  }, uid);
  
  if (weiboResponse && weiboResponse.data && weiboResponse.data.list) {
    const sample = weiboResponse.data.list[0];
    const fields = Object.keys(sample).sort();
    
    console.log(`总字段数: ${fields.length}个\n`);
    
    fields.forEach(field => {
      const value = sample[field];
      const type = Array.isArray(value) ? 'array' : typeof value;
      const preview = type === 'object' && value !== null ? '{...}' : 
                     type === 'array' ? `[${value.length}]` :
                     type === 'string' ? `"${String(value).substring(0, 30)}${String(value).length > 30 ? '...' : ''}"` :
                     value;
      console.log(`  ${field}: ${type} = ${preview}`);
    });
    
    // 保存完整样本
    require('fs').writeFileSync('/tmp/weibo-normal-sample.json', JSON.stringify(sample, null, 2));
    console.log('\n✅ 完整数据已保存: /tmp/weibo-normal-sample.json');
  }
  
  // 2. 获取视频专区的一条数据
  console.log('\n【2】视频专区 API 字段:');
  console.log('API: /ajax/profile/getWaterFallContent\n');
  
  const videoResponse = await page.evaluate(async (u) => {
    try {
      const res = await fetch(`https://weibo.com/ajax/profile/getWaterFallContent?uid=${u}`, {
        credentials: 'include'
      });
      return await res.json();
    } catch (e) {
      return null;
    }
  }, uid);
  
  if (videoResponse && videoResponse.data && videoResponse.data.list) {
    const sample = videoResponse.data.list[0];
    const fields = Object.keys(sample).sort();
    
    console.log(`总字段数: ${fields.length}个\n`);
    
    fields.forEach(field => {
      const value = sample[field];
      const type = Array.isArray(value) ? 'array' : typeof value;
      const preview = type === 'object' && value !== null ? '{...}' : 
                     type === 'array' ? `[${value.length}]` :
                     type === 'string' ? `"${String(value).substring(0, 30)}${String(value).length > 30 ? '...' : ''}"` :
                     value;
      console.log(`  ${field}: ${type} = ${preview}`);
    });
    
    // 保存完整样本
    require('fs').writeFileSync('/tmp/weibo-video-sample.json', JSON.stringify(sample, null, 2));
    console.log('\n✅ 完整数据已保存: /tmp/weibo-video-sample.json');
  }
  
  // 3. 对比字段差异
  console.log('\n【3】字段对比:');
  
  if (weiboResponse && videoResponse) {
    const normalFields = new Set(Object.keys(weiboResponse.data.list[0]));
    const videoFields = new Set(Object.keys(videoResponse.data.list[0]));
    
    const commonFields = [...normalFields].filter(f => videoFields.has(f));
    const normalOnly = [...normalFields].filter(f => !videoFields.has(f));
    const videoOnly = [...videoFields].filter(f => !normalFields.has(f));
    
    console.log(`\n共同字段 (${commonFields.length}个):`);
    commonFields.sort().forEach(f => console.log(`  ✓ ${f}`));
    
    console.log(`\n普通微博独有 (${normalOnly.length}个):`);
    normalOnly.sort().forEach(f => console.log(`  📝 ${f}`));
    
    console.log(`\n视频专区独有 (${videoOnly.length}个):`);
    videoOnly.sort().forEach(f => console.log(`  🎬 ${f}`));
  }
  
  await browser.disconnect();
})();
