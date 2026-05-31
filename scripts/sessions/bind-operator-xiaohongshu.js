#!/usr/bin/env node
/**
 * 小红书运营员 Session 绑定 v9
 * - stealth 模式：隐藏 navigator.webdriver + 反检测脚本
 * - 等页面完全加载后找 QR
 */

import { createRequire } from 'module';
import fs from 'fs';
import https from 'https';

const { chromium } = createRequire(new URL('../../services/agent/', import.meta.url))('playwright');

const CREATOR_URL = 'https://creator.xiaohongshu.com/publish/publish';
const SESSION_COOKIES = ['web_session', 'galaxy_creator_session_info'];
const TIMEOUT_MS = 5 * 60 * 1000;
const POLL_MS = 1500;

// Stealth 脚本：隐藏 Playwright/automation 特征
const STEALTH_SCRIPT = `
  // 删除 navigator.webdriver
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  // 修复 plugins
  Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });
  Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN','zh','en-US','en'] });
  // 删除 $cdc_ 和 $wdc_ 属性
  delete window.$cdc_asdjflasutopfhvcZLmcfl_;
  delete window.$chrome_asyncScriptInfo;
  // 修复 permissions
  const originalQuery = window.navigator.permissions?.query;
  if (originalQuery) {
    window.navigator.permissions.query = (params) =>
      params.name === 'notifications' 
        ? Promise.resolve({ state: Notification.permission })
        : originalQuery(params);
  }
  // 修复 chrome runtime
  if (!window.chrome) window.chrome = {};
  if (!window.chrome.runtime) window.chrome.runtime = {};
`;

async function sendFeishuQrCard(buf) {
  const appId=process.env.FEISHU_APP_ID||'', appSecret=process.env.FEISHU_APP_SECRET||'';
  const webhook=process.env.ZENITHJOY_FEISHU_WEBHOOK||'';
  if(!appId||!appSecret||!webhook){console.log('[飞书] 未配置');return;}
  try {
    const {app_access_token:token}=await(await fetch('https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal',
      {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({app_id:appId,app_secret:appSecret})})).json();
    const form=new FormData();
    form.append('image_type','message');
    form.append('image',new Blob([buf],{type:'image/png'}),'qr.png');
    const {data:{image_key}}=await(await fetch('https://open.feishu.cn/open-apis/im/v1/images',
      {method:'POST',headers:{Authorization:`Bearer ${token}`},body:form})).json();
    await fetch(webhook,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({msg_type:'interactive',card:{
        header:{title:{tag:'plain_text',content:'🔑 小红书扫码绑定'},template:'red'},
        elements:[{tag:'img',img_key:image_key,alt:{tag:'plain_text',content:'QR'}},
          {tag:'div',text:{tag:'plain_text',content:'请在 3 分钟内扫码登录小红书创作者中心'}}],
      }})});
    console.log('[飞书] ✅ QR 卡片已发送');
  } catch(e){console.warn('[飞书] 失败:',e.message);}
}

async function sendFeishuText(text) {
  const webhook=process.env.ZENITHJOY_FEISHU_WEBHOOK||''; if(!webhook) return;
  const p=JSON.stringify({msg_type:'text',content:{text}});
  return new Promise(r=>{const u=new URL(webhook);
    const req=https.request({hostname:u.hostname,path:u.pathname+u.search,method:'POST',
      headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(p)}},
      res=>{res.resume();r();}); req.on('error',()=>r()); req.write(p); req.end();});
}

async function findQrAndSend(page) {
  // 检查页面内容：dump 关键文字
  const pageText = await page.evaluate(()=>document.body.innerText?.slice(0,500)||'').catch(()=>'');
  const hasQrTab = pageText.includes('扫码') || pageText.includes('二维码') || pageText.includes('scan');
  console.log('[page-text] 含扫码词:', hasQrTab, '| 前150字:', pageText.slice(0,150).replace(/\n/g,' '));

  // 找 QR 元素（canvas 或 img，正方形，80-400px）
  const QR_SELS=['[class*="qrcode"] canvas','[class*="qr-code"] canvas','[class*="qrCode"] canvas',
    '[class*="scanCode"] canvas','canvas[class*="qr"]','[class*="qrcode"] img','[class*="qr-code"] img',
    'img[src*="qrcode"]','img[src*="qr_"]','[class*="login"] canvas','canvas'];
  for(const sel of QR_SELS){
    try {
      for(const el of await page.$$(sel)){
        const box=await el.boundingBox().catch(()=>null);
        if(!box||box.width<80||box.width>400||box.height<80) continue;
        const tag=await el.evaluate(e=>e.tagName.toLowerCase()).catch(()=>'');
        const ok=tag!=='img'||await el.evaluate(e=>e.complete&&e.naturalWidth>0).catch(()=>true);
        if(ok){console.log(`[QR] 匹配 "${sel}" ${Math.round(box.width)}x${Math.round(box.height)}`);return el;}
      }
    } catch{/**/}
  }

  // 如果有扫码文字但找不到 QR 元素，截全页
  if(hasQrTab) {
    console.log('[info] 有扫码入口，但 QR 元素未找到');
    await sendFeishuText('⚠️ 小红书 QR：页面含扫码词但 QR 元素未识别，请查看 artifact 截图');
  }
  return null;
}

