#!/usr/bin/env node
/**
 * INV-7 [禁写死环境假设值] 扫描器 —— 交付脚本零硬编码端口/UUID/连接串
 *
 * 用法：node scan-hardcoded-env.mjs <file> [<file> ...]
 *   命中任何一条 → 逐条打印 `<文件>:<行号>: <说明>` 并 exit 1。
 *
 * 要拦的事故：脚本里写死一个 uuid 或一个端口，本地跑绿了、CI 上测的却是另一个库/另一个进程，
 * 或者干脆测到了别人的服务上还看着像绿的。判据是「有没有覆盖入口」而不是「有没有出现数字」：
 *
 *   ✅ 允许 `${WORKBENCH_SMOKE_PORT:-52320}`     —— 默认值 + env 覆盖入口，换环境改一个变量即可
 *   ✅ 允许 `$SFX` / `$(uuidgen)` / `RETURNING id` —— 运行时生成
 *   ❌ 拦截 `curl http://localhost:52320/...`     —— 端口写死在 URL 里，没有覆盖入口
 *   ❌ 拦截 `WHERE id = '3f2a...-...'`            —— uuid 字面量
 *   ❌ 拦截 `postgresql://postgres@localhost:5432/xxx` —— 连接串字面量
 *
 * 本扫描器自己也被变异证明（INV7-inject-hardcoded-env），判据含"输出点名文件与行号"，
 * 所以 exit 1 之外必须说得出红在哪一行。
 */
import { readFileSync, statSync } from 'node:fs';

/** 形如 ${VAR:-default} / ${VAR:?} / ${VAR} —— 有覆盖入口，不算写死 */
const PARAM_EXPANSION = /\$\{[A-Za-z_][A-Za-z0-9_]*(:[-?=+][^}]*)?\}/g;
/** PowerShell / JS 里的 env 读法 */
const ENV_READ = /(\$env:[A-Za-z_][A-Za-z0-9_]*|process\.env\.[A-Za-z_][A-Za-z0-9_]*)/g;

const RULES = [
  {
    name: 'uuid 字面量（该由运行时 INSERT ... RETURNING 现生成）',
    re: /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/,
  },
  {
    name: '数据库连接串字面量（该从 E2E_DATABASE_URL / DATABASE_URL 取）',
    re: /\b(postgres(?:ql)?|mysql|mongodb|redis):\/\/[^\s'"`$]+/i,
  },
  {
    name: '主机+端口写死在 URL 里（该走 ${PORT_VAR:-默认} 之类的覆盖入口）',
    re: /https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d{2,5})/i,
  },
];

/**
 * 把"有覆盖入口"的片段先抠掉再判定 —— 否则 `http://localhost:${PORT:-52320}` 会被
 * 端口规则误伤，而它恰恰是本 INV 想要的正确写法。
 */
function neutralize(line) {
  return line.replace(PARAM_EXPANSION, '§').replace(ENV_READ, '§').replace(/\$[A-Za-z_][A-Za-z0-9_]*/g, '§');
}

function main() {
  const targets = process.argv.slice(2);
  if (targets.length === 0) {
    console.error('用法: scan-hardcoded-env.mjs <file> [<file> ...]');
    process.exit(2);
  }

  const missing = [];
  for (const t of targets) {
    try {
      statSync(t);
    } catch {
      missing.push(t);
    }
  }
  if (missing.length > 0) {
    for (const m of missing) console.error(`MISSING: ${m} —— 被扫目标不存在，扫描域名不副实`);
    process.exit(1);
  }

  const hits = [];
  for (const file of targets) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((raw, i) => {
      // 纯注释行也扫：注释里抄一串真 uuid，下一个人复制粘贴就用上了
      const line = neutralize(raw);
      for (const rule of RULES) {
        if (rule.re.test(line)) {
          hits.push(`${file}:${i + 1}: ${rule.name}`);
          break;
        }
      }
    });
  }

  if (hits.length > 0) {
    console.error(`INV-7 命中 ${hits.length} 处写死的环境假设值：`);
    for (const h of hits) console.error(`  ${h}`);
    process.exit(1);
  }

  console.log(`✅ INV-7 通过：扫描 ${targets.length} 个文件，零写死端口/UUID/连接串`);
}

main();
