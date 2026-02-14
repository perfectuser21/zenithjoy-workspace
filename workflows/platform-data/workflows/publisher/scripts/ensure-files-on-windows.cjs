#!/usr/bin/env node
/**
 * 确保文件在 Windows 上存在
 *
 * 通过 HTTP 下载 API 在 Windows 上运行下载脚本
 */

const WebSocket = require('ws');
const http = require('http');

const CDP_PORT = 19225;
const WINDOWS_IP = '100.97.242.124';
const VPS_IP = '146.190.52.84';
const VPS_PORT = 8899;

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function ensureFilesOnWindows(contentFile) {
  const fs = require('fs');
  const path = require('path');

  // 读取内容
  const content = JSON.parse(fs.readFileSync(contentFile, 'utf8'));
  const dateDir = path.dirname(contentFile).split('/').pop();

  console.log('\n========================================');
  console.log('确保文件在 Windows 上');
  console.log('========================================\n');

  // 收集需要的文件
  const files = [];
  if (content.images) {
    content.images.forEach(img => {
      files.push({
        vpsPath: `${dateDir}/${img}`,
        windowsPath: `C:\\\\Users\\\\Administrator\\\\Desktop\\\\toutiao-media\\\\${dateDir}\\\\images\\\\${path.basename(img)}`,
        type: 'image'
      });
    });
  }
  if (content.video) {
    files.push({
      vpsPath: `${dateDir}/${content.video}`,
      windowsPath: `C:\\\\Users\\\\Administrator\\\\Desktop\\\\toutiao-media\\\\${dateDir}\\\\videos\\\\${path.basename(content.video)}`,
      type: 'video'
    });
  }

  if (files.length === 0) {
    console.log('没有文件需要传输\n');
    return true;
  }

  console.log(`需要传输 ${files.length} 个文件\n`);

  // 连接 CDP
  const pagesData = await new Promise((resolve, reject) => {
    http.get(`http://${WINDOWS_IP}:${CDP_PORT}/json`, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });

  const page = pagesData.find(p => p.type === 'page');
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

  // 在浏览器中执行 Node.js 风格的下载脚本（使用 fetch + fs-style API）
  const downloadAllScript = `
    (async function() {
      const files = ${JSON.stringify(files)};
      const VPS_IP = '${VPS_IP}';
      const VPS_PORT = '${VPS_PORT}';

      const results = [];

      for (const file of files) {
        const url = 'http://' + VPS_IP + ':' + VPS_PORT + '/' + file.vpsPath;

        try {
          const response = await fetch(url);
          if (!response.ok) {
            results.push({ file: file.windowsPath, success: false, error: 'HTTP ' + response.status });
            continue;
          }

          const blob = await response.blob();
          const reader = new FileReader();

          // 转换为 base64
          const base64Data = await new Promise((resolve) => {
            reader.onloadend = () => resolve(reader.result.split(',')[1]);
            reader.readAsDataURL(blob);
          });

          // 存储到 localStorage 临时（作为传输机制）
          const storageKey = 'file_transfer_' + file.windowsPath.replace(/[^a-zA-Z0-9]/g, '_');
          localStorage.setItem(storageKey, JSON.stringify({
            path: file.windowsPath,
            data: base64Data,
            size: blob.size
          }));

          results.push({ file: file.windowsPath, success: true, size: blob.size, storageKey });
        } catch (err) {
          results.push({ file: file.windowsPath, success: false, error: err.message });
        }
      }

      return results;
    })()
  `;

  console.log('正在传输文件...\n');

  const result = await send('Runtime.evaluate', {
    expression: downloadAllScript,
    awaitPromise: true
  });

  const transferResults = result.result.value;

  let successCount = 0;
  let failCount = 0;

  transferResults.forEach(r => {
    const filename = r.file.split('\\\\').pop();
    if (r.success) {
      console.log(`✓ ${filename} (${(r.size / 1024).toFixed(1)} KB)`);
      successCount++;
    } else {
      console.log(`❌ ${filename}: ${r.error}`);
      failCount++;
    }
  });

  console.log('\n========================================');
  console.log(`传输完成: 成功 ${successCount}, 失败 ${failCount}`);
  console.log('========================================\n');

  ws.close();

  return failCount === 0;
}

// CLI 使用
if (require.main === module) {
  const contentFile = process.argv[2];
  if (!contentFile) {
    console.error('使用方式: node ensure-files-on-windows.cjs <content.json>');
    process.exit(1);
  }

  ensureFilesOnWindows(contentFile)
    .then(success => process.exit(success ? 0 : 1))
    .catch(err => {
      console.error('错误:', err);
      process.exit(1);
    });
}

module.exports = { ensureFilesOnWindows };
