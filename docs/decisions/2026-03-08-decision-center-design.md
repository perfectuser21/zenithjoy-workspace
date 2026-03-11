---
id: decision-center-design
version: 1.0.0
created: 2026-03-08
updated: 2026-03-08
audience: [human, claude-code]
type: Architecture Decision
status: draft
changelog:
  - 1.0.0: 初始设计方案
---

# 架构决策：决策中心（Decision Center）

## 背景

老板需要一个前端界面来完成治理闭环：
1. 每天看到 C-Suite（CTO/COO/CMO）的晨报分析
2. 在界面上直接做决策（选 A/B/C）
3. 决策自动回流到 ROADMAP.md 和 Brain 任务系统
4. 不用开 Claude Code 也能操作

## 现有基础

### 前端 Dashboard
- 技术栈：React + TypeScript + Vite + Tailwind
- 路由：配置驱动（navigation.config.ts）
- 认证：飞书登录 + AuthContext
- 已有页面：工作台、新媒体运营、AI 员工、作品管理、账号管理、平台数据、AI 视频

### 后端 API
- 技术栈：Express + TypeScript
- 路由：ai-video、fields、platform-data、publish、works
- 数据库：PostgreSQL（香港 VPS）

### Brain API（Cecelia）
- 端口 5221
- 已有：tasks、goals、projects 的 CRUD
- 已有：tick 调度、任务派发

## 设计方案

### 新增内容

```
前端新增：
  apps/dashboard/src/pages/
    └── DecisionCenterPage.tsx      # 决策中心主页

后端新增：
  apps/api/src/routes/
    └── briefing.ts                 # 晨报 + 决策 API

数据存储：
  新表 briefings                    # 晨报记录
  新表 decisions                    # 决策记录
  文件 ROADMAP.md                   # 活文档（SSOT）
```

### 导航配置

在 navigation.config.ts 中新增：
```typescript
{
  path: '/decisions',
  icon: Target,           // 或 Gavel
  label: '决策中心',
  featureKey: 'decision-center',
  component: 'DecisionCenterPage'
}
```

### 页面布局

```
┌──────────────────────────────────────────────────┐
│ 决策中心                              2026-03-08 │
├──────────────────────────────────────────────────┤
│                                                  │
│ ┌─ 今日晨报 ──────────────────────────────────┐ │
│ │                                              │ │
│ │  CTO 视角                                   │ │
│ │  微博发布器开发完成 80%，预计明天完工。      │ │
│ │  技术债：3 个 PR 待合并，CI 通过率 100%。    │ │
│ │                                              │ │
│ │  COO 视角                                   │ │
│ │  本周任务完成率 60%，低于目标 80%。          │ │
│ │  瓶颈：只有 1 个执行 slot。                 │ │
│ │                                              │ │
│ │  CMO 视角                                   │ │
│ │  抖音平台 DAU 增长 15%，建议优先接入。      │ │
│ │  微博活跃度持平，ROI 中等。                 │ │
│ │                                              │ │
│ └──────────────────────────────────────────────┘ │
│                                                  │
│ ┌─ 待决策 (2) ────────────────────────────────┐ │
│ │                                              │ │
│ │  D1: 下一个平台优先级                       │ │
│ │  ┌──────────────────────────────────────┐   │ │
│ │  │ CTO: 微博（技术就绪）               │   │ │
│ │  │ CMO: 抖音（市场大）                  │   │ │
│ │  │ COO: 只能选一个（资源限制）          │   │ │
│ │  │                                      │   │ │
│ │  │ [A 微博优先]  [B 抖音优先]  [C 并行] │   │ │
│ │  │                                      │   │ │
│ │  │ 默认：A（24h 后自动执行）            │   │ │
│ │  └──────────────────────────────────────┘   │ │
│ │                                              │ │
│ │  D2: 是否增加执行 slot                      │ │
│ │  ┌──────────────────────────────────────┐   │ │
│ │  │ COO: 当前 1 slot，建议增加到 2       │   │ │
│ │  │ CFO: 多 1 slot = 多 $30/天 API 成本  │   │ │
│ │  │                                      │   │ │
│ │  │ [A 增加]  [B 维持现状]               │   │ │
│ │  │                                      │   │ │
│ │  │ 默认：B（维持现状）                  │   │ │
│ │  └──────────────────────────────────────┘   │ │
│ │                                              │ │
│ └──────────────────────────────────────────────┘ │
│                                                  │
│ ┌─ OKR 进度 ─────────────────────────────────┐ │
│ │  KR1 发布自动化    ████████░░░░░░░░  25%    │ │
│ │  KR2 数据采集      ██░░░░░░░░░░░░░░  10%    │ │
│ │  KR3 内容生产      ░░░░░░░░░░░░░░░░   0%    │ │
│ └──────────────────────────────────────────────┘ │
│                                                  │
│ ┌─ 历史决策 ─────────────────────────────────┐ │
│ │  2026-03-07  微博优先（老板选 A）          │ │
│ │  2026-03-06  快手推迟到 Q2（老板决定）     │ │
│ │  2026-03-05  维持 1 slot（超时默认 B）     │ │
│ └──────────────────────────────────────────────┘ │
│                                                  │
│ ┌─ 快速输入 ─────────────────────────────────┐ │
│ │  💬 有新想法？在这里告诉团队...     [发送] │ │
│ └──────────────────────────────────────────────┘ │
│                                                  │
└──────────────────────────────────────────────────┘
```

