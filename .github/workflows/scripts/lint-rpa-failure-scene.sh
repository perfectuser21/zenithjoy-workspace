#!/usr/bin/env bash
# lint-rpa-failure-scene.sh —— RPA 失败必须自带现场（invariant 93ed0761 的机械闸）
#
# 为什么要有这道闸：私信 NO_SEARCH_INPUT 被"根治"过四次仍复发，结构性原因不是修得
# 不对，是**失败原因和现场从来不在人会看的地方**——正表只有 "failed" 三个字，诊断被塞进
# 旁边任务表的 JSONB，screenshot_path 字段零接线。排查只能靠猜（0821 白猜三轮）。
#
# 规矩已经写进 invariant 登记表了，但**散文规矩拦不住**——同类规矩
# （feedback_realmachine_fix_validate_yourself）当时就在，照样被绕过去了。所以要机器卡。
#
# 判据（故意保守，只卡"上报结果的漏斗"，不逐个卡 33 个出口）：
#   凡是把 RPA 结果上报中台的函数，其构造的 body 里必须同时出现
#   error_code / foreground_pkg / failure_diag 三者——少一个就 FAIL。
#   这样新增错误码不用改闸，但"新开一条上报通道却忘了带现场"会被当场拦住。
#
# 用法: bash lint-rpa-failure-scene.sh
# 退出码: 0 = 通过，1 = 有上报通道缺现场字段
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$REPO_ROOT"

AGENT_DIR='services/agent-android/app/src/main/kotlin'
FAIL=0

# 找所有"往 /api/agent/... 上报结果"的 Kotlin 函数所在文件
mapfile -t REPORTERS < <(grep -rln 'api/agent/burner/.*-result\|api/agent/.*result' "$AGENT_DIR" 2>/dev/null | sort -u)

if [ "${#REPORTERS[@]}" -eq 0 ]; then
  echo "::error::lint-rpa-failure-scene 环境自检失败：在 $AGENT_DIR 下找不到任何结果上报通道（扫描器坏了，不是代码干净）"
  exit 1
fi

echo "扫描 ${#REPORTERS[@]} 个含结果上报通道的文件"
for f in "${REPORTERS[@]}"; do
  # dm-outreach-result 是目前唯一已接现场的通道；其余通道随各自 sprint 接线，
  # 这里先只对已接的做不回退保护（棘轮式），避免一上来就把无关 PR 全卡死。
  grep -q 'dm-outreach-result' "$f" || continue
  MISSING=()
  for field in error_code foreground_pkg failure_diag; do
    grep -q "\"$field\"" "$f" || MISSING+=("$field")
  done
  if [ "${#MISSING[@]}" -gt 0 ]; then
    echo "::error::$f 的结果上报缺现场字段: ${MISSING[*]} —— 失败原因不落人会看的地方，下次复发只能靠猜（invariant 93ed0761）"
    FAIL=1
  else
    echo "  ✅ $(basename "$f") 上报已带 error_code + foreground_pkg + failure_diag"
  fi
done

# 服务端侧：写正表的那条 UPDATE 也必须带现场，否则 agent 传上来照样被丢
API_ROUTE='apps/api/src/routes/agent-burner.ts'
if [ -f "$API_ROUTE" ]; then
  UPD=$(grep -A4 'UPDATE zenithjoy.dm_outreach_log' "$API_ROUTE" || true)
  for field in error_code foreground_pkg failure_diag; do
    printf '%s' "$UPD" | grep -q "$field" || {
      echo "::error::$API_ROUTE 写 dm_outreach_log 的 UPDATE 缺 $field —— agent 传上来了却在服务端被丢掉（invariant 93ed0761）"
      FAIL=1
    }
  done
  [ "$FAIL" = "0" ] && echo "  ✅ 服务端正表 UPDATE 已带完整现场"
fi

if [ "$FAIL" != "0" ]; then
  echo "❌ lint-rpa-failure-scene: RPA 失败现场未落库"
  exit 1
fi
echo "✅ lint-rpa-failure-scene 通过"
