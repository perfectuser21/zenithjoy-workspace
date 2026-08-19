# TDD Red 证据 — 合同测试在实现前全红

命令：`npx vitest run sprints/08192114-员工知识中枢-路-经验沉淀与问答-ade79e4e/tests/ --reporter=json`

时间：2026-08-19（rebase 到 origin/main 1451d092 之后）

## 汇总

```
numTotalTestSuites = 5    numFailedTestSuites = 5
numTotalTests      = 5    numFailedTests      = 3   numPassedTests = 2
```

**5 个测试套件全部 failed**。三个新功能套件连模块都 import 不到（实现文件尚不存在），
第四个套件只收集到 5 条 it()，其中 3 条红、2 条绿。

## 逐套件

| 套件 | 状态 | 红因 |
|---|---|---|
| `knowledge-auth-guard.test.ts` | failed（collect 失败）| `Cannot find module '../../../apps/api/src/middleware/knowledge-auth'` |
| `knowledge-entries.test.ts` | failed（collect 失败）| import `apps/api/src/app` 链路未就绪（知识路由未注册）|
| `staff-directory-selfcheck.test.ts` | failed（collect 失败）| `Cannot find module '../../../apps/api/src/staff-directory'` |
| `staffguard-endpoints-invariant.test.ts` | failed | 见下方逐条 |

## `staffguard-endpoints-invariant.test.ts` 逐条

```
[failed] staffGuard 端点计数等于 16（11 个 staff.ts + 5 个 skill-drafts.ts）
[passed] adminFetch 仍拼两个身份头（既有 16 端点靠它带头，摘除即全站 403）
[passed] staffGuard 中间件源码未被改动（GP 合同要求语义一行不改）
[failed] 知识面用独立 knowledgeFetch，零身份头且不复用 adminFetch
[failed] knowledgeAuthGuard 与知识路由源码零身份头名（A27 静态守卫的断言对象）
```

### 为什么这 2 条在 Red 阶段就是绿的（不是断言太弱）

这两条是 **A31 前置保护**的回归守卫，断言对象是 **base_sha 已存在的代码**
（`apps/staff-hub/src/lib/adminFetch.ts` 仍拼两个身份头、`apps/api/src/middleware/staff.ts` 语义未被改动）。
它们保护的是「本 sprint 不许把既有 16 个端点的身份头摘掉」——按定义在实现前就必须是绿的，
实现期一旦手贱摘头才会转红。GP 合同 blast_radius ⑧ 已实证：摘头 = 全体用户对既有页面一律 403。

因此本次 Red 的判据是「**5 个套件全部 failed**」，而不是「passed == 0」。
所有**新功能**断言（A30 自检、knowledgeAuthGuard、录入/读端落库、knowledgeFetch、端点计数器）
在实现前一条都不绿。
