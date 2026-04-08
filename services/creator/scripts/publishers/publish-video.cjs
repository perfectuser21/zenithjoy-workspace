#!/usr/bin/env node
'use strict';
/**
 * 短视频统一发布入口 publish-video.cjs
 *
 * 用法：
 *   node publish-video.cjs \
 *     --title "标题" \
 *     --content "简介" \
 *     --video "/path/to/video.mp4" \
 *     [--cover "/path/to/cover.jpg"] \
 *     [--platforms douyin,xiaohongshu,weibo,kuaishou,shipinhao,toutiao]
 *
 * 支持平台（默认全发）：
 *   douyin 抖音 / xiaohongshu 小红书 / weibo 微博 /
 *   kuaishou 快手 / shipinhao 视频号 / toutiao 头条
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { spawn } = require('child_process');

// ── 平台配置 ─────────────────────────────────────────────────
const PLATFORMS = {
  douyin:      { name: '抖音',   script: 'douyin-publisher/publish-douyin-video.js' },
  xiaohongshu: { name: '小红书', script: 'xiaohongshu-publisher/publish-xiaohongshu-video.cjs' },
  weibo:       { name: '微博',   script: 'weibo-publisher/publish-weibo-video.cjs' },
  kuaishou:    { name: '快手',   script: 'kuaishou-publisher/publish-kuaishou-video.cjs' },
  shipinhao:   { name: '视频号', script: 'shipinhao-publisher/publish-shipinhao-video.cjs' },
  toutiao:     { name: '头条',   script: 'toutiao-publisher/publish-toutiao-video.cjs' },
};

const SCRIPT_DIR = __dirname;
const NODE_PATH  = '/Users/administrator/perfect21/cecelia/node_modules';

// ── 参数解析 ─────────────────────────────────────────────────
const argv = process.argv.slice(2);
function arg(name) {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : null;
}

const title    = arg('--title')    || '';
const content  = arg('--content')  || '';
const videoSrc = arg('--video');
const coverSrc = arg('--cover');
const platRaw  = arg('--platforms');

if (!videoSrc) {
  console.error('❌ --video 参数必填，例如：--video "/path/to/video.mp4"');
  process.exit(1);
}
if (!fs.existsSync(videoSrc)) {
  console.error(`❌ 视频文件不存在：${videoSrc}`);
  process.exit(1);
}

const targetPlatforms = platRaw
  ? platRaw.split(',').map(s => s.trim()).filter(s => PLATFORMS[s])
  : Object.keys(PLATFORMS);

// ── 创建临时内容目录 ──────────────────────────────────────────
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-video-'));
if (title)   fs.writeFileSync(path.join(tmpDir, 'title.txt'),   title,   'utf8');
if (content) fs.writeFileSync(path.join(tmpDir, 'content.txt'), content, 'utf8');

const videoExt  = path.extname(videoSrc) || '.mp4';
fs.copyFileSync(videoSrc, path.join(tmpDir, `video${videoExt}`));

if (coverSrc && fs.existsSync(coverSrc)) {
  const coverExt = path.extname(coverSrc) || '.jpg';
  fs.copyFileSync(coverSrc, path.join(tmpDir, `cover${coverExt}`));
}

console.log(`📁 内容目录：${tmpDir}`);
console.log(`🎬 视频：${path.basename(videoSrc)}`);
console.log(`📢 发布平台：${targetPlatforms.map(k => PLATFORMS[k].name).join(' / ')}\n`);

// ── 并行发布 ─────────────────────────────────────────────────
const startAll = Date.now();
const jobs = targetPlatforms.map(platformId => {
  const { name, script } = PLATFORMS[platformId];
  const scriptPath = path.join(SCRIPT_DIR, script);
  const start = Date.now();

  return new Promise(resolve => {
    const proc = spawn('node', [scriptPath, '--content', tmpDir], {
      env: { ...process.env, NODE_PATH },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '', stderr = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });

    proc.on('close', code => {
      resolve({ id: platformId, name, code, ms: Date.now() - start, stdout: stdout.trim(), stderr: stderr.trim() });
    });

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

  fs.rmSync(tmpDir, { recursive: true, force: true });
  process.exit(fail > 0 ? 1 : 0);
});
