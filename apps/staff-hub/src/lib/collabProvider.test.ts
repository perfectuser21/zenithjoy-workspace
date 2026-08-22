/**
 * RawWsProvider 单元测试（jsdom，用假 WebSocket 打桩，不连真服务端）。
 * 真 /collab-ws 握手 + resync 由 windows_cloud E2E（collab-notes-crdt.spec.ts）覆盖。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import { RawWsProvider } from './collabProvider';

class FakeWS {
  static OPEN = 1;
  static instances: FakeWS[] = [];
  url: string;
  binaryType = 'blob';
  readyState = 1; // OPEN
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    FakeWS.instances.push(this);
  }
  send(d: unknown): void {
    this.sent.push(d);
  }
  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }
}

beforeEach(() => {
  FakeWS.instances = [];
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWS as unknown;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('RawWsProvider', () => {
  it('构造即回调 onStatus(connecting) 并建 WebSocket', () => {
    const statuses: string[] = [];
    const ydoc = new Y.Doc();
    const p = new RawWsProvider('ws://x/collab-ws?doc_id=1', ydoc, { onStatus: (s) => statuses.push(s) });
    expect(statuses).toContain('connecting');
    expect(FakeWS.instances.length).toBe(1);
    p.destroy();
  });

  it('本地 doc update（非回环）→ 通过 ws.send 发出裸 update', () => {
    const ydoc = new Y.Doc();
    const p = new RawWsProvider('ws://x/collab-ws?doc_id=1', ydoc);
    const ws = FakeWS.instances[0];
    const before = ws.sent.length;
    ydoc.getXmlFragment('default').insert(0, [new Y.XmlText('hi')]);
    expect(ws.sent.length).toBeGreaterThan(before);
    p.destroy();
  });

  it('destroy() 关闭底层 ws 并停止后续回环发送', () => {
    const ydoc = new Y.Doc();
    const p = new RawWsProvider('ws://x/collab-ws?doc_id=1', ydoc);
    const ws = FakeWS.instances[0];
    p.destroy();
    expect(ws.readyState).toBe(3);
    const after = ws.sent.length;
    ydoc.getXmlFragment('default').insert(0, [new Y.XmlText('more')]);
    expect(ws.sent.length).toBe(after); // 已 destroy，不再发
  });
});
