// services/agent/src/preflight/types.ts
//
// per-Line 模块 preflight（环境预检）结果类型。
// 每个 Line 模块激活前先跑对应检测，结果同时本地弹窗 + 上报中台心跳。

export interface PreflightChecks {
  wechat_version?: boolean;
  pywinauto?: boolean;
  memory?: boolean;
}

export interface PreflightResult {
  ok: boolean;
  // 人类可读的失败原因（中文，客户看得懂）。ok=true 时省略。
  reason?: string;
  checks: PreflightChecks;
}

// 单项检测返回。skipped 用于非 Windows 平台跳过 Windows-only 检测（视为通过）。
export interface CheckOutcome {
  ok: boolean;
  reason?: string;
  skipped?: boolean;
}
