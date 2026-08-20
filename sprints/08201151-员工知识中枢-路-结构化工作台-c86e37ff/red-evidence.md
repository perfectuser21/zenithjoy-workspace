# TDD Red 证据 — 路③ 结构化工作台 Sprint A（Round 2）

## 本机为什么没跑出 vitest 输出（如实登记，不是"跑绿了"）

本 worktree 无 `node_modules`，且宿主 npm 缓存目录被 root 占有：

```
npm error code EACCES
npm error path /Users/administrator/.npm/_cacache/tmp/1145f01b
npm error Your cache folder contains root-owned files
```

`npx vitest` 会先尝试下载依赖 → 直接 EACCES 退出，**装不上依赖就跑不了测试**。
不用"看起来像绿"的替代命令蒙混，改用确定性的结构证据 + 给出 CI 侧可复现命令。

## R1 → R2 关键变化：夹具从「永久红」改成「实现写对就能转绿」

Reviewer P0-1 指出上一版夹具在现有假上游下**永远转不绿**（不是 TDD red，是死红）。本轮修完：

| 硬伤 | R1 现状 | R2 修法 |
|---|---|---|
| code 形态不被识别 | `wb-code-alice-<sfx>` 中间夹 `-`，`/code-([A-Za-z0-9_]+)$/` 解析为 NULL → 假上游回 `20021 invalid code` → 无 `set-cookie` → 三个 cookie 全是字符串 `"undefined"` → 实现写对也全部 401 | code 改为 **`wb-code-<open_id>`**（`codeFor()` 唯一出口）；同刀给 `_smoke-fake-feishu.ts` 加 `pickDeclaredMember` fallback，分组名未命中时按 `open_id` 精确寻址。`code-<ORGKEY>` 既有分支**一字不改** |
| alice/bob 拿不到两个身份 | `pickGroupMembers` 只返分组首个非邮箱成员，甲乙解析成同一人 → A8「同组织他人」在设计上没有第二个人可用 | 按 `open_id` 寻址后三人各自独立，`COOKIE_A`/`COOKIE_A2`/`COOKIE_B` 三个真会话 |
| 缺 `FEISHU_APP_ID/SECRET` | `staff.ts:139-142` 缺一即 500 | 夹具显式 `??=` 占位值（假上游 shim 的兜底之外再兜一层） |
| 签发失败被静默吞掉 | cookie 为 `"undefined"` 时全部用例以 401 收场，**看着像"实现没写"** | `loginAs` 拿不到 cookie 就地抛错并打印 `status`/`body`，把夹具故障与实现缺失区分开 |

**当前状态**：`pickDeclaredMember` 在 `origin/main` 上**不存在**（实测 `grep -c pickDeclaredMember apps/api/src/routes/_smoke-fake-feishu.ts` = 0），
所以夹具现在仍是红的——但这是**可被实现转绿的红**，且合同 ARTIFACT 段有对应条目钉住这一改动。

## 确定性红证据（被测目标一个都不存在 → 全部用例必红）

`2026-08-20` 于 `cp-08200910-structured-workbench-a`（HEAD `6fc36c8d`）实测：

```
MISSING apps/api/src/middleware/workbench-auth.ts
MISSING apps/api/src/knowledge/retrieval-exclusions.ts
MISSING .github/workflows/scripts/smoke/structured-workbench-smoke.sh
MISSING .github/workflows/db-backup.yml
MISSING .github/workflows/e2e-knowledge-hub-path3.yml
MISSING .github/workflows/scripts/backup/restore-drill.sh
MISSING .github/workflows/scripts/smoke/lib/scan-hardcoded-secrets.mjs   ← R2 新增（P1-2：原本不在任何清单里，空实现满分）
MISSING .github/workflows/scripts/smoke/lib/scan-hardcoded-env.mjs       ← R2 新增（同上）
app.ts 中 "knowledge/db" 命中 0 次                    → 路③ 端点族未挂载
apps/api/src/services/fields.service.ts 中 "tenant_id" 命中 0 次 → 段② 隔离未做
_smoke-fake-feishu.ts 中 "pickDeclaredMember" 命中 0 次 → 按成员寻址扩展未做（P0-1 修复目标）
```