async function main() {
  let browser;
  try {
    browser = await chromium.launch({
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',  // 关键：隐藏自动化特征
        '--disable-infobars',
        '--window-size=1440,900',
      ],
    });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: {width:1440, height:900},
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
    });

    // 注入 stealth 脚本（每次新页面都执行）
    await context.addInitScript(STEALTH_SCRIPT);

    const page = await context.newPage();

    console.log('[info] 导航（stealth 模式）...');
    await page.goto(CREATOR_URL, {waitUntil:'domcontentloaded', timeout:30000}).catch(()=>{});
    await page.waitForTimeout(5000);
    await page.screenshot({path:'stage1-stealth.png'});

    let qrEl = await findQrAndSend(page);

    // 如果还没有 QR：检查是否有"扫码"入口可以点击
    if(!qrEl) {
      // 找包含"扫码"的可点击元素
      const scanEls = await page.evaluate(()=>{
        const all=[...document.querySelectorAll('*')];
        return all.filter(el=>{
          const txt=el.textContent?.trim()||'';
          const r=el.getBoundingClientRect();
          return (txt.includes('扫码')||txt.includes('二维码'))&&r.width>0&&r.height>0&&r.width<200;
        }).slice(0,5).map(el=>{
          const r=el.getBoundingClientRect();
          return {tag:el.tagName.toLowerCase(),txt:el.textContent?.trim()?.slice(0,30),
            cls:el.className?.toString()?.slice(0,60),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};
        });
      });
      console.log('[scan-els]', JSON.stringify(scanEls));

      for(const el of scanEls) {
        if(qrEl) break;
        console.log(`[click] 扫码入口 "${el.txt}" (${el.x+el.w/2},${el.y+el.h/2})`);
        await page.mouse.click(el.x+el.w/2, el.y+el.h/2);
        await page.waitForTimeout(3000);
        await page.screenshot({path:'stage2-after-scan-click.png'});
        qrEl = await findQrAndSend(page);
      }
    }

    // 兜底截图
    if(!qrEl) {
      await page.screenshot({path:'xiaohongshu-qr.png'});
      console.log('[warn] stealth 后仍未找到 QR');
      await sendFeishuText('⚠️ 小红书 QR（stealth v9）：仍未识别 QR 元素，请查看 stage1-stealth.png');
    } else {
      const buf=await qrEl.screenshot({type:'png'});
      fs.writeFileSync('xiaohongshu-qr.png',buf);
      await sendFeishuQrCard(buf);
    }

    // 轮询 cookie
    console.log('[info] 等待扫码...');
    const start=Date.now(); let success=false;
    while(Date.now()-start<TIMEOUT_MS) {
      const st=await context.storageState().catch(()=>null);
      if(st){
        const cookies=st.cookies||[];
        if(cookies.some(c=>SESSION_COOKIES.includes(c.name)&&c.value)){success=true;break;}
        const n=Math.floor((Date.now()-start)/POLL_MS);
        if(n%20===1){const f=cookies.filter(c=>SESSION_COOKIES.includes(c.name)).map(c=>c.name);
          console.log(`[poll] ${Math.round((Date.now()-start)/1000)}s | ${cookies.length}cookie | found:[${f}]`);}
      }
      await page.waitForTimeout(POLL_MS);
    }
    if(!success){
      await page.screenshot({path:'xiaohongshu-bind-timeout.png'}).catch(()=>{});
      await sendFeishuText('🔴 小红书 Session 绑定超时');
      console.error('[FAIL] 超时'); process.exit(1);
    }
    const st=await context.storageState();
    const found=(st.cookies||[]).filter(c=>SESSION_COOKIES.includes(c.name)).map(c=>c.name);
    console.log(`[info] ✅ [${found.join(', ')}]`);
    fs.writeFileSync('xiaohongshu-session.json',JSON.stringify(st,null,2));
    await page.screenshot({path:'xiaohongshu-bind-success.png'}).catch(()=>{});
    await sendFeishuText(`✅ 小红书 Session 绑定成功！[${found.join(', ')}]`);
    console.log('PASS');
  } finally {await browser?.close().catch(()=>{});}
}

main().catch(async e=>{
  console.error('[FAIL]',e.message);
  await sendFeishuText('🔴 小红书异常: '+e.message.slice(0,200)).catch(()=>{});
  process.exit(1);
});
