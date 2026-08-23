/**
 * document-schema 白名单单一实现的纯单元测试（无 DB / 无 app）。
 * 真跨企业隔离、真落库剥离由合同的真 Postgres 测试（sprints/.../tests）覆盖；本文件只钉纯函数行为。
 */
import { describe, it, expect } from 'vitest';
import { sanitizeDocument, isSafeUrl, isValidProseMirrorDoc } from './document-schema';

describe('document-schema.isSafeUrl', () => {
  it('放行 http/https/mailto/相对路径', () => {
    expect(isSafeUrl('https://example.com')).toBe(true);
    expect(isSafeUrl('http://a.b/c')).toBe(true);
    expect(isSafeUrl('mailto:a@b.com')).toBe(true);
    expect(isSafeUrl('/relative/path')).toBe(true);
    expect(isSafeUrl('#anchor')).toBe(true);
  });
  it('拒绝 javascript: / vbscript: / 非图片 data:（含控制字符绕过）', () => {
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('  javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('java\tscript:alert(1)')).toBe(false);
    expect(isSafeUrl('vbscript:msgbox(1)')).toBe(false);
    expect(isSafeUrl('data:text/html;base64,x')).toBe(false);
  });
  it('放行 data:image/*（内嵌图片）', () => {
    expect(isSafeUrl('data:image/png;base64,iVBORw0K')).toBe(true);
  });
});

describe('document-schema.isValidProseMirrorDoc', () => {
  it('合法 doc 通过，畸形/非 doc 不通过', () => {
    expect(isValidProseMirrorDoc({ type: 'doc', content: [] })).toBe(true);
    expect(isValidProseMirrorDoc({ not: 'a-prosemirror-doc' })).toBe(false);
    expect(isValidProseMirrorDoc({ type: 'doc', content: 'x' })).toBe(false);
    expect(isValidProseMirrorDoc(null)).toBe(false);
  });
});

describe('document-schema.sanitizeDocument', () => {
  it('剥离 img 的非白名单属性 onerror，保留 src', () => {
    const out = sanitizeDocument({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src: 'x', onerror: "alert(1)" } }] }],
    });
    const s = JSON.stringify(out);
    expect(s).not.toContain('onerror');
  });
  it('剥离 javascript: 协议的 link mark，保留文本', () => {
    const out = sanitizeDocument({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '点我', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] },
      ],
    });
    const s = JSON.stringify(out);
    expect(s).not.toContain('javascript:');
    expect(s).toContain('点我');
  });
  it('剥离非白名单节点，保留段落文本', () => {
    const out = sanitizeDocument({
      type: 'doc',
      content: [
        { type: 'script', content: [{ type: 'text', text: 'evil' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '正常' }] },
      ],
    });
    expect(JSON.stringify(out)).not.toContain('evil');
    expect(JSON.stringify(out)).toContain('正常');
  });
});
