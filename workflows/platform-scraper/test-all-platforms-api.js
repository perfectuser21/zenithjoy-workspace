#!/usr/bin/env node
/**
 * 真正调用各平台 API，看看是否有完播率数据
 */
const puppeteer = require('puppeteer');
const fs = require('fs');

const PLATFORMS = {
  kuaishou: {
    name: '快手',
    url: 'https://cp.kuaishou.com/analysis/overview',
    apis: [
      {
        name: 'photo/list',
        url: 'https://cp.kuaishou.com/rest/cp/creator/analysis/pc/home/photo/list',
        method: 'POST',
        body: { page: 0, count: 3 }
      }
    ]
  },
  xiaohongshu: {
    name: '小红书',
    url: 'https://creator.xiaohongshu.com/creator/home',
    apis: [
      {
        name: 'note data',
        url: 'https://creator.xiaohongshu.com/api/galaxy/creator/data/note',
        method: 'GET'
      }
    ]
  }
};

async function testPlatform(browser, platformKey, platform) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📱 测试平台: ${platform.name}`);
  console.log(`${'='.repeat(60)}`);
  
  const page = await browser.newPage();
  
  try {
    console.log(`导航到: ${platform.url}`);
    await page.goto(platform.url, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    // 等待页面加载
    await new Promise(r => setTimeout(r, 3000));
    
    // 检查是否需要登录
    const needLogin = await page.evaluate(() => {
      const text = document.body.innerText.toLowerCase();
      return text.includes('登录') || text.includes('login') || text.includes('扫码');
    });
    
    if (needLogin) {
      console.log(`⚠️  需要登录，跳过 API 测试`);
      await page.close();
      return { platform: platformKey, status: 'need_login', apis: [] };
    }
    
    const results = [];
    
    for (const api of platform.apis) {
      console.log(`\n🧪 测试 API: ${api.name}`);
      console.log(`   URL: ${api.url}`);
      
      try {
        const result = await page.evaluate(async (apiConfig) => {
          const options = {
            method: apiConfig.method,
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' }
          };
          
          if (apiConfig.body) {
            options.body = JSON.stringify(apiConfig.body);
          }
          
          const resp = await fetch(apiConfig.url, options);
          const data = await resp.json();
          return { status: resp.status, data };
        }, api);
        
        console.log(`   状态码: ${result.status}`);
        
        if (result.status === 200 && result.data) {
          console.log(`   ✅ 成功获取数据`);
          
          // 检查数据结构
          const dataKeys = Object.keys(result.data);
          console.log(`   顶层字段: ${dataKeys.join(', ')}`);
          
          // 查找可能包含详细数据的字段
          const detailFields = ['average', 'completion', 'bounce', 'duration', 'watch', 'play'];
          const foundDetails = [];
          
          JSON.stringify(result.data, (key, value) => {
            if (detailFields.some(field => key.toLowerCase().includes(field))) {
              foundDetails.push(key);
            }
            return value;
          });
          
          if (foundDetails.length > 0) {
            console.log(`   🎯 发现可能的完播率字段: ${foundDetails.join(', ')}`);
          }
          
          results.push({
            api: api.name,
            status: 'success',
            hasDetailedMetrics: foundDetails.length > 0,
            detailFields: foundDetails,
            sample: JSON.stringify(result.data).substring(0, 500)
          });
        } else {
          console.log(`   ❌ API 返回错误或空数据`);
          results.push({
            api: api.name,
            status: 'error',
            error: result.status
          });
        }
      } catch (err) {
        console.log(`   ❌ 调用失败: ${err.message}`);
        results.push({
          api: api.name,
          status: 'failed',
          error: err.message
        });
      }
    }
    
    await page.close();
    return { platform: platformKey, status: 'tested', apis: results };
    
  } catch (err) {
    console.error(`❌ ${platform.name} 测试失败:`, err.message);
    await page.close();
    return { platform: platformKey, status: 'error', error: err.message };
  }
}

async function main() {
  console.log('🚀 启动浏览器...\n');
  
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const allResults = [];
  
  for (const [key, platform] of Object.entries(PLATFORMS)) {
    const result = await testPlatform(browser, key, platform);
    allResults.push(result);
  }
  
  await browser.close();
  
  // 保存结果
  fs.writeFileSync('/tmp/platform-api-test-results.json', JSON.stringify(allResults, null, 2));
  
  console.log(`\n\n${'='.repeat(60)}`);
  console.log('📊 测试结果汇总');
  console.log(`${'='.repeat(60)}\n`);
  
  allResults.forEach(result => {
    console.log(`${result.platform}:`);
    if (result.status === 'need_login') {
      console.log(`  ⚠️  需要登录`);
    } else if (result.status === 'tested') {
      result.apis.forEach(api => {
        if (api.status === 'success') {
          console.log(`  ✅ ${api.api}: ${api.hasDetailedMetrics ? '有完播率数据' : '只有基础数据'}`);
          if (api.detailFields.length > 0) {
            console.log(`     字段: ${api.detailFields.join(', ')}`);
          }
        } else {
          console.log(`  ❌ ${api.api}: ${api.error || api.status}`);
        }
      });
    } else {
      console.log(`  ❌ ${result.error}`);
    }
    console.log('');
  });
  
  console.log(`结果已保存到: /tmp/platform-api-test-results.json\n`);
}

main().catch(console.error);
