/** 工作机控制塔 · 总览（/dashboard/workers）：每台 worker 一张卡片，5s 轮询 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchWorkers, type Worker } from '../api/workers.api';

const POLL_MS = 5000;

function osBadge(os: Worker['os_type']) {
  if (os === 'android') return '📱 安卓';
  if (os === 'win32') return '🖥️ Windows';
  return `💻 ${os ?? '未知'}`;
}

export default function WorkersPage() {
  const [workers, setWorkers] = useState<Worker[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchWorkers()
        .then((w) => {
          if (alive) {
            setWorkers(w);
            setError(null);
          }
        })
        .catch((e) => {
          if (alive) setError(String(e));
        });
    load();
    const t = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (error && !workers) return <div className="p-6 text-red-600">加载失败：{error}</div>;
  if (!workers) return <div className="p-6 text-gray-500">加载中…</div>;

  if (workers.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold mb-2">工作机</h1>
        <p className="text-gray-600">还没有工作机。安装 Agent 并用你的 license 注册后，它会出现在这里。</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-4">工作机</h1>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {workers.map((w) => (
          <div key={w.id} className="rounded-xl border p-4 shadow-sm bg-white">
            <div className="flex items-center justify-between">
              <div className="font-medium">{w.nickname || w.hostname}</div>
              <span
                className={`text-xs px-2 py-0.5 rounded-full ${
                  w.status === 'online' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                }`}
              >
                {w.status === 'online' ? '● 在线' : '○ 离线'}
              </span>
            </div>
            <div className="text-sm text-gray-500 mt-1">
              {osBadge(w.os_type)} · {w.hostname}
            </div>
            <div className="mt-3 text-sm">
              {w.running ? (
                <div className="text-amber-700">
                  正在执行：{w.running.title}
                  <span className="ml-2 text-xs">
                    第 {w.running.current_step}/{w.running.steps_total} 步
                  </span>
                </div>
              ) : (
                <div className="text-gray-600">空闲</div>
              )}
            </div>
            <div className="mt-2 text-xs text-gray-500">今日完成 {w.completed_today}</div>
            <div className="mt-3">
              <Link to={`/dashboard/workers/${w.id}`} className="text-sm text-blue-600 hover:underline">
                实时画面 →
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
