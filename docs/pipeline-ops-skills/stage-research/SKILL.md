---
name: pipeline-ops-stage-research
description: /pipeline-research、手动跑调研、findings 重抓 — Content Pipeline Stage 1 (NotebookLM 调研) 运维 skill
---

# /pipeline-research — Stage 1 调研运维 skill

## 什么时候用
- research 阶段日志报 "NotebookLM 返回空内容或解析失败"
- findings.json 不存在或 `findings: []`
- 想换 notebook（topic 关联了新的 notebook_id）
- 日志里看到 "研究完成(无输出)"，想人工重抓

## 前置检查

```bash
# 1. notebooklm CLI 可用
notebooklm --version || echo "CLI 未安装"

# 2. 当前 handle（哪个 notebook）
notebooklm whoami 2>&1 | head -5

# 3. findings 目录现状
ls -lt ~/content-output/research/ 2>/dev/null | head -10
```

## 介入步骤（copy-paste 可跑）

### 步骤 1: 定位 keyword & notebook_id

```bash
# 从 topic 查 notebook_id（需 auth，见 /pipeline-diagnose 里的 TOKEN 获取）
curl -s -H "Authorization: Bearer ${CECELIA_INTERNAL_TOKEN}" \
  "http://localhost:5200/api/topics?limit=20" \
  | python3 -c 'import json,sys; [print(t["title"], "->", t.get("notebook_id")) for t in json.load(sys.stdin).get("data",{}).get("topics",[])]'
```

说明：`notebook_id` 在 zenithjoy 数据库的 topic 表 `notebook_id` 字段。若未配置，pipeline 会 fallback 到 env `CREATOR_DEFAULT_NOTEBOOK_ID`。

### 步骤 2: 切换 notebook + 清旧 sources

```bash
NOTEBOOK_ID="<你的 notebook id>"
notebooklm use "$NOTEBOOK_ID"
notebooklm source clear
```

### 步骤 3: 触发 web 深度调研

```bash
KEYWORD="<关键词，如 一人公司>"
notebooklm source add-research "$KEYWORD" --mode deep --no-wait
```

说明：`--no-wait` 立刻返回，研究在后台跑（NotebookLM 后端）。

### 步骤 4: 等研究完成

```bash
notebooklm research wait --timeout 300 --import-all
```

说明：`--import-all` 会把 web 研究结果导入为 notebook source。若超时，再跑一次即可。日志显示 "研究完成(无输出)" 是正常的（wait 命令成功后 stdout 就是空），**不是故障**。

### 步骤 5: 用 ask 抽取结构化 findings

```bash
PROMPT="从所有源中，找出能证明'个人也能拥有过去只有公司才有的能力'的证据。关于${KEYWORD}，每条带具体数据和来源。至少8条。"
notebooklm ask "$PROMPT" --json > /tmp/findings-raw.json
cat /tmp/findings-raw.json | python3 -m json.tool | head -40
```

### 步骤 6: 转成 pipeline 兼容的 findings.json

如果懒得手动切分，可以直接让 pipeline 的 research executor 的 `_parse_findings` 重跑——一般 ask 一次就能得到 answer 段，用以下脚本转：

```bash
# 用 research.py 里同样的切分逻辑
python3 - <<'PYEOF'
import json, re
from datetime import date
from pathlib import Path

KEYWORD = "<关键词>"
SLUG = re.sub(r"-+", "-", re.sub(r"[^a-zA-Z0-9\u4e00-\u9fff-]", "-", KEYWORD))[:40]
raw = json.load(open("/tmp/findings-raw.json"))
answer = raw.get("answer", "")
parts = [p for p in re.split(r"\n\*\*\d+\.", answer) if p.strip()]

findings = []
for i, p in enumerate(parts):
    title = p.strip().split("\n")[0].replace("*", "").strip()[:100] or f"发现{i+1}"
    findings.append({
        "id": f"f{i+1:03d}",
        "title": title,
        "content": p.strip(),
        "source": "NotebookLM",
        "brand_relevance": 4,
        "used_in": [],
    })

today = date.today().isoformat()
out_dir = Path.home() / "content-output" / "research" / f"solo-company-case-{SLUG}-{today}"
out_dir.mkdir(parents=True, exist_ok=True)
fp = out_dir / "findings.json"
fp.write_text(json.dumps({
    "keyword": KEYWORD, "series": "solo-company-case",
    "total_findings": len(findings), "findings": findings
}, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"OK {len(findings)} findings → {fp}")
PYEOF
```

## 验收标准

```bash
# findings.json 存在且 >= 5 条
find ~/content-output/research -name findings.json -newer /tmp -mmin -30 \
  -exec python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(sys.argv[1], "count=", len(d.get("findings",[])))' {} \;
```

## 常见坑

| 症状 | 原因 | 修法 |
|------|------|------|
| "研究完成(无输出)" | wait 命令正常结束，stdout 空是预期 | 不是故障，继续 ask |
| ask 返回空 answer | notebook 里没 source（import 失败） | 先 `notebooklm source list` 确认有内容 |
| findings 少于 5 条 | NotebookLM 抓不够 | 换 prompt 或换更明确的 keyword |
| pipeline 报 "notebook_id 未配置" | topic 没关联 notebook | 在 zenithjoy API 更新 topic 的 notebook_id 字段 |
| copywriting 阶段找不到 findings | research 目录 slug 不匹配 | 确认 `_slug(keyword)` 和 research 目录名一致 |

## 相关文件路径
- Executor: `/Users/administrator/perfect21/zenithjoy/services/creator/pipeline_worker/executors/research.py`
- findings 目录模式: `~/content-output/research/<content_type>-<slug>-<YYYY-MM-DD>/findings.json`
- notebooklm CLI: `notebooklm` skill（独立存在）
- env 备选: `CREATOR_DEFAULT_NOTEBOOK_ID`
