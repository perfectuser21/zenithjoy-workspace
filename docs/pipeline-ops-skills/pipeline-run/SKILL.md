---
name: pipeline-run
description: /pipeline-run、用 X 做一套内容、给我生成 X 的内容 — Content Pipeline 手动即时触发（主理人在 Claude Code 对话里临时跑一条，走和 Dashboard 自动路径完全一样的 6 阶段 pipeline，但即时给进度反馈）
---

# /pipeline-run — 手动即时触发 Content Pipeline

主理人想**立即**用一个关键词生成一套内容（不想走 Dashboard + 等 09:00 自动跑），在对话里说一句就跑完。

## 触发词
- `/pipeline-run <关键词>`
- "用 龙虾效应 做一套内容"
- "给我生成 AI 一人公司 的内容"
- "立即跑一条 <关键词>"

## 核心约束

- **不审阅**：一路跑完 6 阶段，不中途停下
- **LLM 扩 keyword**：用户给的短词（如"龙虾效应"）要先 LLM 扩成更适合 NotebookLM 的长查询
- **notebook_id 固定**：用默认 `1d928181-4462-47d4-b4c0-89d3696344ab`（solo-company NotebookLM）
- **跟自动路径共享基础设施**：同一张 topics/pipeline_runs 表、同一 pipeline-worker、同一 NAS

## 执行步骤

### 1. 获取 token 和环境

```bash
TOKEN=$(grep ZENITHJOY_INTERNAL_TOKEN ~/.credentials/zenithjoy-internal-token | cut -d= -f2)
DEFAULT_NB="1d928181-4462-47d4-b4c0-89d3696344ab"
BRAIN_URL="http://localhost:5221"
API_URL="http://localhost:5200"
```

### 2. LLM 扩展 keyword（选用 thalamus tier）

把用户给的短词（`<RAW_KEYWORD>`）展开成 20-35 字的 NotebookLM 友好查询。

```bash
RAW_KEYWORD="<RAW_KEYWORD>"   # 比如 "龙虾效应"

EXPANDED=$(curl -s -X POST "$BRAIN_URL/api/brain/llm-service/generate" \
  -H 'Content-Type: application/json' \
  -d "$(python3 -c "
import json
prompt = '''你是内容运营策划。主理人给了一个短概念词: 「${RAW_KEYWORD}」
把它扩展成一条适合 NotebookLM deep research 的查询，要求：
- 20-35 字
- 包含时代背景（2026 AI 智能体时代）
- 聚焦'一人公司/单人创业/内容创作者'场景
- 中文，一句话，不要引号

只输出扩展后的查询本体，不要解释。'''
print(json.dumps({'tier':'thalamus','prompt':prompt,'max_tokens':200}))
")" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print((d.get('data') or {}).get('text','').strip())")

[ -z "$EXPANDED" ] && EXPANDED="$RAW_KEYWORD"   # LLM 失败 fallback 用原词
echo "原词: $RAW_KEYWORD"
echo "扩展: $EXPANDED"
```

**报告给用户**：展示扩展前后的 keyword 对比（让主理人看 LLM 扩成啥了）。

### 3. 创建 topic（insert 到 Postgres）

```bash
TOPIC_RESP=$(curl -s -X POST "$API_URL/api/topics" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "$(python3 -c "
import json, sys
t = {
  'title': '''$EXPANDED''',
  'angle': '手动即时触发 /pipeline-run',
  'priority': 1,
  'status': '已通过',
  'notebook_id': '$DEFAULT_NB',
}
print(json.dumps(t))
")")

TOPIC_ID=$(echo "$TOPIC_RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('data',{}).get('id',''))")
echo "topic_id=$TOPIC_ID"
[ -z "$TOPIC_ID" ] && { echo "❌ topic 创建失败: $TOPIC_RESP"; exit 1; }
```

### 4. 触发 pipeline（走 apps/api 入口，和 topic-worker 一样）

