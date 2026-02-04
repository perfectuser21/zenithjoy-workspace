/**
 * 场景 Tab 组件
 * 用于场景页面内的二级导航
 */

import { Link, useLocation } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';

export interface TabItem {
  path: string;
  label: string;
  icon?: LucideIcon;
}

interface ScenarioTabsProps {
  tabs: TabItem[];
  basePath: string;
}

export default function ScenarioTabs({ tabs, basePath }: ScenarioTabsProps) {
  const location = useLocation();

  // 判断当前激活的 tab
  const isActive = (tabPath: string) => {
    // 精确匹配或前缀匹配（用于子路由）
    return location.pathname === tabPath ||
           location.pathname.startsWith(tabPath + '/');
  };

  return (
    <div className="border-b border-slate-200 dark:border-slate-700 mb-6">
      <nav className="-mb-px flex gap-1 overflow-x-auto scrollbar-hide px-1" aria-label="Tabs">
        {tabs.map((tab) => {
          const active = isActive(tab.path);
          const Icon = tab.icon;

          return (
            <Link
              key={tab.path}
              to={tab.path}
              className={`
                group relative flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap
                transition-all duration-200
                ${active
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                }
              `}
            >
              {Icon && (
                <Icon className={`w-4 h-4 transition-colors ${
                  active
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300'
                }`} />
              )}
              {tab.label}

              {/* 下划线指示器 */}
              <span
                className={`
                  absolute bottom-0 left-0 right-0 h-0.5 rounded-full
                  transition-all duration-200
                  ${active
                    ? 'bg-blue-600 dark:bg-blue-400'
                    : 'bg-transparent group-hover:bg-slate-300 dark:group-hover:bg-slate-600'
                  }
                `}
              />
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
