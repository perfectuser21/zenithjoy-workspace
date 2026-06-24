#!/usr/bin/env bash
# staging-promote-smoke.sh
# 蓝绿部署 staging→promote 闸 E2E smoke —— 端到端验证 deploy-lib.sh 的部署编排器
# blue_green_deploy 在两种失败路径下「绝不碰生产 :5200」：
#
#   现状根因（PrepPRD）：main 合并 → CD 直接重启生产 :5200，没有 staging。
#   部署 bug 第一个撞上的是 230 个真客户。本闸把「先 staging 验过、再 promote 切生产」固化进 lib，
#   并在两条失败路径自动护住生产。
#
# 本 smoke 用「可注入 hook」驱动 blue_green_deploy（不连真 mmv），proven-to-fire 三条路径：
#   路径 1（happy）   ：staging 验证全绿 → promote 成功 → 生产被切到新版本（PROD_STATE=NEW）
#   路径 2（staging 红）：staging 验证失败 → 不 promote → 生产纹丝不动（PROD_STATE=OLD）→ 销毁 staging slot → 报 P0
#   路径 3（promote 红）：staging 绿但 promote 中途失败 → 自动回滚到上一版 sha → 生产健康且==OLD sha → 报 P0
#
# blue_green_deploy 的契约（hook 名通过环境变量传入，便于真部署注入真实命令、smoke 注入 mock）：
#   BG_DEPLOY_STAGING_FN   起 staging slot :5201（连 test 库）
#   BG_VERIFY_STAGING_FN   在 :5201 跑部署验证（migration/health/版本断言/golden-path smoke）
#   BG_RECORD_ANCHOR_FN    promote 前记录当前 :5200 sha（回滚锚点），打印到 stdout
#   BG_PROMOTE_FN          把验过的新 build 切进 :5200（方案 A：重启）
#   BG_VERIFY_PROD_FN      promote 后断言 :5200 health + sha==目标
#   BG_ROLLBACK_FN         promote 失败时把 :5200 恢复到锚点 sha
#   BG_DESTROY_STAGING_FN  销毁 :5201 slot
#   BG_ALERT_P0_FN         开 P0 通知 Brain
#
# 退出码：0 全过；1 路径1 没把生产切到 NEW；2 路径2 生产被碰了/没报 P0；3 路径3 没回滚/没报 P0
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
# shellcheck source=/dev/null
source "${REPO_ROOT}/.github/workflows/scripts/deploy-lib.sh"

STATE_DIR="$(mktemp -d)"
trap 'rm -rf "$STATE_DIR"' EXIT
PROD_STATE_FILE="$STATE_DIR/prod_state"      # 生产 :5200 当前形态：OLD / NEW
PROD_SHA_FILE="$STATE_DIR/prod_sha"          # 生产 :5200 当前 sha
STAGING_FILE="$STATE_DIR/staging"            # staging slot 状态：UP / DESTROYED
P0_FILE="$STATE_DIR/p0"                      # P0 是否开过

OLD_SHA="oldoldold111111"
NEW_SHA="newnewnew222222"

reset_world() {
  echo "OLD" > "$PROD_STATE_FILE"
  echo "$OLD_SHA" > "$PROD_SHA_FILE"
  echo "NONE" > "$STAGING_FILE"
  echo "NO" > "$P0_FILE"
}

# ── mock hook 实现（模拟 mmv 上真实命令的副作用，只动 mock 状态文件）──
mock_deploy_staging() { echo "UP" > "$STAGING_FILE"; echo "  [mock] staging slot :5201 起来了"; return 0; }
mock_destroy_staging() { echo "DESTROYED" > "$STAGING_FILE"; echo "  [mock] staging slot :5201 已销毁"; return 0; }
mock_record_anchor() { cat "$PROD_SHA_FILE"; }                 # 返回当前生产 sha 作锚点
mock_alert_p0() { echo "YES" > "$P0_FILE"; echo "  [mock] 已开 P0 通知 Brain"; return 0; }

mock_verify_staging_green() { echo "  [mock] staging 验证：migration ok / health ok / sha ok / smoke ok"; return 0; }
mock_verify_staging_red()   { echo "  [mock] staging 验证：:5201 /health 挂了 ❌"; return 1; }

# promote 成功：把生产切到 NEW + 新 sha
mock_promote_ok() { echo "NEW" > "$PROD_STATE_FILE"; echo "$NEW_SHA" > "$PROD_SHA_FILE"; echo "  [mock] promote：:5200 已切到新 build"; return 0; }
# promote 失败：模拟切一半挂了（生产被破坏成半死：sha 变 NEW 但进程不健康）
mock_promote_fail() { echo "BROKEN" > "$PROD_STATE_FILE"; echo "$NEW_SHA" > "$PROD_SHA_FILE"; echo "  [mock] promote 中途失败 ❌（:5200 半死）"; return 1; }

