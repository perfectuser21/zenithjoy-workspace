#!/usr/bin/env node
/**
 * File Receiver - Windows 端文件接收器
 *
 * 运行在 Windows 机器上，从 VPS 接收文件到桌面目录
 *
 * 使用方式（在 Windows 上）：
 * node file-receiver.cjs --vps-host 134.199.234.147 --vps-port 8899
 *
 * 功能：
 * 1. 监听 VPS 发来的文件传输请求
 * 2. 下载文件到指定目录
 * 3. 报告下载状态
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// 配置
const VPS_HOST = process.env.VPS_HOST || '134.199.234.147';
const VPS_PORT = process.env.VPS_PORT || '8899';
const TARGET_BASE = process.env.TARGET_BASE || 'C:\\Users\\Administrator\\Desktop\\toutiao-media';
const CHECK_INTERVAL = 5000; // 每5秒检查一次

console.log('\n========================================');
console.log('今日头条 File Receiver');
console.log('========================================\n');
console.log(`📡 VPS: ${VPS_HOST}:${VPS_PORT}`);
console.log(`📁 目标目录: ${TARGET_BASE}`);
console.log(`⏱️  检查间隔: ${CHECK_INTERVAL}ms`);
console.log('');
console.log('⏳ 等待文件传输请求...\n');

// 确保目标目录存在
if (!fs.existsSync(TARGET_BASE)) {
  fs.mkdirSync(TARGET_BASE, { recursive: true });
  console.log(`✓ 创建目标目录: ${TARGET_BASE}\n`);
}

// 下载文件
async function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);

    protocol.get(url, response => {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}: ${url}`));
        return;
      }

      const totalSize = parseInt(response.headers['content-length'], 10);
      let downloadedSize = 0;
      const startTime = Date.now();

      response.on('data', chunk => {
        downloadedSize += chunk.length;
        const percent = ((downloadedSize / totalSize) * 100).toFixed(1);
        const elapsed = (Date.now() - startTime) / 1000;
        const speed = (downloadedSize / 1024 / elapsed).toFixed(1);
        process.stdout.write(`   ${percent}% (${speed} KB/s)\r`);
      });

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        process.stdout.write('\n');
        resolve({ size: downloadedSize, path: destPath });
      });
    }).on('error', err => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

// 检查并下载队列中的文件
async function checkAndDownload() {
  try {
    // 获取队列状态（需要 VPS 提供一个 API 端点）
    // 暂时使用简单的文件扫描方式
    const queueUrl = `http://${VPS_HOST}:${VPS_PORT}/queue.json`;

    const queueData = await new Promise((resolve, reject) => {
      http.get(queueUrl, res => {
        if (res.statusCode === 404) {
          // 没有队列文件，跳过
          resolve(null);
          return;
        }

        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        });
      }).on('error', () => {
        // 网络错误，跳过
        resolve(null);
      });
    });

    if (!queueData || !queueData.files || queueData.files.length === 0) {
      return; // 没有文件要下载
    }

    console.log(`\n📥 发现 ${queueData.files.length} 个文件待下载\n`);

    // 下载每个文件
    for (const fileInfo of queueData.files) {
      const { date, path: filePath, type } = fileInfo;
      const filename = path.basename(filePath);
      const url = `http://${VPS_HOST}:${VPS_PORT}/${date}/${filePath}`;

      // 确定目标路径
      const targetDir = path.join(TARGET_BASE, date, type === 'video' ? 'videos' : 'images');
      const targetPath = path.join(targetDir, filename);

      // 检查文件是否已存在
      if (fs.existsSync(targetPath)) {
        console.log(`⏭️  跳过（已存在）: ${filename}`);
        continue;
      }

      // 创建目录
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      // 下载文件
      console.log(`📥 下载: ${filename}`);
      console.log(`   URL: ${url}`);

      try {
        const result = await downloadFile(url, targetPath);
        const sizeMB = (result.size / 1024 / 1024).toFixed(2);
        console.log(`   ✓ 完成: ${sizeMB} MB → ${targetPath}\n`);
      } catch (err) {
        console.error(`   ❌ 失败: ${err.message}\n`);
      }
    }

    console.log('⏳ 等待下一次检查...\n');

  } catch (err) {
    // 静默错误，继续下一次检查
  }
}

// 主循环
async function main() {
  while (true) {
    await checkAndDownload();
    await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL));
  }
}

// 优雅退出
process.on('SIGINT', () => {
  console.log('\n\n👋 File Receiver 已停止\n');
  process.exit(0);
});

main().catch(err => {
  console.error('\n❌ 致命错误:', err);
  process.exit(1);
});
