# Dashboard Frontend API 文档

> 最后更新: 2026-01-30

本文档描述了 Dashboard Frontend 所有 API 模块及其功能。

## 目录

- [Client](#client)
- [Accounts API](#accounts-api)
- [Metrics API](#metrics-api)
- [Settings API](#settings-api)
- [Publish API](#publish-api)
- [Dashboard API](#dashboard-api)
- [Instance API](#instance-api)
- [Contents API](#contents-api)
- [Video Editor API](#video-editor-api)
- [Scraping API](#scraping-api)
- [AI Employees API](#ai-employees-api)
- [System API](#system-api)

---

## Client

**文件**: `src/api/client.ts`

基础 HTTP 客户端配置，使用 axios 实现。

### 配置

| 环境变量 | 说明 | 默认值 |
|---------|------|--------|
| `VITE_API_BASE_URL` | API 基础 URL | `/api` |
| `VITE_COLLECTOR_API_KEY` | API 认证密钥 | 空 |

### 请求头

- `Content-Type`: `application/json`
- `Authorization`: `Bearer {API_KEY}`

---

## Accounts API

**文件**: `src/api/accounts.api.ts`

社交媒体账号管理相关功能。

### 类型定义

#### Account

```typescript
interface Account {
  id: string;
  platform: 'xiaohongshu' | 'douyin' | 'bilibili' | 'weibo';
  accountId: string;
  displayName: string;
  avatar?: string;
  isActive: boolean;
  loginStatus: 'valid' | 'expired' | 'unknown';
  lastHealthCheck?: {
    loggedIn: boolean;
    reason?: string;
    checkedAt: string;
  };
  cookies?: any;
  createdAt: string;
  updatedAt: string;
}
```

#### LoginSession

```typescript
interface LoginSession {
  sessionId: string;
  platform: string;
  accountId: string;
  qrCode?: string;
  status: 'pending' | 'scanned' | 'success' | 'failed' | 'expired';
  expiresAt: string;
  createdAt: string;
}
```

### API 函数

| 函数 | 说明 | 参数 | 返回值 |
|-----|------|------|--------|
| `getAccounts(platform?)` | 获取账号列表 | platform: 可选，平台过滤 | `Account[]` |
| `getAccount(id)` | 获取单个账号 | id: 账号 ID | `Account` |
| `addAccount(data)` | 添加账号 | platform, accountId, displayName | `Account` |
| `updateAccount(id, data)` | 更新账号 | id, Partial\<Account\> | `Account` |
| `deleteAccount(id)` | 删除账号 | id: 账号 ID | void |
| `healthCheck(id)` | 单账号健康检查 | id: 账号 ID | `HealthCheckResult` |
| `batchHealthCheck()` | 批量健康检查 | 无 | `Record<string, HealthCheckResult>` |
| `initiateLogin(platform, accountId)` | 发起登录 | platform, accountId | `LoginSession` |
| `getLoginStatus(sessionId)` | 获取登录状态 | sessionId | `LoginSession` |
| `refreshQRCode(sessionId)` | 刷新二维码 | sessionId | `LoginSession` |
| `getAccountMetrics(id, startDate?, endDate?)` | 获取账号指标 | id, 日期范围 | `AccountMetrics` |
| `exportAccountData(id, format?)` | 导出账号数据 | id, 格式(csv/json) | Blob |

---

## Metrics API

**文件**: `src/api/metrics.api.ts`

数据指标和报表相关功能。

### 类型定义

#### MetricsData

```typescript
interface MetricsData {
  platform: string;
  accountId: string;
  date: string;
  followers_total: number;
  followers_delta: number;
  impressions: number;
  engagements: number;
  posts_published: number;
  top_post_url?: string;
  top_post_engagement?: number;
}
```

#### DashboardMetrics

```typescript
interface DashboardMetrics {
  overview: {
    totalFollowers: number;
    totalFollowersDelta: number;
    totalImpressions: number;
    totalEngagements: number;
    engagementRate: number;
  };
  trends: {
    followers: Array<{ date: string; count: number }>;
    impressions: Array<{ date: string; count: number }>;
    engagements: Array<{ date: string; count: number }>;
  };
  byPlatform: Array<{...}>;
  topContent: Array<{...}>;
}
```

### API 函数

| 函数 | 说明 | 参数 | 返回值 |
|-----|------|------|--------|
| `getDashboardMetrics(timeRange?)` | 获取仪表盘指标 | timeRange: 'today'\|'week'\|'month' | `DashboardMetrics` |
| `getMetrics(platform?, accountId?, startDate?, endDate?)` | 获取指标数据 | 过滤参数 | `MetricsData[]` |
| `getDailyReport(date)` | 获取日报 | date: YYYY-MM-DD | `DailyReport` |
| `getWeeklyReport(weekStart)` | 获取周报 | weekStart: 周起始日期 | any |
| `getMonthlyReport(month)` | 获取月报 | month: YYYY-MM | any |
| `triggerCollection(platform?, accountId?)` | 手动触发数据采集 | 可选过滤 | any |
| `getCollectionStatus()` | 获取采集状态 | 无 | `{status, currentTask?, progress?, lastRun?}` |

---

## Settings API

**文件**: `src/api/settings.api.ts`

系统设置和通知管理。

### 类型定义

#### Notification

```typescript
interface Notification {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  category: 'login' | 'collection' | 'workflow' | 'system';
  title: string;
  message: string;
  data?: any;
  isRead: boolean;
  createdAt: string;
}
```

#### SystemSettings

```typescript
interface SystemSettings {
  notifications: {
    feishu: {
      enabled: boolean;
      webhookUrl: string;
      notifyOnSuccess: boolean;
      notifyOnFailure: boolean;
      notifyOnLogin: boolean;
      notifyOnMetrics: boolean;
    };
  };
  notion: {
    enabled: boolean;
    apiKey: string;
    databaseId: string;
  };
  collection: {
    timeout: number;
    retries: number;
    concurrency: number;
    schedules: {
      dailyMetrics: string;  // Cron 表达式
      healthCheck: string;
    };
  };
  alerts: {
    loginExpiry: { enabled: boolean; daysBeforeExpiry: number; };
    followerDrop: { enabled: boolean; threshold: number; };
    engagementDrop: { enabled: boolean; threshold: number; };
  };
}
```

### API 函数

| 函数 | 说明 | 参数 | 返回值 |
|-----|------|------|--------|
| `getSettings()` | 获取系统设置 | 无 | `SystemSettings` |
| `updateSettings(settings)` | 更新设置 | Partial\<SystemSettings\> | `SystemSettings` |
| `testFeishuWebhook(webhookUrl)` | 测试飞书 Webhook | webhookUrl | `{success, error?}` |
| `testNotionConnection(apiKey, databaseId)` | 测试 Notion 连接 | apiKey, databaseId | `{success, error?}` |
| `getNotifications(unreadOnly?, limit?)` | 获取通知列表 | 过滤参数 | `Notification[]` |
| `markNotificationRead(id)` | 标记已读 | id | void |
| `markAllNotificationsRead()` | 全部标记已读 | 无 | void |
| `deleteNotification(id)` | 删除通知 | id | void |
| `getUnreadCount()` | 获取未读数 | 无 | number |
| `getSystemHealth()` | 获取系统健康状态（多服务聚合） | 无 | `SystemHealthResponse` |

#### SystemHealthResponse

```typescript
interface SystemHealthResponse {
  success: boolean;
  status: 'healthy' | 'degraded' | 'unhealthy';
  service: string;
  services: {
    [key: string]: {
      status: 'healthy' | 'unhealthy';
      latency_ms: number | null;
      last_check: string | null;
      error: string | null;
    };
  };
  degraded: boolean;
  degraded_reason: string | null;
  timestamp: string;
}
```

聚合的服务包括：brain、workspace、quality、n8n 等。每个服务返回状态、延迟（毫秒）、最后检查时间和错误信息。

---

## Publish API

**文件**: `src/api/publish.api.ts`

内容发布任务管理。

### 类型定义

#### PublishTask

```typescript
interface PublishTask {
  id: string;
  title: string;
  titleZh?: string;
  titleEn?: string;
  content: string | null;
  contentZh?: string | null;
  contentEn?: string | null;
  mediaType: 'image' | 'video' | 'text';
  originalFiles: string[];
  coverImage?: string | null;
  processedFiles: Record<string, string[]>;
  targetPlatforms: string[];
  status: 'draft' | 'pending' | 'processing' | 'completed' | 'failed' | 'partial';
  scheduleAt: string | null;
  results: Record<string, { success: boolean; url?: string; error?: string }>;
  createdAt: string;
  updatedAt: string;
  progress?: { total: number; completed: number; success: number; failed: number; };
}
```

### API 函数

| 函数 | 说明 | 参数 | 返回值 |
|-----|------|------|--------|
| `getPlatforms()` | 获取平台规格列表 | 无 | `PlatformSpec[]` |
| `getPlatform(platform)` | 获取单个平台规格 | platform | `PlatformSpec` |
| `uploadFiles(files)` | 上传文件 | File[] | `UploadedFile[]` |
| `getTasks(options?)` | 获取任务列表 | status?, limit?, offset? | `PublishTask[]` |
| `getTask(id)` | 获取单个任务 | id | `PublishTask` |
| `createTask(data)` | 创建任务 | 任务数据 | `PublishTask` |
| `updateTask(id, data)` | 更新任务 | id, 部分数据 | `PublishTask` |
| `deleteTask(id)` | 删除任务 | id | void |
| `submitTask(id)` | 提交发布 | id | `PublishTask` |
| `getFileUrl(filePath)` | 获取文件 URL | filePath | string |
| `retryPlatform(taskId, platform)` | 重试失败平台 | taskId, platform | `PublishTask` |
| `copyTask(taskId)` | 复制任务 | taskId | `PublishTask` |
| `getStats()` | 获取发布统计 | 无 | 统计数据 |

---

## Dashboard API

**文件**: `src/api/dashboard.api.ts`

Dashboard 首页聚合数据。

### 类型定义

#### DashboardStats

```typescript
interface DashboardStats {
  todayPublished: { value: number; delta: number; };
  pendingTasks: { value: number; delta: number; };
  activeAccounts: { value: number; delta: number; };
  aiExecutions: { value: number; delta: number; };
}
```

### API 函数

| 函数 | 说明 | 参数 | 返回值 |
|-----|------|------|--------|
| `fetchDashboardStats()` | 获取首页统计 | 无 | `DashboardStats` |

该函数聚合以下数据源：
- 发布统计（从 publishApi）
- 账号状态（从 accountsApi）
- AI 员工执行情况（从 n8n-live-status）

---

## Instance API

**文件**: `src/api/instance.api.ts`

实例配置管理。

### API 函数

| 函数 | 说明 | 参数 | 返回值 |
|-----|------|------|--------|
| `getConfig()` | 获取当前实例配置 | 无 | `InstanceConfigResponse` |

返回值包含：
- `success`: 是否成功
- `config`: 实例配置（主题、功能开关等）
- `matched_domain`: 匹配的域名
- `error`: 错误信息（如有）

---

## Contents API

**文件**: `src/api/contents.api.ts`

网站内容管理（文章、视频、帖子）。

### 类型定义

#### WebsiteContent

```typescript
interface WebsiteContent {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  body: string | null;
  content_type: 'article' | 'video' | 'post';
  lang: 'zh' | 'en';
  tags: string[];
  reading_time: string | null;
  faq: { question: string; answer: string }[];
  key_takeaways: string[];
  quotable_insights: string[];
  video_url: string | null;
  thumbnail_url: string | null;
  status: 'draft' | 'published';
  published_at: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}
```

#### CreateContentInput

```typescript
interface CreateContentInput {
  slug: string;
  title: string;
  description?: string;
  body?: string;
  content_type: 'article' | 'video' | 'post';
  lang?: 'zh' | 'en';
  tags?: string[];
  reading_time?: string;
  faq?: { question: string; answer: string }[];
  key_takeaways?: string[];
  quotable_insights?: string[];
  video_url?: string;
  thumbnail_url?: string;
  status?: 'draft' | 'published';
}
```

### API 函数

| 函数 | 说明 | 参数 | 返回值 |
|-----|------|------|--------|
| `getAll(options?)` | 获取内容列表 | lang?, type?, status?, limit?, offset? | `{ data: WebsiteContent[], total: number }` |
| `getById(id)` | 获取单个内容 | id | `WebsiteContent` |
| `create(data)` | 创建内容 | CreateContentInput | `WebsiteContent` |
| `update(id, data)` | 更新内容 | id, Partial\<CreateContentInput\> | `WebsiteContent` |
| `delete(id)` | 删除内容 | id | void |
| `publish(id)` | 发布内容 | id | `WebsiteContent` |
| `unpublish(id)` | 取消发布 | id | `WebsiteContent` |

---

## Video Editor API

**文件**: `src/api/video-editor.api.ts`

视频编辑功能，支持 AI 智能剪辑。

### 类型定义

#### UploadedVideo

```typescript
interface UploadedVideo {
  id: string;
  originalName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  duration?: number;
  width?: number;
  height?: number;
  createdAt: string;
}
```

#### ProcessOptions

```typescript
interface ProcessOptions {
  trim?: { start: string; end: string };
  resize?: { width: number; height: number; fit: 'cover' | 'contain' | 'fill' };
  preset?: '9:16' | '16:9' | '1:1' | '4:3' | '3:4';
  subtitle?: {
    text: string;
    style: 'bottom' | 'top' | 'center';
    fontSize?: number;
    fontColor?: string;
    backgroundColor?: string;
  };
}
```

#### VideoJob

```typescript
interface VideoJob {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  outputPath?: string;
  error?: string;
  options: ProcessOptions;
  originalVideo: UploadedVideo;
  userPrompt?: string;
  aiAnalysis?: string;
  transcript?: string;
  steps?: StepInfo[];
  currentStep?: ProcessingStep;
  createdAt: string;
  updatedAt: string;
}
```

#### AiAnalysisResult

```typescript
interface AiAnalysisResult {
  summary: string;
  transcript?: string;
  transcriptSegments?: TranscriptSegment[];
  params: ProcessOptions;
  operations?: AiEditOperation[];
  estimatedDuration?: number;
  silenceRanges?: { start: number; end: number }[];
}
```

### API 函数

| 函数 | 说明 | 参数 | 返回值 |
|-----|------|------|--------|
| `uploadVideo(file, onProgress?)` | 上传视频 | File, 进度回调 | `UploadedVideo` |
| `getVideos()` | 获取视频列表 | 无 | `UploadedVideo[]` |
| `getVideo(id)` | 获取视频信息 | id | `UploadedVideo` |
| `deleteVideo(id)` | 删除视频 | id | void |
| `processVideo(videoId, options)` | 创建处理任务 | videoId, ProcessOptions | `VideoJob` |
| `getJobs()` | 获取任务列表 | 无 | `VideoJob[]` |
| `getJobStatus(jobId)` | 获取任务状态 | jobId | `VideoJob` |
| `deleteJob(jobId)` | 删除任务 | jobId | void |
| `getDownloadUrl(jobId)` | 获取下载 URL | jobId | string |
| `getPreviewUrl(filePath)` | 获取预览 URL | filePath | string |
| `aiAnalyze(videoId, userPrompt)` | AI 分析（不处理） | videoId, userPrompt | `AiAnalysisResult` |
| `aiProcess(videoId, userPrompt)` | AI 智能处理 | videoId, userPrompt | `{ id, status, message }` |

### 预设尺寸

| 预设 | 名称 | 分辨率 | 适用平台 |
|------|------|--------|----------|
| 9:16 | 竖屏 | 1080×1920 | 抖音、TikTok、快手 |
| 16:9 | 横屏 | 1920×1080 | YouTube、B站 |
| 1:1 | 方形 | 1080×1080 | Instagram、微博 |
| 4:3 | 传统 | 1440×1080 | 传统视频 |
| 3:4 | 竖屏4:3 | 1080×1440 | 小红书 |

---

## Scraping API

**文件**: `src/api/scraping.api.ts`

数据采集任务管理，通过 N8N webhook 触发。

### 类型定义

#### ScrapingTask

```typescript
interface ScrapingTask {
  id: string;
  platform: 'xiaohongshu' | 'douyin' | 'weibo' | 'bilibili';
  name: string;
  description: string;
  webhookPath: string;
  status: 'idle' | 'running' | 'success' | 'error';
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
```

#### TriggerResult

```typescript
interface TriggerResult {
  success: boolean;
  executionId?: string;
  message?: string;
  error?: string;
}
```

### API 函数

| 函数 | 说明 | 参数 | 返回值 |
|-----|------|------|--------|
| `fetchScrapingTasks()` | 获取任务列表 | 无 | `ScrapingTask[]` |
| `fetchScrapingTask(taskId)` | 获取单个任务 | taskId | `ScrapingTask \| null` |
| `triggerScrapingTask(taskId)` | 触发采集任务 | taskId | `TriggerResult` |
| `resetTaskCache()` | 重置状态缓存 | 无 | void |

### 预定义采集任务

| 任务 ID | 平台 | 说明 |
|---------|------|------|
| xiaohongshu-scraper | 小红书 | 采集热门笔记和用户数据 |
| douyin-scraper | 抖音 | 采集热门视频和创作者数据 |
| weibo-scraper | 微博 | 采集热搜和用户动态 |
| bilibili-scraper | B站 | 采集热门视频和UP主数据 |

---

## AI Employees API

**文件**: `src/api/ai-employees.api.ts`

AI 员工管理，聚合 N8N 执行数据按员工视角展示。

### 内部类型定义

以下类型用于从 N8N API 获取数据并转换为员工视角（不导出）：

#### N8nExecution

```typescript
interface N8nExecution {
  id: string;
  workflowId: string;
  workflowName?: string;
  status: 'success' | 'error' | 'waiting' | 'running' | 'crashed';
  startedAt: string;
  stoppedAt?: string;
}
```

#### TodayStats

```typescript
interface TodayStats {
  running: number;
  success: number;
  error: number;
  total: number;
}
```

#### LiveStatusOverview

```typescript
interface LiveStatusOverview {
  todayStats: TodayStats;
  runningExecutions: Array<{
    id: string;
    workflowId: string;
    workflowName: string;
    startedAt: string;
    duration: number;
  }>;
  recentCompleted: N8nExecution[];
  timestamp: number;
}
```

### 导出类型定义

#### EmployeeTaskStats

```typescript
interface EmployeeTaskStats {
  todayTotal: number;
  todaySuccess: number;
  todayError: number;
  todayRunning: number;
  successRate: number;
  recentTasks: EmployeeTask[];
}
```

#### EmployeeTask

```typescript
interface EmployeeTask {
  id: string;
  workflowId: string;
  workflowName: string;
  abilityId: string;
  abilityName: string;
  status: 'success' | 'error' | 'running' | 'waiting';
  startedAt: string;
  stoppedAt?: string;
}
```

#### AiEmployeeWithStats

```typescript
interface AiEmployeeWithStats extends AiEmployee {
  stats: EmployeeTaskStats;
}
```

#### DepartmentWithStats

```typescript
interface DepartmentWithStats extends Department {
  employees: AiEmployeeWithStats[];
  todayTotal: number;
}
```

### API 函数

| 函数 | 说明 | 参数 | 返回值 |
|-----|------|------|--------|
| `fetchAiEmployeesWithStats()` | 获取所有员工及统计 | 无 | `DepartmentWithStats[]` |
| `fetchEmployeeTasks(employeeId)` | 获取员工任务列表 | employeeId | `EmployeeTask[]` |

### 数据来源

此 API 从 `n8n-live-status` API 获取实时执行数据，然后按员工配置（`ai-employees.config.ts`）聚合统计。每个员工关联多个 N8N workflow 能力。

---

## System API

**文件**: `src/api/system.api.ts`

系统性能监控指标和健康检查。

### 类型定义

#### ServiceHealth

```typescript
interface ServiceHealth {
  status: 'healthy' | 'unhealthy';
  latency_ms: number | null;
  last_check: string | null;
  error: string | null;
}
```

#### SystemHealthResponse

```typescript
interface SystemHealthResponse {
  success: boolean;
  status: 'healthy' | 'degraded' | 'unhealthy';
  service: string;
  services: Record<string, ServiceHealth>;
  degraded: boolean;
  degraded_reason: string | null;
  timestamp: string;
}
```

聚合的服务包括：brain、workspace、quality、n8n 等。每个服务返回状态、延迟（毫秒）、最后检查时间和错误信息。

#### SystemMetrics

```typescript
interface SystemMetrics {
  cpuUsage: number;
  memoryUsage: number;
  memoryTotal: number;
  memoryUsed: number;
  avgResponseTime: number;
  errorRate: number;
  activeConnections: number;
  uptime: number;
}
```

#### MetricHistory

```typescript
interface MetricHistory {
  timestamp: string;
  cpuUsage: number;
  memoryUsage: number;
  responseTime: number;
}
```

#### SystemMetricsResponse

```typescript
interface SystemMetricsResponse {
  current: SystemMetrics;
  history: MetricHistory[];
}
```

### API 函数

| 函数 | 说明 | 参数 | 返回值 |
|-----|------|------|--------|
| `getMetrics()` | 获取系统性能指标 | 无 | `SystemMetricsResponse` |
| `getHealth()` | 获取系统健康状态 | 无 | `SystemHealthResponse` |

- `getMetrics()`: 返回当前系统的 CPU 使用率、内存使用率、平均响应时间、错误率、活跃连接数和运行时间，以及历史趋势数据。
- `getHealth()`: 返回多服务聚合的健康状态，包括各服务的健康状态、延迟和错误信息。

---

## 使用示例

```typescript
import { accountsApi, metricsApi, publishApi, systemApi } from '@/api';

// 获取账号列表
const accounts = await accountsApi.getAccounts();

// 获取仪表盘指标
const metrics = await metricsApi.getDashboardMetrics('week');

// 创建发布任务
const task = await publishApi.createTask({
  titleZh: '测试内容',
  titleEn: 'Test Content',
  mediaType: 'image',
  targetPlatforms: ['xiaohongshu', 'douyin'],
});
```
