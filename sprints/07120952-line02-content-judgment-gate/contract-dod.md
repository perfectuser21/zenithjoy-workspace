# DoD 清单 — Line02 内容判定门槛
## Sprint: 07120952-line02-content-judgment-gate
## 版本: v1.0（首轮）
## 日期: 2026-07-12

---

## [BEHAVIOR] 条目（共 8 条）

---

### [BEHAVIOR] (1) rejected/pending 视频绝不生成 Stage2 抓评论任务（INV-1）

**对应 it() 子串**: `rejected video should not generate stage2 task`

**断言描述**: 判定状态为 `rejected` 或 `pending` 的视频，`acquisition_collect_tasks` 表中不存在对应的 `stage=2` 记录。

**manual:bash 验收命令**:
```bash
# 前置：确保 DATABASE_URL 已设置，API 服务运行在 localhost:3000
API="http://localhost:3000"
TENANT_ID="test-tenant-line02-judgment"

# 提交一个 rejected 判定
curl -sf -X POST "$API/api/acquisition/judge-video" \
  -H "Content-Type: application/json" \
  -d '{"tenant_id":"'"$TENANT_ID"'","video_id":"dod-video-rejected","capture_type":"screenshot","data_b64":"dGVzdA==","force_result":"rejected"}' \
  | jq -e '.judgment_status == "rejected"'

# 验证无 Stage2 任务（必须返回 0）
psql "$DATABASE_URL" -t -c \
  "SELECT count(*) FROM zenithjoy.acquisition_collect_tasks
   WHERE parent_video_id='dod-video-rejected' AND stage=2;" \
  | grep -E "^\s*0\s*$" && echo "PASS: INV-1 satisfied" || (echo "FAIL: Stage2 task exists for rejected video" && exit 1)
```

---

### [BEHAVIOR] (2) outreach_eligible=false 线索绝不出现在 dm_assignments（INV-2）

**对应 it() 子串**: `outreach_eligible false lead should not appear in dm_assignments`

**断言描述**: `outreach_eligible = false` 的线索，`buildAssignments` 执行后 `dm_assignments` 表中不存在该 `lead_id` 的记录（非 cancelled 状态亦不存在）。

**manual:bash 验收命令**:
```bash
API="http://localhost:3000"
TENANT_ID="test-tenant-line02-judgment"

# 前置数据检查：确保 acquisition_collect_tasks 中存在可用记录（BEHAVIOR(2) 的 INSERT 依赖此记录）
# 若不存在则先创建占位记录，避免 LIMIT 1 子查询返回 NULL 导致 FK 约束失败
TASK_COUNT=$(psql "$DATABASE_URL" -t -c \
  "SELECT count(*) FROM zenithjoy.acquisition_collect_tasks WHERE tenant_id='$TENANT_ID';" | tr -d ' \n')
if [ "$TASK_COUNT" -eq 0 ]; then
  psql "$DATABASE_URL" -c \
    "INSERT INTO zenithjoy.acquisition_collect_tasks (tenant_id, stage, status)
     VALUES ('$TENANT_ID', 1, 'done') ON CONFLICT DO NOTHING;"
fi

# 获取或创建一个低分线索 ID（grade=感兴趣）
LEAD_LOW_ID=$(psql "$DATABASE_URL" -t -c \
  "INSERT INTO zenithjoy.acquisition_leads (tenant_id, sec_uid, nickname, collect_task_id)
   VALUES ('$TENANT_ID','sec_dod_low','DoD低分线索',(SELECT id FROM zenithjoy.acquisition_collect_tasks WHERE tenant_id='$TENANT_ID' LIMIT 1))
   ON CONFLICT (tenant_id, sec_uid) DO UPDATE SET nickname=EXCLUDED.nickname
   RETURNING id;" | tr -d ' \n')

# 插入低分评论
psql "$DATABASE_URL" -c \
  "INSERT INTO zenithjoy.acquisition_lead_comments (lead_id, tenant_id, comment_text, grade)
   VALUES ('$LEAD_LOW_ID','$TENANT_ID','还不错','感兴趣') ON CONFLICT DO NOTHING;"

# 触发 rescoreLead，验证 outreach_eligible=false
curl -sf -X POST "$API/api/acquisition/rescore-lead" \
  -H "Content-Type: application/json" \
  -d '{"lead_id":"'"$LEAD_LOW_ID"'","tenant_id":"'"$TENANT_ID"'"}' \
  | jq -e '.outreach_eligible == false'

# 验证 dm_assignments 无记录（必须返回 0）
psql "$DATABASE_URL" -t -c \
  "SELECT count(*) FROM zenithjoy.dm_assignments WHERE lead_id='$LEAD_LOW_ID';" \
  | grep -E "^\s*0\s*$" && echo "PASS: INV-2 satisfied" || (echo "FAIL: dm_assignments exists for ineligible lead" && exit 1)
```

