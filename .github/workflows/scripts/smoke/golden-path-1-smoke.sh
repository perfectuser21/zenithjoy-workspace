#!/usr/bin/env bash
# golden-path-1-smoke.sh
# ZenithJoy Walking Skeleton — 客户首次成功路径（B 形态，6 步）
# Notion Journey: https://www.notion.so/358c40c2ba6381b2a6eacd288cf82f29
#
# 这是这个产品的"用户路径"金标准 smoke。
# 每个 PR 推进的 step 必须让 smoke 多过一关。
# Feature 0（端到端 gating）= 整条 smoke 全绿才算 sprint 成功，单 step 通不算。
#
# 当前状态：全红骨架。每个 step 都 EXIT_AT_STEP_X，等待 PR 把 step N 从红推到绿。
#
# 用法：
#   bash .github/workflows/scripts/smoke/golden-path-1-smoke.sh
#   退出码 0 = 端到端全通；非零 = 第 EXIT_CODE 步红
#
# 升级 Feature thickness 时记得同步 .replaces_old_thin（删 mock/hardcode）

set -uo pipefail

API_BASE="${API_BASE:-http://localhost:3001}"
DASHBOARD_BASE="${DASHBOARD_BASE:-http://localhost:5173}"
TEST_EMAIL="${TEST_EMAIL:-smoke-$(date +%s)@zenithjoy.test}"
TEST_PASSWORD="${TEST_PASSWORD:-Smoke!Test2026}"

ok()   { echo "✅ $1"; }
fail() { echo "❌ $1"; exit "$2"; }
todo() { echo "🔴 $1 — TODO（未实现）"; exit "$2"; }

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ZenithJoy Path 1 Walking Skeleton — 客户首次成功路径"
echo "  6 步：注册 → 装客户端 → 画像诊断 → 绑平台 → AI生成 → 发布回执"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ───────────────────────────────────────────────────────────────────
# Step 1：注册自动登录（含 free license 自动创建）
# Notion Feature: 358c40c2-ba63-8102-a531-f49111b8832e
# DoD：POST /api/auth/sign-up/email 200 + 自动建 free license + 自动建 free tenant
# 现状：代码已 ~medium（PR #239-244），smoke 待写
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 1: 注册自动登录"
todo "Step 1 smoke 待写：curl POST /api/auth/sign-up/email + 验证 free license/tenant 已建" 1

# ───────────────────────────────────────────────────────────────────
# Step 2：装客户端 + Agent 自动连中台
# Notion Feature: 358c40c2-ba63-81d1-94e5-eb08a6f8b9f6
# DoD：Dashboard 暴露下载链接 + Agent .exe/.dmg 启动后能用 license 注册回中台
# 现状：Agent 代码完整（services/agent），但 Dashboard 没下载页 + 缺 release 自动发
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 2: 装客户端连中台"
todo "Step 2 smoke 待写：curl GET /download 200 + Agent register API 200 + WS 连接成功" 2

# ───────────────────────────────────────────────────────────────────
# Step 3：填画像诊断（行业 / 受众 / 风格 3 字段）
# Notion Feature: 358c40c2-ba63-812c-88e8-c1db0d5e31db
# DoD：Dashboard /onboarding/profile 表单提交 → 写 user_profiles 表
# 现状：❌ 完全没做，全新模块
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 3: 填画像诊断"
todo "Step 3 smoke 待写：curl POST /api/profile + 验证 DB 落表" 3

# ───────────────────────────────────────────────────────────────────
# Step 4：扫码绑定快手（Agent 弹登录窗）
# Notion Feature: 358c40c2-ba63-813d-9500-c5f24ddb6d7e
# DoD：Agent 弹 Electron BrowserWindow → 用户扫码 → cookie 存本地 → 上报 ready
# 现状：🟡 8 平台 handler 都在（services/agent/src/handlers），但缺登录弹窗
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 4: 绑定 1 个平台（快手）"
todo "Step 4 smoke 待写：触发 Agent 平台登录 + 验证 agent_skill_status=ready" 4

# ───────────────────────────────────────────────────────────────────
# Step 5：AI 生成 1 条内容（接 Claude API，画像作 prompt）
# Notion Feature: 358c40c2-ba63-8110-b3c5-d55c7f015000
# DoD：调 Claude API + 画像作为 system prompt + 返回一段 ≥100 字内容
# 现状：❌ 完全没做，全新模块
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 5: AI 生成内容"
todo "Step 5 smoke 待写：curl POST /api/generate + 验证返回内容含画像关键词" 5

# ───────────────────────────────────────────────────────────────────
# Step 6：中台派任务 + dryrun 发布 + 回执显示
# Notion Feature: 358c40c2-ba63-81c5-a956-cf0d8f3a9499
# DoD：POST /api/works/:id/publish → sendToAgent → kuaishou-publish dryrun
#       → 回写 work.publish_status=success + Dashboard 显示回执
# 现状：🟡 表单/api/works 在，但缺中台→Agent 任务派发链路
# ───────────────────────────────────────────────────────────────────
echo "▶ Step 6: 一键发布看回执"
todo "Step 6 smoke 待写：curl POST /api/works/:id/publish + 等待 Agent 回执 + 验证 publish_status=success" 6

# ───────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ok "Path 1 端到端全绿 ✅ — Journey 可升 skeleton（用 walking-skeleton skill thicken）"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
exit 0
