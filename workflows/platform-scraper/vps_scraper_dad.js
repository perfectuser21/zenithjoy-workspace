/**
 * 爸爸公司 - VPS 端采集脚本 v2
 * 5个平台：抖音、视频号、快手、小红书、B站
 * Windows IP: 100.121.181.100
 */

const puppeteer = require('puppeteer-core');
const http = require('http');

const WINDOWS_IP = '100.121.181.100';

const PLATFORMS = {
  'douyin': { name: '抖音', cdpPort: 9222, dataUrl: 'https://creator.douyin.com/creator-micro/content/manage', extract: extractDouyin },
  'shipinhao': { name: '视频号', cdpPort: 9223, dataUrl: 'https://channels.weixin.qq.com/platform/post/list', extract: extractShipinhao },
  'kuaishou': { name: '快手', cdpPort: 9224, dataUrl: 'https://cp.kuaishou.com/article/manage/video', extract: extractKuaishou },
  'xiaohongshu': { name: '小红书', cdpPort: 9225, dataUrl: 'https://creator.xiaohongshu.com/new/note-manager', extract: extractXiaohongshu },
  'bilibili': { name: 'B站', cdpPort: 9226, dataUrl: 'https://member.bilibili.com/platform/upload-manager/article', extract: extractBilibili }
};

async function scrollToLoadMore(page, maxScrolls, scrollDelay) {
  let prevHeight = 0, count = 0;
  while (count < maxScrolls) {
    const h = await page.evaluate(() => document.body.scrollHeight);
    if (h === prevHeight) break;
    prevHeight = h;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise(r => setTimeout(r, scrollDelay));
    count++;
  }
  return count;
}

function isWithinDays(d, days) { 
  if (!d) return false;
  const diff = (Date.now() - d.getTime()) / (1000*60*60*24);
  return diff <= days && diff >= 0; 
}

// ============ 抖音 ============
async function extractDouyin(page) {
  await new Promise(r => setTimeout(r, 3000));
  await scrollToLoadMore(page, 30, 1000);
  
  const raw = await page.evaluate(() => {
    const items = [], lines = document.body.innerText.split('\n').map(l=>l.trim()).filter(l=>l);
    for (let i = 0; i < lines.length; i++) {
      const dm = lines[i].match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})/);
      if (!dm) continue;
      let title = '';
      for (let j = i-1; j >= Math.max(0,i-10); j--) if (lines[j] && lines[j].length > 10 && !lines[j].includes('编辑')) { title = lines[j].substring(0,150); break; }
      const mt = {views:0,likes:0,comments:0};
      for (let j = i+1; j < Math.min(lines.length, i+15); j++) {
        if (lines[j]==='播放' && lines[j+1]?.match(/^[\d,]+$/)) mt.views = parseInt(lines[j+1].replace(/,/g,''))||0;
        if (lines[j]==='点赞' && lines[j+1]?.match(/^[\d,]+$/)) mt.likes = parseInt(lines[j+1].replace(/,/g,''))||0;
        if (lines[j]==='评论' && lines[j+1]?.match(/^[\d,]+$/)) mt.comments = parseInt(lines[j+1].replace(/,/g,''))||0;
      }
      if (title) items.push({platform:'douyin',content_type:'视频',title,dateStr:dm[1]+'-'+dm[2].padStart(2,'0')+'-'+dm[3].padStart(2,'0')+'T'+dm[4].padStart(2,'0')+':'+dm[5]+':00',...mt,shares:0,favorites:0});
    }
    return items;
  });
  
  const seen = new Set();
  const items = raw.filter(it => { 
    if(seen.has(it.title)) return false; 
    seen.add(it.title); 
    const d = new Date(it.dateStr+'+08:00'); 
    it.publish_time = d.toISOString(); 
    delete it.dateStr; 
    return isWithinDays(d, 30); 
  });
  return { items, count: items.length };
}

