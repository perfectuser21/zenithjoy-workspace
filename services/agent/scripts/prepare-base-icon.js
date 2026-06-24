#!/usr/bin/env node
// prepare-base-icon.js — 在 pkg 追加 snapshot overlay **之前**，把应用图标（悦升云端 logo）
// 嵌进 pkg 要用的 base Node 二进制。
//
// 为什么不能 pkg 打完再用 rcedit 改 exe（PR #841 的坏法，导致 2.0.25 不可用）：
//   pkg 把 [base node 二进制] + [payload] + [prelude] + [bakery] 顺序拼成 exe，
//   payload/prelude/bakery 就是「overlay」（bundled Node 字节码 + 应用快照），
//   pkg 在打包时已把 overlay 的绝对 offset 烤进 prelude（PAYLOAD_POSITION 等）。
//   pkg 打完后再用 rcedit --set-icon 改 PE 资源段会插入字节、整体后移 overlay，
//   烤死的 offset 失配 → 运行时 `Pkg: Error reading from file` → agent 起不来。
//   现象：2.0.25 exe 只有 37.8MB（overlay 被截断），正常应 ~69-70MB。
//
// 正确做法（本脚本）：先把图标写进 base node 二进制，**再让 pkg 用这个已带图标的二进制打包**。
// 这样 overlay 在图标之后才追加，所有 offset 都基于「已带图标」的二进制计算 → offset 正确、overlay 完整。
//
// 机制：pkg 通过 pkg-fetch 的 need() 把 base 二进制缓存到 ~/.pkg-cache/<tag>/fetched-<ver>-win-x64。
// 本脚本调同一个 need() 拿到那条路径，对它原地 rcedit 写图标。pkg 随后用同一缓存路径（同 target
// → 同 needViaCache 命中），拿到的就是已带图标的二进制。
//
// 用法：node scripts/prepare-base-icon.js <ico>
//   例：node scripts/prepare-base-icon.js build/icon.ico
//
// 平台守卫：rcedit 只能在 Windows（或 wine）上改 PE 资源；打 win exe 的链路只在
// agent-installpack.yml 的 windows-latest runner 跑。非 Windows 直接跳过（不报错），
// 让本地 mac/linux 误调 package:win 时不至于硬失败（exe 就没图标，但能继续打）。
'use strict';

const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const icoPath = process.argv[2];
  if (!icoPath) {
    console.error('[prepare-base-icon] 用法: node prepare-base-icon.js <ico>');
    process.exit(1);
  }

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

  // pkg-fetch.need() 与 pkg 内部 needViaCache 走同一逻辑：确保 base 二进制在缓存里并返回其路径。
  // node18-win-x64 → nodeRange 'node18' / platform 'win' / arch 'x64'。
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { need } = require('pkg-fetch');
  console.log('[prepare-base-icon] pkg-fetch.need(node18-win-x64) — 确保 base 二进制就位…');
  const binaryPath = await need({
    nodeRange: 'node18',
    platform: 'win',
    arch: 'x64',
  });

  if (!binaryPath || !fs.existsSync(binaryPath)) {
    console.error(`[prepare-base-icon] pkg-fetch 未返回有效 base 二进制路径: ${binaryPath}`);
    process.exit(1);
  }
  console.log(`[prepare-base-icon] base 二进制: ${binaryPath} (${fs.statSync(binaryPath).size} bytes)`);

  // 对 base 二进制原地写图标。rcedit 此刻改 PE 资源段是安全的：此时还没有 overlay，
  // pkg 随后基于这个已改好的二进制计算 overlay offset。
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const rcedit = require('rcedit');
  await rcedit(binaryPath, { icon: path.resolve(icoPath) });
  console.log(
    `[prepare-base-icon] OK：已把 ${icoPath} 写进 base 二进制（${fs.statSync(binaryPath).size} bytes），` +
      'pkg 随后用它打包，overlay 将完整追加在图标之后',
  );
}

main().catch((err) => {
  console.error(`[prepare-base-icon] 失败：${err && err.message ? err.message : err}`);
  process.exit(1);
});
