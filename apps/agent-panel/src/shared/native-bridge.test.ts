import {
  describe, it, expect, vi, afterEach,
} from 'vitest';
import { notifyHostExpandToggle, onHostExpandChanged, notifyHostLightState } from './native-bridge';

describe('native-bridge（WebView2宿主桥接，只读窗口力学信号）', () => {
  afterEach(() => { delete (window as any).chrome; });

  it('window.chrome.webview 存在时，转发 user-toggle-expand 消息', () => {
    const postMessage = vi.fn();
    (window as any).chrome = { webview: { postMessage } };
    notifyHostExpandToggle(true);
    expect(postMessage).toHaveBeenCalledWith({ type: 'user-toggle-expand', expanded: true });
  });

  it('非WebView2宿主环境(window.chrome不存在) → 安全no-op，不抛异常', () => {
    expect(() => notifyHostExpandToggle(false)).not.toThrow();
  });

  it('onHostExpandChanged：宿主主动发来的 host-expand-changed 消息触发回调'
    + '（xian-rog真机验证实测复现：热键/托盘只改了原生窗口几何尺寸，网页内部expanded状态'
    + '从未收到通知——按热键后窗口变全屏，但内容仍渲染成收起态那个6px小灯，客户看到的是'
    + '一个几乎全白的全屏窗口，不是预期的Warroom看板）', () => {
    const handlers: Array<(ev: { data: unknown }) => void> = [];
    const addEventListener = vi.fn((_type: string, handler: (ev: { data: unknown }) => void) => {
      handlers.push(handler);
    });
    (window as any).chrome = { webview: { postMessage: vi.fn(), addEventListener } };

    const callback = vi.fn();
    onHostExpandChanged(callback);
    expect(addEventListener).toHaveBeenCalledWith('message', expect.any(Function));

    handlers[0]({ data: { type: 'host-expand-changed', expanded: true } });
    expect(callback).toHaveBeenCalledWith(true);
  });

  it('onHostExpandChanged 收到无关消息类型时不触发回调', () => {
    const handlers: Array<(ev: { data: unknown }) => void> = [];
    const addEventListener = vi.fn((_type: string, handler: (ev: { data: unknown }) => void) => {
      handlers.push(handler);
    });
    (window as any).chrome = { webview: { postMessage: vi.fn(), addEventListener } };

    const callback = vi.fn();
    onHostExpandChanged(callback);
    handlers[0]({ data: { type: 'user-toggle-expand', expanded: true } });
    expect(callback).not.toHaveBeenCalled();
  });

  it('非WebView2宿主环境 → onHostExpandChanged 安全no-op，不抛异常', () => {
    expect(() => onHostExpandChanged(() => {})).not.toThrow();
  });

  describe('notifyHostLightState（PrepPRD Golden Path Step9："客户前台全屏时浮条自动隐藏；'
    + 'stuck例外——不弹窗不闪烁，只让托盘图标变红"——宿主要知道有没有stuck才能决定托盘图标颜色，'
    + '这个聚合逻辑网页侧已经在算(灯态数据来源)，没必要在原生C#侧重复实现一遍）', () => {
    it('window.chrome.webview 存在时，转发 light-state-changed 消息', () => {
      const postMessage = vi.fn();
      (window as any).chrome = { webview: { postMessage } };
      notifyHostLightState(true);
      expect(postMessage).toHaveBeenCalledWith({ type: 'light-state-changed', hasStuck: true });
    });

    it('非WebView2宿主环境 → 安全no-op，不抛异常', () => {
      expect(() => notifyHostLightState(false)).not.toThrow();
    });
  });
});
