#!/usr/bin/env bash
# brain-device-job-mirror-smoke.sh —— 守 worker_task → Brain device_job 桥接的四条命门。
#
# 这四条每一条失守，表现都是「页面还是 0 任务」或「页面骗人」，且都不会报错：
#   ① title 不带区分位 → dedup 唯一索引 23505 → best-effort 咽掉
#   ② payload.source 写成 oneoff → 领单器把已在跑的活再领一遍，两进程抢同一台手机
#   ③ read_only 丢了 → 运营点取消，手机照跑
#   ④ evidence 整体覆盖 → brain_task_id 被抹掉，收尾和 sweep 都找不到它
set -uo pipefail
D="apps/api/src/services"
fail() { echo "::error::brain-device-job-mirror-smoke: $1"; exit 1; }

M="$D/brain-device-job-mirror.ts"
[[ -s "$M" ]] || fail "brain-device-job-mirror.ts 缺失"

_CODE=$(grep -vE '^[[:space:]]*(//|\*|/\*)' "$M")

# 注意：接口的类型声明（`read_only: true;` 分号收尾）和 buildMirrorPayload 里真正
# 造出去的对象字面量（`read_only: true,` 逗号收尾）文本几乎一样——只 grep 裸词/裸值
# 会被类型声明那行“垫底”，把实现改坏（比如 true 改成 false）guard 也照样绿（0924 实测踩过）。
# 所以一律钉死逗号收尾，只认对象字面量那一行。
grep -qE "read_only:[[:space:]]*true," <<< "$_CODE" \
  || fail "payload 没有 read_only:true —— 页面会给这些真机自发的活配上改时间/取消按钮，点了对手机零作用"
grep -qE "source:[[:space:]]*'cron'," <<< "$_CODE" \
  || fail "payload.source 不是 cron —— 领单器 /claim 只认 oneoff，写错会把已在跑的活再领一遍"
grep -qE "headed_manual:[[:space:]]*true," <<< "$_CODE" \
  || fail "payload 没有 headed_manual:true —— Brain tick 会把这条活派给 LLM 执行体真去跑一轮采收"
grep -q "slice(-4)" <<< "$_CODE" \
  || fail "title 没带序列号区分位 —— 两台机同跑一个词会撞 dedup 唯一索引,第二条被静默吞掉"

W="$D/worker-tasks-service.ts"
_WCODE=$(grep -vE '^[[:space:]]*(//|\*|/\*)' "$W")
grep -qE "evidence\s*=\s*COALESCE\(evidence" <<< "$_WCODE" \
  || fail "completeTask 仍在整体覆盖 evidence —— 会把 startTask 存的 brain_task_id 抹掉,收尾和 sweep 都将找不到它"
grep -q "RETURNING id, evidence" <<< "$_WCODE" \
  || fail "sweepExpiredLeases 没取 evidence —— 拿不到 brain_task_id,Brain 侧会永远挂 in_progress 并占住 dedup 槽位"

C="services/phone-adb-controller/device-job-claimer.sh"
grep -vE '^[[:space:]]*#' "$C" | grep -q 'wr start .*JOB_ID' \
  || fail "device-job-claimer 没把 JOB_ID 传给 wr start —— 每条真派单都会再镜像一条,页面重复计数"

echo "✅ brain-device-job-mirror-smoke 全部通过"
