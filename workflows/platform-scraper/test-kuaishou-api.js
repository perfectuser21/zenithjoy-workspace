#!/usr/bin/env node
const puppeteer = require('puppeteer-core');

async function testKuaishouAPI() {
  console.log('🚀 连接快手浏览器（CDP 端口 9224）...');
  
  try {
    const browser = await puppeteer.connect({
      browserURL: 'http://127.0.0.1:9224',
      defaultViewport: null
    });
    
    const pages = await browser.pages();
    const page = pages[0] || await browser.newPage();
    
    console.log('📱 导航到快手数据分析页...');
    await page.goto('https://cp.kuaishou.com/analysis/overview', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    console.log('\n🧪 测试 API: photo/list');
    const result = await page.evaluate(async () => {
      const resp = await fetch('https://cp.kuaishou.com/rest/cp/creator/analysis/pc/home/photo/list', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page: 0, count: 3 })
      });
      return await resp.json();
    });
    
    console.log('✅ API 返回数据：');
    console.log(JSON.stringify(result, null, 2));
    
    // 检查是否有完播率相关字段
    if (result.photoList && result.photoList[0]) {
      console.log('\n📊 第一条数据的字段：');
      console.log(Object.keys(result.photoList[0]).join(', '));
    }
    
    await browser.disconnect();
    
  } catch (err) {
    console.error('❌ 错误:', err.message);
    process.exit(1);
  }
}

testKuaishouAPI();
