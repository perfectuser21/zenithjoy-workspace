import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * 机械闸：`agents` 表的「agent_id 或 id 双条件反查」**只许出现在 agent-identity-lookup 里**。
 *
 * 这条病曾经在仓库里被复制了五份（pending-collect-tasks / report-videos / judge-video /
 * agent-burner uia-signal / agent-tenant-resolver），每一份都是 `LIMIT 1` 无 ORDER BY。
 * 交叉污染行会让它解析到别的租户，把另一个租户的任务发给设备——跨租户泄漏。
 *
 * 五份同时修好不难，难的是**下次有人再复制第六份**。审查里 DeepSeek 也点了这句
 * 「需确保所有相关路由均已迁移到该服务」——这种事不能靠自觉，配机械闸。
 *
 * 不在管辖范围内的写法（不误伤）：
 *   带 `tenant_id = $n` 前置条件的查询——它是租户内的鉴权检查（这个 agent 有没有权限
 *   回执这个任务），不是「从 id 反推租户」，天然没有跨租户歧义。
 */
const OWNER = 'agent-identity-lookup.ts';
const SRC_ROOT = join(__dirname, '..');

/** 危险模式：从 agents 表按 agent_id/id 双条件反查（两种书写顺序都算） */
const DANGEROUS = [
  'agent_id = $1 OR id::text = $1',
  'id::text = $1 OR agent_id = $1',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '__tests__') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

describe('agents 双条件反查的唯一归属 [REGRESSION]', () => {
  it('除 agent-identity-lookup 外，生产代码不许再出现裸的双条件反查', () => {
    const offenders: string[] = [];

    for (const file of walk(SRC_ROOT)) {
      if (file.endsWith(OWNER)) continue;
      const text = readFileSync(file, 'utf8');
      for (const pattern of DANGEROUS) {
        if (!text.includes(pattern)) continue;
        // 豁免：租户内鉴权检查（带 tenant_id = $n 前置），不是从 id 反推租户
        const idx = text.indexOf(pattern);
        const context = text.slice(Math.max(0, idx - 400), idx);
        if (/tenant_id\s*=\s*\$\d/.test(context)) continue;
        offenders.push(`${file.replace(SRC_ROOT, 'src')} :: ${pattern}`);
      }
    }

    expect(
      offenders,
      '这些地方又在裸查 agents 双条件了——必须改用 lookupAgentIdentity()，' +
        '否则交叉污染行会让它解析到别的租户（跨租户泄漏）：\n' + offenders.join('\n'),
    ).toEqual([]);
  });

  it('自测：扫描逻辑本身抓得到（防止守卫变成摆设）', () => {
    // 守卫真正的判据是"文件里出现危险串且上文没有 tenant_id 限定"——这里直接验这个判据
    const bad = 'const q = `SELECT tenant_id FROM zenithjoy.agents WHERE agent_id = $1 OR id::text = $1 LIMIT 1`';
    const good = 'const q = `SELECT id FROM zenithjoy.agents WHERE tenant_id = $3 AND (id::text = $1 OR agent_id = $1)`';

    const isOffender = (text: string) =>
      DANGEROUS.some((pattern) => {
        const idx = text.indexOf(pattern);
        if (idx < 0) return false;
        return !/tenant_id\s*=\s*\$\d/.test(text.slice(Math.max(0, idx - 400), idx));
      });

    expect(isOffender(bad)).toBe(true);
    expect(isOffender(good)).toBe(false);
  });
});
