#!/usr/bin/env node
const puppeteer = require('puppeteer-core');
const fs = require('fs');

const REMOTE_HOST = '100.97.242.124';

const PLATFORMS = {
  kuaishou: {
    name: '快手',
    port: 19223,
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
    port: 19224,
    url: 'https://creator.xiaohongshu.com/creator/home',
    apis: [
      {
        name: 'note/data',
        url: 'https://creator.xiaohongshu.com/api/galaxy/creator/data/note',
        method: 'GET'
      }
    ]
  }
};

async function testPlatform(platformKey, platform) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📱 测试: ${platform.name} (端口 ${platform.port})`);
  console.log(`${'='.repeat(60)}`);
  
  try {
    console.log(`🔌 连接远程浏览器 ${REMOTE_HOST}:${platform.port}...`);
    
    const browser = await puppeteer.connect({
      browserURL: `http://${REMOTE_HOST}:${platform.port}`,
      defaultViewport: null
    });
    
    const pages = await browser.pages();
    const page = pages[0] || await browser.newPage();
    
    console.log(`✅ 连接成功，当前 URL: ${page.url()}`);
    
    const results = [];
    
    for (const api of platform.apis) {
      console.log(`\n🧪 测试 API: ${api.name}`);
      
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
          
          // 提取所有字段名
          const allKeys = new Set();
          JSON.stringify(data, (key, value) => {
            if (key) allKeys.add(key);
            return value;
          });
          
          return { 
            status: resp.status, 
            data,
            allKeys: Array.from(allKeys)
          };
        }, api);
        
        console.log(`   状态: ${result.status}`);
        
        if (result.status === 200 && result.data) {
          console.log(`   ✅ 成功获取数据`);
          console.log(`   所有字段: ${result.allKeys.slice(0, 20).join(', ')}${result.allKeys.length > 20 ? '...' : ''}`);
          
          // 查找完播率相关字段
          const keywords = ['average', 'completion', 'bounce', 'duration', 'watch', 'play', 'finish', 'retention'];
          const found = result.allKeys.filter(key => 
            keywords.some(kw => key.toLowerCase().includes(kw))
          );
          
          if (found.length > 0) {
            console.log(`   🎯 发现完播率相关字段: ${found.join(', ')}`);
          } else {
            console.log(`   ⚠️  未发现完播率字段`);
          }
          
          results.push({
            api: api.name,
            status: 'success',
            hasMetrics: found.length > 0,
            metricFields: found,
            dataPreview: JSON.stringify(result.data).substring(0, 300)
          });
        } else {
          console.log(`   ❌ 状态码 ${result.status}`);
          results.push({ api: api.name, status: 'error', code: result.status });
        }
      } catch (err) {
        console.log(`   ❌ 失败: ${err.message}`);
        results.push({ api: api.name, status: 'failed', error: err.message });
      }
    }
    
    await browser.disconnect();
    return { platform: platformKey, name: platform.name, status: 'ok', apis: results };
    
  } catch (err) {
    console.error(`❌ 连接失败: ${err.message}`);
    return { platform: platformKey, name: platform.name, status: 'connection_failed', error: err.message };
  }
}

async function main() {
  const results = [];
  
  for (const [key, platform] of Object.entries(PLATFORMS)) {
    const result = await testPlatform(key, platform);
    results.push(result);
    await new Promise(r => setTimeout(r, 2000));
  }
  
  // 保存结果
  const outputFile = '/tmp/remote-platform-api-test.json';
  fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
  
  console.log(`\n\n${'='.repeat(60)}`);
  console.log('📊 汇总结果');
  console.log(`${'='.repeat(60)}\n`);
  
  results.forEach(r => {
    console.log(`${r.name}:`);
    if (r.status === 'ok') {
      r.apis.forEach(api => {
        const emoji = api.hasMetrics ? '✅' : '⚠️';
        console.log(`  ${emoji} ${api.api}: ${api.hasMetrics ? '有完播率字段' : '只有基础数据'}`);
        if (api.metricFields && api.metricFields.length > 0) {
          console.log(`     → ${api.metricFields.join(', ')}`);
        }
      });
    } else {
      console.log(`  ❌ ${r.error || r.status}`);
    }
  });
  
  console.log(`\n结果保存: ${outputFile}\n`);
}

main().catch(console.error);
// 添加更多平台测试
