# Sprint PRD — Line02 获客工作台 IA 重设计（AcquisitionHubPage 4模块 + AccountsPage + TasksPage 两级）

## OKR 对齐

- **对应 KR**：Line02 客户智能获客路径（journey_id: afa6abca-53c0-4815-8594-b7fb81ca547f）
- **当前进度**：skeleton
- **本次推进预期**：thin → medium（采集闭环 feature）；机器管理 feature UI 面 thin 不变

## 背景

AcquisitionHubPage 当前是4步向导式，客户进入后不知道各功能入口在哪。采集任务数据混在 LeadsPage，TasksPage 尚不存在。视频维度数据（标题/封面/日期）缺少存储表和抓取逻辑。本 Sprint 对 IA 做最小化重构：Hub 改卡片入口、独立两个子页、补视频元数据链路。

## Golden Path（核心场景）

```
Step 1: 客户点左侧「智能获客」→ 看到4个模块卡片（账号管理/采集任务/客户分析-占位/触达中心-占位），
        账号+采集卡片显示本 tenant 实时数字（小号数/任务数）

Step 2: 客户点「账号管理」→ 路由跳转 /area/acquisition/accounts
        → 看到本 tenant 已绑小号列表（昵称/绑定时间/健康状态 ok|expired|banned）
        → 无小号 → 引导文案 + 「绑定新小号」按钮

Step 3: 客户点「绑定新小号」→ 已达 N=10 上限 → 按钮置灰+提示升级套餐；
        否则弹二维码 → 扫码成功 → 列表新增一行；
        超时/失败 → toast 提示重试

Step 4: 客户点「采集任务」→ 路由跳转 /area/acquisition/tasks
        → 看到关键词输入框 + 本 tenant 历史任务列表（关键词/状态/视频数/leads数/创建时间）
        → 数据来源 acquisition_collect_tasks（非旧 keyword_tasks）

Step 5: 客户输入关键词 → 点「开始采集」→ POST /collect/start
        → 列表出现新任务 pending/running；
        触发失败（无小号/agent离线）→ toast 报错

Step 6: 客户点某任务行 → 路由跳转 /area/acquisition/tasks/:taskId
        → 看到该任务下视频卡片列表（标题/封面/日期，回填失败降级只显示视频链接）
        → 数据来源 GET /api/acquisition/collect-tasks/:id/videos（新建，tenant过滤+IDOR校验）

Step 7: 客户展开某视频卡片 → 看到该视频命中的 leads 列表（昵称/留言/AI分级占位/触达状态占位）
        → 数据来源 GET /api/acquisition/videos/:videoId/leads（新建，tenant过滤+IDOR校验）
        → 评论为空 → 「暂无评论」占位文案

Step 8 (失败恢复): 任务长时间无进展（sweep-timeouts 已转失败态）
        → 前端展示失败原因 + 「重新采集」按钮（复用 POST /collect/start 同关键词）
```

## 边界情况

- AccountsPage 无小号 → 空态引导，不展示表格
- N=10 上限 → 「绑定新小号」按钮置灰 + tooltip 提示套餐
- 健康状态三态：ok（绿）/ expired（黄）/ banned（红）
- 视频元数据抓取失败 → 标题/封面/日期字段为 null → 降级显示视频链接 URL
- 跨 tenant 访问 `/videos/:id/leads` 或 `/:taskId/videos` → 401/403（IDOR 校验）
- 非法 taskId → 404

## 范围限定

**在范围内**：
- AcquisitionHubPage 改4模块入口卡片（账号/采集/分析占位/触达占位）
- AccountsPage（`/area/acquisition/accounts`）：复用 GET /api/agent/burner/sessions + 扫码绑定逻辑
- TasksPage 一级（`/area/acquisition/tasks`）：改接 acquisition_collect_tasks，保留关键词输入+开始采集
- TasksPage 二级（`/area/acquisition/tasks/:taskId`）：视频卡片 + leads 展开
- 新建 GET /api/acquisition/collect-tasks/:id/videos（tenant过滤+IDOR）
- 新建 GET /api/acquisition/videos/:videoId/leads（tenant过滤+IDOR）
- 新建 acquisition_collect_videos 表（video_id/task_id/tenant_id/title/thumbnail_url/publish_date/comment_count）
- services/agent 抖音搜索抓取补 title/thumbnail/publish_date 选择器
- LeadsPage 移除采集面板，只留历史 leads 表格
- DouyinBurnerBindPage UI 层废弃（扫码逻辑迁入 AccountsPage）

