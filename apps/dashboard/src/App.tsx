/**
 * App.tsx - 配置驱动架构
 *
 * 菜单和路由都从 config/navigation.config.ts 读取
 * 添加新页面只需修改配置文件，无需改动这里
 */

import { useState, useMemo } from 'react';
import { Route, Link, useLocation } from 'react-router-dom';
import { LogOut, PanelLeftClose, PanelLeft, Sun, Moon, Monitor } from 'lucide-react';
// 配置驱动
import { getAutopilotNavGroups, filterNavGroups, additionalRoutes } from './config/navigation.config';
import DynamicRouter from './components/DynamicRouter';
// Context
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';
import { InstanceProvider, useInstance } from './contexts/InstanceContext';
// 只有登录页需要静态导入
import FeishuLogin from './pages/FeishuLogin';
import './App.css';

function AppContent() {
  const location = useLocation();
  const { user, logout, isAuthenticated, isSuperAdmin, authLoading } = useAuth();
  const { theme, setTheme } = useTheme();
  const { config, loading: instanceLoading, isFeatureEnabled } = useInstance();
  const [collapsed, setCollapsed] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const handleLogout = () => {
    setShowLogoutConfirm(true);
  };

  const confirmLogout = () => {
    setShowLogoutConfirm(false);
    logout();
  };

  // 主题切换
  const cycleTheme = () => {
    const themes: Array<'light' | 'dark' | 'auto'> = ['light', 'dark', 'auto'];
    const currentIndex = themes.indexOf(theme);
    const nextIndex = (currentIndex + 1) % themes.length;
    setTheme(themes[nextIndex]);
  };

  // ============ 配置驱动菜单 ============
  const baseNavGroups = useMemo(() => {
    return getAutopilotNavGroups();
  }, []);
  const navGroups = filterNavGroups(baseNavGroups, isFeatureEnabled, isSuperAdmin);

  // 兼容旧代码
  const navItems = navGroups.flatMap(g => g.items);

  // 检查当前路由是否允许未认证访问
  const currentRouteAllowsUnauthenticated = additionalRoutes.some(
    route => location.pathname === route.path && route.requireAuth === false
  );

  // 配置或认证加载中时显示加载状态
  if (instanceLoading || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50/30 dark:from-slate-900 dark:to-slate-800">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500 dark:text-gray-400">加载中...</p>
        </div>
      </div>
    );
  }

  // 如果未登录且不在登录页，且当前路由需要认证，显示登录页
  if (!isAuthenticated && !location.pathname.startsWith('/login') && !currentRouteAllowsUnauthenticated) {
    return <FeishuLogin />;
  }

  return (
    <div className="h-screen overflow-hidden flex flex-col transition-colors bg-gradient-to-br from-slate-50 to-blue-50/30 dark:from-slate-900 dark:to-slate-800">
      {/* 退出登录确认框 - 毛玻璃效果 */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* 背景遮罩 - 模糊效果 */}
          <div
            className="absolute inset-0 bg-gradient-to-br from-slate-900/60 via-slate-800/50 to-slate-900/60 backdrop-blur-sm"
            onClick={() => setShowLogoutConfirm(false)}
          />
          {/* 弹窗主体 */}
          <div className="relative bg-white/95 dark:bg-slate-800/95 backdrop-blur-xl rounded-3xl shadow-2xl p-8 max-w-sm w-full mx-4 border border-white/20 dark:border-slate-700/50">
            {/* 顶部图标 */}
            <div className="flex justify-center mb-6">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-red-100 to-orange-100 dark:from-red-900/30 dark:to-orange-900/30 flex items-center justify-center">
                <LogOut className="w-8 h-8 text-red-500" />
              </div>
            </div>
            {/* 标题 */}
            <h3 className="text-xl font-bold text-center text-gray-900 dark:text-white mb-2">
              确认退出登录？
            </h3>
            <p className="text-center text-gray-500 dark:text-gray-400 mb-8">
              退出后需要重新登录才能访问系统
            </p>
            {/* 按钮组 */}
            <div className="flex gap-4">
              <button
                onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 px-5 py-3 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-300 rounded-2xl font-medium hover:bg-gray-200 dark:hover:bg-slate-600 transition-all"
              >
                取消
              </button>
              <button
                onClick={confirmLogout}
                className="flex-1 px-5 py-3 bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-600 hover:to-orange-600 text-white rounded-2xl font-medium transition-all shadow-lg shadow-red-500/25 hover:shadow-red-500/40 flex items-center justify-center gap-2"
              >
                <LogOut className="w-4 h-4" />
                退出
              </button>
            </div>
          </div>
        </div>
      )}

      {isAuthenticated && (
        <>
          {/* 左侧导航栏 - 使用配置的渐变色 */}
          <aside className={`fixed inset-y-0 left-0 ${collapsed ? 'w-16' : 'w-64'} flex flex-col shadow-2xl transition-all duration-300 z-20`} style={{ background: config?.theme.sidebarGradient || 'var(--sidebar-gradient)' }}>
            {/* Logo 区域 - 从配置读取 */}
            <div className={`h-16 flex items-center ${collapsed ? 'justify-center' : 'justify-start'} px-4 border-b border-white/10`}>
              {collapsed ? (
                <div className="relative w-10 h-10 flex items-center justify-center">
                  {/* 外圈光晕 */}
                  <div className="absolute inset-0 rounded-full bg-white/10 blur-sm" />
                  {/* 主圆 */}
                  <div className="relative w-9 h-9 rounded-full bg-gradient-to-br from-white/20 to-white/5 border border-white/30 flex items-center justify-center backdrop-blur-sm">
                    <span className="text-white font-semibold text-lg" style={{ fontFamily: 'system-ui', letterSpacing: '-0.02em' }}>
                      {config?.theme.logoCollapsed || 'Z'}
                    </span>
                  </div>
                </div>
              ) : (
                <img src={config?.theme.logo || '/logo-white.png'} alt={config?.name || '运营中台'} className="h-9 drop-shadow-lg" />
              )}
            </div>

            {/* 收缩按钮 */}
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="absolute -right-3 top-20 w-6 h-6 rounded-full flex items-center justify-center transition-all shadow-lg text-sky-200 hover:text-white border border-sky-400/30 bg-blue-900 hover:bg-blue-800"
              title={collapsed ? '展开侧边栏' : '收起侧边栏'}
            >
              {collapsed ? <PanelLeft className="w-3 h-3" /> : <PanelLeftClose className="w-3 h-3" />}
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
                    {group.items.filter(item => item && item.icon).map((item) => {
                      const Icon = item.icon;
                      const isActive = location.pathname === item.path || location.pathname.startsWith(item.path + '/');
                      return (
                        <Link
                          key={item.path}
                          to={item.path}
                          title={collapsed ? item.label : undefined}
                          className={`group relative flex items-center ${collapsed ? 'justify-center px-2' : 'px-3'} py-2.5 text-sm font-medium rounded-xl transition-all duration-200 ${
                            isActive
                              ? 'bg-sky-500/20 text-white'
                              : 'text-blue-200/70 hover:bg-white/5 hover:text-white'
                          }`}
                        >
                          {isActive && (
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r-full bg-sky-400" />
                          )}
                          <Icon className={`w-5 h-5 ${collapsed ? '' : 'mr-3'} transition-transform duration-200 ${
                            isActive
                              ? 'text-sky-300'
                              : 'text-blue-300/60 group-hover:text-white group-hover:scale-110'
                          }`} />
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
                      <img src={user.avatar} alt={user.name} className="w-10 h-10 rounded-full ring-2 ring-blue-500 ring-offset-2 ring-offset-slate-900" />
                    ) : (
                      <div className="w-10 h-10 rounded-full flex items-center justify-center bg-gradient-to-br from-blue-500 to-blue-600">
                        <span className="text-white font-semibold text-sm">{user?.name?.charAt(0) || 'U'}</span>
                      </div>
                    )}
                    <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 border-2 border-slate-900 rounded-full" />
                  </div>
                  <button
                    onClick={handleLogout}
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
                        <img src={user.avatar} alt={user.name} className="w-10 h-10 rounded-full ring-2 ring-blue-500 ring-offset-2 ring-offset-slate-900" />
                      ) : (
                        <div className="w-10 h-10 rounded-full flex items-center justify-center shadow-lg bg-gradient-to-br from-blue-500 to-blue-600">
                          <span className="text-white font-semibold text-sm">{user?.name?.charAt(0) || 'U'}</span>
                        </div>
                      )}
                      <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 border-2 border-slate-800 rounded-full" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">
                        {user?.name || '用户'}
                        {isSuperAdmin && <span className="ml-2 px-1.5 py-0.5 text-[10px] bg-amber-500 text-white rounded">超级管理员</span>}
                      </p>
                      <p className="text-xs text-slate-500 truncate">{user?.department || '在线'}</p>
                    </div>
                    <button
                      onClick={handleLogout}
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

          {/* 顶部栏 - Canvas 页面使用深色主题 */}
          <div className={`fixed top-0 ${collapsed ? 'left-16' : 'left-64'} right-0 h-16 ${
            location.pathname === '/canvas'
              ? 'bg-slate-900/90 border-indigo-500/20'
              : 'bg-white/90 dark:bg-slate-800/90 border-slate-200/80 dark:border-slate-700/50'
          } backdrop-blur-xl border-b flex items-center justify-between px-8 z-10 shadow-sm transition-all duration-300`}>
            {/* 左侧：面包屑或页面标题 */}
            <div>
              <h2 className={`text-lg font-semibold ${
                location.pathname === '/canvas' ? 'text-white' : 'text-gray-900 dark:text-white'
              }`}>
                {navItems.find(item => item.path === location.pathname)?.label || '工作台'}
              </h2>
            </div>

            {/* 右侧：主题切换 */}
            <div className="flex items-center">
              <button
                onClick={cycleTheme}
                className={`relative p-2 rounded-lg transition-colors ${
                  location.pathname === '/canvas'
                    ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'
                    : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-700'
                }`}
                title={theme === 'auto' ? '自动模式' : theme === 'dark' ? '深色模式' : '浅色模式'}
              >
                {theme === 'auto' ? (
                  <Monitor className="w-5 h-5" />
                ) : theme === 'dark' ? (
                  <Moon className="w-5 h-5" />
                ) : (
                  <Sun className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>
        </>
      )}

      {/* 主内容区域 - 配置驱动路由 */}
      <main className={isAuthenticated ? `flex-1 overflow-auto ${collapsed ? 'ml-16' : 'ml-64'} pt-16 transition-all duration-300` : "flex-1 overflow-auto"}>
        <div key={location.pathname} className={isAuthenticated ? "p-8 page-fade-in" : ""}>
          <DynamicRouter>
            {/* 登录页面（静态路由） */}
            <Route path="/login" element={<FeishuLogin />} />
          </DynamicRouter>
        </div>
      </main>

    </div>
  );
}

function App() {
  return (
    <ThemeProvider>
      <InstanceProvider>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </InstanceProvider>
    </ThemeProvider>
  );
}

export default App;
