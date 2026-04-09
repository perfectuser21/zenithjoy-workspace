#!/usr/bin/env node
'use strict';
/**
 * 图文统一发布入口 publish-image.cjs
 *
 * 用法：
 *   node publish-image.cjs \
 *     --title "标题" \
 *     --content "正文内容" \
 *     --images "/path/img1.png,/path/img2.png" \
 *     [--platforms douyin,xiaohongshu,weibo,kuaishou,shipinhao,toutiao]
 *
 * 支持平台（默认全发）：
 *   douyin 抖音 / xiaohongshu 小红书 / weibo 微博 /
 *   kuaishou 快手 / shipinhao 视频号 / toutiao 头条
 *
 * 工作方式：
 *   1. 在 /tmp 创建临时内容目录（title.txt / content.txt / image1.jpg ...）
 *   2. 并行调用各平台脚本 --content <tmpdir>
 *   3. 汇总结果表格
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { spawnSync, spawn } = require('child_process');

// ── 平台配置 ─────────────────────────────────────────────────
// argStyle:
//   'content-dir' → node script.js --content <dir>  （小红书/微博/快手/视频号）
//   'json-douyin'  → node script.js <queue.json>，JSON: { title, content, images: [mac路径] }
//   'json-toutiao' → node script.js <config.json>，JSON: { content, images: [mac路径] }
const PLATFORMS = {
  douyin:      { name: '抖音',   script: 'douyin-publisher/publish-douyin-image.js',           argStyle: 'json-douyin' },
  xiaohongshu: { name: '小红书', script: 'xiaohongshu-publisher/publish-xiaohongshu-image.cjs', argStyle: 'content-dir' },
  weibo:       { name: '微博',   script: 'weibo-publisher/publish-weibo-image.cjs',             argStyle: 'content-dir' },
  kuaishou:    { name: '快手',   script: 'kuaishou-publisher/publish-kuaishou-image.cjs',       argStyle: 'content-dir' },
  shipinhao:   { name: '视频号', script: 'shipinhao-publisher/publish-shipinhao-image.cjs',     argStyle: 'content-dir' },
  toutiao:     { name: '头条',   script: 'toutiao-publisher/publish-toutiao-image.cjs',         argStyle: 'json-toutiao' },
};

const SCRIPT_DIR = __dirname;
const NODE_PATH  = '/Users/administrator/perfect21/cecelia/node_modules';

// ── 参数解析 ─────────────────────────────────────────────────
const argv = process.argv.slice(2);
function arg(name) {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : null;
}

const title     = arg('--title')    || '';
const content   = arg('--content')  || '';
const imagesRaw = arg('--images')   || '';
const platRaw   = arg('--platforms');

if (!imagesRaw) {
  console.error('❌ --images 参数必填，例如：--images "/path/img1.png,/path/img2.png"');
  process.exit(1);
}

const imageFiles    = imagesRaw.split(',').map(s => s.trim()).filter(Boolean);
const targetPlatforms = platRaw
  ? platRaw.split(',').map(s => s.trim()).filter(s => PLATFORMS[s])
  : Object.keys(PLATFORMS);

// ── 创建临时内容目录 ──────────────────────────────────────────
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-image-'));
if (title)   fs.writeFileSync(path.join(tmpDir, 'title.txt'),   title,   'utf8');
if (content) fs.writeFileSync(path.join(tmpDir, 'content.txt'), content, 'utf8');

imageFiles.forEach((src, i) => {
  const ext = path.extname(src) || '.jpg';
  const dest = path.join(tmpDir, `image${i + 1}${ext}`);
  fs.copyFileSync(src, dest);
});

console.log(`📁 内容目录：${tmpDir}`);
console.log(`🖼  图片：${imageFiles.length} 张`);
console.log(`📢 发布平台：${targetPlatforms.map(k => PLATFORMS[k].name).join(' / ')}\n`);

// ── 并行发布 ─────────────────────────────────────────────────
const startAll = Date.now();
const jobs = targetPlatforms.map(platformId => {
  const { name, script, argStyle } = PLATFORMS[platformId];
  const scriptPath = path.join(SCRIPT_DIR, script);
  const start = Date.now();

  // 根据 argStyle 决定调用参数
  let spawnArgs;
  let jsonFile = null;
  if (argStyle === 'json-douyin') {
    jsonFile = path.join(os.tmpdir(), `publish-douyin-${Date.now()}.json`);
    fs.writeFileSync(jsonFile, JSON.stringify({ title, content, images: imageFiles }), 'utf8');
    spawnArgs = [scriptPath, jsonFile];
  } else if (argStyle === 'json-toutiao') {
    jsonFile = path.join(os.tmpdir(), `publish-toutiao-${Date.now()}.json`);
    fs.writeFileSync(jsonFile, JSON.stringify({ content, images: imageFiles }), 'utf8');
    spawnArgs = [scriptPath, jsonFile];
  } else {
    spawnArgs = [scriptPath, '--content', tmpDir];
  }

  return new Promise(resolve => {
    const proc = spawn('node', spawnArgs, {
      env: { ...process.env, NODE_PATH },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '', stderr = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });

    proc.on('close', code => {
      if (jsonFile) try { fs.unlinkSync(jsonFile); } catch {}
      resolve({
        id: platformId,
        name,
        code,
        ms: Date.now() - start,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });

    // 超时 5 分钟
    setTimeout(() => { proc.kill(); resolve({ id: platformId, name, code: -1, ms: 300000, stdout: '', stderr: 'timeout' }); }, 300000);
  });
});

Promise.all(jobs).then(results => {
  const totalMs = Date.now() - startAll;
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  发布结果汇总');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  let pass = 0, fail = 0;
  results.forEach(r => {
    const icon = r.code === 0 ? '✅' : '❌';
    const secs = (r.ms / 1000).toFixed(1) + 's';
    console.log(`${icon} ${r.name.padEnd(6)} | ${r.code === 0 ? '成功' : `失败(${r.code})`} | ${secs}`);
    if (r.code !== 0 && r.stderr) console.log(`   └ ${r.stderr.split('\n')[0]}`);
    r.code === 0 ? pass++ : fail++;
  });

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`总计：${pass} 成功 / ${fail} 失败 | 耗时 ${(totalMs/1000).toFixed(1)}s`);

  // 清理临时目录
  fs.rmSync(tmpDir, { recursive: true, force: true });

  process.exit(fail > 0 ? 1 : 0);
});
