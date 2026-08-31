// services/agent/src/handlers/frame-pusher.ts
//
// 把桌面帧推给中台「工作机」控制塔（工作机控制塔第二刀·件3 的 Node 侧）。
//
// 端点与鉴权跟安卓端同一套（中台 PR #1748）：
//   POST <apiBase>/api/workers/<agentUuid>/frame
//   X-Agent-License: <license_key>，body 是 JPEG 原始字节
// 客户机 agent 拿不到内部编排 token，只有装机时发的 license。
//
// 四种「不发出去」，每一种都有具体理由：
//   · 未配置（agentUuid 不是 uuid / license 空）——服务端 requireAgentUuid 只会 400
//   · 帧过大——服务端 express.raw limit 120KB，超了必 413
//   · 上一帧还在途——桌面机链路可能很慢，8fps 下不合并会攒出无界队列，越攒越旧
//   · 凭据被拒后的退避——401/403 重试一万次是同一个答案

/** 服务端 `express.raw({ limit: '120kb' })`，本地卡 118KB 留余量。 */
export const MAX_FRAME_BYTES = 118 * 1024;

/** 凭据被拒后的退避：等人去改 license / 换机器，不是等网络恢复。 */
export const REJECTED_BACKOFF_MS = 60_000;

export type FramePushResult =
  | 'pushed'
  | 'skipped_not_configured'
  | 'skipped_no_frame'
  | 'skipped_too_large'
  | 'skipped_in_flight'
  | 'skipped_backoff'
  | 'rejected'
  | 'failed';

export interface FramePusherOptions {
  apiBase: string;
  license: string;
  /** `zenithjoy.agents.id`（UUID），即 cfg.agentUuid —— 不是文本 agentId。 */
  agentUuid: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  onResult?: (result: FramePushResult) => void;
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export class FramePusher {
  private inFlight = false;
  private backoffUntil = 0;
  private readonly opts: Required<Omit<FramePusherOptions, 'onResult'>> &
    Pick<FramePusherOptions, 'onResult'>;

  constructor(options: FramePusherOptions) {
    this.opts = {
      fetchImpl: fetch,
      now: () => Date.now(),
      ...options,
    };
  }

  async push(jpeg: Buffer): Promise<FramePushResult> {
    const result = await this.doPush(jpeg);
    this.opts.onResult?.(result);
    return result;
  }

  private async doPush(jpeg: Buffer): Promise<FramePushResult> {
    if (!this.opts.license || !UUID_RE.test(this.opts.agentUuid)) return 'skipped_not_configured';
    if (!jpeg || jpeg.length === 0) return 'skipped_no_frame';
    if (jpeg.length > MAX_FRAME_BYTES) return 'skipped_too_large';
    if (this.opts.now() < this.backoffUntil) return 'skipped_backoff';
    // 丢新帧而不是排队：排队排出来的是越来越旧的画面，上墙看的是"现在"
    if (this.inFlight) return 'skipped_in_flight';

    this.inFlight = true;
    try {
      const res = await this.opts.fetchImpl(
        `${this.opts.apiBase.replace(/\/+$/, '')}/api/workers/${this.opts.agentUuid}/frame`,
        {
          method: 'POST',
          headers: {
            'X-Agent-License': this.opts.license,
            'Content-Type': 'image/jpeg',
          },
          // Buffer 在本仓 TS lib 配置下不是合法 BodyInit，转成 Uint8Array 视图（零语义差）
          body: new Uint8Array(jpeg),
        },
      );
      if (res.ok) return 'pushed';
      if (res.status === 401 || res.status === 403) {
        this.backoffUntil = this.opts.now() + REJECTED_BACKOFF_MS;
        return 'rejected';
      }
      return 'failed';
    } catch {
      // 网络异常绝不抛进事件循环（同 HeartbeatLoop 既有约定）
      return 'failed';
    } finally {
      this.inFlight = false;
    }
  }
}
