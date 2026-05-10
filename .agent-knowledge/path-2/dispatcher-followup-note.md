# Dispatcher human-in-loop 设计 — Follow-up note (post architecture hotfix)

**Date**: 2026-05-10
**Trigger**: Path 2 Sprint A architecture hotfix (PR #278 + #279)

## 背景

`.agent-knowledge/path-2/lead-acceptance-automation-proposal.md` 之前提的 dispatcher human-in-loop 设计是为了**解决 OAuth 扫码物理瓶颈**：
- Lead 自验需要 user 在物理手机上扫码飞书 OAuth 二维码
- 自动化机器（rog/xian-pc）跨不过这一步
- 因此设计了 dispatcher：把扫码请求 push 到 user 手机，user 扫完 callback 通知 dispatcher

## 物理瓶颈消失

PR #278 architecture 重构后 — **客户根本不需扫码**：
- 客户在飞书后台一次性 install app + 配权限（一次性 setup，不在 lead 自验链路）
- dashboard 表单填 `app_id/secret` → 后端用 `tenant_access_token` 同步建 Bitable

ROG 0-touch 自验 16s 端到端 PASS（`user_intervention_count = 0`），dispatcher 完全不需要为扫码服务了。

## Dispatcher 是否还有用？

**有 — 但定位变了**。

之前 = 为扫码（解决人机协同瓶颈）
现在 = 为并发（解决多机调度负载均衡）

潜在场景：
1. **Walking skeleton 多 Path 并行验证**：path1/path2/path3 同时跑 lead 自验，需要不同机器（rog/xian-pc/macmini）
2. **Path 自验 device 调度**：每条 Journey 自验适合的 device 类型不同（user_facing 用 Windows + msedge，dev_pipeline 用 mac CI runner）
3. **Sprint 验证并发**：多 sprint 同时合入 main 时分配独立 device 跑 e2e

## 建议

- 不再以 OAuth 扫码协议为核心 design
- dispatcher 简化为 **device-pool + task-queue**（per-Journey-type 路由规则）
- 不在本 sprint 实现，留给 Path 2 thicken / Path 3 启动时再评估

参考：
- `lead-acceptance-machines.md` (memory) — xian-pc / xian-rog 已按 sprint 性质分配
- `lead-acceptance-final-design-v2.md` — 旧 design 文档（OAuth 扫码协议部分可视为 deprecated）
