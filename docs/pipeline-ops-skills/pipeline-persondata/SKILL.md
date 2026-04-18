---
name: pipeline-persondata
description: /pipeline-persondata、修待补充、人物数据占位符 — Content Pipeline Stage 4 (person-data 构造) 运维 skill，修 "待补充/暂无数据" 导致的图片占位符问题
---

# /pipeline-persondata — person-data 修复 skill

**这是最常用的介入点**——image_review 会因为 `person-data.json` 里含 "待补充/暂无数据/待产出" 直接 FAIL。本 skill 完整演示主理人已验证过的全流程。

## 什么时候用
- image_review 报 `person-data 含占位符，LLM 生成不完整`
- 看图肉眼发现"待补充"、"暂无数据"、"待产出" 字样
- key_stats.val 是 "-"、timeline.year 是 "-"
- name 是整段 keyword（如 "为什么 2026 年龙..."）导致头像圈只显前 2 字

## 前置检查

```bash
KEYWORD="<关键词>"
# 1. 把 keyword slug 化（中文关键词带空格，直接 glob 会失败）
SLUG=$(python3 -c "import re; print(re.sub(r'-+','-',re.sub(r'[^a-zA-Z0-9\u4e00-\u9fff-]','-','${KEYWORD}'))[:40])")
# 2. 定位 output_dir（用 slug）
OUT_DIR=$(ls -d ~/content-output/*"${SLUG}"* 2>/dev/null | grep -v research | head -1)
echo "SLUG=${SLUG}"
echo "OUT_DIR=${OUT_DIR}"

# 2. 看现有 person-data 是否含占位符
grep -cE "待补充|暂无数据|待产出" "${OUT_DIR}/person-data.json" 2>/dev/null

# 3. 看 findings 数量（决定限制数）
find ~/content-output/research -name findings.json | xargs -I {} \
  python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(sys.argv[1], "count=", len(d.get("findings",[])))' {}
```

## 介入步骤（copy-paste 可跑 — 主理人验证过的 SOP）

### 步骤 1: 清掉旧产物

```bash
# 不清会导致 V6 脚本沿用旧 person-data + 老 PNG 混在 cards/
rm -f "${OUT_DIR}/person-data.json"
rm -f "${OUT_DIR}/cards/"*.png
rm -f ~/claude-output/images/*.png   # V6 输出默认位置
```

### 步骤 2: 限制 findings ≤ 5 条 + 调 build_person_data

```bash
cd /Users/administrator/perfect21/zenithjoy/services/creator
KEYWORD="${KEYWORD}"
OUT_DIR="${OUT_DIR}"

# 限制 findings 数避免 prompt 过长；主理人实测 5 条效果最稳
PYTHONPATH=. python3 - <<PYEOF
import json, glob, re
from pathlib import Path
from pipeline_worker.person_data_builder import build_person_data

KEYWORD = "${KEYWORD}"
OUT_DIR = Path("${OUT_DIR}")

slug = re.sub(r"-+", "-", re.sub(r"[^a-zA-Z0-9\u4e00-\u9fff-]", "-", KEYWORD))[:40]
findings = []
for fp in glob.glob(f"/Users/administrator/content-output/research/*-{slug}-*/findings.json"):
    data = json.load(open(fp))
    findings = data.get("findings", [])[:5]   # 硬限 5 条
    break
assert findings, "findings 为空，先跑 /pipeline-research"

person = build_person_data(KEYWORD, findings)
print("name=", person["name"], "handle=", person["handle"])
print("timeline=", len(person["timeline"]), "schedule=", len(person["day_schedule"]), "qa=", len(person["qa"]))

(OUT_DIR / "cards").mkdir(parents=True, exist_ok=True)
(OUT_DIR / "person-data.json").write_text(
    json.dumps(person, ensure_ascii=False, indent=2), encoding="utf-8")
print("→", OUT_DIR / "person-data.json")
PYEOF
```

说明：`build_person_data` 会调 `tier=thalamus` LLM 按 V6 字段预算生成合规 JSON，失败时用 findings 真实字段硬填 fallback（**不再出现 "待补充"**）。

