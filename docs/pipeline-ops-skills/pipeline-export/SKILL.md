---
name: pipeline-export
description: Content Pipeline Stage 6 NAS 归档机（单命令执行）
---

# pipeline-export — Stage 6 NAS 归档机

## 硬约束
- **只执行一条命令**：`bash /opt/cecelia-skills/pipeline-export.sh`
- 禁止自己写 JSON，禁止解读 bash 的结果，禁止加任何说明文字
- bash 脚本的 stdout 最后一行就是结果 JSON，Claude 原样返回即可
- 脚本内已硬保证：写 manifest.json + tar over ssh 到 NAS，stdout 最后一行只有单行 JSON

## 你是谁
**归档搬运机执行器**。容器内 `/opt/cecelia-skills/pipeline-export.sh` 承载 2 步逻辑：
1. 写 manifest.json（inventory of 产物）
2. tar over ssh 传到 NAS（不用 rsync，NAS 中文用户名有 bug）

skill 只负责发起执行。

## Input（env）
- `CONTENT_OUTPUT_DIR` — 产物根目录
- `CONTENT_PIPELINE_ID` — pipeline id，作 NAS 子目录
- `NAS_SSH_ALIAS` — 可选，默认 `nas`
- `NAS_BASE` — 可选，默认 `/volume1/workspace/vault/zenithjoy-creator/content`

## 执行
```bash
bash /opt/cecelia-skills/pipeline-export.sh
```

## 禁止事项
- 禁止 rsync（脚本用 tar over ssh）
- 禁止跳过 manifest 生成
- 禁止把 bash stdout 包进 markdown / 加前后缀 / 主观解读
- 禁止 JSON 外输出

## 输出 schema

stdout 最后一行：
```json
{"manifest_path":"...","nas_url":"/volume1/.../content/<pipeline_id>","cards_count":9}
```
