/**
 * 我的作品（/dashboard/my-works，line01 刀5a）
 *
 * dashboard 侧「作品」的第二个入口（第一个是 Notion 发布编排台）。双入口并存期
 * 编辑不回流 Notion 行：从哪个入口点「发」，就以那个入口当时的文案为准
 * （既定行为声明，v1 拍板不回写，见 spec）。
 *
 * 列表/编辑/发布走 apps/api 既有 /api/contents 系列端点（Task 1 已合）：
 *  - GET /api/contents：列表 + 首图签名 + 回执聚合
 *  - PATCH /api/contents/:id：编辑（queued 状态服务端 409 拒绝）
 *  - POST /api/contents/:id/publish：发布 / 重发（重发只传失败平台子集，禁止整单重派）
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Image as ImageIcon, Inbox } from 'lucide-react';
import {
  listMyContents,
  updateMyContent,
  publishMyContent,
  type MyContent,
  type MyContentStatus,
} from '../api/my-contents.api';

const REFETCH_MS = 30_000;

/**
 * 终态里代表"成功"的取值——与 apps/api services/notion-orchestrator.ts 的
 * SUCCESS_STATUSES 同源（该模块派发链路落库时写的是 'done'，但历史/兼容路径可能
 * 写 completed/success）。两处将来一起改（H-3 sweep 时同改），别再各自手抄二值判断。
 */
const SUCCESS_STATUSES = ['done', 'completed', 'success'];

/** 从 axios 错误里抠出后端 { error: { message } } 文案，取不到就退到 err.message。 */
function extractErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const backendMessage = (err.response?.data as { error?: { message?: string } } | undefined)
      ?.error?.message;
    return backendMessage || err.message || fallback;
  }
  return err instanceof Error ? err.message : fallback;
}

/** 与 apps/api PUBLISH_PLATFORMS 白名单一致（services/content-publish-dispatch.ts）。 */
const ALL_PLATFORMS: Array<{ key: string; label: string }> = [
  { key: 'douyin', label: '抖音' },
  { key: 'xiaohongshu', label: '小红书' },
  { key: 'kuaishou', label: '快手' },
  { key: 'toutiao', label: '头条' },
  { key: 'weibo', label: '微博' },
  { key: 'bilibili', label: 'B站' },
  { key: 'shipinhao', label: '视频号' },
  { key: 'zhihu', label: '知乎' },
  { key: 'wechat', label: '公众号' },
];

const PLATFORM_LABEL: Record<string, string> = Object.fromEntries(
  ALL_PLATFORMS.map((p) => [p.key, p.label]),
);

function statusBadge(status: MyContentStatus): { text: string; className: string } {
  switch (status) {
    case 'draft':
      return { text: '草稿', className: 'bg-gray-100 text-gray-600' };
    case 'queued':
      return { text: '排队中', className: 'bg-blue-100 text-blue-700' };
    case 'published':
      return { text: '已发布', className: 'bg-green-100 text-green-700' };
    case 'failed':
      return { text: '失败', className: 'bg-red-100 text-red-700' };
    default:
      return { text: status, className: 'bg-gray-100 text-gray-600' };
  }
}

/** 回执徽章：成功三值(done/completed/success)→✅ failed→❌ 其他（pending/queued/dispatched/in_progress/running）→⏳。 */
function receiptEmoji(status: string | undefined): string {
  if (status !== undefined && SUCCESS_STATUSES.includes(status)) return '✅';
  if (status === 'failed') return '❌';
  return '⏳';
}

interface EditState {
  title: string;
  body: string;
  platforms: string[];
}

