/**
 * 动态路由组件 - 配置驱动 UI
 *
 * 根据配置文件动态生成路由，无需手动添加 Route
 */

import type { ComponentType} from 'react';
import { Suspense, lazy, useMemo } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useInstance } from '../contexts/InstanceContext';
import PrivateRoute from './PrivateRoute';
import {
  getAutopilotNavGroups,
  additionalRoutes,
  autopilotPageComponents,
  type RouteConfig,
  type NavGroup,
} from '../config/navigation.config';
import * as LucideIcons from 'lucide-react';

// 加载状态组件
function LoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-[200px]">
      <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

// 懒加载组件缓存
const componentCache: Record<string, ComponentType> = {};

function getLazyComponent(
  name: string,
  corePageComponents?: Record<string, () => Promise<{ default: any }>>
): ComponentType | null {
  // 检查缓存
  if (componentCache[name]) {
    return componentCache[name];
  }

  // 先从 Autopilot 组件查找
  let loader = autopilotPageComponents[name];

  // 如果没有，从 Core 组件查找
  if (!loader && corePageComponents) {
    loader = corePageComponents[name];
  }

  if (!loader) {
    console.warn(`Page component not found: ${name}`);
    return null;
  }

  const LazyComponent = lazy(loader);
  componentCache[name] = LazyComponent;
  return LazyComponent;
}

// 将 Core 的 NavGroup 格式转换为 Autopilot 的 NavGroup 格式
function convertCoreNavGroups(
  coreNavGroups: Array<{ title: string; items: Array<{ path: string; icon: string; label: string; featureKey: string; component?: string }> }>
): NavGroup[] {
  return coreNavGroups.map(group => ({
    title: group.title,
    items: group.items.map(item => ({
      path: item.path,
      icon: (LucideIcons as any)[item.icon] || LucideIcons.Circle,
      label: item.label,
      featureKey: item.featureKey,
      component: item.component,
    })),
  }));
}

// 占位页面组件
function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="text-center py-12">
      <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">{title}</h3>
      <p className="text-gray-500 dark:text-gray-400">功能开发中...</p>
    </div>
  );
}

interface DynamicRouterProps {
  children?: React.ReactNode;  // 额外的静态路由（如登录页）
}

export default function DynamicRouter({ children }: DynamicRouterProps) {
  const { isSuperAdmin } = useAuth();
  const { isCore, isFeatureEnabled, coreConfig } = useInstance();

  // 获取当前实例的导航配置
  const navGroups = useMemo(() => {
    if (isCore && coreConfig) {
      return convertCoreNavGroups(coreConfig.navGroups);
    }
    return getAutopilotNavGroups();
  }, [isCore, coreConfig]);

  // 获取页面组件映射
  const corePageComponents = coreConfig?.pageComponents;

  // 收集所有需要的路由
  const allRoutes: RouteConfig[] = useMemo(() => {
    const routes: RouteConfig[] = [];

    // Core: 使用 allRoutes（包含所有路由，不仅是导航项）
    if (isCore && coreConfig?.allRoutes) {
      for (const route of coreConfig.allRoutes) {
        routes.push({
          path: route.path,
          component: route.component,
          requireAuth: route.requireAuth ?? true,
        });
      }
    } else {
      // Autopilot: 从导航配置中提取路由
      for (const group of navGroups) {
        for (const item of group.items) {
          routes.push({
            path: item.path,
            component: item.component,
            redirect: item.redirect,
            requireAuth: true,
            requireSuperAdmin: item.requireSuperAdmin,
          });
        }
      }
      // 添加额外路由
      routes.push(...additionalRoutes);
    }

    return routes;
  }, [navGroups, isCore, coreConfig]);

  // 渲染单个路由
  const renderRoute = (route: RouteConfig) => {
    // 重定向路由
    if (route.redirect) {
      return (
        <Route
          key={route.path}
          path={route.path}
          element={<Navigate to={route.redirect} replace />}
        />
      );
    }

    // 需要组件的路由
    if (!route.component) {
      return null;
    }

    // 获取组件（支持 Core 动态组件）
    const Component = getLazyComponent(route.component, corePageComponents);

    // 占位页面
    if (!Component) {
      const element = (
        <PrivateRoute>
          <PlaceholderPage title={route.component} />
        </PrivateRoute>
      );
      return <Route key={route.path} path={route.path} element={element} />;
    }

    // 根据权限包装
    let element: React.ReactNode = (
      <Suspense fallback={<LoadingFallback />}>
        <Component />
      </Suspense>
    );

    // 需要超级管理员权限
    if (route.requireSuperAdmin) {
      element = (
        <PrivateRoute>
          {isSuperAdmin ? element : <Navigate to="/" replace />}
        </PrivateRoute>
      );
    } else if (route.requireAuth) {
      element = <PrivateRoute>{element}</PrivateRoute>;
    }

    return <Route key={route.path} path={route.path} element={element} />;
  };

  return (
    <Routes>
      {/* 额外的静态路由（登录页等） */}
      {children}

      {/* 动态生成的路由 */}
      {allRoutes.map(renderRoute)}

      {/* 404 重定向 */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
