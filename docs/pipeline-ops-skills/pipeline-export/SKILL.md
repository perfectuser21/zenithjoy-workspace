---
name: pipeline-export
description: Content Pipeline Stage 6 NAS 归档机 (严格 SOP，写 manifest + tar over ssh 到 NAS)
---

# pipeline-export — Stage 6 NAS 归档机

## 你是谁
**归档搬运机**。2 步：
1. 写 manifest.json（inventory of 产物）
2. tar over ssh 传到 NAS
3. 输出一行 JSON

## 硬约束
- 禁止用 rsync（NAS 中文用户名有 bug）
- 必须用 tar over ssh 管道
- 只输出最后一行 JSON

## Input（env）

- `CONTENT_OUTPUT_DIR` — 产物根目录
- `CONTENT_PIPELINE_ID` — pipeline id 作 NAS 目标子目录

## 执行步骤

### 步骤 1：检查产物齐全

```bash
OUT_DIR="${CONTENT_OUTPUT_DIR}"
PID="${CONTENT_PIPELINE_ID}"
CARDS_DIR="$OUT_DIR/cards"

for req in "$CARDS_DIR" "$OUT_DIR/article/article.md" "$OUT_DIR/findings.json"; do
  if [ ! -e "$req" ]; then
    echo "{\"manifest_path\":null,\"nas_url\":null,\"error\":\"missing $req\"}"
    exit 0
  fi
done
```

### 步骤 2：写 manifest.json

```bash
MANIFEST="$OUT_DIR/manifest.json"
KEYWORD=$(python3 -c "import json; print(json.load(open('$OUT_DIR/findings.json')).get('keyword',''))")

python3 <<PYEOF > "$MANIFEST"
import json, os, glob
from datetime import datetime

cards = sorted(os.path.basename(p) for p in glob.glob("${CARDS_DIR}/*.png"))
manifest = {
    "pipeline_id": "${PID}",
    "keyword": "${KEYWORD}",
    "created_at": datetime.now().isoformat(),
    "status": "ready_for_publish",
    "cards": cards,
    "copy": "cards/copy.md",
    "article": "article/article.md",
    "findings": "findings.json",
    "person_data": "person-data.json",
}
print(json.dumps(manifest, ensure_ascii=False, indent=2))
PYEOF
```

### 步骤 3：tar over ssh 传 NAS

```bash
NAS_SSH_ALIAS="${NAS_SSH_ALIAS:-nas}"
NAS_BASE="${NAS_BASE:-/volume1/workspace/vault/zenithjoy-creator/content}"
NAS_DIR="$NAS_BASE/$PID"

# 先在 NAS 建目录
ssh "$NAS_SSH_ALIAS" "mkdir -p '$NAS_DIR'" 2>&1 | tail -3

# tar 打包宿主目录 → pipe 到 NAS 解压
cd "$OUT_DIR" && tar -cf - . 2>/dev/null | ssh "$NAS_SSH_ALIAS" "tar -xf - -C '$NAS_DIR'" 2>&1 | tail -3

if [ $? -ne 0 ]; then
  echo "{\"manifest_path\":\"$MANIFEST\",\"nas_url\":null,\"error\":\"tar/ssh 失败\"}"
  exit 0
fi
```

### 步骤 4：输出 JSON

```bash
echo "{\"manifest_path\":\"$MANIFEST\",\"nas_url\":\"$NAS_DIR\",\"cards_count\":$(ls $CARDS_DIR/*.png 2>/dev/null | wc -l | tr -d ' ')}"
```

## 禁止事项

- 禁止 rsync
- 禁止跳过 manifest 生成
- 禁止 JSON 外输出

## 输出 schema

stdout 最后一行，**必需字段**（缺失 / 类型不符一律视为 skill 失败）：

| 字段 | 类型 | 含义 |
|---|---|---|
| `manifest_path` | `string \| null` | manifest.json 绝对路径；产物缺失时 `null` |
| `nas_url` | `string \| null` | NAS 目标目录绝对路径；上传失败时 `null` |
| `cards_count` | `int` | 上传的 PNG 张数；失败时字段可缺省 |
| `error` | `string` | **仅失败时出现**，如 `"missing <path>"` 或 `"tar/ssh 失败"` |

成功示例：
```json
{"manifest_path":"/home/.../manifest.json","nas_url":"/volume1/workspace/vault/zenithjoy-creator/content/pl-xxx","cards_count":9}
```

失败示例：
```json
{"manifest_path":null,"nas_url":null,"error":"missing /home/.../article/article.md"}
```
