/**
 * Content Service v5 - Multi-platform: Douyin + Xiaohongshu
 * - Detects content type: video vs 图文
 * - video -> download + Gemini transcription
 * - 图文 -> extract text (Douyin: CDP navigate; XHS: Jina reader)
 */

const http = require('http');
const https = require('https');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const FFMPEG_PATH = 'C:/automation/node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe';

function extractAudio(inputPath) {
  const outputPath = inputPath.replace(/\.[^.]+$/, '.mp3');
  execFileSync(FFMPEG_PATH, [
    '-i', inputPath, '-vn', '-acodec', 'libmp3lame',
    '-ar', '16000', '-ac', '1', '-b:a', '32k', '-y', outputPath
  ], { timeout: 120000 });
  return outputPath;
}

const PORT = 7788;
const LOG_FILE = 'C:/automation/v5-live.log';

function flog(msg) {
  const ts = new Date().toISOString().slice(11,23);
  try { require('fs').appendFileSync(LOG_FILE, ts + ' ' + msg + '\n'); } catch(_) {}
  console.log(ts, msg);
}
const RELAY_HOST = '38.23.47.81';
const RELAY_PORT = 7789;
const COOKIES_FILE = 'C:/automation/douyin_cookies.txt';
const TEMP_DIR = 'C:/automation/temp';
const CDP_HOST = '::1';
const CDP_PORT = 19222;
const CDP_XHS_HOST = '::1';
const CDP_XHS_PORT = 19223;

// ─── CDP primitives ────────────────────────────────────────────────────────

function cdpGetTabs() {
  return new Promise((resolve, reject) => {
    http.get({ hostname: CDP_HOST, port: CDP_PORT, path: '/json' }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    }).on('error', reject).setTimeout(5000, function(){ this.destroy(); reject(new Error('tab timeout')); });
  });
}

function cdpNewTab() {
  return new Promise((resolve, reject) => {
    // Chrome 110+ requires PUT for /json/new
    const req = http.request({ hostname: CDP_HOST, port: CDP_PORT, path: '/json/new?about:blank', method: 'PUT' }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    });
    req.on('error', e => {
      if (attempt < 3) { setTimeout(() => postCallback(callbackUrl, data, attempt+1).then(resolve, reject), 5000); }
      else reject(e);
    }); req.setTimeout(5000, () => { req.destroy(); reject(new Error('new tab timeout')); }); req.end();
  });
}

function cdpCloseTab(tabId) {
  return new Promise((resolve) => {
    http.get({ hostname: CDP_HOST, port: CDP_PORT, path: '/json/close/' + tabId }, res => {
      res.resume(); res.on('end', resolve);
    }).on('error', () => resolve()).setTimeout(5000, function(){ this.destroy(); resolve(); });
  });
}

function cdpNewXhsTab() {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: CDP_XHS_HOST, port: CDP_XHS_PORT, family: 6, path: '/json/new?about:blank', method: 'PUT' }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    });
    req.on('error', reject); req.setTimeout(5000, () => { req.destroy(); reject(new Error('xhs new tab t/o')); }); req.end();
  });
}

function cdpCloseXhsTab(tabId) {
  return new Promise((resolve) => {
    http.get({ hostname: CDP_XHS_HOST, port: CDP_XHS_PORT, family: 6, path: '/json/close/' + tabId }, res => {
      res.resume(); res.on('end', resolve);
    }).on('error', () => resolve()).setTimeout(5000, function(){ this.destroy(); resolve(); });
  });
}

function cdpGetXhsTabs() {
  return new Promise((resolve, reject) => {
    http.get({ hostname: CDP_XHS_HOST, port: CDP_XHS_PORT, family: 6, path: '/json' }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    }).on('error', reject).setTimeout(5000, function(){ this.destroy(); reject(new Error('xhs tabs t/o')); });
  });
}

