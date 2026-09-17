#!/usr/bin/env bash
# wechat-moments-controller-smoke.sh — 微信朋友圈 ADB 控制器守卫（0917 首版）
# 仿 phone-adb-controller-smoke.sh 三层结构：文件存在+语法闸+关键函数签名存在性。
set -euo pipefail
D="services/wechat-moments-controller"
C="$D/wechat-moments-adb"
fail() { echo "::error::wechat-moments-controller-smoke: $1"; exit 1; }

# 层0: 三件套存在
for f in wechat-moments-adb moments-tick.sh; do
  [[ -s "$D/$f" ]] || fail "$f 缺失或为空"
done

# 层1: 语法闸
if command -v zsh >/dev/null 2>&1; then
  zsh -n "$C" || fail "控制器 zsh 语法错误"
  zsh -n "$D/moments-tick.sh" || fail "moments-tick zsh 语法错误"
else
  echo "::warning::zsh 不可用,语法闸跳过(部署侧会跑)"
fi

# 层2: 关键能力签名存在性（0917 判定点/坑清单落地检查）
for pat in \
  'resolve_coord' \
  'foreground_gate' \
  'FG_DISMISS_LABELS' \
  'lock-acquire)' \
  'lock-release)' \
  'verify_content_match' \
  'locate_element' \
  'locate_cached' \
  '单次铁律' \
  'ADB_INPUT_B64' \
  ; do
  grep -qF "$pat" "$C" || fail "关键签名缺失: $pat"
done

# 层3: 反自动化协议断言——dump 重试必须是 3 次（判定点表拍板值，别被静默改成别的数字）
grep -qE 'for i in 1 2 3; do' "$C" || fail "dump 重试次数协议缺失或被改动（应为 3 次）"

# 层4: 单次发布铁律——publish 命令必须有锁文件守卫，防止重复点击发表按钮
if ! sed -n '/^  publish)/,/^  ;;$/p' "$C" | grep -qF 'lockfile'; then
  fail "publish 命令缺失单次锁文件守卫（发布类动作单次铁律）"
fi

# 层5: 烂死模式检测——坐标不许硬编码成常量赋值（防有人图省事写死坐标绕过判定协议）
if grep -qE 'input tap [0-9]+ [0-9]+"' "$C"; then
  fail "检测到硬编码坐标 tap（违反「坐标永远现场判定」铁律，见 PrepPRD 判定点表）"
fi

# 层6: 点赞链路命令面存在性（0917 GP-E step3 互动执行与留痕——真机验证过的完整点赞链）
for pat in \
  'open-contact-moments)' \
  'read-moments-list)' \
  'open-moment-card-by-text)' \
  'like-current-card)' \
  'vision_judge()' \
  ; do
  grep -qF "$pat" "$C" || fail "点赞链路命令/函数缺失: $pat"
done

# 层7: like-current-card 必须先做「悬浮条是否已可见」的显式视觉状态判定，
# 不能靠 resolve_coord 对「赞」的成功/失败来判断走哪条路——0917 真机实测过
# 视觉模型在目标不存在时仍可能"蒙"出一个坐标，导致误判走错分支（真实复现过一次）。
if ! sed -n '/^  like-current-card)/,/^  ;;$/p' "$C" | grep -qF 'bar_visible'; then
  fail "like-current-card 缺失显式悬浮条可见性判定（bar_visible），可能重蹈 0917 误判覆盖"
fi

echo "wechat-moments-controller-smoke: OK"
