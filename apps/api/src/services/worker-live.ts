/** worker 实时画面帧缓冲（进程内，环形 ≤ maxFrames；不落盘） */
export interface LiveFrame { seq: number; at: number; bytes: Buffer; }
type Listener = (frame: LiveFrame) => void;

export class WorkerLiveBuffer {
  private readonly maxFrames: number;
  private readonly byAgent = new Map<string, LiveFrame[]>();
  private readonly seqs = new Map<string, number>();
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(opts: { maxFrames?: number } = {}) {
    this.maxFrames = opts.maxFrames ?? 10;
  }

  pushFrame(agentId: string, bytes: Buffer): LiveFrame {
    const seq = (this.seqs.get(agentId) ?? 0) + 1;
    this.seqs.set(agentId, seq);
    const frame: LiveFrame = { seq, at: Date.now(), bytes };
    const arr = this.byAgent.get(agentId) ?? [];
    arr.push(frame);
    while (arr.length > this.maxFrames) arr.shift();
    this.byAgent.set(agentId, arr);
    for (const l of this.listeners.get(agentId) ?? []) {
      // 一个订阅者抛错不应该影响其它订阅者，也不应该影响 pushFrame 的返回值。
      try {
        l(frame);
      } catch (err) {
        // CodeQL js/tainted-format-string：agentId（用户输入）不进格式串第一参数，
        // 作为独立结构化字段传给 console.error。
        console.error('[worker-live] listener 抛错', { agentId, err });
      }
    }
    return frame;
  }

  frames(agentId: string): LiveFrame[] {
    return [...(this.byAgent.get(agentId) ?? [])];
  }

  latest(agentId: string): LiveFrame | null {
    const a = this.byAgent.get(agentId);
    return a?.length ? a[a.length - 1] : null;
  }

  subscribe(agentId: string, l: Listener): () => void {
    const set = this.listeners.get(agentId) ?? new Set<Listener>();
    set.add(l);
    this.listeners.set(agentId, set);
    return () => {
      set.delete(l);
    };
  }

  /** 清空某 agent 的帧、seq、listeners（用于驱逐或主动重置） */
  clear(agentId: string): void {
    this.byAgent.delete(agentId);
    this.seqs.delete(agentId);
    this.listeners.delete(agentId);
  }

  /**
   * 驱逐空闲 agent：没有 listener 且最新帧早于 now-maxAgeMs 的一律清掉；
   * 无帧但仍留有空 listener Set 的 agent 也会被清掉。返回驱逐数。
   */
  evictIdle(maxAgeMs = 10 * 60_000): number {
    const now = Date.now();
    const ids = new Set<string>([...this.byAgent.keys(), ...this.listeners.keys()]);
    let evicted = 0;
    for (const agentId of ids) {
      const hasListener = (this.listeners.get(agentId)?.size ?? 0) > 0;
      if (hasListener) continue;
      const latest = this.latest(agentId);
      const isStale = latest ? now - latest.at >= maxAgeMs : true;
      if (isStale) {
        this.clear(agentId);
        evicted++;
      }
    }
    return evicted;
  }
}

export const workerLive = new WorkerLiveBuffer();
