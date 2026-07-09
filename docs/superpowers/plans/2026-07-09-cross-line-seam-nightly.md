# 刀B 跨 Line 接缝 nightly E2E 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建云端真后端跨 Line 接缝 nightly E2E（Line02 acquisition 写侧 → SIMULATED-JOIN → Line04 CRM 读侧 + 双向租户隔离）。

**Architecture:** 1 个 smoke 脚本（curl+psql 真链路）+ 1 条 workflow（services.postgres + migrations + 真 apps/api，北京 04:30 nightly，红开 `[cross-line-red]` Issue）。范式照抄 `e2e-line02-lead-human-handoff-windows.yml`（真后端）与 `nightly-real-machine-staging.yml`（红开 Issue）。

**Tech Stack:** bash / psql / curl / GitHub Actions services.postgres / gh CLI。

## Global Constraints

- E2E-first 强制：commit-1 = smoke 脚本（红先行），commit-2 = workflow 接线。
- PR 标题必须带 `[CONFIG]`（改 workflows）。
- 接缝步必须在脚本输出与 workflow name 中标注 `SIMULATED-JOIN`（假绿灯纪律 PR#1193）。
- Issue 前缀 `[cross-line-red]`（不得用 `[nightly-red]`，避免与刀A 同日去重互吞）。
- handler 判 `process.env.VITEST` 跳过写库——workflow 只设 `NODE_ENV=test`，**绝不能设 VITEST**。
- `set -euo pipefail` 下「断言不存在」必须用 `if grep; then fail; fi`，禁止 `grep && fail`（grep 未命中返回非 0 会被 set -e 杀掉脚本）。

---

### Task 1: smoke 脚本（commit-1，E2E 红先行）

**Files:**
- Create: `.github/workflows/scripts/smoke/cross-line-seam-smoke.sh`

**Interfaces:**
- Consumes: 运行中的 apps/api（`API_BASE`，默认 `http://localhost:5200`）+ postgres（`DATABASE_HOST/PORT/USER/PASSWORD/NAME`，默认 localhost/5432/cecelia/cecelia/cecelia）。
- Produces: exit 0 = 接缝贯通；非 0 = 红。`FIRE_TEST=1` 时故意断言失败（proven-to-fire 用）。Task 2 的 workflow 以 `bash .github/workflows/scripts/smoke/cross-line-seam-smoke.sh` 调用。

- [ ] **Step 1: 写脚本（完整内容如下）**

