// services/agent/src/preflight/line05-preflight.ts
//
// Line05 视频剪辑模块 preflight — thin stub。
// 后续加厚时补真实检测（ffmpeg / 磁盘空间等）。

import type { PreflightResult } from './types';

export async function runLine05Preflight(): Promise<PreflightResult> {
  return { ok: true, checks: {} };
}
