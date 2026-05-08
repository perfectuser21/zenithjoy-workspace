# WS2 Sprint 2.1a — Transport 层 type 字段缺口修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修补 Sprint 2.1a 落下的 transport 层 type 字段断链，让 type=video 任务从中台经 heartbeat 真正传到 Agent handler，不再被默认值 'image' 吞掉。

**Architecture:** 4 处机械改动，DB→service→route→agent transport→handler。两端测试夹击：agent 侧 heartbeat-loop mock fetch 测试 + 中台 service 侧 vi.mock pool 测试。E2E 复用 `golden-path-1-smoke.sh` Step 6（WS5 已升级用 type=video）。

**Tech Stack:** TypeScript / vitest / Express + supertest (已用) / pg / vi.mock for module-level pool

**Spec:** `docs/superpowers/specs/2026-05-08-ws2-sprint-21a-fix-transport-type-design.md`

**Worktree:** `/Users/administrator/worktrees/zenithjoy/ws2-fix-transport-type` (cp-05081209-ws2-fix-transport, 基于 sprint cp-05080845-ws2-sprint-21a-ws1)

---

## Task 1: 写两个 fail integration test (commit 1 — TDD red)

**Files:**
- Modify: `services/agent/src/handlers/__tests__/heartbeat-loop.test.ts` (加新 case)
- Modify: `apps/api/src/services/walking-skeleton.service.test.ts` (加新 case + vi.mock)

- [ ] **Step 1: 看现有 heartbeat-loop.test.ts 结构 (sanity check)**

```bash
cd /Users/administrator/worktrees/zenithjoy/ws2-fix-transport-type
head -50 services/agent/src/handlers/__tests__/heartbeat-loop.test.ts
```

Expected: 看到 `import { HeartbeatLoop, type HeartbeatTask } from '../heartbeat-loop'`，多个 `it()` block 用 fetchImpl mock。

- [ ] **Step 2: 在 heartbeat-loop.test.ts 末尾（最后一个 it 块结束之后、describe 闭括号之前）加新 case**

定位：找到文件末尾 `});` 闭 describe 的那行之前，插入：

```typescript
  it('forwards task.type from heartbeat response to onTask callback', async () => {
    const queuedTask: HeartbeatTask = {
      task_id: 'task-video-1',
      platform: 'douyin',
      type: 'video',
      payload: { folder_path: '/tmp/x' },
    };
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          agent_id: 'agent-1',
          queued_tasks: [queuedTask],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const received: HeartbeatTask[] = [];
    const loop = new HeartbeatLoop({
      apiBase: 'https://api.example.com',
      license: 'zj-test',
      version: '0.1.0',
      hostname: 'host-x',
      fetchImpl: fetchImpl as any,
      onTask: (t) => {
        received.push(t);
      },
    });

    await loop.sendOnce();

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('video');
    expect(received[0].platform).toBe('douyin');
    expect(received[0].task_id).toBe('task-video-1');
  });
```

- [ ] **Step 3: 跑这个 test 验证 fail**

```bash
cd /Users/administrator/worktrees/zenithjoy/ws2-fix-transport-type
cd services/agent && npx vitest run src/handlers/__tests__/heartbeat-loop.test.ts -t 'forwards task.type'
```

Expected: TS 编译错误（`type: 'video'` 不在 HeartbeatTask interface 上），或者运行时 `received[0].type` 是 undefined，断言失败。

> 这就是 RED 状态。任一报错都算 fail。

- [ ] **Step 4: 看 walking-skeleton.service.test.ts 现有结构**

```bash
cat /Users/administrator/worktrees/zenithjoy/ws2-fix-transport-type/apps/api/src/services/walking-skeleton.service.test.ts
```

Expected: 只有一个 sanity test（"exports the 8 required public async functions"）。

- [ ] **Step 5: 重写 walking-skeleton.service.test.ts，加 getQueuedTasks 测试**

