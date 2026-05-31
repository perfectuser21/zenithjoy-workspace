#!/usr/bin/env node
/**
 * 小红书运营员 Session 绑定 v7
 * - 细网格点击 form 右上角 (1160-1195, 270-300) 找粉色 QR 图标
 * - 输出每个点的 element 信息
 */

import { createRequire } from 'module';
import fs from 'fs';
import https from 'https';

const { chromium } = createRequire(new URL('../../services/agent/', import.meta.url))('playwright');

const CREATOR_URL = 'https://creator.xiaohongshu.com/publish/publish';
const SESSION_COOKIES = ['web_session', 'galaxy_creator_session_info'];
const TIMEOUT_MS = 5 * 60 * 1000;
const POLL_MS = 1500;

async function sendFeishuQrCard(buf) {
  const appId = process.env.FEISHU_APP_ID||'', appSecret = process.env.FEISHU_APP_SECRET||'';
  const webhook = process.env.ZENITHJOY_FEISHU_WEBHOOK||'';
  if (!appId||!appSecret||!webhook) { console.log('[飞书] 未配置'); return; }
  try {
    const {app_access_token:token} = await (await fetch('https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal',
      {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({app_id:appId,app_secret:appSecret})})).json();
    const form=new FormData(); form.append('image_type','message'); form.append('image',new Blob([buf],{type:'image/png'}),'qr.png');
    const {data:{image_key}} = await (await fetch('https://open.feishu.cn/open-apis/im/v1/images',
      {method:'POST',headers:{Authorization:`Bearer ${token}`},body:form})).json();
    await fetch(webhook,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({msg_type:'interactive',card:{
        header:{title:{tag:'plain_text',content:'🔑 小红书扫码绑定'},template:'red'},
        elements:[{tag:'img',img_key:image_key,alt:{tag:'plain_text',content:'QR'}},
          {tag:'div',text:{tag:'plain_text',content:'请在 3 分钟内扫码登录小红书创作者中心'}}],
      }})});
    console.log('[飞书] ✅ QR 发送成功');
  } catch(e){console.warn('[飞书] 失败:',e.message);}
}

async function sendFeishuText(text) {
  const webhook=process.env.ZENITHJOY_FEISHU_WEBHOOK||''; if(!webhook) return;
  const payload=JSON.stringify({msg_type:'text',content:{text}});
  return new Promise(r=>{const u=new URL(webhook);const req=https.request({hostname:u.hostname,path:u.pathname+u.search,method:'POST',
    headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}},res=>{res.resume();r();});
    req.on('error',()=>r());req.write(payload);req.end();});
}

async function findQrElement(page) {
  const sels=['[class*="qrcode"] canvas','[class*="qr-code"] canvas','[class*="qrCode"] canvas',
    '[class*="scanCode"] canvas','canvas[class*="qr"]','[class*="qrcode"] img','[class*="qr-code"] img',
    'img[src*="qrcode"]','img[src*="qr_"]','[class*="login"] canvas','canvas'];
  for (const sel of sels) {
    try {
      for (const el of await page.$$(sel)) {
        const box=await el.boundingBox().catch(()=>null);
        if(!box||box.width<80||box.width>400||box.height<80) continue;
        const tag=await el.evaluate(e=>e.tagName.toLowerCase()).catch(()=>'');
        const ok=tag!=='img'||await el.evaluate(e=>e.complete&&e.naturalWidth>0).catch(()=>true);
        if(ok){console.log(`[QR] 匹配 "${sel}" ${Math.round(box.width)}x${Math.round(box.height)}`);return el;}
      }
    } catch{/**/}
  }
  return null;
}

