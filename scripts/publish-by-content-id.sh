#!/usr/bin/env bash
# ============================================================
# publish-by-content-id.sh — 通过 content-id 发布内容
#
# 作用：编排脚本，打通 works 表 → NAS 读取 → 平台发布 → publish_logs
#
# 用法：
#   bash scripts/publish-by-content-id.sh \
#     --content-id 2026-03-16-a3f2b1 \
#     --platform kuaishou \
#     [--dry-run]
#
# 支持的平台：kuaishou | weibo | toutiao | wechat（wechat 提示使用 skill）
#
# 依赖：
#   - psql（PostgreSQL 客户端）
#   - POSTGRES_PASSWORD 环境变量
#   - scripts/nas-fetch-content.sh（已存在）
#   - workflows/platform-data/workflows/publisher/scripts/*.cjs
# ============================================================

set -euo pipefail

# ─── DB 连接 ─────────────────────────────────────────────────
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGDATABASE="${PGDATABASE:-cecelia}"
PGUSER="${PGUSER:-postgres}"

# ─── NAS 连接 ─────────────────────────────────────────────────
NAS_USER="徐啸"
NAS_IP="100.110.241.76"

# ─── Publisher 脚本目录 ────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PUBLISHER_DIR="$REPO_ROOT/workflows/platform-data/workflows/publisher/scripts"

# ─── 参数解析 ─────────────────────────────────────────────────
CONTENT_ID=""
PLATFORM=""
DRY_RUN=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --content-id) CONTENT_ID="$2"; shift 2 ;;
        --platform)   PLATFORM="$2";   shift 2 ;;
        --dry-run)    DRY_RUN=true;    shift ;;
        *) echo "❌ 未知参数: $1"; exit 1 ;;
    esac
done

if [[ -z "$CONTENT_ID" ]]; then
    echo "❌ 必须提供 --content-id 参数"
    echo "用法: bash scripts/publish-by-content-id.sh --content-id <id> --platform <kuaishou|weibo|toutiao>"
    exit 1
fi

if [[ -z "$PLATFORM" ]]; then
    echo "❌ 必须提供 --platform 参数（kuaishou|weibo|toutiao）"
    exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  publish-by-content-id"
echo "  content-id: $CONTENT_ID"
echo "  platform:   $PLATFORM"
echo "  dry-run:    $DRY_RUN"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ─── Step 1: 查询 zenithjoy.works ─────────────────────────────
echo ""
echo "📦 Step 1: 从 zenithjoy.works 查询内容..."

