import { readFileSync } from 'fs';
import type { PaymentProvider } from './types';
import { MockProvider } from './mock.provider';
import { WechatNativeProvider } from './wechat-native.provider';
import { AlipayF2FProvider } from './alipay-f2f.provider';

const registry = new Map<string, PaymentProvider>();

// 假网关绝不在 production 注册：生产环境下缺这道门，可创建永远 pending 的 mock 订单，
// 污染数据并触发积压告警。
if (process.env.NODE_ENV !== 'production') {
  registry.set('mock', new MockProvider());
}

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

/**
 * 真实 provider 按需注册：缺凭据时不注册，getProvider 会抛 UNKNOWN_PROVIDER，
 * 好过注册一个半残实例在运行时炸。
 *
 * 注：WechatNativeProvider / AlipayF2FProvider 用顶层 static import 引入——
 * 类定义本身没有副作用（构造函数不跑就不读盘），条件判断只决定要不要 new。
 * 本仓库 apps/api 是 CommonJS，但 vitest 按 ESM 转换 TS，函数体内 require() 在
 * 测试环境下大概率炸，所以不用 brief 原写法的条件 require。
 */
export function registerRealProvidersFromEnv(): void {
  const {
    WX_PAY_MCHID, WX_PAY_SERIAL_NO, WX_PAY_V3_KEY,
    WX_PAY_PRIVATE_KEY_PATH, WX_PAY_PLATFORM_CERT_PATH,
    WX_PAY_APPID, PAYMENT_NOTIFY_BASE_URL,
    ALIPAY_APP_ID, ALIPAY_PRIVATE_KEY_PATH, ALIPAY_PUBLIC_KEY_PATH, ALIPAY_GATEWAY,
  } = process.env;

  if (
    WX_PAY_MCHID && WX_PAY_SERIAL_NO && WX_PAY_V3_KEY &&
    WX_PAY_PRIVATE_KEY_PATH && WX_PAY_PLATFORM_CERT_PATH &&
    WX_PAY_APPID && PAYMENT_NOTIFY_BASE_URL
  ) {
    registry.set('wechat', new WechatNativeProvider({
      mchId: WX_PAY_MCHID,
      serialNo: WX_PAY_SERIAL_NO,
      apiV3Key: WX_PAY_V3_KEY,
      merchantPrivateKey: readFileSync(WX_PAY_PRIVATE_KEY_PATH, 'utf8'),
      platformPublicKeys: JSON.parse(readFileSync(WX_PAY_PLATFORM_CERT_PATH, 'utf8')),
      notifyUrl: `${PAYMENT_NOTIFY_BASE_URL}/api/payment/callback/wechat`,
      appId: WX_PAY_APPID,
    }));
  }

  if (ALIPAY_APP_ID && ALIPAY_PRIVATE_KEY_PATH && ALIPAY_PUBLIC_KEY_PATH && PAYMENT_NOTIFY_BASE_URL) {
    registry.set('alipay', new AlipayF2FProvider({
      appId: ALIPAY_APP_ID,
      appPrivateKey: readFileSync(ALIPAY_PRIVATE_KEY_PATH, 'utf8'),
      alipayPublicKey: readFileSync(ALIPAY_PUBLIC_KEY_PATH, 'utf8'),
      notifyUrl: `${PAYMENT_NOTIFY_BASE_URL}/api/payment/callback/alipay`,
      gateway: ALIPAY_GATEWAY ?? 'https://openapi.alipay.com/gateway.do',
    }));
  }
}
