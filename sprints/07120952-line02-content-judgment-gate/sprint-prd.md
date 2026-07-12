# Sprint PRD — Line02 内容判定门槛（视频/图文内容判定 + 留言触达门槛化）

## OKR 对齐

- **对应 Journey**：Path 2 客户智能获客（[Notion](https://www.notion.so/35ac40c2ba6381ed8df4f3fa0b64f5bf)）
- **当前 Maturity**：working（Step 6 评论区挖客闭环 thin/working；采集主链路 working）
- **本次推进**：Step 4（视频内容判定，thin→medium）+ Step 6（留言触达门槛化，thin→medium）
- **journey_id**：afa6abca-53c0-4815-8594-b7fb81ca547f
- **feature_id**：2a23912e-cfbe-41a7-adc6-81167818ec43

## 背景

当前采集链路：关键词搜视频 → 抓该视频下评论 → 评论打分 → 按分排序候选池 → 私信触达。

两处痛点：
1. **无内容判定**：只要标题沾边就进入采集，抓到大量内容不相关视频的评论，浪费采集资源 + 触达噪音高
2. **触达是软门槛**：评论分数只影响优先级排序，低分线索仍被私信，门槛形同虚设

本次升级：在视频层加"看完再挖"判定门，在线索层把"排序参考"升级为"硬门槛拦截"。

## Golden Path

### 首次启用（用户操作路径）

用户从 [Dashboard 获客配置页] → 填写/更新「目标画像描述」→ 系统在后续每次采集任务时自动应用视频内容判定。

1. 客户在 Dashboard 填「目标画像描述」（文字段，行业/受众/钩子描述）→ 存 `acquisition_config.target_profile_desc`（租户级，已有表结构待新增字段）

### 采集时（安卓 Agent 自动执行路径）

Agent 关键词搜索 → 逐个点开视频卡片 → 判定内容 → 只对 matched 视频抓评论

2. 安卓 Agent 点开视频卡片后：
   - 图文帖：`takeScreenshot()`（无障碍服务自带能力）截图 → base64 → 发往中台判定 API
   - 视频帖：MediaProjection 录音（新增，sprint 内第一件事是真机 spike 验证授权弹窗是一次性还是每视频弹）→ 录制 3~8 秒音频 → 发往中台判定 API
3. 中台判定 API 接收 base64 截图 / 音频 → 调 ToAPIs Gemini 多模态模型（`https://toapis.com/v1`，OpenAI 兼容格式）做 OCR/转写 + 语义判定 → 返回 `matched`/`rejected`/`pending`
   - 失败降级：判定超时 8 秒或 API 失败 → 保持 `pending` 状态，写库留痕，不阻塞其余视频采集
   - 截图/录音能力失败：标记 `skipped_capture_failed`，按默认拒绝处理
4. Agent 收到 `matched` → 继续抓该视频评论；收到 `rejected`/`pending` → 跳过不抓评论，但 `acquisition_collect_videos` 表保留该视频记录供人工复核

### 触达时（系统自动执行路径）

评论打分 → 触达资格判定 → 只对达标线索生成私信任务

5. 评论打 4 档标签（`comment-grader.ts` 现有逻辑不变：高意向/精准/感兴趣/其他）→ `rescoreLead` 重算 `relevance_score`
6. 重算后判定触达资格：线索最高评论档达到「精准」档（`CommentGrade = '精准' | '高意向'`）→ `outreach_eligible = true` → 进候选池；不达标 → `outreach_eligible = false` → CRM 可见但系统不自动私信
7. `buildAssignments` 生成 `dm_assignments` 时前置校验 `outreach_eligible = true`（新增 WHERE 条件）；生成后到实际发送前若 `rescoreLead` 重算导致 `outreach_eligible` 降为 false → 对应 `dm_assignments` 标记 `cancelled`

## 边界情况

- **MediaProjection 授权弹窗每次弹**：spike 阶段确认行为；若每次弹 → 加弹窗自动确认无障碍点击逻辑，或降级为仅截图 + OCR 判定（无转写，精度略降）
- **判定 API 批量超时**：超时队列积压超过 N（初始 20）条未判定 → Brain 告警，不阻塞采集继续（pending 堆积可人工复核）
- **`target_profile_desc` 为空**：租户未配置画像描述 → 跳过内容判定，所有视频默认 matched（保持现有行为，不破坏已有采集流程）
- **`outreach_eligible` 历史线索**：新门槛上线前已有线索 `outreach_eligible = null` → 迁移脚本全量跑一次 `rescoreLead` 补算；迁移完成前保持现有触达行为
- **配置阈值变更**：管理员改触达档位阈值 → 异步全量重算所有活跃线索 `outreach_eligible`，重算完成前旧资格判定不撤销

## 范围限定

**在范围内**：
- `acquisition_collect_videos` 新增 `judgment_status`/`judgment_reason`/`capture_type` 字段
- `acquisition_config` 新增 `target_profile_desc` 字段
- `acquisition_leads` 新增 `outreach_eligible` 字段
- 安卓 Agent 图文帖截图 → 发中台判定
- 安卓 Agent 视频帖 MediaProjection 录音 → 发中台判定（含 spike 验证）
- 中台判定 API（ToAPIs Gemini 多模态）
- `buildAssignments` 加 `outreach_eligible` 前置过滤
- `rescoreLead` 联动更新 `outreach_eligible`
- CRM 线索列表展示 `outreach_eligible` 状态标识

**不在范围内**：
- 打字方式改逐字模拟输入（反风控加固，另立 sprint）
- 服务端下载视频文件做判定
- 新增腾讯云 OCR 等额外依赖（复用 ToAPIs Gemini 多模态）
- 多档位阈值动态配置 UI（上线后有数据再加）

## 假设

- [ASSUMPTION: MediaProjection 录音授权弹窗行为待 sprint 内 spike 确认，PRD 按"一次性授权"乐观假设；spike 结果若为"每视频弹"则降级为截图+OCR，不中止 sprint]
- [ASSUMPTION: 触达档位初始固定为"精准"档（`精准` | `高意向`），硬编码配置，上线后按真实分布数据调整]
- [ASSUMPTION: ToAPIs Gemini 多模态 API key 已在 `~/.credentials/toapis.env` 及 CI secrets，本 sprint 不需要新增凭据申请]
- [ASSUMPTION: `target_profile_desc` 为空时跳过判定（全部 matched），不中断现有采集流程]
- [ASSUMPTION: 历史线索 `outreach_eligible` 补算通过一次性迁移脚本完成，不影响上线后行为]
- [ASSUMPTION: 中台判定 API 部署在现有 API 服务内（`apps/api`），不新增独立服务]

## 预期受影响文件

### 数据库 Migrations
- `apps/api/db/migrations/20260712_content_judgment_gate.sql`：新增
  - `zenithjoy.acquisition_collect_videos` 加字段：`judgment_status text DEFAULT 'pending'`、`judgment_reason text`、`capture_type text`（`screenshot`/`audio`/`skipped_capture_failed`）
  - `zenithjoy.acquisition_config` 加字段：`target_profile_desc text`
  - `zenithjoy.acquisition_leads` 加字段：`outreach_eligible boolean`

### 中台 API 服务（`apps/api/src/`）
- `services/content-judgment.ts`：新增，封装 ToAPIs Gemini 多模态调用（截图 OCR + 音频转写 + 画像语义判定），返回 `matched`/`rejected`/`pending`
- `routes/acquisition.ts`：新增端点 `POST /api/acquisition/judge-video`，接收 base64 截图/音频 + `tenant_id` + `video_id`
- `services/acquisition-dispatch.ts`：`rescoreLead` 函数末尾联动更新 `outreach_eligible`；`buildAssignments` 加 `outreach_eligible = true` 前置过滤；`dm_assignments` 状态迁移加 `cancelled` 处理

### 安卓 Agent（`services/agent-android/`）
- `app/src/main/kotlin/com/zenithjoy/agent/collect/ContentJudgmentService.kt`：新增，封装截图发中台 + 录音发中台逻辑，返回判定结果
- `app/src/main/kotlin/com/zenithjoy/agent/collect/AudioRecordService.kt`：新增，MediaProjection 录音实现（spike 验证弹窗行为后实现）
- `app/src/main/kotlin/com/zenithjoy/agent/collect/DouyinCollectService.kt`：在视频卡片点开后插入判定调用，`matched` 才继续抓评论

### Dashboard（`apps/dashboard/src/`）
- `pages/AcquisitionConfigPage.tsx` 或现有配置页：新增 `target_profile_desc` 文本域
- `pages/LeadsListPage.tsx` 或现有线索列表：新增 `outreach_eligible` 状态标识列

### E2E / Smoke Tests
- `.github/workflows/scripts/smoke/content-judgment-gate-smoke.sh`：新增（见验收条件）
- `sprints/07120952-line02-content-judgment-gate/tests/android/ContentJudgmentLogicTest.kt`：新增 Android 单元测试

## Invariant 约束

这些约束在任何情况下不得违反（合同必须覆盖）：

- [INVARIANT] `rejected` 或 `pending` 判定状态的视频，**绝不**生成 Stage2 抓评论任务（只有 `matched` 才进入后续采集）
- [INVARIANT] `outreach_eligible = false` 的线索，`buildAssignments` **绝不**为其生成 `dm_assignments` 记录
- [INVARIANT] 判定 API 超时（>8 秒）**绝不**阻塞同一采集批次中其他视频的处理
- [INVARIANT] 任何 `rejected`/`pending`/`skipped_capture_failed` 视频必须在 `acquisition_collect_videos` 表中留有记录（不得静默丢弃）
- [INVARIANT] 同一 `video_id` 已有非 `pending` 判定结果时，判定 API **绝不**重复调用 Gemini（幂等保护）
- [INVARIANT] `target_profile_desc` 为空的租户不受内容判定影响（所有视频默认 `matched`，保持现有采集行为）

## 累积 FR

本 sprint 在 journey_id=afa6abca 下追加以下功能需求：

| # | FR | 所在 Step |
|---|---|---|
| FR-1 | Dashboard 支持租户填写/更新 `target_profile_desc` 目标画像描述字段 | Step 1 |
| FR-2 | 安卓 Agent 图文帖截图（`takeScreenshot()`）→ 发中台判定 API | Step 2 |
| FR-3 | 安卓 Agent 视频帖 MediaProjection 录音（3~8 秒）→ 发中台判定 API | Step 2 |
| FR-4 | 中台 `POST /api/acquisition/judge-video` 端点：接收 base64 内容 → 调 ToAPIs Gemini 多模态 → 返回 `matched`/`rejected`/`pending` | Step 3 |
| FR-5 | Agent 收到 `matched` 才继续抓评论；`rejected`/`pending` 跳过并写库留痕 | Step 4 |
| FR-6 | `rescoreLead` 函数末尾联动更新 `outreach_eligible`（基于最高评论档是否达「精准/高意向」） | Step 5-6 |
| FR-7 | `buildAssignments` 新增 `outreach_eligible = true` 前置过滤条件 | Step 7 |
| FR-8 | 已生成的 `dm_assignments` 在实际发送前若 `outreach_eligible` 被重算为 false → 标记 `cancelled` | Step 7 |
| FR-9 | CRM 线索列表新增 `outreach_eligible` 状态标识列 | Step 6 |

## NFR（非功能需求）

- **判定延迟**：单次 ToAPIs Gemini 调用超时上限 8 秒；超时转 `pending` 不阻塞采集主循环
- **成本控制**：图文帖只传截图（非全分辨率，压缩至 ≤512KB）；视频帖只录 3~8 秒音频；每视频最多调用 1 次判定 API（重试通过状态机控制，不重复扣费）
- **数据留痕**：`rejected`/`pending`/`skipped_capture_failed` 视频均写库，`judgment_reason` 存 AI 返回摘要或错误原因，不静默丢弃
- **幂等性**：同一 `video_id` 判定 API 重复调用 → 校验已有非 `pending` 结果则直接返回，不重复调 Gemini
- **告警**：`pending` 积压超 20 条 → Brain POST 告警；MediaProjection 授权失败率 > 30% → 日志 ERROR 级别上报

## E2E 验收（Final E2E）

```bash
#!/bin/bash
# content-judgment-gate-smoke.sh
# Sprint 07120952 — Line02 内容判定门槛 E2E 验收
set -e

API="http://localhost:3000"
TENANT_ID="test-tenant-line02-judgment"

echo "=== [1] 目标画像配置写入 ==="
RESULT=$(curl -sf -X PATCH "$API/api/acquisition/config" \
  -H "Content-Type: application/json" \
  -d "{\"tenant_id\":\"$TENANT_ID\",\"target_profile_desc\":\"关注家装设计、有装修需求的业主群体\"}")
echo "$RESULT" | jq -e '.success == true'

echo "=== [2] 图文帖截图判定（matched 场景）==="
# fixture: 与画像高度相关的截图 base64（测试用小图）
SCREENSHOT_B64=$(base64 -w0 /workspace/sprints/07120952-line02-content-judgment-gate/fixtures/matched_screenshot.png 2>/dev/null || echo "iVBORw0KGgo=")
JUDGE_RESULT=$(curl -sf -X POST "$API/api/acquisition/judge-video" \
  -H "Content-Type: application/json" \
  -d "{\"tenant_id\":\"$TENANT_ID\",\"video_id\":\"test-video-001\",\"capture_type\":\"screenshot\",\"data_b64\":\"$SCREENSHOT_B64\"}")
echo "$JUDGE_RESULT" | jq -e '.judgment_status == "matched" or .judgment_status == "pending"'

# 验证 DB 落库
VIDEO_ROW=$(psql "$DATABASE_URL" -t -c \
  "SELECT judgment_status, capture_type FROM zenithjoy.acquisition_collect_videos WHERE video_id = 'test-video-001';")
echo "$VIDEO_ROW" | grep -E "matched|pending"
echo "$VIDEO_ROW" | grep "screenshot"

echo "=== [3] rejected 视频不生成 Stage2 任务 ==="
JUDGE_REJECTED=$(curl -sf -X POST "$API/api/acquisition/judge-video" \
  -H "Content-Type: application/json" \
  -d "{\"tenant_id\":\"$TENANT_ID\",\"video_id\":\"test-video-002\",\"capture_type\":\"screenshot\",\"data_b64\":\"dGVzdA==\",\"force_result\":\"rejected\"}")
echo "$JUDGE_REJECTED" | jq -e '.judgment_status == "rejected"'

# Stage2 任务不应存在
STAGE2_COUNT=$(psql "$DATABASE_URL" -t -c \
  "SELECT count(*) FROM zenithjoy.acquisition_collect_tasks WHERE parent_video_id = 'test-video-002' AND stage = 2;" 2>/dev/null || echo "0")
echo "$STAGE2_COUNT" | grep -E "^\s*0\s*$"

echo "=== [4] 线索触达门槛：低分线索 outreach_eligible=false，dm_assignments 不生成 ==="
# 插入低分线索（grade=感兴趣 only）
LEAD_ID=$(psql "$DATABASE_URL" -t -c \
  "INSERT INTO zenithjoy.acquisition_leads (tenant_id, sec_uid, nickname, collect_task_id)
   VALUES ('$TENANT_ID', 'sec_test_low', '测试低分线索', (SELECT id FROM zenithjoy.acquisition_collect_tasks WHERE tenant_id='$TENANT_ID' LIMIT 1))
   RETURNING id;" 2>/dev/null | tr -d ' ')

psql "$DATABASE_URL" -c \
  "INSERT INTO zenithjoy.acquisition_lead_comments (lead_id, tenant_id, comment_text, grade)
   VALUES ('$LEAD_ID', '$TENANT_ID', '不错不错', '感兴趣');" 2>/dev/null || true

# 触发 rescoreLead
RESCORE=$(curl -sf -X POST "$API/api/acquisition/rescore-lead" \
  -H "Content-Type: application/json" \
  -d "{\"lead_id\":\"$LEAD_ID\",\"tenant_id\":\"$TENANT_ID\"}")
echo "$RESCORE" | jq -e '.outreach_eligible == false'

# 验证 DB
ELIGIBLE=$(psql "$DATABASE_URL" -t -c \
  "SELECT outreach_eligible FROM zenithjoy.acquisition_leads WHERE id = '$LEAD_ID';")
echo "$ELIGIBLE" | grep "f"

# buildAssignments 不为此 lead 生成 dm_assignments
ASSIGN_COUNT=$(psql "$DATABASE_URL" -t -c \
  "SELECT count(*) FROM zenithjoy.dm_assignments WHERE lead_id = '$LEAD_ID';")
echo "$ASSIGN_COUNT" | grep -E "^\s*0\s*$"

echo "=== [5] 精准档线索 outreach_eligible=true，dm_assignments 正常生成 ==="
LEAD_HIGH_ID=$(psql "$DATABASE_URL" -t -c \
  "INSERT INTO zenithjoy.acquisition_leads (tenant_id, sec_uid, nickname, collect_task_id)
   VALUES ('$TENANT_ID', 'sec_test_high', '测试精准线索', (SELECT id FROM zenithjoy.acquisition_collect_tasks WHERE tenant_id='$TENANT_ID' LIMIT 1))
   RETURNING id;" 2>/dev/null | tr -d ' ')

psql "$DATABASE_URL" -c \
  "INSERT INTO zenithjoy.acquisition_lead_comments (lead_id, tenant_id, comment_text, grade)
   VALUES ('$LEAD_HIGH_ID', '$TENANT_ID', '请问怎么联系你们', '精准');" 2>/dev/null || true

RESCORE_HIGH=$(curl -sf -X POST "$API/api/acquisition/rescore-lead" \
  -H "Content-Type: application/json" \
  -d "{\"lead_id\":\"$LEAD_HIGH_ID\",\"tenant_id\":\"$TENANT_ID\"}")
echo "$RESCORE_HIGH" | jq -e '.outreach_eligible == true'

echo "✅ Line02 内容判定门槛 E2E 全部通过"
```

## 开发顺序（TDD，强制）

```
commit-1（E2E/smoke）：
  - content-judgment-gate-smoke.sh（判定门槛 smoke，占位 API 返回 pending）
  - ContentJudgmentLogicTest.kt（Android 单元测试 skeleton）

commit-2（DB migration）：
  - 20260712_content_judgment_gate.sql
  - acquisition_collect_videos 加 judgment_status/judgment_reason/capture_type
  - acquisition_config 加 target_profile_desc
  - acquisition_leads 加 outreach_eligible

commit-3（Android spike + ContentJudgmentService）：
  - AudioRecordService.kt（MediaProjection 录音，含 spike 结论注释）
  - ContentJudgmentService.kt（截图 + 录音发中台）
  - DouyinCollectService.kt（插入判定调用）

commit-4（中台判定 API）：
  - content-judgment.ts（ToAPIs Gemini 多模态调用）
  - acquisition.ts 新增 POST /api/acquisition/judge-video

commit-5（触达门槛）：
  - acquisition-dispatch.ts（rescoreLead 联动 outreach_eligible；buildAssignments 加过滤）
  - rescore-lead API 端点

commit-6（Dashboard + 迁移脚本）：
  - AcquisitionConfigPage.tsx 加 target_profile_desc 文本域
  - LeadsListPage.tsx 加 outreach_eligible 列
  - 历史线索全量补算迁移脚本

commit-7（让 smoke 全绿 + CI 接入）
```

## 附：MediaProjection Spike 验证清单

在 xian-rog 真机执行，结果写入本目录 `spike-media-projection.md`：

- [ ] 首次启动录音：授权弹窗出现几次（一次性 / 每应用启动 / 每录音请求）
- [ ] 录音 3 秒音频文件正常生成（`/data/data/com.zenithjoy.agent/files/tmp_audio.aac` 或同类路径）
- [ ] 音频 base64 大小（3 秒约 xx KB）
- [ ] 结论：是否需要弹窗自动确认无障碍逻辑？是否降级为截图+OCR 方案？

---

## journey_type: user_facing
## journey_type_reason: Golden Path 起点为用户在 Dashboard 填目标画像描述，后续采集/判定/触达为 autonomous；起点 UI 优先取 user_facing
## target_environment: windows_cloud
## target_environment_reason: ZenithJoy Dashboard E2E 走 GitHub Actions windows-latest runner；Android Agent 真机验证走 xian-rog（spike 阶段手动，CI 阶段接 nightly real-machine runner）
## journey_id: afa6abca-53c0-4815-8594-b7fb81ca547f
## feature_id: 2a23912e-cfbe-41a7-adc6-81167818ec43
## task_id: e7aaa5d7-1624-46aa-bf6e-05c2f86a4634
