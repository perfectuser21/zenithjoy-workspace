import '@testing-library/jest-dom';

// Node 22+ 自带实验性全局 localStorage(getter/setter，无 storageQuota 时 .clear 不是函数)，
// 会盖过 jsdom 的实现。测试环境里强制换成一个能用的内存版 Storage。
class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number { return this.store.size; }

  clear(): void { this.store.clear(); }

  getItem(key: string): string | null { return this.store.has(key) ? this.store.get(key)! : null; }

  key(index: number): string | null { return [...this.store.keys()][index] ?? null; }

  removeItem(key: string): void { this.store.delete(key); }

  setItem(key: string, value: string): void { this.store.set(key, String(value)); }
}

Object.defineProperty(globalThis, 'localStorage', {
  value: new MemoryStorage(),
  configurable: true,
  writable: true,
});