async function connectToXhsTab(wsUrl) {
  // wsUrl from XHS Chrome: ws://[::1]:19223/devtools/page/...
  const wsPath = new URL(wsUrl).pathname;
  return new Promise((resolve, reject) => {
    const hs = 'GET ' + wsPath + ' HTTP/1.1\r\nHost: [::1]:' + CDP_XHS_PORT + '\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n';
    const sock = net.createConnection({ host: CDP_XHS_HOST, port: CDP_XHS_PORT, family: 6 });
    let upgraded = false, buf = Buffer.alloc(0), pending = new Map(), msgId = 0;
    const send = (method, params, tms) => new Promise((res, rej) => {
      tms = tms || 30000;
      const id = ++msgId;
      const timer = setTimeout(() => { if(pending.has(id)){pending.delete(id);rej(new Error('t/o:'+method));} }, tms);
      pending.set(id, {res, rej, timer});
      const msg = JSON.stringify({id, method, params: params||{}});
      const msgBuf = Buffer.from(msg);
      let hbuf;
      if (msgBuf.length < 126) { hbuf=Buffer.alloc(6); hbuf[0]=0x81; hbuf[1]=0x80|msgBuf.length; Buffer.from([0x37,0xfa,0x21,0x3d]).copy(hbuf,2); }
      else { hbuf=Buffer.alloc(8); hbuf[0]=0x81; hbuf[1]=0xFE; hbuf.writeUInt16BE(msgBuf.length,2); Buffer.from([0x37,0xfa,0x21,0x3d]).copy(hbuf,4); }
      const msk=hbuf.slice(hbuf.length-4), pay=Buffer.alloc(msgBuf.length);
      for(let i=0;i<msgBuf.length;i++) pay[i]=msgBuf[i]^msk[i%4];
      sock.write(Buffer.concat([hbuf,pay]));
    });
    send._close = () => sock.destroy();
    sock.on('connect', () => sock.write(hs));
    sock.on('data', chunk => {
      buf = Buffer.concat([buf,chunk]);
      if (!upgraded) { if (!buf.toString().includes('\r\n\r\n')) return; upgraded=true; buf=buf.slice(buf.indexOf('\r\n\r\n')+4); resolve(send); return; }
      while (buf.length >= 2) {
        let plen=buf[1]&0x7f, offset=2;
        if (plen===126) { if(buf.length<4) break; plen=buf.readUInt16BE(2); offset=4; }
        if (buf.length<offset+plen) break;
        const text=buf.slice(offset,offset+plen).toString('utf8'); buf=buf.slice(offset+plen);
        try { const d=JSON.parse(text); if(d.id&&pending.has(d.id)){const e=pending.get(d.id);pending.delete(d.id);clearTimeout(e.timer);if(d.error)e.rej(new Error(d.error.message));else if(d.result&&d.result.exceptionDetails)e.rej(new Error('JS:'+(d.result.exceptionDetails.exception&&d.result.exceptionDetails.exception.description||'?')));else e.res(d.result||{});} } catch(_) {}
      }
    });
    sock.on('error', reject);
    setTimeout(() => reject(new Error('xhs connect t/o')), 5000);
  });
}

function cdpConnect(wsPath) {
  return new Promise((resolve, reject) => {
    const hs = 'GET ' + wsPath + ' HTTP/1.1\r\nHost: [::1]:' + CDP_PORT + '\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n';
    const sock = net.createConnection({ host: CDP_HOST, port: CDP_PORT });
    let upgraded = false, buf = Buffer.alloc(0), pending = new Map(), msgId = 0;
    const send = (method, params, tms) => new Promise((res, rej) => {
      tms = tms || 30000;
      const id = ++msgId;
      const timer = setTimeout(() => { if(pending.has(id)){pending.delete(id);rej(new Error('t/o:'+method));} }, tms);
      pending.set(id, {res, rej, timer});
      const msg = JSON.stringify({id, method, params: params||{}});
      const msgBuf = Buffer.from(msg);
      let hbuf;
      if (msgBuf.length < 126) { hbuf=Buffer.alloc(6); hbuf[0]=0x81; hbuf[1]=0x80|msgBuf.length; Buffer.from([0x37,0xfa,0x21,0x3d]).copy(hbuf,2); }
      else { hbuf=Buffer.alloc(8); hbuf[0]=0x81; hbuf[1]=0xFE; hbuf.writeUInt16BE(msgBuf.length,2); Buffer.from([0x37,0xfa,0x21,0x3d]).copy(hbuf,4); }
      const msk=hbuf.slice(hbuf.length-4), pay=Buffer.alloc(msgBuf.length);
      for(let i=0;i<msgBuf.length;i++) pay[i]=msgBuf[i]^msk[i%4];
      sock.write(Buffer.concat([hbuf,pay]));
    });
    send._close = () => sock.destroy();
    sock.on('connect', () => sock.write(hs));
    sock.on('data', chunk => {
      buf = Buffer.concat([buf,chunk]);
      if (!upgraded) { if (!buf.toString().includes('\r\n\r\n')) return; upgraded=true; buf=buf.slice(buf.indexOf('\r\n\r\n')+4); resolve(send); return; }
      while (buf.length >= 2) {
        let plen=buf[1]&0x7f, offset=2;
        if (plen===126) { if(buf.length<4) break; plen=buf.readUInt16BE(2); offset=4; }
        if (plen===127) { if(buf.length<10) break; plen=Number(buf.readBigUInt64BE(2)); offset=10; }
        if (buf.length<offset+plen) break;
        const text=buf.slice(offset,offset+plen).toString('utf8'); buf=buf.slice(offset+plen);
        try { const d=JSON.parse(text); if(d.id&&pending.has(d.id)){const e=pending.get(d.id);pending.delete(d.id);clearTimeout(e.timer);if(d.error)e.rej(new Error(d.error.message));else if(d.result&&d.result.exceptionDetails)e.rej(new Error('JS:'+(d.result.exceptionDetails.exception&&d.result.exceptionDetails.exception.description||'?')));else e.res(d.result||{});} } catch(_) {}
      }
    });
    sock.on('error', reject);
    setTimeout(() => reject(new Error('connect t/o')), 5000);
  });
}

