// services/agent/src/__tests__/tray-module-hot-rebuild.test.ts
//
// Sprint 06090945 — updateTrayModules 首次出现模块时重建托盘（TDD）

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as trayModule from '../tray';

const {
  updateTrayModules,
  _resetTrayStateForTest,
  _setHandlersForTest,
  _trayRebuildHook,
} = trayModule;

const makeHandlers = () => ({
  version: '2.0.1',
  agentId: 'test-agent',
  onRestart: vi.fn(),
  onQuit: vi.fn(),
});

describe('updateTrayModules — 首次出现模块时重建托盘', () => {
  let originalInvoke: (h: typeof makeHandlers extends () => infer T ? T : never) => void;

  beforeEach(() => {
    _resetTrayStateForTest();
    vi.clearAllMocks();
    // 保存并替换重建 hook（避免真实 systray2 启动）
    originalInvoke = _trayRebuildHook.invoke as any;
    _trayRebuildHook.invoke = vi.fn() as any;
  });

  afterEach(() => {
    _trayRebuildHook.invoke = originalInvoke as any;
    _resetTrayStateForTest();
  });

  it('从 0 模块 → N 模块时，invoke 重建 hook 被调用一次且传入正确 handlers', () => {
    const handlers = makeHandlers();
    _setHandlersForTest(handlers);

    updateTrayModules({
      line04: { label: '私域AI客服', running: true },
      line01: { label: '智能发布', running: false },
    });

    expect(_trayRebuildHook.invoke).toHaveBeenCalledOnce();
    expect(_trayRebuildHook.invoke).toHaveBeenCalledWith(handlers);
  });

  it('已有模块时再次推入，不触发重建（防止每次心跳都重建）', () => {
    _setHandlersForTest(makeHandlers());

    // 第一次推入：触发重建（hook 已 mock）
    updateTrayModules({ line04: { label: '私域AI客服', running: true } });
    expect(_trayRebuildHook.invoke).toHaveBeenCalledOnce();

    vi.clearAllMocks();

    // 第二次推入：currentModules 已非空，不应再触发重建
    updateTrayModules({
      line04: { label: '私域AI客服', running: true },
      line01: { label: '智能发布', running: true },
    });
    expect(_trayRebuildHook.invoke).not.toHaveBeenCalled();
  });

  it('handlers 未设置（headless 模式）时，updateTrayModules 不崩溃且不重建', () => {
    // handlers 为 null
    expect(() => {
      updateTrayModules({ line04: { label: '私域AI客服', running: false } });
    }).not.toThrow();
    expect(_trayRebuildHook.invoke).not.toHaveBeenCalled();
  });
});
