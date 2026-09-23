import { readFileSync } from 'fs';
import type { PaymentProvider } from './types';
import { MockProvider } from './mock.provider';
import { WechatNativeProvider } from './wechat-native.provider';
import { AlipayF2FProvider } from './alipay-f2f.provider';

/**
 * N-3：两个 provider 各自需要的完整 env 清单，漏配一个就整组"env 不齐"→ 静默不注册
 * （见下方 registerRealProvidersFromEnv 顶部注释），且 providerInitErrors 为空、
 * /health 完全看不出异常——只有 stdout 一行 info。上线配凭据时对照这张表逐条核对。
 *
 * 微信 Native（WECHAT_ENV_KEYS，全部必需）：
 *   - WX_PAY_MCHID              微信支付商户号
 *   - WX_PAY_SERIAL_NO          商户 API 证书序列号
 *   - WX_PAY_V3_KEY             APIv3 密钥（用于回调 resource 的 AEAD_AES_256_GCM 解密）
 *   - WX_PAY_PRIVATE_KEY_PATH   商户 API 私钥文件路径（PEM，readFileSync 读取）
 *   - WX_PAY_PLATFORM_CERT_PATH 微信支付平台证书文件路径（要求 {serial: pem} 形状的 JSON，
 *                               不是微信下发的原始 .pem——这是最常见的误配）
 *   - WX_PAY_APPID              公众号/小程序 appid
 *   - PAYMENT_NOTIFY_BASE_URL   回调基础 URL（两个 provider 共用，拼接各自 /callback/xxx 路径）
 *
 * 支付宝当面付（ALIPAY_ENV_KEYS，全部必需）：
 *   - ALIPAY_APP_ID             支付宝开放平台 应用 ID
 *   - ALIPAY_PRIVATE_KEY_PATH   应用私钥文件路径（PEM）
 *   - ALIPAY_PUBLIC_KEY_PATH    支付宝公钥文件路径（PEM，验签用）
 *   - ALIPAY_SELLER_ID          卖家支付宝用户 ID（I-9 并入必需项，此前遗漏会导致签名字段缺失）
 *   - PAYMENT_NOTIFY_BASE_URL   同上，两个 provider 共用
 *   - ALIPAY_GATEWAY            可选，缺省为 https://openapi.alipay.com/gateway.do
 */
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
 * 支付 provider 初始化失败记录（C-1）——env 齐了但加载抛异常（证书路径拼错 / 私钥格式不对 /
 * 证书 JSON 解析失败等）属于配置错误，不同于"本来就没配支付"的静默不注册：必须响亮可见，
 * 且不能拖垮整个进程。reason 只允许放错误类型/errno/路径，绝不允许放 err.message 原文——
 * JSON.parse 在 Node 20+ 的 SyntaxError 会把非法输入的开头片段（可能是私钥内容）拼进
 * message，一旦透传进日志就是密钥泄露（I-8）。
 */
export interface ProviderInitError {
  provider: string;
  /** 触发本次加载所依赖的 env key 列表（逗号分隔展示用） */
  env: string;
  /**
   * 只含错误类型名 / errno / 涉及路径，不含原始错误消息。
   * 注意：这个字段含服务器文件系统绝对路径，只能用于服务端内部（console.error 红日志/
   * 运维排查），绝不能直接透传给 /health、/api/health 这类无鉴权公网端点（N-1）——
   * 对外用 getProviderInitErrorsForHealth() 的投影版本。
   */
  reason: string;
  /** 错误类型名（如 Error/SyntaxError），不含路径，供对外摘要使用 */
  errorType: string;
}

const providerInitErrors: ProviderInitError[] = [];

/**
 * 仅供服务端内部使用（运维排查/日志关联）：含完整 reason（可能带文件系统路径）。
 * 绝不能把这个返回值原样喂给任何无鉴权端点——需要对外暴露信号时用
 * getProviderInitErrorsForHealth()。
 */
export function getProviderInitErrors(): ProviderInitError[] {
  return [...providerInitErrors];
}

/**
 * 暴露给 /health、/api/health 用（N-1）：这两个端点只挂了限速、没有任何鉴权，
 * 因此只回不敏感的摘要——provider 名 + 错误类型名，绝不含 paths / env 列表 / 原始 reason。
 * 完整信息（含 paths）留在服务端 console.error 红日志里，运维查日志，不靠公网端点。
 */
export function getProviderInitErrorsForHealth(): Array<{ provider: string; errorType: string }> {
  return providerInitErrors.map(({ provider, errorType }) => ({ provider, errorType }));
}

/** 只取错误类型名 + errno + 涉及路径，绝不含 err.message 原文（防密钥/证书内容泄露到日志） */
function describeInitError(err: unknown, paths: string[]): { reason: string; errorType: string } {
  const name = err instanceof Error ? err.name : typeof err;
  const errno = (err as NodeJS.ErrnoException | undefined)?.code;
  const errorType = errno ? `${name}(${errno})` : String(name);
  const reason = `type=${name}${errno ? ` code=${errno}` : ''} paths=${paths.join(',')}`;
  return { reason, errorType };
}

