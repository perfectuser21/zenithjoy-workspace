/**
 * Features 数据
 * 基于 FEATURES.md v2.0.0
 * 最后更新：2026-01-26
 */

export type FeatureCategory = 'Foundation' | 'Business' | 'Platform';
export type FeatureInstance = 'autopilot' | 'core' | 'both';
export type FeaturePriority = 'P0' | 'P1' | 'P2' | 'P3';
export type FeatureStatus = 'done' | 'in-progress' | 'planned';

export interface Feature {
  id: string;
  name: string;
  category: FeatureCategory;
  instances: FeatureInstance[];
  owner: string;
  priority: FeaturePriority;
  hasRci: boolean;
  hasGoldenPath: boolean;
  status: FeatureStatus;
  dependencies: string[];
  routes?: string[];
  subFeatures?: number;
  description: string;
}

export const features: Feature[] = [
  // Foundation Features
  {
    id: 'F-AUTH',
    name: '飞书认证',
    category: 'Foundation',
    instances: ['autopilot', 'core'],
    owner: '认证团队',
    priority: 'P0',
    hasRci: true,
    hasGoldenPath: true,
    status: 'done',
    dependencies: [],
    routes: ['/login'],
    description: '飞书扫码登录、一键登录、Token 自动刷新、会话管理',
  },
  {
    id: 'F-NOTIFICATION',
    name: '通知系统',
    category: 'Foundation',
    instances: ['autopilot', 'core'],
    owner: '基础设施团队',
    priority: 'P1',
    hasRci: false,
    hasGoldenPath: false,
    status: 'done',
    dependencies: [],
    description: '系统通知、任务完成通知、错误告警通知',
  },
  {
    id: 'F-LOGS',
    name: '日志系统',
    category: 'Foundation',
    instances: ['autopilot', 'core'],
    owner: '基础设施团队',
    priority: 'P1',
    hasRci: false,
    hasGoldenPath: false,
    status: 'done',
    dependencies: [],
    description: '系统日志记录、日志查询、日志聚合',
  },

  // Business Features
  {
    id: 'F-WORKBENCH',
    name: '工作台',
    category: 'Business',
    instances: ['autopilot'],
    owner: '业务团队',
    priority: 'P2',
    hasRci: false,
    hasGoldenPath: false,
    status: 'done',
    dependencies: ['F-AUTH'],
    routes: ['/'],
    subFeatures: 1,
    description: '业务首页仪表盘、每日一言、节日问候、业务概览',
  },
  {
    id: 'F-MEDIA',
    name: '新媒体运营',
    category: 'Business',
    instances: ['autopilot'],
    owner: '内容运营团队',
    priority: 'P0',
    hasRci: true,
    hasGoldenPath: true,
    status: 'done',
    dependencies: ['F-AUTH', 'F-ACCOUNTS', 'F-NOTIFICATION'],
    routes: [
      '/media',
      '/media/content',
      '/media/content/scraping',
      '/media/publish',
      '/media/publish/history',
      '/media/publish/platforms',
      '/media/data',
    ],
    subFeatures: 7,
    description: '核心业务功能，内容采集、发布、数据分析全流程',
  },
  {
    id: 'F-AI-EMPLOYEES',
    name: 'AI 员工系统',
    category: 'Business',
    instances: ['autopilot'],
    owner: 'AI 团队',
    priority: 'P1',
    hasRci: true,
    hasGoldenPath: true,
    status: 'done',
    dependencies: ['F-AUTH', 'F-NOTIFICATION'],
    routes: ['/ai-employees', '/ai-employees/:id', '/ai-employees/:id/abilities/:aid'],
    subFeatures: 3,
    description: '将 n8n 工作流抽象为"AI 员工"概念，提供用户友好视图',
  },
  {
    id: 'F-ACCOUNTS',
    name: '账号管理',
    category: 'Business',
    instances: ['autopilot'],
    owner: '账号管理团队',
    priority: 'P0',
    hasRci: true,
    hasGoldenPath: true,
    status: 'done',
    dependencies: ['F-AUTH'],
    routes: ['/accounts', '/accounts/:id/metrics'],
    subFeatures: 2,
    description: '管理社交媒体平台账号（小红书、抖音、B站、微博），查看账号数据',
  },

  // Platform Features
  {
    id: 'F-MONITOR-CLAUDE',
    name: 'Claude 监控',
    category: 'Platform',
    instances: ['core'],
    owner: '运维团队',
    priority: 'P1',
    hasRci: true,
    hasGoldenPath: false,
    status: 'done',
    dependencies: ['F-AUTH', 'F-LOGS'],
    description: '监控 Claude Code 使用情况、Token 消耗统计、会话历史查询、成本分析',
  },
  {
    id: 'F-MONITOR-VPS',
    name: 'VPS 监控',
    category: 'Platform',
    instances: ['core'],
    owner: '运维团队',
    priority: 'P1',
    hasRci: true,
    hasGoldenPath: false,
    status: 'done',
    dependencies: ['F-AUTH', 'F-NOTIFICATION'],
    description: 'VPS 资源监控（CPU、内存、磁盘）、Docker 容器状态、服务健康检查、告警通知',
  },
  {
    id: 'F-N8N-MANAGE',
    name: 'N8N 工作流管理',
    category: 'Platform',
    instances: ['core'],
    owner: '自动化团队',
    priority: 'P1',
    hasRci: true,
    hasGoldenPath: true,
    status: 'done',
    dependencies: ['F-AUTH'],
    description: '查看所有 N8N workflows、创建 webhook workflow、测试 webhook、删除 workflow、查看执行历史',
  },
  {
    id: 'F-CANVAS',
    name: 'Canvas 画布',
    category: 'Platform',
    instances: ['core'],
    owner: '可视化团队',
    priority: 'P2',
    hasRci: false,
    hasGoldenPath: false,
    status: 'done',
    dependencies: ['F-AUTH'],
    description: '可视化画布工具、项目架构图绘制、Feature → Module → Logic → Code 四层架构展示',
  },
  {
    id: 'F-CECELIA',
    name: 'Cecelia 任务管理',
    category: 'Platform',
    instances: ['core'],
    owner: 'Cecelia 团队',
    priority: 'P1',
    hasRci: true,
    hasGoldenPath: true,
    status: 'in-progress',
    dependencies: ['F-AUTH', 'F-NOTIFICATION'],
    subFeatures: 3,
    description: 'Cecelia 无头开发系统的可视化管理界面',
  },
];