```bash
#!/usr/bin/env bash
# cross-line-seam-smoke.sh — 刀B：跨 Line 接缝云端真后端 E2E
#
# 链路：Line02 acquisition 写侧（真 API）→ [SIMULATED-JOIN] → Line04 CRM 读侧（真 API）+ 双向租户隔离。
#
# ⚠️ 诚实声明（假绿灯纪律，同 PR#1193）：
#   第 3 步 [SIMULATED-JOIN] 用 psql 模拟「lead 被私信引导加企微 → 真人加好友 → agent 扫好友入册」
#   这条现实中的人工链路。两 Line 无代码级自动接缝（Line02 身份=抖音 sec_uid，Line04 身份=微信昵称），
#   本闸守的是：两 Line 后端合跑 / migrations 组合 / 租户链贯通，不代表真机 RPA 接缝已验证。
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
DB_HOST="${DATABASE_HOST:-localhost}"
DB_PORT="${DATABASE_PORT:-5432}"
DB_USER="${DATABASE_USER:-cecelia}"
DB_PASS="${DATABASE_PASSWORD:-cecelia}"
DB_NAME="${DATABASE_NAME:-cecelia}"
RUN_ID="$(date +%s)$$"

psql_q() { PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -qtAc "$1"; }
fail() { echo "❌ $1"; exit 1; }
ok()   { echo "✅ $1"; }

echo "== [1/5] 种子：租户 A/B + 成员 + 客服机 + 关键词任务 =="
TENANT_A=$(psql_q "INSERT INTO zenithjoy.tenants (name, license_key) VALUES ('ci-cross-a-$RUN_ID','lk_cross_a_$RUN_ID') RETURNING id")
TENANT_B=$(psql_q "INSERT INTO zenithjoy.tenants (name, license_key) VALUES ('ci-cross-b-$RUN_ID','lk_cross_b_$RUN_ID') RETURNING id")
USER_A="ci-cross-a-$RUN_ID"
USER_B="ci-cross-b-$RUN_ID"
psql_q "INSERT INTO zenithjoy.tenant_members (tenant_id, feishu_user_id, role) VALUES ('$TENANT_A','$USER_A','admin'),('$TENANT_B','$USER_B','admin')" >/dev/null
CS_WX="wx_cs_ci_$RUN_ID"
psql_q "INSERT INTO zenithjoy.service_agents (tenant_id, machine_id, wechat_id) VALUES ('$TENANT_A','ci-machine-$RUN_ID','$CS_WX')" >/dev/null
KT_ID=$(psql_q "INSERT INTO zenithjoy.acquisition_keyword_tasks (keyword, tenant_id) VALUES ('护肤','$TENANT_A') RETURNING id")
[ -n "$TENANT_A" ] && [ -n "$TENANT_B" ] && [ -n "$KT_ID" ] || fail "种子失败"
ok "tenant A=$TENANT_A / B=$TENANT_B / keyword_task=$KT_ID"

echo "== [2/5] Line02 写侧：真 API 上报评论 → acquisition_leads =="
SEC_UID="SECCROSS$RUN_ID"
HTTP_BODY=$(curl -sf -X POST "$API_BASE/api/acquisition/comment-score-result" \
  -H 'Content-Type: application/json' \
  -d "{\"keyword_task_id\":\"$KT_ID\",\"video_url\":\"https://www.douyin.com/video/ci-cross-$RUN_ID\",\"comments\":[{\"commenter_id\":\"/user/$SEC_UID\",\"text\":\"求链接，怎么买\",\"grade\":\"A\",\"keyword\":\"护肤\"}]}") \
  || fail "写侧 API 调用失败"
echo "$HTTP_BODY" | grep -q '"written_count":1' || fail "written_count != 1: $HTTP_BODY"
LEAD_TENANT=$(psql_q "SELECT tenant_id FROM zenithjoy.acquisition_leads WHERE sec_uid='$SEC_UID'")
[ "$LEAD_TENANT" = "$TENANT_A" ] || fail "lead 未落库或租户错: '$LEAD_TENANT'"
KT_STATUS=$(psql_q "SELECT status FROM zenithjoy.acquisition_keyword_tasks WHERE id='$KT_ID'")
[ "$KT_STATUS" = "done" ] || fail "keyword_task 未标 done（回归 PR#1186 类）: '$KT_STATUS'"
ok "lead 落库 tenant=A，keyword_task=done"

echo "== [3/5] [SIMULATED-JOIN] ⚠️ 模拟人工加微链路（私信引导加企微→真人加好友→agent 扫好友入册），非真实 RPA 接缝 =="
CONTACT="crossline-customer-$RUN_ID"
psql_q "INSERT INTO zenithjoy.crm_customers (tenant_id, cs_wechat_id, contact, source) VALUES ('$TENANT_A','$CS_WX','$CONTACT','scan')" >/dev/null
psql_q "INSERT INTO zenithjoy.cs_memory_messages (tenant_id, contact, role, text) VALUES ('$TENANT_A','$CONTACT','in','你好，我从抖音评论区来的')" >/dev/null
ok "已模拟入册: $CONTACT"

echo "== [4/5] Line04 读侧：CRM 名册可见该客户 =="
CRM_A=$(curl -sf -H "X-Feishu-User-Id: $USER_A" "$API_BASE/api/crm/customers") || fail "CRM API 调用失败"
echo "$CRM_A" | grep -q "$CONTACT" || fail "tenant A 名册看不到 $CONTACT"
ok "tenant A 名册可见 $CONTACT"

if [ "${FIRE_TEST:-0}" = "1" ]; then
  echo "== [FIRE_TEST] 故意断言不存在的客户（proven-to-fire 验证）=="
  echo "$CRM_A" | grep -q "fire-test-nonexistent-customer" || fail "FIRE_TEST：预期失败——本闸证明会咬人"
fi

echo "== [5/5] 双向租户隔离 =="
CRM_B=$(curl -sf -H "X-Feishu-User-Id: $USER_B" "$API_BASE/api/crm/customers") || fail "CRM API (B) 调用失败"
if echo "$CRM_B" | grep -q "$CONTACT"; then fail "租户隔离破裂：tenant B 看到了 A 的客户"; fi
HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$API_BASE/api/crm/customers")
[ "$HTTP_CODE" = "401" ] || fail "无头访问应 401，实际 $HTTP_CODE"
LEAK=$(psql_q "SELECT count(*) FROM zenithjoy.acquisition_leads WHERE sec_uid='$SEC_UID' AND tenant_id <> '$TENANT_A'")
[ "$LEAK" = "0" ] || fail "lead 泄漏到其他租户"
ok "隔离双向成立（B 不可见 A / 无头 401 / lead 无泄漏）"

echo "🎉 跨 Line 接缝 E2E 全部通过（第 3 步为 SIMULATED-JOIN 模拟，非真机 RPA）"
```

