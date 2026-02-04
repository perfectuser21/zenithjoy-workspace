/**
 * 新媒体运营场景页
 *
 * 场景入口页面，包含三个 Tab：
 * - 内容：内容管理、数据采集
 * - 发布：发布任务、执行记录、平台状态
 * - 数据：发布统计、数据分析
 */

import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useLocation, Link } from 'react-router-dom';
import { FileText, Send, BarChart3, Database, Activity, Radio, TrendingUp, PieChart, Table, Eye } from 'lucide-react';
import ScenarioTabs, { type TabItem } from '../components/ScenarioTabs';

// 懒加载页面组件
const ContentPublish = lazy(() => import('./ContentPublish'));
const ScrapingPage = lazy(() => import('./ScrapingPage'));
const ExecutionStatus = lazy(() => import('./ExecutionStatus'));
const PublishStats = lazy(() => import('./PublishStats'));
const ContentData = lazy(() => import('./ContentData'));
const RawDataTable = lazy(() => import('./RawDataTable'));
const RawScrapingData = lazy(() => import('./RawScrapingData'));

// 加载状态
function LoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-[300px]">
      <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

// 主 Tab 配置
const MAIN_TABS: TabItem[] = [
  { path: '/media/content', label: '内容', icon: FileText },
  { path: '/media/publish', label: '发布', icon: Send },
  { path: '/media/data', label: '数据', icon: BarChart3 },
];

// 内容子 Tab 配置
const CONTENT_SUB_TABS: TabItem[] = [
  { path: '/media/content', label: '内容管理', icon: FileText },
  { path: '/media/content/scraping', label: '数据采集', icon: Database },
];

// 发布子 Tab 配置
const PUBLISH_SUB_TABS: TabItem[] = [
  { path: '/media/publish', label: '执行记录', icon: Activity },
  { path: '/media/publish/platforms', label: '平台状态', icon: Radio },
];

// 数据子 Tab 配置
const DATA_SUB_TABS: TabItem[] = [
  { path: '/media/data/scraping', label: '抓取原始', icon: Eye },
  { path: '/media/data/raw', label: '内容数据', icon: Table },
  { path: '/media/data/analytics', label: '数据分析', icon: PieChart },
  { path: '/media/data', label: '发布统计', icon: TrendingUp },
];

// 子 Tab 导航组件
function SubTabs({ tabs }: { tabs: TabItem[] }) {
  const location = useLocation();

  const isActive = (path: string) => {
    return location.pathname === path;
  };

  return (
    <div className="flex flex-wrap gap-2 mb-6">
      {tabs.map((tab) => {
        const active = isActive(tab.path);
        const Icon = tab.icon;

        return (
          <Link
            key={tab.path}
            to={tab.path}
            className={`
              inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
              transition-all duration-200
              ${active
                ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 shadow-sm'
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700'
              }
            `}
          >
            {Icon && <Icon className="w-4 h-4" />}
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}

// 内容 Tab 页面
function ContentTab() {
  const location = useLocation();
  const isScrapingPage = location.pathname === '/media/content/scraping';

  return (
    <>
      <SubTabs tabs={CONTENT_SUB_TABS} />
      <Suspense fallback={<LoadingFallback />}>
        {isScrapingPage ? <ScrapingPage /> : <ContentPublish />}
      </Suspense>
    </>
  );
}

// 发布 Tab 页面
function PublishTab() {
  const location = useLocation();
  const isPlatformsPage = location.pathname === '/media/publish/platforms';

  return (
    <>
      <SubTabs tabs={PUBLISH_SUB_TABS} />
      <Suspense fallback={<LoadingFallback />}>
        {isPlatformsPage ? <PublishStats /> : <ExecutionStatus />}
      </Suspense>
    </>
  );
}

// 数据 Tab 页面
function DataTab() {
  const location = useLocation();
  const isScrapingPage = location.pathname === '/media/data/scraping';
  const isRawPage = location.pathname === '/media/data/raw';
  const isAnalyticsPage = location.pathname === '/media/data/analytics';

  return (
    <>
      <SubTabs tabs={DATA_SUB_TABS} />
      <Suspense fallback={<LoadingFallback />}>
        {isScrapingPage ? <RawScrapingData /> : isRawPage ? <RawDataTable /> : isAnalyticsPage ? <ContentData /> : <PublishStats />}
      </Suspense>
    </>
  );
}

export default function MediaScenarioPage() {
  return (
    <div className="px-4 sm:px-0 pb-8">
      {/* 页面标题 */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-800 dark:text-white">新媒体运营</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-1">管理内容、发布任务和数据分析</p>
      </div>

      {/* 主 Tab 导航 */}
      <ScenarioTabs tabs={MAIN_TABS} basePath="/media" />

      {/* 子路由内容 */}
      <Routes>
        {/* 默认重定向到内容 Tab */}
        <Route index element={<Navigate to="/media/content" replace />} />

        {/* 内容 Tab */}
        <Route path="content" element={<ContentTab />} />
        <Route path="content/scraping" element={<ContentTab />} />

        {/* 发布 Tab */}
        <Route path="publish" element={<PublishTab />} />
        <Route path="publish/platforms" element={<PublishTab />} />
        <Route path="publish/history" element={<Navigate to="/media/publish" replace />} />

        {/* 数据 Tab */}
        <Route path="data" element={<DataTab />} />
        <Route path="data/scraping" element={<DataTab />} />
        <Route path="data/raw" element={<DataTab />} />
        <Route path="data/analytics" element={<DataTab />} />

        {/* 兜底：未匹配的子路由重定向到内容 */}
        <Route path="*" element={<Navigate to="/media/content" replace />} />
      </Routes>
    </div>
  );
}
