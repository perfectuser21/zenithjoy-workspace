/**
 * Walking Skeleton #1 — Agent 下载页
 * 路由：/dashboard/agent
 *
 * 内容：
 *  - 下载入口（GitHub Release URL placeholder；没真 release → "敬请期待"）
 *  - "已连接 Agent" 状态徽标，10s 轮询 GET /api/agent/status
 *
 * 第一刀允许丑：内联样式，能跑能看就行。
 */
import { useQuery } from '@tanstack/react-query';
import { getAgentStatus } from '../api/walking-skeleton-1.api';

// 没真 release 之前先用 placeholder，CI 不去访问这个 URL。
const RELEASE_URL =
  'https://github.com/perfect21/zenithjoy-agent/releases/latest';
const RELEASE_AVAILABLE = false; // 改为 true 后启用下载入口

export default function AgentDownloadPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['ws1', 'agent-status'],
    queryFn: getAgentStatus,
    refetchInterval: 10_000,
  });

  const connected = !!data?.connected;

  return (
    <div style={{ padding: 24, maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 16 }}>
        下载 Agent
      </h1>

      {/* ===== 下载卡片 ===== */}
      <section
        style={{
          padding: 20,
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          marginBottom: 24,
          background: '#fff',
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
          ZenithJoy Agent
        </h2>
        <p style={{ color: '#6b7280', marginBottom: 16, lineHeight: 1.6 }}>
          ZenithJoy Agent 是部署在你本地 Mac 的小程序，
          负责扫码登录抖音、监听文件夹、执行发布任务。
        </p>
        {RELEASE_AVAILABLE ? (
          <a
            href={RELEASE_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-block',
              padding: '10px 20px',
              background: '#2563eb',
              color: '#fff',
              borderRadius: 6,
              textDecoration: 'none',
              fontWeight: 500,
            }}
          >
            前往 GitHub Releases 下载
          </a>
        ) : (
          <div
            style={{
              padding: 16,
              background: '#f9fafb',
              border: '1px dashed #d1d5db',
              borderRadius: 6,
              color: '#6b7280',
            }}
          >
            敬请期待 — Agent v0.1 正在打包中。GitHub Release 链接：
            <code style={{ marginLeft: 4 }}>{RELEASE_URL}</code>
          </div>
        )}
      </section>

      {/* ===== 状态徽标 ===== */}
      <section
        style={{
          padding: 20,
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          background: '#fff',
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
          连接状态
        </h2>
        {isLoading ? (
          <div style={{ color: '#9ca3af' }}>检查中…</div>
        ) : connected ? (
          <div>
            <span
              style={{
                display: 'inline-block',
                padding: '4px 10px',
                background: '#10b981',
                color: '#fff',
                borderRadius: 999,
                fontSize: 13,
              }}
            >
              ● 已连接
            </span>
            <div style={{ marginTop: 12, fontSize: 14, color: '#374151' }}>
              <div>主机：{data?.hostname ?? '—'}</div>
              <div>版本：{data?.version ?? '—'}</div>
              <div>
                上次心跳：
                {data?.last_heartbeat_at
                  ? new Date(data.last_heartbeat_at).toLocaleString('zh-CN')
                  : '—'}
              </div>
            </div>
          </div>
        ) : (
          <div>
            <span
              style={{
                display: 'inline-block',
                padding: '4px 10px',
                background: '#9ca3af',
                color: '#fff',
                borderRadius: 999,
                fontSize: 13,
              }}
            >
              ● 未连接
            </span>
            <div
              style={{ marginTop: 12, fontSize: 14, color: '#6b7280' }}
            >
              请先下载 Agent 并启动。每 10 秒自动刷新一次状态。
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
