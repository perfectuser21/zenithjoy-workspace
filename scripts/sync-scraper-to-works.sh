#!/usr/bin/env bash
# ============================================================
# sync-scraper-to-works.sh — scraper 指标同步到 zenithjoy.works
#
# 作用：桥接 social_media_raw（scraper 数据）和 zenithjoy.publish_logs
#       将平台采集的 views/likes/comments 指标写入 publish_logs.response
#
# 用法：
#   bash scripts/sync-scraper-to-works.sh --platform kuaishou
#   bash scripts/sync-scraper-to-works.sh --platform kuaishou --date 2026-03-16
#   bash scripts/sync-scraper-to-works.sh --platform all  # 同步所有平台
#
# 匹配策略：social_media_raw.content_master.title + platform
#          → zenithjoy.works.title（ILIKE 模糊匹配前 50 字符）
#          → zenithjoy.publish_logs.work_id
#
# 依赖：
#   - psql（PostgreSQL 客户端）
#   - POSTGRES_PASSWORD 环境变量（cecelia DB）
#   - SOCIAL_MEDIA_DB_* 环境变量（social_media_raw DB，可选，默认值见下）
# ============================================================

set -euo pipefail

# ─── Cecelia DB（zenithjoy schema）────────────────────────────
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGDATABASE="${PGDATABASE:-cecelia}"
PGUSER="${PGUSER:-postgres}"

# ─── Social Media DB（scraper 数据）──────────────────────────
SM_HOST="${SOCIAL_MEDIA_DB_HOST:-localhost}"
SM_PORT="${SOCIAL_MEDIA_DB_PORT:-5432}"
SM_DB="${SOCIAL_MEDIA_DB_NAME:-social_media_raw}"
SM_USER="${SOCIAL_MEDIA_DB_USER:-n8n_user}"
SM_PASS="${SOCIAL_MEDIA_DB_PASS:-n8n_password_2025}"

# ─── 参数解析 ─────────────────────────────────────────────────
PLATFORM="all"
SYNC_DATE=$(date +%Y-%m-%d)
DRY_RUN=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --platform) PLATFORM="$2"; shift 2 ;;
        --date)     SYNC_DATE="$2"; shift 2 ;;
        --dry-run)  DRY_RUN=true; shift ;;
        *) echo "❌ 未知参数: $1"; exit 1 ;;
    esac
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  sync-scraper-to-works"
echo "  platform:  $PLATFORM"
echo "  date:      $SYNC_DATE"
echo "  dry-run:   $DRY_RUN"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ─── 辅助函数：执行 cecelia DB 查询 ──────────────────────────
cecelia_query() {
    PGPASSWORD="${POSTGRES_PASSWORD:-}" psql \
        -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
        --tuples-only --no-align "$@"
}

# ─── 辅助函数：执行 social_media_raw 查询 ────────────────────
social_query() {
    PGPASSWORD="$SM_PASS" psql \
        -h "$SM_HOST" -p "$SM_PORT" -U "$SM_USER" -d "$SM_DB" \
        --tuples-only --no-align "$@" 2>&1 || true
}

# ─── 平台列表 ─────────────────────────────────────────────────
if [[ "$PLATFORM" == "all" ]]; then
    PLATFORMS=("kuaishou" "weibo" "toutiao" "douyin")
else
    PLATFORMS=("$PLATFORM")
fi

# ─── 主同步循环 ───────────────────────────────────────────────
TOTAL_SYNCED=0
TOTAL_NOT_FOUND=0

for PLT in "${PLATFORMS[@]}"; do
    echo ""
    echo "🔄 同步平台: $PLT (date: $SYNC_DATE)"
    echo "───────────────────────────────────────────────"

    # Step 1: 从 social_media_raw 获取当日指标
    METRICS_DATA=$(social_query -c "
        SELECT
            cm.title,
            cm.platform,
            cs.views,
            cs.likes,
            cs.comments,
            cs.shares,
            cs.favorites,
            cs.snapshot_at
        FROM content_master cm
        JOIN content_snapshots cs ON cs.content_master_id = cm.id
        WHERE cm.platform = '$PLT'
          AND cs.snapshot_date = '$SYNC_DATE'
        ORDER BY cs.snapshot_at DESC
        LIMIT 100
    " 2>/dev/null || echo "")

    if [[ -z "$METRICS_DATA" ]]; then
        echo "  ℹ️  $PLT 平台在 $SYNC_DATE 无采集数据（DB 可能不可达或无数据）"
        continue
    fi

    # Step 2: 逐条匹配并更新
    SYNCED=0
    NOT_FOUND=0

    while IFS='|' read -r TITLE PLT_DB VIEWS LIKES COMMENTS SHARES FAVORITES SNAP_AT; do
        [[ -z "$TITLE" ]] && continue
        TITLE=$(echo "$TITLE" | xargs)

        # 取 title 前 50 字符用于匹配
        TITLE_PREFIX="${TITLE:0:50}"

        # Step 2a: 在 cecelia 中查找匹配的 publish_logs
        LOG_ID=$(cecelia_query -c "
            SELECT pl.id
            FROM zenithjoy.publish_logs pl
            JOIN zenithjoy.works w ON pl.work_id = w.id
            WHERE pl.platform = '$PLT'
              AND LEFT(w.title, 50) ILIKE $(echo "$TITLE_PREFIX" | python3 -c "import json,sys; print(json.dumps(sys.stdin.read().strip()))" 2>/dev/null || echo "'%'")
            ORDER BY pl.created_at DESC
            LIMIT 1
        " 2>/dev/null || echo "")

        LOG_ID=$(echo "$LOG_ID" | xargs)

        if [[ -z "$LOG_ID" ]]; then
            NOT_FOUND=$((NOT_FOUND + 1))
            continue
        fi

        # Step 2b: 更新 publish_logs.response 写入 metrics
        METRICS_JSON="{\"views\": ${VIEWS:-0}, \"likes\": ${LIKES:-0}, \"comments\": ${COMMENTS:-0}, \"shares\": ${SHARES:-0}, \"favorites\": ${FAVORITES:-0}, \"synced_at\": \"$SYNC_DATE\"}"

        if [[ "$DRY_RUN" == "true" ]]; then
            echo "  [DRY RUN] 匹配: '$TITLE_PREFIX' → log_id=$LOG_ID metrics=$METRICS_JSON"
            SYNCED=$((SYNCED + 1))
            continue
        fi

        cecelia_query -c "
            UPDATE zenithjoy.publish_logs
            SET response = jsonb_set(
                COALESCE(response, '{}'),
                '{metrics}',
                '$METRICS_JSON'::jsonb
            )
            WHERE id = '$LOG_ID'
        " 2>/dev/null && SYNCED=$((SYNCED + 1)) || true

    done <<< "$METRICS_DATA"

    echo "  ✅ 匹配并更新: $SYNCED 条"
    echo "  ℹ️  未找到匹配: $NOT_FOUND 条"
    TOTAL_SYNCED=$((TOTAL_SYNCED + SYNCED))
    TOTAL_NOT_FOUND=$((TOTAL_NOT_FOUND + NOT_FOUND))
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ 同步完成"
echo "   总计更新: $TOTAL_SYNCED 条"
echo "   未匹配:   $TOTAL_NOT_FOUND 条"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
