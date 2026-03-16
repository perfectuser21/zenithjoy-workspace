#!/usr/bin/env bash
# DoD Verification: sync-scraper-to-works.sh
set -e

SCRIPT="scripts/sync-scraper-to-works.sh"
PASS=0; FAIL=0

check() {
    local desc="$1"; local pattern="$2"
    if grep -qE "$pattern" "$SCRIPT"; then
        echo "  PASS: $desc"; PASS=$((PASS+1))
    else
        echo "  FAIL: $desc (pattern: $pattern)"; FAIL=$((FAIL+1))
    fi
}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  DoD Test: sync-scraper-to-works.sh"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

[[ -f "$SCRIPT" ]] && { echo "  PASS: 脚本文件存在"; PASS=$((PASS+1)); } || { echo "  FAIL: 脚本文件不存在"; FAIL=$((FAIL+1)); }

check "连接 social_media_raw"           "social_media_raw"
check "查询 publish_logs"               "publish_logs"
check "UPDATE publish_logs.response"   "UPDATE zenithjoy\.publish_logs"
check "--platform 参数"                "\-\-platform"
check "--date 参数"                    "\-\-date"
check "--dry-run 支持"                 "\-\-dry-run"
check "metrics JSONB 写入"             "metrics"
check "POSTGRES_PASSWORD 环境变量"     "POSTGRES_PASSWORD"
check "views/likes/comments 指标"      "views.*likes|likes.*views"
check "找不到匹配时跳过"               "NOT_FOUND|not_found|未找到|continue"
check "content_master 查询"            "content_master"
check "content_snapshots 查询"         "content_snapshots"

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
if [[ "$FAIL" -gt 0 ]]; then
    echo "  FAILED"; exit 1
else
    echo "  ALL PASSED"
fi
