#!/usr/bin/env node
/**
 * 准备文件传输队列
 *
 * 扫描队列目录，为 file-receiver 生成 queue.json
 *
 * 使用方式：
 * node prepare-queue.cjs --date 2026-02-09 --content micro-test-001.json
 */

const fs = require('fs');
const path = require('path');

// 配置
const QUEUE_BASE = '/home/xx/.toutiao-queue';
const HTTP_ROOT = '/home/xx/.toutiao-queue'; // HTTP 服务器根目录

// 参数
const args = process.argv.slice(2);
const date = args[args.indexOf('--date') + 1];
const contentFile = args[args.indexOf('--content') + 1];

if (!date || !contentFile) {
  console.error('❌ 错误：必须提供日期和内容文件');
  console.error('使用方式：node prepare-queue.cjs --date 2026-02-09 --content micro-test-001.json');
  process.exit(1);
}

const dateDir = path.join(QUEUE_BASE, date);
const contentPath = path.join(dateDir, contentFile);

if (!fs.existsSync(contentPath)) {
  console.error(`❌ 错误：内容文件不存在: ${contentPath}`);
  process.exit(1);
}

console.log('\n========================================');
console.log('准备文件传输队列');
console.log('========================================\n');
console.log(`📁 日期: ${date}`);
console.log(`📄 内容: ${contentFile}`);
console.log('');

// 读取内容
const content = JSON.parse(fs.readFileSync(contentPath, 'utf8'));

// 收集文件列表
const files = [];

// 图片
if (content.images && content.images.length > 0) {
  content.images.forEach(imgPath => {
    const fullPath = path.join(dateDir, imgPath);
    if (fs.existsSync(fullPath)) {
      const stat = fs.statSync(fullPath);
      files.push({
        date,
        path: imgPath,
        type: 'image',
        size: stat.size,
        filename: path.basename(imgPath)
      });
      console.log(`✓ 图片: ${imgPath} (${(stat.size / 1024).toFixed(1)} KB)`);
    } else {
      console.warn(`⚠️  图片不存在: ${imgPath}`);
    }
  });
}

// 视频
if (content.video) {
  const fullPath = path.join(dateDir, content.video);
  if (fs.existsSync(fullPath)) {
    const stat = fs.statSync(fullPath);
    files.push({
      date,
      path: content.video,
      type: 'video',
      size: stat.size,
      filename: path.basename(content.video)
    });
    console.log(`✓ 视频: ${content.video} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
  } else {
    console.warn(`⚠️  视频不存在: ${content.video}`);
  }
}

// 封面
if (content.cover) {
  const fullPath = path.join(dateDir, content.cover);
  if (fs.existsSync(fullPath)) {
    const stat = fs.statSync(fullPath);
    files.push({
      date,
      path: content.cover,
      type: 'image',
      size: stat.size,
      filename: path.basename(content.cover)
    });
    console.log(`✓ 封面: ${content.cover} (${(stat.size / 1024).toFixed(1)} KB)`);
  } else {
    console.warn(`⚠️  封面不存在: ${content.cover}`);
  }
}

console.log('');

if (files.length === 0) {
  console.log('⚠️  没有文件需要传输');
  process.exit(0);
}

// 生成 queue.json
const queueData = {
  generated: new Date().toISOString(),
  content: {
    type: content.type,
    id: content.id,
    date
  },
  files,
  totalSize: files.reduce((sum, f) => sum + f.size, 0)
};

const queuePath = path.join(HTTP_ROOT, 'queue.json');
fs.writeFileSync(queuePath, JSON.stringify(queueData, null, 2));

console.log(`📝 队列文件已生成: ${queuePath}`);
console.log(`📊 文件数量: ${files.length}`);
console.log(`💾 总大小: ${(queueData.totalSize / 1024 / 1024).toFixed(2)} MB`);
console.log('');
console.log('✅ 准备完成！File receiver 将在下次检查时下载这些文件\n');
