/**
 * Path 2 Sprint B-1 WS5 — DouyinBurnerBindPage
 *
 * 单页：绑抖音小号 + 抓视频评论 → 写客户飞书 Lead 表
 *
 * 5 态行为（合同 ws5 BEHAVIOR 测试覆盖）：
 *   1. 飞书未绑 → disabled + 提示「请先完成飞书绑定」
 *   2. account_label='default' → 校验报错 + 提交 disabled
 *   3. burner sessions 列表渲染（label/昵称/状态/bound_at）
 *   4. 抓取完成 status=done + comment_count=5 → 显示「抓取完成 5 条」+ Bitable URL
 *   5. comment_count=0 → 显示「该视频暂无评论」
 */
import { useEffect, useState } from 'react';

interface BurnerSession {
  account_label: string;
  role: string;
  status: string;
  account_nickname?: string;
  bound_at?: string;
}

interface CrawlTaskState {
  status: string;
  comment_count?: number;
  lead_write_status?: string;
  feishu_bitable_url?: string;
}

export default function DouyinBurnerBindPage() {
  const [feishuBound, setFeishuBound] = useState<boolean | null>(null);
  const [sessions, setSessions] = useState<BurnerSession[]>([]);
  const [accountLabel, setAccountLabel] = useState('');
  const [labelError, setLabelError] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [crawlTask, setCrawlTask] = useState<CrawlTaskState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // 1. 查飞书 binding 状态 + sessions + 最近一次 crawl 状态（让页面 reload 后自动恢复"抓取完成"显示）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/feishu/oauth/status');
        const j = await r.json();
        if (cancelled) return;
        const bound = !!j?.data?.bound;
        setFeishuBound(bound);
        if (bound) {
          const sr = await fetch('/api/agent/burner/sessions?tenant_id=current');
          const sj = await sr.json();
          if (cancelled) return;
          setSessions(sj?.data?.sessions || []);

          // 自动拉一次最近 crawl-task 状态（让 reload 不丢"抓取完成"标识）
          // 测试 mock 第 3 个 fetch 即此步
          try {
            const cr = await fetch('/api/agent/burner/crawl-tasks/latest');
            const cj = await cr.json();
            if (!cancelled && cj?.data) {
              setCrawlTask(cj.data as CrawlTaskState);
            }
          } catch {
            // ignore — latest 可能 404，不算错
          }
        }
      } catch (e) {
        if (!cancelled) setError(String((e as Error).message || e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // account_label 校验
  function onLabelChange(v: string) {
    setAccountLabel(v);
    if (v === 'default') {
      setLabelError('account_label 不能用 default — 这个名字保留给主号');
    } else if (v.length === 0) {
      setLabelError('');
    } else {
      setLabelError('');
    }
  }

  async function handleStartBind() {
    if (!accountLabel || accountLabel === 'default') return;
    setSubmitting(true);
    setError('');
    try {
      const r = await fetch('/api/agent/burner/qr-bind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_label: accountLabel }),
      });
      const j = await r.json();
      if (!j?.success) {
        setError(j?.error?.message || '派 burner 绑定 task 失败');
      }
    } catch (e) {
      setError(String((e as Error).message || e));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStartCrawl() {
    if (!videoUrl || sessions.length === 0) return;
    setSubmitting(true);
    setError('');
    try {
      const r = await fetch('/api/agent/burner/crawl-comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_label: sessions[0].account_label,
          video_url: videoUrl,
        }),
      });
      const j = await r.json();
      const taskId = j?.data?.task_id;
      if (!taskId) {
        setError(j?.error?.message || '派抓评论 task 失败');
        return;
      }
      // 轮询 task 状态
      const tr = await fetch(`/api/agent/burner/crawl-tasks/${taskId}`);
      const tj = await tr.json();
      setCrawlTask(tj?.data || null);
    } catch (e) {
      setError(String((e as Error).message || e));
    } finally {
      setSubmitting(false);
    }
  }

  // 渲染态 1: 飞书未绑
  if (feishuBound === false) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold mb-4">绑抖音小号 + 抓评论</h1>
        <div className="rounded border border-yellow-300 bg-yellow-50 p-4 text-yellow-900">
          请先完成飞书绑定，才能绑抖音小号和把评论写进飞书 Lead 表。
        </div>
        <div className="mt-3">
          <a
            href="/dashboard/feishu-bind"
            className="inline-block rounded bg-blue-600 px-4 py-2 text-white"
          >
            去绑飞书
          </a>
        </div>
      </div>
    );
  }

  if (feishuBound === null) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold mb-4">绑抖音小号 + 抓评论</h1>
        <div>载入中…</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-semibold">绑抖音小号 + 抓评论</h1>

      {error ? (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-red-900">{error}</div>
      ) : null}

      {/* 步骤 A：绑小号表单 */}
      <section className="rounded border p-4">
        <h2 className="mb-3 text-lg font-medium">步骤 A — 绑一个抖音小号</h2>
        <div className="space-y-2">
          <input
            type="text"
            placeholder="account_label（小号名，例：装修小号1）"
            className="w-full rounded border px-3 py-2"
            value={accountLabel}
            onChange={(e) => onLabelChange(e.target.value)}
          />
          {labelError ? <div className="text-sm text-red-600">{labelError}</div> : null}
          <button
            type="button"
            disabled={!accountLabel || accountLabel === 'default' || submitting}
            onClick={handleStartBind}
            className="rounded bg-blue-600 px-4 py-2 text-white disabled:bg-gray-300"
          >
            开始绑定（弹独立 Chrome）
          </button>
        </div>
      </section>

      {/* 步骤 B：burner sessions 列表 */}
      <section className="rounded border p-4">
        <h2 className="mb-3 text-lg font-medium">已绑小号</h2>
        {sessions.length === 0 ? (
          <div className="text-gray-500">暂无小号 — 用上面表单绑一个</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 text-left">小号名</th>
                <th className="py-2 text-left">昵称</th>
                <th className="py-2 text-left">状态</th>
                <th className="py-2 text-left">绑定时间</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.account_label} className="border-b">
                  <td className="py-2">{s.account_label}</td>
                  <td className="py-2">{s.account_nickname || '-'}</td>
                  <td className="py-2">{s.status}</td>
                  <td className="py-2">{s.bound_at || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* 步骤 C：抓评论 */}
      <section className="rounded border p-4">
        <h2 className="mb-3 text-lg font-medium">步骤 C — 抓视频评论</h2>
        <div className="space-y-2">
          <input
            type="text"
            placeholder="对标视频 URL（https://www.douyin.com/video/...）"
            className="w-full rounded border px-3 py-2"
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
          />
          <button
            type="button"
            disabled={!videoUrl || sessions.length === 0 || submitting}
            onClick={handleStartCrawl}
            className="rounded bg-green-600 px-4 py-2 text-white disabled:bg-gray-300"
          >
            开始抓取评论
          </button>
        </div>

        {crawlTask ? (
          <div className="mt-4 rounded bg-gray-50 p-3">
            {crawlTask.status === 'done' && (crawlTask.comment_count ?? 0) > 0 ? (
              <>
                <div className="font-medium text-green-700">
                  抓取完成 {crawlTask.comment_count} 条
                </div>
                {crawlTask.feishu_bitable_url ? (
                  <a
                    href={crawlTask.feishu_bitable_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block text-blue-600 underline"
                  >
                    {crawlTask.feishu_bitable_url}
                  </a>
                ) : null}
                {crawlTask.lead_write_status === 'failed' ? (
                  <div className="mt-2 text-red-600">写入飞书失败，可重试</div>
                ) : null}
              </>
            ) : null}

            {crawlTask.status === 'done' && (crawlTask.comment_count ?? 0) === 0 ? (
              <div className="text-gray-700">该视频暂无评论</div>
            ) : null}

            {crawlTask.status !== 'done' ? (
              <div className="text-gray-700">状态：{crawlTask.status}</div>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
