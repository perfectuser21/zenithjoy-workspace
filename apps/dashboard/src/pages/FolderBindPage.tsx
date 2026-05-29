/**
 * Walking Skeleton #1 — 文件夹绑定页
 * 路由：/dashboard/folder
 *
 * 内容：
 *  - 本地路径输入框 + 提交按钮
 *  - 提交 → POST /api/agent/folder/bind
 *  - 成功后显示"已绑定 <path>"
 *  - agent 离线时按钮禁用
 *  - 空 path 不提交
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getAgentStatus,
  postFolderBind,
} from '../api/walking-skeleton-1.api';

export default function FolderBindPage() {
  const qc = useQueryClient();
  const [path, setPath] = useState('');
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: agentData } = useQuery({
    queryKey: ['ws1', 'agent-status'],
    queryFn: getAgentStatus,
    refetchInterval: 10_000,
  });
  const agentId = agentData?.agent_id;
  const isOnline = !!agentData?.connected && !!agentId;
  const currentBound = agentData?.bound_folder_path ?? null;

  const mutation = useMutation({
    mutationFn: () =>
      postFolderBind({ agent_id: agentId!, local_path: path.trim() }),
    onSuccess: () => {
      setSavedPath(path.trim());
      setError(null);
      qc.invalidateQueries({ queryKey: ['ws1', 'agent-status'] });
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : String(e));
    },
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = path.trim();
    if (!v) return;
    if (!isOnline) return;
    mutation.mutate();
  }

  return (
    <div style={{ padding: 24, maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 16 }}>
        文件夹绑定
      </h1>

      {!isOnline && (
        <div
          style={{
            padding: 12,
            marginBottom: 16,
            background: '#fef3c7',
            border: '1px solid #fbbf24',
            borderRadius: 6,
            color: '#92400e',
          }}
        >
          Agent 未连接，请先下载 Agent 并启动。
        </div>
      )}

      <form
        onSubmit={onSubmit}
        style={{
          padding: 20,
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          background: '#fff',
        }}
      >
        <label
          htmlFor="local-path"
          style={{
            display: 'block',
            fontSize: 14,
            fontWeight: 500,
            marginBottom: 8,
          }}
        >
          本地路径（文件夹绝对路径）
        </label>
        <input
          id="local-path"
          aria-label="本地路径"
          type="text"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="/Users/foo/my-videos"
          style={{
            width: '100%',
            padding: '8px 12px',
            border: '1px solid #d1d5db',
            borderRadius: 6,
            fontSize: 14,
            marginBottom: 16,
          }}
        />
        <button
          type="submit"
          disabled={!isOnline || mutation.isPending || !path.trim()}
          style={{
            padding: '10px 20px',
            background: isOnline && path.trim() ? '#2563eb' : '#9ca3af',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor:
              isOnline && path.trim() && !mutation.isPending
                ? 'pointer'
                : 'not-allowed',
            fontWeight: 500,
          }}
        >
          {mutation.isPending ? '绑定中…' : '绑定'}
        </button>

        {!mutation.isPending && savedPath && (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              background: '#ecfdf5',
              border: '1px solid #6ee7b7',
              borderRadius: 6,
              color: '#065f46',
              fontSize: 14,
            }}
          >
            绑定成功 — 已绑定 <code>{savedPath}</code>。Agent 将开始监听该文件夹的新文件。
          </div>
        )}
        {!mutation.isPending && !savedPath && currentBound && (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              background: '#ecfdf5',
              border: '1px solid #6ee7b7',
              borderRadius: 6,
              color: '#065f46',
              fontSize: 14,
            }}
          >
            当前已绑定 <code>{currentBound}</code>。
          </div>
        )}
        {error && (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              background: '#fef2f2',
              border: '1px solid #fca5a5',
              borderRadius: 6,
              color: '#991b1b',
              fontSize: 14,
            }}
          >
            {error}
          </div>
        )}
      </form>
    </div>
  );
}