- [ ] **Step 2: 验证语法 + 验证红（无后端环境跑必红）**

Run: `bash -n .github/workflows/scripts/smoke/cross-line-seam-smoke.sh && bash .github/workflows/scripts/smoke/cross-line-seam-smoke.sh; echo "exit=$?"`
Expected: `bash -n` 无输出；执行因本地无 postgres/API 在第 1 步种子处失败，exit 非 0（这就是 commit-1 的「红」证明，记录输出）。

- [ ] **Step 3: Commit（commit-1）**

```bash
git add .github/workflows/scripts/smoke/cross-line-seam-smoke.sh
git commit -m "test: 跨Line接缝 E2E smoke 先行（Line02写侧→SIMULATED-JOIN→Line04 CRM读侧+租户隔离）"
```

---

### Task 2: workflow 接线（commit-2）

**Files:**
- Create: `.github/workflows/integration-cross-line.yml`

**Interfaces:**
- Consumes: Task 1 的脚本路径 `.github/workflows/scripts/smoke/cross-line-seam-smoke.sh`，及其 env 约定（`FIRE_TEST`、`API_BASE` 默认值、`DATABASE_*`）。
- Produces: schedule + workflow_dispatch 的 nightly workflow；红开 `[cross-line-red]` Issue。

- [ ] **Step 1: 写 workflow（完整内容如下）**

