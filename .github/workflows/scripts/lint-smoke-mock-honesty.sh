#!/usr/bin/env bash
# lint-smoke-mock-honesty.sh
#
# 第1层诚实标注守卫（真机验证车道三层防假绿 · Step 5）：
# 扫描 golden-path-*-smoke.sh（或调用方指定的任意目录内 *.sh）里"自我实现假测试"模式的
# 步骤——POST 到 `*-result` 端点、`-d` payload 里硬编码 `error_code`/`ok` 字面值，随后又用
# 同一字面值断言"读回"，这类步骤没有验证任何真机行为，只是验证了自己刚写进去的常量
# （PRD Step30 历史 bug 的具体反例：curl 发 error_code=OPEN_PANEL_FAILED 假 payload
# 再断言库里存的还是这个值）。
#
# 命中此模式但缺 `# [CI-MOCK: real-device-only | nightly_ref: <script>]` 标记
# （写在该步骤前 5 行内）→ 报红退出非 0；带标记 → 放行（已诚实标注 + 有 nightly 真机覆盖承诺，
# 覆盖是否真的接线由 realmachine-unverified-ratchet.mjs 另行棘轮检查）。
#
# 该机械规则会误伤"确实验证了服务端正确处理某 error_code 参数(如触发额外副作用字段)"的真实
# 断言（已知风险，登记见 sprint 合同判定点表）——允许 `# gate-allow` 豁免注释（同样写在步骤前
# 5 行内）供人工白名单个别误判，不强制要求这类真实断言也补 [CI-MOCK] 标记。
#
# 用法: bash lint-smoke-mock-honesty.sh <dir>（默认 .github/workflows/scripts/smoke）
set -uo pipefail

DIR="${1:-.github/workflows/scripts/smoke}"

if [ ! -d "$DIR" ]; then
  echo "❌ 目录不存在: $DIR"
  exit 1
fi

VIOLATIONS=0

# 把反斜杠续行合并成一条"逻辑行"再扫描（真实 smoke 脚本里 curl 常见多行续写），
# 输出格式：<该逻辑行起始行号>\t<合并后的内容>
join_continuations() {
  awk '
    {
      line = $0
      if (buf == "") { start = NR } else { }
      cont = (line ~ /\\[[:space:]]*$/)
      sub(/\\[[:space:]]*$/, "", line)
      buf = (buf == "" ? line : buf " " line)
      if (!cont) {
        print start "\t" buf
        buf = ""
      }
    }
    END {
      if (buf != "") print start "\t" buf
    }
  ' "$1"
}

for f in "$DIR"/*.sh; do
  [ -f "$f" ] || continue
  name=$(basename "$f")

  while IFS=$'\t' read -r lineno content; do
    [ -z "${content:-}" ] && continue

    # 候选：POST 到 *-result 端点 且 带 -d payload
    printf '%s' "$content" | grep -qE -- '-X[[:space:]]+POST' || continue
    printf '%s' "$content" | grep -qE -- '-result' || continue
    printf '%s' "$content" | grep -qE -- '-d[[:space:]]' || continue

    # 提取 -d payload 里硬编码的 error_code 字面值（容忍 bash 双引号内的转义 \" ）
    VALUE=$(printf '%s' "$content" \
      | grep -oE 'error_code[\\"]*[[:space:]]*:[[:space:]]*[\\"]*[A-Za-z_]+' \
      | head -1 \
      | grep -oE '[A-Za-z_]+$')
    [ -n "${VALUE:-}" ] || continue

    # 全文该字面值需再次出现（payload 里 1 次 + 断言"读回"里 1 次）才算自我实现假测试模式
    OCCUR=$(grep -c -- "$VALUE" "$f" 2>/dev/null || echo 0)
    [ "${OCCUR:-0}" -ge 2 ] || continue

    # 检查该逻辑行起始行前 5 行内是否已有诚实标注
    START=$((lineno - 5))
    [ "$START" -lt 1 ] && START=1
    WINDOW=$(sed -n "${START},${lineno}p" "$f")
    MARKED=$(printf '%s\n' "$WINDOW" | grep -c -- '\[CI-MOCK: real-device-only' || true)
    ALLOWED=$(printf '%s\n' "$WINDOW" | grep -c -- '# gate-allow' || true)

    if [ "${MARKED:-0}" -eq 0 ] && [ "${ALLOWED:-0}" -eq 0 ]; then
      echo "❌ $name:$lineno 命中自我实现假测试模式(硬编码 error_code=$VALUE 且断言读回同值)，缺 [CI-MOCK: real-device-only | nightly_ref: <script>] 标记"
      VIOLATIONS=$((VIOLATIONS+1))
    fi
  done < <(join_continuations "$f")
done

if [ "$VIOLATIONS" -gt 0 ]; then
  echo ""
  echo "❌ lint-smoke-mock-honesty: 共 $VIOLATIONS 处未标注的自我实现假测试"
  exit 1
fi

echo "✅ lint-smoke-mock-honesty: 全部假payload步骤均已诚实标注或非该模式"
