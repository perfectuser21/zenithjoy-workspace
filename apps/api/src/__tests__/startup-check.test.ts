/**
 * 启动 env 自检 + 机器闸门（哨兵第一样板）
 *
 * 治根：2026-06-19 生产 mmv 的 apps/api/.env 漏 TOAPI_API_KEY → 微信客服 AI 生成失败、
 * 静默不回，排查很久。没有守卫 → 换机/重部署必再犯。本测试是"机器闸门"：
 *   1) proven-to-fire：缺关键 key 必被检出
 *   2) 空串算缺失（.env 写了 KEY= 也是漏）
 *   3) 完整性闸门：以后谁加了新的关键 env 读取却没登记进 REQUIRED_ENV → 这测试红 → 合不进
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  REQUIRED_ENV,
  verifyStartupConfig,
  CRITICAL_ENV_USAGE,
} from '../startup-check';

describe('startup-check：启动 env 自检', () => {
  // proven-to-fire：故意不给 TOAPI_API_KEY → 必须被检出
  it('test_missing_required_key_detected：缺关键 key 必被检出', () => {
    const res = verifyStartupConfig({
      DATABASE_URL: 'x',
      BETTER_AUTH_SECRET: 'y'.repeat(32),
      DATABASE_PASSWORD: 'pw',
      // 故意漏 TOAPI_API_KEY
    });
    expect(res.ok).toBe(false);
    expect(res.missing).toContain('TOAPI_API_KEY');
  });

  it('test_all_present_ok：全给 → ok===true', () => {
    const full: Record<string, string> = {};
    for (const k of REQUIRED_ENV) full[k] = 'non-empty-value';
    const res = verifyStartupConfig(full);
    expect(res.ok).toBe(true);
    expect(res.missing).toEqual([]);
    expect(res.present.sort()).toEqual([...REQUIRED_ENV].sort());
  });

  it('test_empty_string_counts_as_missing：空串算缺失', () => {
    const env: Record<string, string> = {};
    for (const k of REQUIRED_ENV) env[k] = 'ok';
    env.TOAPI_API_KEY = ''; // .env 写了 TOAPI_API_KEY= 但没值
    const res = verifyStartupConfig(env);
    expect(res.ok).toBe(false);
    expect(res.missing).toContain('TOAPI_API_KEY');
    expect(res.present).not.toContain('TOAPI_API_KEY');
  });

  it('空白串（只有空格）也算缺失', () => {
    const env: Record<string, string> = {};
    for (const k of REQUIRED_ENV) env[k] = 'ok';
    env.BETTER_AUTH_SECRET = '   ';
    const res = verifyStartupConfig(env);
    expect(res.ok).toBe(false);
    expect(res.missing).toContain('BETTER_AUTH_SECRET');
  });

  // 任务硬性要求：REQUIRED_ENV 至少含这三个
  it('REQUIRED_ENV 至少含 TOAPI_API_KEY / DATABASE_URL / BETTER_AUTH_SECRET', () => {
    expect(REQUIRED_ENV).toContain('TOAPI_API_KEY');
    expect(REQUIRED_ENV).toContain('DATABASE_URL');
    expect(REQUIRED_ENV).toContain('BETTER_AUTH_SECRET');
  });

  /**
   * 完整性闸门：扫 apps/api/src 真实源码里对关键 key 的 process.env.X 读取，
   * 断言每个真被读取的关键 key 都登记进了 REQUIRED_ENV。
   * 作用：以后谁加了新的关键 env 读取（在 CRITICAL_ENV_USAGE 里声明）却没进 REQUIRED_ENV
   * → 这测试红 → 合不进。这就是机器闸门。
   */
  it('test_required_env_covers_critical_usage：关键 env 读取全部登记进自检', () => {
    const apiSrc = path.resolve(__dirname, '..');
    for (const { key, file } of CRITICAL_ENV_USAGE) {
      const abs = path.join(apiSrc, file);
      expect(fs.existsSync(abs), `源码文件不存在：${file}`).toBe(true);
      const src = fs.readFileSync(abs, 'utf8');
      // 关键 key 确实在该文件里被 process.env.<KEY> 读取
      expect(
        src.includes(`process.env.${key}`),
        `${file} 应读取 process.env.${key}（CRITICAL_ENV_USAGE 声明了但源码没读）`,
      ).toBe(true);
      // 且该关键 key 已登记进 REQUIRED_ENV → 启动会自检它
      expect(
        REQUIRED_ENV.includes(key),
        `关键 env ${key}（${file} 在读）未登记进 REQUIRED_ENV → 启动自检会漏，必须补进去`,
      ).toBe(true);
    }
  });
});
