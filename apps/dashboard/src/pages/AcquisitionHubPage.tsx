/**
 * 智能获客 Hub — 4 模块入口（Line02 IA 重设计 Track A）
 *
 * 把原来的 4 步向导改成 4 个并列模块卡片，账号管理/采集任务两个卡片显示
 * 本 tenant 实时数字；客户分析/触达中心暂无内容实现，标注「即将上线」。
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, Target, BarChart2, Send } from 'lucide-react';

interface Module {
  label: string;
  desc: string;
  to: string;
  Icon: typeof KeyRound;
  color: string;
  bgColor: string;
  borderColor: string;
  comingSoon?: boolean;
  countKey?: 'accounts' | 'tasks';
}

const MODULES: Module[] = [
  {
    label: '账号管理',
    desc: '管理用于评论触达的抖音小号。',
    to: '/area/acquisition/accounts',
    Icon: KeyRound,
    color: 'text-orange-600',
    bgColor: 'bg-orange-50 dark:bg-orange-900/20',
    borderColor: 'border-orange-200 dark:border-orange-800',
    countKey: 'accounts',
  },
  {
    label: '采集任务',
    desc: '发起关键词采集，查看视频+评论明细。',
    to: '/area/acquisition/tasks',
    Icon: Target,
    color: 'text-emerald-600',
    bgColor: 'bg-emerald-50 dark:bg-emerald-900/20',
    borderColor: 'border-emerald-200 dark:border-emerald-800',
    countKey: 'tasks',
  },
  {
    label: '客户分析',
    desc: '对采集到的 leads 做画像与意向分析。',
    to: '/dashboard/acquisition-config',
    Icon: BarChart2,
    color: 'text-purple-600',
    bgColor: 'bg-purple-50 dark:bg-purple-900/20',
    borderColor: 'border-purple-200 dark:border-purple-800',
    comingSoon: true,
  },
  {
    label: '触达中心',
    desc: '把 leads 指派给小号，按频控排期私信触达。',
    to: '/dashboard/acquisition-config',
    Icon: Send,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50 dark:bg-blue-900/20',
    borderColor: 'border-blue-200 dark:border-blue-800',
    comingSoon: true,
  },
];

export default function AcquisitionHubPage() {
  const [counts, setCounts] = useState<{ accounts: number | null; tasks: number | null }>({ accounts: null, tasks: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [sr, tr] = await Promise.all([
          fetch('/api/agent/burner/sessions'),
          fetch('/api/acquisition/collect-tasks'),
        ]);
        const [sj, tj] = await Promise.all([sr.json(), tr.json()]);
        if (cancelled) return;
        setCounts({
          accounts: Array.isArray(sj?.data?.sessions) ? sj.data.sessions.length : null,
          tasks: typeof tj?.data?.total === 'number' ? tj.data.total : null,
        });
      } catch {
        // 计数拉取失败不影响卡片可用，静默降级为无数字
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="max-w-3xl mx-auto py-2">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-1">智能获客</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-8">对标找客、抓评论挖客、触达，把流量变成线索。</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {MODULES.map((m) => {
          const Icon = m.Icon;
          const count = m.countKey ? counts[m.countKey] : null;
          return (
            <Link
              key={m.label}
              to={m.to}
              className={`relative flex flex-col gap-3 p-5 rounded-xl border ${m.bgColor} ${m.borderColor} hover:shadow-sm transition-all`}
            >
              {m.comingSoon && (
                <span className="absolute top-3 right-3 text-xs font-medium text-gray-400 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full px-2 py-0.5">
                  即将上线
                </span>
              )}
              <div className="flex items-center gap-3">
                <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${m.color} bg-white dark:bg-slate-800 border ${m.borderColor} shadow-sm`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="font-medium text-gray-900 dark:text-white">{m.label}</div>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400">{m.desc}</p>
              {count !== null && (
                <div className={`text-2xl font-semibold ${m.color}`}>{count}</div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
