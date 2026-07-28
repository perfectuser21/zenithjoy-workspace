// PanelEventsTail — 桥接 Python(listen_chat.py) 写的 panel-events.jsonl → TS 侧 PanelEventBus。
// 与 overlay_window.py 的 EventTailConsumer 同一类模式（file-tail 本地 IPC），
// 读者是 Agent 核心进程，供本地 SSE 转发给 WebView2 壳消费。
//
// panel-events.jsonl 与 line04 现有 events.jsonl 完全独立文件（判定点，不破坏单写者约束）。

import fs from 'node:fs';
import path from 'node:path';
import { PanelEventBus, PanelEvent } from './panel-event-bus';

function stateDir(): string {
  return process.env.ZJ_STATE_DIR || process.env.PUBLIC || 'C:\\Users\\Public';
}

export function panelEventsFilePath(): string {
  return path.join(stateDir(), 'panel-events.jsonl');
}

export interface PanelEventsTailOptions {
  pollMs?: number;
}

const DEFAULT_POLL_MS = 500;

export class PanelEventsTail {
  private offset = 0;

  private timer?: ReturnType<typeof setInterval>;

  private readonly pollMs: number;

  constructor(private readonly bus: PanelEventBus, opts: PanelEventsTailOptions = {}) {
    this.pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  }

  start(): void {
    this.poll();
    this.timer = setInterval(() => this.poll(), this.pollMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private poll(): void {
    const filePath = panelEventsFilePath();
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return; // 文件尚不存在，正常情况（还没有事件产生过）
    }

    if (stat.size < this.offset) this.offset = 0; // 轮转/被截断 → 从头读
    if (stat.size === this.offset) return;

    let fd: number;
    try {
      fd = fs.openSync(filePath, 'r');
    } catch {
      return;
    }
    try {
      const length = stat.size - this.offset;
      const buf = Buffer.alloc(length);
      fs.readSync(fd, buf, 0, length, this.offset);
      this.offset = stat.size;

      const text = buf.toString('utf-8');
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          const rec = JSON.parse(line) as PanelEvent;
          this.bus.ingest(rec);
        } catch {
          // 坏行跳过，不中断（同 EventTailConsumer 纪律）
        }
      }
    } finally {
      fs.closeSync(fd);
    }
  }
}
