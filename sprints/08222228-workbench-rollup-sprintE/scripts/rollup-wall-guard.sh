#!/usr/bin/env bash
# 路③ Sprint E · A41 墙裁定守卫 —— rollup 读服务不进问答检索域（源码级，无需 DB/服务）
#
# 三条硬判据（合同 §A41）：
#   ① rollup 聚合读服务必须落在**钉死路径** apps/api/src/services/workbench-rollup.service.ts
#      （Sprint E 交付物冻结此路径，不得并入 relation/其他服务文件——给守卫一个固定 grep 靶，
#      避免『或等价路径』导致 must-not-import 检查恒空假绿，同 A35 载体钉死教训）。
#   ② 该文件**不被** knowledge 检索特征文件 import/消费（沿 A35② 前向兼容锚同一守卫）。
#      检索特征文件 = apps/api/src/knowledge/ 下的非测试 .ts（retrieval-exclusions.ts 是载体）。
#   ③ rollup 值只经 /api/knowledge/db/* 端点返回：检索特征文件里零 `workbench-rollup` 命中。
#
# 变异 A41-rollup-retrieval-import：在 retrieval-exclusions.ts 里
#   `import ... from '../services/workbench-rollup.service'` → 判据②③ 报红。
#
# macOS BSD grep 兼容：不使用 -P；固定字符串匹配用 -F。
set -uo pipefail

# 允许从任意 cwd 调用：脚本在 sprints/<dir>/scripts/ 下，仓库根是上溯三级
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$REPO_ROOT"

ROLLUP_SERVICE="apps/api/src/services/workbench-rollup.service.ts"
KNOWLEDGE_DIR="apps/api/src/knowledge"
FAIL=0

# ① 钉死路径存在
if [ ! -f "$ROLLUP_SERVICE" ]; then
  echo "A41-FAIL(1): rollup 读服务未落钉死路径 ${ROLLUP_SERVICE} (generator 不得并入他文件)"
  FAIL=1
else
  echo "A41-OK①: rollup 读服务在钉死路径 $ROLLUP_SERVICE"
fi

# ② + ③ 检索特征文件不 import / 不消费 workbench-rollup 服务
if [ -d "$KNOWLEDGE_DIR" ]; then
  # 扫非测试 .ts；命中 workbench-rollup（import 或任何引用）即报红
  HITS=$(grep -rIl --include='*.ts' -e "workbench-rollup" "$KNOWLEDGE_DIR" 2>/dev/null \
    | grep -v '\.test\.ts$' || true)
  if [ -n "$HITS" ]; then
    echo "A41-FAIL②③: knowledge 检索特征文件消费了 rollup 服务（墙被穿透）："
    echo "$HITS" | sed 's/^/    /'
    FAIL=1
  else
    echo "A41-OK②③: 检索特征文件零 workbench-rollup 命中（rollup 不进问答检索域）"
  fi
else
  echo "A41-FAIL: 检索特征目录不存在 $KNOWLEDGE_DIR"
  FAIL=1
fi

if [ "$FAIL" -eq 0 ]; then
  echo "✅ A41 墙裁定守卫通过"
  exit 0
else
  echo "❌ A41 墙裁定守卫报红"
  exit 1
fi
