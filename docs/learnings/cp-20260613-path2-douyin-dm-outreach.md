# Learning — Path 2 抖音私信主动触达 thin v1

**Sprint**: 06131229-path2-douyin-dm-outreach
**Journey**: Path 2 客户智能获客路径 / Step 6 评论区挖客闭环 — 主动私信触达
**推进**: Path 2 新增 Ability「抖音私信主动触达」thin，从无到「中台派单 → agent 真发 → 飞书回写状态」打通。

## 做了什么

- 中台 `apps/api/src/routes/agent-burner.ts` 新增 3 端点（沿用既有 `{success,data,timestamp}` 包裹 + tenantContext/agentContext）：
  - `POST /dm-outreach`：派单落 `task_type=dm_outreach` / `platform=douyin` / `status=queued`，返 `data.task_id`
  - `POST /dm-outreach-result`：接 sent/limited/failed+error_code 回报 → 写飞书 + 更新 task 终态
  - `GET /dm-tasks/:task_id`：查触达态（未知 → 404 `NO_DM_TASK`）
- `lead-writer.ts` 增 `writeDmOutreachStatus`：复用 `writeRecord` 写「触达状态/触达主页 URL/触达时间/触达小号/失败原因」。
- agent `services/agent/src/handlers/douyin-dm-outreach.ts`：`handleDouyinDmOutreach`（DmPage 抽象，单测注入 fake page；真机 createRealDmPage 走 semi-button-second 私信按钮 + contenteditable + Enter）+ `mapDmStatusToFeishu`。index 注册 + 版本 2.0.13→2.0.14。
- smoke `golden-path-2-dm-smoke.sh`（fake-agent 模式）+ 接进 ci-l4-e2e-smoke。

## 关键决策 / 踩坑

1. **task_type 与 platform 分列**：既有 burner 端点把 `task_type=platform='crawl_comments/douyin'` 写成同一合并串；合同要求 `task_type='dm_outreach'` + `platform='douyin'` 分开。agent heartbeat 派单按 `platform` dispatch，故 DM 任务在 payload 带 `task_type='dm_outreach'`，dispatch 分支 `platform==='douyin' && payload.task_type==='dm_outreach'` 须排在 folder-publish `'douyin'` 分支之前。
2. **限流如实标 limited**：私信按钮不可点 = 仅互关受限 → `status=limited` 写「未送达-仅互关」，**绝不**写「已私信」（禁止假 sent）。
3. **单号停用不连坐**：failed + error_code∈{SESSION_EXPIRED,RISK} 仅把「被触达那个 (agent,account_label) burner 号」status 置 `expired`（CHECK 约束合法值，无 disabled），同 agent 其他号不动。
4. **状态映射刻意不跨包 import**：`mapDmStatusToFeishu` 在 agent 包，中台 `writeDmOutreachStatus` 内联同一映射，避免把 services/agent 拉进 apps/api 构建边界。
5. **真发不入自动 E2E**：CDP 真发由 xian-pc 真机手验（PRD 范围限定）；自动 E2E 走 fake-agent 验中台编排 + 飞书回写。
6. **覆盖率护栏**：新路由初始把 apps/api 全局 coverage 压到 65.26%（阈值 65%，仅 0.26% 余量）→ 补 agent-burner/lead-writer 单测抬到 66.41%。
