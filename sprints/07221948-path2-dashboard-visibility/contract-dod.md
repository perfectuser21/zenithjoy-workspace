# Contract DoD — Path2 Dashboard展示与人工干预能力建设

**Task ID**: 7cb465c1-03cc-4934-a638-e61f78195d37
**Sprint**: 07221948-path2-dashboard-visibility
**Date**: 2026-07-24

---

## Definition of Done 清单

### 层级 1：DB Migration

- [ ] `20260724_path2_device_type_align.sql` migration 文件存在于 `apps/api/migrations/` 或等价目录
- [ ] migration 含 `ADD COLUMN IF NOT EXISTS agent_os_type text`（幂等）
- [ ] migration 含 `CREATE INDEX IF NOT EXISTS idx_dm_assign_tenant_lead_updated ON zenithjoy.dm_assignments(tenant_id, lead_id, updated_at DESC)`（幂等）
- [ ] migration 对应 COLUMN COMMENT 描述语义隔离（与 `device_type` 区分）
- [ ] psql 断言 C-14 通过：`information_schema.columns` 确认字段存在
- [ ] psql 断言 C-03 通过：`pg_indexes` 确认索引存在

### 层级 2：后端 API

- [ ] `GET /api/acquisition/leads` 响应新增 `outreach_status` 字段（C-01 通过）
  - LATERAL 子查询从 `dm_assignments` 取最新行（`updated_at DESC LIMIT 1`）
  - 值域严格限定：`queued|dispatched|sent|limited|failed|cancelled|pending_dispatch|null`
- [ ] 有 `dm_assignment` 的 lead，`outreach_status` 非 null（C-02 通过）
- [ ] `GET /api/acquisition/manual-outreach/candidates` 端点新建（C-05 通过）
  - HTTP 200，`data.accounts[]`，`data.default_message` 非空字符串
  - 在线判定：`agents.last_heartbeat_at > NOW() - interval '5 minutes'`
  - 排序：`is_online DESC, last_seen_at DESC`
  - `tenantContextOptional` 中间件保护（C-07 验证：无 session → 401）
- [ ] `POST /api/acquisition/manual-outreach` 端点新建（C-06 通过）
  - 写 `dm_assignments` ON CONFLICT DO UPDATE（幂等）
  - 重复提交不报 409/500，行数保持 1（C-06 psql 验证）
  - 无 tenant session → 401（C-07）
- [ ] `GET /api/install-pack/manifest` 返回 `apk_url` 非空且以 `http` 开头（C-09 通过）
  - 注意：端点已存在，仅验证字段非空
- [ ] `POST /api/acquisition/collect/start` 新增关键词去重检查（C-11 C-12 通过）
  - 30 天内命中且无 `force:true` → 409 `KEYWORD_RECENTLY_USED`，含 `matched_keywords` + `last_used_at`
  - 带 `force:true` → 200，`data.task_id` 非空
  - `cancelling` 态任务不受本改动影响
- [ ] `GET /api/acquisition/collect-tasks` 新增 `error_code_message` + `agent_os_type` 字段（C-15 通过）
  - `error_code_message`：后端翻译，前端不重复维护
  - `agent_os_type`：从 `acquisition_collect_tasks.agent_os_type` 直接透传
- [ ] `POST /api/acquisition/collect/start` 在写 `acquisition_collect_tasks` 时冗余写 `agent_os_type`（从 `agents.os_type`）
- [ ] 所有新端点携带 `tenant_id` 过滤（Invariant #8）
- [ ] 单元/集成测试（vitest）覆盖上述新逻辑

### 层级 3：前端 UI

- [ ] `LeadsTable.tsx`（或 `LeadsPage.tsx`）展示 `outreach_status` 徽标列（C-04 通过）
  - null → 灰色"未触达"；sent → 绿色"已触达"；queued|dispatched|pending_dispatch → 蓝色"待触达"；limited|failed|cancelled → 橙/红色"待重试"
  - 现有 `outreach_eligible` 列保留不变
