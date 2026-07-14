# Design: Path2 + Path4 彻底去飞书改本地

## 背景
用户决策（19e6480c + 对话内追加）：Path2（智能获客）和 Path4（私域AI接管）都不再需要飞书，草稿/画像/排期/名单全部改本地数据库。前提核实：Path2 的黄金路径在 2026-07-14（PR#1279）已重写为"8步本地版"，实际的评论→Lead 写入早已改走本地 `zenithjoy.acquisition_leads`（`acquisition.ts`），飞书相关的 Path2 代码已经是死代码，只是没删。Path4 的朋友圈草稿（`generateMomentDraft`）目前仍直接调用飞书 Bitable，没有替代实现。

## 范围

### A. Path4：营销画像/内容排期切本地（新增能力）
- 新迁移 `packages/db`（或 `apps/api/db/migrations`，沿用仓库既有迁移目录）建表 `zenithjoy.wechat_marketing_profile(id, tenant_id, customer, industry, audience, hook, created_at, updated_at)`，`(tenant_id, customer)` 唯一索引
- `apps/api/src/services/wechat-draft.ts`：
  - 删除 `getFeishuTenantToken`/`getFeishuAppId`/`getFeishuAppSecret`/`getAppToken`/`getProfileTableId`/`getScheduleTableId`/`searchTable`/`createRecord`/`_resetFeishuTokenCache`/`FeishuRecord`/`FeishuSearchResp`/`FeishuCreateRecordResp`/`cachedToken` 及 `FEISHU_API_BASE` 常量
  - `generateMomentDraft` 步骤1改为 `SELECT industry, audience, hook FROM zenithjoy.wechat_marketing_profile WHERE tenant_id=$1 AND customer=$2`，查无行→`profile_missing`
  - 原步骤4（写飞书"内容排期"）整段删除；`wechat_publish_task` 写入去掉 `feishu_record_id` 字段（列保留，写 NULL，避免额外迁移）
- `apps/api/src/services/__tests__/wechat-draft-schema-prefix.test.ts`：把 mock 飞书 axios 的部分改成直接 seed `wechat_marketing_profile` 表数据

### B. Path2：删除已死的飞书 Bitable 代码
确认死代码（无生产调用方，已被 `acquisition.ts` / `AcquisitionHubPage` 本地实现取代）：
- `apps/api/src/services/feishu-bitable-multitenant.ts` + `.test.ts`
- `apps/api/src/routes/lead-config.ts` + `.test.ts`（从 `app.ts` 摘除挂载）
- `apps/api/src/routes/_smoke-feishu-seed.ts`（从 `app.ts` 摘除挂载，若有）
- `apps/api/src/routes/feishu-customer-list.ts` + `.test.ts`，`apps/api/src/services/feishu-customer-list.ts` + `.test.ts`（从 `app.ts` 摘除挂载）
- `apps/api/src/services/feishu-docx.ts` + `.test.ts`（仅被 `feishu-bitable-multitenant.ts` 引用，随其一起删）
- `apps/dashboard/src/pages/FeishuBindTenant.tsx`，`apps/dashboard/src/config/navigation.config.ts` 里的 `feishu-bind` 路由条目，`apps/dashboard/src/App.tsx` 里的懒加载引用
- `apps/api/src/routes/agent-burner.ts`：删掉未使用的 `writeLeadsFromComments` import（`writeDmOutreachStatus` 保留，见下方"不动"）
- `apps/api/src/services/lead-writer.ts`：删除 `writeLeadsFromComments` 函数本体（连带其专属 helper，若有独占的），保留 `writeDmOutreachStatus`

### 不动（明确排除，附理由）
- `feishu-oauth.ts` / `feishu-token.ts` / `tenant-context.ts` 里 `feishu_user_id` 反查——这是登录身份识别机制，跟 Bitable 数据表无关，删除会破坏登录
- `lead-writer.ts` 的 `writeDmOutreachStatus` + 其在 `agent-burner.ts` 的调用点——仍是活代码（DM触达状态回写），只在租户存量 `table_id_leads` 绑定时触发；`FeishuBindTenant` 删除后不会再产生新绑定，老绑定的租户这段代码继续优雅降级（失败不 crash），本刀不额外处理
- `apps/api/src/services/feishu-bitable.ts`（单租户版，`FEISHU_COMPETITOR_APP_TOKEN`/`FEISHU_COMPETITOR_TABLE_ID` 对标视频表）——未在本次范围内核实完，留后续小刀单独处理
- `FEISHU_ALERT_WEBHOOK`/`FEISHU_NOTIFY_WEBHOOK`/`FEISHU_STATE_SECRET` 等告警/OAuth 相关 env——与 Bitable 数据表无关

### C. env-registry.ts 清理
删除条目（确认本刀改动后全局无引用）：`FEISHU_PATH4_APP_TOKEN`、`FEISHU_PROFILE_TABLE_ID`、`FEISHU_SCHEDULE_TABLE_ID`、`FEISHU_TEST_APP_TOKEN`、`FEISHU_TABLE_ID_LEADS`（若确认 lead-config 删除后无引用）。实现阶段以 `grep -rn` 全局验证为准，不确定的条目宁可留着不删。

## 验收标准
- [ ] `wechat_marketing_profile` 迁移建表成功
- [ ] `generateMomentDraft` 单测：本地表有画像→生成成功；无画像→`profile_missing`；不再 mock 任何飞书 axios 调用
- [ ] 全局 `grep -rn "FEISHU_PROFILE_TABLE_ID\|FEISHU_SCHEDULE_TABLE_ID\|FEISHU_PATH4_APP_TOKEN" apps/` 零命中
- [ ] `feishu-bitable-multitenant.ts`/`lead-config.ts`/`FeishuBindTenant.tsx`/`feishu-customer-list.ts`/`feishu-docx.ts` 及其测试文件已删除，`app.ts`/`navigation.config.ts`/`App.tsx` 摘除对应挂载/引用
- [ ] `writeLeadsFromComments` 全仓库零引用（含测试文件同步清理或改为测 `writeDmOutreachStatus`）
- [ ] `npm run typecheck`（apps/api + apps/dashboard）全绿
- [ ] CI 全绿（含 golden-path-2-smoke、golden-path-4-smoke）
