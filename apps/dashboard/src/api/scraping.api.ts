/**
 * Scraping API - 管理数据采集任务
 */

// ============ 类型定义 ============

export type ScrapingPlatform = 'xiaohongshu' | 'douyin' | 'weibo' | 'bilibili';

export type TaskStatus = 'idle' | 'running' | 'success' | 'error';

export interface ScrapingTask {
  id: string;
  platform: ScrapingPlatform;
  name: string;
  description: string;
  webhookPath: string;
  status: TaskStatus;
  lastExecutedAt?: string;
  lastResult?: {
    success: boolean;
    dataCount?: number;
    error?: string;
  };
  stats: {
    totalRuns: number;
    successRuns: number;
    dataCollected: number;
  };
}

export interface TriggerResult {
  success: boolean;
  executionId?: string;
  message?: string;
  error?: string;
}

// ============ 预定义爬虫任务 ============

const SCRAPING_TASKS: ScrapingTask[] = [
  {
    id: 'xiaohongshu-scraper',
    platform: 'xiaohongshu',
    name: '小红书采集',
    description: '采集小红书热门笔记和用户数据',
    webhookPath: '/webhook/xiaohongshu-scraper',
    status: 'idle',
    stats: {
      totalRuns: 0,
      successRuns: 0,
      dataCollected: 0,
    },
  },
  {
    id: 'douyin-scraper',
    platform: 'douyin',
    name: '抖音采集',
    description: '采集抖音热门视频和创作者数据',
    webhookPath: '/webhook/douyin-scraper',
    status: 'idle',
    stats: {
      totalRuns: 0,
      successRuns: 0,
      dataCollected: 0,
    },
  },
  {
    id: 'weibo-scraper',
    platform: 'weibo',
    name: '微博采集',
    description: '采集微博热搜和用户动态',
    webhookPath: '/webhook/weibo-scraper',
    status: 'idle',
    stats: {
      totalRuns: 0,
      successRuns: 0,
      dataCollected: 0,
    },
  },
  {
    id: 'bilibili-scraper',
    platform: 'bilibili',
    name: 'B站采集',
    description: '采集B站热门视频和UP主数据',
    webhookPath: '/webhook/bilibili-scraper',
    status: 'idle',
    stats: {
      totalRuns: 0,
      successRuns: 0,
      dataCollected: 0,
    },
  },
];

// 存储任务状态（临时方案，生产环境应该从后端获取）
let taskStatusCache: Map<string, Partial<ScrapingTask>> = new Map();

// ============ API 函数 ============

/**
 * 获取所有爬虫任务列表
 */
export async function fetchScrapingTasks(): Promise<ScrapingTask[]> {
  // 尝试从后端获取任务状态
  // 使用预定义任务 + 本地缓存状态
  return SCRAPING_TASKS.map((task) => ({
    ...task,
    ...taskStatusCache.get(task.id),
  }));
}

/**
 * 获取单个任务详情
 */
export async function fetchScrapingTask(taskId: string): Promise<ScrapingTask | null> {
  const tasks = await fetchScrapingTasks();
  return tasks.find((t) => t.id === taskId) || null;
}

/**
 * 触发爬虫任务执行
 */
export async function triggerScrapingTask(taskId: string): Promise<TriggerResult> {
  const task = SCRAPING_TASKS.find((t) => t.id === taskId);
  if (!task) {
    return { success: false, error: '任务不存在' };
  }

  // 更新本地状态为运行中
  taskStatusCache.set(taskId, {
    status: 'running',
    lastExecutedAt: new Date().toISOString(),
  });

  taskStatusCache.set(taskId, { status: 'idle' });
  return { success: false, error: '采集功能暂不可用' };
}

/**
 * 重置任务状态缓存
 */
export function resetTaskCache(): void {
  taskStatusCache.clear();
}

// ============ 导出 ============

export const scrapingApi = {
  fetchScrapingTasks,
  fetchScrapingTask,
  triggerScrapingTask,
  resetTaskCache,
};
