// TDD Red — Agent 客户端封装（去黑窗 + 托盘静默通知）
// 第一个 commit：失败测试定义"什么叫完成"。实现前这些断言全部应 FAIL：
//   - start.vbs 尚不存在
//   - tray.ts 仍含 powershell 通知路径
//   - install-autostart.ps1 仍指向 start.bat
//   - build-install-pack.sh 未拷 start.vbs
//   - package.json 无 node-notifier 依赖
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const AGENT = resolve(__dirname, '../../../services/agent');
const read = (p: string) => (existsSync(resolve(AGENT, p)) ? readFileSync(resolve(AGENT, p), 'utf-8') : '');

describe('Agent 客户端封装 [BEHAVIOR]', () => {
  describe('Step 1/5 — start.vbs 无窗口入口 + 日志轮转', () => {
    it('start.vbs 存在', () => {
      expect(existsSync(resolve(AGENT, 'install-pack/start.vbs'))).toBe(true);
    });
    it('start.vbs 用 windowStyle=0 隐藏拉起 start.bat', () => {
      const vbs = read('install-pack/start.vbs');
      expect(vbs).toMatch(/\.Run\b.*,\s*0\s*,/);
      expect(vbs).toContain('start.bat');
    });
    it('start.vbs 写 launch.log 并按大小轮转', () => {
      const vbs = read('install-pack/start.vbs');
      expect(vbs).toContain('launch.log');
      expect(vbs).toMatch(/1048576|\.Size|GetFile/);
    });
  });

  describe('边界 R2 — vbs 拉起失败写 launch.log 留痕（PRD 边界#2）', () => {
    it('start.vbs 含错误处理且失败时写 launch.log', () => {
      const vbs = read('install-pack/start.vbs');
      expect(vbs).toMatch(/On Error|Err\.|ERROR/i);
      expect(vbs).toContain('launch.log');
    });
  });

  describe('Step 2 — 单实例守卫', () => {
    it('start.vbs 探测 zenithjoy-agent.exe 已运行则跳过', () => {
      const vbs = read('install-pack/start.vbs');
      expect(vbs).toContain('Win32_Process');
      expect(vbs).toContain('zenithjoy-agent.exe');
      expect(vbs).toMatch(/Quit|skip|already/i);
    });
  });

  describe('Step 3 — 通知去 powershell 改 node-notifier/降级红点', () => {
    it('tray.ts 不再含任何 powershell 路径', () => {
      expect(read('src/tray.ts')).not.toContain('powershell');
    });
    it('tray.ts showModuleError 走 node-notifier', () => {
      const tray = read('src/tray.ts');
      expect(tray).toContain('node-notifier');
      expect(tray).toContain('showModuleError');
    });
  });

  describe('Step 4 — 开机自启指向 start.vbs', () => {
    it('install-autostart.ps1 目标是 start.vbs 而非 start.bat', () => {
      const ps = read('install-pack/install-autostart.ps1');
      expect(ps).toContain('start.vbs');
      expect(ps).not.toMatch(/Target\s*=.*start\.bat'/);
    });
  });

  describe('Step 6/7 — 打包 + 依赖', () => {
    it('build-install-pack.sh 拷贝 start.vbs', () => {
      expect(read('scripts/build-install-pack.sh')).toContain('install-pack/start.vbs');
    });
    it('package.json 含 node-notifier 依赖', () => {
      const pkg = JSON.parse(read('package.json') || '{}');
      expect(pkg.dependencies?.['node-notifier']).toBeTruthy();
    });
  });

  describe('E2E test seam — start.bat probe 守卫', () => {
    it('start.bat 含 ZJ_LAUNCH_PROBE 早退守卫且保留单实例 kill 回归', () => {
      const bat = read('install-pack/start.bat');
      expect(bat).toContain('ZJ_LAUNCH_PROBE');
      expect(bat).toContain('Get-Process -Name zenithjoy-agent');
    });
  });
});
