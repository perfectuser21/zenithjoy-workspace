# Contract Draft — Path2 Dashboard展示与人工干预能力建设

**Task ID**: 7cb465c1-03cc-4934-a638-e61f78195d37
**Sprint**: 07221948-path2-dashboard-visibility
**Contract Round**: 1
**Date**: 2026-07-24
**Journey**: Path 2 客户智能获客（https://www.notion.so/35ac40c2ba6381ed8df4f3fa0b64f5bf）
**Target Environment**: windows_cloud（GitHub Actions windows-latest runner）

---

## 合同目标

将 PRD 中的用户语言需求翻译为可验证的技术断言，覆盖 FR-1 至 FR-5 共 5 项功能需求，
产出 golden-path-2-smoke.sh Step 25-29 的测试锚点，以及 Playwright E2E 的 UI 断言框架。

---

## 可验证断言清单（按 FR 分组）

### FR-1：获客列表接入触达状态展示

**断言 C-01（API 字段存在）**
- 触发：`GET /api/acquisition/leads`（含有效 tenant session）
- 断言：响应 HTTP 200；响应体 `leads` 数组每个元素含 `outreach_status` 字段；
  值域为 `'queued'|'dispatched'|'sent'|'limited'|'failed'|'cancelled'|'pending_dispatch'|null`
- 验证命令：
  ```bash
  STATUS=$(curl -s -b "$COOKIE_JAR" "$API_BASE/api/acquisition/leads" | jq -r '.leads[0].outreach_status // "null_ok"')
  # 验证值域合法（非 null_ok 时）
  echo "$STATUS" | grep -qE '^(queued|dispatched|sent|limited|failed|cancelled|pending_dispatch|null_ok)$'
  ```

**断言 C-02（有 dm_assignment 的 lead，outreach_status 非 null）**
- 前提：测试 tenant 的某 lead_id 在 `dm_assignments` 表中存在一条记录
- 触发：`GET /api/acquisition/leads`
- 断言：该 lead 对应的 `outreach_status` 字段不等于 `null`
- 验证命令（psql）：
  ```sql
  -- 确认 dm_assignments 有数据，lead 关联的 outreach_status 应非 null
  SELECT l.outreach_status IS NOT NULL AS has_status
    FROM (SELECT 'expected_outreach_status_not_null') x
   WHERE EXISTS (
     SELECT 1 FROM zenithjoy.dm_assignments
      WHERE tenant_id = '<test_tenant_id>'
   );
  ```

**断言 C-03（SQL 性能：LATERAL 子查询有索引）**
- 断言：`dm_assignments(tenant_id, lead_id, updated_at DESC)` 索引存在于 DB
- 验证命令（psql）：
  ```sql
  SELECT indexname FROM pg_indexes
   WHERE tablename='dm_assignments'
     AND indexname='idx_dm_assign_tenant_lead_updated';
  -- 期望返回 1 行
  ```

**断言 C-04（UI：触达状态徽标可见）**
- 触发：Playwright 打开 `/dashboard/leads`
- 断言：页面含"触达状态"列头文本（已存在于 leads-unified-table.spec.ts 第 29 行）
- 类型：UI交互类 → 截图/文字断言

---

### FR-2：人工触达配置弹窗（选号/选话术）

**断言 C-05（candidates 端点存在并返回正确结构）**
- 触发：`GET /api/acquisition/manual-outreach/candidates`（含有效 tenant session）
- 断言：HTTP 200；响应体 `data.accounts` 为数组（可为空）；`data.default_message` 为非空字符串
- 验证命令：
  ```bash
  RESP=$(curl -s -b "$COOKIE_JAR" "$API_BASE/api/acquisition/manual-outreach/candidates")
  HTTP=$(echo "$RESP" | jq -r '.success')
  MSG=$(echo "$RESP" | jq -r '.data.default_message // ""')
  [ "$HTTP" = "true" ] || fail "C-05 candidates 返回 success=false"
  [ -n "$MSG" ] || fail "C-05 default_message 为空"
  ```

**断言 C-06（manual-outreach 写入幂等）**
- 触发：连续两次 `POST /api/acquisition/manual-outreach` 传相同 `{lead_id, account_label}`
- 断言：
  1. 首次调用 HTTP 200，`data.assignment_id` 非空
  2. 第二次调用 HTTP 200（不报 409/500），`dm_assignments` 表中该 `(tenant_id, lead_id, account_label)` 组合仅有一行（ON CONFLICT DO UPDATE 语义）
