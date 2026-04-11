const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://100.97.242.124:19228');
  const contexts = browser.contexts();
  const ctx = contexts[0];
  const pages = ctx.pages();
  const page = pages[0];
  console.log('Current URL:', page.url());

  const frames = page.frames();
  console.log('Frames:', frames.map(f => f.url()));

  const loginFrame = frames.find(f => f.url().includes('login-for-iframe'));
  if (!loginFrame) { console.log('No login frame found'); await browser.close(); return; }

  // Click refresh via JS dispatch
  const result = await loginFrame.evaluate(() => {
    const el = document.querySelector('.refresh-icon');
    if (el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); return 'clicked'; }
    const wrap = document.querySelector('.refresh-wrap');
    if (wrap) { wrap.dispatchEvent(new MouseEvent('click', { bubbles: true })); return 'clicked_wrap'; }
    return 'not_found';
  }).catch(e => 'err:' + e.message);
  console.log('Click result:', result);
  
  await page.waitForTimeout(5000);
  
  // Check new QR img src
  const qrInfo = await loginFrame.evaluate(() => {
    const qrImg = document.querySelector('img.qrcode');
    const mask = document.querySelector('.mask.show');
    return JSON.stringify({ 
      qrSrc: qrImg ? qrImg.src.slice(0, 150) : null,
      maskTxt: mask ? mask.innerText.slice(0, 80) : null
    });
  }).catch(e => 'err:' + e.message);
  console.log('QR info:', qrInfo);

  // Full page screenshot
  await page.screenshot({ path: '/Users/administrator/claude-output/shipinhao-pw-qr.png' });
  console.log('截图: http://38.23.47.81:9998/shipinhao-pw-qr.png');

  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
