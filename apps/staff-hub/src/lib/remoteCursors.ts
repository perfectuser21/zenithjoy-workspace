/**
 * RemoteCursors —— 多人光标扩展（走共享 Y.Doc 的 Map，不依赖 y-protocols awareness）
 *
 * 为什么不用 @tiptap/extension-collaboration-cursor 的 awareness：服务端 collab-ws 是"裸 Yjs
 * update 中继"，awareness 帧与 doc-update 帧在同一二进制信道上无法可靠区分。于是把每个客户端的
 * 光标位置写进共享文档的 Y.Map('cursors')（作为普通 doc-update 流经同一信道、天然被服务端广播与
 * 合并），其它端读该 Map 渲染对方光标 widget（.collab-remote-cursor）。
 *
 * （extension-collaboration-cursor 仍列为依赖以满足版本锁 [ARTIFACT]；本刀实际用本扩展渲染。）
 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type * as Y from 'yjs';

export interface RemoteCursorsOptions {
  cursorMap: Y.Map<unknown> | null;
  clientId: string;
  userName: string;
  userColor: string;
}

interface CursorEntry {
  head: number;
  name: string;
  color: string;
}

const remoteCursorsKey = new PluginKey('remoteCursors');

const CURSOR_STYLE_ID = 'collab-remote-cursor-style';

/**
 * 光标名字标签走 ::after 伪元素（而非文本子节点）——关键：伪元素内容**不进** innerText/textContent，
 * 于是对方光标不会把正文里相邻的字符切断（否则 `expect(text).toContain('α串')` 会被标签文字劈开）。
 * 幂等注入一次全局样式。
 */
function ensureCursorStyle(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(CURSOR_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = CURSOR_STYLE_ID;
  style.textContent = `
    .collab-remote-cursor {
      position: relative;
      display: inline-block;
      width: 0;
      height: 1em;
      vertical-align: text-bottom;
      border-left: 2px solid var(--collab-cursor-color, #f0546d);
      margin-left: -1px;
      pointer-events: none;
    }
    .collab-remote-cursor::after {
      content: attr(data-label);
      position: absolute;
      top: -1.2em;
      left: -1px;
      font-size: 10px;
      line-height: 1.2;
      white-space: nowrap;
      color: #fff;
      padding: 0 3px;
      border-radius: 3px;
      background: var(--collab-cursor-color, #f0546d);
    }
  `;
  document.head.appendChild(style);
}

export const RemoteCursors = Extension.create<RemoteCursorsOptions>({
  name: 'remoteCursors',

  addOptions() {
    return { cursorMap: null, clientId: '', userName: '匿名', userColor: '#4f7cff' };
  },

  addProseMirrorPlugins() {
    const { cursorMap, clientId, userName, userColor } = this.options;

    const buildDecorations = (docSize: number): DecorationSet | null => {
      if (!cursorMap) return null;
      const decos: Decoration[] = [];
      cursorMap.forEach((value, key) => {
        if (key === clientId) return;
        const entry = value as CursorEntry;
        if (!entry || typeof entry.head !== 'number') return;
        const pos = Math.min(Math.max(entry.head, 0), Math.max(docSize - 1, 0));
        const el = document.createElement('span');
        el.className = 'collab-remote-cursor';
        el.setAttribute('data-testid', 'remote-cursor');
        // 名字走 data-label → ::after 伪元素渲染（不进 innerText，不切断正文）
        el.setAttribute('data-label', entry.name || '协作者');
        el.style.setProperty('--collab-cursor-color', entry.color || '#f0546d');
        decos.push(Decoration.widget(pos, el, { side: 10 }));
      });
      return DecorationSet.create(this.editor.state.doc, decos);
    };

    return [
      new Plugin({
        key: remoteCursorsKey,
        view: () => {
          ensureCursorStyle();
          const observer = () => {
            // 远端光标 Map 变化 → 触发一次空 meta 事务，重算 decorations
            const view = this.editor?.view;
            if (view) view.dispatch(view.state.tr.setMeta(remoteCursorsKey, true));
          };
          cursorMap?.observe(observer);
          return {
            destroy() {
              cursorMap?.unobserve(observer);
            },
          };
        },
        state: {
          init: (_config, state) => buildDecorations(state.doc.content.size) ?? DecorationSet.empty,
          apply: (tr, old) => {
            // 本地选区变化 → 写自己的光标到共享 Map
            if (cursorMap && tr.selectionSet) {
              cursorMap.set(clientId, { head: tr.selection.head, name: userName, color: userColor });
            }
            return buildDecorations(tr.doc.content.size) ?? old;
          },
        },
        props: {
          decorations(state) {
            return remoteCursorsKey.getState(state) as DecorationSet | undefined;
          },
        },
      }),
    ];
  },
});
