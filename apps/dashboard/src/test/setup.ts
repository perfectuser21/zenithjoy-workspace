import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock environment variables
vi.stubEnv('VITE_TOAPIS_API_KEY', 'test-api-key');

// 某些沙箱环境下 Node 原生 `localStorage` 是个无方法的空对象桩（--localstorage-file
// 未配路径时的降级行为），会整个盖掉 jsdom 的 window.localStorage。测试环境里探测到
// 桩对象就换成内存版 polyfill，保证依赖 localStorage 的组件测试在任何环境下都能跑。
if (typeof globalThis.localStorage?.setItem !== 'function') {
  const store = new Map<string, string>();
  const memoryStorage: Storage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() { return store.size; },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage, configurable: true, writable: true });
  Object.defineProperty(window, 'localStorage', { value: memoryStorage, configurable: true, writable: true });
}

// Mock IntersectionObserver for tests
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  takeRecords() {
    return [];
  }
  unobserve() {}
} as unknown as typeof IntersectionObserver;
