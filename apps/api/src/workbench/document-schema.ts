/**
 * document-schema —— ProseMirror/TipTap 文档白名单单一实现（CV = Content Validation）
 *
 * 这是路② 存储型 XSS 的命门（合同 A2 / A10 / 判定点登记表）。文档正文既走 HTTP 保存路径
 * （document.service.ts），又走 CRDT 实时协同路径（collab-ws.ts）——两条路必须过**同一份**
 * 白名单，否则裸 WS 客户端可绕过前端直注 `<img onerror>` / `href=javascript:`，落库即存储型 XSS。
 *
 * 因此本文件是唯一实现，被上述两处 import 同一符号（DoD [ARTIFACT] grep 两处引用同一 module）。
 *
 * 白名单口径：
 *   - 节点：doc/paragraph/heading/text/image/hardBreak/bulletList/orderedList/listItem/
 *           blockquote/codeBlock/horizontalRule（含常见 snake_case 别名）。非白名单节点整条剥离。
 *   - 属性：逐节点白名单（heading.level / image.src|alt|title 等）。非白名单属性（onerror 等）剥离。
 *   - 协议：URL 属性（src/href）只放行 http/https/mailto/相对路径/data:image；javascript: 等伪协议剥离。
 *   - marks：bold/italic/strike/code/link。link.href 走同一协议闸，非法协议整条 mark 剥离。
 */

/** 白名单节点类型（含 camelCase 与 snake_case 常见别名）。 */
const ALLOWED_NODES = new Set<string>([
  'doc',
  'paragraph',
  'heading',
  'text',
  'image',
  'hardBreak',
  'hard_break',
  'bulletList',
  'bullet_list',
  'orderedList',
  'ordered_list',
  'listItem',
  'list_item',
  'blockquote',
  'codeBlock',
  'code_block',
  'horizontalRule',
  'horizontal_rule',
]);

/** 逐节点允许的属性名。未列出的节点默认无属性；列出但为空数组表示该节点不许带任何属性。 */
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  heading: new Set(['level']),
  image: new Set(['src', 'alt', 'title']),
  orderedList: new Set(['start']),
  ordered_list: new Set(['start']),
  codeBlock: new Set(['language']),
  code_block: new Set(['language']),
};

/** URL 类属性名：这些属性的值要过协议白名单。 */
const URL_ATTRS = new Set<string>(['src', 'href']);

/** 白名单 marks。 */
const ALLOWED_MARKS = new Set<string>(['bold', 'italic', 'strike', 'code', 'link', 'underline']);

/**
 * 协议白名单：http/https/mailto/data:image 与相对路径放行，其余（javascript:/vbscript:/file: 等）拒绝。
 * 先剥除控制字符与空白再判，堵 `java\tscript:` / `  javascript:` 之类绕过。
 */
export function isSafeUrl(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  // eslint-disable-next-line no-control-regex -- 剥控制字符是 URL 协议白名单的必要步骤（防绕过）
  const v = raw.replace(/[\u0000-\u0020]+/g, '').toLowerCase();
  if (v === '') return true;
  // 显式危险协议
  if (/^(javascript|vbscript|data|file):/i.test(v)) {
    // data: 仅放行 data:image/*（内嵌图片），其余 data: 一律拒
    return /^data:image\//i.test(v);
  }
  // 带协议的：只放行 http/https/mailto
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) {
    return /^(https?|mailto):/i.test(v);
  }
  // 无协议 = 相对路径/锚点，放行
  return true;
}

type PMNode = {
  type?: unknown;
  text?: unknown;
  attrs?: Record<string, unknown>;
  content?: unknown;
  marks?: unknown;
};

/** 是否是一个形状合法的 ProseMirror 文档（顶层 type==='doc' 且 content 为数组）。 */
export function isValidProseMirrorDoc(doc: unknown): boolean {
  if (!doc || typeof doc !== 'object') return false;
  const d = doc as PMNode;
  if (d.type !== 'doc') return false;
  if (d.content !== undefined && !Array.isArray(d.content)) return false;
  return true;
}

function sanitizeMark(mark: unknown): Record<string, unknown> | null {
  if (!mark || typeof mark !== 'object') return null;
  const m = mark as { type?: unknown; attrs?: Record<string, unknown> };
  if (typeof m.type !== 'string' || !ALLOWED_MARKS.has(m.type)) return null;
  if (m.type === 'link') {
    const href = m.attrs?.href;
    if (!isSafeUrl(href)) return null; // 非法协议 → 整条 link mark 剥离
  }
  return m.attrs && Object.keys(m.attrs).length ? { type: m.type, attrs: m.attrs } : { type: m.type };
}

function sanitizeAttrs(nodeType: string, attrs: unknown): Record<string, unknown> | undefined {
  if (!attrs || typeof attrs !== 'object') return undefined;
  const allowed = ALLOWED_ATTRS[nodeType];
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(attrs as Record<string, unknown>)) {
    if (!allowed || !allowed.has(k)) continue; // 非白名单属性（onerror 等）剥离
    if (URL_ATTRS.has(k) && !isSafeUrl(v)) continue; // 非法协议 URL 剥离
    out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

function sanitizeNode(node: unknown): Record<string, unknown> | null {
  if (!node || typeof node !== 'object') return null;
  const n = node as PMNode;
  const type = typeof n.type === 'string' ? n.type : '';

  if (type === 'text') {
    const marks = Array.isArray(n.marks)
      ? n.marks.map(sanitizeMark).filter((m): m is Record<string, unknown> => m !== null)
      : [];
    const text = typeof n.text === 'string' ? n.text : '';
    return marks.length ? { type: 'text', text, marks } : { type: 'text', text };
  }

  if (!ALLOWED_NODES.has(type)) return null; // 非白名单节点整条剥离

  const attrs = sanitizeAttrs(type, n.attrs);
  const content = Array.isArray(n.content)
    ? n.content.map(sanitizeNode).filter((c): c is Record<string, unknown> => c !== null)
    : [];

  const out: Record<string, unknown> = { type };
  if (attrs) out.attrs = attrs;
  if (content.length) out.content = content;
  return out;
}

/**
 * 白名单剥洗一整篇文档。非白名单节点/属性/协议被剥离，返回干净的 ProseMirror JSON。
 * 输入形状非法（非 doc）→ 返回一个空 doc（调用方应先用 isValidProseMirrorDoc 判非法拒写）。
 */
export function sanitizeDocument(doc: unknown): { type: string; content: Record<string, unknown>[] } {
  if (!isValidProseMirrorDoc(doc)) {
    return { type: 'doc', content: [] };
  }
  const d = doc as PMNode;
  const content = Array.isArray(d.content)
    ? d.content.map(sanitizeNode).filter((c): c is Record<string, unknown> => c !== null)
    : [];
  return { type: 'doc', content };
}
