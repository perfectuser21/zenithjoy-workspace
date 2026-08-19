#!/usr/bin/env node
/**
 * 数一数「被 staffGuard 保护的端点」有多少个，往 stdout 打一个数字。
 *
 * 为什么需要它（A31 前置保护）：staffGuard 的唯一判据是两个明文身份头，而本 line 的知识面
 * 要求「一个身份头都不许拼」。实现期最自然的偷懒方向就是把 adminFetch 里的头全局摘掉 ——
 * 一摘，这些既有端点会对全体用户一律 403，Staff Hub 整体不可用。
 * 端点数一旦对不上 16，说明有人动了这条保护线，直接报红。
 *
 * 计数口径：文件里 `router.use(staffGuard)` 之后注册的 router.<method>(...) 逐个算一个。
 * 之前注册的（如公开的 feishu-login）不算。
 */
import { readFileSync } from 'node:fs';

const FILES = ['apps/api/src/routes/staff.ts', 'apps/api/src/routes/skill-drafts.ts'];

const GUARD_RE = /^\s*router\.use\(\s*staffGuard\s*\)/;
const ENDPOINT_RE = /^\s*router\.(get|post|put|patch|delete|all)\s*\(/;

let total = 0;
for (const file of FILES) {
  let guarded = false;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!guarded) {
      if (GUARD_RE.test(line)) guarded = true;
      continue;
    }
    if (ENDPOINT_RE.test(line)) total += 1;
  }
}

process.stdout.write(String(total));
