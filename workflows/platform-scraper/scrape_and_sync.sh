#!/bin/bash
# 抓取所有平台数据并同步到 Dashboard API
# Usage: ./scrape_and_sync.sh [platform]

DASHBOARD_API="http://localhost:3333"

# 如果指定了平台，只处理该平台
SINGLE_PLATFORM=$1

PLATFORMS="douyin kuaishou xiaohongshu toutiao-main toutiao-sub weibo shipinhao gongzhonghao zhihu"
if [ -n "$SINGLE_PLATFORM" ]; then
  PLATFORMS=$SINGLE_PLATFORM
fi

echo "=========================================="
echo "  开始抓取并同步到 Dashboard"
echo "  时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo "=========================================="

TOTAL_SUCCESS=0
TOTAL_FAILED=0
TOTAL_ITEMS=0

for platform in $PLATFORMS; do
  echo ""
  echo ">>> 处理 $platform ..."

  # 抓取数据 (stderr 输出日志，stdout 输出 JSON)
  result=$(cd /home/xx && node vps_scraper.js "$platform" 2>/dev/null)

  success=$(echo "$result" | jq -r '.success // false')
  count=$(echo "$result" | jq -r '.count // 0')
  items=$(echo "$result" | jq -c '.items // []')

  if [ "$success" != "true" ]; then
    echo "  ✗ 抓取失败"
    TOTAL_FAILED=$((TOTAL_FAILED + 1))
    continue
  fi

  echo "  ✓ 抓取成功: $count 条数据"

  # 如果有数据，同步到 Dashboard
  if [ "$count" -gt 0 ]; then
    sync_result=$(curl -s -X POST "$DASHBOARD_API/api/platform-data/batch" \
      -H "Content-Type: application/json" \
      -d "{\"items\": $items}")

    sync_success=$(echo "$sync_result" | jq -r '.success // false')
    if [ "$sync_success" == "true" ]; then
      echo "  ✓ 同步成功"
      TOTAL_ITEMS=$((TOTAL_ITEMS + count))
    else
      echo "  ✗ 同步失败: $(echo "$sync_result" | jq -r '.error // "unknown"')"
    fi
  fi

  TOTAL_SUCCESS=$((TOTAL_SUCCESS + 1))
done

echo ""
echo "=========================================="
echo "  完成！"
echo "  成功: $TOTAL_SUCCESS, 失败: $TOTAL_FAILED"
echo "  总数据量: $TOTAL_ITEMS 条"
echo "  时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo "=========================================="