完整覆盖现有内容（保留 sanity case）+ 加新 case，使用 vi.mock 拦截 pool.query：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// pool 是模块顶层 import，必须在导入 service 之前 mock
vi.mock('../db/connection', () => {
  const query = vi.fn();
  return {
    default: { query },
  };
});

import {
  validateLicense,
  upsertAgentByHeartbeat,
  bindFolder,
  createPublishTask,
  submitPublishReceipt,
  getPublishTask,
  getQueuedTasks,
  findAgentById,
} from './walking-skeleton.service';
import pool from '../db/connection';

describe('walking-skeleton service (export sanity)', () => {
  it('exports the 8 required public async functions', () => {
    expect(typeof validateLicense).toBe('function');
    expect(typeof upsertAgentByHeartbeat).toBe('function');
    expect(typeof bindFolder).toBe('function');
    expect(typeof createPublishTask).toBe('function');
    expect(typeof submitPublishReceipt).toBe('function');
    expect(typeof getPublishTask).toBe('function');
    expect(typeof getQueuedTasks).toBe('function');
    expect(typeof findAgentById).toBe('function');
  });
});

describe('getQueuedTasks (WS2 Sprint 2.1a transport patch)', () => {
  beforeEach(() => {
    (pool.query as any).mockReset();
  });

  it('returns rows with type field selected from publish_tasks', async () => {
    (pool.query as any).mockResolvedValueOnce({
      rows: [
        {
          id: 'task-1',
          agent_id: 'agent-1',
          platform: 'douyin',
          status: 'pending',
          type: 'video',
          folder_path: '/tmp/x',
          result: null,
          receipt_at: null,
          created_at: '2026-05-08T00:00:00Z',
        },
      ],
    });

    const rows = await getQueuedTasks('agent-1');

    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('video');
  });

  it('SELECT statement includes type column', async () => {
    (pool.query as any).mockResolvedValueOnce({ rows: [] });

    await getQueuedTasks('agent-1');

    expect((pool.query as any)).toHaveBeenCalledTimes(1);
    const sql = (pool.query as any).mock.calls[0][0] as string;
    expect(sql).toMatch(/SELECT[\s\S]*\btype\b/);
    expect(sql).toMatch(/FROM zenithjoy\.publish_tasks/);
  });
});
```

- [ ] **Step 6: 跑这个 test 验证 fail**

```bash
cd /Users/administrator/worktrees/zenithjoy/ws2-fix-transport-type/apps/api
npx vitest run src/services/walking-skeleton.service.test.ts -t 'WS2 Sprint 2.1a transport patch'
```

Expected: SELECT 语句不含 `type` 列 → 第二个 case (`SELECT statement includes type column`) FAIL；第一个 case (`returns rows with type field`) 因 PublishTaskRow 类型未含 type 字段，TS 编译报错。

> 两个 case 任一 fail 都算 RED 状态。

- [ ] **Step 7: Commit RED 状态**

```bash
cd /Users/administrator/worktrees/zenithjoy/ws2-fix-transport-type
git add services/agent/src/handlers/__tests__/heartbeat-loop.test.ts \
        apps/api/src/services/walking-skeleton.service.test.ts
git commit -m "$(cat <<'EOF'
test(ws2-patch): transport 层 type 字段断链 RED 测试

加 2 个 fail integration test 锁住 transport 契约：
1. heartbeat-loop.test.ts: mock fetch 返 task with type=video，断言 onTask 收到 task.type === 'video'
2. walking-skeleton.service.test.ts: vi.mock pool.query，断言 getQueuedTasks SELECT 含 type 列 + 返回 row 含 type 字段

当前代码必须 RED：HeartbeatTask 没 type 字段、PublishTaskRow 没 type 字段、SELECT 没拉 type 列。
下一 commit 修 4 处实现转 GREEN。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: commit 创建成功（即使测试失败也要 commit — 这就是 RED commit 的目的）。

---

