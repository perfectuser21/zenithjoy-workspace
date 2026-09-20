/**
 * 任务失败码 → 人话（Brain task 3bbdb025）
 *
 * 主理人原话：「触达·峰叔向阳而生失败了，你没跟我说这个为啥失败。」
 * 页面此前直接把 `error_code` 原样甩出来（executor_lost 这种），看的人得去翻代码。
 * 这里做两件事：给一句能看懂的结论，再给一句「那该怎么办」。
 */

export interface ErrorExplain {
  /** 一句话结论，列表里直接显示 */
  label: string;
  /** 下一步怎么办，鼠标悬停或展开时显示 */
  hint: string;
  /** 是否需要人介入（要处理），false = 系统自己会重来 */
  needsHuman: boolean;
}

const TABLE: Record<string, ErrorExplain> = {
  executor_lost: {
    label: '机器失联',
    hint: '手机侧超过 10 分钟没上报，任务被判失联。活本身可能已经跑完了，只是回报没送到（跨境网络抖动，0920 已修：关键上报超时放宽到 8 秒并重试）。',
    needsHuman: false,
  },
  superseded: {
    label: '被新任务顶替',
    hint: '同一台手机上另一条链开了新任务，旧的被收尾。通常发生在采收与触达的时窗交界处。',
    needsHuman: false,
  },
  lock_busy: {
    label: '设备被占用',
    hint: '想干活时手机正被另一条链（多半是采收）锁着，本单回队列等下一轮。',
    needsHuman: false,
  },
  device_offline: {
    label: '手机离线',
    hint: '开工前检查发现 adb 连不上。查 USB 线、无线调试开关，或者机器是不是关机了。',
    needsHuman: true,
  },
  keywords_unavailable: {
    label: '取不到关键词',
    hint: '网关没给出词单，本地也没有缓存兜底。查 OpenClaw 网关是否健在、关键词表有没有启用行。',
    needsHuman: true,
  },
  transient_exhausted: {
    label: '重试用尽',
    hint: '瞬时失败连续重试到上限仍不成功，已回队列。多为输入法或前台被抢，看失败截图确认。',
    needsHuman: true,
  },
  captcha: { label: '要过验证码', hint: '平台弹了验证码，得人在手机上过一次。', needsHuman: true },
  auth_dialog: { label: '要点授权弹窗', hint: '系统权限弹窗挡住了，需要在手机上点允许。', needsHuman: true },
  login_expired: { label: '登录态失效', hint: '账号掉登录了，需要在手机上重新登录。', needsHuman: true },
  adb_unreachable: { label: 'adb 连不上', hint: '驱动手机的通道断了。查 USB 线与 adb 服务。', needsHuman: true },
  stopped: { label: '被中止', hint: '任务被人为或上层流程中止。', needsHuman: false },
  blocked: { label: '被挡住', hint: '前置条件没满足，等条件齐了会继续。', needsHuman: true },
};

/** 未登记的码：原样显示，但标成需要人看一眼（不认识的失败别默默吞掉） */
export function explainError(code: string | null | undefined): ErrorExplain | null {
  if (!code) return null;
  return TABLE[code] ?? { label: code, hint: '未登记的失败码，需要人工确认原因。', needsHuman: true };
}

/** 供测试与守卫用：已登记的码 */
export const KNOWN_ERROR_CODES = Object.keys(TABLE);
