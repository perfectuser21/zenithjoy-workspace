/**
 * env 接缝通用闸门 —— 全 src 扫描 + 强制分类的 SSOT（commit-1：先放空清单，让闸门红）。
 *
 * 治根（接续 PR #800）：#800 的完整性测试只对手写声明的 2 个文件做断言，别处新增的
 * `process.env.X` 它看不到 → 仍会"漏 key"。本模块把闸门升级成"扫遍全 apps/api/src、
 * 每个 env 读取都必须被归类"。commit-1 故意 OPTIONAL/FRAMEWORK 留空 → env-gate.test.ts 红，
 * 老实暴露现状（现有 src 一堆 process.env.X 还没分类）。commit-2 再补齐分类转绿。
 */

import { REQUIRED_ENV } from './startup-check';

export { REQUIRED_ENV };

/** 会读但缺了不致命的 env（commit-1 暂空，commit-2 补齐 + 每条写 reason）。 */
export const OPTIONAL_ENV: { name: string; reason: string }[] = [];

/** 框架 / 运行时通用变量白名单（commit-1 暂空，commit-2 补齐）。 */
export const FRAMEWORK_ENV: string[] = [];

/** 已分类的 env 名称集合（REQUIRED ∪ OPTIONAL.name ∪ FRAMEWORK）。 */
export function classifiedEnvNames(
  lists: {
    required: string[];
    optional: { name: string }[];
    framework: string[];
  } = { required: REQUIRED_ENV, optional: OPTIONAL_ENV, framework: FRAMEWORK_ENV },
): Set<string> {
  const set = new Set<string>();
  for (const k of lists.required) set.add(k);
  for (const o of lists.optional) set.add(o.name);
  for (const k of lists.framework) set.add(k);
  return set;
}

/** 框架变量判断：白名单命中，或 npm_ 前缀（npm/pnpm 注入的一大族变量）。 */
export function isFrameworkEnv(name: string, framework: string[] = FRAMEWORK_ENV): boolean {
  if (framework.includes(name)) return true;
  if (name.startsWith('npm_')) return true;
  return false;
}

/**
 * 纯函数闸门核心（便于单测 proven-to-fire）：从源码文本抓所有 process.env 读取，
 * 返回未被任何清单归类的 env 名（去重、排序）。
 */
export function findUnclassifiedEnv(
  srcText: string,
  lists: {
    required: string[];
    optional: { name: string }[];
    framework: string[];
  } = { required: REQUIRED_ENV, optional: OPTIONAL_ENV, framework: FRAMEWORK_ENV },
): string[] {
  const names = extractEnvNames(srcText);
  const classified = classifiedEnvNames(lists);
  const unclassified = new Set<string>();
  for (const name of names) {
    if (classified.has(name)) continue;
    if (isFrameworkEnv(name, lists.framework)) continue;
    unclassified.add(name);
  }
  return [...unclassified].sort();
}

/**
 * 从源码文本抽取所有被 process.env 读取的变量名（去重、排序）。
 * 匹配 process.env.IDENTIFIER 与 process.env['KEY'] / process.env["KEY"] 两种形式。
 */
export function extractEnvNames(srcText: string): string[] {
  const names = new Set<string>();
  const dotRe = /process\.env\.([A-Za-z_$][A-Za-z0-9_$]*)/g;
  const bracketRe = /process\.env\[\s*['"]([A-Za-z_$][A-Za-z0-9_$]*)['"]\s*\]/g;
  let m: RegExpExecArray | null;
  while ((m = dotRe.exec(srcText)) !== null) names.add(m[1]);
  while ((m = bracketRe.exec(srcText)) !== null) names.add(m[1]);
  return [...names].sort();
}