### 数据流

```
Morning Briefing Skills
    │ 写入
    ▼
PostgreSQL: briefings 表
    │ API 读取
    ▼
Dashboard: 决策中心页面
    │ 用户点击选项
    ▼
API: POST /api/briefing/decisions
    │ 同时做三件事
    ├── 1. 更新 decisions 表
    ├── 2. 更新 ROADMAP.md
    └── 3. 调用 Brain API 调整任务优先级
```

### 数据库表设计

```sql
-- 晨报记录
CREATE TABLE briefings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL UNIQUE,
  cto_analysis JSONB,          -- CTO 分析内容
  coo_analysis JSONB,          -- COO 分析内容
  cmo_analysis JSONB,          -- CMO 分析内容
  synthesis TEXT,              -- 综合分析
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 决策记录
CREATE TABLE decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  briefing_id UUID REFERENCES briefings(id),
  title TEXT NOT NULL,
  description TEXT,
  options JSONB NOT NULL,       -- [{key: "A", label: "微博优先", detail: "..."}]
  default_option TEXT NOT NULL, -- 超时默认选项
  deadline TIMESTAMPTZ,         -- 决策截止时间
  chosen_option TEXT,           -- 用户选择的选项（null = 未决策）
  chosen_by TEXT,               -- 谁做的决策
  chosen_at TIMESTAMPTZ,        -- 决策时间
  auto_resolved BOOLEAN DEFAULT FALSE, -- 是否超时自动走默认
  impact_level TEXT DEFAULT 'medium',  -- low/medium/high
  status TEXT DEFAULT 'pending',       -- pending/resolved/expired
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- OKR 快照（每日晨报时记录，用于趋势图）
CREATE TABLE okr_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  kr_id UUID,
  progress INTEGER,            -- 0-100
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### API 端点

```
GET  /api/briefing/today         # 今日晨报
GET  /api/briefing/history       # 历史晨报
GET  /api/briefing/decisions     # 待决策列表
POST /api/briefing/decisions/:id # 提交决策
GET  /api/briefing/okr-progress  # OKR 进度快照
POST /api/briefing/feedback      # 快速反馈/新想法
```

### C-Suite Skills 写入晨报的流程

```
/morning-briefing Skill 执行完毕后：

1. 读取 CTO/COO/CMO 各自的分析文件
2. 综合分析，提取分歧点和决策项
3. 调用 API：

   POST /api/briefing
   {
     "date": "2026-03-08",
     "cto_analysis": { "summary": "...", "risks": [...], "recommendations": [...] },
     "coo_analysis": { "summary": "...", "bottlenecks": [...], "metrics": {...} },
     "cmo_analysis": { "summary": "...", "trends": [...], "opportunities": [...] },
     "synthesis": "综合分析文本...",
     "decisions": [
       {
         "title": "下一个平台优先级",
         "description": "CTO 和 CMO 对优先级有分歧...",
         "options": [
           {"key": "A", "label": "微博优先", "detail": "技术就绪，1 周上线"},
           {"key": "B", "label": "抖音优先", "detail": "市场大，需 2 周开发"},
           {"key": "C", "label": "并行", "detail": "需要增加 slot"}
         ],
         "default_option": "A",
         "deadline": "2026-03-09T06:00:00Z",
         "impact_level": "high"
       }
     ]
   }

4. 更新 ROADMAP.md 的「待决策」区域
```

### 用户决策回流

```
用户在界面点击 [B 抖音优先]

前端调用：
  POST /api/briefing/decisions/xxx
  { "chosen_option": "B", "comment": "抖音用户多" }

后端执行：
  1. decisions 表: status = resolved, chosen_option = B
  2. ROADMAP.md: 待决策 → 已决策，更新当前 Initiative
  3. Brain API:
     - 暂停微博相关任务
     - 创建/激活抖音 Initiative
     - 调整任务优先级
```

## 实施步骤

| 步骤 | 内容 | 依赖 |
|------|------|------|
| 1 | 创建 briefings + decisions 数据库表 | 无 |
| 2 | 后端 API: briefing.ts 路由 | Step 1 |
| 3 | 前端 DecisionCenterPage.tsx | Step 2 |
| 4 | navigation.config.ts 注册路由 | Step 3 |
| 5 | C-Suite Skills (/cto, /coo, /cmo) | 可并行 |
| 6 | /morning-briefing 编排 Skill | Step 5 |
| 7 | Brain cron 配置每日触发 | Step 6 |

Step 1-4 是前端工程，Step 5-7 是 Skill 工程，可以并行推进。

## 决策项

| # | 问题 | 建议 |
|---|------|------|
| D1 | 数据库表建在哪？ | 香港 VPS PostgreSQL（与现有业务数据在一起）|
| D2 | 先做最小可用版，还是完整版？ | 建议最小版：晨报展示 + 决策按钮，不含 OKR 图表 |
| D3 | C-Suite Skill 优先做哪几个？ | CTO + COO 先做（有现成数据源），CMO 后补 |
