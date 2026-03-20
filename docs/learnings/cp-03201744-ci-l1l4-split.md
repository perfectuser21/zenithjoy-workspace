---
branch: cp-03201744-ci-l1l4-split
date: 2026-03-20
type: learning
---

# Learning: CI 分层重构 L1-L4

## 做了什么
将单个 ci.yml（12 jobs）拆为 4 个分层 workflow，对齐 cecelia 架构。

## 分层设计原则

| 层 | 速度 | 失败含义 | 什么时候跑 |
|----|------|---------|-----------|
| L1 | 最快（~10s） | 流程不规范 | 仅 PR |
| L2 | 快（~15s） | 结构不一致 | push + PR |
| L3 | 中（~50s） | 代码质量问题 | push + PR |
| L4 | 慢（~35s） | 运行时 bug | push + PR |

## 关键决策

1. **L1 仅 PR 触发** — push 到 main 不需要检查 PR 标题格式，L2-L4 在 push + PR 都触发。

2. **Change Detection 在 L3/L4 各自复制** — 不用 reusable workflow 共享，因为每层的 outputs 需求不同（L4 不需要 geoai），且维护更简单。

3. **L2 不需要 change detection** — 一致性检查总是全量跑，因为很快（< 15s）且与模块无关。

## 后续
- 合并后需更新 GitHub Branch Protection 的 required status checks
- 从 `CI Passed` 改为 4 个 gate job