async function connectToTab(wsUrl) {
  const wsPath = new URL(wsUrl).pathname;
  return cdpConnect(wsPath);
}

// ─── Douyin: video detail via CDP ─────────────────────────────────────────

async function ensureDouyinTabActive(send) {
  // Try a quick ping; navigate to Douyin if tab is crashed
  try {
    const r = await send('Runtime.evaluate', { expression: '1', returnByValue: true }, 3000);
    return; // tab is fine
  } catch(e) {
    if (e.message.includes('t/o') || e.message.includes('crashed')) {
      console.log('[CDP] Tab unresponsive, navigating to Douyin...');
      await send('Page.navigate', { url: 'https://www.douyin.com/jingxuan' }, 15000);
      await new Promise(r => setTimeout(r, 4000));
    }
  }
}

async function getDouyinVideoDetail(videoId) {
  const tabs = await cdpGetTabs();
  const page = tabs.find(t => t.type === 'page' && t.url.includes('douyin.com'));
  if (!page) throw new Error('No Douyin tab');
  const send = await connectToTab(page.webSocketDebuggerUrl);
  try {
    await ensureDouyinTabActive(send);
    const result = await send('Runtime.evaluate', {
      expression: 'new Promise((resolve,reject)=>{fetch(\'https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=' + videoId + '&aid=6383&channel=channel_pc_web&device_platform=webapp&cookie_enabled=true\',{credentials:\'include\'}).then(r=>r.json()).then(data=>{if(!data.aweme_detail){reject(new Error(\'no aweme_detail\'));return;}const v=data.aweme_detail.video;const audioUrl=(v.play_addr&&v.play_addr.url_list&&v.play_addr.url_list[0]);resolve(JSON.stringify({audioUrl,title:data.aweme_detail.desc||\'\',duration:data.aweme_detail.duration||0}));}).catch(e=>reject(e));});',
      returnByValue: true, awaitPromise: true, timeout: 15000
    }, 20000);
    send._close();
    const val = result.result && result.result.value;
    if (!val) throw new Error('Empty CDP result');
    return JSON.parse(val);
  } catch(e) { send._close(); throw e; }
}

// ─── Douyin: 图文 content via CDP new tab ─────────────────────────────────

async function getDouyinNoteContent(noteUrl) {
  let tab = null;
  let send = null;
  try {
    tab = await cdpNewTab();
    send = await connectToTab(tab.webSocketDebuggerUrl);
    await send('Page.navigate', { url: noteUrl }, 10000);
    await new Promise(r => setTimeout(r, 5000));
    const result = await send('Runtime.evaluate', {
      expression: `(function(){
        // Try Douyin note specific selectors
        const titleEl = document.querySelector('[class*="note-title"]') ||
                        document.querySelector('[class*="title"]') ||
                        document.querySelector('h1');
        const descEl = document.querySelector('[class*="desc"]') ||
                       document.querySelector('[class*="content"]') ||
                       document.querySelector('[class*="text"]');
        const title = titleEl ? titleEl.innerText.trim().slice(0,200) : document.title.slice(0,200);
        const text = descEl ? descEl.innerText.trim().slice(0,5000) : '';
        const imgEls = document.querySelectorAll('img[src*="aweme"]');
        const images = Array.from(imgEls).map(el=>el.src).slice(0,10);
        return JSON.stringify({title, text, images, url: location.href});
      })()`,
      returnByValue: true, timeout: 10000
    });
    send._close();
    await cdpCloseXhsTab(tab.id);
    const val = result.result && result.result.value;
    if (!val) throw new Error('Empty note content');
    return JSON.parse(val);
  } catch(e) {
    if (send) try { send._close(); } catch(_) {}
    if (tab) try { await cdpCloseTab(tab.id); } catch(_) {}
    throw e;
  }
}