- [ ] 获客列表每行新增"人工触达"按钮（C-08 通过）
  - 点击 → 弹窗含：小号选择列表（默认选第一个在线号）+ 话术文本框（默认填 `default_message`）
  - 确认时调 `POST /api/acquisition/manual-outreach`
  - 提交中态：确认按钮 disabled + loading 指示
- [ ] `AcquisitionAccountsPage.tsx` Android 绑定区域新增"下载安卓客户端"入口（C-10 通过）
  - 点击 → 从 `GET /api/install-pack/manifest` 取 `apk_url` → 浏览器跳转
  - 不硬编码 APK URL
- [ ] `AcquisitionTasksPage.tsx` 采集发起前触发去重检查（C-13 通过）
  - 收到 409 `KEYWORD_RECENTLY_USED` → 弹确认对话框，含关键词名和天数
  - 用户选"继续" → 带 `force:true` 重发；选"取消" → 关闭
- [ ] `AcquisitionTasksPage.tsx` 任务列表状态徽标 + 错误原因展示（C-16 通过）
  - `failed|partial` 态展示 `error_code_message` + "重试"按钮
  - `cancelling` 态重试按钮 disabled + 展示"正在取消..."（C-17 通过）

### 层级 4：Smoke Tests（golden-path-2-smoke.sh）

- [ ] Step 25（触达状态）脚本存在且通过
  - `GET /api/acquisition/leads` 返回含 `outreach_status` 字段（合法值域或 null）
- [ ] Step 26（人工触达 API）脚本存在且通过
  - 26a: candidates 端点 200 + accounts 数组 + default_message 非空
  - 26b: manual-outreach 写入幂等（重复提交 200，DB 行数=1）
- [ ] Step 27（APK 下载入口）脚本存在且通过
  - install-pack/manifest 返回 HTTP 200 + apk_url 以 http 开头非空
- [ ] Step 28（关键词去重）脚本存在且通过
  - 28a: 重复关键词 → 409 + KEYWORD_RECENTLY_USED + matched_keywords + last_used_at
  - 28b: force=true → 200 + task_id 非空
- [ ] Step 29（设备类型埋点）脚本存在且通过
  - information_schema 确认 agent_os_type 字段存在

### 层级 5：Playwright E2E（Dashboard UI）

- [ ] `sprints/07221948-path2-dashboard-visibility/tests/contract-ui.spec.ts`（或等价路径）包含 C-04 C-08 C-10 C-13 C-16 C-17 的 Playwright 测试骨架
- [ ] 已有 `apps/dashboard/e2e/leads-unified-table.spec.ts` 的"触达状态"列头断言覆盖 C-04（现有）
- [ ] 新增 `apps/dashboard/e2e/acquisition-outreach-manual.spec.ts` 覆盖 C-08（人工触达弹窗）
- [ ] 新增 `apps/dashboard/e2e/acquisition-accounts-apk.spec.ts` 覆盖 C-10（APK 下载入口）
- [ ] 新增 `apps/dashboard/e2e/acquisition-tasks-progress.spec.ts` 覆盖 C-13 C-16 C-17（进度展示+去重提示）

### 层级 6：CI 与代码质量

- [ ] `lint-feature-has-smoke`：无新的 feat: PR 只改 src 而无 smoke 的情况
- [ ] `lint-tdd-commit-order`：smoke/E2E 在实现之前 commit（commit-1 先行）
- [ ] ESLint 检查通过（无新的 error/warn）
- [ ] TypeScript 编译无新增错误
- [ ] 无新增 console.log / 注释代码 / 未用 import
- [ ] CI 全绿（windows_cloud runner）

---

## 完成判定

**全部 17 个合同断言（C-01 至 C-17）通过 = sprint DONE**

回归要求：现有 golden-path-2-smoke.sh Step 1-24 全绿不可退步。

---

## 验收人

- 技术验收：CI windows_cloud runner 全绿
- 产品验收：`sprints/07221948-path2-dashboard-visibility/` 下 contract-draft.md 所列断言全通过
