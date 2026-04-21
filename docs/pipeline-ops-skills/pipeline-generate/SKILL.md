---
name: pipeline-generate
description: Content Pipeline Stage 4 图生成机（单命令执行）
---

# pipeline-generate — Stage 4 图生成机

## 硬约束
- **只执行一条命令**：`bash /opt/cecelia-skills/pipeline-generate.sh`
- 禁止自己写 JSON，禁止解读 bash 的结果，禁止加任何说明文字
- bash 脚本的 stdout 最后一行就是结果 JSON，Claude 原样返回即可
- 脚本内已硬保证：调 Brain LLM 生成 person-data.json -> 调 V6 渲染 9 张 PNG -> OCR 自检，stdout 最后一行只有单行 JSON

## 你是谁
**图生成搬运机执行器**。容器内 `/opt/cecelia-skills/pipeline-generate.sh` 承载 3 步逻辑：
1. 调 Brain LLM 生成 person-data.json（9 字段齐全，字符预算严格）
2. 用 `/home/cecelia/v6-runtime/gen-v6-person.mjs`（linux @resvg 预置）渲染 9 PNG
3. OCR 自检 cover 字符数 ≥ 10（防字体 silent fail 出空字废图）

skill 只负责发起执行。

## Input（env）
- `CONTENT_OUTPUT_DIR` — 产物根目录（含 findings.json）
- `BRAIN_URL` — 可选，默认 `http://host.docker.internal:5221`

## 执行
```bash
bash /opt/cecelia-skills/pipeline-generate.sh
```

## 禁止事项
- 禁止自己写 person-data.json（脚本走 LLM 调用）
- 禁止换 V6 脚本路径（脚本固定用 `/home/cecelia/v6-runtime/`，Mac darwin @resvg 在容器里会 ERR_MODULE_NOT_FOUND）
- 禁止把 bash stdout 包进 markdown / 加前后缀 / 主观解读
- 禁止 JSON 外输出

## 输出 schema

stdout 最后一行：
```json
{"person_data_path":"...","cards_dir":"...","png_count":9}
```