逐文件的必红原因：

| 测试文件 | 必红原因 | 预期 failures |
|---|---|---|
| `tests/workbench-auth-guard.test.ts` | `import { workbenchAuthGuard } from '.../middleware/workbench-auth'` 目标文件不存在 → 模块解析失败，整个 suite 红 | 6 |
| `tests/workbench-tables.test.ts` | `/api/knowledge/db/*` 在 `app.ts` 零挂载 → 全部请求走通用 404；`zenithjoy.db_tables` 表不存在 → 夹具查询报错 | 5 |
| `tests/workbench-visibility-trash.test.ts` | 同上 + 回收站端点不存在 | 4 |
| `tests/fields-legacy-isolation.test.ts` | ① 「无身份四端点均返 401」在 `origin/main` 上**返 2xx**（洞记 issue `1ae57f1a`）= **业务真红**；② R2 新增的两条正向对照（读得到自己那行 / 改得动自己那行且 `field_name` 真落库）在无鉴权+无租户列时也红；③ `field_definitions.tenant_id` 列不存在（`\d zenithjoy.field_definitions` 实测列集 = id/field_name/field_type/options/display_order/is_visible/created_at/updated_at）→ `beforeAll` 的 `mk()` INSERT 报 `column "tenant_id" does not exist`，整个 suite 红 | 5 |

合计 **20 个必红用例**（R1 为 19；+1 = P1-4 新增的「A 企业身份能改自己那一行且 `field_name` 真落库」正向对照）。
**R3 修正**：该正向对照 R2 原写 `label`，但 `field_definitions` 无此列（真库列集如上、建表 migration
`20260210_000000_create_works_tables.sql:66-75` 同、`models/schemas.ts:30-38` 的 `createFieldSchema` 亦无
——zod 会把 `{label:x}` strip 成 `{}`，PUT 返 2xx 却什么都没改），而 PRD J7 段② 只要求加 `tenant_id`。
改用既有可更新列 `field_name`（`VARCHAR(100) NOT NULL`，在 `createFieldSchema` 内，`.partial()` 后可单独 PUT，
`fields.service.ts:73` 的动态 UPDATE 认它），必红原因不变（无鉴权 → 该 PUT 现在无身份也能过；无 `tenant_id` 列 → 种子先炸）。
**R3 修正（夹具）**：`_workbench-fixture.ts` 的 `INSERT INTO zenithjoy.tenants` 补上 `license_key`
（NOT NULL 无默认 + UNIQUE，`\d zenithjoy.tenants` 实测）——漏给会让四个 suite 全部红在 `seedTwoTenants` 抛错上，
那是**夹具故障**不是业务红，实现写完照样红。补齐后 20 条必红全部红在业务缺失上。
另：`fields-legacy-isolation.test.ts` 原第 68-71 行的 `GET /api/fields/${orgBFieldId}` 期望 `[403,404]` **已删除**——
`routes/fields.ts` 全文只有 `GET /`、`POST /`、`PUT /:id`、`DELETE /:id`，**没有 `GET /:id`**，
Express 对未知路由一律 404，该断言与隔离做没做完全无关，是恒真条目（reviewer P1-4 附带项）。

## CI 侧复现命令（generator commit-1 之后必须看到红）

```bash
npm ci
cd apps/api && npx vitest run "../../sprints/08201151-员工知识中枢-路-结构化工作台-c86e37ff/tests/" --reporter=verbose
```

预期：20 failures。generator 的 commit-1 必须原样提交这四个测试文件 + 夹具并留下红日志，
commit-2 再写实现让它们转绿——**测试文件在 commit-1 之后不可修改**（CONTRACT IS LAW）。

## 合同格式确定性自查（Step 2b-check）实测输出

```
BC=34 MC=34 E2E_BLOCKS=1 REAL_EXEC=34 GREP_ONLY=0
✅ 合同格式自查通过
```

附加自查（R2 新加，本轮 DoD 大量改用内联长命令，先证它们语法上跑得起来）：

```
34 条 Test: manual: 命令外层 bash -n  → checked=34 bad=0
其中 22 条 bash -c '<内层脚本>' 内层 bash -n → inner checked=22 bad=0
```