/**
 * 真实 provider 按需注册：
 * - env 不齐（本来就没配支付）→ 静默不注册，只打一行 info，这是正常状态。
 * - env 齐了但加载抛异常（fail-open，配置错误）→ 不注册 + 响亮 console.error +
 *   记入 providerInitErrors（经 /health 对外暴露），绝不让异常向上传播——
 *   上线当天第一次配支付凭据时证书路径/格式出错，不能拖垮整个 API 进程
 *   （C-1：此前裸调用 + 无 try/catch，bootstrap() reject 后 server.listen 从未执行）。
 *
 * 注：WechatNativeProvider / AlipayF2FProvider 用顶层 static import 引入——
 * 类定义本身没有副作用（构造函数不跑就不读盘），条件判断只决定要不要 new。
 * 本仓库 apps/api 是 CommonJS，但 vitest 按 ESM 转换 TS，函数体内 require() 在
 * 测试环境下大概率炸，所以不用 brief 原写法的条件 require。
 */
export function registerRealProvidersFromEnv(): void {
  providerInitErrors.length = 0; // 支持重复调用（测试场景）：每次都是一次全新的启动自检

  const {
    WX_PAY_MCHID, WX_PAY_SERIAL_NO, WX_PAY_V3_KEY,
    WX_PAY_PRIVATE_KEY_PATH, WX_PAY_PLATFORM_CERT_PATH,
    WX_PAY_APPID, PAYMENT_NOTIFY_BASE_URL,
    ALIPAY_APP_ID, ALIPAY_PRIVATE_KEY_PATH, ALIPAY_PUBLIC_KEY_PATH,
    ALIPAY_SELLER_ID, ALIPAY_GATEWAY,
  } = process.env;

  const WECHAT_ENV_KEYS = [
    'WX_PAY_MCHID', 'WX_PAY_SERIAL_NO', 'WX_PAY_V3_KEY',
    'WX_PAY_PRIVATE_KEY_PATH', 'WX_PAY_PLATFORM_CERT_PATH',
    'WX_PAY_APPID', 'PAYMENT_NOTIFY_BASE_URL',
  ];
  const wechatEnvComplete =
    WX_PAY_MCHID && WX_PAY_SERIAL_NO && WX_PAY_V3_KEY &&
    WX_PAY_PRIVATE_KEY_PATH && WX_PAY_PLATFORM_CERT_PATH &&
    WX_PAY_APPID && PAYMENT_NOTIFY_BASE_URL;

  if (wechatEnvComplete) {
    const paths = [WX_PAY_PRIVATE_KEY_PATH, WX_PAY_PLATFORM_CERT_PATH];
    try {
      registry.set('wechat', new WechatNativeProvider({
        mchId: WX_PAY_MCHID,
        serialNo: WX_PAY_SERIAL_NO,
        apiV3Key: WX_PAY_V3_KEY,
        merchantPrivateKey: readFileSync(WX_PAY_PRIVATE_KEY_PATH, 'utf8'),
        platformPublicKeys: JSON.parse(readFileSync(WX_PAY_PLATFORM_CERT_PATH, 'utf8')),
        notifyUrl: `${PAYMENT_NOTIFY_BASE_URL}/api/payment/callback/wechat`,
        appId: WX_PAY_APPID,
      }));
    } catch (err) {
      const { reason, errorType } = describeInitError(err, paths);
      console.error(
        `🔴 [payment] wechat provider 加载失败，未注册（配置错误：检查私钥/平台证书文件是否存在、`
        + `平台证书是否为 {serial: pem} 形状的 JSON）: ${reason}`
      );
      providerInitErrors.push({ provider: 'wechat', env: WECHAT_ENV_KEYS.join(','), reason, errorType });
    }
  } else {
    const missing = WECHAT_ENV_KEYS.filter((k) => !process.env[k]);
    console.info(`[payment] wechat provider 未启用：缺少 env ${missing.join(', ')}`);
  }

  const ALIPAY_ENV_KEYS = [
    'ALIPAY_APP_ID', 'ALIPAY_PRIVATE_KEY_PATH', 'ALIPAY_PUBLIC_KEY_PATH',
    'ALIPAY_SELLER_ID', 'PAYMENT_NOTIFY_BASE_URL',
  ];
  const alipayEnvComplete =
    ALIPAY_APP_ID && ALIPAY_PRIVATE_KEY_PATH && ALIPAY_PUBLIC_KEY_PATH &&
    ALIPAY_SELLER_ID && PAYMENT_NOTIFY_BASE_URL;

  if (alipayEnvComplete) {
    const paths = [ALIPAY_PRIVATE_KEY_PATH, ALIPAY_PUBLIC_KEY_PATH];
    try {
      registry.set('alipay', new AlipayF2FProvider({
        appId: ALIPAY_APP_ID,
        appPrivateKey: readFileSync(ALIPAY_PRIVATE_KEY_PATH, 'utf8'),
        alipayPublicKey: readFileSync(ALIPAY_PUBLIC_KEY_PATH, 'utf8'),
        sellerId: ALIPAY_SELLER_ID,
        notifyUrl: `${PAYMENT_NOTIFY_BASE_URL}/api/payment/callback/alipay`,
        gateway: ALIPAY_GATEWAY ?? 'https://openapi.alipay.com/gateway.do',
      }));
    } catch (err) {
      const { reason, errorType } = describeInitError(err, paths);
      console.error(
        `🔴 [payment] alipay provider 加载失败，未注册（配置错误：检查私钥/公钥文件路径与格式）: ${reason}`
      );
      providerInitErrors.push({ provider: 'alipay', env: ALIPAY_ENV_KEYS.join(','), reason, errorType });
    }
  } else {
    const missing = ALIPAY_ENV_KEYS.filter((k) => !process.env[k]);
    console.info(`[payment] alipay provider 未启用：缺少 env ${missing.join(', ')}`);
  }
}