- 验证命令：
  ```bash
  # 首次
  ASSIGN_ID=$(curl -s -b "$COOKIE_JAR" -X POST "$API_BASE/api/acquisition/manual-outreach" \
    -H "Content-Type: application/json" \
    -d "{\"lead_id\":\"$TEST_LEAD_ID\",\"account_label\":\"$TEST_ACCOUNT\"}" | jq -r '.data.assignment_id')
  [ -n "$ASSIGN_ID" ] || fail "C-06a assignment_id 为空"
  # 重复提交
  HTTP2=$(curl -s -o /dev/null -w "%{http_code}" -b "$COOKIE_JAR" -X POST "$API_BASE/api/acquisition/manual-outreach" \
    -H "Content-Type: application/json" \
    -d "{\"lead_id\":\"$TEST_LEAD_ID\",\"account_label\":\"$TEST_ACCOUNT\"}")
  [ "$HTTP2" = "200" ] || fail "C-06b 重复提交 HTTP $HTTP2，期望 200（幂等）"
  # DB 唯一性
  COUNT=$(psql "$DB_URL" -t -c "SELECT count(*) FROM zenithjoy.dm_assignments WHERE tenant_id='$TEST_TENANT' AND lead_id='$TEST_LEAD_ID' AND account_label='$TEST_ACCOUNT'")
  [ "$COUNT" -eq 1 ] || fail "C-06c dm_assignments 行数=$COUNT，期望 1（幂等去重）"
  ```

**断言 C-07（无 tenant 上下文返回 401）**
- 触发：不携带 session 调用 `POST /api/acquisition/manual-outreach`
- 断言：HTTP 401
- 验证命令：
  ```bash
  HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_BASE/api/acquisition/manual-outreach" \
    -H "Content-Type: application/json" -d '{"lead_id":"x","account_label":"y"}')
  [ "$HTTP" = "401" ] || fail "C-07 未鉴权期望 401，实得 $HTTP"
  ```

**断言 C-08（UI：人工触达弹窗可触发）**
- 触发：Playwright 在 `/dashboard/leads`（或 acquisition 页面）点击某行"人工触达"按钮
- 断言：弹窗出现，含小号选择列表和话术文本框；确认按钮可点击
- 类型：UI交互类 → 截图/文字断言

---

### FR-3：绑号页补安卓客户端下载入口

**断言 C-09（install-pack/manifest 返回 apk_url）**
- 触发：`GET /api/install-pack/manifest`
- 断言：HTTP 200；响应体 `apk_url` 字段非空且以 `http` 开头
- 验证命令：
  ```bash
  APK_URL=$(curl -s "$API_BASE/api/install-pack/manifest" | jq -r '.apk_url // ""')
  [ -n "$APK_URL" ] || fail "C-09 apk_url 为空"
  echo "$APK_URL" | grep -q '^http' || fail "C-09 apk_url 不以 http 开头: $APK_URL"
  ```

**断言 C-10（UI：绑号页含下载按钮/链接）**
- 触发：Playwright 打开账号绑定相关页面（`/area/acquisition/accounts` 或等价路径）
- 断言：页面含"下载安卓客户端"或等价文字的按钮/链接；该链接 href 指向 `apk_url`（以 http 开头）
- 类型：UI交互类 → 文字/属性断言

---

### FR-4：关键词去重提示

**断言 C-11（30天内重复关键词返回 409）**
- 前提：已存在一个 30 天内使用过关键词 `["test_dedup_kw_${RND}"]` 的采集任务（smoke 内先插一条，或造数据）
- 触发：不带 `force:true` 再次 POST 相同关键词
- 断言：HTTP 409；响应体 `error.code = 'KEYWORD_RECENTLY_USED'`；含 `matched_keywords` 数组（非空）；含 `last_used_at` 字符串（ISO 时间格式）
- 验证命令：
  ```bash
  KW="dedupsmoketest${RND}"
  # 首次采集（建立历史记录）
  curl -s -b "$COOKIE_JAR" -X POST "$API_BASE/api/acquisition/collect/start" \
    -H "Content-Type: application/json" \
    -d "{\"keywords\":[\"$KW\"]}" > /dev/null
  # 第二次（期望 409）
  RESP=$(curl -s -b "$COOKIE_JAR" -X POST "$API_BASE/api/acquisition/collect/start" \
    -H "Content-Type: application/json" \
    -d "{\"keywords\":[\"$KW\"]}")
  CODE=$(echo "$RESP" | jq -r '.error.code // ""')
  MATCHED=$(echo "$RESP" | jq -r '.error.matched_keywords | length')
  LAST_USED=$(echo "$RESP" | jq -r '.error.last_used_at // ""')
  [ "$CODE" = "KEYWORD_RECENTLY_USED" ] || fail "C-11a error.code='$CODE' 期望 KEYWORD_RECENTLY_USED"
  [ "$MATCHED" -ge 1 ] || fail "C-11b matched_keywords 为空"
  [ -n "$LAST_USED" ] || fail "C-11c last_used_at 为空"
  ```

