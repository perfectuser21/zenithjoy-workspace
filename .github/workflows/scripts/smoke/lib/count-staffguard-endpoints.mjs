#!/usr/bin/env node
/**
 * `count-staffguard-endpoints.mjs` 的 lib/ 入口 —— 转发到既有实现，不复制逻辑。
 *
 * 为什么存在：路③ 合同的 INV-回归 判据按 `.github/workflows/scripts/smoke/lib/` 路径调用它，
 * 而既有实现落在 `.github/workflows/scripts/`（路① 交付时的位置，`knowledge-hub-path1-smoke.sh:297`
 * 至今按那个路径调）。两边都得能用：搬文件会打断路① smoke（合同「已知约束」明令不得削弱），
 * 复制一份逻辑则会漂移成两个各说各话的计数器——那正是这个守卫要防的事情本身。
 *
 * 所以这里只做一件事：把 stdout 原样转发。计数口径的唯一真相仍在上层那个文件里。
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const impl = resolve(here, '..', '..', 'count-staffguard-endpoints.mjs');

const r = spawnSync(process.execPath, [impl], { encoding: 'utf8' });
if (r.status !== 0) {
  process.stderr.write(r.stderr ?? `无法执行 ${impl}\n`);
  process.exit(r.status ?? 1);
}
process.stdout.write(r.stdout ?? '');