// ============ 视频号 ============
async function extractShipinhao(page) {
  console.error('[视频号] 等待页面加载...');
  await new Promise(r => setTimeout(r, 5000));
  await scrollToLoadMore(page, 20, 1500);
  
  const raw = await page.evaluate(() => {
    const items = [];
    const text = document.body.innerText;
    const lines = text.split('\n').map(l=>l.trim()).filter(l=>l);
    
    for (let i = 0; i < lines.length; i++) {
      // 匹配日期格式: 2025年12月25日 或 12月25日
      const dm = lines[i].match(/(\d{4})年(\d{1,2})月(\d{1,2})日/) || lines[i].match(/^(\d{1,2})月(\d{1,2})日$/);
      if (!dm) continue;
      
      let title = '';
      // 向上找标题
      for (let j = i-1; j >= Math.max(0, i-8); j--) {
        const line = lines[j];
        if (line && line.length > 5 && 
            !line.match(/^\d+$/) && 
            !line.match(/^\d{1,2}:\d{2}$/) &&
            !line.includes('已发布') &&
            !line.includes('编辑') &&
            !line.includes('删除')) {
          title = line.substring(0, 100);
          break;
        }
      }
      
      // 向下找数字指标
      const nums = [];
      for (let j = i+1; j < Math.min(lines.length, i+10); j++) {
        if (/^\d+$/.test(lines[j])) {
          nums.push(parseInt(lines[j]));
          if (nums.length >= 5) break;
        }
        if (lines[j].match(/\d{4}年\d{1,2}月\d{1,2}日/)) break;
      }
      
      if (title && title.length > 3) {
        const year = dm[1] && dm[1].length === 4 ? dm[1] : new Date().getFullYear().toString();
        const month = (dm[1] && dm[1].length === 4 ? dm[2] : dm[1]).padStart(2, '0');
        const day = (dm[1] && dm[1].length === 4 ? dm[3] : dm[2]).padStart(2, '0');
        
        items.push({
          platform: 'shipinhao',
          content_type: '视频',
          title,
          dateStr: year + '-' + month + '-' + day,
          views: nums[0] || 0,
          likes: nums[1] || 0,
          comments: nums[2] || 0,
          shares: nums[3] || 0,
          favorites: nums[4] || 0
        });
      }
    }
    return items;
  });
  
  const seen = new Set();
  const items = raw.filter(it => {
    if (seen.has(it.title)) return false;
    seen.add(it.title);
    const d = new Date(it.dateStr + 'T00:00:00+08:00');
    it.publish_time = d.toISOString();
    delete it.dateStr;
    return isWithinDays(d, 30);
  });
  
  return { items, count: items.length };
}

// ============ 快手 ============
async function extractKuaishou(page) {
  await new Promise(r => setTimeout(r, 3000));
  await scrollToLoadMore(page, 20, 1500);
  
  const raw = await page.evaluate(() => {
    const items = [];
    const text = document.body.innerText;
    const lines = text.split('\n').map(l=>l.trim()).filter(l=>l);
    
    for (let i = 0; i < lines.length; i++) {
      // 匹配日期: 2025-12-11 08:00
      const dm = lines[i].match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
      if (!dm) continue;
      
      // 检查是否是"已发布"状态
      let isPublished = false;
      for (let j = i-1; j >= Math.max(0, i-3); j--) {
        if (lines[j] === '已发布') { isPublished = true; break; }
      }
      if (!isPublished) continue;
      
      // 向上找标题
      let title = '';
      for (let j = i-1; j >= Math.max(0, i-10); j--) {
        const line = lines[j];
        if (line && line.length > 10 && 
            !line.match(/^\d+$/) &&
            !line.match(/^\d{2}:\d{2}$/) &&
            !line.includes('已发布') &&
            !line.includes('置顶') &&
            !line.includes('待发布')) {
          title = line.substring(0, 150);
          break;
        }
      }
      
      // 向下找指标 (播放、点赞、评论用图标，数字紧跟)
      const nums = [];
      for (let j = i+1; j < Math.min(lines.length, i+8); j++) {
        const line = lines[j];
        if (line.match(/^\d+$/)) {
          nums.push(parseInt(line));
        }
        if (line.match(/^\d{4}-\d{2}-\d{2}/)) break;
      }
      
      if (title) {
        items.push({
          platform: 'kuaishou',
          content_type: '视频',
          title,
          dateStr: dm[1] + '-' + dm[2] + '-' + dm[3] + 'T' + dm[4] + ':' + dm[5] + ':00',
          views: nums[0] || 0,
          likes: nums[1] || 0,
          comments: nums[2] || 0,
          shares: 0,
          favorites: 0
        });
      }
    }
    return items;
  });
  
  const seen = new Set();
  const items = raw.filter(it => {
    if (seen.has(it.title)) return false;
    seen.add(it.title);
    const d = new Date(it.dateStr + '+08:00');
    it.publish_time = d.toISOString();
    delete it.dateStr;
    return isWithinDays(d, 30);
  });
  
  return { items, count: items.length };
}

// ============ 小红书 ============
async function extractXiaohongshu(page) {
  await new Promise(r => setTimeout(r, 3000));
  await scrollToLoadMore(page, 20, 1500);
  
  const raw = await page.evaluate(() => {
    const items = [];
    const text = document.body.innerText;
    // 按"发布于"分割
    const parts = text.split(/(?=发布于\s*\d{4}年)/);
    
    parts.forEach((part, idx) => {
      const dm = part.match(/发布于\s*(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})/);
      if (!dm) return;
      
      // 标题在"发布于"之前
      const beforeDate = part.split(/发布于/)[0];
      const lines = beforeDate.split('\n').map(l=>l.trim()).filter(l=>l);
      
      let title = '';
      for (let j = lines.length - 1; j >= 0; j--) {
        const line = lines[j];
        if (line && line.length > 5 && 
            !line.match(/^\d+$/) &&
            !line.match(/^\d{2}:\d{2}$/) &&
            !line.includes('权限设置') &&
            !line.includes('编辑') &&
            !line.includes('删除')) {
          title = line.substring(0, 100);
          break;
        }
      }
      
      // 指标在日期后面，通常是5个连续数字
      const afterDate = part.split(/发布于.*?\d{2}:\d{2}/)[1] || '';
      const numLines = afterDate.split('\n').map(l=>l.trim()).filter(l=>l);
      const nums = [];
      for (const line of numLines) {
        if (/^\d+$/.test(line)) {
          nums.push(parseInt(line));
          if (nums.length >= 5) break;
        }
        if (line.includes('权限设置')) break;
      }
      
      if (title && title.length > 3) {
        items.push({
          platform: 'xiaohongshu',
          content_type: '图文',
          title,
          dateStr: dm[1] + '-' + dm[2].padStart(2,'0') + '-' + dm[3].padStart(2,'0') + 'T' + dm[4].padStart(2,'0') + ':' + dm[5] + ':00',
          views: nums[0] || 0,
          likes: nums[1] || 0,
          comments: nums[2] || 0,
          shares: nums[3] || 0,
          favorites: nums[4] || 0
        });
      }
    });
    return items;
  });
  
  const seen = new Set();
  const items = raw.filter(it => {
    if (seen.has(it.title)) return false;
    seen.add(it.title);
    const d = new Date(it.dateStr + '+08:00');
    it.publish_time = d.toISOString();
    delete it.dateStr;
    return isWithinDays(d, 30);
  });
  
  return { items, count: items.length };
}