**不在范围内**：
- 客户分析/触达中心内容实现（只做占位卡片）
- 采集进度实时推送（WebSocket）
- 旧 GET /api/acquisition/leads 无 tenant 过滤历史 bug（另开 ticket）
- Track B 评论文本修复（另立 sprint）
- 独立 retry 接口（失败重试复用 POST /collect/start）

## 假设

- [ASSUMPTION: DouyinBurnerBindPage 废弃 = 删除页面组件 + 路由 redirect 到 /area/acquisition/accounts，防止旧链接404]
- [ASSUMPTION: acquisition_collect_videos 主键 video_id 即抖音视频ID字符串，task_id FK → acquisition_collect_tasks，tenant_id 与 task 保持一致]
- [ASSUMPTION: Hub 卡片实时数字（小号数/任务数）轮询间隔无要求，thin 阶段页面加载时单次请求即可]
- [ASSUMPTION: agent 端 .cjs 对照版与 .ts 版同步修改（两文件并存）]

## 预期受影响文件

- `apps/dashboard/src/pages/acquisition/AcquisitionHubPage.tsx`：改卡片布局
- `apps/dashboard/src/pages/acquisition/AccountsPage.tsx`：新建
- `apps/dashboard/src/pages/acquisition/TasksPage.tsx`：改接新表 + 新建二级视图
- `apps/dashboard/src/pages/acquisition/LeadsPage.tsx`：移除采集面板
- `apps/dashboard/src/pages/acquisition/DouyinBurnerBindPage.tsx`：废弃（或 redirect）
- `apps/dashboard/src/router/`（或路由定义文件）：注册新路由 + redirect
- `apps/api/src/routes/acquisition.*`：新增2个GET端点
- `apps/api/src/db/migrations/`：新建 acquisition_collect_videos 表 migration
- `services/agent/src/handlers/keyword-search-douyin.ts`：补 DOM 选择器
- `services/agent/src/handlers/keyword-search-douyin.cjs`：同步补 DOM 选择器

## NFR 约束

<!-- 来源: decisions 表 category=nfr（空），PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 无（thin 阶段不新增频控）
- 版本要求: 无新增
- 可观测: 视频元数据抓取失败需在 agent 日志记录降级原因

## E2E 验收

> 最终可执行 E2E 脚本由 proposer 在 GAN 阶段产出（target_environment=windows_cloud → GitHub Actions Playwright .spec.ts）。

```bash
# 占位：proposer 将按 windows_cloud 模板填入 Playwright .spec.ts
# 期望验收点（自然语言）：
# 1. 左侧点「智能获客」→ 4张卡片可见，账号/采集卡片数字非空
# 2. 点「账号管理」→ AccountsPage 渲染；空态/有数据/N=10上限三态截图验证（健康状态三色）
# 3. 点「采集任务」→ TasksPage 一级任务列表渲染（来源 acquisition_collect_tasks）
# 4. 点某任务行 → 二级视频卡片列表渲染；有标题/封面则展示，无则降级显示链接
# 5. 展开视频卡片 → leads 列表；无评论则显示「暂无评论」
# 6. 跨 tenant 访问 /videos/:id/leads 和 /:taskId/videos → 401/403；非法ID → 404
# 7. LeadsPage 无采集面板 DOM 节点
# CI 全绿（windows_cloud GitHub Actions）
```

## journey_type: user_facing
## journey_type_reason: 涉及 apps/dashboard/ 多个页面组件（AcquisitionHubPage/AccountsPage/TasksPage/LeadsPage）
## target_environment: windows_cloud
## target_environment_reason: ZenithJoy Dashboard E2E 统一走 GitHub Actions windows-latest runner（干净 VM Playwright 沙箱）
## journey_id: afa6abca-53c0-4815-8594-b7fb81ca547f
## step_id: L02-Hub-IA（AcquisitionHubPage 4模块 + AccountsPage + TasksPage 两级；PrepPRD Step1-8）

{"verdict":"DONE","sprint_dir":"sprints/07021006-acquisition-ia-redesign"}
