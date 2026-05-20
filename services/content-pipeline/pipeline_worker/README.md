# Pipeline Worker — 内容工厂 6 阶段执行器

将 topic 从"研究中"推进到"待发布"，经历 6 个阶段：

1. **research** — NotebookLM 调研，产出 findings.json
2. **copywriting** — LLM 文案生成（社交媒体 + 公众号长文）
3. **copy_review** — 品牌对齐 + 禁用词审查
4. **generate** — 图片生成（调用 gen-v6-person.mjs）
5. **image_review** — 图片完整性 + 尺寸检查
6. **export** — rsync 到 NAS + manifest.json

## 运行

```bash
# dry-run（只打印，不执行）
python3 pipeline_worker/worker.py

# 真正执行
python3 pipeline_worker/worker.py --apply
```

## 部署

```bash
bash scripts/deploy-pipeline-worker.sh
```

## Cecelia 调度

每个需要外部资源的阶段执行前，会询问 Cecelia `POST /api/brain/can-run`。
Cecelia 不可达时自动 fallback（不阻断 pipeline）。

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| CREATOR_API_BASE | http://localhost:8899 | Creator API |
| BRAIN_URL | http://localhost:5221 | Cecelia Brain |
| NAS_USER | 徐啸 | NAS SSH 用户 |
| NAS_HOST | 100.110.241.76 | NAS IP |
| NAS_BASE | /volume1/workspace/vault/zenithjoy-creator/content | NAS 基础路径 |
| CONTENT_OUTPUT_DIR | ~/content-output | 内容产出目录 |
