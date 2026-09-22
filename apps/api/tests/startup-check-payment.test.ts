/**
 * Task 11：支付凭据文件启动自检 + staging 误用生产商户号断言。
 *
 * checkRequiredFiles：证书/私钥类 env 只存「文件路径」（不进 env 变量本体），路径指向的
 * 文件缺失/为空/无法解析都要在启动早期被抓出来——同 provider-registry.ts 的
 * registerRealProvidersFromEnv() 是同一类事故（C-1），但那是"注册时才发现"，
 * 这里要在启动更早期就大声报出来。
 *
 * checkPaymentEnvSanity：防 staging/dev 误用生产商户号——真实资金风险，比普通配置错误
 * 重一个数量级，必须 fail-closed（拒绝启动），与 checkRequiredFiles 的 fail-open 不同档。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { generateKeyPairSync } from 'crypto';
import { checkRequiredFiles, checkPaymentEnvSanity } from '../src/startup-check';

const dir = mkdtempSync(join(tmpdir(), 'paycheck-'));

describe('checkRequiredFiles', () => {
  it('文件不存在 → 报出具体缺失项', () => {
    const problems = checkRequiredFiles({ WX_PAY_PRIVATE_KEY_PATH: join(dir, 'nope.pem') });
    expect(problems.join()).toMatch(/WX_PAY_PRIVATE_KEY_PATH/);
    expect(problems.join()).toMatch(/不存在/);
  });

  it('文件存在但不是合法私钥 → 报解析失败', () => {
    const p = join(dir, 'bad.pem');
    writeFileSync(p, 'not a key');
    const problems = checkRequiredFiles({ WX_PAY_PRIVATE_KEY_PATH: p });
    expect(problems.join()).toMatch(/无法解析/);
  });

  it('合法私钥 → 无问题', () => {
    const kp = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const p = join(dir, 'good.pem');
    writeFileSync(p, kp.privateKey);
    expect(checkRequiredFiles({ WX_PAY_PRIVATE_KEY_PATH: p })).toEqual([]);
  });

  it('未配置该 env → 跳过检查（provider 未启用是合法状态）', () => {
    expect(checkRequiredFiles({})).toEqual([]);
  });

  it('证书类 env（非私钥）文件为空 → 报"为空"，不试解析私钥', () => {
    const p = join(dir, 'empty-cert.json');
    writeFileSync(p, '');
    const problems = checkRequiredFiles({ WX_PAY_PLATFORM_CERT_PATH: p });
    expect(problems.join()).toMatch(/WX_PAY_PLATFORM_CERT_PATH/);
    expect(problems.join()).toMatch(/为空/);
  });

  it('错误信息不含文件内容原文（防私钥内容随日志外泄）', () => {
    const p = join(dir, 'leaky.pem');
    writeFileSync(p, '-----BEGIN PRIVATE KEY-----\nFAKE_SECRET_MUST_NOT_LEAK\n-----END PRIVATE KEY-----');
    const problems = checkRequiredFiles({ WX_PAY_PRIVATE_KEY_PATH: p });
    expect(problems.join()).not.toMatch(/FAKE_SECRET_MUST_NOT_LEAK/);
  });
});

describe('checkPaymentEnvSanity', () => {
  it('非 production 却配了生产商户号 → 拒绝启动', () => {
    const problems = checkPaymentEnvSanity({
      NODE_ENV: 'staging',
      WX_PAY_MCHID: '1900000109',
      WX_PAY_PROD_MCHID_DENYLIST: '1900000109,1900000110',
    });
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join()).toMatch(/生产商户号/);
  });

  it('production 用生产商户号 → 正常', () => {
    expect(checkPaymentEnvSanity({
      NODE_ENV: 'production',
      WX_PAY_MCHID: '1900000109',
      WX_PAY_PROD_MCHID_DENYLIST: '1900000109',
    })).toEqual([]);
  });

  it('未配置 denylist → 无法判断，放行（不误伤没配置这套自检的部署）', () => {
    expect(checkPaymentEnvSanity({
      NODE_ENV: 'staging',
      WX_PAY_MCHID: '1900000109',
    })).toEqual([]);
  });

  it('staging 环境用的商户号不在 denylist 里（非生产号）→ 正常', () => {
    expect(checkPaymentEnvSanity({
      NODE_ENV: 'staging',
      WX_PAY_MCHID: '1900000999',
      WX_PAY_PROD_MCHID_DENYLIST: '1900000109,1900000110',
    })).toEqual([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('配了 WX_PAY_MCHID 但 denylist 未配置 → 打 WARN 提示运维配置，且不阻断（问题列表仍为空）', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const problems = checkPaymentEnvSanity({
      NODE_ENV: 'staging',
      WX_PAY_MCHID: '1900000109',
    });
    expect(problems).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy.mock.calls.flat().join()).toMatch(/WX_PAY_PROD_MCHID_DENYLIST/);
  });

  it('没配 WX_PAY_MCHID（未接入微信支付的部署）→ 不打这条 WARN，不被噪音打扰', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const problems = checkPaymentEnvSanity({
      NODE_ENV: 'staging',
    });
    expect(problems).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
