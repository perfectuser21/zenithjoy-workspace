#!/bin/bash

# 跨平台对比脚本 - 比较同一作品在不同平台的表现

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

DB_CONTAINER="cecelia-postgres"
DB_USER="cecelia"
DB_NAME="timescaledb"

# 默认参数
FUZZY=0.6
METRIC="views"

# 解析参数
parse_args() {
    TITLE=$1
    shift

    while [[ $# -gt 0 ]]; do
        case $1 in
            --fuzzy)
                FUZZY=$2
                shift 2
                ;;
            --metric)
                METRIC=$2
                shift 2
                ;;
            *)
                shift
                ;;
        esac
    done
}

# 跨平台对比
compare_work() {
    local title=$1

    echo -e "${BLUE}🔍 跨平台对比: \"$title\"${NC}"
    echo ""

    # 查询匹配的作品
    docker exec $DB_CONTAINER psql -U $DB_USER -d $DB_NAME -c "
        SELECT
            platform,
            title,
            $METRIC,
            TO_CHAR(scraped_at, 'YYYY-MM-DD') as date
        FROM v_all_platforms
        WHERE SIMILARITY(title, '$title') > $FUZZY
        ORDER BY platform, scraped_at DESC;
    "

    echo ""
    echo -e "${YELLOW}汇总统计:${NC}"

    # 汇总统计
    docker exec $DB_CONTAINER psql -U $DB_USER -d $DB_NAME -c "
        SELECT
            COUNT(DISTINCT platform) as platforms,
            SUM($METRIC) as total_$METRIC,
            AVG($METRIC)::int as avg_$METRIC
        FROM v_all_platforms
        WHERE SIMILARITY(title, '$title') > $FUZZY;
    "
}

# 主逻辑
main() {
    if [ $# -eq 0 ]; then
        echo "Usage: $0 <title> [--fuzzy 0.6] [--metric views]"
        exit 1
    fi

    parse_args "$@"
    compare_work "$TITLE"
}

main "$@"
