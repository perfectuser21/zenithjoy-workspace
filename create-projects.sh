#!/bin/bash

# 脚本：zenithjoy OKR 分解自救 - 创建 9 个 Project
# 执行时间：2026-03-17 09:40
# 目标：完成 KR1/2/3 的二层分解

set -e

BRAIN_URL="http://localhost:5221/api/brain"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# KR IDs
KR1_ID="d947e4c7-815e-454c-a8fb-0aa79d8024fb"
KR2_ID="3e3f713f-8ecb-429d-abc1-8018d308c7b5"
KR3_ID="fedab43c-a8b8-428c-bcc1-6aad6e6210fc"

echo "【zenithjoy OKR 分解自救】开始创建 9 个 Project"
echo "时间：$TIMESTAMP"
echo ""

create_project() {
  local title="$1"
  local description="$2"
  local parent_id="$3"
  local priority="$4"

  echo "📌 $title (Priority: $priority)"

  local response=$(curl -s -X POST "$BRAIN_URL/goals" \
    -H "Content-Type: application/json" \
    -d "{
      \"title\": \"$title\",
      \"description\": \"$description\",
      \"parent_id\": \"$parent_id\",
      \"priority\": \"$priority\",
      \"type\": \"project\",
      \"status\": \"pending_decomposition\",
      \"target_date\": \"2026-03-30T16:00:00.000Z\"
    }" 2>/dev/null)

  local project_id=$(echo "$response" | jq -r '.id // empty' 2>/dev/null)

  if [[ -n "$project_id" && "$project_id" != "null" ]]; then
    echo "   ✅ 成功"
  else
    echo "   ❌ 失败"
  fi
}

echo "▶ KR1 Projects（发布自动化 P0）"
create_project "抖音/快手/小红书 发布接口集成" "集成三个平台的内容发布接口，实现自动化发布功能" "$KR1_ID" "P0"
create_project "微信/微博/知乎/头条 发布接口集成" "集成四个平台的发布接口，完成 8 平台全覆盖" "$KR1_ID" "P0"
create_project "发布队列和调度引擎" "构建内容发布队列系统和任务调度引擎" "$KR1_ID" "P0"

echo ""
echo "▶ KR2 Projects（数据采集 P1）"
create_project "抖音/快手/小红书 数据采集脚本" "开发数据采集脚本，实时获取核心指标" "$KR2_ID" "P1"
create_project "微信/微博/知乎/头条 数据采集脚本" "开发微博等平台的数据采集脚本" "$KR2_ID" "P1"
create_project "数据入库和定时调度" "构建数据入库管道和定时调度" "$KR2_ID" "P1"

echo ""
echo "▶ KR3 Projects（内容生成 P1）"
create_project "AI 选题系统" "开发 AI 驱动的自动选题系统" "$KR3_ID" "P1"
create_project "AI 文案生成" "开发 AI 文案生成引擎" "$KR3_ID" "P1"
create_project "素材组装和格式转换" "构建素材管理和格式转换系统" "$KR3_ID" "P1"

echo ""
echo "✅ Project 创建脚本执行完成"
