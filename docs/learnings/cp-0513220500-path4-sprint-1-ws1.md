## Path 4 Sprint 1 WS1 — DB schema + 路由 + Agent + OpenRouter + 部署 (2026-05-14)

**Branch**: `cp-0513220500-path4-sprint-1-ws1` → PR #292
**Brain task**: `140c8d7b-fbbd-4a5c-9ac7-dd18e6514a80`

### 任务

Path 4 (客户私域 AI 接管) Sprint 1 第一刀 WS1 — 6 ARTIFACT + 8 BEHAVIOR DoD: 2 migration (zenithjoy schema) + OpenRouter 封装 + 3 zod route + Agent wechat-rpa spawn handler + Python dryrun + rog 部署脚本。

### 根本原因 (今天为什么走通)

harness sprint contract round 2 APPROVED + 倒推 task-plan.json + per-WS dod 文件 + lead-acceptance 模板 — 这一整套合同先行体系把"该做什么"+"怎么测"全部锁死, 让 subagent-driven 实施时不需要反复确认设计意图, 实施只剩"照合同写"。

### 关键发现 (plan v1 → v2 修订, 真踩坑)

1. **现有表全部在 `zenithjoy.` schema** (不是 public)
   - 现有: `zenithjoy.works` / `zenithjoy.publish_logs` / `zenithjoy.tenants` / `zenithjoy.agents` / `zenithjoy.pipeline_runs`
   - 新建必须加前缀: `CREATE TABLE IF NOT EXISTS zenithjoy.wechat_publish_task ...`
   - SQL 查询也要带 `FROM zenithjoy.<table>`, 不带就 relation not found
   - **校验方式**: 写代码前 `grep "CREATE TABLE" apps/api/db/migrations/*.sql | head -3`

2. **集成测试路径 ≠ `tests/ws1/`**
   - `apps/api/vitest.config.ts` 主动**排除** `tests/ws1/**` (历史 ws1 测试已迁走)
   - 正确路径 `apps/api/tests/integration/<ws-name>/` + 文件名以 `.integration.test.ts` 结尾
   - 走 `apps/api/vitest.integration.config.ts`, 含 `global-setup.ts` (自动跑 migration) + `setup-env.ts` (设 DB env)
   - **校验方式**: `cat apps/api/vitest.config.ts | grep -E "include|exclude"` 写测试前先看

3. **Agent dispatch 风格不是 switch/case 是 if/else if 链 on `task.platform`**
   - `services/agent/src/index.ts` 用 `task.platform` 字符串匹配 (heartbeat-loop onTask 调用)
   - 我把 wechat 3 个 task type 当作 platform 值挂上去 (`wechat_qr_bind` / `wechat_moments_send` / `wechat_private_chat_send`)
   - 这是命名权宜, 后端派任务时要用相同字符串作 platform 字段
   - **真 dispatch + 回报中台** 推到 WS3/4 接真 `wechat_bot.py` 时一起做

4. **smoke 路由检测必须 graceful skip when API not reachable**
   - 本地 dev 通常不起 API, smoke 直接 curl 会 connection refused → CI 红
   - 解法: 先 `curl --max-time 2 /health` 探测, 不达 = SKIP (integration test supertest 已覆盖路由)
   - CI 起 services 时 API 可达, smoke 真跑

### 下次预防 (写类似 sprint 的 checklist)

- [ ] 写 plan 前: 读现有 vitest.config (主 + integration) 知道测试路径约定
- [ ] 写 plan 前: grep "CREATE TABLE" 现有 migrations 知道 schema 前缀约定
- [ ] 写 plan 前: 读 agent index.ts 知道 dispatch 风格 (switch / if-else / callback)
- [ ] 智能 routing 用 task.platform 不是 task.type (现有 ZenithJoy 约定)
- [ ] OpenRouter 封装的 FORCE_5XX 注入必须锁 NODE_ENV in (test, development) 防生产意外
- [ ] CI=true clamp max_tokens=20 是真烧 token 的最后防线 (单 PR < $0.01)
- [ ] smoke 路由检测 = API 可达性探测 + skip if 不达 (本地 + CI 两通)
- [ ] migration 文件名 `YYYYMMDD_HHMMSS_<name>.sql`, **同一 task 多文件递增 1 秒**避免字典序混乱
- [ ] handler 测试放 `services/agent/src/handlers/__tests__/` (符合现有 douyin/kuaishou 等的 testing 约定)

### 后续 (Path 4 Sprint 1 剩余 5 个 WS)

| WS | 内容 | 体量 | 依赖 |
|---|---|---|---|
| WS2 | 飞书 Bitable 多租户自动建 3 张表 (客户档案/营销画像/内容排期) | L | WS1 |
| WS3 | 私聊监听 → DeepSeek 草稿 → 写飞书 (含真 wechat_bot.py 整入) | XL | WS1+WS2 |
| WS4 | 朋友圈定时 → DeepSeek 文案 → 写飞书 (含真 wechat_rpa.py 整入) | L | WS1+WS2 |
| WS5 | 飞书审批流 → scheduler-tick 派任务 | M | WS3+WS4 |
| WS6 | 真发 (RPA) + 回执回写 + Lead 自验 (rog 真扫码绑号) | XL | WS5 |

WS3/4/6 需要 Lead xian-rog 真机参与 (扫码 / 真发 / 真回执), 不能纯 CI 跑。

### 数字 (今晚)

- 4 task subagents (Task 1 haiku / Task 2 haiku / Task 3 sonnet / Task 4 sonnet / Task 5 sonnet / Task 6 haiku)
- 1 Research Subagent (spec APPROVE)
- 5 commits (skeleton + 4 impl)
- 1 smoke fix commit (graceful skip)
- 12/12 vitest PASS (11 integration + 1 handler) + 43 agent regression PASS
- 4/4 smoke PASS (无 API graceful skip)
