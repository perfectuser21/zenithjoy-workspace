# Sprint PRD — Line 02 公司信息 Tab 布局 + 智能获客集成 + E2E 真实链路

## OKR 对齐

- **对应 KR**：Line 02 客户智能获客采集闭环（journey `6a2c546f`）
- **当前进度**：已完成机器管理 + 采集任务 Table；本次推进 UI 体验 + E2E 真实化
- **本次推进预期**：公司信息 3 Tab + 自动保存 ✅；智能获客推荐关键词 ✅；E2E 去 mock 转真实链路 ✅

## 背景

PR #949 已落地公司信息 API（`GET/PUT /api/company-profile`）和 DB 表（`tenant_company_profiles`）；PR #952 已落地采集任务列表 API。本 sprint 在此基础上完成前端体验升级和 E2E 真实链路验证，不新增后端接口。

## Golden Path（核心场景）

**入口**：用户进入"公司信息"页

**步骤**：

1. 用户看到 3 个 Tab：**基础信息** / **产品与价值** / **目标客群**
2. 在 Tab 1 填"西安烤鱼馆"、行业"餐饮"、城市"西安"
3. 点击 Tab 2（触发 Tab 1 字段 onBlur 自动保存）→ 右上角出现"已保存 ✓"（1.5s 后消失）
4. 在 Tab 2 填产品"秘制烤鱼"、卖点"20年老配方"，点击 Tab 3 → "已保存 ✓"
5. 刷新页面 → 切回 Tab 1，"西安烤鱼馆"仍在（真实持久化）

**接续路径**：

6. 用户进入"智能获客 → 分析+指派"页
7. 关键词输入区下方显示推荐 chips：`西安餐饮` | `秘制烤鱼西安` | `秘制烤鱼` | `餐饮推荐` | `西安美食推荐`
8. 点"秘制烤鱼" chip → 填入关键词输入框；开场白 placeholder 自动带"西安烤鱼馆…秘制烤鱼"
9. 点"开始采集" → `acquisition_collect_tasks` 写入 1 条 `status=pending` 记录

**出口**：采集任务 Table 显示新记录（关键词="秘制烤鱼"，状态=待执行）

**出错路径**：
- 公司信息未填 → 推荐 chips 区显示灰色提示"先填写公司信息"，非报错
- 自动保存失败（网络）→ toast 红色"保存失败，请重试"

## 边界情况

- 公司信息全空时：推荐关键词 chips 列表为空，显示提示文案
- 自动保存 API 返回非 2xx：toast 错误，不阻塞页面操作
- 多字段同时 blur（Tab 切换）：防抖合并，只发一次 PUT 请求
- 推荐关键词去重：`filter(unique).slice(0, 5)`，相同词不重复展示

## 范围限定

**在范围内**：
- `CompanyProfilePage.tsx` 改 3 Tab 布局
- 每个字段 `onBlur` 触发 `PUT /api/company-profile` 自动保存 + "已保存 ✓" toast
- `AcquisitionConfigPage.tsx` / `CollectTasksBlock` 接入公司信息 API 推荐 chips
- 开场白 placeholder 改为基于公司信息的示例文案（含真实值替换）
- 删除 `line02-company-profile-collect.spec.ts` 所有 `page.route()` stub
- 改写 `line02-company-profile-collect-smoke.sh` 为真实 API + psql 验证

**不在范围内**：
- AI/LLM 扩词（新接口）
- 飞书集成
- 阶段二 DM 触达
- 后端推荐关键词接口（本次纯前端组合逻辑）

## 假设

- [ASSUMPTION: `PUT /api/company-profile` 接受增量字段更新（patch 语义），不要求全量覆盖]
- [ASSUMPTION: staging DB 已有测试租户 `2ac0aa4a-99f4-470a-aed7-c3a9fe03149b` 可写]
- [ASSUMPTION: `tenantContextOptional` 中间件允许 `X-Tenant-Id` header bypass，smoke 脚本可直接指定]

## 预期受影响文件

- `apps/dashboard/src/pages/CompanyProfilePage.tsx`：改 3 Tab 布局 + onBlur 自动保存
- `apps/dashboard/src/components/CollectTasksBlock.tsx`（或同级）：接入公司信息 API + 推荐 chips
- `apps/dashboard/e2e/line02-company-profile-collect.spec.ts`：删 mock，改真实链路
- `.github/workflows/scripts/smoke/line02-company-profile-collect-smoke.sh`：改真实 API + psql

## NFR 约束

<!-- 来源: decisions 表 category=nfr（空）+ PrepPRD 显式值 -->
- 自动保存防抖延迟：onBlur 触发（无 debounce，每次 blur 各自触发一次 PUT）
- "已保存 ✓" toast 显示时长：1.5s 后消失
- 推荐关键词数量上限：最多 5 个（去重后 slice）
- 版本要求：无（纯前端 + 已有后端接口）
- 可观测：保存失败必须 toast 红色提示用户

## E2E 验收

> Proposer 在 GAN 阶段按 `windows_cloud` 模板填入真实 PowerShell/.ps1 脚本；以下为期望验收点（自然语言），供 proposer 翻译成命令。

```bash
# 占位：proposer 将按 target_environment=windows_cloud 填入 .ps1 脚本
# 期望验收点：
# 1. smoke: PUT /api/company-profile → psql SELECT FROM zenithjoy.tenant_company_profiles WHERE company_name='烟雨楼测试公司' 有记录
# 2. smoke: GET /api/company-profile → 返回 company_name 匹配刚写入的值
# 3. smoke: POST /api/acquisition/collect/start {keywords:["smoke-keyword"]} → psql SELECT FROM zenithjoy.acquisition_collect_tasks WHERE status='pending' 有记录
# 4. smoke: GET /api/acquisition/collect-tasks → 返回 tasks 数组非空
# 5. playwright: navigate /company-profile → 显示 3 个 Tab
# 6. playwright: 在 Tab 1 填"烟雨楼测试公司" → 点 Tab 2（触发 onBlur 自动保存）→ "已保存 ✓" 出现
# 7. playwright: 刷新页面 → Tab 1 的公司名仍为"烟雨楼测试公司"
# 8. playwright: navigate /dashboard/acquisition-config → 推荐关键词 chips 出现（数量 ≥1）
```

## journey_type: user_facing
## journey_type_reason: 涉及 apps/dashboard/ 的 CompanyProfilePage.tsx 和 AcquisitionConfigPage.tsx 前端页面交互
## target_environment: windows_cloud
## target_environment_reason: ZenithJoy Dashboard 产品，走 GitHub Actions windows-latest 干净 VM 执行 Playwright E2E
## journey_id: line02
## step_id: L02-S3