WORKS_ROW=$(PGPASSWORD="${POSTGRES_PASSWORD:-}" psql \
    -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
    --tuples-only --no-align \
    -c "SELECT id, title, nas_path, status, content_type
        FROM zenithjoy.works
        WHERE content_id = '$CONTENT_ID'
        LIMIT 1" 2>&1)

if [[ -z "$WORKS_ROW" ]]; then
    echo "❌ works 表中未找到 content_id='$CONTENT_ID'"
    echo "   请确认 longform-creator Step 5.5 已执行，或 content-id 正确"
    exit 1
fi

WORK_ID=$(echo "$WORKS_ROW"      | awk -F'|' '{print $1}' | xargs)
TITLE=$(echo "$WORKS_ROW"        | awk -F'|' '{print $2}' | xargs)
NAS_PATH=$(echo "$WORKS_ROW"     | awk -F'|' '{print $3}' | xargs)
STATUS=$(echo "$WORKS_ROW"       | awk -F'|' '{print $4}' | xargs)
CONTENT_TYPE=$(echo "$WORKS_ROW" | awk -F'|' '{print $5}' | xargs)

echo "  work_id:      $WORK_ID"
echo "  title:        $TITLE"
echo "  nas_path:     $NAS_PATH"
echo "  status:       $STATUS"
echo "  content_type: $CONTENT_TYPE"

# ─── Step 2: 状态检查 ─────────────────────────────────────────
if [[ "$STATUS" != "ready" && "$STATUS" != "draft" ]]; then
    echo "❌ 内容状态为 '$STATUS'，不满足发布条件（需要 ready 或 draft）"
    exit 1
fi
echo "  ✅ 状态检查通过"

# ─── Step 3: 从 NAS 拉取内容 ─────────────────────────────────
echo ""
echo "📥 Step 3: 从 NAS 拉取内容..."

TMP_DIR="/tmp/publish-${CONTENT_ID}"
mkdir -p "$TMP_DIR/images"

# 读取标题
TITLE_FILE="$TMP_DIR/title.txt"
scp -q "${NAS_USER}@${NAS_IP}:${NAS_PATH}/exports/title.txt" "$TITLE_FILE" 2>/dev/null \
    && TITLE=$(cat "$TITLE_FILE" | head -1 | xargs) \
    || echo "  ⚠️  title.txt 读取失败，使用 DB 标题: $TITLE"

echo "  发布标题: $TITLE"

# 下载图片
IMAGE_FILES=()
NAS_IMAGE_LIST=$(ssh -q "${NAS_USER}@${NAS_IP}" \
    "ls '${NAS_PATH}/images/' 2>/dev/null | grep -v cover | grep -E '\\.png$' | head -9" 2>/dev/null || true)

if [[ -n "$NAS_IMAGE_LIST" ]]; then
    while IFS= read -r IMG; do
        [[ -z "$IMG" ]] && continue
        LOCAL_IMG="$TMP_DIR/images/$IMG"
        scp -q "${NAS_USER}@${NAS_IP}:${NAS_PATH}/images/$IMG" "$LOCAL_IMG" 2>/dev/null \
            && IMAGE_FILES+=("$LOCAL_IMG") \
            || echo "  ⚠️  图片下载失败: $IMG"
    done <<< "$NAS_IMAGE_LIST"
fi

echo "  图片数量: ${#IMAGE_FILES[@]}"

# 读取正文（Markdown 转纯文本文案）
BODY_TEXT="$TITLE"
TEXT_FILE="$TMP_DIR/text_v1.md"
scp -q "${NAS_USER}@${NAS_IP}:${NAS_PATH}/text/text_v1.md" "$TEXT_FILE" 2>/dev/null \
    && BODY_TEXT=$(head -200 "$TEXT_FILE" | sed 's/^#\+ *//; s/\*\*//g; s/`//g' | grep -v '^$' | head -5 | tr '\n' ' ' | xargs) \
    || echo "  ⚠️  text_v1.md 不存在，使用标题作为文案"

# ─── Step 4: 生成临时 publish JSON ───────────────────────────
echo ""
echo "📝 Step 4: 生成发布配置..."

PUBLISH_JSON="$TMP_DIR/publish.json"
IMAGES_JSON="[]"

if [[ ${#IMAGE_FILES[@]} -gt 0 ]]; then
    IMAGES_JSON=$(python3 -c "import json,sys; print(json.dumps(sys.argv[1:]))" "${IMAGE_FILES[@]}")
fi

python3 -c "
import json, sys
data = {
    'type': sys.argv[1],
    'id': sys.argv[2],
    'content': sys.argv[3],
    'title': sys.argv[4],
    'images': json.loads(sys.argv[5])
}
print(json.dumps(data, ensure_ascii=False, indent=2))
" "$PLATFORM" "$CONTENT_ID" "$BODY_TEXT" "$TITLE" "$IMAGES_JSON" > "$PUBLISH_JSON"

echo "  ✅ 发布配置已生成: $PUBLISH_JSON"

if [[ "$DRY_RUN" == "true" ]]; then
    echo ""
    echo "🔍 [DRY RUN] 发布配置内容："
    cat "$PUBLISH_JSON"
    echo ""
    echo "  ℹ️  DRY RUN 模式：跳过实际发布和 publish_logs 写入"
    rm -rf "$TMP_DIR"
    exit 0
fi

# ─── Step 5: 调用平台 publisher ───────────────────────────────
echo ""
echo "🚀 Step 5: 发布到平台 '$PLATFORM'..."

PUBLISH_SUCCESS=false
PUBLISH_ERROR=""
PLATFORM_POST_ID=""

case "$PLATFORM" in
    kuaishou)
        if node "$PUBLISHER_DIR/publish-kuaishou.cjs" --content "$PUBLISH_JSON" 2>&1; then
            PUBLISH_SUCCESS=true
        else
            PUBLISH_ERROR="publish-kuaishou.cjs 执行失败"
        fi
        ;;
    weibo)
        if node "$PUBLISHER_DIR/publish-weibo.cjs" --content "$PUBLISH_JSON" 2>&1; then
            PUBLISH_SUCCESS=true
        else
            PUBLISH_ERROR="publish-weibo.cjs 执行失败"
        fi
        ;;
    toutiao)
        if node "$PUBLISHER_DIR/publish-micro.cjs" --content "$PUBLISH_JSON" 2>&1; then
            PUBLISH_SUCCESS=true
        else
            PUBLISH_ERROR="publish-micro.cjs 执行失败"
        fi
        ;;
    wechat)
        echo "  ℹ️  微信公众号请使用 wechat-publisher skill（官方 API 方案）："
        echo "       /wechat-publisher --content-id $CONTENT_ID"
        PUBLISH_ERROR="wechat 平台使用独立 skill 发布，不通过此脚本"
        ;;
    *)
        PUBLISH_ERROR="不支持的平台: $PLATFORM（支持: kuaishou|weibo|toutiao）"
        ;;