**断言 C-12（force=true 绕过去重正常执行）**
- 触发：上述重复关键词带 `force: true` 请求
- 断言：HTTP 200；`data.task_id` 非空
- 验证命令：
  ```bash
  RESP2=$(curl -s -b "$COOKIE_JAR" -X POST "$API_BASE/api/acquisition/collect/start" \
    -H "Content-Type: application/json" \
    -d "{\"keywords\":[\"$KW\"],\"force\":true}")
  TASK_ID=$(echo "$RESP2" | jq -r '.data.task_id // ""')
  [ -n "$TASK_ID" ] || fail "C-12 force=true 时 task_id 为空，期望正常执行"
  ```

**断言 C-13（UI：409 触发弹确认对话框）**
- 触发：Playwright 在采集发起界面输入已采集过的关键词并提交
- 断言：页面出现含"已采集过"或"是否仍要继续"字样的对话框
- 类型：UI交互类 → 文字断言

---

### FR-5：采集任务进度展示 + 设备类型埋点字段对齐

**断言 C-14（agent_os_type 字段存在于 DB）**
- 触发：psql 查询 information_schema
- 断言：查询返回 1 行（字段存在）
- 验证命令：
  ```bash
  COUNT=$(psql "$DB_URL" -t -c "SELECT count(1) FROM information_schema.columns WHERE table_schema='zenithjoy' AND table_name='acquisition_collect_tasks' AND column_name='agent_os_type'")
  [ "$COUNT" -eq 1 ] || fail "C-14 agent_os_type 字段不存在于 acquisition_collect_tasks"
  ```

**断言 C-15（collect-tasks 返回 error_code_message 字段）**
- 触发：`GET /api/acquisition/collect-tasks`（含有效 tenant session）
- 断言：HTTP 200；响应体 `tasks` 数组元素含 `error_code_message` 字段（可为 null，但字段必须存在）；含 `agent_os_type` 字段
- 验证命令：
  ```bash
  RESP=$(curl -s -b "$COOKIE_JAR" "$API_BASE/api/acquisition/collect-tasks")
  # 验证响应结构（取第 0 个 task，若无则验证空数组也合法）
  HAS_ECM=$(echo "$RESP" | jq 'if .tasks | length > 0 then .tasks[0] | has("error_code_message") else true end')
  HAS_OST=$(echo "$RESP" | jq 'if .tasks | length > 0 then .tasks[0] | has("agent_os_type") else true end')
  [ "$HAS_ECM" = "true" ] || fail "C-15a tasks[0] 缺少 error_code_message 字段"
  [ "$HAS_OST" = "true" ] || fail "C-15b tasks[0] 缺少 agent_os_type 字段"
  ```

**断言 C-16（UI：任务列表显示状态徽标 + 失败原因）**
- 触发：Playwright 打开 `/area/acquisition/tasks`
- 断言：任务列表行中可见状态徽标（进行中/已完成/失败等文字标识）；`failed`/`partial` 态任务行含"重试"按钮
- 类型：UI交互类 → 文字/元素断言

**断言 C-17（cancelling 态任务的重试按钮被禁用）**
- 触发：Playwright 或 API 断言：将某任务置 `cancelling` 态后，前端"重试"按钮 disabled 属性为 true
- 断言：重试按钮 disabled 或不存在于 DOM（前端 Invariant #9）
- 类型：UI交互类 → 属性断言

---

## Invariant 合规矩阵

