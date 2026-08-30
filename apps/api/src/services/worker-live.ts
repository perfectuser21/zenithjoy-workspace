/** worker 实时画面帧缓冲（进程内，环形 ≤ maxFrames；不落盘） */
export interface LiveFrame { seq: number; at: number; bytes: Buffer; }
type Listener = (frame: LiveFrame) => void;
export class WorkerLiveBuffer {
  private readonly maxFrames: number;
  private readonly byAgent = new Map<string, LiveFrame[]>();
  private readonly seqs = new Map<string, number>();
  private readonly listeners = new Map<string, Set<Listener>>();
  constructor(opts: { maxFrames?: number } = {}) { this.maxFrames = opts.maxFrames ?? 10; }
  pushFrame(agentId: string, bytes: Buffer): LiveFrame {
    const seq = (this.seqs.get(agentId) ?? 0) + 1; this.seqs.set(agentId, seq);
    const frame: LiveFrame = { seq, at: Date.now(), bytes };
    const arr = this.byAgent.get(agentId) ?? []; arr.push(frame);
    while (arr.length > this.maxFrames) arr.shift();
    this.byAgent.set(agentId, arr);
    for (const l of this.listeners.get(agentId) ?? []) l(frame);
    return frame;
  }
  frames(agentId: string): LiveFrame[] { return [...(this.byAgent.get(agentId) ?? [])]; }
  latest(agentId: string): LiveFrame | null { const a = this.byAgent.get(agentId); return a?.length ? a[a.length - 1] : null; }
  subscribe(agentId: string, l: Listener): () => void {
    const set = this.listeners.get(agentId) ?? new Set<Listener>(); set.add(l); this.listeners.set(agentId, set);
    return () => { set.delete(l); };
  }
}
export const workerLive = new WorkerLiveBuffer();
