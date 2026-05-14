# Path 4 Sprint 1 WS2 — 飞书 Bitable 审批表

**日期**: 2026-05-14  
**分支**: cp-0514095930-path4-sprint1-ws2-feishu-bitable  
**关联 Journey**: Path 4 私域运营 → Step 2 飞书审批入口  

---

## 目标

微信发布任务创建后，自动在飞书多维表格（Bitable）写入一行审批记录，运营人员在飞书侧审批内容后，状态写回 `wechat_publish_task`。

WS2 只做**第一步**：建表 + 单向推送（PG → 飞书）。飞书 webhook 回调（飞书 → PG 反向同步）留给 WS5。

---

## 架构

### 数据流（WS2 范围）

```
POST /api/wechat/draft-submit
  └─ INSERT zenithjoy.wechat_publish_task
       └─ pushWechatTaskToFeishu(taskId, tenantId)
            └─ Feishu Bitable API: create_record → table_id_wechat_approval
                 └─ UPDATE wechat_publish_task SET feishu_record_id = <record_id>
```

### 现有模式复用

`feishu-bitable-multitenant.ts` 已有：
- `provisionBitable(tenantId)` 建 1 Bitable 文档 + 3 张 Lead 表
- `writeRecord(tenantId, tableId, fields)` 通用写入
- `getValidToken(tenantId)` 自动续 token

WS2 在这个文件里扩展，不新建服务文件。

---

## 变更清单

### 1. DB 迁移

**文件**: `apps/api/db/migrations/20260514_XXXXXX_feishu_wechat_approval_table.sql`

```sql
-- 在 tenant_feishu_bindings 加第 4 张表 ID
ALTER TABLE zenithjoy.tenant_feishu_bindings
  ADD COLUMN IF NOT EXISTS table_id_wechat_approval text;

-- 在 wechat_publish_task 加飞书行 ID（双向同步锚点）
ALTER TABLE zenithjoy.wechat_publish_task
  ADD COLUMN IF NOT EXISTS feishu_record_id text;
```

### 2. 扩展 `feishu-bitable-multitenant.ts`

新增第 4 张表的 schema 常量：

```typescript
{
  key: 'wechat_approval' as const,
  name: '微信发布审批',
  fields: [
    { field_name: '任务ID',    type: 1 },  // text
    { field_name: '内容预览',  type: 1 },  // text (content 前 100 字)
    { field_name: '任务类型',  type: 1 },  // moments | private_chat
    { field_name: '目标好友',  type: 1 },  // target_friend_alias（私聊才有）
    { field_name: '审批状态',  type: 1 },  // 待审批 | 已通过 | 已拒绝
    { field_name: '创建时间',  type: 1 },  // ISO 时间戳
  ],
}
```

`provisionBitable` 改为建 4 张表（向后兼容：旧租户 `table_id_wechat_approval IS NULL` 时按需补建）。

新增函数：

```typescript
export async function pushWechatTaskToFeishu(
  taskId: string,
  tenantId: string
): Promise<void>
```

逻辑：
1. 拉 `wechat_publish_task` 行
2. 调 `getValidToken` 
3. 调 Feishu create_record API 写入审批表
4. UPDATE `wechat_publish_task.feishu_record_id = record_id`
5. 失败时 log + 不 throw（不阻塞任务创建主流程）

### 3. 新 API 端点（薄层）

**文件**: `apps/api/src/routes/wechat.ts`（已存在，追加路由）

```
POST /api/wechat/draft-submit
Body: { agent_id, task_type, content, target_friend_alias?, scheduled_at? }
```

逻辑：
1. Zod 校验
2. INSERT `wechat_publish_task`（approval_source 固定 `feishu_user`）
3. 异步调 `pushWechatTaskToFeishu`（不 await，不阻塞响应）
4. 返回 `{ task_id, status: 'pending_approval' }`

### 4. Smoke Test 扩展

**文件**: `.github/workflows/scripts/smoke/golden-path-4-smoke.sh`（已存在，追加 step）

新增 Step 2 验证：
```bash
# Step 2: wechat task 创建 → feishu record 存在（dryrun: feishu fake server）
curl POST /api/wechat/draft-submit → 得 task_id
psql: SELECT feishu_record_id FROM zenithjoy.wechat_publish_task WHERE id=$task_id
→ feishu_record_id IS NOT NULL（fake server 模式下接受任意值）
```

---

## 测试策略

| 层级 | 文件 | 测试内容 |
|------|------|---------|
| E2E smoke | `golden-path-4-smoke.sh` Step 2 | draft-submit → feishu_record_id 非空 |
| Integration | `apps/api/tests/integration/p4-sprint-1-ws2/feishu-bitable.integration.test.ts` | `provisionBitable` 建 4 表、`pushWechatTaskToFeishu` 写回 record_id |
| Unit | `apps/api/src/services/__tests__/feishu-bitable-multitenant.test.ts` | `pushWechatTaskToFeishu` 调飞书 API 格式正确、失败不抛出 |
| Unit | `apps/api/src/routes/__tests__/wechat.test.ts`（已有，追加） | draft-submit 路由 201 + body 格式 |

Feishu API 用环境变量 `FEISHU_API_BASE` 切 fake-server（CI 已有此模式）。

---

## 不在 WS2 范围

- 飞书 webhook 回调（飞书审批 → wechat_publish_task.status 更新）→ WS5
- 飞书机器人消息通知 → WS5
- 旧租户 Bitable 补建（graceful upgrade）→ 留 provisionBitable 里加 `IF table_id_wechat_approval IS NULL` 判断即可，WS2 用新租户测

---

## CI 合规

- 改 `.github/workflows/scripts/smoke/` → PR 标题加 `[CONFIG]`
- 新 `apps/api/src/` 文件需配套 `__tests__/` → 已在测试策略中覆盖
- `test-registry.yaml` 需追加新测试 ID