export default function MyWorksPage() {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditState | null>(null);
  /** 顶部 inline 错误红条：编辑保存失败 / 发布失败（含 NO_AGENT 等）在这里露出文案。 */
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['my-contents'],
    queryFn: () => listMyContents(),
    refetchInterval: REFETCH_MS,
  });

  const updateMutation = useMutation({
    mutationFn: (vars: { id: string; patch: EditState }) => updateMyContent(vars.id, vars.patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-contents'] });
    },
    onError: (err) => {
      // 保存失败不关面板：草稿留在编辑态，用户看到红条后可以重试而不丢改动。
      setActionError(extractErrorMessage(err, '保存失败'));
    },
  });

  const publishMutation = useMutation({
    mutationFn: (vars: { id: string; platforms?: string[] }) =>
      publishMyContent(vars.id, vars.platforms),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-contents'] });
    },
    onError: (err) => {
      // 常见如 NO_AGENT（租户下没有活跃 agent）：文案必须让用户看到，不能静默失败。
      setActionError(extractErrorMessage(err, '发布失败'));
    },
  });

  const items = data?.items ?? [];

  function openEditor(item: MyContent) {
    if (item.status === 'queued') return; // 排队中不可编辑
    if (editingId === item.id) return; // 已经打开
    setActionError(null);
    setEditingId(item.id);
    setDraft({
      title: item.title ?? '',
      body: item.body ?? '',
      platforms: item.platforms ?? [],
    });
  }

  function closeEditor() {
    setEditingId(null);
    setDraft(null);
  }

  function saveEditor(id: string) {
    if (!draft) return;
    setActionError(null);
    // 只在成功时关面板：失败要留在编辑态让用户看着红条重试，不能悄悄关掉丢改动。
    updateMutation.mutate(
      { id, patch: draft },
      { onSuccess: () => closeEditor() },
    );
  }

  function togglePlatform(key: string) {
    setDraft((d) => {
      if (!d) return d;
      const has = d.platforms.includes(key);
      return { ...d, platforms: has ? d.platforms.filter((p) => p !== key) : [...d.platforms, key] };
    });
  }

  function publish(item: MyContent) {
    setActionError(null);
    publishMutation.mutate({ id: item.id, platforms: undefined });
  }

  /** 关键：绝不整单重派，只算 receipts 里非成功三值(done/completed/success)的平台子集。 */
  function getFailedPlatforms(item: MyContent): string[] {
    return item.platforms.filter((p) => {
      const r = item.receipts.find((rr) => rr.platform === p);
      return r ? !SUCCESS_STATUSES.includes(r.status) : true;
    });
  }

  function resendFailed(item: MyContent) {
    const failedPlatforms = getFailedPlatforms(item);
    if (failedPlatforms.length === 0) {
      // 空子集绝不能落到后端：后端把空数组当"未指定平台"会回落到作品原有 platforms
      // 整单重派，等于把已经发布成功的平台也重发一遍（双发）。
      setActionError('没有待重发的平台：所有平台都已发布成功');
      return;
    }
    setActionError(null);
    publishMutation.mutate({ id: item.id, platforms: failedPlatforms });
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-gray-900">我的作品</h1>
        <p className="mt-1 text-sm text-gray-500">在这里编辑文案、发布到平台、查看每个平台的回执</p>
      </div>

      {actionError ? (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <span>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="shrink-0 text-red-500 hover:text-red-700"
            aria-label="关闭"
          >
            ×
          </button>
        </div>
      ) : null}

      {isLoading ? (
        <div className="py-16 text-center text-gray-400">加载中…</div>
      ) : isError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error instanceof Error ? error.message : '加载作品失败'}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 py-16 text-center">
          <Inbox className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-3 text-sm text-gray-500">还没有作品</p>
          <p className="mt-1 text-xs text-gray-400">生成或上传内容后，会出现在这里</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => {
            const badge = statusBadge(item.status);
            const isEditing = editingId === item.id;
            const thumb = item.materials[0]?.preview_url ?? null;

            return (
              <div key={item.id} className="rounded-xl border bg-white p-4 shadow-sm">
                <button
                  type="button"
                  onClick={() => openEditor(item)}
                  className="w-full text-left"
                  disabled={item.status === 'queued'}
                >
                  <div className="mb-3 flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-gray-100">
                    {thumb ? (
                      <img src={thumb} alt={item.title ?? ''} className="h-full w-full object-cover" />
                    ) : (
                      <ImageIcon className="h-8 w-8 text-gray-300" />
                    )}
                  </div>

                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-medium text-gray-900">{item.title || '（无标题）'}</h3>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${badge.className}`}>
                      {badge.text}
                    </span>
                  </div>
                </button>

                {item.platforms.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {item.platforms.map((p) => {
                      const receipt = item.receipts.find((r) => r.platform === p);
                      return (
                        <span
                          key={p}
                          className="rounded-full bg-gray-50 px-2 py-0.5 text-xs text-gray-600"
                        >
                          <span>{PLATFORM_LABEL[p] ?? p}</span>{' '}
                          <span>{receiptEmoji(receipt?.status)}</span>
                        </span>
                      );
                    })}
                  </div>
                ) : null}

                {isEditing && draft ? (
                  <div className="mt-3 space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <input
                      type="text"
                      value={draft.title}
                      onChange={(e) => setDraft((d) => (d ? { ...d, title: e.target.value } : d))}
                      className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                      placeholder="标题"
                    />
                    <textarea
                      value={draft.body}
                      onChange={(e) => setDraft((d) => (d ? { ...d, body: e.target.value } : d))}
                      className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                      rows={3}
                      placeholder="文案"
                    />
                    <div className="flex flex-wrap gap-2">
                      {ALL_PLATFORMS.map((p) => (
                        <label key={p.key} className="flex items-center gap-1 text-xs text-gray-600">
                          <input
                            type="checkbox"
                            checked={draft.platforms.includes(p.key)}
                            onChange={() => togglePlatform(p.key)}
                          />
                          {p.label}
                        </label>
                      ))}
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => saveEditor(item.id)}
                        className="rounded-md bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
                      >
                        保存
                      </button>
                      <button
                        type="button"
                        onClick={closeEditor}
                        className="rounded-md border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-100"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="mt-3">
                  {item.status === 'draft' ? (
                    <button
                      type="button"
                      onClick={() => publish(item)}
                      className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
                    >
                      发布
                    </button>
                  ) : item.status === 'failed' ? (
                    <button
                      type="button"
                      onClick={() => resendFailed(item)}
                      disabled={getFailedPlatforms(item).length === 0}
                      className="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                    >
                      重发失败平台
                    </button>
                  ) : item.status === 'queued' ? (
                    <button
                      type="button"
                      disabled
                      className="cursor-not-allowed rounded-md bg-gray-200 px-3 py-1.5 text-sm text-gray-500"
                    >
                      发布中…
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