// ─── XHS: open new tab, detect type, extract content ──────────────────────

async function getXhsContent(url) {
  const noteIdMatch = url.match(/\/explore\/([a-f0-9]+)/i) || url.match(/\/discovery\/item\/([a-f0-9]+)/i);
  const noteId = noteIdMatch ? noteIdMatch[1] : null;
  // Extract xsec_token from the original share URL (present when shared from XHS iOS app)
  const xsecTokenMatch = url.match(/[?&]xsec_token=([^&]+)/);
  const xsecToken = xsecTokenMatch ? xsecTokenMatch[1] : '';
  flog('[XHS] noteId: ' + noteId + ' token=' + (xsecToken ? xsecToken.slice(0,20) + '...' : 'none'));
  let tab = null;
  let send = null;
  try {
    tab = await cdpNewXhsTab();
    send = await connectToXhsTab(tab.webSocketDebuggerUrl);
    // Navigate with full URL (including xsec_token) for proper XHS page context
    const navUrl = noteId
      ? 'https://www.xiaohongshu.com/explore/' + noteId + (xsecToken ? '?xsec_token=' + encodeURIComponent(xsecToken) + '&xsec_source=pc_explore' : '')
      : url;
    await send('Page.navigate', { url: navUrl }, 12000);
    await new Promise(r => setTimeout(r, 12000));
    // Phase 1: Extract from window.__INITIAL_STATE__ (populated by XHS SPA after navigation)
    const stateExpr = '(function(){' +
      'try{' +
      'var s=window.__INITIAL_STATE__;' +
      'var nm=s&&s.note&&(s.note.noteDetailMap||s.note.notedetailmap);' +
      'if(!nm)return JSON.stringify({ok:false,reason:"no noteDetailMap"});' +
      (noteId ? 'var nd=nm["' + noteId + '"]||Object.values(nm)[0];' : 'var nd=Object.values(nm)[0];') +
      'if(!nd)return JSON.stringify({ok:false,reason:"no noteDetail"});' +
      'var note=nd.note||nd;' +
      // Extract video masterUrl from stream data (h264 preferred, fallback h265)
      'var videoUrl=null,videoSize=0;' +
      'try{var streams=note.video&&note.video.media&&note.video.media.stream;' +
      'var h264=streams&&streams.h264&&streams.h264[0];' +
      'var h265=streams&&streams.h265&&streams.h265[0];' +
      'var chosen=h264||h265;' +
      'videoUrl=chosen&&chosen.masterUrl||null;' +
      'videoSize=chosen&&chosen.size||0;}catch(ve){}' +
      'return JSON.stringify({' +
      'ok:true,' +
      'title:note.title||note.display_title||"",' +
      'desc:note.desc||note.description||"",' +
      'type:note.type||"image_text",' +
      'videoUrl:videoUrl,' +
      'videoSize:videoSize' +
      '});' +
      '}catch(e){return JSON.stringify({ok:false,reason:e.message});}' +
      '})()';
    try {
      const stateResp = await send('Runtime.evaluate', { expression: stateExpr, returnByValue: true, timeout: 10000 }, 15000);
      const stateVal = stateResp && stateResp.result && stateResp.result.value;
      if (stateVal) {
        const sd = JSON.parse(stateVal);
        flog('[XHS] STATE: ok=' + sd.ok + (sd.reason ? ' reason=' + sd.reason : '') + (sd.title ? ' title=' + sd.title.slice(0,40) : ''));
        if (sd.ok && sd.title) {
          const title = sd.title.trim();
          const text = (sd.desc || '').trim();
          const type = sd.type === 'video' ? 'video' : 'image_text';
          const videoUrl = sd.videoUrl || null;
          const videoSize = sd.videoSize || 0;
          flog('[XHS] State ok! type=' + type + ' text=' + text.length + 'chars' + (videoUrl ? ' video=OK(' + Math.round(videoSize/1024/1024) + 'MB)' : ''));
          send._close();
          await cdpCloseXhsTab(tab.id);
          return { type, title, text, videoUrl, videoSize, url };
        }
      }
    } catch(e) { flog('[XHS] State failed: ' + e.message); }
    // Phase 2: DOM fallback - try textContent on note description selectors
    const result = await send('Runtime.evaluate', {
      expression: '(function(){' +
        'var videoEl=document.querySelector("video");' +
        'var videoUrl=videoEl?videoEl.src||videoEl.currentSrc:null;' +
        'var titleEl=document.querySelector("#detail-title")||document.querySelector("h1");' +
        'var title=(titleEl?titleEl.innerText.trim():"")||document.title;' +
        'var noteText="";' +
        'var descEls=[document.querySelector("#detail-desc .desc"),document.querySelector("#detail-desc"),document.querySelector("[class*=\"noteDetailDescripe\"]"),document.querySelector("[class*=\"desc\"]")];' +
        'for(var i=0;i<descEls.length;i++){if(descEls[i]){noteText=descEls[i].textContent.trim();if(noteText.length>10)break;}}' +
        'var rawText=document.body?document.body.innerText.slice(0,15000):"";' +
        'return JSON.stringify({type:videoEl?"video":"image_text",videoUrl:videoUrl||null,title:title.slice(0,200),noteText:noteText.slice(0,3000),rawText:rawText,url:location.href});' +
        '})()',
      returnByValue: true, timeout: 10000
    }, 15000);
    const val = result.result && result.result.value;
    if (!val) throw new Error('Empty XHS CDP result');
    const parsed = JSON.parse(val);
    console.log('[XHS] DOM: title=' + parsed.title.slice(0,40) + ' noteText=' + parsed.noteText.length + ' rawText=' + parsed.rawText.length);
    // Use noteText if it has real content
    if (parsed.noteText && parsed.noteText.length > 30) {
      parsed.text = parsed.noteText;
    } else {
      // Filter rawText to extract content lines
      const rawLines = (parsed.rawText || '').split('\n').map(l => l.trim()).filter(l => l.length > 8);
      const navRe = /^(发现|直播|发布|通知|我|关注|登录|注册|首页|搜索|热门|话题|分类|评论|点赞|收藏|分享|举报|复制链接|微信|微博|更多|查看全文|\d+)$/;
      const footerRe = /ICP|增值电信|营业执照|公网安备|互联网药品|网络文化经营|沪网文|行吟信息科技|© 20|2014-20|9501-3888|马当路388/;
      const contentLines = rawLines.filter(l => !navRe.test(l) && !footerRe.test(l));
      let startIdx = 0;
      for (let ci = 0; ci < Math.min(5, contentLines.length); ci++) {
        if (contentLines[ci] === parsed.title || contentLines[ci].length < 5) startIdx = ci + 1; else break;
      }
      parsed.text = contentLines.slice(startIdx, startIdx + 80).join('\n').slice(0, 5000);
    }
    delete parsed.rawText;
    delete parsed.noteText;
    send._close();
    await cdpCloseXhsTab(tab.id);
    return parsed;
  } catch(e) {
    if (send) try { send._close(); } catch(_) {}
    if (tab) try { await cdpCloseXhsTab(tab.id); } catch(_) {}
    throw e;
  }
}