mock_verify_prod() { [ "$(cat "$PROD_STATE_FILE")" = "NEW" ] && return 0 || return 1; }
# 回滚：把生产恢复到锚点 sha + 健康（OLD 态）
mock_rollback() { local anchor="$1"; echo "OLD" > "$PROD_STATE_FILE"; echo "$anchor" > "$PROD_SHA_FILE"; echo "  [mock] 回滚：:5200 恢复到锚点 sha=$anchor"; return 0; }

PASS=0; FAIL=0
ok()  { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
# assert <实际> <期望> <说明>：相等→ok，否则→bad（避免 A && B || C 误判，shellcheck 干净）
assert() {
  local got="$1" want="$2" desc="$3"
  if [ "$got" = "$want" ]; then ok "$desc"; else bad "$desc（实际=$got 期望=$want）"; fi
}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  蓝绿部署 staging→promote 闸 smoke — blue_green_deploy proven-to-fire"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ─── 路径 1：happy path — staging 绿 → promote 成功 → 生产切到 NEW ───
echo ""
echo "▶ 路径 1（happy）：staging 绿 → promote → 生产切到 NEW"
reset_world
BG_DEPLOY_STAGING_FN=mock_deploy_staging \
BG_VERIFY_STAGING_FN=mock_verify_staging_green \
BG_RECORD_ANCHOR_FN=mock_record_anchor \
BG_PROMOTE_FN=mock_promote_ok \
BG_VERIFY_PROD_FN=mock_verify_prod \
BG_ROLLBACK_FN=mock_rollback \
BG_DESTROY_STAGING_FN=mock_destroy_staging \
BG_ALERT_P0_FN=mock_alert_p0 \
  blue_green_deploy "$NEW_SHA"
RC1=$?
assert "$RC1" "0" "路径1 返回 0（部署成功）"
assert "$(cat "$PROD_STATE_FILE")" "NEW" "路径1 生产已切到 NEW"
assert "$(cat "$PROD_SHA_FILE")" "$NEW_SHA" "路径1 生产 sha == 新 sha"

# ─── 路径 2：staging 验证红 → 生产纹丝不动 → 销毁 staging → P0 ───
echo ""
echo "▶ 路径 2（staging 红）：验证失败 → 生产绝不被碰 → proven-to-fire"
reset_world
BG_DEPLOY_STAGING_FN=mock_deploy_staging \
BG_VERIFY_STAGING_FN=mock_verify_staging_red \
BG_RECORD_ANCHOR_FN=mock_record_anchor \
BG_PROMOTE_FN=mock_promote_ok \
BG_VERIFY_PROD_FN=mock_verify_prod \
BG_ROLLBACK_FN=mock_rollback \
BG_DESTROY_STAGING_FN=mock_destroy_staging \
BG_ALERT_P0_FN=mock_alert_p0 \
  blue_green_deploy "$NEW_SHA"
RC2=$?
if [ "$RC2" -ne 0 ]; then ok "路径2 返回非 0（发版红）"; else bad "路径2 staging 红却返 0"; fi
assert "$(cat "$PROD_STATE_FILE")" "OLD" "路径2 生产纹丝不动（仍 OLD）— 230 客户无感"
assert "$(cat "$PROD_SHA_FILE")" "$OLD_SHA" "路径2 生产 sha 仍是旧 sha"
assert "$(cat "$STAGING_FILE")" "DESTROYED" "路径2 staging slot 已销毁"
assert "$(cat "$P0_FILE")" "YES" "路径2 已开 P0"

# ─── 路径 3：promote 中失败 → 自动回滚到上一版 sha → 生产健康 → P0 ───
echo ""
echo "▶ 路径 3（promote 红）：promote 中失败 → 自动回滚 → proven-to-fire"
reset_world
BG_DEPLOY_STAGING_FN=mock_deploy_staging \
BG_VERIFY_STAGING_FN=mock_verify_staging_green \
BG_RECORD_ANCHOR_FN=mock_record_anchor \
BG_PROMOTE_FN=mock_promote_fail \
BG_VERIFY_PROD_FN=mock_verify_prod \
BG_ROLLBACK_FN=mock_rollback \
BG_DESTROY_STAGING_FN=mock_destroy_staging \
BG_ALERT_P0_FN=mock_alert_p0 \
  blue_green_deploy "$NEW_SHA"
RC3=$?
if [ "$RC3" -ne 0 ]; then ok "路径3 返回非 0（发版红）"; else bad "路径3 promote 失败却返 0"; fi
assert "$(cat "$PROD_STATE_FILE")" "OLD" "路径3 生产已回滚到健康 OLD 态（不停在半死）"
assert "$(cat "$PROD_SHA_FILE")" "$OLD_SHA" "路径3 生产 sha 回滚到上一版"
assert "$(cat "$P0_FILE")" "YES" "路径3 已开 P0"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  staging-promote-smoke: PASS=$PASS FAIL=$FAIL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
[ "$FAIL" -eq 0 ]
