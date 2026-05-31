#!/usr/bin/env node
/**
 * 小红书运营员 Session 绑定 v8
 * - elementsFromPoint（复数）找粉色图标所有层
 * - 把 sso-login-wrapper 完整 innerHTML dump 出来分析
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
  const appId=process.env.FEISHU_APP_ID||'',appSecret=process.env.FEISHU_APP_SECRET||'';
  const webhook=process.env.ZENITHJOY_FEISHU_WEBHOOK||'';
  if(!appId||!appSecret||!webhook){console.log('[飞书] 未配置');return;}
  try {
    const {app_access_token:token}=await(await fetch('https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal',
      {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({app_id:appId,app_secret:appSecret})})).json();
    const form=new FormData(); form.append('image_type','message'); form.append('image',new Blob([buf],{type:'image/png'}),'qr.png');
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
  const webhook=process.env.ZENITHJOY_FEISHU_WEBHOOK||''; if(!webhook)return;
  const p=JSON.stringify({msg_type:'text',content:{text}});
  return new Promise(r=>{const u=new URL(webhook);const req=https.request(
    {hostname:u.hostname,path:u.pathname+u.search,method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(p)}},
    res=>{res.resume();r();}); req.on('error',()=>r()); req.write(p); req.end();});
}

async function findQrElement(page) {
  // 扩大搜索范围：包含所有尺寸的 img/canvas，不过滤来源
  const allImages = await page.evaluate(()=>{
    const imgs=[...document.querySelectorAll('img,canvas')];
    return imgs.map(el=>{
      const r=el.getBoundingClientRect();
      return {tag:el.tagName.toLowerCase(),
        src:el.src||el.currentSrc||'',
        w:Math.round(r.width),h:Math.round(r.height),
        x:Math.round(r.x),y:Math.round(r.y),
        cls:el.className?.toString()?.slice(0,60)};
    }).filter(e=>e.w>50&&e.w<500&&e.h>50&&e.h<500&&e.w>0);
  });
  if(allImages.length>0){
    console.log(`[findQr] 找到 ${allImages.length} 个中等尺寸 img/canvas:`);
    allImages.forEach(e=>console.log(`  ${e.tag} (${e.x},${e.y}) ${e.w}x${e.h} src=${e.src.slice(0,60)} cls=${e.cls}`));
  }

  // 返回最方的那个（QR 应该是正方形）
  const square=allImages.filter(e=>Math.abs(e.w-e.h)<20&&e.w>80);
  if(square.length>0) {
    const best=square[0];
    console.log(`[findQr] 候选 QR: ${best.tag} (${best.x},${best.y}) ${best.w}x${best.h}`);
    const els=await page.$$(best.tag);
    for(const el of els){
      const box=await el.boundingBox().catch(()=>null);
      if(box&&Math.round(box.width)===best.w&&Math.round(box.height)===best.h&&
         Math.round(box.x)===best.x&&Math.round(box.y)===best.y){
        const tag=await el.evaluate(e=>e.tagName.toLowerCase()).catch(()=>'');
        const ok=tag!=='img'||await el.evaluate(e=>e.complete&&e.naturalWidth>0).catch(()=>true);
        if(ok){return el;}
      }
    }
  }
  return null;
}

async function main() {
  let browser;
  try {
    browser=await chromium.launch({headless:false,args:['--no-sandbox','--disable-setuid-sandbox']});
    const context=await browser.newContext({
      userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
      viewport:{width:1440,height:900},
    });
    const page=await context.newPage();

    console.log('[info] 导航...');
    await page.goto(CREATOR_URL,{waitUntil:'domcontentloaded',timeout:30000}).catch(()=>{});
    await page.waitForTimeout(5000);
    await page.screenshot({path:'stage1-initial.png'});

    // 1. dump sso-login-wrapper 的完整 HTML（找隐藏的 QR tab）
    const loginHtml=await page.evaluate(()=>{
      const el=document.querySelector('.sso-login-wrapper,.login-box-container,[class*="login-container"]');
      return el?el.outerHTML.slice(0,3000):'NOT FOUND';
    });
    // 截取关键部分：tab 相关
    const tabLines=loginHtml.split('\n').filter(l=>
      l.includes('tab')||l.includes('scan')||l.includes('qr')||l.includes('扫码')||l.includes('二维码')
    ).slice(0,10);
    console.log('[login-html] tab/qr 相关行:', tabLines.length>0?tabLines.join(' | '):'无');
    console.log('[login-html] 前200字:', loginHtml.slice(0,200));

    // 2. elementsFromPoint（复数）探查粉色图标坐标
    const layeredEls=await page.evaluate(()=>{
      const probePoints=[[1175,278],[1180,280],[1170,275],[1185,275],[1165,285]];
      const results=[];
      for(const [x,y] of probePoints){
        const els=document.elementsFromPoint(x,y);
        if(!els||!els.length) continue;
        const layer=els.slice(0,5).map(el=>{
          const r=el.getBoundingClientRect();
          const style=window.getComputedStyle(el);
          return {tag:el.tagName.toLowerCase(),
            cls:el.className?.toString()?.slice(0,60)||'',
            bg:style.backgroundImage?.slice(0,100)||'',
            cursor:style.cursor,
            w:Math.round(r.width),h:Math.round(r.height),
            zIndex:style.zIndex};
        });
        results.push({x,y,layer});
      }
      return results;
    });
    console.log('[layered-probe] elementsFromPoint 分层结果:');
    layeredEls.forEach(p=>{
      console.log(`  坐标(${p.x},${p.y}):`);
      p.layer.forEach((el,i)=>console.log(`    layer${i}: ${el.tag} z=${el.zIndex} cursor=${el.cursor} ${el.w}x${el.h} cls=${el.cls} bg=${el.bg.slice(0,60)}`));
    });

    // 3. 找有 backgroundImage 的小元素（QR图标可能是CSS background）
    const bgImgEls=await page.evaluate(()=>{
      const all=[...document.querySelectorAll('*')];
      return all.filter(el=>{
        const r=el.getBoundingClientRect();
        const s=window.getComputedStyle(el);
        return r.width>10&&r.width<80&&r.height>10&&r.height<80&&
          r.x>900&&r.y<400&&
          s.backgroundImage&&s.backgroundImage!=='none';
      }).slice(0,10).map(el=>{
        const r=el.getBoundingClientRect();
        const s=window.getComputedStyle(el);
        return {tag:el.tagName.toLowerCase(),cls:el.className?.toString()?.slice(0,60),
          x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),
          bg:s.backgroundImage.slice(0,100),cursor:s.cursor};
      });
    });
    if(bgImgEls.length>0){
      console.log(`[bg-probe] 有背景图的小元素 (${bgImgEls.length}个):`);
      bgImgEls.forEach(e=>console.log(`  ${e.tag} (${e.x},${e.y}) ${e.w}x${e.h} cursor=${e.cursor} bg=${e.bg}`));

      // 点击这些背景图元素（QR toggle 可能是这类）
      let stageN=2, qrEl=null;
      for(const el of bgImgEls){
        if(qrEl) break;
        console.log(`[click] bg-img (${el.x+el.w/2},${el.y+el.h/2}) ${el.tag} cls=${el.cls}`);
        await page.mouse.click(el.x+el.w/2, el.y+el.h/2);
        await page.waitForTimeout(2500);
        await page.screenshot({path:`stage${stageN}-bgclick.png`}); stageN++;
        qrEl=await findQrElement(page);
        if(qrEl){console.log('[info] ✅ QR 出现！');break;}
      }
    }

    let qrEl=await findQrElement(page);

    if(!qrEl){
      await page.screenshot({path:'xiaohongshu-qr.png'});
      console.log('[warn] 未找到 QR');
      await sendFeishuText('⚠️ 小红书 QR：请查看 artifact 中 stage*.png 截图，分层 probe 结果已在日志中，确认 QR 图标位置');
    } else {
      const buf=await qrEl.screenshot({type:'png'});
      fs.writeFileSync('xiaohongshu-qr.png',buf);
      await sendFeishuQrCard(buf);
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
          console.log(`[poll] ${Math.round((Date.now()-start)/1000)}s | ${cookies.length}cookie | found:[${f}]`);}
      }
      await page.waitForTimeout(POLL_MS);
    }
    if(!success){
      await page.screenshot({path:'xiaohongshu-bind-timeout.png'}).catch(()=>{});
      await sendFeishuText('🔴 小红书 Session 绑定超时'); console.error('[FAIL] 超时'); process.exit(1);
    }
    const st=await context.storageState();
    const found=(st.cookies||[]).filter(c=>SESSION_COOKIES.includes(c.name)).map(c=>c.name);
    console.log(`[info] ✅ [${found.join(', ')}]`);
    fs.writeFileSync('xiaohongshu-session.json',JSON.stringify(st,null,2));
    await page.screenshot({path:'xiaohongshu-bind-success.png'}).catch(()=>{});
    await sendFeishuText(`✅ 小红书 Session 绑定成功！[${found.join(', ')}]`);
    console.log('PASS');
  } finally { await browser?.close().catch(()=>{}); }
}

main().catch(async e=>{
  console.error('[FAIL]',e.message);
  await sendFeishuText('🔴 小红书异常: '+e.message.slice(0,200)).catch(()=>{});
  process.exit(1);
});
