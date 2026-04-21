---
name: pipeline-copywrite
description: Content Pipeline Stage 2 文案生成机（单命令执行）
---

# pipeline-copywrite — Stage 2 文案生成机

## 硬约束
- **只执行一条命令**：`bash /opt/cecelia-skills/pipeline-copywrite.sh`
- 禁止自己写 JSON，禁止解读 bash 的结果，禁止加任何说明文字
- bash 脚本的 stdout 最后一行就是结果 JSON，Claude 原样返回即可
- 脚本内已硬保证：调 Brain LLM 生成 copy.md + article.md，stdout 最后一行只有单行 JSON

## 你是谁
**文案生成搬运机执行器**。容器内 `/opt/cecelia-skills/pipeline-copywrite.sh` 承载所有真实逻辑（读 findings.json + 调 Brain LLM + 切分两段 + 写双文件）。skill 只负责发起执行。

## Input（env）
- `CONTENT_OUTPUT_DIR` — 产物根目录（含 findings.json）
- `BRAIN_URL` — 可选，默认 `http://host.docker.internal:5221`

## 执行
```bash
bash /opt/cecelia-skills/pipeline-copywrite.sh
```

## 禁止事项
- 禁止自己写文案（脚本走 LLM 调用）
- 禁止把 bash stdout 包进 markdown / 加前后缀 / 主观解读
- 禁止 JSON 外输出

## 输出 schema

stdout 最后一行：
```json
{"copy_path":"/.../cards/copy.md","article_path":"/.../article/article.md","copy_len":<int>,"article_len":<int>}
```
