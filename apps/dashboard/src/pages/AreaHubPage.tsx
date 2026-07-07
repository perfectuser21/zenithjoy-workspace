/**
 * AreaHubPage — 业务区总览页（下钻入口）
 *
 * 设计（2026-06-23 老板拍板）：左边栏只放"区"（人话名、不暴露 Line、无 emoji）；
 * 点进区先看到这个总览页（卡片入口 + 简述），再从卡片下钻进具体子页。
 * 一个组件 + 一份配置驱动所有区，路由 /area/<key> 复用本组件。
 */
import { Link, useLocation } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  Send, Music2, Folder, Database, Factory, Sparkles,
  Target, KeyRound,
  Scissors, Video, Building2, MonitorCheck, Activity, ShieldCheck,
  Smartphone,
} from 'lucide-react';

interface HubCard {
  label: string;
  desc: string;
  to: string;
  Icon: LucideIcon;
  color: string;
}
interface AreaHub {
  title: string;
  subtitle: string;
  cards: HubCard[];
}

// 各区配置：title = 客户看到的人话名（无 Line）；cards = 下钻入口（复用现有子页路由）
export const AREA_HUBS: Record<string, AreaHub> = {
  publish: {
    title: '智能发布',
    subtitle: '一处管好多平台内容发布：绑号、出内容、发布、看数据。',
    cards: [
      { label: '一键发布', desc: '把内容发到已绑定的平台', to: '/dashboard/publish', Icon: Send, color: 'text-blue-500' },
      { label: '抖音绑定', desc: '扫码绑定抖音主号', to: '/dashboard/platforms/douyin', Icon: Music2, color: 'text-pink-500' },
      { label: '文件夹绑定', desc: '绑定本地素材文件夹自动发布', to: '/dashboard/folder', Icon: Folder, color: 'text-amber-500' },
      { label: '作品管理', desc: '查看与管理已生成的作品', to: '/works', Icon: Database, color: 'text-indigo-500' },
      { label: '平台数据', desc: '各平台发布数据与表现', to: '/platform-data', Icon: Database, color: 'text-cyan-500' },
      { label: '内容工厂', desc: 'AI 批量生成内容', to: '/content-factory', Icon: Factory, color: 'text-purple-500' },
      { label: 'AI 视频', desc: 'AI 生成视频内容', to: '/ai-video', Icon: Sparkles, color: 'text-fuchsia-500' },
    ],
  },
  acquisition: {
    title: '智能获客',
    subtitle: '对标找客、抓评论挖客、触达，把流量变成线索。',
    cards: [
      { label: '获客 Leads', desc: '收集到的客户线索', to: '/dashboard/leads', Icon: Target, color: 'text-green-500' },
      { label: '分析+指派', desc: '调获客参数、跑分析把 Leads 指派给小号排期、盯 Cookie 健康', to: '/dashboard/acquisition-config', Icon: Activity, color: 'text-emerald-500' },
      { label: '机器管理', desc: '客户机器与抖音号管理（主/副机、添加号）', to: '/dashboard/machines', Icon: MonitorCheck, color: 'text-sky-500' },
      { label: '下载安卓客户端', desc: '手机装 Agent，扫码自动绑定，手机端采集', to: '/dashboard/android', Icon: Smartphone, color: 'text-lime-500' },
      { label: '账号管理', desc: '绑定并查看用于触达的小号与绑定机器', to: '/area/acquisition/accounts', Icon: KeyRound, color: 'text-orange-500' },
      { label: '智能对标', desc: '找对标账号与爆款视频', to: '/competitor-research', Icon: Target, color: 'text-teal-500' },
      { label: '飞书绑定', desc: '绑定飞书企业，自动建表', to: '/dashboard/feishu-bind', Icon: KeyRound, color: 'text-blue-500' },
    ],
  },
  // 私域客服区已改「以号为中心」(IA 重设计刀2)：入口走 CsAreaEntryPage（总览 + 单号工作台 5 Tab），
  // 不再用本 hub 的 5 张平级卡。旧子页路由仍保留在 additionalRoutes（深链不死链）。
  video: {
    title: '视频剪辑',
    subtitle: '本地 AI 视频流水线：采集、剪辑、出片。',
    cards: [
      { label: '本地视频处理', desc: '上传视频走本地剪辑流水线', to: '/local-video', Icon: Scissors, color: 'text-rose-500' },
      { label: '内容采集', desc: '从平台采集视频素材', to: '/clips', Icon: Scissors, color: 'text-amber-500' },
    ],
  },
  remake: {
    title: '爆款翻拍',
    subtitle: '上传视频 + 模特图 + 产品图，AI 翻拍出新爆款。',
    cards: [
      { label: 'AI 视频翻拍', desc: '9 节点画布翻拍流水线', to: '/video-remake', Icon: Video, color: 'text-violet-500' },
    ],
  },
  settings: {
    title: '设置',
    subtitle: '账号级设置：License 与授权额度。',
    cards: [
      { label: 'License', desc: '查看你的授权与额度', to: '/license', Icon: KeyRound, color: 'text-amber-500' },
    ],
  },
  admin: {
    title: '管理后台',
    subtitle: '运营/管理员专用：管客户、盯健康、发 License。',
    cards: [
      { label: '客户管理', desc: '公司 / 成员 / 客服-PC 绑定', to: '/admin/customers', Icon: Building2, color: 'text-blue-500' },
      { label: 'Session 健康监控', desc: '各平台登录态矩阵', to: '/operator', Icon: MonitorCheck, color: 'text-cyan-500' },
      { label: '模块健康', desc: '客户机 × Line 模块状态', to: '/module-health', Icon: Activity, color: 'text-green-500' },
      { label: 'License 管理', desc: '发放与管理 License', to: '/admin/license', Icon: ShieldCheck, color: 'text-purple-500' },
    ],
  },
};

export default function AreaHubPage() {
  const { pathname } = useLocation();
  const key = pathname.replace(/\/+$/, '').split('/').pop() ?? '';
  const hub = AREA_HUBS[key];

  if (!hub) {
    return (
      <div className="max-w-5xl mx-auto">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">未知区域</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">没有找到「{key}」对应的总览页。</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      <h2 className="text-xl font-semibold mb-1 text-gray-900 dark:text-white">{hub.title}</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">{hub.subtitle}</p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {hub.cards.map((c) => {
          const Icon = c.Icon;
          return (
            <Link
              key={c.to}
              to={c.to}
              className="block bg-white dark:bg-slate-800 rounded-lg shadow p-6 hover:shadow-md transition-shadow border border-slate-200 dark:border-slate-700"
            >
              <Icon className={`w-10 h-10 mb-3 ${c.color}`} />
              <h3 className="font-medium text-gray-900 dark:text-white mb-1">{c.label}</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">{c.desc}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
