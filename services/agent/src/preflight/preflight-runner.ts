// services/agent/src/preflight/preflight-runner.ts
//
// 对外接口：按 lineId 执行对应模块的环境预检。
// lineId 取值见心跳响应 modules 字段的 key。

import path from 'node:path';
import fs from 'node:fs';
import type { PreflightResult } from './types';
import { runLine04Preflight } from './line04-preflight';
import { runLine01Preflight } from './line01-preflight';
import { runLine02Preflight } from './line02-preflight';
import { runLine05Preflight } from './line05-preflight';

export type LineId =
  | 'line04-wechat-cs'
  | 'line01-publish'
  | 'line02-lead-gen'
  | 'line05-video';

// 与 wechat-rpa.ts 同款逻辑：bundled install pack 含 python-embedded/python.exe，
// 否则回退系统 python3。
export function getPythonExe(): string {
  const baseDir = path.dirname(process.execPath);
  const embedded = path.join(baseDir, 'python-embedded/python.exe');
  return fs.existsSync(embedded) ? embedded : 'python3';
}

export async function runPreflight(lineId: string): Promise<PreflightResult> {
  switch (lineId) {
    case 'line04-wechat-cs':
      return runLine04Preflight(getPythonExe());
    case 'line01-publish':
      return runLine01Preflight();
    case 'line02-lead-gen':
      return runLine02Preflight();
    case 'line05-video':
      return runLine05Preflight();
    default:
      return { ok: false, reason: `未知模块：${lineId}`, checks: {} };
  }
}
