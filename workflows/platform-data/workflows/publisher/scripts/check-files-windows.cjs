#!/usr/bin/env node
/**
 * 检查 Windows 上的文件是否存在
 *
 * 通过 PowerShell 命令检查文件
 */

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');

const CDP_PORT = 19225;
const WINDOWS_IP = '100.97.242.124';

async function main() {
  const args = process.argv.slice(2);
  const date = args[args.indexOf('--date') + 1];
  const contentFile = args[args.indexOf('--content') + 1];

  if (!date || !contentFile) {
    console.error('使用方式：node check-files-windows.cjs --date 2026-02-09 --content micro-test-001.json');
    process.exit(1);
  }

  const contentPath = `/home/xx/.toutiao-queue/${date}/${contentFile}`;
  const content = JSON.parse(fs.readFileSync(contentPath, 'utf8'));

  console.log('\n========================================');
  console.log('检查 Windows 文件');
  console.log('========================================\n');

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

  // 检查文件
  const baseDir = 'C:\\\\Users\\\\Administrator\\\\Desktop\\\\toutiao-media';
  const fileChecks = [];

  if (content.images) {
    content.images.forEach(img => {
      const filename = require('path').basename(img);
      const filePath = `${baseDir}\\\\${date}\\\\images\\\\${filename}`;
      fileChecks.push({ type: 'image', filename, path: filePath });
    });
  }

  console.log(`检查 ${fileChecks.length} 个文件...\n`);

  let allExist = true;

  for (const check of fileChecks) {
    // 注意：浏览器无法直接访问文件系统
    // 需要其他方式（如 PowerShell）
    console.log(`${check.filename}`);
    console.log(`  路径: ${check.path.replace(/\\\\/g, '\\')}`);
    console.log(`  ⚠️  无法通过浏览器检查文件，需要手动确认或使用 PowerShell`);
    console.log('');
  }

  console.log('========================================');
  console.log('📋 手动检查步骤:');
  console.log('========================================\n');
  console.log('1. 在 Windows 上打开文件浏览器');
  console.log(`2. 导航到: ${baseDir.replace(/\\\\/g, '\\')}\\\\${date}\\\\images\\\\`);
  console.log('3. 确认以下文件存在:');
  fileChecks.forEach(f => console.log(`   - ${f.filename}`));
  console.log('');
  console.log('或者，在 Windows PowerShell 中运行:');
  console.log('');
  fileChecks.forEach(f => {
    console.log(`Test-Path "${f.path.replace(/\\\\/g, '\\')}"`);
  });
  console.log('');

  ws.close();
}

main().catch(err => {
  console.error('❌ 错误:', err);
  process.exit(1);
});