// ─── Jina reader via us-mac relay (xian-pc can't reach r.jina.ai directly) ─

const PROXY_HOST = '38.23.47.81';
const PROXY_PORT = 7786;

function fetchJinaContent(pageUrl) {
  return new Promise((resolve, reject) => {
    const encodedUrl = encodeURIComponent(pageUrl);
    const req = http.request({
      hostname: PROXY_HOST,
      port: PROXY_PORT,
      path: '/jina?url=' + encodedUrl,
      method: 'GET'
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode !== 200) reject(new Error('jina relay HTTP ' + res.statusCode + ': ' + d.slice(0,100)));
        else resolve(d);
      });
    });
    req.on('error', reject); req.setTimeout(35000, () => { req.destroy(); reject(new Error('jina relay t/o')); }); req.end();
  });
}

// ─── Download & transcribe ─────────────────────────────────────────────────

function parseCookieFile(f) {
  return fs.readFileSync(f,'utf8').split('\n').filter(l=>!l.startsWith('#')&&l.trim()).map(l=>{const p=l.split('\t');return p.length>=7?p[5]+'='+p[6].trim():null;}).filter(Boolean).join('; ');
}

function downloadToFile(url, destPath, extraHeaders) {
  return new Promise((resolve, reject) => {
    const headers = Object.assign({ Referer: 'https://www.douyin.com/', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Accept: '*/*' }, extraHeaders || {});
    if (url.includes('douyin') || url.includes('douyinvod')) {
      try { headers.Cookie = parseCookieFile(COOKIES_FILE); } catch(_) {}
    }
    const doReq = (u) => {
      const parsed = new URL(u);
      const lib = u.startsWith('https') ? https : http;
      const req = lib.request({ hostname: parsed.hostname, port: parsed.port ? parseInt(parsed.port) : (u.startsWith('https') ? 443 : 80), path: parsed.pathname+parsed.search, headers }, res => {
        if ([301,302,307,308].includes(res.statusCode)) { doReq(new URL(res.headers.location,u).href); return; }
        if (res.statusCode!==200&&res.statusCode!==206) { reject(new Error('HTTP '+res.statusCode)); return; }
        let bytes=0; const file=fs.createWriteStream(destPath);
        res.on('data',c=>bytes+=c.length); res.pipe(file);
        file.on('finish',()=>{file.close();resolve(bytes);}); file.on('error',reject);
      });
      req.on('error',reject); req.setTimeout(180000,()=>{req.destroy();reject(new Error('dl t/o'));}); req.end();
    };
    doReq(url);
  });
}