---

### [BEHAVIOR] (3) 判定 API 超时（>8s）标记 pending 且不阻塞其他视频（INV-3）

**对应 it() 子串**: `judgment api timeout should mark pending and not block other videos`

**断言描述**: 当 ToAPIs Gemini 调用超过 8 秒时，超时视频 `judgment_status` 更新为 `pending`。**INV-3 不阻塞断言（超时不阻塞其他视频）由单元测试 TC-03 独立覆盖（mock 并发场景验证，Jest mock Gemini client 模拟 8s 超时 + 验证另一视频在 15s 内完成判定）；smoke 验证仅覆盖超时视频状态变为 pending 这一半，不重复验证并发隔离。**

**manual:bash 验收命令**:
```bash
# 单元测试验证（Jest，需要 mock Gemini client 模拟 8s 超时）
cd /workspace && npx jest --testPathPattern="content-judgment.test" \
  --testNamePattern="judgment api timeout should mark pending and not block other videos" \
  --forceExit 2>&1 | tail -5

# smoke 验证：提交两个视频，其中一个 force_timeout，另一个正常
API="http://localhost:3000"
TENANT_ID="test-tenant-line02-judgment"

START=$(date +%s)
curl -sf -X POST "$API/api/acquisition/judge-video" \
  -H "Content-Type: application/json" \
  -d '{"tenant_id":"'"$TENANT_ID"'","video_id":"dod-timeout-001","capture_type":"screenshot","data_b64":"dGVzdA==","force_timeout":true}' \
  | jq -e '.judgment_status == "pending"'
END=$(date +%s)

# 超时视频状态为 pending
psql "$DATABASE_URL" -t -c \
  "SELECT judgment_status FROM zenithjoy.acquisition_collect_videos WHERE video_id='dod-timeout-001';" \
  | grep "pending" && echo "PASS: INV-3 timeout→pending" || echo "FAIL"
```

---

### [BEHAVIOR] (4) rejected/pending/skipped_capture_failed 视频必须留记录（INV-4）

**对应 it() 子串**: `rejected video must have record in acquisition_collect_videos`

**断言描述**: 无论判定结果是 `rejected`、`pending` 还是 `skipped_capture_failed`，`acquisition_collect_videos` 表必须存在对应 `video_id` 的记录，不得静默丢弃。

**manual:bash 验收命令**:
```bash
API="http://localhost:3000"
TENANT_ID="test-tenant-line02-judgment"

for STATUS in rejected skipped_capture_failed; do
  VID="dod-video-${STATUS}"
  curl -sf -X POST "$API/api/acquisition/judge-video" \
    -H "Content-Type: application/json" \
    -d '{"tenant_id":"'"$TENANT_ID"'","video_id":"'"$VID"'","capture_type":"screenshot","data_b64":"dGVzdA==","force_result":"'"$STATUS"'"}' \
    | jq -e '.judgment_status'

  COUNT=$(psql "$DATABASE_URL" -t -c \
    "SELECT count(*) FROM zenithjoy.acquisition_collect_videos WHERE video_id='$VID';" | tr -d ' ')
  [ "$COUNT" -ge 1 ] && echo "PASS: INV-4 $STATUS has DB record" || (echo "FAIL: $STATUS video not recorded" && exit 1)
done
```

---

### [BEHAVIOR] (5) 同一 video_id 已有非 pending 结果时不重复调 Gemini（INV-5）

