// services/agent/src/__tests__/start-bat-listener-and-env.test.ts
//
// Hand-off 2 回归（start.bat 可测部分）：
//   B — 单实例守卫除了杀 zenithjoy-agent core，还要按命令行匹配杀掉所有 *listen_chat* 的
//       python/python-embedded 孤儿 listener（否则旧 listener 再跑满 24h 抢微信 + 假"未安装"）。
//   F — 安装包支持选环境：读 .env 的 ZENITHJOY_ENV=staging 时指向 staging-autopilot，
//       默认（unset / prod）仍指向生产 autopilot（向后兼容）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const INSTALL_PACK = resolve(__dirname, '../../install-pack');
const START_BAT = readFileSync(resolve(INSTALL_PACK, 'start.bat'), 'utf-8');

describe('start.bat — B 杀孤儿 listen_chat listener', () => {
  it('单实例守卫按命令行匹配杀掉 *listen_chat* 进程（不只杀 core exe）', () => {
    // 用 Get-CimInstance + CommandLine -like *listen_chat* 匹配 python 孤儿 listener
    expect(START_BAT).toMatch(/listen_chat/);
    expect(START_BAT).toMatch(/Get-CimInstance/i);
    expect(START_BAT).toMatch(/CommandLine\s+-like/i);
  });

  it('listen_chat 清理出现在 agent 启动命令之前', () => {
    const killIdx = START_BAT.indexOf('listen_chat');
    const startIdx = START_BAT.indexOf('\nzenithjoy-agent.exe');
    expect(killIdx).toBeGreaterThan(-1);
    expect(startIdx).toBeGreaterThan(-1);
    expect(killIdx).toBeLessThan(startIdx);
  });
});

describe('start.bat — F 安装包环境选择', () => {
  it('读 ZENITHJOY_ENV，staging 时指向 staging-autopilot 中台', () => {
    expect(START_BAT).toMatch(/ZENITHJOY_ENV/);
    expect(START_BAT).toContain('staging-autopilot.zenjoymedia.media');
    // staging 的 ws + https 两个地址都要给
    expect(START_BAT).toContain('wss://staging-autopilot.zenjoymedia.media/agent-ws');
    expect(START_BAT).toContain('https://staging-autopilot.zenjoymedia.media');
  });

  it('默认仍指向生产 autopilot（向后兼容，不破坏现有客户）', () => {
    expect(START_BAT).toContain('wss://autopilot.zenjoymedia.media/agent-ws');
    expect(START_BAT).toContain('https://autopilot.zenjoymedia.media');
  });

  it('环境选择出现在 License 校验（precheck）之前，先确定 API_BASE 再校验', () => {
    const envIdx = START_BAT.indexOf('ZENITHJOY_ENV');
    const precheckIdx = START_BAT.indexOf('[precheck] verifying license');
    expect(envIdx).toBeGreaterThan(-1);
    expect(precheckIdx).toBeGreaterThan(-1);
    expect(envIdx).toBeLessThan(precheckIdx);
  });
});