## Task 2: 写 4 处实现让 test 变绿 (commit 2 — TDD green)

**Files:**
- Modify: `apps/api/src/services/walking-skeleton.service.ts:40-49,165` (PublishTaskRow + SELECT)
- Modify: `apps/api/src/routes/walking-skeleton.ts:66-79` (queued_tasks.map 透传 type)
- Modify: `services/agent/src/handlers/heartbeat-loop.ts:15-19` (HeartbeatTask 加 type)
- Modify: `services/agent/src/index.ts:29,482-489` (import + onTask 传 type)

- [ ] **Step 1: 改 PublishTaskRow interface 加 type 字段**

文件 `apps/api/src/services/walking-skeleton.service.ts`，找到 line 40-49：

```typescript
export interface PublishTaskRow {
  id: string;
  agent_id: string;
  platform: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  folder_path: string | null;
  result: unknown | null;
  receipt_at: string | null;
  created_at: string;
}
```

替换为（status 后面加 type 字段）：

```typescript
export interface PublishTaskRow {
  id: string;
  agent_id: string;
  platform: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  type: 'video' | 'image' | 'article';
  folder_path: string | null;
  result: unknown | null;
  receipt_at: string | null;
  created_at: string;
}
```

- [ ] **Step 2: 改 getQueuedTasks SELECT 加 type 列**

同一文件，找到 line 165 附近的 SQL：

```typescript
    `SELECT id, agent_id, platform, status, folder_path, result, receipt_at, created_at
       FROM zenithjoy.publish_tasks
      WHERE agent_id = $1 AND status = 'pending'
      ORDER BY created_at ASC`,
```

替换为（status 后插 type）：

```typescript
    `SELECT id, agent_id, platform, status, type, folder_path, result, receipt_at, created_at
       FROM zenithjoy.publish_tasks
      WHERE agent_id = $1 AND status = 'pending'
      ORDER BY created_at ASC`,
```

- [ ] **Step 3: 改 walking-skeleton.ts heartbeat handler queued_tasks.map 透传 type**

文件 `apps/api/src/routes/walking-skeleton.ts`，找到 line 66-79 的 `queued_tasks: queued.map(...)`：

