# 接缝台账 —— 路③ 结构化工作台 · Sprint C（S3 视图切得开）

**判定归 DoD、供给归脚本**（沿用 Sprint A/B）。以下四条接缝「linux CI 绿 ≠ done」，真验位置在 windows_cloud 真浏览器；未真验一律标 `logic-done-pending`，windows job 绿后转 `done`。

| 接缝 | 描述 | 真验位置 | 状态 |
|------|------|----------|------|
| S3-1 | dnd-kit 指针拖拽语义（PointerSensor 激活距离 + 真 mouse 序列） | windows job `@views-kanban`（e2e-views-run.ps1） | logic-done-pending |
| S3-2 | 视图偏好保存失败可见提示（断网 → view-prefs-error 且不白屏、可重试） | windows job `@views-prefs` 截图 05 | logic-done-pending |
| S3-3 | 看板分列渲染与卡片弹回（409/断网各弹回原列 + 对应提示） | windows job `@views-kanban` 截图 03/06 | logic-done-pending |
| S3-4 | JSONB 筛排的真 PG 排序语义（数字字段数值序，非字典序） | linux job `test:workbench-views` + `--a25-only`（真 Postgres） | done |

> S3-4 在 linux 真 Postgres 上即可判死（数值序 vs 字典序差一个 `->` / cast），故标 done；
> 其余三条依赖真浏览器指针事件与断网，windows job conclusion=success 前保持 logic-done-pending。
