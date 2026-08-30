/** 工作机控制塔 · 实时详情（/dashboard/workers/:agentId）：左画面（MJPEG）右步骤流，底部历史 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchWorkerActivity, workerLiveUrl, type WorkerActivity, type WorkerStep } from '../api/workers.api';

const POLL_MS = 1000;
const FRAME_STALE_MS = 15_000;

function icon(s: WorkerStep['status']) {
  return s === 'done' ? '✅' : s === 'doing' ? '▶️' : s === 'failed' ? '❌' : '⬜';
}

function statusLabel(s: string) {
  return (
    ({ running: '执行中', completed: '已完成', failed: '失败', needs_review: '待人工核实' } as Record<string, string>)[
      s
    ] ?? s
  );
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h > 0) return `${h}时${String(m).padStart(2, '0')}分`;
  if (m > 0) return `${m}分${String(sec).padStart(2, '0')}秒`;
  return `${sec}秒`;
}

function shotThumb(url: string | null | undefined, alt: string) {
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="shrink-0">
      <img src={url} alt={alt} className="h-10 rounded border" />
    </a>
  );
}

function formatDateTime(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '—';
  return t.toLocaleString();
}

export default function WorkerLivePage() {
  const { agentId = '' } = useParams();
  const [activity, setActivity] = useState<WorkerActivity | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    setActivity(null);
    setError(false);
    const load = () =>
      fetchWorkerActivity(agentId)
        .then((a) => {
          if (!alive) return;
          setActivity(a);
          setError(false);
        })
        .catch(() => {
          if (alive) setError(true);
        });
    load();
    const t = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [agentId]);

  const current = activity?.current ?? null;
  // 后端算好帧龄下发（frame_age_ms），不用浏览器 <img> onLoad 计时：Chrome 对 multipart/x-mixed-replace
  // 的 <img> 只在首帧触发一次 load，之后每帧不会再触发，onLoad 计时法 15s 后会永远显示"画面不可用"。
  const frameAgeMs = activity?.frame_age_ms ?? null;
  const frameStale = frameAgeMs == null || frameAgeMs > FRAME_STALE_MS;

  return (
    <div className="p-6">
      <div className="mb-3 text-sm">
        <Link to="/dashboard/workers" className="text-blue-600 hover:underline">
          ← 工作机
        </Link>
      </div>
      {error ? (
        <div className="text-sm text-red-600">无法加载该工作机（可能不存在或无权限）</div>
      ) : (
      <div className="flex gap-6 flex-col lg:flex-row">
        <div className="lg:w-[360px] shrink-0">
          <div className="relative rounded-2xl overflow-hidden bg-black aspect-[9/19.5]">
            <img alt="实时画面" src={workerLiveUrl(agentId)} className="w-full h-full object-contain" />
            {frameStale && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-white text-sm">
                画面不可用
              </div>
            )}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold">{current ? current.title : '空闲'}</h2>
          {current && (
            <div className="text-xs text-gray-500 mt-1">
              第 {current.current_step}/{current.steps_total} 步 · {statusLabel(current.status)}
            </div>
          )}
          <ul className="mt-4 divide-y">
            {(activity?.steps ?? []).map((s) => (
              <li key={s.step_index} className="py-2 flex items-center gap-3 text-sm">
                <span className="w-6 text-center">{icon(s.status)}</span>
                <span className={s.status === 'doing' ? 'text-amber-700' : s.status === 'pending' ? 'text-gray-400' : ''}>
                  {s.title}
                </span>
                {(s.screenshot_url || (s.status === 'failed' && (s.foreground_pkg || s.diag_line))) && (
                  <div className="ml-auto flex items-center gap-2">
                    {s.screenshot_url && (
                      <a href={s.screenshot_url} target="_blank" rel="noreferrer">
                        <img src={s.screenshot_url} alt={`第 ${s.step_index + 1} 步截图`} className="h-10 rounded border" />
                      </a>
                    )}
                    {s.status === 'failed' && (s.foreground_pkg || s.diag_line) && (
                      <div className="text-xs text-red-600">
                        {[s.foreground_pkg, s.diag_line].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <h3 className="mt-8 text-sm font-semibold text-gray-700">最近任务</h3>
          <table className="mt-2 w-full text-sm">
            <thead className="text-left text-gray-500">
              <tr>
                <th>开始</th>
                <th>任务</th>
                <th>结果</th>
                <th>耗时</th>
                <th>失败信息 / 截图</th>
              </tr>
            </thead>
            <tbody>
              {(activity?.history ?? []).map((h) => (
                <tr key={h.id} className="border-t align-top">
                  <td className="py-1 pr-3 whitespace-nowrap">{formatDateTime(h.started_at)}</td>
                  <td className="py-1 pr-3">{h.title}</td>
                  <td className="py-1 pr-3 whitespace-nowrap">{statusLabel(h.status)}</td>
                  <td className="py-1 pr-3 whitespace-nowrap text-gray-600">{formatDuration(h.duration_ms)}</td>
                  <td className="py-1">
                    {h.error_code ? (
                      <div className="flex items-start gap-2 text-red-600">
                        {shotThumb(h.failed_scene?.screenshot_url, `${h.title} 失败截图`)}
                        <span className="break-all">
                          {[
                            `第 ${h.failed_step == null ? '?' : h.failed_step + 1} 步`,
                            h.error_code,
                            h.failed_scene?.foreground_pkg,
                            h.failed_scene?.diag_line,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </div>
                    ) : (
                      shotThumb(h.evidence_screenshot_url, `${h.title} 完成截图`)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}
    </div>
  );
}