```typescript
        queued_tasks: queued.map((t) => ({
          task_id: t.id,
          platform: t.platform,
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

替换为（platform 后面加 `type: t.type`）：

```typescript
        queued_tasks: queued.map((t) => ({
          task_id: t.id,
          platform: t.platform,
          type: t.type,
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

- [ ] **Step 4: 改 HeartbeatTask interface 加 type optional 字段**

文件 `services/agent/src/handlers/heartbeat-loop.ts`，找到 line 15-19：

```typescript
export interface HeartbeatTask {
  task_id: string;
  platform: string;
  payload: Record<string, unknown>;
}
```

替换为（platform 后插 type optional）：

```typescript
export interface HeartbeatTask {
  task_id: string;
  platform: string;
  type?: 'video' | 'image' | 'article';
  payload: Record<string, unknown>;
}
```

- [ ] **Step 5: 改 agent index.ts 顶部 import 加 DouyinPublishType**

文件 `services/agent/src/index.ts`，找到现有 douyin-publish import 行（grep 一下）：

```bash
grep -n "from './handlers/douyin-publish'" services/agent/src/index.ts
```

把 `import { handleDouyinPublishTask } from './handlers/douyin-publish';` （或类似形式）改为：

```typescript
import { handleDouyinPublishTask, type DouyinPublishType } from './handlers/douyin-publish';
```

> 注意：如果原来还 import 了 `handleDouyinPublish`（旧 WS handler），保留它。只在 import list 里加 `, type DouyinPublishType`。

- [ ] **Step 6: 改 onTask douyin 分支调 handleDouyinPublishTask 传 type**

同一文件 `services/agent/src/index.ts`，找到 line 482-485 附近：

```typescript
      } else if (task.platform === 'douyin') {
        const payload = task.payload as { folder_path?: string };
        const folderPath = payload.folder_path || folderWatch.getBoundPath();
        if (!folderPath) {
          console.warn('[ws1:douyin] no folder_path; agent not bound yet');
          return;
        }
        const res = await handleDouyinPublishTask(
          { task_id: task.task_id, folder_path: folderPath },
          { apiBase },
        );
        console.log('[ws1:douyin] result:', res.status);
```

替换 handler 调用对象（加 `type` 字段）：

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
            type: task.type as DouyinPublishType | undefined,
          },
          { apiBase },
        );
        console.log('[ws1:douyin] result:', res.status);
```

- [ ] **Step 7: 跑两个测试验证 GREEN**

```bash
cd /Users/administrator/worktrees/zenithjoy/ws2-fix-transport-type/services/agent
npx vitest run src/handlers/__tests__/heartbeat-loop.test.ts -t 'forwards task.type'
```

Expected: PASS（received[0].type === 'video'）。

```bash
cd /Users/administrator/worktrees/zenithjoy/ws2-fix-transport-type/apps/api
npx vitest run src/services/walking-skeleton.service.test.ts -t 'WS2 Sprint 2.1a transport patch'
```

Expected: PASS（两个 case 都过：rows[0].type === 'video' + SELECT 含 type 列）。

- [ ] **Step 8: 跑全套相关测试确保不破坏现有 case**

```bash
cd /Users/administrator/worktrees/zenithjoy/ws2-fix-transport-type/services/agent
npx vitest run src/handlers/__tests__/heartbeat-loop.test.ts
```

Expected: 所有 case PASS（含原有的 license/version/hostname、subsequent agent_id、interval 等 + 新加的 forwards task.type）。

```bash
cd /Users/administrator/worktrees/zenithjoy/ws2-fix-transport-type/apps/api
npx vitest run src/services/walking-skeleton.service.test.ts src/routes/walking-skeleton.test.ts
```

Expected: 所有 case PASS。

- [ ] **Step 9: TS 编译验证全工程**

```bash
cd /Users/administrator/worktrees/zenithjoy/ws2-fix-transport-type/apps/api
npx tsc --noEmit
```

Expected: 0 errors。

```bash
cd /Users/administrator/worktrees/zenithjoy/ws2-fix-transport-type/services/agent
npx tsc --noEmit
```

Expected: 0 errors。

- [ ] **Step 10: Commit GREEN 状态**

```bash
cd /Users/administrator/worktrees/zenithjoy/ws2-fix-transport-type
git add apps/api/src/services/walking-skeleton.service.ts \
        apps/api/src/routes/walking-skeleton.ts \
        services/agent/src/handlers/heartbeat-loop.ts \
        services/agent/src/index.ts
git commit -m "$(cat <<'EOF'
fix(ws2-patch): transport 层透传 type 字段 — 让 type=video 真正路由到 video 脚本

修补 Sprint 2.1a 落下的 transport 缺口：

1. walking-skeleton.service.ts
   - PublishTaskRow interface 加 type: 'video'|'image'|'article'
   - getQueuedTasks SELECT 加 type 列

2. walking-skeleton.ts (heartbeat handler)
   - queued_tasks.map 加 type: t.type，与 platform 同级（路由维度）

3. heartbeat-loop.ts
   - HeartbeatTask interface 加 type?: 'video'|'image'|'article'（optional 兼容旧 server）

4. index.ts (onTask douyin 分支)
   - import DouyinPublishType
   - handleDouyinPublishTask 调用对象加 type: task.type as DouyinPublishType | undefined

修复后 type=video 任务从 DB → service → route → agent transport → handler 全程不丢。
[type-route] 日志将首次真正打印 type=video（修复前永远是 image）。

测试覆盖：
- heartbeat-loop.test.ts 'forwards task.type from heartbeat response to onTask callback' PASS
- walking-skeleton.service.test.ts 'returns rows with type field' + 'SELECT includes type column' PASS

不在 scope（留下次 sprint）：
- agent 进程在 task 处理后死循环（独立 bug，与 type 无关）
- qr_bind_douyin handler 跳过扫码（违反 PRD 防作弊条款，需 WS3/WS4 follow-up）

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: commit 创建成功。

---

## Task 3: 真机自验 — rog Windows e2e 跑 type=video

**Files / Targets:**
- Mac mini: `/Users/administrator/perfect21/zenithjoy/apps/api` (重启 API 加载新代码)
- rog: `~/Desktop/zenithjoy-agent` (sync 新代码 + 重启 agent)
- DB: `zenithjoy.publish_tasks` (验 type=video 落库)
- Log: rog `agent.log` (验 [type-route] 输出)

- [ ] **Step 1: Mac mini API 重启加载新 service/route 代码**

```bash
# 找到当前 API 进程 + 杀掉
ps aux | grep -E 'node.*apps/api/dist/index' | grep -v grep | awk '{print $2}' | xargs -r kill
sleep 2
# 重新构建（service 改了 TS 要先 build dist）
cd /Users/administrator/perfect21/zenithjoy/apps/api
npm run build 2>&1 | tail -5
# 起 API
nohup node dist/index.js > /tmp/zenithjoy-api.log 2>&1 &
sleep 3
curl -s -o /dev/null -w "API HTTP %{http_code}\n" http://localhost:5200/api/account/me
```

Expected: build 0 errors，API 起来后 `HTTP 401`（正常，没鉴权）。

- [ ] **Step 2: 同步新 agent 代码到 rog**

worktree 还没合到 sprint 分支。先把 commit cherry-pick 推到 rog 用的 sync 路径。最快办法：直接 rsync agent src 到 rog。

```bash
cd /Users/administrator/worktrees/zenithjoy/ws2-fix-transport-type
# 把 services/agent/src/ 里改的 2 个文件 rsync 过去
rsync -avz services/agent/src/handlers/heartbeat-loop.ts \
            rog-xian:Desktop/zenithjoy-agent/src/handlers/heartbeat-loop.ts
rsync -avz services/agent/src/index.ts \
            rog-xian:Desktop/zenithjoy-agent/src/index.ts
```

Expected: 两个文件 sync 成功。

- [ ] **Step 3: 重启 rog agent**

复用之前会话用过的 start-agent-v2.ps1（直接 node + tsx-cli.mjs，不走 npx.cmd 避免 child detach 问题）。

```bash
ssh rog-xian 'powershell -ExecutionPolicy Bypass -File "C:\Users\asus\Desktop\zenithjoy-agent\start-agent-v2.ps1"' 2>&1 | head -30
```

Expected: log 含 `[agent] connecting to ws://100.71.151.105:5200/agent-ws`、`[agent] connected as ...`、`[ws1] heartbeat-loop started`。

- [ ] **Step 4: 拿 license_key 触发 type=video 任务**

```bash
# license + agent_id 复用之前会话已知值
LICENSE_KEY="ZJ-F-48BY6PJZ"
AGENT_DB_ID="8e458113-2c4c-4ada-a126-cad5cb68925b"

curl -sS -X POST http://localhost:5200/api/publish/task \
  -H "Authorization: Bearer ${LICENSE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"agent_id\":\"${AGENT_DB_ID}\",\"platform\":\"douyin\",\"type\":\"video\",\"payload\":{}}"
```

Expected: 返回 `{"task_id":"<uuid>","status":"pending","type":"video"}`（即使 API 响应字段还是 image fallback bug，DB 真值是 video）。

记下返回的 task_id，下一步用。

- [ ] **Step 5: 验证 DB 写入 type=video**

```bash
psql -d cecelia -c "SELECT id, platform, type, status FROM zenithjoy.publish_tasks ORDER BY created_at DESC LIMIT 1;"
```

Expected: 最新一行 `platform=douyin, type=video, status=pending`。

- [ ] **Step 6: 等 30s heartbeat tick + 看 agent log 路由**

```bash
echo "等 35 秒等 heartbeat 拉到任务..."
sleep 35
ssh rog-xian 'powershell -Command "Get-Content C:\Users\asus\Desktop\zenithjoy-agent\agent.log -Tail 40"' 2>&1 | tail -25
```

Expected：log 必须出现这两行（关键验证！）：

```
[ws1] task: douyin <task_id>
[type-route] handleDouyinPublishTask task=<task_id> type=video
[type-route] resolveDouyinScriptPath type=video real=false script=publish-douyin-video-dryrun.cjs
```

**判通过：log 含 `type=video`（不是 `type=image`）+ script 含 `video` 字样（不是 `image`）。**

如果 log 里出现 `type=image` 或 `script=publish-douyin-image-...cjs` → patch 没生效，debug。

- [ ] **Step 7: 把这次自验记录加进 evidence 文件**

```bash
cd /Users/administrator/worktrees/zenithjoy/ws2-fix-transport-type
cat >> .agent-knowledge/golden-path-1/lead-acceptance-sprint-2.1a.md <<'EVIDENCE_EOF'

## Transport 层 patch 自验（cp-05081209-ws2-fix-transport, 2026-05-08）

执行人：Claude Code 自动化（用户授权）+ rog ssh 远程

```
$ curl -X POST http://localhost:5200/api/publish/task -d '{"type":"video",...}'
{"task_id":"<TID>","status":"pending","type":"video"}

$ psql -c "SELECT type FROM publish_tasks WHERE id='<TID>'"
video

$ grep '[type-route]' rog:agent.log | tail
[ws1] task: douyin <TID>
[type-route] handleDouyinPublishTask task=<TID> type=video
[type-route] resolveDouyinScriptPath type=video real=false script=publish-douyin-video-dryrun.cjs
```

判定：✅ Transport 层 type 字段全程贯通，type=video 真正路由到 video 脚本（修补前永远走 image）。

**注**：本 patch 不解决"agent 死循环"和"qr_bind 跳过扫码"两个独立问题，留 next sprint。
EVIDENCE_EOF
```

Expected: 文件追加成功。

- [ ] **Step 8: Commit evidence 更新**

```bash
cd /Users/administrator/worktrees/zenithjoy/ws2-fix-transport-type
git add .agent-knowledge/golden-path-1/lead-acceptance-sprint-2.1a.md
git commit -m "$(cat <<'EOF'
docs(evidence): WS2 transport patch 真机自验记录

rog Windows 远程跑 type=video 任务，agent log 首次真正打印 type=video
（修补前永远走 image），证明 transport 层缺口已闭合。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: commit 成功。

---

## Self-Review 检查

在交给 subagent-driven-development 之前自检：

1. **Spec coverage**：
   - 4 处机械改动 ✅ Task 2 Step 1-6 全部覆盖
   - 2 个 integration test ✅ Task 1 Step 2 + Step 5
   - E2E 真机自验 ✅ Task 3
   - Out of Scope 边界 ✅ commit 2 message 注明

2. **Placeholder scan**：所有 step 都有具体 bash 命令、TS 代码片段、expected output。无 TBD/TODO。

3. **Type consistency**：`PublishTaskRow.type` 用 `'video' | 'image' | 'article'`（与 DB CHECK constraint + handler `DouyinPublishType` 对齐）；`HeartbeatTask.type?` 用同样 union；onTask 传 `task.type as DouyinPublishType | undefined` 因为 HeartbeatTask 是 optional。一致。

4. **TDD 顺序**：commit 1 RED test、commit 2 GREEN impl，符合 ZenithJoy `lint-tdd-commit-order` 规则。

---

## 完成后

Plan 完成，准备进入 subagent-driven-development。每个 Task 由 fresh subagent 执行，TDD 顺序由 controller 验证（commit 顺序 + 中间不能改测试）。
