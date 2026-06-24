#!/usr/bin/env node
// prepare-base-icon.js — 在 pkg 追加 snapshot overlay **之前**，把应用图标（悦升云端 logo）
// 嵌进 pkg 要用的 base Node 二进制。
//
// 为什么不能 pkg 打完再用 rcedit 改 exe（PR #841 的坏法，导致 2.0.25 不可用）：
//   pkg 把 [base node 二进制] + [payload] + [prelude] + [bakery] 顺序拼成 exe，
//   payload/prelude/bakery 就是「overlay」（bundled Node + 应用字节码），pkg 打包时已把
//   overlay 的绝对 offset 烤进 prelude。pkg 打完后再 rcedit --set-icon 改 PE 资源会插入
//   字节、整体后移 overlay → 烤死的 offset 失配 → 运行时 `Pkg: Error reading from file`。
//   现象：2.0.25 exe 只有 37.8MB（overlay 被截断），正常应 ~69-70MB。
//
// 正确做法：先把图标写进 base node 二进制，**再让 pkg 用这个已带图标的二进制打包**。
// overlay 在图标之后才追加，offset 基于「已带图标」的二进制计算 → offset 正确、overlay 完整。
//
// 健壮性（#846 教训：overlay 修对了但图标没嵌上，真机抠出来还是默认绿六边形 node 图标）：
// pkg 的 base 二进制缓存在 ~/.pkg-cache/<tag>/ 下，可能是 fetched-<ver>-win-x64 或
// built-<ver>-win-x64（取决于是否 forceBuild / 缓存命中哪个）。pkg-fetch.need() 返回当前会按
// forceBuild=false 解析到的那条，但为稳妥起见，本脚本对**缓存目录下所有 win-x64 的 node base
// 二进制**都写一遍图标（同一图标，幂等），保证不管 pkg 最终挑哪条都带图标。写完逐个**回读校验**
// 体积真增长（rcedit 返回成功不等于资源真写进去——回读才是 proven-to-fire），主 base 没写成功
// 直接硬失败，绝不出一个图标没改对的包。
//
// 用法：node scripts/prepare-base-icon.js <ico>
//
// 平台守卫：rcedit 只能在 Windows（或 wine）上改 PE 资源；打 win exe 的链路只在
// agent-installpack.yml 的 windows-latest runner 跑。非 Windows 直接跳过（不报错）。
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// 很多大尺寸图标在 .ico 里用 PNG 压缩存储，嵌进 PE 资源后二进制里会出现 PNG 头，做辅证。
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function findCachedWinBinaries() {
  // pkg-fetch 缓存路径：PKG_CACHE_PATH 或 ~/.pkg-cache。各 tag 目录（v3.x）里
  // fetched-vX-win-x64 / built-vX-win-x64 是 base 二进制。
  const cacheRoot = process.env.PKG_CACHE_PATH || path.join(os.homedir(), '.pkg-cache');
  const found = [];
  if (!fs.existsSync(cacheRoot)) return found;
  for (const tag of fs.readdirSync(cacheRoot)) {
    const tagDir = path.join(cacheRoot, tag);
    let stat;
    try {
      stat = fs.statSync(tagDir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    for (const name of fs.readdirSync(tagDir)) {
      if (/^(fetched|built)-v\d+\.\d+\.\d+-win-x64$/.test(name)) {
        found.push(path.join(tagDir, name));
      }
    }
  }
  return found;
}

async function iconAndVerify(rcedit, binaryPath, icoPath) {
  const before = fs.statSync(binaryPath).size;
  await rcedit(binaryPath, { icon: icoPath });
  const after = fs.statSync(binaryPath).size;
  const grew = after - before;

  let hasPng = false;
  try {
    hasPng = fs.readFileSync(binaryPath).includes(PNG_SIG);
  } catch {
    // 大文件读失败不致命，以体积增长为准
  }
  // 图标资源 ~360KB；保守门槛 1KB（rcedit 没真写则 grew≈0）。
  const ok = grew > 1024;
  console.log(
    `[prepare-base-icon] ${ok ? 'OK' : 'WARN'} ${binaryPath} ` +
      `${before} -> ${after} bytes (delta=${grew}, png-in-ico=${hasPng})`,
  );
  return ok;
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

  // 1) 先让 pkg-fetch 确保「当前会被 pkg 选中的」base 二进制就位并拿到其路径（主目标）。
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { need } = require('pkg-fetch');
  console.log('[prepare-base-icon] pkg-fetch.need(node18-win-x64) — 确保 base 二进制就位…');
  const primary = await need({ nodeRange: 'node18', platform: 'win', arch: 'x64' });
  console.log(`[prepare-base-icon] pkg-fetch 返回主 base: ${primary}`);

  // 2) 收集缓存目录下所有 win-x64 base 二进制（fetched- / built-），连同主目标去重。
  const candidates = new Set();
  if (primary && fs.existsSync(primary)) candidates.add(path.resolve(primary));
  for (const p of findCachedWinBinaries()) {
    if (fs.existsSync(p)) candidates.add(path.resolve(p));
  }
  if (candidates.size === 0) {
    console.error('[prepare-base-icon] 缓存里找不到任何 win-x64 base 二进制，无法写图标');
    process.exit(1);
  }
  console.log(`[prepare-base-icon] 将给 ${candidates.size} 个 base 二进制写图标:`);
  for (const p of candidates) console.log(`  - ${p}`);

  // 3) 逐个写图标 + 回读校验。
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const rcedit = require('rcedit');
  let primaryOk = false;
  for (const p of candidates) {
    const ok = await iconAndVerify(rcedit, p, icoPath);
    if (primary && path.resolve(primary) === p) primaryOk = ok;
  }

  // 主 base（pkg 真正会用的那条）必须写成功，否则硬失败——绝不出一个图标没改对的包。
  if (primary && !primaryOk) {
    console.error(
      `[prepare-base-icon] 失败：主 base 二进制 ${primary} 图标未写入（体积未增长）。不能出图标错误的包。`,
    );
    process.exit(1);
  }
  console.log('[prepare-base-icon] DONE：base 二进制已带图标，pkg 随后追加 overlay 在图标之后');
}

main().catch((err) => {
  console.error(`[prepare-base-icon] 失败：${err && err.message ? err.message : err}`);
  process.exit(1);
});
