#!/usr/bin/env node
'use strict';
/**
 * 长文统一发布入口 publish-article.cjs
 *
 * 用法：
 *   node publish-article.cjs \
 *     --title "文章标题" \
 *     --content "HTML 或纯文本正文" \
 *     [--cover "/path/to/cover.jpg"] \
 *     [--digest "摘要（可选）"] \
 *     [--platforms wechat,zhihu,toutiao,weibo]
 *
 * 支持平台（默认全发）：
 *   wechat 公众号 / zhihu 知乎 / toutiao 头条 / weibo 微博
 *
 * content 参数：
 *   - 若以 <html 或 <!DOCTYPE 开头，视为 HTML → 写入 content.html
 *   - 否则视为纯文本 → 写入 content.txt（各平台脚本自行转换）
 *   - 也可传文件路径（以 / 或 ./ 开头且文件存在）→ 直接读取
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { spawn } = require('child_process');

// ── 平台配置 ─────────────────────────────────────────────────
const PLATFORMS = {
  wechat:  { name: '公众号', script: 'wechat-publisher/publish-wechat-article.cjs',  argStyle: 'content-dir' },
  zhihu:   { name: '知乎',   script: 'zhihu-publisher/publish-zhihu-article.cjs',    argStyle: 'content' },
  toutiao: { name: '头条',   script: 'toutiao-publisher/publish-toutiao-article.cjs', argStyle: 'content' },
  weibo:   { name: '微博',   script: 'weibo-publisher/publish-weibo-article.cjs',    argStyle: 'content' },
};

const SCRIPT_DIR = __dirname;
const NODE_PATH  = '/Users/administrator/perfect21/cecelia/node_modules';

// ── 参数解析 ─────────────────────────────────────────────────
const argv = process.argv.slice(2);
function arg(name) {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : null;
}

const title      = arg('--title');
const contentArg = arg('--content');
const coverSrc   = arg('--cover');
const digest     = arg('--digest');
const platRaw    = arg('--platforms');

if (!title) {
  console.error('❌ --title 参数必填');
  process.exit(1);
}
if (!contentArg) {
  console.error('❌ --content 参数必填（HTML内容、纯文本或文件路径）');
  process.exit(1);
}

const targetPlatforms = platRaw
  ? platRaw.split(',').map(s => s.trim()).filter(s => PLATFORMS[s])
  : Object.keys(PLATFORMS);

// ── 解析正文内容 ──────────────────────────────────────────────
let contentBody = contentArg;
// 若是文件路径且存在，读取文件内容
if ((contentArg.startsWith('/') || contentArg.startsWith('./')) && fs.existsSync(contentArg)) {
  contentBody = fs.readFileSync(contentArg, 'utf8');
}

const isHtml = contentBody.trimStart().startsWith('<');

// ── 创建临时内容目录 ──────────────────────────────────────────
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-article-'));
fs.writeFileSync(path.join(tmpDir, 'title.txt'), title, 'utf8');

if (isHtml) {
  fs.writeFileSync(path.join(tmpDir, 'content.html'), contentBody, 'utf8');
} else {
  fs.writeFileSync(path.join(tmpDir, 'content.txt'), contentBody, 'utf8');
}

if (digest) {
  fs.writeFileSync(path.join(tmpDir, 'digest.txt'), digest, 'utf8');
}

if (coverSrc && fs.existsSync(coverSrc)) {
  const coverExt = path.extname(coverSrc) || '.jpg';
  fs.copyFileSync(coverSrc, path.join(tmpDir, `cover${coverExt}`));
}

console.log(`📁 内容目录：${tmpDir}`);
console.log(`📝 格式：${isHtml ? 'HTML' : '纯文本'}`);
console.log(`📢 发布平台：${targetPlatforms.map(k => PLATFORMS[k].name).join(' / ')}\n`);

// ── 并行发布 ─────────────────────────────────────────────────
const startAll = Date.now();
const jobs = targetPlatforms.map(platformId => {
  const { name, script, argStyle } = PLATFORMS[platformId];
  const scriptPath = path.join(SCRIPT_DIR, script);
  const start = Date.now();

  // 公众号用 --content-dir，其他用 --content
  const contentFlag = argStyle === 'content-dir' ? '--content-dir' : '--content';

  return new Promise(resolve => {
    const proc = spawn('node', [scriptPath, contentFlag, tmpDir], {
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
