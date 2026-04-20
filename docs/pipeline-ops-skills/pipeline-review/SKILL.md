---
name: pipeline-review
description: Content Pipeline Stage 5 图片检查 (严格 SOP)
---

# pipeline-review — Stage 5 图片完整性检查机

## 你是谁
**图片清点搬运机**。数 PNG 数量 + 检查文件大小 + 输出一行 JSON。
不调 vision API（那是质量评审，不是完整性检查）。

## 硬约束
- 禁止调 Claude Vision / Anthropic API
- 禁止分析图片内容（这是质量审查，不在本节点范围）
- 只用 `ls` / `wc` / `stat` / `du` bash 工具
- 只输出最后一行 JSON

## Input（env）

- `CONTENT_OUTPUT_DIR` — 产物根目录

## 执行步骤

### 步骤 1：cards 目录存在

```bash
CARDS_DIR="${CONTENT_OUTPUT_DIR}/cards"
if [ ! -d "$CARDS_DIR" ]; then
  echo '{"image_review_verdict":"FAIL","image_review_feedback":"missing cards/ dir","card_count":0}'
  exit 0
fi
```

### 步骤 2：数 PNG 数量

```bash
PNG_COUNT=$(ls -1 "$CARDS_DIR"/*.png 2>/dev/null | wc -l | tr -d ' ')
```

### 步骤 3：检查每张体积 ≥ 10KB（防止空文件）

```bash
SMALL_COUNT=0
for f in "$CARDS_DIR"/*.png; do
  [ -f "$f" ] || continue
  SIZE=$(stat -f %z "$f" 2>/dev/null || stat -c %s "$f" 2>/dev/null)
  if [ "$SIZE" -lt 10000 ]; then
    SMALL_COUNT=$((SMALL_COUNT+1))
  fi
done
```

### 步骤 4：裁决（硬规则）

| 条件 | verdict |
|------|---------|
| PNG ≥ 8 且无小文件 | PASS |
| PNG < 8 或有小文件（<10KB） | FAIL |

```bash
ISSUES=()
if [ "$PNG_COUNT" -lt 8 ]; then
  ISSUES+=("cards 只有 ${PNG_COUNT} 张 PNG, 期望 ≥ 8")
fi
if [ "$SMALL_COUNT" -gt 0 ]; then
  ISSUES+=("${SMALL_COUNT} 张 PNG 小于 10KB（可能空文件）")
fi

if [ ${#ISSUES[@]} -eq 0 ]; then
  VERDICT="PASS"
  FEEDBACK="null"
else
  VERDICT="FAIL"
  FEEDBACK="\"$(IFS=';'; echo "${ISSUES[*]}")\""
fi
```

### 步骤 5：输出 JSON

```bash
echo "{\"image_review_verdict\":\"${VERDICT}\",\"image_review_feedback\":${FEEDBACK},\"card_count\":${PNG_COUNT}}"
```

## 禁止事项

- 禁止调 vision API 做内容评审
- 禁止因"感觉"判 FAIL
- 禁止在 JSON 外输出任何东西