esac

if [[ "$PUBLISH_SUCCESS" == "false" ]]; then
    echo "❌ 发布失败: $PUBLISH_ERROR"
    PGPASSWORD="${POSTGRES_PASSWORD:-}" psql \
        -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
        -c "INSERT INTO zenithjoy.publish_logs (work_id, platform, status, error_message, created_at)
            VALUES ('$WORK_ID', '$PLATFORM', 'failed',
                    $(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$PUBLISH_ERROR"),
                    NOW())" 2>/dev/null \
        || echo "  ⚠️  publish_logs 失败记录写入失败，继续"
    rm -rf "$TMP_DIR"
    exit 1
fi

echo "  ✅ 发布成功"

# ─── Step 6: 写入 publish_logs ────────────────────────────────
echo ""
echo "📊 Step 6: 写入 publish_logs..."

POST_ID_SQL="NULL"
[[ -n "$PLATFORM_POST_ID" ]] && POST_ID_SQL="'$PLATFORM_POST_ID'"

PGPASSWORD="${POSTGRES_PASSWORD:-}" psql \
    -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
    -c "INSERT INTO zenithjoy.publish_logs (work_id, platform, status, platform_post_id, published_at, created_at)
        VALUES ('$WORK_ID', '$PLATFORM', 'published', $POST_ID_SQL, NOW(), NOW())" \
    && echo "  ✅ publish_logs 已写入" \
    || echo "  ⚠️  publish_logs 写入失败，继续"

PGPASSWORD="${POSTGRES_PASSWORD:-}" psql \
    -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
    -c "UPDATE zenithjoy.works
        SET status = 'published',
            first_published_at = COALESCE(first_published_at, NOW()),
            updated_at = NOW()
        WHERE content_id = '$CONTENT_ID'" \
    && echo "  ✅ works 状态已更新为 published" \
    || echo "  ⚠️  works 状态更新失败，继续"

rm -rf "$TMP_DIR"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ 发布完成"
echo "   content-id: $CONTENT_ID"
echo "   platform:   $PLATFORM"
echo "   work_id:    $WORK_ID"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
