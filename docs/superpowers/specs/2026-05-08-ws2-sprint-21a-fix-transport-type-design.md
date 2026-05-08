# WS2 Sprint 2.1a — Transport 层 type 字段缺口修复 Design Spec

- 日期: 2026-05-08
- 分支: `cp-05081209-ws2-fix-transport`
- 父 Sprint: 2.1a (cp-05080845-ws2-sprint-21a-ws1)
- 类型: P0 bug patch — 不是新功能
- Journey: Path 1 客户首次成功 / Step 6 (中台派任务 + dryrun 发布 + 回执)
- Thickness 变化: 无（保持 thin / 修补现有链路）

---

## 1. Background — 为什么这个 patch 必须做

Sprint 2.1a 的目标是给 publish_tasks 引入 `type` 字段（`'video' | 'image' | 'article'`），让 Agent 按 type spawn 对应的 douyin 发布脚本（`publish-douyin-video.cjs` / `publish-douyin-image.cjs` / `publish-douyin-article.cjs`）。已落地的部分：

| 环节 | 落地情况 |
|---|---|
| DB schema 加 `publish_tasks.type` 列 | OK |
| `POST /api/publish/task` 接 `type` 参数写入 DB | OK |
| `handleDouyinPublishTask` 接 `payload.type` 选脚本 + 打 `[type-route]` 日志 | OK (douyin-publish.ts:343-358) |
| WS5 `golden-path-1-smoke.sh` Step 6 升级用 `type=video` | OK |

**遗漏的环节（本 patch 修补）**：DB 写入 `type` 列后，从 DB 到 handler 之间的 transport 链路完全没传 `type`：

```
DB (type=video) ── ❌ ── 中台 heartbeat handler ── ❌ ── Agent onTask ── ❌ ── handleDouyinPublishTask
                       (queued_tasks 没带 type)   (HeartbeatTask 没字段)   (永远收不到 type)
                                                                            ↓
                                                                            payload.type 永远 undefined
                                                                            → 永远走 'image' 默认值
                                                                            → 永远跑 publish-douyin-image.cjs
```

结果：客户在 Dashboard 选择"发视频"，DB 写入 `type=video`，但 Agent 实际跑的是图文脚本。Smoke Step 6 期望看到 `[type-route] type=video` 但实际只能看到 `type=image` —— 这是 P0 bug，type 路由实际上从未生效。

修补完成的判据：客户机 rog 跑 type=video 任务时，Agent 日志出现 `[type-route] handleDouyinPublishTask task=... type=video`（不是 image）。

---

## 2. Scope — 4 处机械改动

全部 4 处都在 `/Users/administrator/worktrees/zenithjoy/ws2-fix-transport-type/`。

### 2.1 中台 service 层：返回 type 列

**文件**: `apps/api/src/services/walking-skeleton.service.ts`

**改动 A — 给 `PublishTaskRow` interface 加 `type` 字段**（line 40-49）

```typescript
export interface PublishTaskRow {
  id: string;
  agent_id: string;
  platform: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  type: 'video' | 'image' | 'article';  // 新增
  folder_path: string | null;
  result: unknown | null;
  receipt_at: string | null;
  created_at: string;
}
```

**改动 B — `getQueuedTasks` SELECT 加 `type` 列**（line 165）

```typescript
`SELECT id, agent_id, platform, status, type, folder_path, result, receipt_at, created_at
   FROM zenithjoy.publish_tasks
  WHERE agent_id = $1 AND status = 'pending'
  ORDER BY created_at ASC`,
```

> 备注：DB 列已存在（Sprint 2.1a 的 migration 加了），这里只是 SELECT 把它捞出来。

### 2.2 中台 route 层：heartbeat response 透传 type

**文件**: `apps/api/src/routes/walking-skeleton.ts` (line 66-79)

`queued_tasks.map((t) => ({ ... }))` 里加一个 `type` 字段：

```typescript
queued_tasks: queued.map((t) => ({
  task_id: t.id,
  platform: t.platform,
  type: t.type,                            // 新增 — 给 agent 路由用
  payload: {
    local_path: t.folder_path,
    folder_path: t.folder_path,
    account_label: 'default',
  },
  // legacy fields kept for any older agent client
  id: t.id,
  status: t.status,
  folder_path: t.folder_path,
  created_at: t.created_at,
})),
```

