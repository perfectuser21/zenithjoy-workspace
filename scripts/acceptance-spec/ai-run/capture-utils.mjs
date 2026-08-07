/**
 * capture-utils.mjs — 采证器纯逻辑工具函数（无 playwright/外部依赖）
 *
 * 这些函数从 capture.mjs 拆分出来，以便在不加载 playwright 的情况下做单元测试。
 */

/**
 * 采证前双自检：登录租户 == 专用验收租户 且 run-summary 可见单头 device_model
 * 任一不满足返回 { ok: false, reason }
 *
 * @param {{ tenantId: string, acceptanceTenantId: string, machinesOnline: number, requiredDeviceModel: string, runSummaryDevices: string[] }} opts
 * @returns {Promise<{ ok: boolean, reason: string|null }>}
 */
export async function preflightCheck({ tenantId, acceptanceTenantId, machinesOnline, requiredDeviceModel, runSummaryDevices } = {}) {
  // 检查1：登录租户必须是专用验收租户
  if (tenantId !== acceptanceTenantId) {
    return { ok: false, reason: `ai_incomplete: 租户不匹配（当前=${tenantId}，期望=${acceptanceTenantId}）` };
  }

  // 检查2：在线机器数必须 > 0
  if (!machinesOnline || machinesOnline <= 0) {
    return { ok: false, reason: 'ai_incomplete: no device online（无在线机）' };
  }

  // 检查3：单头设备必须在 runSummaryDevices 列表中
  if (!runSummaryDevices || !runSummaryDevices.includes(requiredDeviceModel)) {
    return { ok: false, reason: `ai_incomplete: 单头设备不在列表（${requiredDeviceModel} not found in [${(runSummaryDevices || []).join(',')}]）` };
  }

  return { ok: true, reason: null };
}

/**
 * 自持轮询直到出现终态或超时
 * @param {{ getPageText: () => Promise<string>, waitBudgetMs: number, pollIntervalMs: number, cellIds: string[], captureFor: Function, log: Function }} opts
 * @returns {Promise<{ ticks: number, earlyExit: boolean, elapsed_ms: number }>}
 */
export async function pollUntilTerminal({ getPageText, waitBudgetMs = 300000, pollIntervalMs = 60000, cellIds = [], captureFor: _captureFor = async () => {}, log: _log = () => {} } = {}) {
  const TERMINAL_PATTERN = /已完成|失败|completed|failed|成功/;
  const start = Date.now();
  let ticks = 0;

  while (true) {
    ticks += 1;
    const text = await getPageText();
    const elapsed = Date.now() - start;

    if (TERMINAL_PATTERN.test(text)) {
      return { ticks, earlyExit: true, elapsed_ms: elapsed };
    }

    if (elapsed >= waitBudgetMs) {
      return { ticks, earlyExit: false, elapsed_ms: elapsed };
    }

    const remaining = waitBudgetMs - elapsed;
    await new Promise(r => setTimeout(r, Math.min(pollIntervalMs, remaining)));
  }
}

/**
 * S4-c2 三档取数：
 * 档1：页面同时含掉线时刻（设备离线时间）和上线时刻（设备上线时间）→ 计算差值分钟数
 * 档2：页面只有上线时刻 + deviceRebootAt → 计算差值分钟数
 * 档3：两个时刻都无 → reason='human_only'
 *
 * @param {{ pageText: string, deviceRebootAt: string|null }} opts
 * @returns {Promise<{ tier: number, value_minutes?: number, reason?: string }>}
 */
export async function computeS4C2RecoveryWindow({ pageText = '', deviceRebootAt = null } = {}) {
  // 尝试解析页面文本中的时间戳（格式：YYYY-MM-DD HH:mm:ss）
  const offlineMatch = pageText.match(/设备离线时间[：:]\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/);
  const onlineMatch = pageText.match(/设备上线时间[：:]\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/);

  if (offlineMatch && onlineMatch) {
    // 档1：页面同时含掉线与上线时刻
    const offlineMs = new Date(offlineMatch[1].replace(' ', 'T')).getTime();
    const onlineMs = new Date(onlineMatch[1].replace(' ', 'T')).getTime();
    const diffMinutes = Math.round((onlineMs - offlineMs) / 60000);
    return { tier: 1, value_minutes: diffMinutes };
  }

  if (onlineMatch && deviceRebootAt) {
    // 档2：只有上线时刻 + device_reboot_at
    const onlineMs = new Date(onlineMatch[1].replace(' ', 'T')).getTime();
    const rebootMs = new Date(deviceRebootAt).getTime();
    const diffMinutes = Math.round((onlineMs - rebootMs) / 60000);
    return { tier: 2, value_minutes: Math.max(0, diffMinutes) };
  }

  // 档3：无时刻信息
  return { tier: 3, reason: 'human_only' };
}