**对应 it() 子串**: `same video_id with non-pending result should not re-call gemini`

**断言描述**: 对已有 `matched` 或 `rejected` 结果的 `video_id` 重复调用 `/api/acquisition/judge-video`，API 直接返回已有结果，不发起新的 Gemini upstream 请求（通过日志或计数器验证）。

**manual:bash 验收命令**:
```bash
# 单元测试验证（Jest spy on Gemini client）
cd /workspace && npx jest --testPathPattern="content-judgment.test" \
  --testNamePattern="same video_id with non-pending result should not re-call gemini" \
  --forceExit 2>&1 | tail -5

# smoke 验证：对已有结果的 video_id 重复调用，验证 cache_hit=true
API="http://localhost:3000"
TENANT_ID="test-tenant-line02-judgment"

# 先确保该 video_id 已有非 pending 结果（复用 BEHAVIOR(1) 的 dod-video-rejected）
CACHED_RESULT=$(curl -sf -X POST "$API/api/acquisition/judge-video" \
  -H "Content-Type: application/json" \
  -d '{"tenant_id":"'"$TENANT_ID"'","video_id":"dod-video-rejected","capture_type":"screenshot","data_b64":"dGVzdA=="}')

echo "$CACHED_RESULT" | jq -e '.cache_hit == true' \
  && echo "PASS: INV-5 cache_hit=true（未重复调 Gemini）" \
  || (echo "FAIL: cache_hit 字段缺失或为 false" && exit 1)
```

---

### [BEHAVIOR] (6) 空 target_profile_desc 租户所有视频默认 matched（INV-6）

**对应 it() 子串**: `empty target_profile_desc should default all videos to matched`

**断言描述**: 当租户 `acquisition_config.target_profile_desc` 为空或租户无配置记录时，`POST /api/acquisition/judge-video` 直接返回 `judgment_status="matched"`，且不调用 Gemini API。

**manual:bash 验收命令**:
```bash
API="http://localhost:3000"

# 使用无 profile 配置的租户
RESULT=$(curl -sf -X POST "$API/api/acquisition/judge-video" \
  -H "Content-Type: application/json" \
  -d '{"tenant_id":"test-tenant-no-profile","video_id":"dod-video-noprofile","capture_type":"screenshot","data_b64":"dGVzdA=="}')

echo "$RESULT" | jq -e '.judgment_status == "matched"' && echo "PASS: INV-6 empty profile→matched" \
  || (echo "FAIL: empty profile did not default to matched" && exit 1)

psql "$DATABASE_URL" -t -c \
  "SELECT judgment_status FROM zenithjoy.acquisition_collect_videos WHERE video_id='dod-video-noprofile';" \
  | grep "matched" && echo "PASS: INV-6 DB record=matched" || echo "FAIL: DB not matched"
```

---

### [BEHAVIOR] (7) rescoreLead 正确联动 outreach_eligible（FR-6）

**对应 it() 子串**: `rescore-lead updates outreach_eligible based on highest grade`

**断言描述**: `POST /api/acquisition/rescore-lead` 执行后，`acquisition_leads.outreach_eligible` 正确反映最高评论档：最高档 ≥ 精准/高意向 → `true`；最高档 < 精准 → `false`。

