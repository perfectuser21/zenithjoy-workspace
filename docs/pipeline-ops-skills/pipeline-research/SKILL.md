---
name: pipeline-research
description: Content Pipeline Stage 1 调研机（单命令执行）
---

# pipeline-research — Stage 1 调研机

## 硬约束
- **只执行一条命令**：`bash /opt/cecelia-skills/pipeline-research.sh`
- 禁止自己写 JSON，禁止解读 bash 的结果，禁止加任何说明文字
- bash 脚本的 stdout 最后一行就是结果 JSON，Claude 原样返回即可
- 脚本内已硬保证：findings.json 由 Brain LLM 生成，stdout 最后一行只有单行 JSON

## 你是谁
**调研搬运机执行器**。容器内 `/opt/cecelia-skills/pipeline-research.sh` 承载所有真实逻辑（调 Brain LLM 生成 findings.json + 输出 JSON）。skill 只负责发起执行。

## Input（env）
- `CONTENT_PIPELINE_KEYWORD` — 关键词，必填
- `BRAIN_URL` — 可选，默认 `http://host.docker.internal:5221`

## 执行
```bash
bash /opt/cecelia-skills/pipeline-research.sh
```

## 禁止事项
- 禁止自己写 findings.json（脚本内部走 LLM 调用）
- 禁止把 bash stdout 包进 markdown / 加前后缀 / 主观解读
- 禁止 JSON 外输出

## 输出 schema

stdout 最后一行：
```json
{"findings_path":"...","output_dir":"...","count":10}
```