> 设计取舍：放在 task 顶层（不是 payload 内），与 `platform` 同级 —— `type` 是路由维度（"哪个发布脚本"），与 `platform`（"哪个平台"）一样属于"派工单元数据"，不是 payload 内容。同时方便后续 platform=kuaishou 等也能复用同一字段。

### 2.3 Agent 接收侧：HeartbeatTask 加 type 可选字段

**文件**: `services/agent/src/handlers/heartbeat-loop.ts` (line 15-19)

```typescript
export interface HeartbeatTask {
  task_id: string;
  platform: string;
  type?: 'video' | 'image' | 'article';   // 新增 — 中台可能下发，旧 agent 默认 undefined → handler 兜底 image
  payload: Record<string, unknown>;
}
```

> 取 optional 是为兼容：如果 agent 升级了但中台还没升级（rolling deploy 窗口），type 可能不在 response 里 —— optional 保证不挂；handler 一侧已经有 `payload.type ?? 'image'` 兜底。

### 2.4 Agent index.ts onTask：把 type 传给 handler

**文件**: `services/agent/src/index.ts`

**改动 A — 顶部 import 加 `DouyinPublishType` 类型**（line 29 附近）

```typescript
import { handleDouyinPublishTask, type DouyinPublishType } from './handlers/douyin-publish';
```

> `DouyinPublishType` 已经从 douyin-publish.ts:47 export，这里只是显式 import 类型给 cast 用。

**改动 B — onTask douyin 分支调用 handler 时传 type**（line 482-485）

```typescript
} else if (task.platform === 'douyin') {
  const payload = task.payload as { folder_path?: string };
  const folderPath = payload.folder_path || folderWatch.getBoundPath();
  if (!folderPath) {
    console.warn('[ws1:douyin] no folder_path; agent not bound yet');
    return;
  }
  const res = await handleDouyinPublishTask(
    {
      task_id: task.task_id,
      folder_path: folderPath,
      type: task.type as DouyinPublishType | undefined,   // 新增 — 透传给 handler 选脚本
    },
    { apiBase },
  );
  console.log('[ws1:douyin] result:', res.status);
}
```

> handler 端 `DouyinPublishTaskPayload.type` 已经是 optional（douyin-publish.ts:248-253），handler 内 `payload.type ?? 'image'` 已经兜底。

---

## 3. 测试策略（4 档分类）

### 3.1 Integration test（新增 — 这次必须写）

**Test 1**: `apps/api/src/routes/walking-skeleton.test.ts`（已存在，加 case）

新增 case：用 supertest mock + DB stub（或 mock `getQueuedTasks` 返回 `[{ id, type: 'video', ... }]`），POST `/api/agent/heartbeat`，断言 response.body.queued_tasks[0].type === 'video'。

> 备注：现存 walking-skeleton.test.ts 只是 router export sanity（line 4-12），需要从 sanity 升级到带 mock 的端点测试。如果改动太大，退化方案：在 service 层 `walking-skeleton.service.test.ts` 加 unit test，断言 `getQueuedTasks` 返回的对象包含 `type` 字段（mock pool.query 返 type=video 行）。**首选 route 层 integration**，因为 bug 就发生在 route 层 `.map` 里。

**Test 2**: `services/agent/src/handlers/__tests__/heartbeat-loop.test.ts`（已存在，加 case）

新增 case："heartbeat response carrying task.type is forwarded to onTask"：mock fetchImpl 返回 `{ ok:true, agent_id:'a1', queued_tasks:[{ task_id:'t1', platform:'douyin', type:'video', payload:{} }] }`，断言 onTask 被调用时收到的 task 对象 `task.type === 'video'`。

> 这条测试是核心 — 它直接覆盖"transport 不丢 type"的契约。

### 3.2 E2E test（已存在，无需改）

`.github/workflows/scripts/smoke/golden-path-1-smoke.sh` Step 6（WS5 升级了用 `type=video` 创建 task）。本 patch 通过判据：

1. smoke 脚本里 POST `/api/publish/task` 带 `type=video`
2. Agent 日志出现 `[type-route] handleDouyinPublishTask task=... type=video`
3. Step 6 PASS

> 当前 Sprint 2.1a 没修 transport 层时，Step 6 看到的是 `type=image`（即使 DB 是 video）。修完后 smoke Step 6 应该能首次真正打印 `type=video`。

