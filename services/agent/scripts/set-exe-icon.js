#!/usr/bin/env node
// set-exe-icon.js — 给 pkg 产出的 Windows exe 写应用图标（悦升云端 logo）。
//
// 为什么需要本脚本：vercel/pkg 5.x **没有** --icon 选项，无法在打包时指定 exe 图标。
// 真正能设 Windows exe 资源图标的是 rcedit（微软资源编辑器的封装）。pkg 打完后跑一次：
//   node scripts/set-exe-icon.js zenithjoy-agent.exe build/icon.ico
//
// 平台守卫：rcedit 只能在 Windows（或 wine）上改 PE 资源。打包 win exe 的链路只在
// agent-installpack.yml 的 windows-latest runner 上跑，故此处非 Windows 直接跳过（不报错），
// 让本地 mac/linux 误调 package:win 时不至于硬失败。
'use strict';

const fs = require('node:fs');

const exePath = process.argv[2];
const icoPath = process.argv[3];

if (!exePath || !icoPath) {
  console.error('[set-exe-icon] 用法: node set-exe-icon.js <exe> <ico>');
  process.exit(1);
}

if (process.platform !== 'win32') {
  console.warn(`[set-exe-icon] 跳过：当前平台 ${process.platform} 非 Windows，rcedit 不可用（exe 图标只在 windows runner 打）`);
  process.exit(0);
}

if (!fs.existsSync(exePath)) {
  console.error(`[set-exe-icon] 找不到 exe: ${exePath}`);
  process.exit(1);
}
if (!fs.existsSync(icoPath)) {
  console.error(`[set-exe-icon] 找不到 icon: ${icoPath}（应为 build/icon.ico）`);
  process.exit(1);
}

// rcedit 3.x = CommonJS，导出 (exe, options) => Promise
// eslint-disable-next-line @typescript-eslint/no-var-requires
const rcedit = require('rcedit');

rcedit(exePath, { icon: icoPath })
  .then(() => {
    console.log(`[set-exe-icon] OK：已把 ${icoPath} 写进 ${exePath} 应用图标`);
  })
  .catch((err) => {
    console.error(`[set-exe-icon] 失败：${err && err.message ? err.message : err}`);
    process.exit(1);
  });