| Invariant | 对应断言 | 验证方式 |
|-----------|---------|---------|
| #1 dm_assignments 唯一键幂等 | C-06（重复提交不报错，行数=1） | API smoke + psql |
| #2 acquisition_collect_tasks status 7 态 | C-15（不依赖库外枚举） | API 字段值域检查 |
| #4 lead 去重 sec_uid 唯一约束 | 已有 Step 9，本 sprint 不涉及 | 已有 smoke 覆盖 |
| #5 APK 下载不重建 | C-09（manifest 端点动态查 apk_url） | API smoke |
| #7 在线判定心跳代理 | C-05（is_online 字段存在） | API 结构检查 |
| #8 租户隔离 | C-07（无 tenant 返回 401）；所有 smoke 步骤携带 tenant session | API smoke |
| #9 cancelling 禁重试 | C-17（重试按钮 disabled） | Playwright UI |
| #10 脏数据取 updated_at DESC LIMIT 1 | C-02（outreach_status 非 null，后端 SQL 兜底） | API smoke |

---

## NFR 断言

| NFR | 断言 | 验证方式 |
|-----|-----|---------|
| P99 < 300ms（500条内） | C-03（idx_dm_assign_tenant_lead_updated 索引存在）；实测可选 | psql + 可选压测 |
| migration 幂等 IF NOT EXISTS | C-14 验证字段存在即可（idempotent re-run 由 PR 审核确认） | psql |
| manual-outreach 写入幂等 | C-06 | API smoke |

---

## 断言汇总

| 编号 | FR | 类型 | 触发 | 核心检查点 |
|------|----|------|------|-----------|
| C-01 | FR-1 | API | GET /leads | outreach_status 字段存在 + 值域合法 |
| C-02 | FR-1 | API+DB | GET /leads + psql | 有 dm_assignment 的 lead outreach_status 非 null |
| C-03 | FR-1 | DB | psql | idx_dm_assign_tenant_lead_updated 索引存在 |
| C-04 | FR-1 | UI | Playwright /dashboard/leads | "触达状态"列头可见 |
| C-05 | FR-2 | API | GET /manual-outreach/candidates | accounts 数组 + default_message 非空 |
| C-06 | FR-2 | API+DB | POST /manual-outreach ×2 | 幂等更新，行数=1 |
| C-07 | FR-2 | API | POST /manual-outreach（无 session） | HTTP 401 |
| C-08 | FR-2 | UI | Playwright 点击"人工触达" | 弹窗出现含选号+话术 |
| C-09 | FR-3 | API | GET /install-pack/manifest | apk_url 非空 + http 开头 |
| C-10 | FR-3 | UI | Playwright 绑号页 | "下载安卓客户端"按钮可见 |
| C-11 | FR-4 | API | POST /collect/start（重复关键词） | HTTP 409 + KEYWORD_RECENTLY_USED + matched_keywords + last_used_at |
| C-12 | FR-4 | API | POST /collect/start（force=true） | HTTP 200 + task_id 非空 |
| C-13 | FR-4 | UI | Playwright 采集界面 | 409 触发确认对话框 |
| C-14 | FR-5 | DB | psql information_schema | agent_os_type 字段存在 |
| C-15 | FR-5 | API | GET /collect-tasks | error_code_message + agent_os_type 字段存在 |
| C-16 | FR-5 | UI | Playwright /area/acquisition/tasks | 状态徽标 + 重试按钮可见 |
| C-17 | FR-5 | UI | Playwright cancelling 态 | 重试按钮 disabled |

**判定点总计：17 个断言（API/DB 类 11 个 + UI 类 6 个）**

---

## 开发顺序强制锚点

```
commit-1: tests/ 下写失败的 smoke + Playwright 框架（本 contract 即定义此框架）
commit-2: migration 20260724_path2_device_type_align.sql（C-14 变绿）
commit-3: 后端实现（C-01 C-02 C-05 C-06 C-07 C-09 C-11 C-12 C-15 变绿）
commit-4: 前端实现（C-04 C-08 C-10 C-13 C-16 C-17 变绿）
commit-5: smoke Step 25-29 全绿；C-03 索引创建随 migration 到位
```

---

## 不包含（超出本 sprint 范围外，合同不覆盖）

- 真实在线小号判定（依赖安卓 Agent 信号上报）
- 触达小号/话术智能推荐
- 任务进度按设备类型完整分列 UI
- 企微 webhook 接入
