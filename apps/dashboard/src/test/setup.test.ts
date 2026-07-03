import { describe, it, expect } from 'vitest';

// setup.ts 在部分沙箱环境下会探测到 Node 原生 localStorage 是无方法空对象桩
// （--localstorage-file 未配路径时的降级行为），并换成内存版 polyfill。
// 本测试验证这个不变量：无论底层环境如何，测试期间 window.localStorage
// 必须是一个功能完整的 Storage（get/set/remove/clear 全部可用）。
describe('test/setup.ts — localStorage polyfill 兜底 [BEHAVIOR]', () => {
  it('window.localStorage 具备完整 Storage 方法', () => {
    expect(typeof window.localStorage.getItem).toBe('function');
    expect(typeof window.localStorage.setItem).toBe('function');
    expect(typeof window.localStorage.removeItem).toBe('function');
    expect(typeof window.localStorage.clear).toBe('function');
  });

  it('setItem/getItem/removeItem 读写正确', () => {
    window.localStorage.setItem('setup-probe', 'v1');
    expect(window.localStorage.getItem('setup-probe')).toBe('v1');
    window.localStorage.removeItem('setup-probe');
    expect(window.localStorage.getItem('setup-probe')).toBeNull();
  });

  it('clear() 清空所有 key', () => {
    window.localStorage.setItem('a', '1');
    window.localStorage.setItem('b', '2');
    window.localStorage.clear();
    expect(window.localStorage.getItem('a')).toBeNull();
    expect(window.localStorage.getItem('b')).toBeNull();
  });
});
