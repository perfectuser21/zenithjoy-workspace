#!/usr/bin/env node
const puppeteer = require('puppeteer-core');

async function findPerformanceAPI() {
  console.log('🔌 连接快手浏览器...');
  
  const browser = await puppeteer.connect({
    browserURL: 'http://100.97.242.124:19223',
    defaultViewport: null
  });
  
  const pages = await browser.pages();
  const page = pages[0] || await browser.newPage();
  
  // 导航到数据分析页面（不是作品管理页）
  console.log('📱 导航到数据分析页...');
  await page.goto('https://cp.kuaishou.com/analysis/overview', {
    waitUntil: 'networkidle2',
    timeout: 30000
  });
  
  await new Promise(r => setTimeout(r, 5000));
  
  // 尝试点击"作品数据"或"内容分析"
  console.log('🔍 查找作品数据入口...');
  
  const hasContentData = await page.evaluate(() => {
    const text = document.body.innerText;
    return {
      hasAnalysis: text.includes('作品数据') || text.includes('内容分析'),
      preview: text.substring(0, 300)
    };
  });
  
  console.log('页面内容:', hasContentData);
  
  // 尝试调用可能的详细数据 API
  console.log('\n🧪 测试可能的详细数据 API...');
  
  const apis = [
    {
      name: 'author/overview',
      url: 'https://cp.kuaishou.com/rest/cp/creator/analysis/pc/home/author/overview',
      body: { timeType: 1 }
    },
    {
      name: 'content/analysis',
      url: 'https://cp.kuaishou.com/rest/cp/creator/analysis/pc/content/analysis',
      body: { page: 0, count: 5 }
    },
    {
      name: 'photo/detail',
      url: 'https://cp.kuaishou.com/rest/cp/creator/analysis/pc/home/photo/detail',
      body: { photoId: '3x7kfcvkdf8q4bm' }
    }
  ];
  
  for (const api of apis) {
    console.log(`\n  测试: ${api.name}`);
    try {
      const result = await page.evaluate(async (apiConfig) => {
        const resp = await fetch(apiConfig.url, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(apiConfig.body)
        });
        const data = await resp.json();
        
        // 提取所有字段
        const fields = new Set();
        JSON.stringify(data, (key, value) => {
          if (key && typeof key === 'string') fields.add(key);
          return value;
        });
        
        return {
          status: resp.status,
          fields: Array.from(fields),
          sample: JSON.stringify(data).substring(0, 500)
        };
      }, api);
      
      console.log(`    状态: ${result.status}`);
      if (result.status === 200) {
        console.log(`    字段数: ${result.fields.length}`);
        
        const keywords = ['average', 'completion', 'bounce', 'duration', 'watch', 'retention', 'finish'];
        const matches = result.fields.filter(f => 
          keywords.some(kw => f.toLowerCase().includes(kw))
        );
        
        if (matches.length > 0) {
          console.log(`    🎯 找到完播率字段: ${matches.join(', ')}`);
          console.log(`    数据示例: ${result.sample}`);
        } else {
          console.log(`    ⚠️  未发现完播率字段`);
          console.log(`    所有字段: ${result.fields.slice(0, 20).join(', ')}`);
        }
      }
    } catch (err) {
      console.log(`    ❌ ${err.message}`);
    }
  }
  
  await browser.disconnect();
}

findPerformanceAPI().catch(console.error);