function sendToRelay(audioB64, mimeType, attempt) {
  attempt = attempt || 1;
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ audio_b64: audioB64, mime_type: mimeType || 'video/mp4' });
    const req = http.request({ hostname: RELAY_HOST, port: RELAY_PORT, path: '/transcribe', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, res => {
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{ try { const r=JSON.parse(d); if(r.transcript) resolve(r); else reject(new Error('relay:'+JSON.stringify(r).slice(0,200))); } catch(e){reject(e);} });
    });
    req.on('error', e => { if(attempt<3){setTimeout(()=>sendToRelay(audioB64,mimeType,attempt+1).then(resolve,reject),8000);}else reject(e); });
    req.setTimeout(240000,()=>{ req.destroy(); if(attempt<3){setTimeout(()=>sendToRelay(audioB64,mimeType,attempt+1).then(resolve,reject),8000);}else reject(new Error('relay t/o')); }); req.write(payload); req.end();
  });
}

function barkNotify(title, body) {
  try {
    const key = 'QU7ktbzPJxZbNx9pEHcstW';
    const url = 'https://api.day.app/' + key + '/' + encodeURIComponent(title) + '/' + encodeURIComponent(body);
    https.get(url, res => res.resume()).on('error', ()=>{});
  } catch(_) {}
}

function postCallback(callbackUrl, data, attempt) {
  attempt = attempt || 1;
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const parsed = new URL(callbackUrl);
    const lib = callbackUrl.startsWith('https') ? https : http;
    const port = parseInt(parsed.port) || (callbackUrl.startsWith('https') ? 443 : 80);
    const req = lib.request({ hostname: parsed.hostname, port, path: parsed.pathname+parsed.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, res => {
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(d));
    });
    req.on('error',reject); req.setTimeout(30000,()=>{req.destroy();reject(new Error('callback t/o'));}); req.write(payload); req.end();
  });
}

// ─── URL helpers ────────────────────────────────────────────────────────────

function detectPlatform(url) {
  if (/douyin\.com|v\.douyin\.com/.test(url)) return 'douyin';
  if (/xiaohongshu\.com|xhslink\.com/.test(url)) return 'xhs';
  return 'unknown';
}

function extractDouyinVideoId(url) { const m = url.match(/\/video\/(\d+)/); return m ? m[1] : null; }
function extractDouyinNoteId(url) { const m = url.match(/\/note\/(\d+)/); return m ? m[1] : null; }

function expandUrl(shortUrl) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(shortUrl);
    const lib = shortUrl.startsWith('https') ? https : http;
    // Try GET first (HEAD gets ECONNRESET from Douyin), follow one redirect
    const req = lib.request({ hostname: parsed.hostname, path: parsed.pathname+parsed.search, method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)', 'Accept': 'text/html' } }, res => {
      res.resume(); // drain body
      if (res.headers.location) resolve(res.headers.location); else resolve(shortUrl);
    });
    req.on('error', () => resolve(shortUrl)); // on error just return original
    req.setTimeout(10000,()=>{req.destroy();resolve(shortUrl);}); req.end();
  });
}

