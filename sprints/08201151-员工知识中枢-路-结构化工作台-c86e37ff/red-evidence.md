# TDD Red 证据 — 路③ 结构化工作台 Sprint A（Round 1）

## 本机为什么没跑出 vitest 输出（如实登记，不是"跑绿了"）

本 worktree 无 `node_modules`，且宿主 npm 缓存目录被 root 占有：

```
npm error code EACCES
npm error path /Users/administrator/.npm/_cacache/tmp/477c5113
npm error Your cache folder contains root-owned files
```

`npx vitest` 会先尝试下载依赖 → 直接 EACCES 退出，**装不上依赖就跑不了测试**。
不用"看起来像绿"的替代命令蒙混，改用确定性的结构证据 + 给出 CI 侧可复现命令。

## 确定性红证据（被测目标一个都不存在 → 全部用例必红）

`2026-08-20` 于 `cp-08200910-structured-workbench-a`（base `06f12cb3`）实测：

```
MISSING apps/api/src/middleware/workbench-auth.ts
MISSING apps/api/src/knowledge/retrieval-exclusions.ts
MISSING .github/workflows/scripts/smoke/structured-workbench-smoke.sh
MISSING .github/workflows/db-backup.yml
MISSING .github/workflows/e2e-knowledge-hub-path3.yml
MISSING .github/workflows/scripts/backup/restore-drill.sh
app.ts 中 "knowledge/db" 命中 0 次      → 路③ 端点族未挂载
fields.service.ts 中 "tenant_id" 命中 0 次 → 段② 隔离未做
fields.ts 中 "tenantContext" 命中 0 次   → 段① 鉴权未挂
```

逐文件的必红原因：

| 测试文件 | 必红原因 | 预期 failures |
|---|---|---|
| `tests/workbench-auth-guard.test.ts` | `import { workbenchAuthGuard } from '.../middleware/workbench-auth'` 目标文件不存在 → 模块解析失败，整个 suite 红 | 6 |
| `tests/workbench-tables.test.ts` | `/api/knowledge/db/*` 在 `app.ts` 零挂载 → 全部请求走通用 404，断言 201/200 全失败；`zenithjoy.db_tables` 表不存在 → 夹具清理与查询报错 | 5 |
| `tests/workbench-visibility-trash.test.ts` | 同上 + 回收站端点不存在 | 4 |
| `tests/fields-legacy-isolation.test.ts` | 第一条「无身份四端点均返 401」在 `origin/main @ bdebf9e4` 上**返 2xx**（洞记 issue `1ae57f1a`），是**当前就红的真判据**；`field_definitions.tenant_id` 列不存在 → 夹具 INSERT 直接报错 | 4 |

合计 **19 个必红用例**。

## CI 侧复现命令（generator commit-1 之后必须看到红）

```bash
npm ci
cd apps/api && npx vitest run "../../sprints/08201151-员工知识中枢-路-结构化工作台-c86e37ff/tests/" --reporter=verbose
```

预期：19 failures，其中 `fields-legacy-isolation.test.ts` 的
`无身份调 /api/fields 四端点均返 401` 一条是**业务真红**（端点确实无鉴权），
其余为**目标未实现红**。generator 的 commit-1 必须原样提交这四个测试文件并留下这份红日志，
commit-2 再写实现让它们转绿——**测试文件在 commit-1 之后不可修改**（CONTRACT IS LAW）。

## 合同格式确定性自查（Step 2b-check）实测输出

```
1) BEHAVIOR 条数 = 28
2) E2E 验收段 OK
3) 无预勾 [x] OK
4) manual: 条数 = 28 (>= 28)
5) E2E bash 块 = 1
6) bash -n + 全角扫描 OK
7) 真执行=28 文本自证=0
✅ 合同格式自查通过
```
