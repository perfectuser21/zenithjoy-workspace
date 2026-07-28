import {
  describe, it, expect, vi, afterEach,
} from 'vitest';
import { notifyHostExpandToggle } from './native-bridge';

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
});
