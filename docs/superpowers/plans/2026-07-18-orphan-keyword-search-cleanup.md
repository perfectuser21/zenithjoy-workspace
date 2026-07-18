# 下线智能获客关键词采集孤岛流水线 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除 Path2 智能获客里已被 `/api/acquisition/collect/*` 取代的旧关键词采集流水线（后端5路由 + Android轮询 + Windows桌面agent轮询 + 前端设置页入口），保留新链路不动，`acquisition_keyword_tasks` 表不 drop。

**Architecture:** 纯删除任务，无新增实现。四个子系统（后端 Express 路由、Android Kotlin、Windows Node agent、React 前端）里各自独立存在一份指向旧路由/旧表的代码，逐个删除，删除后靠现有测试套件 + 编译/构建通过来验证没有留下悬空引用。

**Tech Stack:** Node/TypeScript (apps/api, services/agent), Kotlin (services/agent-android), React/TypeScript (apps/dashboard)

**背景与详细依据：** `sprints/07181054-orphan-keyword-search-cleanup/prep-prd.md`、`docs/superpowers/specs/2026-07-18-orphan-keyword-search-cleanup-design.md`、Notion Issue `979760b4-c8ea-467d-a2f5-bb96f9e20d9c`

---

### Task 1: 后端路由清理（apps/api）

**Files:**
- Modify: `apps/api/src/routes/acquisition.ts`
- Modify: `apps/api/src/routes/acquisition.test.ts`

**要删除的路由（精确边界，已核实）：**
| 路由 | 行号范围 |
|---|---|
| `POST /keyword-search` | 73-118 |
| `GET /pending-keyword-tasks` | 120-189（含 120 行注释） |
| `GET /keyword-tasks` | 191-222（含 191 行注释） |
| `POST /video-search-result` | 511-548 |
| `POST /comment-score-result` | 550-705 |

**不能删（已核实仍被新链路使用）：**
- `buildLeadFieldsFromComment`（42-58 行）——纯函数，被 `acquisition-lead-douyin-id.test.ts` 直接 import，虽然旧路由 606 行调用它，函数定义本身保留
- `tenantOf`（806 行起）——被 `/collect/*` 等新路由复用，保留
- `scoreLeads`/`buildAssignments`/`dispatchDue`（16 行 import）——`/collect/report` 等新路由也用（1343-1411 行），保留 import

**可以随路由一起删（已核实仅旧路由使用）：**
- `import { expandKeywords } from '../services/keyword-expander';`（第 4 行）
- `import { gradeComment } from '../services/comment-grader';`（第 5 行）

- [ ] **Step 1: 跑一遍现有测试，确认删除前基线全绿**

Run: `cd apps/api && npx vitest run src/routes/acquisition.test.ts`
Expected: 全部 PASS（记下总用例数，删除后用于核对少了多少个）

- [ ] **Step 2: 删除 acquisition.ts 里的 5 个旧路由 + 2 个未复用的 import**

删除第 4-5 行的两个 import：
```typescript
import { expandKeywords } from '../services/keyword-expander';
import { gradeComment } from '../services/comment-grader';
```
（保留第 6 行起其余 import 不动）

删除第 73-118 行整个 `POST /keyword-search` 路由块。

删除第 120-189 行整个 `GET /pending-keyword-tasks` 路由块（含其上方注释行）。

删除第 191-222 行整个 `GET /keyword-tasks` 路由块（含其上方注释行）。

删除第 511-548 行整个 `POST /video-search-result` 路由块。

删除第 550-705 行整个 `POST /comment-score-result` 路由块。

删除后用 `grep -n "acquisition_keyword_tasks\|keyword-search\|pending-keyword-tasks\|keyword-tasks\|video-search-result\|comment-score-result\|expandKeywords\|gradeComment" apps/api/src/routes/acquisition.ts` 确认零命中（`buildLeadFieldsFromComment` 定义本身不含这些字符串，不受影响）。

- [ ] **Step 3: 删除 acquisition.test.ts 里对应的 10 个 describe 块**

这 5 个旧路由的测试分散在 10 个 describe 块里，与新链路测试穿插，逐个按标题精确删除整个 `describe(...) { ... });` 块（不要用行号区间整段删，行号会在前面 step 改动后偏移）：

