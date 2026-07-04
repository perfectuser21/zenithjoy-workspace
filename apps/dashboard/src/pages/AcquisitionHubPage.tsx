import { Link } from 'react-router-dom';
import { KeyRound, Target, Users, Send, Settings } from 'lucide-react';

interface Module {
  label: string;
  desc: string;
  to: string;
  Icon: typeof KeyRound;
  color: string;
  bgColor: string;
  borderColor: string;
}

const MODULES: Module[] = [
  {
    label: '绑抖音小号',
    desc: '绑定用于评论触达的抖音小号，与主号 session 物理隔离。',
    to: '/area/acquisition/accounts',
    Icon: KeyRound,
    color: 'text-orange-600',
    bgColor: 'bg-orange-50 dark:bg-orange-900/20',
    borderColor: 'border-orange-200 dark:border-orange-800',
  },
  {
    label: '采集',
    desc: '发起关键词采集，抓取对标视频评论，挖掘潜在线索。',
    to: '/area/acquisition/tasks',
    Icon: Target,
    color: 'text-emerald-600',
    bgColor: 'bg-emerald-50 dark:bg-emerald-900/20',
    borderColor: 'border-emerald-200 dark:border-emerald-800',
  },
  {
    label: '看线索',
    desc: '查看采集到的 Leads，含评论内容、最新回复、负责人和评级。',
    to: '/area/acquisition/leads',
    Icon: Users,
    color: 'text-purple-600',
    bgColor: 'bg-purple-50 dark:bg-purple-900/20',
    borderColor: 'border-purple-200 dark:border-purple-800',
  },
  {
    label: '触达记录',
    desc: '查看私信触达历史：Lead 昵称、指派小号、排期时间和发送状态。',
    to: '/area/acquisition/outreach',
    Icon: Send,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50 dark:bg-blue-900/20',
    borderColor: 'border-blue-200 dark:border-blue-800',
  },
];

export default function AcquisitionHubPage() {
  return (
    <div className="max-w-3xl mx-auto py-2">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">智能获客</h2>
        <Link
          to="/dashboard/acquisition-config"
          className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
        >
          <Settings className="w-4 h-4" />
          设置
        </Link>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-8">对标找客、抓评论挖客、触达，把流量变成线索。</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {MODULES.map((m) => {
          const Icon = m.Icon;
          return (
            <Link
              key={m.label}
              to={m.to}
              className={`flex flex-col gap-3 p-5 rounded-xl border ${m.bgColor} ${m.borderColor} hover:shadow-sm transition-all`}
            >
              <div className="flex items-center gap-3">
                <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${m.color} bg-white dark:bg-slate-800 border ${m.borderColor} shadow-sm`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="font-medium text-gray-900 dark:text-white">{m.label}</div>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400">{m.desc}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
