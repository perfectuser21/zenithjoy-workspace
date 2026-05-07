/**
 * Walking Skeleton #1 — Agent 下载页
 * 路由：/dashboard/agent
 *
 * 内容：
 *  - 下载入口（autopilot 静态分发 tarball）
 *  - 双平台启动指引：Windows（主流程）+ macOS（开发者备用）
 *  - "已连接 Agent" 状态徽标，10s 轮询 GET /api/agent/status
 *
 * 第一刀允许丑：内联样式，能跑能看就行。
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { getAgentStatus } from '../api/walking-skeleton-1.api';
import { fetchAccountMe } from '../api/account.api';

// autopilot nginx 直分发的 agent tarball（hk-vps:/opt/zenithjoy/autopilot-dashboard/dist/download/）
const AGENT_VERSION = '0.1.8';
const RELEASE_URL = `/download/zenithjoy-agent-v${AGENT_VERSION}.tar.gz`;
const LICENSE_PLACEHOLDER = 'ZJ-F-XXXXXX';

export default function AgentDownloadPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['ws1', 'agent-status'],
    queryFn: getAgentStatus,
    refetchInterval: 10_000,
  });
  const accountQuery = useQuery({
    queryKey: ['ws1', 'account-me'],
    queryFn: fetchAccountMe,
    retry: false,
    staleTime: 30_000,
  });

  const connected = !!data?.connected;
  // 优先用真 license（注册即建 free license），未拿到回退占位
  const realLicense = accountQuery.data?.license?.license_key;

  // 把真 license 同步写入 localStorage，供 walking-skeleton-1.api 的 license-bearer 鉴权使用。
  // 这是 better-auth 邮箱登录与 license-Bearer 鉴权之间的桥（不然 /api/agent/status 永远 401）。
  useEffect(() => {
    if (realLicense && typeof window !== 'undefined') {
      try {
        if (window.localStorage.getItem('zj_license') !== realLicense) {
          window.localStorage.setItem('zj_license', realLicense);
        }
      } catch {
        // localStorage 被禁用 / 隐私模式 — 静默失败，cookie 路径仍可用
      }
    }
  }, [realLicense]);
  const license = realLicense ?? LICENSE_PLACEHOLDER;

  return (
    <div style={{ padding: 24, maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 16 }}>
        ZenithJoy Agent · 客户端
      </h1>

      {/* ===== 我的 License（注册即建 free 1 装机配额）===== */}
      <section
        style={{
          padding: 16,
          border: '1px solid #fde68a',
          borderRadius: 8,
          marginBottom: 16,
          background: '#fffbeb',
        }}
      >
        <div style={{ fontSize: 13, color: '#92400e', marginBottom: 6 }}>
          你的 License（启动 Agent 时需要）
        </div>
        <code
          style={{
            display: 'inline-block',
            fontSize: 16,
            fontWeight: 600,
            color: '#78350f',
            background: '#fff',
            padding: '4px 10px',
            borderRadius: 4,
            border: '1px solid #fde68a',
          }}
        >
          {license}
        </code>
        {!realLicense && (
          <div style={{ fontSize: 12, color: '#b45309', marginTop: 6 }}>
            未检测到你的 license。请先{' '}
            <a href="/signup" style={{ color: '#2563eb' }}>
              注册账号
            </a>
            ；注册成功后会自动建一个 free license（1 台 Agent 试用）。
          </div>
        )}
      </section>

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
          ZenithJoy Agent 是部署在你本地电脑（Windows 主、macOS 备用）的小程序，
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

      {/* ===== Windows 启动（主流程）===== */}
      <section
        style={{
          padding: 20,
          border: '1px solid #2563eb',
          borderRadius: 8,
          marginBottom: 16,
          background: '#fff',
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
          Windows 启动（主流程）
        </h2>

        {/* ★ thin 极限的 1-click：双击 install-and-start.bat ★ */}
        <div
          style={{
            padding: 12,
            background: '#eff6ff',
            border: '1px solid #bfdbfe',
            borderRadius: 6,
            marginBottom: 14,
            fontSize: 14,
            lineHeight: 1.6,
            color: '#1e40af',
          }}
        >
          <strong>★ 推荐路径（一键启动）</strong>：解压 tarball 后，
          直接 <strong>双击</strong> <code>install-and-start.bat</code>。
          脚本会自动装依赖、提示输入 license、启动 Chrome + Agent。
          下方 cmd 命令仅在双击不工作时使用。
        </div>

        <ol style={{ paddingLeft: 20, lineHeight: 1.8, color: '#374151', fontSize: 14 }}>
          <li>
            解压 <code>zenithjoy-agent-v{AGENT_VERSION}.tar.gz</code> 到 <code>%USERPROFILE%</code>
            （Windows 10/11 自带 <code>tar</code> 命令）：
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
{`cd "%USERPROFILE%"
tar -xzf "Downloads\\zenithjoy-agent-v${AGENT_VERSION}.tar.gz"
cd zenithjoy-agent`}
            </pre>
          </li>
          <li>
            装依赖：
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
{`npm install`}
            </pre>
          </li>
          <li>
            一键启动（推荐，cmd）：
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
{`set ZENITHJOY_LICENSE=${license}
scripts\\customer-start.bat`}
            </pre>
            脚本会自动启动 Chrome 调试模式（19222 端口）+ Agent。
            请在弹出的 Chrome 里登录 <code>https://creator.douyin.com</code>（测试号）。
          </li>
          <li>
            下方状态卡片变绿 = 握手成功。
          </li>
        </ol>
      </section>

      {/* ===== macOS 启动（开发者备用）===== */}
      <section
        style={{
          padding: 20,
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          marginBottom: 24,
          background: '#fafafa',
        }}
      >
        <h2 style={{ fontSize: 15, fontWeight: 500, marginBottom: 12, color: '#6b7280' }}>
          macOS 启动（开发者备用）
        </h2>
        <ol style={{ paddingLeft: 20, lineHeight: 1.8, color: '#6b7280', fontSize: 13 }}>
          <li>
            解压 <code>zenithjoy-agent-v{AGENT_VERSION}.tar.gz</code> 到任意目录，
            <code>cd zenithjoy-agent && npm install</code>。
          </li>
          <li>
            一键启动：
            <pre
              style={{
                background: '#f3f4f6',
                padding: 10,
                borderRadius: 4,
                marginTop: 6,
                fontSize: 13,
                overflowX: 'auto',
                color: '#374151',
              }}
            >
{`export ZENITHJOY_LICENSE=${license}
bash scripts/customer-start.sh`}
            </pre>
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
