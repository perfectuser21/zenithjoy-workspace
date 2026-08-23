/**
 * RawWsProvider —— 路② 协同笔记客户端的极简 Yjs-over-WebSocket 传输
 *
 * 与服务端 collab-ws 的协议对齐：帧 = **裸 Yjs update 二进制**（Y.encodeStateAsUpdate /
 * doc.on('update') 的 payload），非 y-websocket 的 messageSync 封装。服务端收到即 Y.applyUpdate、
 * 过服务端 CV 白名单、落库、再广播给房间其它连接。因此本 provider 只做三件事：
 *   1. 本地 doc 有 update（且非本 provider 触发的回环）→ ws.send(update)；
 *   2. ws 收到二进制帧 → Y.applyUpdate(doc, data, this)（origin=this 防回环）；
 *   3. 连接态变化 → 通知 onStatus（离线只读横幅 / 重连 resync）。
 *
 * 断连 resync 零丢字（A3-a lifeline⑧）：重连成功后立即 ws.send(encodeStateAsUpdate(doc))，把离线期
 * 本地累积的全部改动一次性推给服务端；服务端 CRDT 合并后广播回来，两端最终一致、零丢字。
 */
import * as Y from 'yjs';

export type CollabStatus = 'connecting' | 'connected' | 'disconnected';

export interface RawWsProviderOpts {
  onStatus?: (status: CollabStatus) => void;
}

export class RawWsProvider {
  readonly doc: Y.Doc;
  private url: string;
  private ws: WebSocket | null = null;
  private opts: RawWsProviderOpts;
  private closedByUser = false;
  private offline = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(url: string, doc: Y.Doc, opts: RawWsProviderOpts = {}) {
    this.doc = doc;
    this.url = url;
    this.opts = opts;
    this.doc.on('update', this.onDocUpdate);
    // 浏览器离线/上线事件是断连降级横幅最可靠的信号：localhost 的 WebSocket 在
    // context.setOffline(true) 下不一定立刻触发 onclose（loopback 常被豁免），但 window
    // 'offline'/'online' 一定会 fire。据此立刻切降级横幅 + 上线即 resync，零丢字。
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('offline', this.onOffline);
      window.addEventListener('online', this.onOnline);
    }
    this.connect();
  }

  private onOffline = (): void => {
    this.offline = true;
    this.opts.onStatus?.('disconnected');
    try {
      this.ws?.close();
    } catch {
      /* 忽略 */
    }
  };

  private onOnline = (): void => {
    this.offline = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (!this.closedByUser) this.connect();
  };

  private onDocUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === this) return; // 收到远端 update 触发的本地应用，不回环
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(update);
    }
  };

  private connect(): void {
    this.opts.onStatus?.('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onopen = () => {
      this.opts.onStatus?.('connected');
      // resync：把本地全量状态推给服务端，找回离线期改动（零丢字）
      try {
        ws.send(Y.encodeStateAsUpdate(this.doc));
      } catch {
        /* 忽略 */
      }
    };
    ws.onmessage = (ev: MessageEvent) => {
      const data = ev.data instanceof ArrayBuffer ? new Uint8Array(ev.data) : null;
      if (!data) return;
      try {
        Y.applyUpdate(this.doc, data, this);
      } catch {
        /* 忽略非法帧 */
      }
    };
    ws.onclose = () => {
      this.opts.onStatus?.('disconnected');
      if (!this.closedByUser) this.scheduleReconnect();
    };
    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        /* 忽略 */
      }
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.closedByUser || this.offline) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 1000);
  }

  destroy(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('offline', this.onOffline);
      window.removeEventListener('online', this.onOnline);
    }
    this.doc.off('update', this.onDocUpdate);
    try {
      this.ws?.close();
    } catch {
      /* 忽略 */
    }
  }
}
