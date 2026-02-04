/**
 * 动态侧边栏组件 - 配置驱动 UI
 *
 * 根据配置文件动态生成菜单，无需手动添加菜单项
 */

import { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LogOut, PanelLeftClose, PanelLeft, Circle } from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useInstance } from '../contexts/InstanceContext';
import {
  getAutopilotNavGroups,
  filterNavGroups,
  type NavGroup,
} from '../config/navigation.config';

// 将 Core 的 NavGroup 格式转换为带 LucideIcon 的格式
function convertCoreNavGroups(
  coreNavGroups: Array<{ title: string; items: Array<{ path: string; icon: string; label: string; featureKey: string; component?: string }> }>
): NavGroup[] {
  return coreNavGroups.map(group => ({
    title: group.title,
    items: group.items.map(item => ({
      path: item.path,
      icon: (LucideIcons as any)[item.icon] || Circle,
      label: item.label,
      featureKey: item.featureKey,
      component: item.component,
    })),
  }));
}

interface DynamicSidebarProps {
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onLogout: () => void;
}

export default function DynamicSidebar({
  collapsed,
  onCollapsedChange,
  onLogout,
}: DynamicSidebarProps) {
  const location = useLocation();
  const { user, isSuperAdmin } = useAuth();
  const { config, isCore, isFeatureEnabled, coreConfig } = useInstance();

  // 获取并过滤导航配置
  const baseNavGroups = useMemo(() => {
    if (isCore && coreConfig) {
      return convertCoreNavGroups(coreConfig.navGroups);
    }
    return getAutopilotNavGroups();
  }, [isCore, coreConfig]);
  const navGroups = filterNavGroups(baseNavGroups, isFeatureEnabled, isSuperAdmin);

  return (
    <aside
      className={`fixed inset-y-0 left-0 ${
        collapsed ? 'w-16' : 'w-64'
      } flex flex-col shadow-2xl transition-all duration-300 z-20`}
      style={{ background: config?.theme.sidebarGradient || 'var(--sidebar-gradient)' }}
    >
      {/* Logo 区域 */}
      <div
        className={`h-16 flex items-center ${
          collapsed ? 'justify-center' : 'justify-start'
        } px-4 border-b border-white/10`}
      >
        {collapsed ? (
          <div className="relative w-10 h-10 flex items-center justify-center">
            <div className="absolute inset-0 rounded-full bg-white/10 blur-sm" />
            <div className="relative w-9 h-9 rounded-full bg-gradient-to-br from-white/20 to-white/5 border border-white/30 flex items-center justify-center backdrop-blur-sm">
              <span
                className="text-white font-semibold text-lg"
                style={{ fontFamily: 'system-ui', letterSpacing: '-0.02em' }}
              >
                {config?.theme.logoCollapsed || 'Z'}
              </span>
            </div>
          </div>
        ) : (
          <img
            src={config?.theme.logo || '/logo-white.png'}
            alt={config?.name || '运营中台'}
            className="h-9 drop-shadow-lg"
          />
        )}
      </div>

      {/* 收缩按钮 */}
      <button
        onClick={() => onCollapsedChange(!collapsed)}
        className="absolute -right-3 top-20 w-6 h-6 rounded-full flex items-center justify-center text-sky-200 hover:text-white transition-all shadow-lg border border-sky-400/30 bg-blue-900 hover:bg-blue-800"
        title={collapsed ? '展开侧边栏' : '收起侧边栏'}
      >
        {collapsed ? (
          <PanelLeft className="w-3 h-3" />
        ) : (
          <PanelLeftClose className="w-3 h-3" />
        )}
      </button>

      {/* 导航菜单 */}
      <nav className={`flex-1 ${collapsed ? 'px-2' : 'px-3'} py-4 overflow-y-auto`}>
        {navGroups.map((group, groupIndex) => (
          <div key={group.title} className={groupIndex > 0 ? 'mt-6' : ''}>
            {!collapsed && (
              <p className="px-3 mb-2 text-[10px] font-semibold text-sky-400/60 uppercase tracking-wider">
                {group.title}
              </p>
            )}
            {collapsed && groupIndex > 0 && (
              <div className="mx-2 mb-2 border-t border-white/5" />
            )}
            <div className="space-y-1">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    title={collapsed ? item.label : undefined}
                    className={`group relative flex items-center ${
                      collapsed ? 'justify-center px-2' : 'px-3'
                    } py-2.5 text-sm font-medium rounded-xl transition-all duration-200 ${
                      isActive
                        ? 'bg-sky-500/20 text-white'
                        : 'text-blue-200/70 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    {isActive && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r-full bg-sky-400" />
                    )}
                    <Icon
                      className={`w-5 h-5 ${
                        collapsed ? '' : 'mr-3'
                      } transition-transform duration-200 ${
                        isActive
                          ? 'text-sky-300'
                          : 'text-blue-300/60 group-hover:text-white group-hover:scale-110'
                      }`}
                    />
                    {!collapsed && item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* 底部用户信息 */}
      <div className={`border-t border-white/5 ${collapsed ? 'p-2' : 'p-4'}`}>
        {collapsed ? (
          <div className="space-y-2">
            <div className="relative mx-auto w-10 h-10">
              {user?.avatar ? (
                <img
                  src={user.avatar}
                  alt={user.name}
                  className="w-10 h-10 rounded-full ring-2 ring-blue-500 ring-offset-2 ring-offset-slate-900"
                />
              ) : (
                <div className="w-10 h-10 rounded-full flex items-center justify-center bg-gradient-to-br from-blue-500 to-blue-600">
                  <span className="text-white font-semibold text-sm">
                    {user?.name?.charAt(0) || 'U'}
                  </span>
                </div>
              )}
              <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 border-2 border-slate-900 rounded-full" />
            </div>
            <button
              onClick={onLogout}
              title="退出登录"
              className="w-full flex items-center justify-center p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="p-3 rounded-xl bg-white/5 backdrop-blur">
            <div className="flex items-center gap-3">
              <div className="relative">
                {user?.avatar ? (
                  <img
                    src={user.avatar}
                    alt={user.name}
                    className="w-10 h-10 rounded-full ring-2 ring-blue-500 ring-offset-2 ring-offset-slate-900"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full flex items-center justify-center shadow-lg bg-gradient-to-br from-blue-500 to-blue-600">
                    <span className="text-white font-semibold text-sm">
                      {user?.name?.charAt(0) || 'U'}
                    </span>
                  </div>
                )}
                <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 border-2 border-slate-800 rounded-full" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">
                  {user?.name || '用户'}
                  {isSuperAdmin && (
                    <span className="ml-2 px-1.5 py-0.5 text-[10px] bg-amber-500 text-white rounded">
                      超级管理员
                    </span>
                  )}
                </p>
                <p className="text-xs text-slate-500 truncate">
                  {user?.department || '在线'}
                </p>
              </div>
              <button
                onClick={onLogout}
                title="退出登录"
                className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
