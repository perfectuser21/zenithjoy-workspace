#!/usr/bin/env bash
# phone-wall-push-smoke.sh — 机房手机可视化守卫：语法闸 + 四脚本挂钩存在 + 既有窗口断言不破 + 假中台跑一轮
# CI ubuntu 无 adb 无 zsh 也自洽（假 adb 是 bash 脚本；zsh 缺失时语法闸按既有惯例 ::warning:: 跳过）。
# 0916 死规矩: 对变量做 grep 一律用 here-string `grep ... <<< "$VAR"`，禁止 `echo "$VAR" | grep`（pipefail 假绿）。
set -euo pipefail
D="services/phone-adb-controller"
fail() { echo "::error::phone-wall-push-smoke: $1"; exit 1; }

# 层0: 三件套 + launchd plist 存在
for f in wall-lib.sh phone-wall-push.sh wall-report.sh; do
  [[ -s "$D/$f" ]] || fail "$f 缺失或为空"
done
[ -s "$D/com.zenithjoy.phonewallpush.plist" ] || fail "plist 缺失"

# 层1: 语法闸——上报侧是 bash，被挂钩的四个生产脚本是 zsh
for f in wall-lib.sh phone-wall-push.sh wall-report.sh; do bash -n "$D/$f" || fail "$f bash 语法错误"; done
if command -v zsh >/dev/null 2>&1; then
  for f in harvest-cron.sh batch2.sh harvest-keyword.sh outreach-tick.sh; do zsh -n "$D/$f" || fail "$f zsh 语法错误"; done
else
  echo "::warning::zsh 不可用,四脚本 zsh 语法闸跳过(部署侧会跑)"
fi

# 层1b: 高清化守卫（0920）：缩图必须按宽度重采样（-Z 是最长边，会把竖屏压成 162×360），默认宽 720
# 对去注释文本断言（注释里写着 --resampleWidth 不算数），并反向禁止 sips -Z 回潮
WL=$(grep -vE '^[[:space:]]*#' "$D/wall-lib.sh")
grep -qF 'sips --resampleWidth "$3"' <<< "$WL" || fail "wall-lib 缩图未用 sips --resampleWidth（-Z 会把竖屏压糊）"
! grep -qE 'sips[[:space:]]+-Z' <<< "$WL"        || fail "wall-lib 缩图仍有 sips -Z（最长边缩放，竖屏出 162×360）"
grep -qF 'WALL_WIDTH:-720' <<< "$WL"             || fail "wall-lib 默认宽度不是 720"
# 层2: 挂钩存在（删掉任一行即红；先去注释再断言——给挂钩行前加 # 也必须红）
# 注: 这四个变量是去注释后的脚本正文, 后面全部用 here-string 查, 行号断言也基于同一份文本
HC=$(grep -vE '^[[:space:]]*#' "$D/harvest-cron.sh")
B2=$(grep -vE '^[[:space:]]*#' "$D/batch2.sh")
HK=$(grep -vE '^[[:space:]]*#' "$D/harvest-keyword.sh")
OT=$(grep -vE '^[[:space:]]*#' "$D/outreach-tick.sh")
grep -qF 'wr start "$SERIAL"' <<< "$HC"                       || fail "harvest-cron 未挂 start"
grep -qF 'wr fail "$SERIAL" 1 device_offline' <<< "$HC"       || fail "harvest-cron 未挂 device_offline"
grep -qF 'wr fail "$SERIAL" 2 keywords_unavailable' <<< "$HC" || fail "harvest-cron 未挂 keywords_unavailable"
grep -qF 'wr done "$SERIAL"' <<< "$HC"                        || fail "harvest-cron 未挂 done"
grep -qF 'wr step "$SERIAL" 3 doing' <<< "$B2"                || fail "batch2 未挂词级 step"
grep -qF 'wr note --profile "$P"' <<< "$HK"                   || fail "harvest-keyword 未挂视频级 note(续租)"
grep -qF 'wr start --profile "$PROFILE"' <<< "$OT"            || fail "outreach-tick 未挂 start"
grep -qF 'wr fail --profile "$PROFILE" 0' <<< "$OT"           || fail "outreach-tick 未挂 fail"
# 2c: 触达的 start 必须在拿到锁之后(锁被采收占着时不能 start,否则顶掉同机采收任务)且整个 tick 只 start 一次
LOCKLN=$(grep -n 'lock-acquire "\$TAG"' <<< "$OT" | head -1 | cut -d: -f1)
STARTLN=$(grep -n 'wr start --profile "\$PROFILE"' <<< "$OT" | head -1 | cut -d: -f1)
[[ -n "$LOCKLN" && -n "$STARTLN" && "$STARTLN" -gt "$LOCKLN" ]] || fail "outreach-tick 的 wr start 必须在 lock-acquire 之后"
grep -qE 'WR_STARTED == 0.*wr start --profile' <<< "$OT" || fail "outreach-tick 的 wr start 未用 WR_STARTED 守一次(重试循环会重复 start)"
# 2a: 四脚本的 wr 定义必须是"上报器缺失/失败一律吞掉"的形态（有 -x 判断 + 收尾 true），绝不能反过来阻塞采收/触达
for f in harvest-cron.sh batch2.sh harvest-keyword.sh outreach-tick.sh; do
  grep -vE '^[[:space:]]*#' "$D/$f" | grep -qE '^wr\(\)\{ \[\[ .*-x "\$WR" \]\] && "\$WR" "\$@" >/dev/null 2>&1; true \}$' || fail "$f 的 wr 定义不是吞错形态(缺 -x 判断或收尾 true)"
done
# 2a': 两条链各自 export WALL_NS（wall-report 按命名空间分状态文件，采收/触达同机同序列号互不顶状态；batch2/harvest-keyword 是子进程自动继承）
grep -qE '^export WALL_NS=harvest([[:space:]]|$)' <<< "$HC"  || fail "harvest-cron 未 export WALL_NS=harvest"
grep -qE '^export WALL_NS=outreach([[:space:]]|$)' <<< "$OT" || fail "outreach-tick 未 export WALL_NS=outreach"
# 2b: outreach 的 wr 定义必须在 source 守卫之后（既有 smoke 层4 以 OUTREACH_TICK_SOURCED=1 source 只取函数）
GUARD=$(grep -n 'OUTREACH_TICK_SOURCED' <<< "$OT" | head -1 | cut -d: -f1)
WRDEF=$(grep -n '^wr()' <<< "$OT" | head -1 | cut -d: -f1)
[[ -n "$GUARD" && -n "$WRDEF" && "$WRDEF" -gt "$GUARD" ]] || fail "outreach-tick 的 wr 定义必须在 source 守卫之后"

# 层3: 既有窗口断言不破（同 phone-adb-controller-smoke 层7c；那边按去注释代码查，这里同口径）
_H_CODE=$(grep -vE '^[[:space:]]*#' "$D/harvest-cron.sh")
grep -A2 '设备离线' <<< "$_H_CODE" | grep -q 'escalate' || fail "harvest-cron 设备离线→escalate 窗口被挤"
grep -A8 'KWERR' <<< "$_H_CODE" | grep -q 'escalate'    || fail "harvest-cron KWERR→escalate 窗口被挤"

# 层4: 假中台 + 假 adb 跑一轮（推帧 + 上报），断言最少请求形状
node "$D/__tests__/wall-smoke-harness.mjs" || fail "假中台一轮失败"
echo "phone-wall-push-smoke: OK"
