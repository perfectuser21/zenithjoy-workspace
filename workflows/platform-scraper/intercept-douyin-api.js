#!/usr/bin/env node
const puppeteer = require('puppeteer');
const fs = require('fs');

const OUTPUT_FILE = '/tmp/douyin-api-captured.json';
const capturedAPIs = [];

async function main() {
  console.log('🚀 启动浏览器...');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080']
  });

  const page = await browser.newPage();

  page.on('response', async (response) => {
    const url = response.url();

    if (url.includes('creator.douyin.com') &&
        (url.includes('/aweme/') || url.includes('/api/') || url.includes('/data/'))) {
      try {
        const contentType = response.headers()['content-type'] || '';
        if (contentType.includes('application/json')) {
          const data = await response.json();
          capturedAPIs.push({
            timestamp: new Date().toISOString(),
            url: url,
            method: response.request().method(),
            status: response.status(),
            data: data
          });

          console.log(`\n📡 捕获: ${url}`);
          if (data.data && Array.isArray(data.data) && data.data[0]) {
            console.log(`   字段: ${Object.keys(data.data[0]).slice(0,10).join(', ')}`);
          }
        }
      } catch (err) {}
    }
  });

  console.log('\n📱 导航到抖音创作者中心...');
  await page.goto('https://creator.douyin.com/creator-micro/content/manage', {
    waitUntil: 'networkidle2',
    timeout: 60000
  });

  console.log('\n⏳ 等待加载...');
  await new Promise(r => setTimeout(r, 10000));

  console.log('\n📜 滚动加载...');
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise(r => setTimeout(r, 2000));
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(capturedAPIs, null, 2));
  console.log(`\n✅ 捕获了 ${capturedAPIs.length} 个 API`);
  console.log(`   文件: ${OUTPUT_FILE}`);

  await new Promise(r => setTimeout(r, 10000));
  await browser.close();
}

main().catch(console.error);