// ─── Background processors ────────────────────────────────────────────────

async function processDouyinVideo(url, videoId, callbackUrl) {
  flog('[DY-VIDEO ' + videoId + '] Getting detail...');
  const detail = await getDouyinVideoDetail(videoId);
  flog('[DY-VIDEO ' + videoId + '] title=' + detail.title.slice(0, 40));
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
  const tempVideo = path.join(TEMP_DIR, 'dy_' + videoId + '_' + Date.now() + '.mp4');
  const bytes = await downloadToFile(detail.audioUrl, tempVideo);
  flog('[DY-VIDEO ' + videoId + '] downloaded ' + (bytes/1024/1024).toFixed(2) + 'MB, extracting audio...');
  let tempAudio = null;
  try { tempAudio = extractAudio(tempVideo); } catch(ffErr) { flog('[DY-VIDEO] ffmpeg err: ' + ffErr.message); }
  fs.unlink(tempVideo, ()=>{});
  let relayResult;
  if (tempAudio) {
    const audioSize = fs.statSync(tempAudio).size;
    flog('[DY-VIDEO ' + videoId + '] audio ' + (audioSize/1024/1024).toFixed(2) + 'MB, sending to relay...');
    const audioB64 = fs.readFileSync(tempAudio).toString('base64');
    fs.unlink(tempAudio, ()=>{});
    relayResult = await sendToRelay(audioB64, 'audio/mpeg');
  } else {
    flog('[DY-VIDEO ' + videoId + '] no audio, skip transcription');
    await postCallback(callbackUrl, { success: true, platform: '抖音', content_type: '短视频', video_id: videoId, url, title: detail.title, duration_ms: detail.duration, transcript: '' });
    return;
  }
  flog('[DY-VIDEO ' + videoId + '] transcribed ' + relayResult.transcript.length + ' chars');
  barkNotify('✅ 抖音视频', detail.title.slice(0,30) + '\n已转录' + relayResult.transcript.length + '字');
  await postCallback(callbackUrl, { success: true, platform: '抖音', content_type: '短视频', video_id: videoId, url, title: detail.title, duration_ms: detail.duration, transcript: relayResult.transcript });
}

async function processDouyinNote(url, noteId, callbackUrl) {
  console.log('[DY-NOTE ' + noteId + '] Extracting via CDP...');
  const noteUrl = url.includes('/note/') ? url : 'https://www.douyin.com/note/' + noteId;
  const note = await getDouyinNoteContent(noteUrl);
  console.log('[DY-NOTE ' + noteId + '] title=' + note.title.slice(0, 40) + ' text=' + note.text.length + 'chars');
  barkNotify('✅ 抖音图文', note.title.slice(0,30));
  await postCallback(callbackUrl, { success: true, platform: '抖音', content_type: '图文', note_id: noteId, url, title: note.title, text: note.text, images: note.images });
}