```bash
PIPELINE_RESP=$(curl -s -X POST "$API_URL/api/pipeline/trigger" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{
    \"content_type\": \"post\",
    \"topic\": \"$EXPANDED\",
    \"topic_id\": \"$TOPIC_ID\",
    \"triggered_by\": \"manual-pipeline-run\"
  }")

PIPELINE_ID=$(echo "$PIPELINE_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print((d.get('data') or d).get('id',''))")
echo "pipeline_id=$PIPELINE_ID"
[ -z "$PIPELINE_ID" ] && { echo "❌ pipeline 触发失败: $PIPELINE_RESP"; exit 1; }
```

### 5. 踢 pipeline-worker 立即跑（不等 60s 轮询）

```bash
launchctl kickstart -k gui/$(id -u)/com.zenithjoy.pipeline-worker
```

### 6. 跟踪进度（实时 tail，每 30s 上报一次）

```bash
# 监听日志直到看到 "全部阶段完成" 或 "failed"
for i in $(seq 1 40); do   # 最多等 20 分钟
  STATUS=$(curl -s "$API_URL/api/pipelines/running" \
    -H "Authorization: Bearer $TOKEN" \
    | python3 -c "
import json, sys
items = json.load(sys.stdin).get('items', [])
for it in items:
  if it.get('id') == '$PIPELINE_ID':
    print('running|' + it.get('current_stage','?'))
    sys.exit(0)
# 不在 running，查详细状态
" 2>/dev/null)

  if [ -z "$STATUS" ]; then
    # 不在 running 列表，查终态
    FINAL=$(curl -s "$API_URL/api/pipeline/$PIPELINE_ID" | python3 -c "
import json,sys
d = json.load(sys.stdin)
print(d.get('status',''), '|', (d.get('output_manifest') or {}).get('error',''))
")
    echo "最终: $FINAL"
    break
  fi
  echo "[$(date +%H:%M:%S)] 进度: $STATUS"
  sleep 30
done
```

**同时**在另一个终端 tail `/tmp/pipeline-worker.log` 看每阶段 log。Claude 也可以每次 sleep 后 tail 日志段汇报。

### 7. 跑完后报告产物

```bash
# 读 pipeline 最终状态
OUTPUT=$(curl -s "$API_URL/api/pipeline/$PIPELINE_ID/output")
echo "$OUTPUT" | python3 -m json.tool | head -40
```

给用户的总结格式：
```
✅ Pipeline <id> 完成
keyword: <原词>（扩展为: <扩展词>）

产物：
  本地: <output_dir>
  NAS:  /volume1/.../content/<pipeline_id>/
  9 张 PNG 图
  article.md（公众号长文）
  copy.md（卡片文案）

查看：
  https://autopilot.zenjoymedia.media/content-factory/<pipeline_id>/output
```

## 失败时怎么办

每阶段有对应的运维 skill：
- research 失败 → `/pipeline-research`
- copywriting 失败（LLM 挂）→ `/pipeline-copywrite`
- person-data 含占位符 → `/pipeline-persondata`
- 图生失败 → `/pipeline-regen`
- NAS 上传失败 → `/pipeline-export`
- 总体看不明白 → `/pipeline-diagnose`

## 与 Dashboard 自动路径的差异

| 维度 | Dashboard 自动 | /pipeline-run 手动 |
|---|---|---|
| 触发源 | 每天 09:00 LaunchAgent | 对话里说一句 |
| 输入 | Dashboard 表单填 title | 关键词（LLM 扩展） |
| notebook_id | 可选填 | 固定默认 |
| 即时反馈 | 没（9 点后去看） | 有（每 30s 上报进度） |
| 共享 | **一样的** 6 阶段 executor、表、NAS、运维 skill |

## 相关文件

- pipeline-worker: `/Users/administrator/perfect21/zenithjoy/services/creator/pipeline_worker/worker.py`
- apps/api 接口: `/Users/administrator/perfect21/zenithjoy/apps/api/src/controllers/pipeline.controller.ts`
- 触发接口: `POST http://localhost:5200/api/pipeline/trigger`
- 运维 skill: `~/.claude/skills/pipeline-*/SKILL.md`（7 个）
