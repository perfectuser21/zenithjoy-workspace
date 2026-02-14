#!/usr/bin/env node
/**
 * 文件传输客户端 (Windows 端)
 *
 * 在 Windows 上运行，连接到 VPS 服务器并下载文件
 *
 * 使用方式：
 * node file-transfer-client.cjs
 */

const WebSocket = require('ws');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const VPS_HOST = process.env.VPS_HOST || '100.71.32.28';  // Tailscale IP
const WS_PORT = 8900;
const TARGET_BASE = 'C:\\\\Users\\\\Administrator\\\\Desktop\\\\toutiao-media';

console.log('\n========================================');
console.log('文件传输客户端 (Windows)');
console.log('========================================\n');
console.log(`VPS: ${VPS_HOST}`);
console.log(`目标目录: ${TARGET_BASE}`);
console.log('\n连接到服务器...\n');

const ws = new WebSocket(`ws://${VPS_HOST}:${WS_PORT}`);

ws.on('open', () => {
  console.log('✓ 已连接到 VPS 服务器');
  console.log('');

  // 请求文件列表
  ws.send(JSON.stringify({ type: 'request_files' }));
});

ws.on('message', async (message) => {
  try {
    const msg = JSON.parse(message);

    if (msg.type === 'connected') {
      console.log(`服务器: ${msg.message}`);
    } else if (msg.type === 'file_list') {
      console.log(`收到文件列表: ${msg.files.length} 个文件\n`);

      // 下载每个文件
      for (const file of msg.files) {
        await downloadFile(msg.vpsUrl, file);
      }

      console.log('\n========================================');
      console.log('所有文件下载完成');
      console.log('========================================\n');

      // 关闭连接
      ws.close();
      process.exit(0);
    } else if (msg.type === 'error') {
      console.error(`服务器错误: ${msg.error}`);
    }
  } catch (err) {
    console.error('消息处理错误:', err);
  }
});

ws.on('error', (err) => {
  console.error('WebSocket 错误:', err.message);
  process.exit(1);
});

ws.on('close', () => {
  console.log('\n连接已关闭');
});

async function downloadFile(vpsUrl, file) {
  const url = `${vpsUrl}/${file.date}/${file.path}`;
  const targetDir = path.join(TARGET_BASE, file.date, file.type === 'video' ? 'videos' : 'images');
  const targetPath = path.join(targetDir, file.filename);

  console.log(`📥 ${file.filename}`);
  console.log(`   URL: ${url}`);
  console.log(`   目标: ${targetPath}`);

  // 创建目录
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // 检查文件是否已存在
  if (fs.existsSync(targetPath)) {
    console.log(`   ⏭️  已存在，跳过\n`);
    ws.send(JSON.stringify({
      type: 'download_complete',
      filename: file.filename,
      skipped: true
    }));
    return;
  }

  return new Promise((resolve, reject) => {
    const fileStream = fs.createWriteStream(targetPath);
    const protocol = url.startsWith('https') ? https : http;

    protocol.get(url, (response) => {
      if (response.statusCode !== 200) {
        const error = `HTTP ${response.statusCode}`;
        console.log(`   ❌ ${error}\n`);
        ws.send(JSON.stringify({
          type: 'download_error',
          filename: file.filename,
          error
        }));
        reject(new Error(error));
        return;
      }

      const totalSize = parseInt(response.headers['content-length'], 10);
      let downloadedSize = 0;

      response.on('data', (chunk) => {
        downloadedSize += chunk.length;
        const percent = ((downloadedSize / totalSize) * 100).toFixed(1);
        process.stdout.write(`   ${percent}%\r`);
      });

      response.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        process.stdout.write('\n');
        console.log(`   ✓ 完成 (${(totalSize / 1024).toFixed(1)} KB)\n`);

        ws.send(JSON.stringify({
          type: 'download_complete',
          filename: file.filename,
          size: totalSize
        }));

        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(targetPath, () => {});
      console.log(`   ❌ ${err.message}\n`);
      ws.send(JSON.stringify({
        type: 'download_error',
        filename: file.filename,
        error: err.message
      }));
      reject(err);
    });
  });
}