```
describe('POST /api/acquisition/keyword-search', () => { ... });
describe('GET /api/acquisition/pending-keyword-tasks', () => { ... });
describe('POST /api/acquisition/video-search-result', () => { ... });
describe('POST /api/acquisition/comment-score-result', () => { ... });
describe('POST /api/acquisition/comment-score-result — tenant 从 keyword_task_id 反查 [REGRESSION]', () => { ... });
describe('POST /api/acquisition/comment-score-result — 评论历史 + rescore [REGRESSION]', () => { ... });
describe('POST /api/acquisition/keyword-search — agent 门禁用 agents 表 [REGRESSION]', () => { ... });
describe('GET /api/acquisition/pending-keyword-tasks — tenant 隔离', () => { ... });
describe('POST /api/acquisition/keyword-search — tenant_id 写库', () => { ... });
describe('GET /api/acquisition/keyword-tasks — 前端列表（租户隔离/只读）', () => { ... });
```

删除后用 `grep -n "keyword-search\|pending-keyword-tasks\|keyword-tasks\|video-search-result\|comment-score-result" apps/api/src/routes/acquisition.test.ts` 确认零命中。

- [ ] **Step 4: 跑测试确认全绿且用例数符合预期减少**

Run: `cd apps/api && npx vitest run src/routes/acquisition.test.ts`
Expected: 全部 PASS，无 TypeScript 编译错误（未用变量/悬空 import 会在这一步报错）

再跑一次相关的独立测试确认没被误删连累：
Run: `cd apps/api && npx vitest run src/routes/acquisition-lead-douyin-id.test.ts`
Expected: PASS（证明 `buildLeadFieldsFromComment` 还在）

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/acquisition.ts apps/api/src/routes/acquisition.test.ts
git commit -m "refactor(api): remove orphan keyword-search acquisition pipeline

