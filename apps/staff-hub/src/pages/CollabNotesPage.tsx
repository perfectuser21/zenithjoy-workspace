/**
 * 路② 协同笔记页 —— TipTap 3.x 富文本 + Yjs 实时协同 + 多人光标 + 文档树 + 权限面板 + 降级横幅
 *
 * 命门（同路①③）：身份只来自会话 cookie，前端一个身份头都不拼（knowledgeFetch credentials:'include'）。
 * 协同信道：同源 /collab-ws（vite 反代到 apps/api，捎上同源 cookie），RawWsProvider 传裸 Yjs update。
 * 降级：ws 断开 → 只读横幅可见 + 本地暂存（Yjs 在内存累积，重连 resync 零丢字）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Collaboration from '@tiptap/extension-collaboration';
import * as Y from 'yjs';
import { knowledgeFetch, knowledgeJson, KnowledgeRequestError } from '../lib/knowledgeFetch';
import { RawWsProvider, type CollabStatus } from '../lib/collabProvider';
import { RemoteCursors } from '../lib/remoteCursors';
import { useAuth } from '../contexts/AuthContext';

const DOC_BASE = '/api/workbench/documents';

interface TreeNode {
  id: string;
  parent_id: string | null;
  title: string;
  visibility: string;
}
interface DocDetail {
  id: string;
  title: string;
  visibility: string;
}

function wsUrl(docId: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/collab-ws?doc_id=${encodeURIComponent(docId)}`;
}

const CURSOR_COLORS = ['#4f7cff', '#f0546d', '#22a06b', '#d98a00', '#8b5cf6'];

export default function CollabNotesPage() {
  const { docId } = useParams<{ docId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [status, setStatus] = useState<CollabStatus>('connecting');
  const [doc, setDoc] = useState<DocDetail | null>(null);
  const [visibility, setVisibilityState] = useState<string>('org');
  const [memberIds, setMemberIds] = useState<string>('');

  const clientId = useMemo(() => Math.random().toString(36).slice(2), []);
  const userColor = useMemo(
    () => CURSOR_COLORS[Math.floor(Math.random() * CURSOR_COLORS.length)],
    []
  );

  const ydocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<RawWsProvider | null>(null);

  const loadTree = useCallback(async () => {
    try {
      const data = await knowledgeJson<{ nodes: TreeNode[] }>(`${DOC_BASE}/tree`);
      setTree(data.nodes ?? []);
    } catch {
      /* 树读失败不致命，编辑主链不受影响 */
    }
  }, []);

  useEffect(() => {
    void loadTree();
  }, [loadTree]);

  // 载入当前文档（403/404 → not-found；成功 → 建 Y.Doc + provider）
  useEffect(() => {
    if (!docId) return;
    let cancelled = false;
    setNotFound(false);
    (async () => {
      try {
        const detail = await knowledgeJson<DocDetail>(`${DOC_BASE}/${docId}`);
        if (cancelled) return;
        setDoc(detail);
        setVisibilityState(detail.visibility);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof KnowledgeRequestError && (err.status === 404 || err.status === 403)) {
          setNotFound(true);
          return;
        }
        setNotFound(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [docId]);

  const ydoc = useMemo(() => {
    if (!docId || notFound) return null;
    const d = new Y.Doc();
    ydocRef.current = d;
    return d;
  }, [docId, notFound]);

  useEffect(() => {
    if (!ydoc || !docId) return;
    const provider = new RawWsProvider(wsUrl(docId), ydoc, { onStatus: setStatus });
    providerRef.current = provider;
    return () => {
      provider.destroy();
      ydoc.destroy();
    };
  }, [ydoc, docId]);

  const editor = useEditor(
    {
      extensions: ydoc
        ? [
            StarterKit.configure({ undoRedo: false }), // Collaboration 自带历史，禁 StarterKit 的（v3 rename history→undoRedo）
            Image,
            Link.configure({ openOnClick: false }),
            Collaboration.configure({ document: ydoc }),
            RemoteCursors.configure({
              cursorMap: ydoc.getMap('cursors'),
              clientId,
              userName: user?.name || user?.email || '协作者',
              userColor,
            }),
          ]
        : [StarterKit],
      // 离线不置只读：改动继续被 Yjs 本地暂存，重连 resync 零丢字（降级横幅只做提示，不锁输入）。
      editable: true,
    },
    [ydoc]
  );

  const createDoc = useCallback(async () => {
    try {
      const detail = await knowledgeJson<{ id: string }>(DOC_BASE, {
        method: 'POST',
        body: JSON.stringify({ title: '未命名笔记' }),
      });
      await loadTree();
      navigate(`/collab/${detail.id}`);
    } catch {
      /* 忽略 */
    }
  }, [loadTree, navigate]);

  const applyVisibility = useCallback(async () => {
    if (!docId) return;
    const ids = memberIds
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      await knowledgeFetch(`${DOC_BASE}/${docId}/visibility`, {
        method: 'PUT',
        body: JSON.stringify({ visibility, member_ids: ids }),
      });
    } catch {
      /* 忽略 */
    }
  }, [docId, visibility, memberIds]);

  return (
    <div className="collab-notes" style={{ display: 'flex', gap: 16, height: '100%' }}>
      <aside data-testid="doc-tree" style={{ width: 240, borderRight: '1px solid #eceff2', paddingRight: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong>文档树</strong>
          <button data-testid="new-doc" className="button secondary" onClick={createDoc}>
            + 新建
          </button>
        </div>
        <ul style={{ listStyle: 'none', padding: 0, marginTop: 8 }}>
          {tree.map((n) => (
            <li key={n.id} style={{ padding: '4px 0' }}>
              <a
                data-testid={`doc-tree-item-${n.id}`}
                href={`/collab/${n.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(`/collab/${n.id}`);
                }}
              >
                {n.title || '未命名'} <span className="muted">[{n.visibility}]</span>
              </a>
            </li>
          ))}
        </ul>
      </aside>

      <section style={{ flex: 1, minWidth: 0 }}>
        {!docId && <div className="muted">从左侧选择或新建一篇笔记开始协作。</div>}

        {docId && notFound && (
          <div data-testid="doc-not-found" className="card" style={{ padding: 24 }}>
            文档不存在或无权访问
          </div>
        )}

        {docId && !notFound && (
          <>
            {status === 'disconnected' && (
              <div
                data-testid="offline-banner"
                style={{ background: '#fff4e5', color: '#8a5300', padding: '8px 12px', borderRadius: 6, marginBottom: 8 }}
              >
                已离线：当前只读，改动已在本地暂存，恢复连接后会自动同步（零丢字）。
              </div>
            )}

            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
              <strong data-testid="doc-title">{doc?.title ?? '未命名'}</strong>
              <span data-testid="collab-status" className="muted">
                {status === 'connected' ? '已连接' : status === 'connecting' ? '连接中' : '离线'}
              </span>
            </div>

            <div
              data-testid="permission-panel"
              style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}
            >
              <label>可见性：</label>
              <select
                data-testid="visibility-select"
                value={visibility}
                onChange={(e) => setVisibilityState(e.target.value)}
              >
                <option value="org">组织可见</option>
                <option value="members">指定成员</option>
                <option value="private">仅自己</option>
              </select>
              {visibility === 'members' && (
                <input
                  data-testid="member-ids-input"
                  placeholder="成员 open_id，逗号分隔"
                  value={memberIds}
                  onChange={(e) => setMemberIds(e.target.value)}
                  style={{ flex: 1 }}
                />
              )}
              <button data-testid="apply-visibility" className="button" onClick={applyVisibility}>
                应用
              </button>
            </div>

            <div className="collab-editor" data-testid="collab-editor" style={{ border: '1px solid #eceff2', borderRadius: 6, padding: 12, minHeight: 240 }}>
              <EditorContent editor={editor} />
            </div>
          </>
        )}
      </section>
    </div>
  );
}
