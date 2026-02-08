#!/usr/bin/env node
const CDP = require('chrome-remote-interface');

(async () => {
  let client;
  try {
    client = await CDP({ host: '100.97.242.124', port: 19224, timeout: 30000 });
    const { Runtime, Page } = client;
    await Runtime.enable();
    await Page.enable();

    console.log('导航到作品管理页面...');
    await Page.navigate({ url: 'https://creator.xiaohongshu.com/creator/post-management' });
    await new Promise(r => setTimeout(r, 8000));

    // 截图
    console.log('截图...');
    const screenshot = await Page.captureScreenshot({ format: 'png' });
    require('fs').writeFileSync('/tmp/xiaohongshu-works.png', Buffer.from(screenshot.data, 'base64'));
    console.log('✅ 截图保存到 /tmp/xiaohongshu-works.png');

    // 获取页面文本内容
    console.log('提取页面文本...');
    const { result } = await Runtime.evaluate({
      expression: `
        (function() {
          const rows = document.querySelectorAll('tbody tr');
          const works = [];
          rows.forEach((row, idx) => {
            if (idx < 10) {  // 只取前10条分析
              const cells = row.querySelectorAll('td');
              if (cells.length >= 10) {
                const firstCell = cells[0]?.innerText || '';
                
                // 检查所有单元格的文本
                const allText = Array.from(cells).map((c, i) => \`Cell\${i}: \${c.innerText.trim()}\`).join(' || ');
                
                works.push({
                  rowIndex: idx,
                  firstCellText: firstCell,
                  allCellsText: allText
                });
              }
            }
          });
          return JSON.stringify(works, null, 2);
        })()
      `
    });

    console.log('\n=== 前10条作品数据 ===');
    console.log(result.value);

    await client.close();
  } catch (e) {
    console.error('错误:', e.message);
    if (client) await client.close();
    process.exit(1);
  }
})();