### 3.3 Unit test（不需要新增）

- `PublishTaskRow.type` 加字段：纯 typing 改动，TS 编译通过即覆盖。
- `HeartbeatTask.type?` 加 optional 字段：纯 typing 改动，TS 编译通过即覆盖。
- service `getQueuedTasks` SELECT 加列：是 SQL 字符串字面量改动，pool 真跑或 integration test 覆盖即可，不另建 unit。
- index.ts onTask 加 `type:` 透传：路由分支没新增、没分支条件，由 heartbeat-loop integration test 间接覆盖。

> 原则：typing-only 改动不写"重复 TS 编译器工作"的 unit test。

### 3.4 真机自验（Lead 客户机）

机器：rog (Windows)，按 `lead_acceptance_machines.md` 是 WS2/agent 类 sprint 的指定自验机。

步骤：
1. rog 拉最新 agent build (修完后)
2. 中台用 license 创建 type=video task（folder_path 指向含 .mp4 的目录）
3. agent log 必出 `[type-route] handleDouyinPublishTask task=... type=video`
4. agent 实际 spawn 的脚本是 `publish-douyin-video.cjs`（不是 image.cjs）

通过判据：步骤 3 + 步骤 4 同时满足。失败现象（修复前的状态）：log 打印 `type=image`。

---

## 4. Out of Scope — 留给下个 sprint

明确不在本 patch 内修，避免 scope creep：

1. **Agent 死循环**：当前 onTask 收到不认识的 platform 不会 ack，中台一直发，agent 一直收。这是独立 bug（与 type 无关），需要 ack/dedup 机制设计。
2. **qr_bind_douyin 跳过扫码**：扫码绑定流程在某些 cookie 状态下会跳过弹窗，导致绑定状态不刷新。这是 WS3/WS4 范围的 follow-up。
3. **任何架构 refactor**：不动 onTask 路由结构、不抽公共 dispatch、不挪 douyin-publish.ts。
4. **其他 platform 的 type 路由**：本 patch 只修 douyin 链路。kuaishou/wechat/etc 现在都是单脚本，不需要 type 维度，将来要做时另开 sprint。

---

## 5. Walking Skeleton 4 问回答

```
1. 推进哪条 Journey?
   Path 1 客户首次成功 (Notion 358c40c2ba6381b2a6eacd288cf82f29)
   当前 Maturity: not_started → 修完此 patch 才算 Step 6 真正"通"

2. 涉及几个角色?
   单 sprint：中台 (apps/api) + Agent (services/agent) — 同链路上下游，不算多角色
   不涉及 CI/部署/dashboard 角色

3. 推进哪些 Feature?
   Step 6 "中台派任务 + dryrun 发布 + 回执" — thin → thin（不加厚）
   只是修 thin 实现里的 transport bug，不动 thickness

4. Feature 0 端到端 smoke = golden-path-1-smoke.sh 跑到 Step <K>?
   K = 6 (Step 6 必须 PASS, 且 agent log 真打印 type=video)
   FAIL = 整 sprint FAIL
```

---

## 6. 实施顺序（commit 序列建议）

按 ZenithJoy E2E-first + TDD 双 commit 纪律：

- **commit 1 (test red)**: 写 `heartbeat-loop.test.ts` + `walking-skeleton.test.ts` 两个 integration test，跑当前代码必须 FAIL（type 字段拿不到）。
- **commit 2 (impl green)**: 4 处机械改动一起落，跑测试 PASS。

> 因为是修补现有 thin 链路的 transport bug，不是新 feature，不强制额外的 smoke.sh —— 复用 golden-path-1-smoke.sh Step 6 即可（CI 已有）。

---

## 7. 风险与回滚

- **风险 1**：现有 agent client（旧版本，未升级）在 type 字段下发后能否兼容？  
  **答**：能。HeartbeatTask.type 是 optional，旧 agent 解 JSON 时多余字段会被 TS 忽略 / JS 直接落入对象但不读，不会挂。
- **风险 2**：DB type 列旧数据为 NULL 怎么办？  
  **答**：Sprint 2.1a 的 migration 已设默认值 `'image'`（兼容旧任务）；新代码走 `t.type` 拿到 `'image'` → 等同当前行为。
- **回滚**：单 commit revert 即可；DB 列保留不影响旧 agent。

---

## APPROVED — 准备进入 writing-plans 阶段
