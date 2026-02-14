#!/bin/bash

# 爆款排行脚本 - 识别高流量作品

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

DB_CONTAINER="cecelia-postgres"
DB_USER="cecelia"
DB_NAME="timescaledb"

# 默认参数
LIMIT=10
METRIC="views"
PLATFORM="all"
DAYS=30

# 解析参数
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --limit)
                LIMIT=$2
                shift 2
                ;;
            --metric)
                METRIC=$2
                shift 2
                ;;
            --platform)
                PLATFORM=$2
                shift 2
                ;;
            --days)
                DAYS=$2
                shift 2
                ;;
            *)
                shift
                ;;
        esac
    done
}

# 查询爆款
query_top() {
    echo -e "${BLUE}🏆 爆款排行榜 (Top $LIMIT by $METRIC)${NC}"
    echo -e "${BLUE}时间范围: 最近 $DAYS 天${NC}"
    echo ""

    local where_clause=""
    if [ "$PLATFORM" != "all" ]; then
        where_clause="AND platform = '$PLATFORM'"
    fi

    docker exec $DB_CONTAINER psql -U $DB_USER -d $DB_NAME -c "
        SELECT
            ROW_NUMBER() OVER (ORDER BY $METRIC DESC) as rank,
            title,
            platform,
            $METRIC,
            TO_CHAR(scraped_at, 'YYYY-MM-DD') as date
        FROM v_all_platforms
        WHERE scraped_at >= NOW() - INTERVAL '$DAYS days'
          $where_clause
        ORDER BY $METRIC DESC
        LIMIT $LIMIT;
    "
}

# 主逻辑
main() {
    parse_args "$@"
    query_top
}

main "$@"
