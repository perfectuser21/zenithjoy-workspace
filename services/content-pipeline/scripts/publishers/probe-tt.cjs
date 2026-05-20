const _log = console.log.bind(console);
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:19226', { timeout: 30000 });
  const context = browser.contexts()[0];
  const pages = context.pages();
  const page = pages[0];
  
  _log('Current URL:', page.url());
  const info = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    body200: document.body.innerText.slice(0, 200),
    isLoggedIn: !location.href.includes('login') && !location.href.includes('passport'),
  }));
  _log(JSON.stringify(info, null, 2));
  await browser.close();
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
