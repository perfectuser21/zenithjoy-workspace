import type { PaymentProvider } from './types';
import { MockProvider } from './mock.provider';

const registry = new Map<string, PaymentProvider>();

registry.set('mock', new MockProvider());

/** 取 provider；未知名字抛错，绝不返回 undefined 让调用方静默走空实现 */
export function getProvider(name: string): PaymentProvider {
  const p = registry.get(name);
  if (!p) throw new Error(`UNKNOWN_PROVIDER: ${name}`);
  return p;
}

/** 仅测试用：注入替身 */
export function __setProviderForTest(name: string, provider: PaymentProvider): void {
  registry.set(name, provider);
}

/** 由 Task 6 在真实 provider 就绪后调用注册 */
export function registerProvider(provider: PaymentProvider): void {
  registry.set(provider.name, provider);
}
