# Sprint PRD — Line 04 CRM 客户列表页 Glide 重做（第一刀·仅列表）

## OKR 对齐

- **对应 KR**：Line 04 客户私域 AI 接管 — 中台 AI-native CRM 可用性
- **当前进度**：CRM 列表页为裸 HTML 表格（功能在但无设计感）
- **本次推进预期**：列表页升级为暗色 AI 运营台呈现（详情页留第二刀）

## 背景

中台 CRM 客户列表页现为裸 HTML 表格，难看、无意向色阶、无筛选。本刀把 `CustomerListPage` 用 Glide Data Grid 重做成暗色运营台风格，接已就绪的 `GET /api/crm/customers` 真数据，加搜索 + A1-A5 意向筛选 + 身份筛选（前端过滤）。详情页肖像化为独立第二刀，本刀不动。预览已用户确认：https://cn.zenjoymedia.media/reports/crm-preview/

## Golden Path（核心场景）

运营从 [打开 CRM 列表页] → 经过 [搜索/意向筛选/身份筛选] → 到达 [一眼看出每个客户推进阶段并跳转详情]

具体：
1. 运营打开 Dashboard CRM 页 → 暗色运营台：顶部概览 + 搜索框 + A1-A5 意向筛选条 + 身份筛选 + Glide 客户表（真数据，意向色阶 A1 灰 → A5 绿），「N 位客户」计数 = 真数据条数（>0）
2. 运营在搜索框输客户名/微信号 → 表格实时前端过滤 → 「N 位客户」计数下降到匹配数
3. 运营点 A4 意向 chip → 表格只剩该意向客户 → 计数变为该意向客户数；再点身份筛选叠加 → 计数相应变化
4. 运营点客户名 → 跳现有详情页路由（详情重做在第二刀）

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不负责定义技术规范。 -->

## 边界情况

- 列表接口 401 / 掉线 → 现有 authExpired / error 降级行为保留，不白屏
- 空数据 / 搜索无匹配 → 计数显示 0，表格容器仍在，不报错
- Glide canvas 需 `import '@glideapps/glide-data-grid/dist/index.css'`，否则 canvas 空白（已踩坑）

## 范围限定

**在范围内**：
- `CustomerListPage` 用 Glide Data Grid 重做暗色运营台呈现
- 接 `GET /api/crm/customers` 真数据替换裸 HTML 表格
- 搜索 + A1-A5 意向筛选 + 身份筛选（全部前端客户端过滤）
- 「N 位客户」计数随过滤实时同步

**不在范围内**：
- 详情页 `CustomerProfilePage` 肖像化（第二刀）
- 全屏 / 隐藏侧边栏（独立小改动另开）
- 任何后端 / API 改动（筛选纯前端）

## 假设

- [ASSUMPTION: `GET /api/crm/customers` 返回字段含客户名、微信号、意向等级（A1-A5）、身份，足以支撑前端搜索与筛选；具体字段名 Proposer 读 api_registry 确认]
- [ASSUMPTION: 客户名/微信号点击跳转的现有详情路由保持不变]

## 预期受影响文件

- `apps/dashboard/src/pages/CustomerListPage.tsx`：裸表替换为 Glide Data Grid + 搜索/筛选 UI
- `apps/dashboard/package.json` + `package-lock.json`：加 `@glideapps/glide-data-grid@6.0.3`（MIT），同步 lock 供 CI `npm ci`
- `apps/dashboard/e2e/crm-customer-list.spec.ts`：canvas E2E 用 DOM 计数断言（不测 canvas 文字）
- `apps/dashboard/src/pages/__tests__/CustomerListPage.test.tsx`：unit 同步
- `.github/workflows/scripts/smoke/`：新增 crm 列表 smoke 接入 CI windows e2e job

## NFR 约束

<!-- 来源: decisions 表 category=nfr（空）+ PrepPRD；PrepPRD 显式值优先 -->
- 筛选实现：前端客户端过滤（PrepPRD 拍板，零后端改动）
- 兼容：必须 import Glide 的 index.css，否则 canvas 空白
- 可观测：列表 401/掉线复用现有 authExpired/error 降级，不白屏

## E2E 验收

> Planner 初稿留占位。最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=windows_cloud 产出（Playwright .spec / windows e2e job + smoke.sh）。canvas 不测文字，测真实 DOM 可见状态变化。

```bash
# 占位：proposer 将按 target_environment=windows_cloud 填入真实脚本（Playwright + windows e2e job + smoke.sh）
# 期望验收点（自然语言）：
#  1. 列表页加载后「N 位客户」计数 = 真数据条数（>0），表格容器 data-testid 存在
#  2. 输入搜索词 → 计数下降到匹配数
#  3. 点 A4 意向 chip → 计数变为该意向客户数
#  4. 点身份筛选 → 计数相应变化
#  5. smoke.sh 接入 CI + windows e2e job，CI 全绿
```

## journey_type: user_facing
## journey_type_reason: 涉及 apps/dashboard/ 前端页面，命中 user_facing 优先级链第一条
## target_environment: windows_cloud
## target_environment_reason: ZenithJoy Dashboard UI，E2E 走 GitHub Actions windows-latest（VITE_SKIP_AUTH，CRM 路由 requireAuth:false 可直达）
## journey_id: 35ac40c2-ba63-81af-af97-e3bc8e3b0fb4
## step_id: L04-CRM-customer-list（feature_id ca5fe5ec-7cab-418f-a3f6-d64287679e0c）
