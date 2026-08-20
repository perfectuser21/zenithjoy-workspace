#!/usr/bin/env node
/**
 * A2 扫描域推导器 —— 从**挂载事实**现算路③ 的源码集合，不吃写死的文件名清单
 *
 * 为什么不写死清单：路③ 的路由哪天拆成两个文件、或者中间件改名，而清单没同步，
 * 守卫扫的就全是登记过的旧文件、变异注入的也是登记过的旧文件——真正的路③ 源码
 * 从头到尾没被扫过，七个字面量"零命中"于是恒真。空集上的零命中是最典型的假绿。
 *
 * 三路推导（并集）：
 *   ① app.ts 里 `app.use('/api/knowledge/db', <router>)` 的 router 标识符 → 回溯它的 import
 *      → 得到路③ 路由源文件；再从它做**相对 import 传递闭包**（中间件与 service 自动进域）
 *   ② app.ts 自身（挂载点本身也是路③ 的一部分，它要是写了身份头名同样是命门破口）
 *   ③ `git diff --name-only origin/main...HEAD` 里含 `/api/knowledge/db` 或 workbench 字面量的
 *      apps/api/src / apps/staff-hub/src 下的 .ts/.tsx —— 兜住"新文件还没被谁 import"的窗口期
 *
 * 显式排除（不排除的话守卫会扫到自己，或把负向测试当成违规）：
 *   - `structured-workbench-smoke.sh`：它必须写出这七个字面量才能去查
 *   - `sprints/**\/tests/**`：负向用例必须真伪造头才有意义
 *   - `lib/*.mjs` 扫描器自身：同理，规则里必然带着被禁的名字
 *
 * 输出：每行一个文件路径（repo 相对）。无法解析出路③ 路由时 exit 1 —— 推导失败必须报红，
 * 悄悄退化成空集就等于把守卫关了。
 */
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join, normalize } from 'node:path';

const APP_TS = 'apps/api/src/app.ts';
const MOUNT_PATH = '/api/knowledge/db';

const EXCLUDE_PATTERNS = [
  /\/structured-workbench-smoke\.sh$/,
  /^sprints\/.*\/tests\//,
  /\/scripts\/smoke\/lib\/.*\.mjs$/,
];

function isExcluded(f) {
  return EXCLUDE_PATTERNS.some((p) => p.test(f));
}

/** ① app.use('/api/knowledge/db', X) → X → import 语句 → 源文件 */
function resolveMountedRouter(appSrc) {
  const mount = new RegExp(
    `app\\.use\\(\\s*['"\`]${MOUNT_PATH.replace(/\//g, '\\/')}['"\`]\\s*,\\s*([A-Za-z_$][\\w$]*)\\s*\\)`
  ).exec(appSrc);
  if (!mount) return null;
  const ident = mount[1];

  // `import { X } from './routes/y'` / `import X from './routes/y'`
  const importRe = new RegExp(
    `import\\s+(?:\\{[^}]*\\b${ident}\\b[^}]*\\}|${ident})\\s+from\\s+['"\`](\\.[^'"\`]+)['"\`]`
  );
  const imp = importRe.exec(appSrc);
  if (!imp) return null;
  return resolveRelative(APP_TS, imp[1]);
}

function resolveRelative(fromFile, spec) {
  const base = normalize(join(dirname(fromFile), spec));
  for (const cand of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(cand)) return cand;
  }
  return null;
}

/** 文件内容自称是路③ 的 —— 这是"属于路③"的判据，不是文件名约定 */
function isPathThree(file) {
  return /\/api\/knowledge\/db|[Ww]orkbench/.test(readFileSync(file, 'utf8'));
}

/**
 * 相对 import 传递闭包，但**只跟随路③ 自己的文件**。
 *
 * 一层不够：service 再往下 import 的模板/常量同样是路③ 源码，漏掉它们就等于漏扫。
 * 无限跟随又会把既有基础设施（`../auth`、`db/connection`、license service…）整片拖进来——
 * 那些不是本刀的交付物，A2 管的是"路③ 有没有重新引入可伪造的身份来源"，
 * 把别人的既有代码算进来只会让守卫红在与路③ 无关的地方，然后被加豁免，然后死掉。
 */
function importClosure(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift();
    if (!file || seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    const src = readFileSync(file, 'utf8');
    const re = /(?:import|export)[\s\S]{0,200}?from\s+['"`](\.[^'"`]+)['"`]/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const target = resolveRelative(file, m[1]);
      if (target && !seen.has(target) && isPathThree(target)) queue.push(target);
    }
  }
  return [...seen];
}

/** ③ 本分支新增/改动的、内容自称是路③ 的源文件 */
function changedPathThreeFiles() {
  let out = '';
  try {
    out = execSync('git diff --name-only origin/main...HEAD -- apps/api/src apps/staff-hub/src', {
      encoding: 'utf8',
    });
  } catch {
    return [];
  }
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter((f) => f && /\.(ts|tsx)$/.test(f) && existsSync(f))
    .filter((f) => /\/api\/knowledge\/db|[Ww]orkbench/.test(readFileSync(f, 'utf8')));
}

function main() {
  if (!existsSync(APP_TS)) {
    console.error(`FAIL: 找不到 ${APP_TS}，无法从挂载事实推导扫描域`);
    process.exit(1);
  }
  const appSrc = readFileSync(APP_TS, 'utf8');

  const entry = resolveMountedRouter(appSrc);
  if (!entry) {
    console.error(
      `FAIL: ${APP_TS} 里找不到 app.use('${MOUNT_PATH}', <router>) 或其 import —— ` +
        '路③ 未按合同挂载，或挂载写法变了；推导失败必须报红，不许退化成空集'
    );
    process.exit(1);
  }

  const scope = new Set([APP_TS, ...importClosure(entry), ...changedPathThreeFiles()]);
  const files = [...scope].filter((f) => !isExcluded(f)).sort();

  if (files.length < 3) {
    console.error(`FAIL: 扫描域仅 ${files.length} 项（<3，疑似推导退化）`);
    process.exit(1);
  }
  for (const f of files) console.log(f);
}

main();
