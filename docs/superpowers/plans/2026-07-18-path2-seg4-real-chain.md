# Path2 Seg1-4 服务端真实数据串联 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `golden-path-2-smoke.sh` 新增 Step 22，把 Step15 真实产出的 lead 接入真实
`/dispatch/build` + `/dispatch/run`，证明服务端数据从采集到私信派单是真实流动的，不是四段
各自独立造数据测试。

**Architecture:** 纯新增一段 smoke 脚本内容（复用既有变量 `$TENANT_ID`/`$AGENT_PK`/
`$S15_DOUYIN_ID`），不改任何生产代码。四个真实 HTTP 调用 + 两次 psql 断言。

**Tech Stack:** Bash smoke script（curl + psql + python3 json 解析），与 Step1-21 完全同构风格。

---

### Task 1: 新增 Step 22 — Seg4 真实派单串联断言

**Files:**
- Modify: `.github/workflows/scripts/smoke/golden-path-2-smoke.sh`（在 Step 21 与
  `rm -f "$S1_TMP" ...` 清理段之间插入新内容；文件末尾横幅文案同步更新为"22 步"）

- [ ] **Step 1: 在 Step 21 结束（`ok "Step 21 ✅ ..."`）之后、`rm -f "$S1_TMP"` 清理行之前，插入新内容**

```bash

# ───────────────────────────────────────────────────────────────────
# Step 22：Seg4 真实派单串联——Step15 真实产出的 lead 走真实 dispatch/build+run
# （2026-07-18 根因排查：私信段此前测试全靠人工构造 dm_assignment 反复重发同一个
# 固定测试 lead，staging 实测 account_label='manual-test'/'manual-burner-test'，
# 跟 Seg1-3 产出完全脱节。本 Step 首次证明数据能从 Step15 真实产出的 lead 真实流到
# dm_outreach publish_task，不新增生产代码，只是把已有真实端点接线验证。）
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 22: Seg4 真实派单串联（Step15 lead → dispatch/build → dispatch/run）"

# 22a：撑满全天时段闸，避免 CI 运行时刻撞上生产默认 09:00-22:00 窗口导致断言随机失败
S22_TMP=$(mktemp)
S22_HTTP=$(curl -s -o "$S22_TMP" -w "%{http_code}" --max-time 15 \
  -X PATCH "$API_BASE/api/acquisition/config" \
  -H "Content-Type: application/json" -H "X-Tenant-Id: $TENANT_ID" \
  -d '{"dm_active_start":"00:00","dm_active_end":"23:59"}')
[ "$S22_HTTP" = "200" ] || fail "Step 22a PATCH dm_active window expected 200, got $S22_HTTP: $(cat "$S22_TMP")" 22
ok "Step 22a ✅ dm_active_start/end 撑满全天（避免时段闸随机失败）"

# 22b：真调 dispatch/build（scoreLeads + buildAssignments）
S22B_TMP=$(mktemp)
S22B_HTTP=$(curl -s -o "$S22B_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/acquisition/dispatch/build" \
  -H "Content-Type: application/json" -H "X-Tenant-Id: $TENANT_ID" -d '{}')
[ "$S22B_HTTP" = "200" ] || fail "Step 22b POST dispatch/build expected 200, got $S22B_HTTP: $(cat "$S22B_TMP")" 22
S22_ASSIGNED=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['data']['assigned'])" "$S22B_TMP" 2>/dev/null || echo 0)
[ "$S22_ASSIGNED" -ge 1 ] 2>/dev/null || fail "Step 22b assigned=$S22_ASSIGNED，期望 >=1（Step15 产出的 lead 没被真实挑中派单）: $(cat "$S22B_TMP")" 22
ok "Step 22b ✅ dispatch/build assigned=$S22_ASSIGNED（Step15 lead 被真实挑中）"

# 22c：真调 dispatch/run（dispatchDue）
S22C_TMP=$(mktemp)
S22C_HTTP=$(curl -s -o "$S22C_TMP" -w "%{http_code}" --max-time 15 \
  -X POST "$API_BASE/api/acquisition/dispatch/run" \
  -H "Content-Type: application/json" -H "X-Tenant-Id: $TENANT_ID" -d '{}')
[ "$S22C_HTTP" = "200" ] || fail "Step 22c POST dispatch/run expected 200, got $S22C_HTTP: $(cat "$S22C_TMP")" 22
S22_DISPATCHED=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['data']['dispatched'])" "$S22C_TMP" 2>/dev/null || echo 0)
[ "$S22_DISPATCHED" -ge 1 ] 2>/dev/null || fail "Step 22c dispatched=$S22_DISPATCHED，期望 >=1: $(cat "$S22C_TMP")" 22
ok "Step 22c ✅ dispatch/run dispatched=$S22_DISPATCHED"

# 22d：断言真实产出的 publish_task 携带 Step15 那个真实 douyin_id + device_platform=android
#      + dm_assignment_id 回联到真实 dm_assignments 行（非硬编码）
S22_DOUYIN=$(psq "SELECT payload->>'douyin_id' FROM zenithjoy.publish_tasks
  WHERE agent_id='$AGENT_PK' AND task_type='dm_outreach'
  ORDER BY created_at DESC LIMIT 1")
[ "$S22_DOUYIN" = "$S15_DOUYIN_ID" ] || fail "Step 22d publish_task.douyin_id='$S22_DOUYIN' 期望等于 Step15 真实产出的 '$S15_DOUYIN_ID'（Seg3→Seg4 数据未真实串联）" 22

S22_PLATFORM=$(psq "SELECT payload->>'device_platform' FROM zenithjoy.publish_tasks
  WHERE agent_id='$AGENT_PK' AND task_type='dm_outreach'
  ORDER BY created_at DESC LIMIT 1")
[ "$S22_PLATFORM" = "android" ] || fail "Step 22d device_platform='$S22_PLATFORM' 期望 'android'（Step11 capabilities 同步未生效或未复用）" 22

S22_ASSIGN_ID=$(psq "SELECT payload->>'dm_assignment_id' FROM zenithjoy.publish_tasks
  WHERE agent_id='$AGENT_PK' AND task_type='dm_outreach'
  ORDER BY created_at DESC LIMIT 1")
S22_ASSIGN_REAL=$(psq "SELECT count(*) FROM zenithjoy.dm_assignments WHERE id='$S22_ASSIGN_ID'::uuid")
[ "$S22_ASSIGN_REAL" = "1" ] || fail "Step 22d dm_assignment_id='$S22_ASSIGN_ID' 在 dm_assignments 表里查不到真实行（疑似硬编码值而非 dispatch/build 真实产出）" 22

ok "Step 22d ✅ publish_task 真实携带 Step15 douyin_id=$S22_DOUYIN + device_platform=android + dm_assignment_id 回联真实行"
ok "Step 22 ✅ Seg4 真实派单串联通过——数据从采集/判定/抓评论真实流到私信派单"

rm -f "$S22_TMP" "$S22B_TMP" "$S22C_TMP" 2>/dev/null
```