```yaml
# [CONFIG] 刀B：跨 Line 接缝云端真后端 E2E（nightly 云轨，6站2轨④站云轨 full check）
#
# 诚实声明：本 workflow 全程 ubuntu 云机。接缝步为 SIMULATED-JOIN（psql 模拟人工加微入册），
# 非真机 RPA——守的是两 Line 后端合跑 / migrations 组合 / 租户链贯通三样（此前零覆盖）。
# 真机接缝属后续刀（见 0709 handoff 真机 full check 缺口清单）。
name: "[CLOUD] integration-cross-line — 跨Line接缝云端真后端E2E（接缝步SIMULATED-JOIN，非真机RPA）"

on:
  schedule:
    - cron: '30 20 * * *'   # UTC 20:30 = 北京 04:30，错开刀A 真机 nightly（北京 03:00）
  workflow_dispatch:
    inputs:
      fire_test:
        description: '传 1 = 故意断言失败（proven-to-fire 验证）'
        required: false
        default: '0'

permissions:
  issues: write

concurrency:
  group: integration-cross-line
  cancel-in-progress: false

jobs:
  cross-line-e2e:
    name: 跨Line接缝 — 云真后端 E2E
    runs-on: ubuntu-latest
    timeout-minutes: 15

    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_USER: cecelia
          POSTGRES_PASSWORD: cecelia
          POSTGRES_DB: cecelia
        ports: ['5432:5432']
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    env:
      DATABASE_HOST: localhost
      DATABASE_PORT: 5432
      DATABASE_USER: cecelia
      DATABASE_PASSWORD: cecelia
      DATABASE_NAME: cecelia
      PORT: 5200
      NODE_ENV: test
      BETTER_AUTH_SECRET: ci-only-secret-32-chars-min-not-prod-123
      BETTER_AUTH_URL: http://localhost:5200

    defaults:
      run:
        shell: bash

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install deps
        run: npm ci

      - name: Create zenithjoy schema + pgcrypto
        env:
          PGPASSWORD: cecelia
        run: |
          psql -h localhost -U cecelia -d cecelia -c "CREATE SCHEMA IF NOT EXISTS zenithjoy;"
          psql -h localhost -U cecelia -d cecelia -c "CREATE EXTENSION IF NOT EXISTS \"pgcrypto\";"

      - name: Run apps/api/db migrations
        env:
          PGPASSWORD: cecelia
        run: |
          for f in apps/api/db/migrations/*.sql; do
            echo "→ $f"
            psql -h localhost -U cecelia -d cecelia -v ON_ERROR_STOP=1 -f "$f"
          done

      - name: Build apps/api
        working-directory: apps/api
        run: npm run build

      - name: Start apps/api
        working-directory: apps/api
        run: |
          node dist/index.js > /tmp/apps-api.log 2>&1 &
          for i in $(seq 1 30); do
            if curl -fs http://localhost:5200/health >/dev/null 2>&1; then
              echo "apps/api ready after ${i}s"
              break
            fi
            sleep 1
          done
          curl -fs http://localhost:5200/health || (cat /tmp/apps-api.log && exit 1)

      - name: Run cross-line seam smoke
        env:
          FIRE_TEST: ${{ github.event.inputs.fire_test || '0' }}
        run: bash .github/workflows/scripts/smoke/cross-line-seam-smoke.sh

      - name: Dump apps/api log on failure
        if: failure()
        run: cat /tmp/apps-api.log || true

      - name: Upload api log on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: cross-line-apps-api-log
          path: /tmp/apps-api.log
          retention-days: 7

  nightly-report:
    name: 汇总（红→开 Issue）
    needs: [cross-line-e2e]
    if: always()
    runs-on: ubuntu-latest
    env:
      GH_TOKEN: ${{ github.token }}
    steps:
      - name: 红了开 Issue（同日去重，前缀 [cross-line-red]）
        run: |
          RESULT="${{ needs.cross-line-e2e.result }}"
          echo "cross-line-e2e = $RESULT"
          if [ "$RESULT" = "success" ] || [ "$RESULT" = "skipped" ]; then
            echo "绿，无需开 Issue"
            exit 0
          fi
          TODAY=$(TZ=Asia/Shanghai date +%Y-%m-%d)
          EXIST=$(gh issue list --repo "$GITHUB_REPOSITORY" --state open \
            --search "in:title [cross-line-red] $TODAY" --json number --jq 'length')
          if [ "$EXIST" = "0" ]; then
            gh issue create --repo "$GITHUB_REPOSITORY" \
              --title "[cross-line-red] 跨Line接缝夜班失败 $TODAY (e2e=$RESULT)" \
              --body "$(printf '## 跨Line接缝 nightly 失败\n\n| job | 结果 |\n|---|---|\n| cross-line-e2e | %s |\n\nRun: %s/%s/actions/runs/%s\n\n### 处理约定\n- flaky 嫌疑：先 rerun 一次\n- 连续 2 晚红 = 真 bug，走 /dev 立案修复\n- 本 workflow 接缝步为 SIMULATED-JOIN（非真机 RPA），红通常意味着 migrations/后端合跑/租户链坏了\n' "$RESULT" "$GITHUB_SERVER_URL" "$GITHUB_REPOSITORY" "$GITHUB_RUN_ID")"
          else
            echo "今日已有 open 的 [cross-line-red] Issue，去重跳过"
          fi
          exit 1
```

- [ ] **Step 2: 验证 YAML 语法**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/integration-cross-line.yml')); print('YAML OK')"`
Expected: `YAML OK`（若本机有 actionlint 则再跑 `actionlint .github/workflows/integration-cross-line.yml`，Expected 无输出）。

- [ ] **Step 3: Commit（commit-2）**

```bash
git add .github/workflows/integration-cross-line.yml
git commit -m "[CONFIG] feat(ci): integration-cross-line 跨Line接缝云端真后端 nightly（刀B·6站2轨④站云轨）"
```

---

### Task 3: merge 后验证（PR merged 之后才可执行，workflow_dispatch 只认 main 上的 workflow）

- [ ] **Step 1: proven to work** — `gh workflow run integration-cross-line.yml --repo perfectuser21/zenithjoy-workspace` → 轮询该 run 至绿。
- [ ] **Step 2: proven-to-fire** — `gh workflow run integration-cross-line.yml --repo perfectuser21/zenithjoy-workspace -f fire_test=1` → 轮询至红，确认 `[cross-line-red]` Issue 真开出 → 关闭该 Issue（注明 fire-test）。
- [ ] **Step 3: 记录两个 run 链接**（写进 task result / handoff）。
