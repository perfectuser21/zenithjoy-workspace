/**
 * Path 4 Sprint 1 ws2 — Agent 机器列表页（绑微信入口）
 * 路由：/dashboard/agent-machines
 *
 * 内容：
 *  - 列出当前 license 下绑定的 Agent 机器卡片（thin: 1 台）
 *  - 每张卡片含"绑定微信"按钮 + 通道下拉
 *  - 通道：个人微信（thin 唯一可选）/企业微信（disabled, title="加厚阶段开放"）
 *  - 点"绑定微信" → POST /api/wechat/qr-bind {platform, agent_id} → toast task_id
 */
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { getAgentStatus } from '../api/walking-skeleton-1.api';
import { postWechatQrBind } from '../api/wechat.api';

type Channel = 'wechat_personal' | 'wechat_enterprise';

export default function AgentMachines() {
  const [channel, setChannel] = useState<Channel>('wechat_personal');
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);

  const { data: agentData } = useQuery({
    queryKey: ['ws2', 'agent-status'],
    queryFn: getAgentStatus,
    refetchInterval: 10_000,
  });
  const agentId = agentData?.agent_id;
  const isOnline = !!agentData?.connected && !!agentId;

  const mutation = useMutation({
    mutationFn: () => postWechatQrBind({ platform: channel, agent_id: agentId! }),
    onSuccess: (r) => {
      setSubmitMsg(`已派发扫码任务：task_id=${r.task_id}（请到客户机扫码）`);
    },
    onError: (e) => {
      setSubmitMsg(`派发失败：${e instanceof Error ? e.message : String(e)}`);
    },
  });

  const channelDisabled = channel === 'wechat_enterprise';

  return (
    <div style={{ padding: 24, maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 16 }}>Agent 机器</h1>

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
          请先连接 Agent 后再绑定微信。当前 Agent 未连接 —{' '}
          <a href="/dashboard/agent" style={{ color: '#92400e', fontWeight: 600 }}>
            点此下载 Agent →
          </a>
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
        <div style={{ marginBottom: 12, fontSize: 14, color: '#374151' }}>
          <span style={{ color: '#6b7280', marginRight: 8 }}>机器：</span>
          <strong>{agentData?.hostname ?? '（未连接）'}</strong>
          <span style={{ marginLeft: 12, color: '#9ca3af' }}>
            agent_id: {agentId ?? '—'}
          </span>
        </div>

        <label
          htmlFor="wechat-channel-select"
          style={{ display: 'block', marginBottom: 8, fontSize: 14, color: '#374151' }}
        >
          通道
        </label>
        <select
          id="wechat-channel-select"
          aria-label="通道"
          value={channel}
          onChange={(e) => setChannel(e.target.value as Channel)}
          style={{
            display: 'block',
            marginBottom: 16,
            padding: '8px 12px',
            fontSize: 14,
            border: '1px solid #d1d5db',
            borderRadius: 6,
            minWidth: 240,
          }}
        >
          <option value="wechat_personal">个人微信</option>
          <option value="wechat_enterprise" disabled title="加厚阶段开放">
            企业微信（加厚阶段开放）
          </option>
        </select>

        <button
          type="button"
          data-testid="wechat-bind-btn"
          disabled={!isOnline || channelDisabled || mutation.isPending}
          onClick={() => mutation.mutate()}
          style={{
            padding: '10px 20px',
            background: isOnline && !channelDisabled ? '#16a34a' : '#9ca3af',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: isOnline && !channelDisabled ? 'pointer' : 'not-allowed',
            fontWeight: 500,
          }}
        >
          {mutation.isPending ? '派发中…' : '绑定微信'}
        </button>

        {submitMsg && (
          <div style={{ marginTop: 12, fontSize: 14, color: '#374151' }}>{submitMsg}</div>
        )}
      </section>

      <p style={{ color: '#6b7280', fontSize: 13, lineHeight: 1.6 }}>
        thin 阶段仅支持个人微信。企业微信入口已预留，加厚阶段（Path 4 Sprint 2+）开放。
        点击"绑定微信"后，Agent 会在 Windows 客户机上自动启动 PC 微信，请到客户机屏幕扫码。
      </p>
    </div>
  );
}