删除已被 /collect/* 取代的旧关键词采集路由（keyword-search/pending-keyword-tasks/
keyword-tasks/video-search-result/comment-score-result），acquisition_keyword_tasks
表保留不 drop（生产历史数据）。见 sprints/07181054-orphan-keyword-search-cleanup/。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Android 端轮询清理

**Files:**
- Delete: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/AcquisitionKeywordPollLoop.kt`
- Delete: `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/AcquisitionKeywordPollLoopTest.kt`
- Modify: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/AgentService.kt`

**AgentService.kt 里 4 处引用（已核实，逐一处理）：**

- [ ] **Step 1: 跑一遍 Android 测试，确认删除前基线通过**

Run: `cd services/agent-android && ./gradlew testDebugUnitTest --tests "com.zenithjoy.agent.*"`
Expected: BUILD SUCCESSFUL

- [ ] **Step 2: 删除字段声明（第 66 行）**

删除：
```kotlin
    private var keywordPollLoop: AcquisitionKeywordPollLoop? = null
```

- [ ] **Step 3: 删除 onDestroy() 里的 stop 调用（第 279 行）**

`onDestroy()` 函数里删除这一行：
```kotlin
        keywordPollLoop?.stop()
```
（`heartbeatLoop?.stop()` 和 `collectPollLoop?.stop()` 等其余行保留不动）

- [ ] **Step 4: 删除启动代码块（第 381-393 行）**

删除整段：
```kotlin
        // 关键词采集任务轮询（真实任务源 — 见 AcquisitionKeywordPollLoop 头部注释）
        keywordPollLoop = AcquisitionKeywordPollLoop(
            params = AcquisitionKeywordPollLoop.Params(
                httpBase = config.deriveHttpBase(),
                licenseKey = config.licenseKey,
            ),
            scope = scope,
            onTask = { task ->
                android.util.Log.i(TAG, "keyword task: id=${task.task_id} keyword=${task.keyword}")
                DouyinCollectService.dispatchTask(this@AgentService, task.keyword, task.task_id)
            },
        )
        keywordPollLoop?.start()
```
紧接着的空行 + `// reporter 使用最新 agentId（initAgent 之后才确定）` 注释和 `reporter = CollectReporter(...)` 块保留不动。

- [ ] **Step 5: 更新失去意义的注释（第 402 行附近）**

原文：
```kotlin
        // 两阶段采集任务轮询（Path 2 Step 5）
        // 与 keywordPollLoop 并行双跑，通过 collectTaskIds Set 在 onCollectResult 中区分路由
```
改为（`keywordPollLoop` 已不存在，第二行注释含义失效，删掉该行即可，保留第一行）：
```kotlin
        // 两阶段采集任务轮询（Path 2 Step 5）
```

- [ ] **Step 6: 删除 AcquisitionKeywordPollLoop.kt 和其测试文件**

```bash
git rm services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/AcquisitionKeywordPollLoop.kt
git rm services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/AcquisitionKeywordPollLoopTest.kt
```

- [ ] **Step 7: 确认零残留引用 + 编译通过**

Run: `grep -rn "AcquisitionKeywordPollLoop\|keywordPollLoop" services/agent-android/app/src`
Expected: 零输出

Run: `cd services/agent-android && ./gradlew compileDebugKotlin`
Expected: BUILD SUCCESSFUL

Run: `cd services/agent-android && ./gradlew testDebugUnitTest --tests "com.zenithjoy.agent.*"`
Expected: BUILD SUCCESSFUL

- [ ] **Step 8: Commit**

```bash
git add -A services/agent-android
git commit -m "refactor(agent-android): remove orphan AcquisitionKeywordPollLoop

安卓端两套采集轮询同时跑纯耗电，删除已被 AcquisitionCollectPollLoop 取代的旧轮询。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Windows 桌面 agent 轮询清理

**Files:**
- Modify: `services/agent/src/index.ts`
- Delete: `services/agent/src/handlers/keyword-search-douyin.ts`
- Delete: `services/agent/src/handlers/__tests__/keyword-search-douyin.test.ts`
- Delete: `services/agent/src/__tests__/acquisition-keyword-extract.test.ts`

**已核实**：`services/agent/modules/line02/index.ts`（脚本名叫 `keyword-search-douyin.cjs` 但轮询 `pending-collect-tasks`，走新链路）与本次删除对象无关，不要动它。`keyword-search-douyin.ts`（TS handler，将被删）只被 `index.ts` 里这一条旧循环调用，无其他消费者。

- [ ] **Step 1: 跑一遍现有测试，确认删除前基线全绿**

Run: `cd services/agent && npx vitest run`
Expected: 全部 PASS

- [ ] **Step 2: 删除 index.ts 里的 import（第 60 行）**

删除：
```typescript
import { searchDouyinVideosByKeyword } from './handlers/keyword-search-douyin';
```

- [ ] **Step 3: 删除启动调用（第 614-615 行）**

原文：
```typescript
  if (process.env.ZENITHJOY_DISABLE_ACQUISITION !== '1') {
    startAcquisitionKeywordLoop(cfg);
  }
```
整段删除（含 if 块本身；如果这个 if 块外层还有其他初始化逻辑共用同一个 if，先读一遍上下文确认删的是整个 if 块而不是误伤其他调用——已核实这个 if 块只包含这一行调用，可整段删）。

- [ ] **Step 4: 删除 startAcquisitionKeywordLoop 函数定义（第 1154-1260 行，即原 1154 起共 107 行）**

删除从 `function startAcquisitionKeywordLoop(cfg: AgentConfig): void {` 到其匹配的闭合 `}` 的整个函数体（已核实函数边界为 107 行，独立完整函数，不与其他函数交叉）。

- [ ] **Step 5: 确认零残留引用**

Run: `grep -n "startAcquisitionKeywordLoop\|searchDouyinVideosByKeyword" services/agent/src/index.ts`
Expected: 零输出

- [ ] **Step 6: 删除 handler 文件及其两个测试文件**

```bash
git rm services/agent/src/handlers/keyword-search-douyin.ts
git rm services/agent/src/handlers/__tests__/keyword-search-douyin.test.ts
git rm services/agent/src/__tests__/acquisition-keyword-extract.test.ts
```

- [ ] **Step 7: 跑测试 + 类型检查确认全绿**

Run: `cd services/agent && npx vitest run`
Expected: 全部 PASS，无编译错误

Run: `cd services/agent && npx tsc --noEmit`
Expected: 零错误

- [ ] **Step 8: Commit**

```bash
git add -A services/agent
git commit -m "refactor(agent): remove orphan startAcquisitionKeywordLoop

Windows 桌面端独立的旧关键词轮询，后端路由已删，此处对应清理。
line02 模块（新链路）不受影响。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: 前端设置页清理

**Files:**
- Modify: `apps/dashboard/src/pages/AcquisitionConfigPage.tsx`

**已核实边界**：
- 第 6 行 import：`useCallback`、`useRef` 删除后在文件里再无其他使用者（`KeywordsAndOpeningBlock` 组件不用它们），必须同步从 import 里去掉，否则 ESLint/TS 报未使用变量错
- `CollectTasksBlock`（第 350-486 行，含上方 `CollectTask` interface 和 `COLLECT_STATUS_LABEL` 常量）整个删除——尽管函数名叫 "CollectTasksBlock"，实际调用的是旧的 `/keyword-tasks` + `/keyword-search`，与新 `/collect/*` 链路无关，纯粹是命名混淆
- `KeywordsAndOpeningBlock`（第 305-348 行）**不要删**——这是"推荐关键词 + 开场白话术"展示组件，纯本地状态，不调用任何要删的旧接口，与本次清理无关

- [ ] **Step 1: 确认删除前构建通过**

Run: `cd apps/dashboard && npm run build`
Expected: 构建成功

- [ ] **Step 2: 修改 import（第 6 行）**

原文：
```typescript
import { useCallback, useEffect, useRef, useState } from 'react';
```
改为：
```typescript
import { useEffect, useState } from 'react';
```

- [ ] **Step 3: 删除 CollectTasksBlock 整块（第 350-486 行）**

删除从 `// ============ 采集任务块 ============` 注释开始，到 `CollectTasksBlock` 函数结尾 `}`（第 486 行）为止的整段，包含：
- `CollectTask` interface 定义
- `COLLECT_STATUS_LABEL` 常量
- `CollectTasksBlock` 函数本体

- [ ] **Step 4: 删除页面渲染里对它的引用（原第 500 行）**

`AcquisitionConfigPage` 组件的 return JSX 里删除这一行：
```tsx
      <CollectTasksBlock />
```
保留 `<TargetProfileDescBlock />`、`<KeywordsAndOpeningBlock />`、`<ConfigForm />` 不动。

- [ ] **Step 5: 确认零残留引用 + 构建通过**

Run: `grep -n "CollectTasksBlock\|keyword-tasks\|keyword-search\|useCallback\|useRef" apps/dashboard/src/pages/AcquisitionConfigPage.tsx`
Expected: 零输出

Run: `cd apps/dashboard && npm run build`
Expected: 构建成功，无 TS/ESLint 报错

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/pages/AcquisitionConfigPage.tsx
git commit -m "refactor(dashboard): remove orphan keyword-search input box

设置页里嵌的关键词采集框走的是已下线的旧接口，删除；
推荐关键词/开场白话术组件（KeywordsAndOpeningBlock）与此无关，保留不动。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: 全量验证

**Files:** 无新增修改，仅验证

- [ ] **Step 1: 全量跑后端测试**

Run: `cd apps/api && npx vitest run`
Expected: 全部 PASS

- [ ] **Step 2: 全量跑 Windows agent 测试**

Run: `cd services/agent && npx vitest run`
Expected: 全部 PASS

- [ ] **Step 3: 全量跑 Android 测试 + 编译**

Run: `cd services/agent-android && ./gradlew build -x lint`
Expected: BUILD SUCCESSFUL

- [ ] **Step 4: 全量构建前端**

Run: `cd apps/dashboard && npm run build`
Expected: 构建成功

- [ ] **Step 5: 全仓库交叉核验零残留**

Run: `grep -rn "acquisition_keyword_tasks\|AcquisitionKeywordPollLoop\|startAcquisitionKeywordLoop\|keyword-search-douyin" --include="*.ts" --include="*.tsx" --include="*.kt" apps/ services/ 2>/dev/null | grep -v "\.test\.\|__tests__"`
Expected: 零输出（`acquisition_keyword_tasks` 出现代表还有代码在读写这张已废弃的表，需回头排查）

- [ ] **Step 6: 若以上任一步暴露需要连带修复的问题，追加 commit-2**

若全部通过、无需修复，本任务无需额外 commit（4 个 Task 已各自 commit 完毕，均为纯删除，满足项目"先减肥再增肌"两段式约定——本次无"增肌"环节）。
