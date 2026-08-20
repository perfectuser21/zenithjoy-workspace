#!/usr/bin/env node
/**
 * INV-4 [凭据安全] 扫描器 —— 交付物里零硬编码 secret
 *
 * 用法：node scan-hardcoded-secrets.mjs <path> [<path> ...]
 *   path 可以是文件或目录（目录递归）。命中任何一条 → 逐条打印 `<文件>:<行号>: <说明>` 并 exit 1。
 *
 * 为什么要打行号：这个扫描器自己也要被变异证明（INV4-inject-secret 往被扫目录塞一个假连接串，
 * 断言它 exit≠0 **且输出点名那个文件与行号**）。只 exit 1 不打位置的空实现拿不到这一条——
 * 「守卫说自己红了」不算数，得说得出红在哪。
 *
 * 判定口径（宁可漏报也不误报，误报会让人开始给守卫加豁免，那才是守卫死亡的开始）：
 *   命中 = 值本身就写在源码里的凭据。
 *   不命中 = 从 env 读（process.env.X / $VAR / ${VAR:-...}）、占位符（<...>、xxx、your-）、
 *            以及明确标注 fake/example/placeholder 的测试替身。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const SCAN_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.sh', '.sql', '.yml', '.yaml', '.ps1', '.md']);
const SKIP_DIR = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', 'screenshots']);

/** 明显不是真凭据的形态：占位符 / 假替身 / 从 env 取 */
const BENIGN = [
  /process\.env\./,
  /\$\{?[A-Za-z_][A-Za-z0-9_]*/,      // $VAR / ${VAR} / ${VAR:-default}
  /<[A-Za-z_-]+>/,                     // <YOUR_TOKEN>
  /\b(fake|example|placeholder|dummy|sample|redacted|your-|xxx+|changeme|not-for-prod)\b/i,
];

const RULES = [
  {
    // 指向 localhost / 127.0.0.1 的不算：那是 CI service 容器或本机开发库，口令不出这台机器，
    // 本仓既有 workflow 一直这么写。真正的风险是把**远程主机**的口令写进源码。
    name: '硬编码数据库连接串（含口令，指向远程主机）',
    re: /\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s'"`/]*:[^\s'"`@/]+@(?!localhost|127\.0\.0\.1)[^\s'"`/]+/i,
  },
  {
    name: '硬编码 AWS/腾讯云 AccessKey',
    re: /\b(AKIA[0-9A-Z]{16}|AKID[0-9A-Za-z]{20,})\b/,
  },
  {
    name: '硬编码 API key / token 赋值',
    // KEY = "长串"：只在赋值位命中，且值长度足以像真凭据
    re: /\b(?:api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|secret)\b\s*[:=]\s*['"`][^'"`\s]{12,}['"`]/i,
  },
  {
    name: '硬编码私钥块',
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  },
  {
    name: '硬编码 Bearer 凭据',
    re: /\bBearer\s+[A-Za-z0-9_\-.]{20,}/,
  },
];

function collect(target, out) {
  let st;
  try {
    st = statSync(target);
  } catch {
    // 被扫路径不存在本身就是问题：清单指向了不存在的东西 = 这一项从来没被扫过
    out.missing.push(target);
    return;
  }
  if (st.isDirectory()) {
    for (const entry of readdirSync(target)) {
      if (SKIP_DIR.has(entry)) continue;
      collect(join(target, entry), out);
    }
    return;
  }
  if (!SCAN_EXT.has(extname(target))) return;
  out.files.push(target);
}

function main() {
  const targets = process.argv.slice(2);
  if (targets.length === 0) {
    console.error('用法: scan-hardcoded-secrets.mjs <path> [<path> ...]');
    process.exit(2);
  }

  const out = { files: [], missing: [] };
  for (const t of targets) collect(t, out);

  if (out.missing.length > 0) {
    for (const m of out.missing) console.error(`MISSING: ${m} —— 被扫目标不存在，扫描域名不副实`);
    process.exit(1);
  }

  const hits = [];
  for (const file of out.files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (BENIGN.some((b) => b.test(line))) return;
      for (const rule of RULES) {
        if (rule.re.test(line)) {
          hits.push(`${file}:${i + 1}: ${rule.name}`);
          break;
        }
      }
    });
  }

  if (hits.length > 0) {
    console.error(`INV-4 命中 ${hits.length} 处硬编码凭据：`);
    for (const h of hits) console.error(`  ${h}`);
    process.exit(1);
  }

  console.log(`✅ INV-4 通过：扫描 ${out.files.length} 个文件，零硬编码凭据`);
}

main();