async function main() {
  let browser;
  try {
    browser = await chromium.launch({headless:false,args:['--no-sandbox','--disable-setuid-sandbox']});
    const context = await browser.newContext({
      userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
      viewport:{width:1440,height:900},
    });
    const page = await context.newPage();

    console.log('[info] 导航...');
    await page.goto(CREATOR_URL,{waitUntil:'domcontentloaded',timeout:30000}).catch(()=>{});
    await page.waitForTimeout(5000);
    await page.screenshot({path:'stage1-initial.png'});

    // 探查 form 右上角粉色图标区域：细网格 (1155-1200, 265-305)
    const cornerProbe = await page.evaluate(()=>{
      const results=[];
      for(let x=1155;x<=1200;x+=5){
        for(let y=265;y<=305;y+=5){
          const el=document.elementFromPoint(x,y);
          if(!el) continue;
          const r=el.getBoundingClientRect();
          const style=window.getComputedStyle(el);
          results.push({x,y,tag:el.tagName.toLowerCase(),
            cls:el.className?.toString()?.slice(0,80)||'',
            bg:style.backgroundColor, cursor:style.cursor,
            w:Math.round(r.width),h:Math.round(r.height)});
        }
      }
      // 去重
      const seen=new Set();
      return results.filter(p=>{const k=`${p.tag}|${p.cls}`;if(seen.has(k))return false;seen.add(k);return true;});
    });
    console.log(`[corner-probe] form右上角区域元素 (${cornerProbe.length}个):`);
    cornerProbe.forEach(p=>console.log(`  ${p.tag} (${p.x},${p.y}) ${p.w}x${p.h} cursor=${p.cursor} bg=${p.bg} cls=${p.cls}`));

    // 依次点击所有在右上角区域的不同元素
    let qrEl=null, stageN=2;
    for(const p of cornerProbe) {
      if(qrEl) break;
      console.log(`[click] corner (${p.x},${p.y}) ${p.tag} cls=${p.cls}`);
      await page.mouse.click(p.x, p.y);
      await page.waitForTimeout(2000);
      await page.screenshot({path:`stage${stageN}-corner.png`});
      stageN++;
      qrEl = await findQrElement(page);
      if(qrEl) {console.log('[info] ✅ QR 出现！'); break;}
    }

    // 还没找到：探查整个 form 内的 tab 容器（找短信登录的兄弟节点）
    if(!qrEl) {
      console.log('[info] 查找 tab 容器兄弟节点...');
      const tabInfo = await page.evaluate(()=>{
        // 找包含"短信登录"的 tab 元素的父容器
        const allEls=[...document.querySelectorAll('*')];
        for(const el of allEls){
          if(el.textContent?.trim()==='短信登录' && el.children.length===0){
            const parent=el.parentElement?.parentElement;
            if(!parent) continue;
            const children=[...parent.children];
            if(children.length>=2){
              return children.map(c=>{
                const r=c.getBoundingClientRect();
                return {tag:c.tagName.toLowerCase(),txt:c.textContent?.trim()?.slice(0,40),
                  cls:c.className?.toString()?.slice(0,60),
                  x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};
              });
            }
          }
        }
        return [];
      });
      console.log('[tab-siblings]', JSON.stringify(tabInfo, null, 2));

      // 点击非"短信登录"的兄弟
      for(const sib of tabInfo) {
        if(qrEl) break;
        if(sib.txt==='短信登录') continue;
        if(sib.w<=0||sib.h<=0) continue;
        const cx=sib.x+sib.w/2, cy=sib.y+sib.h/2;
        console.log(`[click] tab-sibling "${sib.txt}" (${Math.round(cx)},${Math.round(cy)})`);
        await page.mouse.click(cx, cy);
        await page.waitForTimeout(2500);
        await page.screenshot({path:`stage${stageN}-tab.png`}); stageN++;
        qrEl = await findQrElement(page);
        if(qrEl){console.log('[info] ✅ QR 出现！');break;}
      }
    }

    // 兜底：/login URL
    if(!qrEl){
      await page.goto('https://creator.xiaohongshu.com/login',{waitUntil:'domcontentloaded',timeout:15000}).catch(()=>{});
      await page.waitForTimeout(5000);
      await page.screenshot({path:`stage${stageN}-login.png`}); stageN++;
      qrEl = await findQrElement(page);
    }

    let qrBuf=null;
    if(qrEl){
      qrBuf=await qrEl.screenshot({type:'png'});
      fs.writeFileSync('xiaohongshu-qr.png',qrBuf);
      await sendFeishuQrCard(qrBuf);
    } else {
      await page.screenshot({path:'xiaohongshu-qr.png'});
      console.log('[warn] 仍未找到 QR，全页截图');
      await sendFeishuText('⚠️ 小红书 QR 绑定：仍未识别 QR 元素，请查看 artifact stage 截图');
    }

    // 轮询
    console.log('[info] 等待扫码...');
    const start=Date.now(); let success=false;
    while(Date.now()-start<TIMEOUT_MS){
      const st=await context.storageState().catch(()=>null);
      if(st){
        const cookies=st.cookies||[];
        if(cookies.some(c=>SESSION_COOKIES.includes(c.name)&&c.value)){success=true;break;}
        const n=Math.floor((Date.now()-start)/POLL_MS);
        if(n%20===1){const f=cookies.filter(c=>SESSION_COOKIES.includes(c.name)).map(c=>c.name);
          console.log(`[poll] ${Math.round((Date.now()-start)/1000)}s | ${cookies.length}cookie | found:[${f.join(',')}]`);}
      }
      await page.waitForTimeout(POLL_MS);
    }

    if(!success){
      await page.screenshot({path:'xiaohongshu-bind-timeout.png'}).catch(()=>{});
      await sendFeishuText('🔴 小红书 Session 绑定超时');
      console.error('[FAIL] 超时'); process.exit(1);
    }

    const storageState=await context.storageState();
    const found=(storageState.cookies||[]).filter(c=>SESSION_COOKIES.includes(c.name)).map(c=>c.name);
    console.log(`[info] ✅ 登录成功: [${found.join(', ')}]`);
    fs.writeFileSync('xiaohongshu-session.json',JSON.stringify(storageState,null,2));
    await page.screenshot({path:'xiaohongshu-bind-success.png'}).catch(()=>{});
    await sendFeishuText(`✅ 小红书 Session 绑定成功！[${found.join(', ')}]`);
    console.log('PASS');

  } finally {
    await browser?.close().catch(()=>{});
  }
}

main().catch(async e=>{
  console.error('[FAIL]',e.message);
  await sendFeishuText('🔴 小红书异常: '+e.message.slice(0,200)).catch(()=>{});
  process.exit(1);
});
