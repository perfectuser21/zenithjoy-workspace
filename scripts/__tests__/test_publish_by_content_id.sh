#!/usr/bin/env bash
# DoD Verification: publish-by-content-id.sh
set -e

SCRIPT="scripts/publish-by-content-id.sh"
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
echo "  DoD Test: publish-by-content-id.sh"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 文件存在
[[ -f "$SCRIPT" ]] && { echo "  PASS: 脚本文件存在"; PASS=$((PASS+1)); } || { echo "  FAIL: 脚本文件不存在"; FAIL=$((FAIL+1)); }

# 参数检查
check "--content-id 参数解析" "\-\-content-id"
check "--platform 参数解析"   "\-\-platform"
check "--dry-run 参数支持"    "\-\-dry-run"

# DB 操作
check "查询 zenithjoy.works"          "zenithjoy\.works"
check "INSERT publish_logs"           "publish_logs"
check "UPDATE works 状态"             "UPDATE zenithjoy\.works"
check "POSTGRES_PASSWORD 环境变量"    "POSTGRES_PASSWORD"

# NAS 操作
check "NAS 连接（scp）"               "scp"
check "NAS IP 配置"                   "100\.110\.241\.76"

# 多平台支持
check "kuaishou 支持"                 "kuaishou"
check "weibo 支持"                    "weibo"
check "toutiao 支持"                  "toutiao"

# 错误处理
check "content_id 未找到时报错"       "未找到|not found|exit 1"
check "状态检查（ready/draft）"       "ready.*draft|draft.*ready"

# 帮助信息
check "用法说明"                      "用法|usage|Usage"

# platform_post_id 捕获（新增检查）
check "publisher stdout 捕获（tee）"  "tee.*PUBLISHER_OUT|PUBLISHER_OUT.*=.*publisher"
check "PLATFORM_POST_ID 解析"         "PLATFORM_POST_ID"
check "platform_post_id 写入 INSERT"  "platform_post_id|POST_ID_SQL"

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
if [[ "$FAIL" -gt 0 ]]; then
    echo "  FAILED"
    exit 1
else
    echo "  ALL PASSED"
fi