// 统计数据
export const getFeatureStats = () => {
  const total = features.length;

  // 计算子功能总数
  const subFeaturesTotal = features.reduce((acc, f) => acc + (f.subFeatures || 1), 0);

  const byCategory = {
    Foundation: features.filter((f) => f.category === 'Foundation').length,
    Business: features.filter((f) => f.category === 'Business').length,
    Platform: features.filter((f) => f.category === 'Platform').length,
  };

  const byInstance = {
    autopilot: features.filter((f) => f.instances.includes('autopilot')).length,
    core: features.filter((f) => f.instances.includes('core')).length,
    both: features.filter((f) => f.instances.length === 2 && f.instances.includes('autopilot') && f.instances.includes('core')).length,
  };

  const byPriority = {
    P0: features.filter((f) => f.priority === 'P0').length,
    P1: features.filter((f) => f.priority === 'P1').length,
    P2: features.filter((f) => f.priority === 'P2').length,
    P3: features.filter((f) => f.priority === 'P3').length,
  };

  const byStatus = {
    done: features.filter((f) => f.status === 'done').length,
    'in-progress': features.filter((f) => f.status === 'in-progress').length,
    planned: features.filter((f) => f.status === 'planned').length,
  };

  const withRci = features.filter((f) => f.hasRci).length;
  const withGoldenPath = features.filter((f) => f.hasGoldenPath).length;

  const rciCoverage = Math.round((withRci / total) * 100);
  const goldenPathCoverage = Math.round((withGoldenPath / total) * 100);

  return {
    total,
    subFeaturesTotal,
    byCategory,
    byInstance,
    byPriority,
    byStatus,
    withRci,
    withGoldenPath,
    rciCoverage,
    goldenPathCoverage,
  };
};

// 获取依赖关系
export const getFeatureDependencies = (featureId: string): Feature[] => {
  const feature = features.find((f) => f.id === featureId);
  if (!feature) return [];

  return feature.dependencies
    .map((depId) => features.find((f) => f.id === depId))
    .filter(Boolean) as Feature[];
};

// 获取被依赖的 features
export const getFeatureDependents = (featureId: string): Feature[] => {
  return features.filter((f) => f.dependencies.includes(featureId));
};