- [ ] **Step 2: 更新末尾横幅文案**

把文件末尾（`rm -f "$S1_TMP" ...` 之后的横幅）里的 "21 步" 改成 "22 步"：

```bash
echo "  ✅ Path 2 22 步本地版 smoke 全绿（服务端段）"
```

- [ ] **Step 3: 更新脚本头部 Step 清单注释**

在文件头（第 10-24 行附近的 "14 步（本地版）" 步骤清单）末尾补一行：

```
#   Step 22 Seg4 真实派单串联：Step15 真实产出的 lead 走真实 dispatch/build+run，
#           验证数据从采集/判定/抓评论真实流到私信派单（非独立造数据测试）
```

- [ ] **Step 4: 本地起 API + Postgres，跑一遍完整脚本确认新 Step22 通过且不破坏 Step1-21**

```bash
cd apps/api && npm run build
# 启动 API（复用之前会话已验证过的本地环境变量组合）
PORT=5200 NODE_ENV=development \
DATABASE_URL="postgres://cecelia:cecelia@localhost:5432/cecelia" \
PGHOST=localhost PGUSER=cecelia PGPASSWORD=cecelia PGDATABASE=cecelia \
TOAPIS_API_KEY="${TOAPIS_API_KEY:-}" \
node dist/index.js > /tmp/zj-api-step22.log 2>&1 &
sleep 4
curl -fs http://localhost:5200/health
cd ../..
API_BASE=http://localhost:5200 DB_URL="postgres://cecelia:cecelia@localhost:5432/cecelia" \
  bash .github/workflows/scripts/smoke/golden-path-2-smoke.sh
echo "EXIT:$?"
```

Expected: 输出到 Step 22d 全部 `✅`，最终 `EXIT:0`。若 Step8（judge-video 真调 Gemini）因缺
`TOAPIS_API_KEY` 而红，属于既有已知依赖（脚本头注释已写明"无 key 时 Step 8 真红"），需要设置真实
key 才能跑到 Step22——若本地没有该 key，改为只验证 Step22 相关的新增代码语法正确
（`bash -n`）+ 单独用 mock 好 Step15 前置数据后手动跑 Step22a-d 四段验证。

- [ ] **Step 5: `bash -n` 语法检查（无论能否跑通整条链路都必须做）**

```bash
bash -n .github/workflows/scripts/smoke/golden-path-2-smoke.sh
echo "EXIT:$?"
```

Expected: `EXIT:0`，无语法错误。

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/scripts/smoke/golden-path-2-smoke.sh
git commit -m "test(golden-path-2): 加Step22——Seg4真实派单串联Step15产出的真实lead

根因排查(decision d996b4c7)：私信段测试此前全靠人工构造assignment反复重发固定
测试lead，跟Seg1-3产出完全脱节。新增Step22证明数据能从Step15真实产出的lead
真实流到dm_outreach publish_task，不新增生产代码，只接线验证已有真实端点。"
```

---

### Task 2: 全量回归 + 收尾

**Files:** 无新文件

- [ ] **Step 1: 跑既有 smoke 相关单测确认没有被新增内容间接破坏**

Run: `cd apps/api && npx vitest run`
Expected: 与改动前基线一致（本次未改任何 `apps/api/src` 生产代码，理论上全绿）

- [ ] **Step 2: 确认没有遗漏 `$S15_DOUYIN_ID` 变量名**

Run: `grep -n 'S15_DOUYIN_ID' .github/workflows/scripts/smoke/golden-path-2-smoke.sh`
Expected: Step15 定义处 + 本次 Step22d 引用处，变量名完全一致，无拼写不一致

- [ ] **Step 3: 最终 commit（如有遗漏文件）**

```bash
git status --short
```