### 步骤 3: 运行 V6 生图脚本

```bash
KEYWORD_SLUG=$(python3 -c "
import re
print(re.sub(r'-+', '-', re.sub(r'[^a-zA-Z0-9\u4e00-\u9fff-]', '-', '${KEYWORD}'))[:40])
")

node /Users/administrator/claude-output/scripts/gen-v6-person.mjs \
  --data "${OUT_DIR}/person-data.json" \
  --slug "${KEYWORD_SLUG}"
# 产出 9 张 PNG 到 ~/claude-output/images/
```

说明：V6 产出固定位置 `~/claude-output/images/`，**不**直接写 cards/。

### 步骤 4: cp 到 pipeline cards/

```bash
mkdir -p "${OUT_DIR}/cards"
cp ~/claude-output/images/${KEYWORD_SLUG}-*.png "${OUT_DIR}/cards/"
ls "${OUT_DIR}/cards/"*.png | wc -l    # 期望 9
```

### 步骤 5: tar+ssh 同步到 NAS（绕中文用户名 bug）

```bash
PIPELINE_ID="<pipeline_id，从 /api/pipelines 查>"
NAS_BASE="/volume1/workspace/vault/zenithjoy-creator/content"
NAS_PATH="${NAS_BASE}/${PIPELINE_ID}"

ssh nas "mkdir -p '${NAS_PATH}'"
tar -cf - -C "${OUT_DIR}" . | ssh nas "cd '${NAS_PATH}' && tar -xf -"
```

### 步骤 6: 验收

```bash
# 占位符数 = 0
grep -cE "待补充|暂无数据|待产出" "${OUT_DIR}/person-data.json"
# 期望：0

# 9 张 PNG
ls "${OUT_DIR}/cards/"*.png | wc -l
# 期望：9

# NAS 同步成功
ssh nas "ls '${NAS_PATH}/cards/' | wc -l"
# 期望：≥ 9 + person-data.json + copy.md + llm-card-content.json
```

## 常见坑

| 症状 | 原因 | 修法 |
|------|------|------|
| `待补充` 漫天飞 | 旧版 prompt 只让 LLM 生成 7 字段，timeline/schedule/qa 走模板兜底 | 新版 `person_data_builder.py` 已扩 prompt 生成所有字段；重跑 build_person_data |
| name 是整段 keyword | LLM 抽取不成功，走 `_fallback_name` 启发式 | 换简短 keyword 或手工改 `name` 字段 |
| `head` 里只显前 2 字 | name > 8 字被模板 substring 裁切 | 按预算改短 name（`BUDGET["name"]=8`） |
| V6 脚本报 "数据文件不存在" | person-data.json 没写到位 | 确认步骤 2 的 `OUT_DIR/cards/person-data.json` 存在 |
| PNG 生了但 cards/ 空 | V6 输出到 `~/claude-output/images/`，没 cp | 步骤 4 必须手动 cp |
| avatar 是 initials 头像 | `avatar_b64_file: null` → 模板用首字母画圈 | 这是预期行为，不是 bug |
| image_review 仍报占位符 | step 1 没清 cards/ 老图 | 重跑，确保步骤 1 `rm` 完整 |
| LLM 返回字符超预算 | LLM 超预算 | `_enforce_budget` 会硬截断，无需担心 |
| tar over ssh 报 `Permission denied` | NAS 账号是中文用户名，rsync mangle | 本命令用 tar+ssh alias 绕开，rsync 不行 |

## 相关文件路径
- Executor: `/Users/administrator/perfect21/zenithjoy/services/creator/pipeline_worker/executors/generate.py`
- Builder: `/Users/administrator/perfect21/zenithjoy/services/creator/pipeline_worker/person_data_builder.py`
- V6 脚本: `/Users/administrator/claude-output/scripts/gen-v6-person.mjs`
- V6 字段预算: 见 `person_data_builder.py` 顶部 `BUDGET` dict
- NAS uploader: `/Users/administrator/perfect21/zenithjoy/services/creator/pipeline_worker/nas_uploader.py`
