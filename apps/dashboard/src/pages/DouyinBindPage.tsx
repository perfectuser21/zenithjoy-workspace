/**
 * Walking Skeleton #1 — 抖音绑定页
 * 路由：/dashboard/platforms/douyin
 *
 * 内容：
 *  - "扫码绑抖音" 按钮：点击 → POST /api/agent/qr-bind
 *    后端 push qr_bind/douyin task 给 agent，agent 收到后弹 Playwright Chrome
 *  - 显示 agent_platform_sessions.douyin.status（pending/active/expired）
 *  - agent 离线时按钮禁用
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getAgentStatus,
  getPlatformSessions,
  postQrBind,
} from '../api/walking-skeleton-1.api';

const STATUS_TEXT: Record<string, string> = {
  pending: 'pending（未绑定）',
  active: 'active（已绑定）',
  expired: 'expired（已过期）',
};
const STATUS_COLOR: Record<string, string> = {
  pending: '#f59e0b',
  active: '#10b981',
  expired: '#ef4444',
};

export default function DouyinBindPage() {
  const qc = useQueryClient();
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);

  const { data: agentData } = useQuery({
    queryKey: ['ws1', 'agent-status'],
    queryFn: getAgentStatus,
    refetchInterval: 10_000,
  });
  const agentId = agentData?.agent_id;
  const isOnline = !!agentData?.connected && !!agentId;

  const { data: sessionData } = useQuery({
    queryKey: ['ws1', 'platforms', agentId],
    queryFn: () => getPlatformSessions(agentId!),
    enabled: !!agentId,
    refetchInterval: 5_000,
  });

  const douyinSession = sessionData?.sessions.find(
    (s) => s.platform === 'douyin'
  );
  const status = douyinSession?.status ?? 'pending';

  const mutation = useMutation({
    mutationFn: () => postQrBind(agentId!, 'douyin'),
    onSuccess: () => {
      setSubmitMsg('已派发扫码任务，请到 agent 端 Chrome 完成扫码。');
      qc.invalidateQueries({ queryKey: ['ws1', 'platforms', agentId] });
    },
    onError: (e) => {
      setSubmitMsg(`派发失败：${e instanceof Error ? e.message : String(e)}`);
    },
  });

  return (
    <div style={{ padding: 24, maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 16 }}>
        抖音绑定
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
          请先连接 Agent 后再扫码绑定。当前 Agent 未连接 — 请先下载 Agent。
        </div>
      )}

      <section
        style={{
          padding: 20,
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          background: '#fff',
          marginBottom: 16,
        }}
      >
        <div style={{ marginBottom: 12 }}>
          <span style={{ color: '#6b7280', fontSize: 14, marginRight: 8 }}>
            当前抖音 session 状态：
          </span>
          <span
            style={{
              padding: '2px 10px',
              borderRadius: 999,
              fontSize: 13,
              color: '#fff',
              background: STATUS_COLOR[status] || '#9ca3af',
            }}
          >
            {STATUS_TEXT[status] || status}
          </span>
        </div>

        <button
          type="button"
          disabled={!isOnline || mutation.isPending}
          onClick={() => mutation.mutate()}
          style={{
            padding: '10px 20px',
            background: isOnline ? '#2563eb' : '#9ca3af',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: isOnline ? 'pointer' : 'not-allowed',
            fontWeight: 500,
          }}
        >
          {mutation.isPending ? '派发中…' : '扫码绑抖音'}
        </button>

        {submitMsg && (
          <div style={{ marginTop: 12, fontSize: 14, color: '#374151' }}>
            {submitMsg}
          </div>
        )}
      </section>

      <p style={{ color: '#6b7280', fontSize: 13, lineHeight: 1.6 }}>
        点击按钮后，本地 Agent 会自动启动 Chrome 浏览器窗口，
        请在浏览器中完成抖音扫码登录。session 文件保存在
        <code> ~/.zenithjoy-agent/sessions/douyin/default.json</code>。
      </p>
    </div>
  );
}
