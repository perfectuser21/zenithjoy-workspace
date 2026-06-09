// __mocks__/systray2.js — vitest 手动 mock，拦截 tray.ts 里的 require('systray2')
// 避免 systray2 尝试启动平台 helper 二进制（在 CI / 测试环境不可用）

const { vi } = require('vitest');

const MockSysTray = vi.fn().mockImplementation(() => ({
  onClick: vi.fn(),
  ready: vi.fn().mockResolvedValue(undefined),
  sendAction: vi.fn(),
  kill: vi.fn(),
  _process: { on: vi.fn() },
}));
MockSysTray.separator = { title: '<HR>' };

module.exports = { default: MockSysTray };
