/**
 * RemoteCursors TipTap 扩展的单元测试（jsdom，不挂真编辑器）。
 * 真多人光标渲染由 windows_cloud E2E（collab-notes-crdt.spec.ts，断言 .collab-remote-cursor 可见）覆盖。
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { RemoteCursors } from './remoteCursors';

describe('RemoteCursors 扩展', () => {
  it('扩展名为 remoteCursors', () => {
    expect(RemoteCursors.name).toBe('remoteCursors');
  });

  it('configure 返回同名扩展并合并选项', () => {
    const ydoc = new Y.Doc();
    const cursorMap = ydoc.getMap('cursors');
    const configured = RemoteCursors.configure({ cursorMap, clientId: 'c-42', userName: '甲', userColor: '#123456' });
    expect(configured.name).toBe('remoteCursors');
    expect(configured.options.clientId).toBe('c-42');
    expect(configured.options.userColor).toBe('#123456');
  });

  it('默认选项在缺省时给出安全兜底', () => {
    const configured = RemoteCursors.configure({});
    expect(configured.options.clientId).toBe('');
    expect(configured.options.userName).toBe('匿名');
  });
});
