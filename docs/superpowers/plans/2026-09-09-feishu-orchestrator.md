# 飞书版编排台 + 通用 rollup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 飞书 Bitable 版发布编排台（镜像 Notion 版）+ 无锚作品通用 rollup（还 P2-2/P2-3 债）。

**Architecture:** 见 spec `docs/superpowers/specs/2026-09-09-feishu-orchestrator-design.md`（组件 1-5，值形态/互斥/rollup 语义以它为准，实现者必读）。

**Tech Stack:** Express/pg/axios/vitest（mock pg+mock feishu-client）；镜像参照 services/notion-orchestrator.ts。

## Global Constraints

- spec 为唯一权威；镜像最大错误面=Bitable 值形态（多选字符串数组/单选裸字符串/URL={text,link}/读回文本 segment 数组）——测试必须逐一钉死
- latest-wins 先行再判 allTerminal；tasks=0 skip；rollup 只碰无锚作品
- publish-dispatch.test.ts:485 的 DISTINCT ON 正则守卫不许打红（helper SQL 保持兼容）
- notion-orchestrator 既有 11 测试全程保绿；新 env 必须登记 env-registry.ts（env-gate 闸）
- token/错误纪律同 notion-client（不泄 token；模块缓存）；TDD 两段式；lint-test-pairing：新 src 配同名测试
- 分支 cp-09092000-feishu-orchestrator

---

### Task 1: 共享 helper + rollup sweeper + notion syncReceipts 改造（还债）

**Files:**
- Create: `apps/api/src/services/publish-receipts.ts`、`apps/api/src/services/publish-rollup.ts`
- Modify: `apps/api/src/services/notion-orchestrator.ts`（syncReceipts 聚合段换 helper；SUCCESS_STATUSES/NON_TERMINAL 引用挪到 publish-receipts 后从那 import）、`apps/api/src/routes/publish-dispatch.ts`（列表端点聚合段换 helper）、`apps/api/src/index.ts`（挂 startPublishRollup）
- Test: `apps/api/src/services/__tests__/publish-receipts.test.ts`、`__tests__/publish-rollup.test.ts`（新）；notion-orchestrator.test.ts 增"历史 failed 行不污染"用例；publish-dispatch.test.ts 既有 37 保绿

**Interfaces:**
- Produces: `aggregateLatestReceipts(tenantId, contentIds) → Promise<Map<string, Array<{platform,status,result}>>>`；`SUCCESS_STATUSES`；`isTerminal(status)`；`startPublishRollup(intervalMs?)/stopPublishRollup/runRollupOnce()`（导出供测试与 smoke）
- TDD：commit-1 红（helper latest-wins/带 result；rollup 无锚过滤/tasks=0 skip/pending 等待/全成 published/有败 failed；notion 新用例）→ commit-2 绿（全量 notion 12 + dispatch 37 保绿）

### Task 2: feishu-client + migration + 建表脚本

**Files:**
- Create: `apps/api/src/services/feishu-client.ts`（token 模块缓存+_resetTokenCache+feishuRequest+频控错误识别）、`apps/api/db/migrations/20260909_213000_contents_feishu_record_id.sql`（照 notion_page_id 模板+COMMENT 区分 Line04 同名列）、`apps/api/scripts/create-feishu-orchestrator-table.mjs`（建 app/表/字段类型号 1/3/4/15+options 预置+协作者 full_access+输出两个 env 值）
- Test: `apps/api/src/services/__tests__/feishu-client.test.ts`（token 缓存两调一取/过期刷新/错误不泄 secret/频控错误可识别）
- 现成范本：feishu-bitable.ts getTenantToken、feishu-bitable-multitenant.ts createBitable/createTable、feishu-token.ts 刷新阈值

### Task 3: feishu-orchestrator worker + 互斥 + env-registry

**Files:**
- Create: `apps/api/src/services/feishu-orchestrator.ts`（三方向镜像，spec 组件 4 的值形态/错误翻译/截断规则逐条）、`__tests__/feishu-orchestrator.test.ts`（≥12 用例：推行值形态四断言/锚回写/拉发 segment 拼接+白名单+锚失效+AlreadyQueued 幂等+NoAgent 派发失败+终态拒重派/回执全终态+挪出 queued/启动自检/互斥拒启）
- Modify: `apps/api/src/index.ts`（挂载）、`apps/api/src/env-registry.ts`（三条新 env）
- TDD 两段式；mock 模式照 notion-orchestrator.test.ts（vi.mock feishu-client/pg/content-publish-dispatch importActual 保错误类）

### Task 4: smoke + 入册 + 全量

- Create: `.github/workflows/scripts/smoke/publish-rollup-smoke.sh`（种无锚 queued 作品+done 任务→node 直调 dist? 不可——用 API 面：种数据后等 60s? CI 慢。改：`docker/node 不可用`——最简：psql 种数据 + 通过一个一次性 node -e 调 runRollupOnce？CI 无 ts 运行时。**定案**：smoke 验证"无 FEISHU env 时 API 健康+新路由零回归"（同 notion-orchestrator-selfcheck 模式）+ rollup 用 vitest 层保真（integration mock 已足），smoke 命名 feishu-orchestrator-selfcheck-smoke.sh 两断言：/api/health 200、GET /api/contents 无凭据 401）
- Modify: smoke-baseline.txt、test-registry.yaml（4 个新测试文件入册）、product-map.yaml（smoke 登记 customer_first_success）+ regenerate
- 全量：apps/api vitest（除既存 boot-fail）/tsc/eslint 警告不升

## 合并后（控制者）
真跑建表脚本 → staging env 追加（FEISHU_ORCH_* 三条，测试租户）→ 重跑 deploy workflow → 四条镜像真验 + rollup 真验（psql 断言无锚作品收敛）。