**manual:bash 验收命令**:
```bash
API="http://localhost:3000"
TENANT_ID="test-tenant-line02-judgment"

# 前置：INSERT 一条精准档线索，获取其 ID
LEAD_HIGH_ID=$(psql "$DATABASE_URL" -t -c \
  "INSERT INTO zenithjoy.acquisition_leads (tenant_id, sec_uid, nickname, collect_task_id)
   VALUES ('$TENANT_ID','sec_dod_high','DoD精准档线索',(
     SELECT id FROM zenithjoy.acquisition_collect_tasks WHERE tenant_id='$TENANT_ID' LIMIT 1
   ))
   ON CONFLICT (tenant_id, sec_uid) DO UPDATE SET nickname=EXCLUDED.nickname
   RETURNING id;" | tr -d ' \n')

# 插入精准档评论
psql "$DATABASE_URL" -c \
  "INSERT INTO zenithjoy.acquisition_lead_comments (lead_id, tenant_id, comment_text, grade)
   VALUES ('$LEAD_HIGH_ID','$TENANT_ID','我正在找装修公司','精准')
   ON CONFLICT DO NOTHING;"

# 高分线索（精准档）→ outreach_eligible=true
curl -sf -X POST "$API/api/acquisition/rescore-lead" \
  -H "Content-Type: application/json" \
  -d '{"lead_id":"'"$LEAD_HIGH_ID"'","tenant_id":"'"$TENANT_ID"'"}' \
  | jq -e '.outreach_eligible == true' && echo "PASS: 精准档→true" || echo "FAIL"

psql "$DATABASE_URL" -t -c \
  "SELECT outreach_eligible FROM zenithjoy.acquisition_leads WHERE id='$LEAD_HIGH_ID';" \
  | grep "t" && echo "PASS: DB outreach_eligible=true" || echo "FAIL"
```

---

### [BEHAVIOR] (8) 已生成 dm_assignments 在 outreach_eligible 降为 false 后标记 cancelled（FR-8）

**对应 it() 子串**: `dm_assignments cancelled when outreach_eligible turns false`

**断言描述**: 已存在 `dm_assignments` 记录的线索，若 `rescoreLead` 重算后 `outreach_eligible` 变为 false，对应 `dm_assignments.status` 应被更新为 `cancelled`。

**manual:bash 验收命令**:
```bash
# 单元测试验证（DB 状态机测试）
cd /workspace && npx jest --testPathPattern="acquisition-dispatch.test" \
  --testNamePattern="dm_assignments cancelled when outreach_eligible turns false" \
  --forceExit 2>&1 | tail -5

# 集成验证（预先创建一条已生成 dm_assignments 的线索，再降档触发 cancelled）
API="http://localhost:3000"
TENANT_ID="test-tenant-line02-judgment"

# Step1：INSERT 一条精准档线索（初始 outreach_eligible=true）
LEAD_DOWNGRADE_ID=$(psql "$DATABASE_URL" -t -c \
  "INSERT INTO zenithjoy.acquisition_leads (tenant_id, sec_uid, nickname, collect_task_id, outreach_eligible)
   VALUES ('$TENANT_ID','sec_dod_downgrade','DoD降档线索',(
     SELECT id FROM zenithjoy.acquisition_collect_tasks WHERE tenant_id='$TENANT_ID' LIMIT 1
   ), true)
   ON CONFLICT (tenant_id, sec_uid) DO UPDATE SET outreach_eligible=true
   RETURNING id;" | tr -d ' \n')

# Step2：直接 INSERT 一条 pending 状态的 dm_assignments（模拟已生成待发送状态）
psql "$DATABASE_URL" -c \
  "INSERT INTO zenithjoy.dm_assignments (lead_id, tenant_id, status)
   VALUES ('$LEAD_DOWNGRADE_ID','$TENANT_ID','pending')
   ON CONFLICT DO NOTHING;"

# Step3：插入低分评论，使该线索降档到 感兴趣（低于精准阈值）
psql "$DATABASE_URL" -c \
  "DELETE FROM zenithjoy.acquisition_lead_comments WHERE lead_id='$LEAD_DOWNGRADE_ID';
   INSERT INTO zenithjoy.acquisition_lead_comments (lead_id, tenant_id, comment_text, grade)
   VALUES ('$LEAD_DOWNGRADE_ID','$TENANT_ID','随便看看','感兴趣');"

# Step4：触发 rescoreLead 将线索降档 → outreach_eligible=false
curl -sf -X POST "$API/api/acquisition/rescore-lead" \
  -H "Content-Type: application/json" \
  -d '{"lead_id":"'"$LEAD_DOWNGRADE_ID"'","tenant_id":"'"$TENANT_ID"'"}' \
  | jq -e '.outreach_eligible == false'

# Step5：验证 dm_assignments 被标记为 cancelled（FR-8）
psql "$DATABASE_URL" -t -c \
  "SELECT status FROM zenithjoy.dm_assignments WHERE lead_id='$LEAD_DOWNGRADE_ID';" \
  | grep "cancelled" && echo "PASS: FR-8 dm_assignments=cancelled" || (echo "FAIL: dm_assignments not cancelled" && exit 1)
```