// ============ B站 ============
async function extractBilibili(page) {
  await new Promise(r => setTimeout(r, 3000));
  await scrollToLoadMore(page, 15, 1500);
  
  const raw = await page.evaluate(() => {
    const items = [];
    const text = document.body.innerText;
    const lines = text.split('\n').map(l=>l.trim()).filter(l=>l);
    
    for (let i = 0; i < lines.length; i++) {
      // B站日期格式: 2025-01-09 12:00
      const dm = lines[i].match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
      if (!dm) continue;
      
      let title = '';
      for (let j = i-1; j >= Math.max(0, i-10); j--) {
        const line = lines[j];
        if (line && line.length > 5 && 
            !line.match(/^\d+$/) &&
            !line.match(/^\d{2}:\d{2}$/) &&
            !line.includes('编辑') &&
            !line.includes('删除') &&
            !line.includes('已通过')) {
          title = line.substring(0, 150);
          break;
        }
      }
      
      if (title && title.length > 3) {
        items.push({
          platform: 'bilibili',
          content_type: '视频',
          title,
          dateStr: dm[1] + '-' + dm[2] + '-' + dm[3] + 'T' + dm[4] + ':' + dm[5] + ':00',
          views: 0, likes: 0, comments: 0, shares: 0, favorites: 0
        });
      }
    }
    return items;
  });
  
  const seen = new Set();
  const items = raw.filter(it => {
    if (seen.has(it.title)) return false;
    seen.add(it.title);
    const d = new Date(it.dateStr + '+08:00');
    it.publish_time = d.toISOString();
    delete it.dateStr;
    return isWithinDays(d, 30);
  });
  
  return { items, count: items.length };
}

// ============ 主函数 ============
async function scrape(pid) {
  const p = PLATFORMS[pid];
  if (!p) { console.error('平台: ' + Object.keys(PLATFORMS).join(', ')); return null; }
  
  console.error('[' + p.name + '] 连接...');
  let ws;
  try {
    const res = await new Promise((ok, err) => 
      http.get('http://' + WINDOWS_IP + ':' + p.cdpPort + '/json/version', r => { 
        let d = ''; 
        r.on('data', c => d += c); 
        r.on('end', () => ok(JSON.parse(d))); 
      }).on('error', err)
    );
    ws = res.webSocketDebuggerUrl.replace('localhost', WINDOWS_IP);
  } catch(e) { 
    return { success: false, platform: p.name, error: '连接失败' }; 
  }
  
  try {
    const browser = await puppeteer.connect({ browserWSEndpoint: ws, defaultViewport: null });
    const pages = await browser.pages();
    const page = pages[0];
    
    if (p.dataUrl) { 
      console.error('[' + p.name + '] 导航到: ' + p.dataUrl); 
      await page.goto(p.dataUrl, { waitUntil: 'networkidle2', timeout: 60000 }); 
    }
    
    console.error('[' + p.name + '] 采集中...');
    const data = await p.extract(page);
    
    console.error('[' + p.name + '] 采集到 ' + data.count + ' 条');
    browser.disconnect();
    
    return { success: true, platform: p.name, ...data };
  } catch(e) { 
    console.error('[' + p.name + '] 错误: ' + e.message);
    return { success: false, platform: p.name, error: e.message }; 
  }
}

// CLI
const arg = process.argv[2];
if (arg && PLATFORMS[arg]) {
  scrape(arg).then(r => console.log(JSON.stringify(r, null, 2)));
} else if (arg === 'all') {
  (async () => {
    for (const p of Object.keys(PLATFORMS)) {
      const r = await scrape(p);
      console.error(p + ': ' + (r?.success ? '✓' : '✗') + ' ' + (r?.count || 0) + ' 条');
    }
  })();
} else {
  console.error('用法: node vps_scraper_dad.js <douyin|shipinhao|kuaishou|xiaohongshu|bilibili|all>');
}

module.exports = { scrape, PLATFORMS };
