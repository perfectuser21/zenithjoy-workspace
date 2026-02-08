#!/usr/bin/env node
const CDP = require('chrome-remote-interface');
const fs = require('fs');

(async () => {
  let client;
  try {
    client = await CDP({ host: '100.97.242.124', port: 19224, timeout: 30000 });
    const { Runtime, Page } = client;
    await Runtime.enable();
    await Page.enable();

    // 先导航到数据分析页面（v3采集器用的页面）
    console.log('导航到数据分析页面...');
    await Page.navigate({ url: 'https://creator.xiaohongshu.com/statistics/data-analysis' });
    await new Promise(r => setTimeout(r, 8000));

    // 截图
    console.log('截图数据分析页面...');
    let screenshot = await Page.captureScreenshot({ format: 'png' });
    fs.writeFileSync('/tmp/xiaohongshu-data-analysis.png', Buffer.from(screenshot.data, 'base64'));
    console.log('✅ 截图保存到 /tmp/xiaohongshu-data-analysis.png');

    // 提取表格数据（前15条）
    console.log('提取表格数据...');
    const { result } = await Runtime.evaluate({
      expression: `
        (function() {
          const rows = document.querySelectorAll('tbody tr');
          const works = [];
          rows.forEach((row, idx) => {
            if (idx < 15) {
              const cells = row.querySelectorAll('td');
              if (cells.length >= 8) {
                // 提取第一列的所有文本
                const firstCellText = cells[0]?.innerText || '';
                
                // 提取所有列的数据
                const rowData = {
                  index: idx,
                  cell0: cells[0]?.innerText?.trim() || '',
                  cell1: cells[1]?.innerText?.trim() || '',
                  cell2: cells[2]?.innerText?.trim() || '',
                  cell3: cells[3]?.innerText?.trim() || '',
                  cell4: cells[4]?.innerText?.trim() || '',
                  cell5: cells[5]?.innerText?.trim() || '',
                  cell6: cells[6]?.innerText?.trim() || '',
                  cell7: cells[7]?.innerText?.trim() || '',
                  cell8: cells[8]?.innerText?.trim() || '',
                  cell9: cells[9]?.innerText?.trim() || ''
                };
                
                works.push(rowData);
              }
            }
          });
          return JSON.stringify(works, null, 2);
        })()
      `
    });

    console.log('\n=== 前15条作品数据 ===');
    const data = JSON.parse(result.value || '[]');
    console.log(JSON.stringify(data, null, 2));
    
    // 保存到文件
    fs.writeFileSync('/tmp/xiaohongshu-raw-data.json', JSON.stringify(data, null, 2));
    console.log('\n✅ 数据保存到 /tmp/xiaohongshu-raw-data.json');

    // 提取表头
    console.log('\n提取表头...');
    const { result: headerResult } = await Runtime.evaluate({
      expression: `
        (function() {
          const headers = document.querySelectorAll('thead th');
          return Array.from(headers).map(h => h.innerText.trim());
        })()
      `
    });
    
    console.log('表头:', headerResult.value);

    await client.close();
  } catch (e) {
    console.error('错误:', e.message);
    if (client) await client.close();
    process.exit(1);
  }
})();
