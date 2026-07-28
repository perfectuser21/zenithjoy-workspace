import { useEffect, useState } from 'react';

// fail-closed 判定点：查不到 desktop-lease-broker 状态就当 RPA 进行中，绝不擅自全屏。
// 与 services/agent/src/shared/panel-rpa-guard.ts 同款判定点，独立小实现（不同运行时/构建管线）。
const AGENT_LOCAL_BASE = 'http://localhost:58432';
const POLL_MS = 2000;
const TIMEOUT_MS = 3000;

async function fetchLeaseHeld(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(`${AGENT_LOCAL_BASE}/api/agent/desktop-lease-broker/status`, {
      signal: controller.signal,
    });
    if (!resp.ok) return true; // fail-closed
    const data = await resp.json();
    return Boolean(data.held);
  } catch {
    return true; // fail-closed：网络错误/超时一律当作 RPA 进行中
  } finally {
    clearTimeout(timer);
  }
}

export function useRpaGuard(): boolean {
  const [rpaActive, setRpaActive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const held = await fetchLeaseHeld();
      if (!cancelled) setRpaActive(held);
    };
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  return rpaActive;
}
