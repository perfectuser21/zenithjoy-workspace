#!/bin/bash

# 查询脚本 - 从 TimescaleDB 查询平台数据

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

DB_CONTAINER="cecelia-postgres"
DB_USER="cecelia"
DB_NAME="timescaledb"

# 默认参数
DAYS=7
LIMIT=100
FORMAT="table"

# 解析参数
parse_args() {
    PLATFORM=$1
    shift

    while [[ $# -gt 0 ]]; do
        case $1 in
            --days)
                DAYS=$2
                shift 2
                ;;
            --limit)
                LIMIT=$2
                shift 2
                ;;
            --format)
                FORMAT=$2
                shift 2
                ;;
            *)
                shift
                ;;
        esac
    done
}

# 查询数据
query_platform() {
    local platform=$1

    echo -e "${BLUE}📊 查询平台: $platform | 最近 $DAYS 天${NC}"
    echo ""

    if [ "$FORMAT" = "json" ]; then
        docker exec $DB_CONTAINER psql -U $DB_USER -d $DB_NAME -t -c "
            SELECT json_agg(row_to_json(t))
            FROM (
                SELECT
                    platform_post_id,
                    title,
                    views,
                    likes,
                    comments,
                    scraped_at
                FROM v_all_platforms
                WHERE platform = '$platform'
                  AND scraped_at >= NOW() - INTERVAL '$DAYS days'
                ORDER BY scraped_at DESC
                LIMIT $LIMIT
            ) t;
        "
    else
        docker exec $DB_CONTAINER psql -U $DB_USER -d $DB_NAME -c "
            SELECT
                title,
                views,
                likes,
                comments,
                TO_CHAR(scraped_at, 'YYYY-MM-DD HH24:MI') as scraped_at
            FROM v_all_platforms
            WHERE platform = '$platform'
              AND scraped_at >= NOW() - INTERVAL '$DAYS days'
            ORDER BY scraped_at DESC
            LIMIT $LIMIT;
        "
    fi
}

# 查询所有平台
query_all() {
    echo -e "${BLUE}📊 查询所有平台 | 最近 $DAYS 天${NC}"
    echo ""

    docker exec $DB_CONTAINER psql -U $DB_USER -d $DB_NAME -c "
        SELECT
            platform,
            COUNT(*) as records,
            SUM(views) as total_views,
            MAX(scraped_at) as latest
        FROM v_all_platforms
        WHERE scraped_at >= NOW() - INTERVAL '$DAYS days'
        GROUP BY platform
        ORDER BY total_views DESC;
    "
}

# 主逻辑
main() {
    if [ $# -eq 0 ]; then
        echo "Usage: $0 <platform|all> [--days N] [--limit N] [--format table|json]"
        exit 1
    fi

    parse_args "$@"

    if [ "$PLATFORM" = "all" ]; then
        query_all
    else
        query_platform "$PLATFORM"
    fi
}

main "$@"
