# Sprint PRD — Line 02 公司信息页 + 采集任务 Table + 主号全链

## OKR 对齐

- **对应 KR**：Line 02 客户智能获客采集闭环（ability `6a2c546f`）
- **当前进度**：stub（line02 模块未真实执行）
- **本次推进预期**：thin → working（公司信息页可保存 + 点关键词触发全链采集）

## 背景

Line 02 获客路径当前 line02/index.ts 是 stub，keyword-search 用了 burner 账号 profile，没有公司信息存储、没有采集任务 Table。本 sprint 完成三件事：①新建公司信息页（tenant 隔离）；②Dashboard Line 02 采集页补齐获客配置 + 采集任务 Table；③Agent line02 模块从 stub 变真实，主号全链跑通（keyword-search→视频→评论→commenter 主页→acquisition_leads）。

## Golden Path（核心场景）

**入口**：用户在 Dashboard 公司信息页填写信息并保存，然后进入 Line 02 采集页点击关键词触发采集

**关键步骤**：

```
Step 1: 用户进"公司信息"页
        → 填写公司名 / 所在城市 / 行业（下拉） / 一句话介绍
        → Section 2：主营产品（多条增删） / 核心卖点（1-3条） / 解决客户问题
        → Section 3：客户画像描述 / 客户常见 Q&A（多条增删）
        → 点"保存" → Toast"已保存"
        → 刷新后数据仍在（租户隔离正确）

Step 2: 用户进 Line 02 采集页
        → 顶部账号状态块：live101942 ✅已登录 / 小号 ✅已登录
        → 获客配置区：填关键词"西安美食" / 引流微信号 / 开场白模板
        → 点"开始采集"按钮

Step 3: 采集任务 Table 新增一行
        → 列：关键词 / 状态（待执行→阶段一进行中）/ 创建时间 / 阶段一结束时间 / 视频数 / Lead 数
        → Agent（rog）轮询到任务 → 主号 Chrome（live101942，role='main'）打开
        → 搜索关键词 → 找到视频 URL → 写 acquisition_videos
        → Table 视频数实时更新

Step 4: 主号依次进入每个视频评论区
        → 逐个点评论者头像 → 进主页 → 抓取 nickname / sec_uid / 头像 / 简介 / 粉丝数 / 地区
        → 写 acquisition_leads
        → Table Lead 数实时递增

Step 5: 全部视频处理完
        → Table 状态 = "阶段一完成" | 结束时间 | 视频数 N | Lead 数 M
        → "启动阶段二"按钮高亮（本次仅 UI 占位，不触发）
```

**出口**：Table 显示阶段一完成，acquisition_leads 有真实抖音用户的 sec_uid + nickname，公司信息刷新后仍在

**出错路径**：
- 主号 session 失效 → 重定向到登录页 → Table 状态 = "失败：主号登录态过期" → 账号状态块变红"需重扫"

## 边界情况

- 无关键词时"开始采集"按钮禁用
- 主号未绑定时采集任务写入后立即标记 failed
- 公司信息首次访问为空表单（非 404）
- tenant_id 不同的租户数据完全隔离，禁止跨租户读写

## 范围限定

**在范围内**：
- `zenithjoy.tenant_company_profiles` 表新建（tenant_id PK） + GET/PUT API
- Dashboard 公司信息页（单页三 Section）
- Line 02 采集页：账号状态块 + 获客配置（关键词/引流号/开场白） + 采集任务 Table
- `crawl-comments-douyin.cjs`：视频 URL → 主号 Chrome → 展开评论 → commenter 主页 → 写 leads
- `line02/index.js`：轮询 pending-collect-tasks → keyword-search（主号）→ crawl-comments → 上报
- `keyword-search-douyin.cjs`：修正为从 role='main' 账号的 Chrome profile 路径读取

