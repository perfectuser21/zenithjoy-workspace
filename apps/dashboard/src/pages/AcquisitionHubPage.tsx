import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, Target, BarChart2, Send, ChevronRight } from 'lucide-react';

interface HubCard {
  key: string;
  testId: string;
  label: string;
  desc: string;
  to: string;
  Icon: typeof KeyRound;
  color: string;
  bgColor: string;
  borderColor: string;
  countKey?: 'accounts' | 'tasks';
  placeholder?: string;
}

const CARDS: HubCard[] = [
  {
    key: 'accounts',
    testId: 'hub-card-accounts',
    label: '账号管理',
    desc: '管理已绑定的抖音小号，查看健康状态',
    to: '/area/acquisition/accounts',
    Icon: KeyRound,
    color: 'text-orange-400',
    bgColor: 'bg-orange-900/10',
    borderColor: 'border-orange-800/30',
    countKey: 'accounts',
  },
  {
    key: 'tasks',
    testId: 'hub-card-tasks',
    label: '采集任务',
    desc: '发起关键词采集，查看视频评论线索',
    to: '/area/acquisition/tasks',
    Icon: Target,
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-900/10',
    borderColor: 'border-emerald-800/30',
    countKey: 'tasks',
  },
  {
    key: 'analytics',
    testId: 'hub-card-analytics',
    label: '客户分析',
    desc: '线索画像分析与意向评级',
    to: '#',
    Icon: BarChart2,
    color: 'text-blue-400',
    bgColor: 'bg-blue-900/10',
    borderColor: 'border-blue-800/30',
    placeholder: '敬请期待',
  },
  {
    key: 'outreach',
    testId: 'hub-card-outreach',
    label: '触达中心',
    desc: '自动评论、私信与企微对接',
    to: '#',
    Icon: Send,
    color: 'text-purple-400',
    bgColor: 'bg-purple-900/10',
    borderColor: 'border-purple-800/30',
    placeholder: '敬请期待',
  },
];

export default function AcquisitionHubPage() {
  const [accountCount, setAccountCount] = useState<number | null>(null);
  const [taskCount, setTaskCount] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/agent/burner/sessions')
      .then((r) => r.json() as Promise<{ success: boolean; data?: { sessions?: unknown[] } }>)
      .then((b) => setAccountCount(b?.data?.sessions?.length ?? 0))
      .catch(() => setAccountCount(0));

    fetch('/api/acquisition/collect-tasks')
      .then((r) => r.json() as Promise<{ success: boolean; data?: { total?: number } }>)
      .then((b) => setTaskCount(b?.data?.total ?? 0))
      .catch(() => setTaskCount(0));
  }, []);

  const countFor = (key: 'accounts' | 'tasks') =>
    key === 'accounts' ? accountCount : taskCount;

  return (
    <div className="max-w-2xl mx-auto py-4">
      <h2 className="text-xl font-semibold text-white mb-1">智能获客</h2>
      <p className="text-sm text-gray-500 mb-8">选择功能模块开始工作</p>

      <div className="grid grid-cols-2 gap-4">
        {CARDS.map((card) => {
          const Icon = card.Icon;
          const isPlaceholder = !!card.placeholder;
          const count = card.countKey ? countFor(card.countKey) : null;

          const inner = (
            <div
              data-testid={card.testId}
              className={`flex flex-col gap-3 p-5 rounded-xl border ${card.bgColor} ${card.borderColor} ${
                isPlaceholder ? 'opacity-60 cursor-default' : 'hover:shadow-md cursor-pointer'
              } transition-all`}
            >
              <div className="flex items-center justify-between">
                <Icon className={`w-6 h-6 ${card.color}`} />
                {!isPlaceholder && <ChevronRight size={16} className="text-gray-500" />}
              </div>

              <div>
                <div className="font-semibold text-white text-sm">{card.label}</div>
                <div className="text-xs text-gray-500 mt-0.5">{card.desc}</div>
              </div>

              {card.countKey && !isPlaceholder && (
                <div className={`text-2xl font-bold ${card.color}`}>
                  <span data-testid={`hub-card-${card.key}-count`}>
                    {count === null ? '…' : count}
                  </span>
                </div>
              )}

              {isPlaceholder && (
                <div className="text-xs text-gray-600 italic">{card.placeholder}</div>
              )}
            </div>
          );

          return isPlaceholder ? (
            <div key={card.key}>{inner}</div>
          ) : (
            <Link key={card.key} to={card.to}>
              {inner}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
