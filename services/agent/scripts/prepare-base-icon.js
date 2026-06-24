#!/usr/bin/env node
// prepare-base-icon.js — 在 pkg 追加 snapshot overlay **之前**，把应用图标（悦升云端 logo）
// 嵌进 pkg 要用的 base Node 二进制，并改掉 pkg-fetch 的期望 hash 让它接受这个被改过的 base。
//
// 背景（三次踩坑后的完整真相）：
//   1) PR #841(2.0.25)：pkg 打完后 rcedit 改 exe 图标 → 截断追加在 exe 末尾的 snapshot overlay
//      → exe 37.8MB、运行时 `Pkg: Error reading from file` → agent 起不来。
//   2) PR #846(2.0.26)：改成 pkg **之前**给 base 二进制写图标。overlay 修对了（exe 67.5MB、
//      跑得起来、无 Pkg error），但真机抠 exe 图标还是**默认绿色六边形 node 图标**。
//   3) 真因（在 xian-rog 真机用 pkg-fetch 源码定位）：pkg 通过 pkg-fetch.need() 拿 base 二进制时，
//      会先 `hash(cached) === EXPECTED_HASHES[name]` 校验；我们 rcedit 改了 base → hash 变了 →
//      pkg 判定「Binary hash does NOT match. Re-fetching...」→ **重新下载一份原版（绿图标）base**
//      覆盖掉我们写好图标的那份 → 最终 exe 用的是原版绿图标 base。
//
// 正解（本脚本）：写完图标后，把 base 的**新 hash 写回 pkg-fetch 的 EXPECTED_HASHES**
// （改 node_modules/pkg-fetch/lib-es5/expected.js）。这样 pkg 随后 need() 校验时 hash 命中
//   → 直接复用我们带蓝色 logo 的 base → 打出来的 exe 既有正确图标、overlay 又完整
//   （overlay 在图标之后追加，offset 正确——已在真机验证 base+overlay 不破坏图标）。
//
// 顺序铁律：build → prepare-base-icon（need 下原版→写图标→patch hash）→ pkg。
//
// 用法：node scripts/prepare-base-icon.js <ico>
//
// 平台守卫：rcedit 只能在 Windows（或 wine）上改 PE 资源；打 win exe 的链路只在
// agent-installpack.yml 的 windows-latest runner 跑。非 Windows 直接跳过（不报错）。
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// 把 pkg-fetch 的 EXPECTED_HASHES['node-v<ver>-win-x64'] 改成 newHash。
// 解析 require 到的 pkg-fetch 主入口 → 推 lib-es5/expected.js 路径 → 正则替换那一行。
function patchExpectedHash(name, newHash) {
  // pkg-fetch 主入口在 dist/index.js 或 lib-es5/index.js；expected.js 与之同目录。
  const entry = require.resolve('pkg-fetch');
  const dir = path.dirname(entry);
  const candidates = [
    path.join(dir, 'expected.js'),
    path.join(dir, '..', 'lib-es5', 'expected.js'),
    path.join(dir, 'lib-es5', 'expected.js'),
  ];
  const expectedFile = candidates.find((p) => fs.existsSync(p));
  if (!expectedFile) {
    throw new Error(`找不到 pkg-fetch expected.js（试过: ${candidates.join(', ')}）`);
  }
  let src = fs.readFileSync(expectedFile, 'utf8');
  // 形如:  'node-v18.5.0-win-x64': 'e0e9a647...',
  const re = new RegExp(`('${name.replace(/\./g, '\\.')}':\\s*')[0-9a-f]+(')`);
  if (!re.test(src)) {
    throw new Error(`expected.js 里找不到 ${name} 的 hash 行，无法 patch`);
  }
  src = src.replace(re, `$1${newHash}$2`);
  fs.writeFileSync(expectedFile, src);
  // 回读确认
  if (!fs.readFileSync(expectedFile, 'utf8').includes(`'${newHash}'`)) {
    throw new Error('patch 后回读未命中新 hash');
  }
  return expectedFile;
}

// 由 base 二进制的实际文件名（fetched-v18.5.0-win-x64）推出 EXPECTED_HASHES 的 key
// （node-v18.5.0-win-x64）。
function remoteNameFromBinary(binaryPath) {
  const fname = path.basename(binaryPath); // fetched-v18.5.0-win-x64 / built-...
  const m = fname.match(/^(?:fetched|built)-(v\d+\.\d+\.\d+-win-x64)$/);
  if (!m) throw new Error(`base 二进制文件名不符预期: ${fname}`);
  return `node-${m[1]}`;
}

async function main() {
  const icoArg = process.argv[2];
  if (!icoArg) {
    console.error('[prepare-base-icon] 用法: node prepare-base-icon.js <ico>');
    process.exit(1);
  }
  const icoPath = path.resolve(icoArg);

  if (process.platform !== 'win32') {
    console.warn(
      `[prepare-base-icon] 跳过：当前平台 ${process.platform} 非 Windows，rcedit 不可用（exe 图标只在 windows runner 打）`,
    );
    process.exit(0);
  }

  if (!fs.existsSync(icoPath)) {
    console.error(`[prepare-base-icon] 找不到 icon: ${icoPath}（应为 build/icon.ico）`);
    process.exit(1);
  }
  console.log(`[prepare-base-icon] icon = ${icoPath} (${fs.statSync(icoPath).size} bytes)`);

  // 1) 让 pkg-fetch 下原版 base（此刻 hash 还匹配官方），拿到路径。
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { need } = require('pkg-fetch');
  console.log('[prepare-base-icon] pkg-fetch.need(node18-win-x64) — 下/取原版 base 二进制…');
  const binaryPath = await need({ nodeRange: 'node18', platform: 'win', arch: 'x64' });
  if (!binaryPath || !fs.existsSync(binaryPath)) {
    throw new Error(`pkg-fetch 未返回有效 base 二进制路径: ${binaryPath}`);
  }
  const before = fs.statSync(binaryPath).size;
  console.log(`[prepare-base-icon] base = ${binaryPath} (${before} bytes)`);

  // 2) rcedit 把图标写进 base。
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const rcedit = require('rcedit');
  await rcedit(binaryPath, { icon: icoPath });
  const after = fs.statSync(binaryPath).size;
  const grew = after - before;
  console.log(`[prepare-base-icon] rcedit 写图标: ${before} -> ${after} bytes (delta=${grew})`);
  if (grew <= 1024) {
    // 图标资源 ~360KB；几乎没增长 = rcedit 没真写进去 → 硬失败，绝不出图标错误的包。
    throw new Error('rcedit 后 base 体积几乎没增长，图标可能未写入');
  }

  // 3) 算新 hash，patch pkg-fetch EXPECTED_HASHES，让 pkg 接受这个改过的 base（否则 pkg
  //    会判 hash 不符、重新下原版覆盖掉我们的图标 —— 这正是 2.0.26 图标没生效的真因）。
  const newHash = sha256(binaryPath);
  const remoteName = remoteNameFromBinary(binaryPath);
  console.log(`[prepare-base-icon] base 新 sha256 = ${newHash}`);
  const patched = patchExpectedHash(remoteName, newHash);
  console.log(
    `[prepare-base-icon] 已 patch ${patched}：EXPECTED_HASHES['${remoteName}'] = 新 hash，` +
      'pkg 随后 need() 校验命中 → 复用带图标的 base',
  );
  console.log('[prepare-base-icon] DONE：base 已带图标且 pkg 不会再重新下原版覆盖');
}

main().catch((err) => {
  console.error(`[prepare-base-icon] 失败：${err && err.message ? err.message : err}`);
  process.exit(1);
});
