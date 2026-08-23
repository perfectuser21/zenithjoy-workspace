/**
 * crdt-cv 纯单元测试（yjs 内存操作，无 DB）。
 * 真 /collab-ws apply + 落库 crdt_state/content 由合同 collab-ws.test.ts（真 PG + 真 ws）覆盖。
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { proseMirrorToYDoc, ydocToProseMirror, runCv } from './crdt-cv';

describe('crdt-cv 往返', () => {
  it('proseMirrorToYDoc → ydocToProseMirror 保留段落文本', () => {
    const pm = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '往返OK' }] }] };
    const ydoc = proseMirrorToYDoc(pm);
    const back = ydocToProseMirror(ydoc);
    expect(JSON.stringify(back)).toContain('往返OK');
  });
});

describe('crdt-cv runCv 白名单', () => {
  it('注入 onerror + javascript: 的房间 doc → crdtState 与 content 均不含（从干净 JSON 重建）', () => {
    const ydoc = new Y.Doc();
    const frag = ydoc.getXmlFragment('default');
    const img = new Y.XmlElement('image');
    img.setAttribute('onerror', "alert('xss')");
    img.setAttribute('src', 'javascript:alert(2)');
    frag.insert(0, [img]);

    const { content, crdtState } = runCv(ydoc);
    const blob = crdtState.toString('latin1');
    expect(blob).not.toContain('onerror');
    expect(blob).not.toContain('javascript:');
    expect(JSON.stringify(content)).not.toContain('onerror');
    expect(JSON.stringify(content)).not.toContain('javascript:');
  });

  it('合法文本经 runCv 落库后仍可还原出该文本', () => {
    const ydoc = new Y.Doc();
    const frag = ydoc.getXmlFragment('default');
    const p = new Y.XmlElement('paragraph');
    p.insert(0, [new Y.XmlText('保留正文ABC')]);
    frag.insert(0, [p]);

    const { crdtState } = runCv(ydoc);
    const restored = new Y.Doc();
    Y.applyUpdate(restored, new Uint8Array(crdtState));
    expect(restored.getXmlFragment('default').toString()).toContain('保留正文ABC');
  });
});
