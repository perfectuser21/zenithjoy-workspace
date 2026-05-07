/**
 * Walking Skeleton #1 — Agent 下载页
 * 路由：/dashboard/agent
 *
 * 内容：
 *  - 下载入口（autopilot 静态分发 tarball）
 *  - 解压后启动指引（npm install + customer-start.sh）
 *  - "已连接 Agent" 状态徽标，10s 轮询 GET /api/agent/status
 *
 * 第一刀允许丑：内联样式，能跑能看就行。
 */
import { useQuery } from '@tanstack/react-query';
import { getAgentStatus } from '../api/walking-skeleton-1.api';

// autopilot nginx 直分发的 agent tarball（hk-vps:/opt/zenithjoy/autopilot-dashboard/dist/download/）
const AGENT_VERSION = '0.1.0';
const RELEASE_URL = `/download/zenithjoy-agent-v${AGENT_VERSION}.tar.gz`;

export default function AgentDownloadPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['ws1', 'agent-status'],
    queryFn: getAgentStatus,
    refetchInterval: 10_000,
  });

  const connected = !!data?.connected;
  // 客户从注册流程拿到的 license（v0.1 thin：用户自己在终端 export，前端不回灌）
  const licensePlaceholder = 'ZJ-F-XXXXXX';

  return (
    <div style={{ padding: 24, maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 16 }}>
        ZenithJoy Agent · 客户端
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
          ZenithJoy Agent v{AGENT_VERSION}
        </h2>
        <p style={{ color: '#6b7280', marginBottom: 16, lineHeight: 1.6 }}>
          ZenithJoy Agent 是部署在你本地 Mac 的小程序，
          负责扫码登录抖音、监听文件夹、执行发布任务。
        </p>
        <a
          href={RELEASE_URL}
          download
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
          下载 Agent v{AGENT_VERSION} (.tar.gz)
        </a>
      </section>

      {/* ===== 解压后启动指引 ===== */}
      <section
        style={{
          padding: 20,
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          marginBottom: 24,
          background: '#fff',
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
          解压后启动（macOS）
        </h2>
        <ol style={{ paddingLeft: 20, lineHeight: 1.8, color: '#374151', fontSize: 14 }}>
          <li>
            解压 <code>zenithjoy-agent-v{AGENT_VERSION}.tar.gz</code> 到任意目录。
          </li>
          <li>
            进入目录装依赖：
            <pre
              style={{
                background: '#f3f4f6',
                padding: 10,
                borderRadius: 4,
                marginTop: 6,
                fontSize: 13,
                overflowX: 'auto',
              }}
            >
{`cd zenithjoy-agent && npm install`}
            </pre>
          </li>
          <li>
            一键启动（推荐）：
            <pre
              style={{
                background: '#f3f4f6',
                padding: 10,
                borderRadius: 4,
                marginTop: 6,
                fontSize: 13,
                overflowX: 'auto',
              }}
            >
{`export ZENITHJOY_LICENSE=${licensePlaceholder}  # 替换成你注册后拿到的 license
bash scripts/customer-start.sh`}
            </pre>
            脚本会自动启动 Chrome 调试模式 + 启动 Agent。请在打开的 Chrome 窗口里
            登录 <code>https://creator.douyin.com</code>（用测试号）。
          </li>
          <li>
            回到本页面，下方状态卡片会变成绿色徽标 = 成功握手。
          </li>
        </ol>
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
