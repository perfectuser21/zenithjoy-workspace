# Contract Draft — Line02 内容判定门槛
## Sprint: 07120952-line02-content-judgment-gate
## 版本: v1.1（响应 reviewer-feedback-r1.md：修复§4/§5 bash变量自包含、补 §5 dm_assignments验证、FR-8降档逻辑归单测）
## FR-8 说明: TC-09（dm_assignments cancelled when outreach_eligible turns false）归为单元测试覆盖（services/acquisition-dispatch.test.ts），smoke 不重复暴露 $LEAD_DOWNGRADE_ID；BEHAVIOR(8) 在 contract-dod.md 中有完整自包含 manual:bash
## 日期: 2026-07-12

---

## 概述

本合同约束 Sprint 07120952 的交付范围与验收标准。本次 sprint 推进 Path 2（客户智能获客）Step 4（视频内容判定 thin→medium）+ Step 6（留言触达门槛化 thin→medium）。

- **Journey**: Path 2 客户智能获客（journey_id: afa6abca-53c0-4815-8594-b7fb81ca547f）
- **Feature ID**: 2a23912e-cfbe-41a7-adc6-81167818ec43
- **Task ID**: e7aaa5d7-1624-46aa-bf6e-05c2f86a4634
- **base_repo**: zenithjoy
- **target_environment**: windows_cloud（Dashboard E2E）+ xian-rog（Android spike 手动）

---

## Invariant 约束（6 条，不得违反）

| # | Invariant | 技术断言 |
|---|-----------|---------|
| INV-1 | `rejected` 或 `pending` 判定状态的视频，**绝不**生成 Stage2 抓评论任务 | `SELECT count(*) FROM zenithjoy.acquisition_collect_tasks WHERE parent_video_id=<rejected_vid> AND stage=2` 必须返回 0 |
| INV-2 | `outreach_eligible = false` 的线索，`buildAssignments` **绝不**为其生成 `dm_assignments` 记录 | `SELECT count(*) FROM zenithjoy.dm_assignments WHERE lead_id=<ineligible_lead_id>` 必须返回 0 |
| INV-3 | 判定 API 超时（>8 秒）**绝不**阻塞同一采集批次中其他视频的处理 | 超时场景下其他视频 `judgment_status` 在超时窗口内完成更新；超时视频状态为 `pending` |
| INV-4 | 任何 `rejected`/`pending`/`skipped_capture_failed` 视频必须在 `acquisition_collect_videos` 表中留有记录 | `SELECT count(*) FROM zenithjoy.acquisition_collect_videos WHERE video_id=<vid> AND judgment_status IN ('rejected','pending','skipped_capture_failed')` 必须 ≥ 1 |
| INV-5 | 同一 `video_id` 已有非 `pending` 判定结果时，判定 API **绝不**重复调用 Gemini | 对已有 `matched`/`rejected` 结果的 video_id 再次 POST `/api/acquisition/judge-video`，API 响应体含 `cache_hit: true` 字段，bash 用 `jq -e '.cache_hit == true'` 断言；不新增 Gemini 计费调用 |
| INV-6 | `target_profile_desc` 为空的租户不受内容判定影响（所有视频默认 `matched`） | 空 `target_profile_desc` 租户调用判定 API 时，响应 `judgment_status == "matched"`，且 `acquisition_collect_videos.judgment_status` 落库为 `matched` |

---

## 功能需求（FR）覆盖

| FR | 描述 | 验收断言 |
|----|------|---------|
| FR-1 | Dashboard 支持租户填写/更新 `target_profile_desc` | `PATCH /api/acquisition/config` 成功；`psql` 查 `acquisition_config.target_profile_desc` 非空 |
| FR-2 | 安卓 Agent 图文帖截图 → 发中台判定 API | 中台 `POST /api/acquisition/judge-video` 收到 `capture_type=screenshot` 请求，`acquisition_collect_videos.capture_type = 'screenshot'` 落库 |
| FR-3 | 安卓 Agent 视频帖 MediaProjection 录音 → 发中台判定 API | spike 结论写入 `spike-media-projection.md`；`capture_type=audio` 请求中台返回有效 judgment_status |
| FR-4 | 中台 `POST /api/acquisition/judge-video` 端点 | HTTP 200，body 含 `judgment_status` in `['matched','rejected','pending']`；超时/失败返回 `pending`（不返回 5xx 给 Agent） |
| FR-5 | Agent 收到 `matched` 才继续抓评论；`rejected`/`pending` 跳过并写库留痕 | `rejected` 视频无 Stage2 任务（INV-1）；`acquisition_collect_videos` 有记录（INV-4） |
| FR-6 | `rescoreLead` 末尾联动更新 `outreach_eligible` | `POST /api/acquisition/rescore-lead` 后 `acquisition_leads.outreach_eligible` 正确反映最高评论档 |
| FR-7 | `buildAssignments` 加 `outreach_eligible = true` 前置过滤 | `outreach_eligible=false` 线索无 `dm_assignments`（INV-2） |
| FR-8 | 已生成 `dm_assignments` 在发送前若 `outreach_eligible` 降为 false → 标记 `cancelled` | `dm_assignments.status = 'cancelled'` 对应记录存在 |
| FR-9 | CRM 线索列表新增 `outreach_eligible` 状态标识列 | Dashboard CRM 页面渲染 `outreach_eligible` 列，值为 true/false |

