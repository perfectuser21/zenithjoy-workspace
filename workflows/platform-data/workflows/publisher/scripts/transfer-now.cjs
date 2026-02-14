#!/usr/bin/env node
/**
 * 立即传输文件 - 通过 CDP 在浏览器中下载文件到 Windows
 *
 * 使用 queue.json 中的文件列表，通过浏览器下载到指定目录
 *
 * 使用方式：
 * node transfer-now.cjs
 */

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');

const CDP_PORT = 19225;
const WINDOWS_IP = '100.97.242.124';
const VPS_IP = '146.190.52.84';
const VPS_PORT = 8899;

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  try {
    console.log('\n========================================');
    console.log('立即传输文件: VPS → Windows');
    console.log('========================================\n');

    // 读取队列
    const queuePath = '/home/xx/.toutiao-queue/queue.json';
    if (!fs.existsSync(queuePath)) {
      console.log('❌ 队列文件不存在，请先运行 prepare-queue.cjs\n');
      process.exit(1);
    }

    const queue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));

    console.log(`📋 队列信息:`);
    console.log(`   内容 ID: ${queue.content.id}`);
    console.log(`   文件数量: ${queue.files.length}`);
    console.log(`   总大小: ${(queue.totalSize / 1024).toFixed(1)} KB`);
    console.log('');

    // 连接 CDP
    const pagesData = await new Promise((resolve, reject) => {
      http.get(`http://${WINDOWS_IP}:${CDP_PORT}/json`, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });

    const page = pagesData.find(p => p.type === 'page');
    if (!page) {
      console.error('❌ 找不到可用的浏览器页面\n');
      process.exit(1);
    }

    const ws = new WebSocket(page.webSocketDebuggerUrl);

    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    let msgId = 0;
    const send = (method, params = {}) => {
      return new Promise((resolve) => {
        const id = ++msgId;
        const handler = (data) => {
          const msg = JSON.parse(data);
          if (msg.id === id) {
            ws.off('message', handler);
            resolve(msg.result);
          }
        };
        ws.on('message', handler);
        ws.send(JSON.stringify({ id, method, params }));
      });
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('DOM.enable');

    console.log(`🔗 已连接 CDP: ${WINDOWS_IP}:${CDP_PORT}\n`);

    // 传输每个文件
    let successCount = 0;
    let failCount = 0;

    for (const file of queue.files) {
      const vpsUrl = `http://${VPS_IP}:${VPS_PORT}/${file.date}/${file.path}`;
      const targetDir = `C:\\\\Users\\\\Administrator\\\\Desktop\\\\toutiao-media\\\\${file.date}\\\\${file.type === 'video' ? 'videos' : 'images'}`;
      const targetPath = `${targetDir}\\\\${file.filename}`;

      console.log(`📥 ${file.filename} (${(file.size / 1024).toFixed(1)} KB)`);
      console.log(`   URL: ${vpsUrl}`);
      console.log(`   目标: ${targetPath.replace(/\\\\/g, '\\')}`);

      // 在浏览器中下载文件
      const result = await send('Runtime.evaluate', {
        expression: `
          (async function() {
            const vpsUrl = '${vpsUrl}';
            const targetPath = '${targetPath}';

            try {
              // 下载文件
              const response = await fetch(vpsUrl);
              if (!response.ok) {
                return JSON.stringify({ success: false, error: 'HTTP ' + response.status });
              }

              const blob = await response.blob();

              // 创建下载链接
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = '${file.filename}';
              a.style.display = 'none';
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);

              return JSON.stringify({
                success: true,
                size: blob.size,
                note: '文件已下载到浏览器默认下载文件夹'
              });
            } catch (err) {
              return JSON.stringify({ success: false, error: err.message });
            }
          })()
        `,
        awaitPromise: true
      });

      const downloadResult = JSON.parse(result.result.value);

      if (downloadResult.success) {
        successCount++;
        console.log(`   ✓ 下载触发成功`);
      } else {
        failCount++;
        console.error(`   ❌ 失败: ${downloadResult.error}`);
      }

      console.log('');
      await sleep(1000);
    }

    console.log('========================================');
    console.log(`✅ 传输完成`);
    console.log(`   成功: ${successCount}`);
    console.log(`   失败: ${failCount}`);
    console.log('========================================\n');

    console.log('⚠️  重要提示:');
    console.log('   文件已下载到浏览器默认下载文件夹（通常是 Downloads）');
    console.log('   需要手动移动到目标位置，或者：');
    console.log('');
    console.log('   1. 在 Windows 上启动 file-receiver.cjs 后台服务');
    console.log('   2. 它会自动将文件放到正确的目录');
    console.log('');

    ws.close();

  } catch (err) {
    console.error('❌ 错误:', err.message);
    process.exit(1);
  }
}

main();
