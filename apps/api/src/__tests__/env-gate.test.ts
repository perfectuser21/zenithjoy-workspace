/**
 * env 接缝通用闸门测试（接续 PR #800 的完整性闸门，升级成"全 src 扫描 + 强制分类"）。
 *
 * #800 的 startup-check.test.ts 只对手写声明的 2 个文件做断言 → 别处新增的
 * process.env.X 它看不到（漏网）。本测试把闸门升级为机器闸门：
 *
 *   扫遍 apps/api/src/**\/*.ts（排除 __tests__ / *.test.ts / startup-check.ts / env-registry.ts），
 *   抓所有 process.env.X 读取，断言每个都落在 REQUIRED_ENV ∪ OPTIONAL_ENV ∪ FRAMEWORK_ENV。
 *   有任何一个没归类 → 本测试红 → 合不进。
 *
 * 同时含 proven-to-fire：构造一段假源码喂给纯函数 findUnclassifiedEnv，证明闸门真会拦未分类 env。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  REQUIRED_ENV,
  OPTIONAL_ENV,
  FRAMEWORK_ENV,
  findUnclassifiedEnv,
  extractEnvNames,
  classifiedEnvNames,
} from '../env-registry';

const API_SRC = path.resolve(__dirname, '..');

/** 递归收集 src 下所有 .ts，排除测试与闸门自身（避免自我误报）。 */
function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules' || entry.name === 'dist') continue;
      out.push(...collectSourceFiles(full));
      continue;
    }
    if (!entry.name.endsWith('.ts')) continue;
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.spec.ts')) continue;
    if (entry.name === 'startup-check.ts' || entry.name === 'env-registry.ts') continue;
    out.push(full);
  }
  return out;
}

describe('env 接缝通用闸门：全 src 扫描 + 强制分类', () => {
  const lists = { required: REQUIRED_ENV, optional: OPTIONAL_ENV, framework: FRAMEWORK_ENV };

  it('OPTIONAL_ENV 每条都必须写 reason（强制想清楚"为什么可选"）', () => {
    for (const o of OPTIONAL_ENV) {
      expect(o.name, 'OPTIONAL_ENV 条目缺 name').toBeTruthy();
      expect(
        typeof o.reason === 'string' && o.reason.trim().length > 0,
        `OPTIONAL_ENV "${o.name}" 缺 reason`,
      ).toBe(true);
    }
  });

  it('三个清单互不重复分类（同一 env 只能属一类）', () => {
    const seen = new Map<string, string>();
    const add = (name: string, bucket: string) => {
      const prev = seen.get(name);
      expect(prev, `env ${name} 同时出现在 ${prev} 和 ${bucket}，只能归一类`).toBeUndefined();
      seen.set(name, bucket);
    };
    for (const k of REQUIRED_ENV) add(k, 'REQUIRED_ENV');
    for (const o of OPTIONAL_ENV) add(o.name, 'OPTIONAL_ENV');
    for (const k of FRAMEWORK_ENV) add(k, 'FRAMEWORK_ENV');
  });

  /**
   * 核心闸门：扫真实 src，每个 process.env.X 都必须被分类。未分类 → 红。
   * 错误信息显式引导开发者去 REQUIRED_ENV / OPTIONAL_ENV / FRAMEWORK_ENV 登记。
   */
  it('test_all_env_reads_classified：全 src 每个 env 读取都已归类', () => {
    const files = collectSourceFiles(API_SRC);
    expect(files.length, '没扫到任何 src 文件，扫描逻辑可能坏了').toBeGreaterThan(0);

    const offenders = new Map<string, string[]>(); // env 名 → 出现的文件
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      const unclassified = findUnclassifiedEnv(text, lists);
      for (const name of unclassified) {
        const rel = path.relative(API_SRC, file);
        const arr = offenders.get(name) ?? [];
        arr.push(rel);
        offenders.set(name, arr);
      }
    }

    if (offenders.size > 0) {
      const lines = [...offenders.entries()].map(
        ([name, fileList]) =>
          `  - 未分类的 env：${name}（出现在 ${fileList.join(', ')}）` +
          `，请加入 REQUIRED_ENV(会启动自检) 或 OPTIONAL_ENV(附 reason) 或 FRAMEWORK_ENV(框架白名单)`,
      );
      throw new Error(
        `env 接缝闸门：发现 ${offenders.size} 个未分类 env：\n${lines.join('\n')}\n` +
          `分类入口：apps/api/src/env-registry.ts`,
      );
    }
    expect(offenders.size).toBe(0);
  });

  /**
   * proven-to-fire：闸门自己得证明会响。
   * 喂一段含未分类 env 的假源码 → findUnclassifiedEnv 必须报出它。
   */
  it('test_gate_catches_unclassified_env：未分类 env 必被拦', () => {
    const fakeSrc = `
      // 假装的源码：故意引入一个谁都没登记的 env
      const x = process.env.ZZ_FAKE_UNCLASSIFIED;
      const y = process.env.TOAPI_API_KEY; // 已在 REQUIRED_ENV，不该被报
      const z = process.env['NODE_ENV'];    // 框架白名单，不该被报
    `;
    const unclassified = findUnclassifiedEnv(fakeSrc, lists);
    expect(unclassified).toContain('ZZ_FAKE_UNCLASSIFIED');
    expect(unclassified).not.toContain('TOAPI_API_KEY');
    expect(unclassified).not.toContain('NODE_ENV');
  });

  it('extractEnvNames：两种读取形式都抓得到，且只抓 process.env 形式', () => {
    const src = `
      process.env.AAA;
      process.env['BBB'];
      process.env["CCC"];
      const notEnv = config.env.DDD; // 不是 process.env，不该抓
    `;
    const names = extractEnvNames(src);
    expect(names).toContain('AAA');
    expect(names).toContain('BBB');
    expect(names).toContain('CCC');
    expect(names).not.toContain('DDD');
  });

  it('已分类集合非空且含 REQUIRED 三件套', () => {
    const set = classifiedEnvNames(lists);
    expect(set.has('TOAPI_API_KEY')).toBe(true);
    expect(set.has('DATABASE_URL')).toBe(true);
    expect(set.has('BETTER_AUTH_SECRET')).toBe(true);
    expect(set.size).toBeGreaterThan(REQUIRED_ENV.length);
  });
});