---

## DB Schema 变更（Migration 断言）

Migration 文件：`apps/api/db/migrations/20260712_content_judgment_gate.sql`

| 表 | 新增字段 | 类型/默认值 |
|----|---------|-----------|
| `zenithjoy.acquisition_collect_videos` | `judgment_status` | `text DEFAULT 'pending'` |
| `zenithjoy.acquisition_collect_videos` | `judgment_reason` | `text` |
| `zenithjoy.acquisition_collect_videos` | `capture_type` | `text`（`screenshot`/`audio`/`skipped_capture_failed`） |
| `zenithjoy.acquisition_config` | `target_profile_desc` | `text` |
| `zenithjoy.acquisition_leads` | `outreach_eligible` | `boolean` |

验收断言：
```sql
-- migration 后这些列必须存在
SELECT column_name FROM information_schema.columns
WHERE table_schema='zenithjoy' AND table_name='acquisition_collect_videos'
AND column_name IN ('judgment_status','judgment_reason','capture_type');
-- 应返回 3 行

SELECT column_name FROM information_schema.columns
WHERE table_schema='zenithjoy' AND table_name='acquisition_config'
AND column_name='target_profile_desc';
-- 应返回 1 行

SELECT column_name FROM information_schema.columns
WHERE table_schema='zenithjoy' AND table_name='acquisition_leads'
AND column_name='outreach_eligible';
-- 应返回 1 行
```

---

## Test Contract 表

| Test ID | it() 名称子串 | 对应 INV/FR | 类型 | 可执行形式 |
|---------|--------------|------------|------|----------|
| TC-01 | `rejected video should not generate stage2 task` | INV-1, FR-5 | smoke + psql | `content-judgment-gate-smoke.sh` §3 |
| TC-02 | `outreach_eligible false lead should not appear in dm_assignments` | INV-2, FR-7 | smoke + psql | `content-judgment-gate-smoke.sh` §4 |
| TC-03 | `judgment api timeout should mark pending and not block other videos` | INV-3 | unit（Jest mock 8s timeout；**同时 mock 并发第二视频，断言其在 15s 内完成判定，验证不阻塞约束；smoke 脚本仅验证超时→pending，不重复覆盖并发隔离**） | `services/content-judgment.test.ts` |
| TC-04 | `rejected video must have record in acquisition_collect_videos` | INV-4 | smoke + psql | `content-judgment-gate-smoke.sh` §3 |
| TC-05 | `same video_id with non-pending result should not re-call gemini` | INV-5 | unit（spy Gemini client；**API 响应体含 `cache_hit: boolean` 字段，断言 `cache_hit == true` 且 Gemini spy 调用次数为 0**） | `services/content-judgment.test.ts` |
| TC-06 | `empty target_profile_desc should default all videos to matched` | INV-6 | smoke + unit | `content-judgment-gate-smoke.sh` §6 |
| TC-07 | `judge-video api returns matched or pending for valid screenshot` | FR-4 | smoke curl | `content-judgment-gate-smoke.sh` §2 |
| TC-08 | `rescore-lead updates outreach_eligible based on highest grade` | FR-6 | smoke curl + psql | `content-judgment-gate-smoke.sh` §4 |
| TC-09 | `dm_assignments cancelled when outreach_eligible turns false` | FR-8 | unit（DB state machine） | `services/acquisition-dispatch.test.ts` |
| TC-10 | `acquisition config patch saves target_profile_desc` | FR-1 | smoke curl + psql | `content-judgment-gate-smoke.sh` §1 |
| TC-11 | `high-grade lead outreach_eligible true dm_assignments generated` | FR-7 | smoke curl + psql | `content-judgment-gate-smoke.sh` §5 |
| TC-12 | `skipped_capture_failed video has record in collect_videos table` | INV-4 | Android unit（ContentJudgmentLogicTest.kt） | `ContentJudgmentLogicTest.kt` |

---

## E2E 验收

### 验收环境

- **中台 API E2E**：本地 `localhost:3000`（或 CI 服务），`DATABASE_URL` 指向测试 DB
- **Dashboard E2E**：GitHub Actions windows-latest runner（`windows_cloud`）
- **Android spike**：xian-rog 真机（手动，结论写 `spike-media-projection.md`）