---

## DB Migration DoD

```bash
# 验证 migration 后字段存在
psql "$DATABASE_URL" -c \
  "SELECT column_name, data_type, column_default
   FROM information_schema.columns
   WHERE table_schema='zenithjoy'
   AND table_name='acquisition_collect_videos'
   AND column_name IN ('judgment_status','judgment_reason','capture_type')
   ORDER BY column_name;"
# 期望：返回 3 行

psql "$DATABASE_URL" -c \
  "SELECT column_name FROM information_schema.columns
   WHERE table_schema='zenithjoy' AND table_name='acquisition_config'
   AND column_name='target_profile_desc';"
# 期望：返回 1 行

psql "$DATABASE_URL" -c \
  "SELECT column_name, data_type FROM information_schema.columns
   WHERE table_schema='zenithjoy' AND table_name='acquisition_leads'
   AND column_name='outreach_eligible';"
# 期望：返回 1 行，data_type=boolean
```

---

## CI 门禁 DoD

- [ ] `lint-feature-has-smoke`：`content-judgment-gate-smoke.sh` 已存在且内容 ≥5 行实质逻辑（非 `exit 0` 占位）
- [ ] `lint-tdd-commit-order`：smoke/test 文件 commit 早于 src 文件 commit
- [ ] `content-judgment-gate-smoke.sh` 在 CI 中执行返回 0
- [ ] Android `ContentJudgmentLogicTest.kt` 在 CI 中全部通过
- [ ] TypeScript/ESLint 检查通过（`apps/api/`）

---

## 文件交付清单

| 文件路径 | 类型 | 状态 |
|---------|------|------|
| `apps/api/db/migrations/20260712_content_judgment_gate.sql` | DB Migration | 待实现 |
| `apps/api/src/services/content-judgment.ts` | 中台判定服务 | 待实现 |
| `apps/api/src/routes/acquisition.ts`（扩展） | API 路由 | 待实现 |
| `apps/api/src/services/acquisition-dispatch.ts`（扩展） | 触达门槛逻辑 | 待实现 |
| `services/agent-android/.../ContentJudgmentService.kt` | Android 服务 | 待实现 |
| `services/agent-android/.../AudioRecordService.kt` | Android 录音 | 待实现（spike 后） |
| `services/agent-android/.../DouyinCollectService.kt`（扩展） | Android 采集 | 待实现 |
| `apps/dashboard/src/pages/AcquisitionConfigPage.tsx`（扩展） | Dashboard UI | 待实现 |
| `apps/dashboard/src/pages/LeadsListPage.tsx`（扩展） | Dashboard UI | 待实现 |
| `.github/workflows/scripts/smoke/content-judgment-gate-smoke.sh` | E2E Smoke | 待实现（commit-1） |
| `sprints/07120952-line02-content-judgment-gate/tests/android/ContentJudgmentLogicTest.kt` | Android 单元测试 | 待实现（commit-1） |
| `apps/dashboard/e2e/content-judgment-gate.spec.ts` | Playwright E2E | 待实现 |
| `sprints/07120952-line02-content-judgment-gate/spike-media-projection.md` | Spike 结论 | 待完成（xian-rog 真机） |

---

## Sprint FAIL 条件

以下任一条件不满足 → **Sprint FAIL**，不得合并：

1. INV-1 违反：任何 `rejected`/`pending` 视频存在 `stage=2` 任务
2. INV-2 违反：任何 `outreach_eligible=false` 线索存在非 `cancelled` 的 `dm_assignments`
3. INV-4 违反：任何 `rejected`/`pending`/`skipped_capture_failed` 视频无 `acquisition_collect_videos` 记录
4. INV-6 违反：空 `target_profile_desc` 租户视频未默认 `matched`
5. `content-judgment-gate-smoke.sh` CI 执行非 0
6. `lint-tdd-commit-order` 检查失败（E2E 不先于实现）
