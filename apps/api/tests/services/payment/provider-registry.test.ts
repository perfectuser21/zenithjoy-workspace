/**
 * C-1：启动时加载支付凭据失败绝不能拖垮整个 API 进程。
 *
 * 治根：registerRealProvidersFromEnv() 内部四处 readFileSync + 一处 JSON.parse，
 * 全都会抛——证书/私钥路径拼错、或运维把微信下发的 .pem 直接挂到
 * WX_PAY_PLATFORM_CERT_PATH（本实现要求 {serial: pem} 形状的 JSON）。此前裸调用
 * 无 try/catch，异常会向上传播炸穿 bootstrap()，server.listen 从未执行、全站不可用。
 *
 * 本测试验证 fail-open 语义：
 * - env 不齐 → 静默不注册，不记入 providerInitErrors（正常状态）
 * - env 齐了但加载抛异常 → 不注册 + 记入 providerInitErrors，且 reason 绝不含
 *   err.message 原文（I-8：JSON.parse 的 SyntaxError 会把私钥文件开头回显进消息）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ENV_KEYS = [
  'WX_PAY_MCHID', 'WX_PAY_SERIAL_NO', 'WX_PAY_V3_KEY',
  'WX_PAY_PRIVATE_KEY_PATH', 'WX_PAY_PLATFORM_CERT_PATH',
  'WX_PAY_APPID', 'PAYMENT_NOTIFY_BASE_URL',
  'ALIPAY_APP_ID', 'ALIPAY_PRIVATE_KEY_PATH', 'ALIPAY_PUBLIC_KEY_PATH',
  'ALIPAY_SELLER_ID', 'ALIPAY_GATEWAY',
];

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  vi.resetModules();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.resetModules();
});

function tmpFile(name: string, content: string): string {
  const p = path.join(os.tmpdir(), `provreg-${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
  fs.writeFileSync(p, content);
  return p;
}

describe('registerRealProvidersFromEnv — fail-open（C-1）', () => {
  it('env 完全不齐 → 不注册、不报错、providerInitErrors 为空', async () => {
    for (const k of ENV_KEYS) delete process.env[k];
    const { registerRealProvidersFromEnv, getProvider, getProviderInitErrors } = await import(
      '../../../src/services/payment/provider-registry'
    );
    expect(() => registerRealProvidersFromEnv()).not.toThrow();
    expect(() => getProvider('wechat')).toThrow('UNKNOWN_PROVIDER');
    expect(() => getProvider('alipay')).toThrow('UNKNOWN_PROVIDER');
    expect(getProviderInitErrors()).toEqual([]);
  });

  it('微信 env 齐了但平台证书文件不是合法 JSON → 不抛异常、不注册、记入 providerInitErrors 且不含私钥内容', async () => {
    const privateKeyPath = tmpFile('wx-priv.pem', '-----BEGIN PRIVATE KEY-----\nFAKE_SECRET_MATERIAL_MUST_NOT_LEAK\n-----END PRIVATE KEY-----');
    // 运维最自然的误操作：把微信下发的 .pem 直接挂到 PLATFORM_CERT_PATH（本实现要求 JSON）
    const platformCertPath = tmpFile('wx-cert.pem', '-----BEGIN CERTIFICATE-----\nNOT_JSON_AT_ALL\n-----END CERTIFICATE-----');

    process.env.WX_PAY_MCHID = '1234567890';
    process.env.WX_PAY_SERIAL_NO = 'ABC123';
    process.env.WX_PAY_V3_KEY = '0123456789abcdef0123456789abcdef';
    process.env.WX_PAY_PRIVATE_KEY_PATH = privateKeyPath;
    process.env.WX_PAY_PLATFORM_CERT_PATH = platformCertPath;
    process.env.WX_PAY_APPID = 'wxtestappid';
    process.env.PAYMENT_NOTIFY_BASE_URL = 'https://example.com';
    delete process.env.ALIPAY_APP_ID; // 支付宝这组保持不齐，验证互不影响

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { registerRealProvidersFromEnv, getProvider, getProviderInitErrors } = await import(
        '../../../src/services/payment/provider-registry'
      );
      expect(() => registerRealProvidersFromEnv()).not.toThrow();
      expect(() => getProvider('wechat')).toThrow('UNKNOWN_PROVIDER');

      const errors = getProviderInitErrors();
      expect(errors).toHaveLength(1);
      expect(errors[0].provider).toBe('wechat');
      expect(errors[0].reason).not.toContain('FAKE_SECRET_MATERIAL_MUST_NOT_LEAK');
      expect(errors[0].reason).not.toContain('NOT_JSON_AT_ALL');
      expect(errors[0].reason).not.toContain('BEGIN CERTIFICATE');
      expect(errors[0].reason).not.toContain('BEGIN PRIVATE KEY');

      // 响亮报错：console.error 确有一条红日志，且同样不泄漏文件内容
      expect(errSpy).toHaveBeenCalled();
      const allLoggedText = errSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(allLoggedText).not.toContain('FAKE_SECRET_MATERIAL_MUST_NOT_LEAK');
      expect(allLoggedText).not.toContain('NOT_JSON_AT_ALL');
    } finally {
      errSpy.mockRestore();
      fs.unlinkSync(privateKeyPath);
      fs.unlinkSync(platformCertPath);
    }
  });

  it('微信私钥路径拼错（文件不存在）→ ENOENT 同样不抛异常、记入 providerInitErrors', async () => {
    process.env.WX_PAY_MCHID = '1234567890';
    process.env.WX_PAY_SERIAL_NO = 'ABC123';
    process.env.WX_PAY_V3_KEY = '0123456789abcdef0123456789abcdef';
    process.env.WX_PAY_PRIVATE_KEY_PATH = '/nonexistent/path/does-not-exist.pem';
    process.env.WX_PAY_PLATFORM_CERT_PATH = '/nonexistent/path/also-missing.json';
    process.env.WX_PAY_APPID = 'wxtestappid';
    process.env.PAYMENT_NOTIFY_BASE_URL = 'https://example.com';

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { registerRealProvidersFromEnv, getProviderInitErrors } = await import(
        '../../../src/services/payment/provider-registry'
      );
      expect(() => registerRealProvidersFromEnv()).not.toThrow();
      const errors = getProviderInitErrors();
      expect(errors).toHaveLength(1);
      expect(errors[0].provider).toBe('wechat');
      expect(errors[0].reason).toContain('ENOENT');
    } finally {
      errSpy.mockRestore();
    }
  });

  it('微信 env 与真实文件全部齐全合法 → 正常注册，不记入 providerInitErrors', async () => {
    const { generateKeyPairSync } = await import('node:crypto');
    const kp = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const privateKeyPath = tmpFile('wx-priv-ok.pem', kp.privateKey);
    const platformCertPath = tmpFile('wx-cert-ok.json', JSON.stringify({ 'SERIAL-1': kp.publicKey }));

    process.env.WX_PAY_MCHID = '1234567890';
    process.env.WX_PAY_SERIAL_NO = 'ABC123';
    process.env.WX_PAY_V3_KEY = '0123456789abcdef0123456789abcdef';
    process.env.WX_PAY_PRIVATE_KEY_PATH = privateKeyPath;
    process.env.WX_PAY_PLATFORM_CERT_PATH = platformCertPath;
    process.env.WX_PAY_APPID = 'wxtestappid';
    process.env.PAYMENT_NOTIFY_BASE_URL = 'https://example.com';

    try {
      const { registerRealProvidersFromEnv, getProvider, getProviderInitErrors } = await import(
        '../../../src/services/payment/provider-registry'
      );
      registerRealProvidersFromEnv();
      expect(getProvider('wechat').name).toBe('wechat');
      expect(getProviderInitErrors()).toEqual([]);
    } finally {
      fs.unlinkSync(privateKeyPath);
      fs.unlinkSync(platformCertPath);
    }
  });

  it('支付宝 env 缺 ALIPAY_SELLER_ID（I-9 并入必需 env）→ 视为不齐，不注册', async () => {
    const privateKeyPath = tmpFile('ali-priv.pem', 'placeholder');
    const publicKeyPath = tmpFile('ali-pub.pem', 'placeholder');
    process.env.ALIPAY_APP_ID = '2021000000000000';
    process.env.ALIPAY_PRIVATE_KEY_PATH = privateKeyPath;
    process.env.ALIPAY_PUBLIC_KEY_PATH = publicKeyPath;
    delete process.env.ALIPAY_SELLER_ID;
    process.env.PAYMENT_NOTIFY_BASE_URL = 'https://example.com';
    for (const k of ['WX_PAY_MCHID', 'WX_PAY_SERIAL_NO', 'WX_PAY_V3_KEY', 'WX_PAY_PRIVATE_KEY_PATH', 'WX_PAY_PLATFORM_CERT_PATH', 'WX_PAY_APPID']) {
      delete process.env[k];
    }

    try {
      const { registerRealProvidersFromEnv, getProvider, getProviderInitErrors } = await import(
        '../../../src/services/payment/provider-registry'
      );
      registerRealProvidersFromEnv();
      expect(() => getProvider('alipay')).toThrow('UNKNOWN_PROVIDER');
      expect(getProviderInitErrors()).toEqual([]);
    } finally {
      fs.unlinkSync(privateKeyPath);
      fs.unlinkSync(publicKeyPath);
    }
  });
});
