#!/usr/bin/env node
const puppeteer = require('puppeteer-core');
const fs = require('fs');

const REMOTE_HOST = '100.97.242.124';

const PLATFORMS = [
  {
    name: '快手',
    port: 19223,
    test: async (page) => {
      const result = await page.evaluate(async () => {
        const resp = await fetch('https://cp.kuaishou.com/rest/cp/creator/analysis/pc/home/photo/list', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ page: 0, count: 5 })
        });
        const data = await resp.json();
        
        // 提取第一条数据的所有字段
        if (data.data && data.data.photoList && data.data.photoList[0]) {
          const item = data.data.photoList[0];
          return {
            success: true,
            fields: Object.keys(item),
            sample: item
          };
        }
        return { success: false, data };
      });
      return result;
    }
  },
  {
    name: '小红书',
    port: 19224,
    test: async (page) => {
      const result = await page.evaluate(async () => {
        const resp = await fetch('https://creator.xiaohongshu.com/api/galaxy/creator/data/note', {
          credentials: 'include'
        });
        const data = await resp.json();
        return { success: data.success, data };
      });
      return result;
    }
  },
  {
    name: '头条',
    port: 19225,
    test: async (page) => {
      // 头条需要先导航到数据页面
      await page.goto('https://mp.toutiao.com/profile_v4/graphic/articles', { waitUntil: 'networkidle2' });
      await new Promise(r => setTimeout(r, 3000));
      
      const result = await page.evaluate(async () => {
        // 尝试找数据 API
        const text = document.body.innerText;
        return { success: text.includes('阅读'), preview: text.substring(0, 200) };
      });
      return result;
    }
  },
  {
    name: '微博',
    port: 19227,
    test: async (page) => {
      const result = await page.evaluate(async () => {
        const text = document.body.innerText;
        return { success: text.includes('数据'), preview: text.substring(0, 200) };
      });
      return result;
    }
  }
];

async function testPlatform(platform) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📱 ${platform.name} (端口 ${platform.port})`);
  console.log(`${'='.repeat(60)}`);
  
  try {
    const browser = await puppeteer.connect({
      browserURL: `http://${REMOTE_HOST}:${platform.port}`,
      defaultViewport: null
    });
    
    const pages = await browser.pages();
    const page = pages[0] || await browser.newPage();
    
    console.log(`✅ 已连接，当前页: ${page.url()}`);
    
    const result = await platform.test(page);
    
    console.log('结果:', JSON.stringify(result, null, 2).substring(0, 500));
    
    await browser.disconnect();
    return { platform: platform.name, result };
    
  } catch (err) {
    console.error(`❌ ${err.message}`);
    return { platform: platform.name, error: err.message };
  }
}

async function main() {
  const allResults = [];
  
  for (const platform of PLATFORMS) {
    const result = await testPlatform(platform);
    allResults.push(result);
    await new Promise(r => setTimeout(r, 1000));
  }
  
  fs.writeFileSync('/tmp/all-platforms-detail.json', JSON.stringify(allResults, null, 2));
  console.log('\n✅ 完成，结果保存到 /tmp/all-platforms-detail.json');
}

main().catch(console.error);
