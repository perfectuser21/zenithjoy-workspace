#!/usr/bin/env node
/**
 * 文件传输服务器 (VPS 端)
 *
 * 运行在 VPS 上，等待 Windows 客户端连接并发送文件
 */

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');

const WS_PORT = 8900;
const HTTP_PORT = 8899;

console.log('\n========================================');
console.log('文件传输服务器');
console.log('========================================\n');
console.log(`WebSocket 端口: ${WS_PORT}`);
console.log(`HTTP 文件服务: ${HTTP_PORT}`);
console.log('\n等待 Windows 客户端连接...\n');

const wss = new WebSocket.Server({ port: WS_PORT });

wss.on('connection', (ws) => {
  console.log('✓ Windows 客户端已连接');

  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message);

      if (msg.type === 'request_files') {
        // 客户端请求文件列表
        const queuePath = '/home/xx/.toutiao-queue/queue.json';

        if (!fs.existsSync(queuePath)) {
          ws.send(JSON.stringify({ type: 'error', error: 'No queue file' }));
          return;
        }

        const queue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));

        ws.send(JSON.stringify({
          type: 'file_list',
          files: queue.files,
          vpsUrl: `http://100.71.32.28:${HTTP_PORT}`  // Tailscale IP
        }));

        console.log(`→ 发送文件列表: ${queue.files.length} 个文件`);
      } else if (msg.type === 'download_complete') {
        console.log(`✓ Windows 已下载: ${msg.filename}`);
      } else if (msg.type === 'download_error') {
        console.error(`❌ 下载失败: ${msg.filename} - ${msg.error}`);
      }
    } catch (err) {
      console.error('消息处理错误:', err);
    }
  });

  ws.on('close', () => {
    console.log('✗ Windows 客户端断开连接');
  });

  // 发送欢迎消息
  ws.send(JSON.stringify({ type: 'connected', message: 'File transfer server ready' }));
});

console.log('========================================');
console.log('服务器已启动');
console.log('========================================\n');
console.log('Windows 客户端连接地址:');
console.log(`  ws://146.190.52.84:${WS_PORT}`);
console.log('\n按 Ctrl+C 停止服务器\n');
