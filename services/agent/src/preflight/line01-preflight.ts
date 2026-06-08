// services/agent/src/preflight/line01-preflight.ts
//
// Line01 智能发布模块 preflight — thin stub。
// 发布模块暂无强环境依赖，直接返回通过；后续加厚时补真实检测。

import type { PreflightResult } from './types';

export async function runLine01Preflight(): Promise<PreflightResult> {
  return { ok: true, checks: {} };
}
