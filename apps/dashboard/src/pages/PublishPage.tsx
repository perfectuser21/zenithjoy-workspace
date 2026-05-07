/**
 * Walking Skeleton #1 — 一键发布 + 回执页
 * 路由：/dashboard/publish
 *
 * 内容：
 *  - "发布到抖音" 按钮 → POST /api/publish/task
 *  - 列出 publish_tasks（5s 轮询 GET /api/publish/tasks?agent_id=...）
 *  - 任务行展示：id / status / result.url
 *  - agent 离线 / 未绑定 folder → 按钮禁用
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getAgentStatus,
  listPublishTasks,
  postPublishTask,
} from '../api/walking-skeleton-1.api';

const STATUS_COLOR: Record<string, string> = {
  pending: '#9ca3af',
  running: '#3b82f6',
  success: '#10b981',
  failed: '#ef4444',
};
const STATUS_TEXT: Record<string, string> = {
  pending: 'pending（排队中）',
  running: 'running（执行中）',
  success: 'success（成功）',
  failed: 'failed（失败）',
};

export default function PublishPage() {
  const qc = useQueryClient();
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  const { data: agentData } = useQuery({
    queryKey: ['ws1', 'agent-status'],
    queryFn: getAgentStatus,
    refetchInterval: 10_000,
  });
  const agentId = agentData?.agent_id;
  const folderPath = agentData?.bound_folder_path;
  const isOnline = !!agentData?.connected && !!agentId;
  const canPublish = isOnline && !!folderPath;

  const { data: tasksData } = useQuery({
    queryKey: ['ws1', 'publish-tasks', agentId],
    queryFn: () => listPublishTasks(agentId!),
    enabled: !!agentId,
    refetchInterval: 5_000,
  });
  const tasks = tasksData?.tasks ?? [];

  const mutation = useMutation({
    mutationFn: () =>
      postPublishTask({
        agent_id: agentId!,
        platform: 'douyin',
        folder_path: folderPath!,
      }),
    onSuccess: () => {
      setSubmitErr(null);
      qc.invalidateQueries({ queryKey: ['ws1', 'publish-tasks', agentId] });
    },
    onError: (e) => {
      setSubmitErr(e instanceof Error ? e.message : String(e));
    },
  });

  return (
    <div style={{ padding: 24, maxWidth: 960 }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 16 }}>
        一键发布
      </h1>

      {!canPublish && (
        <div
          style={{
            padding: 12,
            marginBottom: 16,
            background: '#fef3c7',
            border: '1px solid #fbbf24',
            borderRadius: 6,
            color: '#92400e',
            fontSize: 14,
          }}
        >
          {!isOnline
            ? 'Agent 未连接 — 请先下载并启动 Agent。'
            : '尚未绑定本地视频文件夹 — 请先去"文件夹绑定"页面设置。'}
        </div>
      )}

      <section style={{ marginBottom: 24 }}>
        <button
          type="button"
          disabled={!canPublish || mutation.isPending}
          onClick={() => mutation.mutate()}
          style={{
            padding: '10px 24px',
            background: canPublish ? '#2563eb' : '#9ca3af',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor:
              canPublish && !mutation.isPending ? 'pointer' : 'not-allowed',
            fontWeight: 500,
            fontSize: 15,
          }}
        >
          {mutation.isPending ? '派发中…' : '发布到抖音'}
        </button>
        {submitErr && (
          <div
            style={{
              marginTop: 12,
              fontSize: 14,
              color: '#991b1b',
            }}
          >
            派发失败：{submitErr}
          </div>
        )}
      </section>

      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
        发布任务（{tasks.length}）
      </h2>
      {tasks.length === 0 ? (
        <div
          style={{
            padding: 20,
            background: '#fff',
            border: '1px dashed #d1d5db',
            borderRadius: 8,
            color: '#9ca3af',
            textAlign: 'center',
          }}
        >
          暂无任务 — 点击上方"发布到抖音"创建第一个 dryrun。
        </div>
      ) : (
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
          }}
        >
          <thead>
            <tr style={{ background: '#f9fafb' }}>
              <Th>Task ID</Th>
              <Th>状态</Th>
              <Th>回执</Th>
              <Th>创建时间</Th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id} style={{ borderTop: '1px solid #e5e7eb' }}>
                <Td>
                  <code style={{ fontSize: 12 }}>{t.id}</code>
                </Td>
                <Td>
                  <span
                    style={{
                      padding: '2px 8px',
                      borderRadius: 999,
                      fontSize: 12,
                      color: '#fff',
                      background: STATUS_COLOR[t.status] || '#9ca3af',
                    }}
                  >
                    {STATUS_TEXT[t.status] || t.status}
                  </span>
                </Td>
                <Td>
                  {t.result?.url ? (
                    <a
                      href={t.result.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#2563eb', fontSize: 13 }}
                    >
                      {t.result.url}
                    </a>
                  ) : t.result?.error ? (
                    <span style={{ color: '#991b1b', fontSize: 13 }}>
                      {t.result.error}
                    </span>
                  ) : (
                    <span style={{ color: '#9ca3af' }}>—</span>
                  )}
                </Td>
                <Td>
                  <span style={{ fontSize: 12, color: '#6b7280' }}>
                    {new Date(t.created_at).toLocaleString('zh-CN')}
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        padding: '10px 12px',
        textAlign: 'left',
        fontSize: 13,
        color: '#374151',
        fontWeight: 600,
      }}
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: '10px 12px', fontSize: 14 }}>{children}</td>;
}
