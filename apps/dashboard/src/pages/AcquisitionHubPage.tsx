/**
 * 智能获客 Hub — Step-by-Step 向导入口
 *
 * 把原来 6 个平级磁贴改成 4 步有序引导，用户一眼知道先干什么后干什么。
 */
import { Link } from 'react-router-dom';
import {
  Briefcase, KeyRound, Target, Users,
  MonitorCheck, ChevronRight, ArrowRight,
} from 'lucide-react';

interface Step {
  num: number;
  label: string;
  desc: string;
  cta: string;
  to: string;
  Icon: typeof Briefcase;
  color: string;
  bgColor: string;
  borderColor: string;
}

const STEPS: Step[] = [
  {
    num: 1,
    label: '填写公司画像',
    desc: '告诉 AI 你卖什么、卖给谁——这是推荐关键词的原料。',
    cta: '填写公司信息',
    to: '/company-profile',
    Icon: Briefcase,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50 dark:bg-blue-900/20',
    borderColor: 'border-blue-200 dark:border-blue-800',
  },
  {
    num: 2,
    label: '绑定采集账号',
    desc: '绑定抖音小号（用来评论触达）和飞书（自动存线索表）。',
    cta: '绑定小号',
    to: '/dashboard/douyin-burner-bind',
    Icon: KeyRound,
    color: 'text-orange-600',
    bgColor: 'bg-orange-50 dark:bg-orange-900/20',
    borderColor: 'border-orange-200 dark:border-orange-800',
  },
  {
    num: 3,
    label: '推荐词采集',
    desc: 'AI 基于公司画像生成推荐关键词，一键发起评论区挖客。',
    cta: '开始采集',
    to: '/dashboard/acquisition-config',
    Icon: Target,
    color: 'text-emerald-600',
    bgColor: 'bg-emerald-50 dark:bg-emerald-900/20',
    borderColor: 'border-emerald-200 dark:border-emerald-800',
  },
  {
    num: 4,
    label: '查看获客线索',
    desc: '查看抓到的客户评论、意向评级和触达记录。',
    cta: '查看 Leads',
    to: '/dashboard/leads',
    Icon: Users,
    color: 'text-purple-600',
    bgColor: 'bg-purple-50 dark:bg-purple-900/20',
    borderColor: 'border-purple-200 dark:border-purple-800',
  },
];

const ADVANCED = [
  { label: '机器管理', desc: '管理客户机器与抖音号', to: '/dashboard/machines', Icon: MonitorCheck },
  { label: '智能对标', desc: '找对标账号与爆款视频', to: '/competitor-research', Icon: Target },
  { label: '飞书绑定', desc: '绑定飞书企业，自动建表', to: '/dashboard/feishu-bind', Icon: KeyRound },
];

export default function AcquisitionHubPage() {
  return (
    <div className="max-w-2xl mx-auto py-2">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-1">智能获客</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-8">按顺序完成 4 步，开始自动从评论区挖客户。</p>

      <div className="space-y-3">
        {STEPS.map((step, idx) => {
          const Icon = step.Icon;
          const isLast = idx === STEPS.length - 1;
          return (
            <div key={step.num} className="relative">
              {!isLast && (
                <div className="absolute left-6 top-full w-0.5 h-3 bg-gray-200 dark:bg-slate-700 z-10" />
              )}
              <Link
                to={step.to}
                className={`flex items-center gap-4 p-4 rounded-xl border ${step.bgColor} ${step.borderColor} hover:shadow-sm transition-all group`}
              >
                <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${step.color} bg-white dark:bg-slate-800 border ${step.borderColor} shadow-sm`}>
                  {step.num}
                </div>
                <Icon className={`flex-shrink-0 w-5 h-5 ${step.color}`} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-900 dark:text-white text-sm">{step.label}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{step.desc}</div>
                </div>
                <span className={`flex-shrink-0 text-xs font-medium ${step.color} flex items-center gap-1 group-hover:gap-2 transition-all`}>
                  {step.cta} <ChevronRight className="w-3 h-3" />
                </span>
              </Link>
            </div>
          );
        })}
      </div>

      <div className="mt-8 mb-4 flex items-center gap-3">
        <div className="flex-1 h-px bg-gray-200 dark:bg-slate-700" />
        <span className="text-xs text-gray-400 dark:text-gray-500">高级工具</span>
        <div className="flex-1 h-px bg-gray-200 dark:bg-slate-700" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        {ADVANCED.map((a) => {
          const Icon = a.Icon;
          return (
            <Link
              key={a.to}
              to={a.to}
              className="flex flex-col items-center gap-2 p-3 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:shadow-sm transition-all text-center"
            >
              <Icon className="w-5 h-5 text-gray-400" />
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{a.label}</span>
              <span className="text-xs text-gray-400 dark:text-gray-500 leading-tight">{a.desc}</span>
            </Link>
          );
        })}
      </div>

      <div className="mt-6 flex justify-end">
        <Link
          to="/dashboard/acquisition-config"
          className="text-xs text-emerald-600 hover:text-emerald-700 flex items-center gap-1"
        >
          已配置好，直接去采集 <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
    </div>
  );
}