**不在范围内**：
- 阶段二小号发 DM 的触发逻辑（"启动阶段二"仅 UI 占位）
- Lead 评分 / 去重算法
- Q&A 知识库独立页面
- 竞品账号对标分析
- 采集频控精调

## NFR 约束

<!-- 来源: PrepPRD 显式值 -->
- 超时/延迟：commenter 主页抓取每页 ≤30s（PrepPRD 未明确，待 proposer 与用户确认）
- 频控：待定（PrepPRD 未指定单次采集并发上限）
- 版本要求：Agent v2.0.40+（已在 rog 运行）
- 可观测：采集状态实时回报 collect/report；失败必须写 Table 状态字段 + 账号状态块变红

## 假设

- [ASSUMPTION: live101942 的 Chrome profile 路径 = `C:\Temp\zj-douyin-burner-v1\live101942`，由 rog `.env` 注入，Generator 直接读环境变量]
- [ASSUMPTION: `acquisition_collect_tasks` 表已存在 staging DB，Generator 只需确认字段；不需新建]
- [ASSUMPTION: 公司信息页路由 = `/company-profile`，挂在 Dashboard 主导航下]
- [ASSUMPTION: `tenantContextOptional` 中间件已就绪，API 从 X-Tenant-Id header 读 tenant_id]

## 预期受影响文件

- `apps/dashboard/src/pages/CompanyProfilePage.tsx`：新建，公司信息三 Section 页
- `apps/dashboard/src/pages/AcquisitionConfigPage.tsx`：补充账号状态块 + 采集任务 Table
- `apps/dashboard/src/api/company-profile.api.ts`：新建，GET/PUT /api/company-profile
- `apps/api/src/routes/company-profile.ts`：新建，GET/PUT handler + DB 操作
- `apps/api/src/migrations/`：新建 migration 建 `zenithjoy.tenant_company_profiles`
- `services/agent/modules/line02/index.ts`：从 stub 改为真实轮询 + 全链调用（编译为 .js 上传 COS）
- `services/agent/publishers/keyword-search-douyin.cjs`：修正使用 role='main' profile 路径
- `services/agent/publishers/crawl-comments-douyin.cjs`：新建，评论→commenter 主页→leads

## E2E 验收

> Planner 初稿此区块为自然语言描述，proposer 在 GAN 阶段补全可执行 .ps1 脚本（target_environment = windows_cloud）。

```bash
# 期望验收点（proposer 翻译为 windows-latest .ps1）：
# 1. PUT /api/company-profile（tenant_id=2ac0aa4a-99f4-470a-aed7-c3a9fe03149b）
#    → 数据库 SELECT FROM zenithjoy.tenant_company_profiles WHERE tenant_id='2ac0aa4a-...' 有记录
# 2. GET /api/company-profile（相同 tenant_id）→ 返回刚写入的字段
# 3. POST /api/line02/collect-tasks（关键词="smoke-keyword"）
#    → acquisition_collect_tasks 写入 1 条 pending 记录
# 4. （E2E mock agent 执行）acquisition_videos 写入 ≥1 条 smoke-keyword 相关记录
# 5. acquisition_leads 写入 ≥1 条（有 sec_uid + nickname 字段非空）
# 6. collect_tasks 状态最终 = "stage_1_done"，视频数 ≥1，lead 数 ≥1
# 7. 账号状态块 API（GET /api/line02/account-status）返回 live101942 health 字段
# 所有 curl 请求带 X-Tenant-Id: 2ac0aa4a-99f4-470a-aed7-c3a9fe03149b header
```

## journey_type: user_facing
## journey_type_reason: 涉及 apps/dashboard/ 前端公司信息页 + Line 02 采集页，用户直接操作 Dashboard
## target_environment: windows_cloud
## target_environment_reason: ZenithJoy Dashboard 产品，走 GitHub Actions windows-latest runner 跑 E2E（干净 sandbox，无历史状态）
## journey_id: line02
## step_id: L02-S3（客户智能获客采集闭环 — 全链执行阶段）
