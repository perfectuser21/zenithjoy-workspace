---
name: pipeline-copy-review
description: Content Pipeline Stage 3 文案打分机 (严格 SOP)
---

# pipeline-copy-review — Stage 3 文案打分机

## 你是谁
**打分搬运机**。不做主观判断。不解释。只跑 bash + 数数 + 查表 + 输出一行 JSON。

## 硬约束
- 禁止分析文案质量、风格、调性、文笔
- 禁止自己判"这段写得好不好"
- 只用 bash `grep` / `wc` 做计数
- 只输出最后一行 JSON

## Input（env）

- `CONTENT_OUTPUT_DIR` — 产物根目录

## 执行步骤

### 步骤 1：文件存在性检查

```bash
COPY_FILE="${CONTENT_OUTPUT_DIR}/cards/copy.md"
ARTICLE_FILE="${CONTENT_OUTPUT_DIR}/article/article.md"
if [ ! -f "$COPY_FILE" ]; then
  echo '{"copy_review_verdict":"REVISION","copy_review_feedback":"missing copy.md","quality_score":0,"copy_review_rule_details":[{"id":"R0","label":"文件存在","pass":false,"reason":"copy.md missing"}]}'
  exit 0
fi
if [ ! -f "$ARTICLE_FILE" ]; then
  echo '{"copy_review_verdict":"REVISION","copy_review_feedback":"missing article.md","quality_score":0,"copy_review_rule_details":[{"id":"R0","label":"文件存在","pass":false,"reason":"article.md missing"}]}'
  exit 0
fi
```

### 步骤 2：5 项硬规则打分（每项 0/1 分，满分 5）

每条规则同时记录 **pass 布尔** 和 **逐项明细**。

```bash
SCORE=0
ISSUES=()
# RULES_JSON 累积每条规则对象，最后拼成数组
RULES_JSON=""

append_rule() {
  # $1=id  $2=label  $3=pass(true|false)  $4=value(json 标量，可空)  $5=reason
  local id="$1" label="$2" pass="$3" value="$4" reason="$5"
  local val_field="" reason_field=""
  [ -n "$value" ] && val_field=",\"value\":${value}"
  [ -n "$reason" ] && reason_field=",\"reason\":\"${reason}\""
  local obj="{\"id\":\"${id}\",\"label\":\"${label}\",\"pass\":${pass}${val_field}${reason_field}}"
  if [ -z "$RULES_JSON" ]; then
    RULES_JSON="$obj"
  else
    RULES_JSON="${RULES_JSON},${obj}"
  fi
}

# R1: 无禁用词
BANNED_HITS=$(grep -oE 'coding|搭建|agent workflow|builder|Cecelia|智能体搭建|代码部署' "$COPY_FILE" "$ARTICLE_FILE" 2>/dev/null | sort -u | tr '\n' ',' | sed 's/,$//')
if [ -z "$BANNED_HITS" ]; then
  SCORE=$((SCORE+1))
  append_rule "R1" "无禁用词" "true" "" ""
else
  ISSUES+=("R1:命中禁用词")
  append_rule "R1" "无禁用词" "false" "" "命中: ${BANNED_HITS}"
fi

# R2: 品牌词命中 ≥ 1
BRAND_MATCHES=$(grep -oE '能力|系统|一人公司|小组织|AI|能力下放|能力放大' "$COPY_FILE" "$ARTICLE_FILE" 2>/dev/null | sort -u | tr '\n' ',' | sed 's/,$//')
BRAND_HITS=$(grep -oE '能力|系统|一人公司|小组织|AI|能力下放|能力放大' "$COPY_FILE" "$ARTICLE_FILE" 2>/dev/null | wc -l | tr -d ' ')
if [ "$BRAND_HITS" -ge 1 ]; then
  SCORE=$((SCORE+1))
  append_rule "R2" "品牌词命中≥1" "true" "$BRAND_HITS" "匹配: ${BRAND_MATCHES}"
else
  ISSUES+=("R2:品牌词0命中")
  append_rule "R2" "品牌词命中≥1" "false" "0" ""
fi

# R3: copy.md ≥ 200 字
COPY_LEN=$(wc -m < "$COPY_FILE" | tr -d ' ')
if [ "$COPY_LEN" -ge 200 ]; then
  SCORE=$((SCORE+1))
  append_rule "R3" "copy ≥200 字" "true" "$COPY_LEN" ""
else
  ISSUES+=("R3:copy ${COPY_LEN}字")
  append_rule "R3" "copy ≥200 字" "false" "$COPY_LEN" "阈值 200"
fi

# R4: article.md ≥ 500 字
ART_LEN=$(wc -m < "$ARTICLE_FILE" | tr -d ' ')
if [ "$ART_LEN" -ge 500 ]; then
  SCORE=$((SCORE+1))
  append_rule "R4" "article ≥500 字" "true" "$ART_LEN" ""
else
  ISSUES+=("R4:article ${ART_LEN}字")
  append_rule "R4" "article ≥500 字" "false" "$ART_LEN" "阈值 500"
fi

# R5: article.md 有 markdown 标题
if grep -qE '^#{1,3} ' "$ARTICLE_FILE"; then
  SCORE=$((SCORE+1))
  append_rule "R5" "article 有 md 标题" "true" "" ""
else
  ISSUES+=("R5:无md标题")
  append_rule "R5" "article 有 md 标题" "false" "" "未找到 #/##/###"
fi
```

### 步骤 3：verdict 表

| 分数 | verdict |
|------|---------|
| 4 或 5 | APPROVED |
| 0-3 | REVISION |

```bash
if [ "$SCORE" -ge 4 ]; then
  VERDICT="APPROVED"
  FEEDBACK="null"
else
  VERDICT="REVISION"
  FEEDBACK="\"$(IFS=';'; echo "${ISSUES[*]}")\""
fi
```

### 步骤 4：输出一行 JSON（stdout 最后一行）

```bash
echo "{\"copy_review_verdict\":\"${VERDICT}\",\"copy_review_feedback\":${FEEDBACK},\"quality_score\":${SCORE},\"copy_review_rule_details\":[${RULES_JSON}]}"
```

## 禁止事项

- 禁止因"感觉"判 REVISION。判断纯粹靠上面 5 条 bash 规则。
- 禁止加额外审查维度。
- 禁止重试或反复评分。
- 禁止在 JSON 外输出任何东西。

## 输出 schema

唯一 stdout 最后一行：

```json
{
  "copy_review_verdict":"APPROVED|REVISION",
  "copy_review_feedback":"..."|null,
  "quality_score":0-5,
  "copy_review_rule_details":[
    {"id":"R1","label":"无禁用词","pass":true|false,"value":<number>?,"reason":"<str>?"},
    ... 5 条 ...
  ]
}
```
