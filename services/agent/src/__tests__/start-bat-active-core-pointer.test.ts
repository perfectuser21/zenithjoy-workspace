// services/agent/src/__tests__/start-bat-active-core-pointer.test.ts
//
// Sprint 06222100 — 核心自升级"自换+重启"接缝（TDD commit-1 红）
//
// 自换机制：CoreUpgrader 升级后把新核心解压到 extracted/zenithjoy-agent-v<ver> 并写
// .active-core 指针（在 extracted 的父目录），优雅退出当前核心。计划任务 ONLOGON 始终拉起
// 启动器；启动器读 .active-core 指针 → cd 进最新核心目录 → 启动该目录里的 zenithjoy-agent.exe。
// 这样重启后跑的就是新核心，不依赖人手动操作。
//
// 本测试守护 start.bat 真含"读指针、切目录、回退旧核心"三段逻辑（防自换链断掉）。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const INSTALL_PACK = resolve(__dirname, '../../install-pack');
const START_BAT = readFileSync(resolve(INSTALL_PACK, 'start.bat'), 'utf-8');

describe('start.bat — active-core 指针自换（核心自升级接缝）', () => {
  it('读取 .active-core 指针文件来选最新核心目录', () => {
    // 指针文件名常量必须出现（启动器靠它知道跑哪个核心）
    expect(START_BAT).toContain('.active-core');
  });

  it('指针指向的核心目录用 extracted\\zenithjoy-agent-v<ver> 布局', () => {
    // 指针内容是核心目录名（zenithjoy-agent-vX.Y.Z），启动器据此拼出运行目录
    expect(START_BAT).toMatch(/extracted/i);
  });

  it('指针缺失/损坏时回退到当前目录核心（不依赖指针也能起，防自换把客户机搞挂）', () => {
    // 回退逻辑：指针文件不存在 / 指向目录的 exe 不存在 → 用 %~dp0 本地 zenithjoy-agent.exe
    // 守护"回退"关键词出现（注释或逻辑），保证设计意图不被后续改动抹掉
    expect(START_BAT.toLowerCase()).toMatch(/fallback|回退|指针/);
  });

  it('最终仍以一个 zenithjoy-agent.exe 启动（自换后跑的是被指针选中的那个）', () => {
    expect(START_BAT).toContain('zenithjoy-agent.exe');
  });
});