### E2E Smoke 脚本

文件路径：`.github/workflows/scripts/smoke/content-judgment-gate-smoke.sh`

**§1 目标画像配置写入**
```bash
curl -sf -X PATCH "$API/api/acquisition/config" \
  -H "Content-Type: application/json" \
  -d "{\"tenant_id\":\"$TENANT_ID\",\"target_profile_desc\":\"关注家装设计、有装修需求的业主群体\"}" \
  | jq -e '.success == true'

psql "$DATABASE_URL" -t -c \
  "SELECT target_profile_desc FROM zenithjoy.acquisition_config WHERE tenant_id='$TENANT_ID';" \
  | grep -v "^$"
```

**§2 图文帖截图判定（matched/pending）**
```bash
curl -sf -X POST "$API/api/acquisition/judge-video" \
  -d "{\"tenant_id\":\"$TENANT_ID\",\"video_id\":\"test-video-001\",\"capture_type\":\"screenshot\",\"data_b64\":\"...\"}" \
  | jq -e '.judgment_status | IN("matched","pending")'

psql "$DATABASE_URL" -t -c \
  "SELECT judgment_status, capture_type FROM zenithjoy.acquisition_collect_videos WHERE video_id='test-video-001';" \
  | grep "screenshot"
```

**§3 rejected 视频不生成 Stage2 任务（INV-1, INV-4）**
```bash
# force_result=rejected 场景（测试辅助参数，仅测试环境）
curl -sf -X POST "$API/api/acquisition/judge-video" \
  -d "{\"tenant_id\":\"$TENANT_ID\",\"video_id\":\"test-video-002\",\"capture_type\":\"screenshot\",\"data_b64\":\"dGVzdA==\",\"force_result\":\"rejected\"}" \
  | jq -e '.judgment_status == "rejected"'

# acquisition_collect_videos 有记录（INV-4）
psql "$DATABASE_URL" -t -c \
  "SELECT count(*) FROM zenithjoy.acquisition_collect_videos WHERE video_id='test-video-002' AND judgment_status='rejected';" \
  | grep -E "^\s*1\s*$"

# Stage2 任务数为 0（INV-1）
psql "$DATABASE_URL" -t -c \
  "SELECT count(*) FROM zenithjoy.acquisition_collect_tasks WHERE parent_video_id='test-video-002' AND stage=2;" \
  | grep -E "^\s*0\s*$"
```

**§4 低分线索 outreach_eligible=false，dm_assignments 不生成（INV-2, FR-6, FR-7）**
```bash
# 前置：创建测试用 collect_task（FK 依赖），低分线索
TASK_ID=$(psql "$DATABASE_URL" -t -c \
  "INSERT INTO zenithjoy.acquisition_collect_tasks (tenant_id, keyword, status)
   VALUES ('$TENANT_ID','test-keyword','done') RETURNING id;" | tr -d ' \n')
LEAD_LOW_ID=$(psql "$DATABASE_URL" -t -c \
  "INSERT INTO zenithjoy.acquisition_leads (tenant_id, sec_uid, nickname, collect_task_id)
   VALUES ('$TENANT_ID','sec_dod_low_§4','§4低分线索','$TASK_ID') RETURNING id;" | tr -d ' \n')
psql "$DATABASE_URL" -c \
  "INSERT INTO zenithjoy.acquisition_lead_comments (lead_id, tenant_id, comment_text, grade)
   VALUES ('$LEAD_LOW_ID','$TENANT_ID','还不错','感兴趣');" 2>/dev/null || true

# 触发 rescoreLead
curl -sf -X POST "$API/api/acquisition/rescore-lead" \
  -H "Content-Type: application/json" \
  -d "{\"lead_id\":\"$LEAD_LOW_ID\",\"tenant_id\":\"$TENANT_ID\"}" \
  | jq -e '.outreach_eligible == false'

psql "$DATABASE_URL" -t -c \
  "SELECT outreach_eligible FROM zenithjoy.acquisition_leads WHERE id='$LEAD_LOW_ID';" \
  | grep "f"

psql "$DATABASE_URL" -t -c \
  "SELECT count(*) FROM zenithjoy.dm_assignments WHERE lead_id='$LEAD_LOW_ID';" \
  | grep -E "^\s*0\s*$"
```

