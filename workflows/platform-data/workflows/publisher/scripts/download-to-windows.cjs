#!/usr/bin/env node
/**
 * 从 VPS 下载文件到 Windows 桌面
 *
 * 此脚本需要在 Windows 机器上运行（通过远程执行）
 * 或者通过 CDP 在浏览器中执行下载逻辑
 *
 * 使用：
 * node download-to-windows.cjs --content /path/to/content.json --vps-host 134.199.234.147 --vps-port 8899
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// 命令行参数
const args = process.argv.slice(2);
const contentFile = args[args.indexOf('--content') + 1];
const vpsHost = args[args.indexOf('--vps-host') + 1] || '134.199.234.147';
const vpsPort = args[args.indexOf('--vps-port') + 1] || '8899';
const targetBase = args[args.indexOf('--target') + 1] || 'C:\\Users\\Administrator\\Desktop\\toutiao-media';

if (!contentFile || !fs.existsSync(contentFile)) {
  console.error('❌ 错误：必须提供有效的内容文件路径');
  console.error('使用方式：node download-to-windows.cjs --content /path/to/content.json');
  process.exit(1);
}

// 读取内容
const content = JSON.parse(fs.readFileSync(contentFile, 'utf8'));
const dateDir = path.dirname(contentFile).split(path.sep).pop();

console.log('\n========================================');
console.log('下载文件到 Windows');
console.log('========================================\n');
console.log(`📄 内容 ID: ${content.id}`);
console.log(`📁 日期目录: ${dateDir}`);
console.log(`🌐 VPS: ${vpsHost}:${vpsPort}`);
console.log(`💾 目标目录: ${targetBase}\\${dateDir}`);
console.log('');

// 创建目标目录
const targetDir = path.join(targetBase, dateDir);
const targetImagesDir = path.join(targetDir, 'images');
const targetVideosDir = path.join(targetDir, 'videos');

[targetDir, targetImagesDir, targetVideosDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`✓ 创建目录: ${dir}`);
  }
});

console.log('');

// 下载文件
async function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const protocol = url.startsWith('https') ? https : http;

    protocol.get(url, response => {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}: ${url}`));
        return;
      }

      const totalSize = parseInt(response.headers['content-length'], 10);
      let downloadedSize = 0;

      response.on('data', chunk => {
        downloadedSize += chunk.length;
        const percent = ((downloadedSize / totalSize) * 100).toFixed(1);
        process.stdout.write(`   下载中... ${percent}%\r`);
      });

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        process.stdout.write('\n');
        resolve();
      });
    }).on('error', err => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

async function main() {
  let successCount = 0;
  let failCount = 0;

  try {
    // 下载图片
    if (content.images && content.images.length > 0) {
      console.log(`📥 下载图片 (${content.images.length} 张):`);
      for (const imgPath of content.images) {
        const filename = path.basename(imgPath);
        const url = `http://${vpsHost}:${vpsPort}/${dateDir}/${imgPath}`;
        const destPath = path.join(targetImagesDir, filename);

        try {
          console.log(`   ${filename}`);
          await downloadFile(url, destPath);
          console.log(`   ✓ 已保存: ${destPath}\n`);
          successCount++;
        } catch (err) {
          console.error(`   ❌ 下载失败: ${err.message}\n`);
          failCount++;
        }
      }
    }

    // 下载视频
    if (content.video) {
      console.log(`📥 下载视频:`);
      const filename = path.basename(content.video);
      const url = `http://${vpsHost}:${vpsPort}/${dateDir}/${content.video}`;
      const destPath = path.join(targetVideosDir, filename);

      try {
        console.log(`   ${filename}`);
        await downloadFile(url, destPath);
        console.log(`   ✓ 已保存: ${destPath}\n`);
        successCount++;
      } catch (err) {
        console.error(`   ❌ 下载失败: ${err.message}\n`);
        failCount++;
      }
    }

    // 下载视频封面
    if (content.cover) {
      console.log(`📥 下载封面:`);
      const filename = path.basename(content.cover);
      const url = `http://${vpsHost}:${vpsPort}/${dateDir}/${content.cover}`;
      const destPath = path.join(targetImagesDir, filename);

      try {
        console.log(`   ${filename}`);
        await downloadFile(url, destPath);
        console.log(`   ✓ 已保存: ${destPath}\n`);
        successCount++;
      } catch (err) {
        console.error(`   ❌ 下载失败: ${err.message}\n`);
        failCount++;
      }
    }

    console.log('========================================');
    console.log(`✅ 下载完成`);
    console.log(`   成功: ${successCount}`);
    console.log(`   失败: ${failCount}`);
    console.log('========================================\n');

    process.exit(failCount > 0 ? 1 : 0);

  } catch (err) {
    console.error('\n❌ 错误:', err.message);
    process.exit(1);
  }
}

main();
