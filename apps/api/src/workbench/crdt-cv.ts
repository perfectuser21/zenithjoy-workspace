/**
 * crdt-cv —— Yjs 文档 ↔ ProseMirror JSON 的服务端桥（collab-ws 的 CV 派生用）
 *
 * collab-ws 收到裸 Yjs update 后，需要在 apply 后、落库前跑一遍白名单 CV：
 *   1. 从 Y.XmlFragment('default') 派生 ProseMirror JSON；
 *   2. 用 document-schema.sanitizeDocument 白名单剥洗（与 HTTP 保存路径同一实现）；
 *   3. 用剥洗后的干净 JSON **重建一个全新 Y.Doc**（不复用受污染的房间 doc）——关键：
 *      Yjs 的 removeAttribute 会留 tombstone，被删属性的值仍可能残留在 encodeStateAsUpdate
 *      的字节里；只有从干净 JSON 全新构建的 doc，其 crdt_state 才逐字节不含被剥的 payload。
 *
 * 因此落库的 crdt_state 与 content 都从同一份 sanitizeDocument 输出派生，天然一致。
 */
import * as Y from 'yjs';
import { sanitizeDocument } from './document-schema';

type PMJson = { type: string; content?: Record<string, unknown>[] };

/** 从 Y.XmlFragment / Y.XmlElement 递归派生 ProseMirror 子节点数组。 */
function fragToNodes(node: Y.XmlFragment | Y.XmlElement): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < node.length; i++) {
    const child = node.get(i) as unknown;
    if (child instanceof Y.XmlElement) {
      const attrs = child.getAttributes() as Record<string, unknown>;
      const n: Record<string, unknown> = { type: child.nodeName };
      if (attrs && Object.keys(attrs).length) n.attrs = attrs;
      const kids = fragToNodes(child);
      if (kids.length) n.content = kids;
      out.push(n);
    } else if (child instanceof Y.XmlText) {
      out.push({ type: 'text', text: child.toString() });
    }
  }
  return out;
}

/** Y.Doc → ProseMirror JSON（顶层包成 doc）。 */
export function ydocToProseMirror(ydoc: Y.Doc): PMJson {
  const frag = ydoc.getXmlFragment('default');
  return { type: 'doc', content: fragToNodes(frag) };
}

/** 干净 ProseMirror JSON → 一组全新的 Y.Xml 节点。 */
function nodesToY(arr: Record<string, unknown>[]): Array<Y.XmlElement | Y.XmlText> {
  return arr.map((n) => {
    if (n.type === 'text') {
      return new Y.XmlText(typeof n.text === 'string' ? n.text : '');
    }
    const el = new Y.XmlElement(String(n.type));
    const attrs = (n.attrs ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    const content = Array.isArray(n.content) ? (n.content as Record<string, unknown>[]) : [];
    const kids = nodesToY(content);
    if (kids.length) el.insert(0, kids);
    return el;
  });
}

/** 从干净 ProseMirror JSON 全新构建 Y.Doc（'default' fragment）。 */
export function proseMirrorToYDoc(pm: PMJson): Y.Doc {
  const ydoc = new Y.Doc();
  const frag = ydoc.getXmlFragment('default');
  const nodes = nodesToY(Array.isArray(pm.content) ? pm.content : []);
  if (nodes.length) frag.insert(0, nodes);
  return ydoc;
}

export interface CvResult {
  /** 白名单剥洗后的干净 ProseMirror JSON（落 content jsonb）。 */
  content: PMJson;
  /** 从干净 JSON 全新构建的 Y.Doc 的完整状态（落 crdt_state bytea）。 */
  crdtState: Buffer;
}

/**
 * 对一个（可能被污染的）房间 Y.Doc 跑 CV：派生 → 白名单剥洗 → 全新重建 → 编码。
 * 返回可直接落库的 content 与 crdt_state。
 */
export function runCv(roomDoc: Y.Doc): CvResult {
  const rawPm = ydocToProseMirror(roomDoc);
  const clean = sanitizeDocument(rawPm) as PMJson;
  const cleanDoc = proseMirrorToYDoc(clean);
  const state = Buffer.from(Y.encodeStateAsUpdate(cleanDoc));
  return { content: clean, crdtState: state };
}