**§5 精准档线索 outreach_eligible=true，buildAssignments 生成 dm_assignments（FR-6, FR-7）**
```bash
# 前置：创建精准档线索（自包含，不依赖 §4 变量）
TASK_ID_H=$(psql "$DATABASE_URL" -t -c \
  "INSERT INTO zenithjoy.acquisition_collect_tasks (tenant_id, keyword, status)
   VALUES ('$TENANT_ID','test-keyword-high','done') RETURNING id;" | tr -d ' \n')
LEAD_HIGH_ID=$(psql "$DATABASE_URL" -t -c \
  "INSERT INTO zenithjoy.acquisition_leads (tenant_id, sec_uid, nickname, collect_task_id)
   VALUES ('$TENANT_ID','sec_dod_high_§5','§5精准档线索','$TASK_ID_H') RETURNING id;" | tr -d ' \n')
psql "$DATABASE_URL" -c \
  "INSERT INTO zenithjoy.acquisition_lead_comments (lead_id, tenant_id, comment_text, grade)
   VALUES ('$LEAD_HIGH_ID','$TENANT_ID','请问怎么联系你们','精准');" 2>/dev/null || true

curl -sf -X POST "$API/api/acquisition/rescore-lead" \
  -H "Content-Type: application/json" \
  -d "{\"lead_id\":\"$LEAD_HIGH_ID\",\"tenant_id\":\"$TENANT_ID\"}" \
  | jq -e '.outreach_eligible == true'

psql "$DATABASE_URL" -t -c \
  "SELECT outreach_eligible FROM zenithjoy.acquisition_leads WHERE id='$LEAD_HIGH_ID';" \
  | grep "t"

# 调用 buildAssignments，验证 dm_assignments 实际生成（FR-7 正向路径）
curl -sf -X POST "$API/api/acquisition/build-assignments" \
  -H "Content-Type: application/json" \
  -d "{\"tenant_id\":\"$TENANT_ID\"}" \
  | jq -e '.success == true'

psql "$DATABASE_URL" -t -c \
  "SELECT count(*) FROM zenithjoy.dm_assignments WHERE lead_id='$LEAD_HIGH_ID';" \
  | grep -E "^\s*[1-9][0-9]*\s*$" && echo "PASS: FR-7 dm_assignments ≥ 1 generated" \
  || (echo "FAIL: buildAssignments 未为精准档线索生成 dm_assignments" && exit 1)
```

**§6 空 target_profile_desc 租户所有视频默认 matched（INV-6）**
```bash
curl -sf -X POST "$API/api/acquisition/judge-video" \
  -d "{\"tenant_id\":\"test-tenant-no-profile\",\"video_id\":\"test-video-003\",\"capture_type\":\"screenshot\",\"data_b64\":\"dGVzdA==\"}" \
  | jq -e '.judgment_status == "matched"'
```

### Dashboard E2E（Playwright，windows_cloud）

文件路径：`apps/dashboard/e2e/content-judgment-gate.spec.ts`

- 验证 AcquisitionConfigPage 渲染 `target_profile_desc` 文本域，可填写保存
- 验证 LeadsListPage 渲染 `outreach_eligible` 状态列，true 显示「可触达」，false 显示「不触达」

### Android 单元测试

文件路径：`sprints/07120952-line02-content-judgment-gate/tests/android/ContentJudgmentLogicTest.kt`

- `rejected video should not generate stage2 task`（TC-01）
- `skipped_capture_failed video has record in collect_videos table`（TC-12）
- `empty target_profile_desc returns matched without api call`（INV-6 变体）

---

## 开发顺序（TDD，强制执行）

```
commit-1（E2E/smoke 先行）：content-judgment-gate-smoke.sh + ContentJudgmentLogicTest.kt skeleton
commit-2（DB migration）：20260712_content_judgment_gate.sql
commit-3（Android spike + ContentJudgmentService）
commit-4（中台判定 API）：content-judgment.ts + POST /api/acquisition/judge-video
commit-5（触达门槛）：rescoreLead + buildAssignments + rescore-lead endpoint
commit-6（Dashboard）：AcquisitionConfigPage + LeadsListPage + 迁移脚本
commit-7（让 smoke 全绿 + CI 接入）
```

---

## 范围确认

**在范围内**：DB migration（3 张表 5 字段）、中台判定 API、Android ContentJudgmentService、Android AudioRecordService（spike 后实现）、buildAssignments 过滤、rescoreLead 联动、dm_assignments cancelled 逻辑、Dashboard 两处 UI。

**不在范围内**：打字方式反风控加固、服务端下载视频文件判定、腾讯云 OCR、多档位阈值动态配置 UI。

---

## 风险与假设

| # | 假设/风险 | 处理策略 |
|---|---------|---------|
| A-1 | MediaProjection 授权弹窗行为未知 | spike 内确认；若每次弹 → 加无障碍自动点击或降级截图+OCR，不中止 sprint |
| A-2 | ToAPIs Gemini API key 已就绪 | 依赖 `~/.credentials/toapis.env`；CI secrets 需提前确认 |
| A-3 | 历史线索 `outreach_eligible=null` 兼容 | 迁移脚本全量跑一次 rescoreLead 补算，上线前执行 |
| A-4 | `target_profile_desc` 为空时默认 matched | INV-6 硬性约束，代码必须在画像为空时跳过 Gemini 调用 |