async function processXhsVideo(url, videoUrl, title, callbackUrl) {
  flog('[XHS-VIDEO] Downloading: ' + (videoUrl||'').slice(0,60));
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
  const tempVideo = path.join(TEMP_DIR, 'xhs_' + Date.now() + '.mp4');
  const bytes = await downloadToFile(videoUrl, tempVideo, { Referer: 'https://www.xiaohongshu.com/', 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)' });
  flog('[XHS-VIDEO] downloaded ' + (bytes/1024/1024).toFixed(2) + 'MB, extracting audio...');
  let tempAudio = null;
  try { tempAudio = extractAudio(tempVideo); } catch(ffErr) { flog('[XHS-VIDEO] ffmpeg err: ' + ffErr.message); }
  fs.unlink(tempVideo, ()=>{});
  if (!tempAudio) {
    flog('[XHS-VIDEO] no audio track, saving title only');
    await postCallback(callbackUrl, { success: true, platform: '小红书', content_type: '短视频', url, title, transcript: '' });
    return;
  }
  const audioSize = fs.statSync(tempAudio).size;
  flog('[XHS-VIDEO] audio ' + (audioSize/1024/1024).toFixed(2) + 'MB, sending to relay...');
  const audioB64 = fs.readFileSync(tempAudio).toString('base64');
  fs.unlink(tempAudio, ()=>{});
  const relayResult = await sendToRelay(audioB64, 'audio/mpeg');
  flog('[XHS-VIDEO] transcribed ' + relayResult.transcript.length + ' chars');
  barkNotify('✅ 小红书视频', title.slice(0,30) + '\n已转录' + relayResult.transcript.length + '字');
  await postCallback(callbackUrl, { success: true, platform: '小红书', content_type: '短视频', url, title, transcript: relayResult.transcript });
}

async function processXhsNote(url, title, text, callbackUrl) {
  // XHS requires login - Jina fallback doesn't work (gets login page)
  // Just use whatever text we extracted via CDP/API
  const finalText = text || '';
  const finalTitle = title || '';
  flog('[XHS-NOTE] title=' + finalTitle.slice(0, 40) + ' text=' + finalText.length + 'chars');
  barkNotify('✅ 小红书图文', finalTitle.slice(0,30));
  await postCallback(callbackUrl, { success: true, platform: '小红书', content_type: '图文', url, title: finalTitle, text: finalText });
}

async function processInBackground(url, callbackUrl) {
  const platform = detectPlatform(url);
  flog('[BG] platform=' + platform + ' url=' + url.slice(0, 80));
  try {
    if (platform === 'douyin') {
      let expandedUrl = url;
      if (url.includes('v.douyin.com')) {
        expandedUrl = await expandUrl(url);
        console.log('[BG] expanded: ' + expandedUrl.slice(0, 80));
      }
      const videoId = extractDouyinVideoId(expandedUrl);
      const noteId = extractDouyinNoteId(expandedUrl);
      if (videoId) await processDouyinVideo(url, videoId, callbackUrl);
      else if (noteId) await processDouyinNote(url, noteId, callbackUrl);
      else throw new Error('Cannot determine Douyin type from: ' + expandedUrl.slice(0, 100));

    } else if (platform === 'xhs') {
      let expandedUrl = url;
      if (url.includes('xhslink.com')) {
        expandedUrl = await expandUrl(url);
        console.log('[BG] XHS expanded: ' + expandedUrl.slice(0, 80));
        // If expanded URL lost xsec_token, reattach it from the original short URL
        const origTokenMatch = url.match(/[?&]xsec_token=([^&]+)/);
        if (origTokenMatch && !expandedUrl.includes('xsec_token=')) {
          expandedUrl += (expandedUrl.includes('?') ? '&' : '?') + 'xsec_token=' + origTokenMatch[1] + '&xsec_source=pc_explore';
        }
      }
      const xhsContent = await getXhsContent(expandedUrl);
      flog('[BG] XHS type=' + xhsContent.type + ' title=' + xhsContent.title.slice(0, 40));
      if (xhsContent.type === 'video' && xhsContent.videoUrl) {
        await processXhsVideo(expandedUrl, xhsContent.videoUrl, xhsContent.title, callbackUrl);
      } else {
        await processXhsNote(expandedUrl, xhsContent.title, xhsContent.text, callbackUrl);
      }
    } else {
      throw new Error('Unsupported platform: ' + url.slice(0, 100));
    }
    flog('[BG] Done.');
  } catch(e) {
    flog('[BG] FAILED: ' + e.message);
    barkNotify('❌ 剪藏失败', platform + ' ' + e.message.slice(0,50));
    if (callbackUrl) try { await postCallback(callbackUrl, { success: false, url, platform, error: e.message }); } catch(_) {}
  }
}

// ─── HTTP Server ───────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200); res.end(JSON.stringify({ status: 'ok', service: 'content-service', version: 5 })); return;
  }
  if (req.method === 'POST' && req.url === '/transcribe') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body);
        const { url, callback_url } = parsed;
        if (!url) { res.writeHead(400); res.end(JSON.stringify({error:'Missing url'})); return; }
        const platform = detectPlatform(url);
        res.writeHead(200); res.end(JSON.stringify({ queued: true, platform, message: '正在处理' })); flog('[REQ] queued ' + platform + ' ' + (url||'').slice(0,60));
        if (callback_url) setImmediate(() => processInBackground(url, callback_url));
        else console.log('[WARN] No callback_url for ' + url.slice(0, 80));
      } catch(e) {
        console.error('handler error:', e.message);
        try { res.writeHead(500); res.end(JSON.stringify({error:e.message})); } catch(_) {}
      }
    });
    return;
  }
  res.writeHead(404); res.end(JSON.stringify({error:'not found'}));
});

server.listen(PORT, '0.0.0.0', () => { flog('Content Service v5 (Douyin + XHS) on port ' + PORT); });
process.on('uncaughtException', e => console.error('Uncaught:', e.message));
