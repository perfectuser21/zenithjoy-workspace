// services/agent/src/preflight/line02-preflight.ts
//
// Line02 智能获客模块 preflight — thin stub。
// 后续加厚时补真实检测（抖音小号 session 隔离 / Chrome user-data-dir 等）。

import type { PreflightResult } from './types';

export async function runLine02Preflight(): Promise<PreflightResult> {
  return { ok: true, checks: {} };
}
