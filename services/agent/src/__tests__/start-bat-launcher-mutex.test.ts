// services/agent/src/__tests__/start-bat-launcher-mutex.test.ts
//
// 根因③（2026-07-03 v2.0.52、2026-07-04 v2.0.69×3 实锤）：每个版本目录的 start.bat 都是
// 永不退出的 supervise 循环，且 Step 6.95 每轮无差别杀所有 agent。多个旧版循环并存时 =
// 永动搅拌机：互相杀对方刚拉起的 core，新旧实例互相"已有实例"集体秒退，客户机永久churn。
//
// 守护（launcher 级单实例 + 版本自检）：
//   1. start.bat 进入 supervise 循环前必须先抢 launcher 锁（.launcher.lock）；
//   2. 循环每轮必须重读锁验证自己仍是 owner，不是 → 退出循环（绝不再杀/再拉）；
//   3. 无差别杀 agent（Step 6.95）必须发生在 owner 确认之后；
//   4. 拉起 core 前设 ZJ_SUPERVISED=1（upgrader 据此决定"退出等拉起"还是"自己拉起新核心"）。
//
// proven-to-fire：删掉 .launcher.lock 逻辑 / owner 重验 / ZJ_SUPERVISED → 对应断言立即红。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const INSTALL_PACK = resolve(__dirname, '../../install-pack');
const START_BAT = readFileSync(resolve(INSTALL_PACK, 'start.bat'), 'utf-8');

describe('start.bat — launcher 级单实例锁（多循环打架根治）', () => {
  it('存在 launcher 锁文件逻辑（.launcher.lock）', () => {
    expect(START_BAT).toContain('.launcher.lock');
  });

  it('supervise 循环内每轮重验 owner：非 owner 分支退出（:LAUNCHER_LOST_OWNERSHIP）', () => {
    expect(START_BAT).toContain(':LAUNCHER_LOST_OWNERSHIP');
    const loopIdx = START_BAT.indexOf(':AGENT_SUPERVISE_LOOP');
    const gotoLoopIdx = START_BAT.search(/goto\s+:AGENT_SUPERVISE_LOOP/i);
    // owner 重验必须发生在循环体内（标签之后、goto 回跳之前）
    const ownerCheckIdx = START_BAT.indexOf('.launcher.lock', loopIdx);
    expect(loopIdx).toBeGreaterThan(-1);
    expect(ownerCheckIdx).toBeGreaterThan(loopIdx);
    expect(ownerCheckIdx).toBeLessThan(gotoLoopIdx);
  });

  it('无差别杀 agent 进程（Stop-Process zenithjoy-agent）在循环内位于 owner 重验之后', () => {
    const loopIdx = START_BAT.indexOf(':AGENT_SUPERVISE_LOOP');
    const ownerCheckIdx = START_BAT.indexOf('.launcher.lock', loopIdx);
    const killIdx = START_BAT.indexOf('Stop-Process', loopIdx);
    expect(killIdx).toBeGreaterThan(ownerCheckIdx);
  });

  it('拉起 core 前设置 ZJ_SUPERVISED=1（upgrader 交接信号）', () => {
    expect(START_BAT).toMatch(/set\s+"?ZJ_SUPERVISED=1/i);
    // 必须在最终 launch 之前
    const setIdx = START_BAT.search(/set\s+"?ZJ_SUPERVISED=1/i);
    const launchIdx = START_BAT.lastIndexOf('zenithjoy-agent.exe');
    expect(setIdx).toBeGreaterThan(-1);
    expect(setIdx).toBeLessThan(launchIdx);
  });
});
