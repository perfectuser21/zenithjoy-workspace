// services/agent/src/__tests__/start-bat-supervise-relaunch.test.ts
//
// P1⑤ 保活（TDD commit-1 红）— 2026-07-01 真机根因
//
// 真机铁证：rog 上 core 11:08 自升级到新版本后【整个进程死了、几小时没有自动重启】，
// 客户 11:40/11:55 发消息时根本没进程接 → 不回。
//
// 根因（已坐实）：CoreUpgrader 升级时写 .active-core 指针后【优雅退出 process.exit(0)】，
// 把"拉起新核心"交给 start.bat。但旧 start.bat 只【前台跑一次】zenithjoy-agent.exe，
// 退出后就【落到脚本末尾结束】——没有重启循环。它注释里指望"ONLOGON 计划任务重新拉起"，
// 但 ONLOGON 只在【登录时】触发，不在会话中途 core 退出时触发 → 自升级/崩溃后核心一直死到下次登录。
//
// 本测试守护 start.bat 必须是【监督循环（supervisor loop）】：core 任何退出后都回到循环重跑
// （重读 .active-core → 单实例清理 → 重新拉起），绝不"跑一次就落幕"。任何人把循环去掉→CI 立即红。
//
// proven-to-fire：删掉 :AGENT_SUPERVISE_LOOP 标签或那句 goto，或把最终 launch 改回一次性执行，
// 下列断言立即红。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const INSTALL_PACK = resolve(__dirname, '../../install-pack');
const START_BAT = readFileSync(resolve(INSTALL_PACK, 'start.bat'), 'utf-8');

describe('start.bat — core 退出后自动重启的监督循环（P1⑤ 保活）', () => {
  it('存在监督循环标签 :AGENT_SUPERVISE_LOOP', () => {
    expect(START_BAT).toContain(':AGENT_SUPERVISE_LOOP');
  });

  it('core 退出后 goto 回循环重启，而不是落到脚本末尾结束', () => {
    expect(START_BAT).toMatch(/goto\s+:AGENT_SUPERVISE_LOOP/i);
  });

  it('循环体在启动 core 之后（launch 在循环内，每轮重读指针拉起新核心）', () => {
    const loopIdx = START_BAT.indexOf(':AGENT_SUPERVISE_LOOP');
    const lastLaunchIdx = START_BAT.lastIndexOf('zenithjoy-agent.exe');
    const gotoIdx = START_BAT.search(/goto\s+:AGENT_SUPERVISE_LOOP/i);
    expect(loopIdx).toBeGreaterThan(-1);
    expect(lastLaunchIdx).toBeGreaterThan(loopIdx);
    expect(gotoIdx).toBeGreaterThan(lastLaunchIdx);
  });

  it('每轮重读 .active-core 指针（自升级换新核心：指针读取在循环入口之后）', () => {
    const loopIdx = START_BAT.indexOf(':AGENT_SUPERVISE_LOOP');
    const pointerIdx = START_BAT.indexOf('.active-core', loopIdx);
    expect(loopIdx).toBeGreaterThan(-1);
    expect(pointerIdx).toBeGreaterThan(loopIdx);
  });

  it('崩溃退出不再用 pause 命令卡死（pause 会挡住重启循环）', () => {
    // 只查【pause 命令】（行首、非 REM 注释），不误伤注释里解释性提到的 "pause" 字样
    const lastLaunchIdx = START_BAT.lastIndexOf('zenithjoy-agent.exe');
    const tail = START_BAT.slice(lastLaunchIdx);
    const pauseCommand = tail.split(/\r?\n/).some((line) => /^[ \t]*pause\b/i.test(line));
    expect(pauseCommand).toBe(false);
  });
});
