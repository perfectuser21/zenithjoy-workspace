# 采集失败原始错误码留证 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 当 `normalizeCollectErrorCode()` 把安卓端传来的未知错误码降级为 `UNKNOWN` 时，把降级前的原始值持久化进 `acquisition_collect_tasks.checkpoint` JSONB 列，供事后排查；此前只有 `console.warn` 打印，随进程/容器重启丢失。

**Architecture:** 纯服务端改动，两个独立的 UPDATE 语句（`/collect/report-videos` 和 `/collect/report`）分别在各自已有的 normalize-降级判断分支旁追加"写 checkpoint"逻辑，不改分类算法、不改客户端。

**Tech Stack:** TypeScript / Express / vitest / supertest，仓库 `apps/api`。

---

### Task 1: `/collect/report-videos` 端点落原始错误码

**Files:**
- Modify: `apps/api/src/routes/acquisition.ts:880-899`
- Test: `apps/api/src/routes/acquisition.test.ts`（追加到已有的 `describe('POST /api/acquisition/collect/report-videos — Stage1 清单回报 [BEHAVIOR]', ...)` 块内，紧跟在第 953-963 行"error_code 不在五分类枚举里时"那条测试后面）

- [ ] **Step 1: 写 failing test**

在 `apps/api/src/routes/acquisition.test.ts` 里，找到这条已有测试（约第 953-963 行）：

```ts
  it('error_code 不在五分类枚举里时，落库前归一为 UNKNOWN（防御未来 Android 版本传入新值）', async () => {
    const res = await request(app).post('/api/acquisition/collect/report-videos')
      .set('x-agent-id', 'agent-1')
      .send({ task_id: TASK_ID, videos: [], reason: { error_code: 'SOME_BRAND_NEW_CODE' } });
    expect(res.status).toBe(200);
    const updateCall = mockClientQuery.mock.calls.find((c) => String(c[0]).trim().startsWith('UPDATE zenithjoy.acquisition_collect_tasks'));
    expect(updateCall).toBeDefined();
    expect((updateCall as any)[1][2]).toBe('UNKNOWN');
  });
```

紧跟在它后面追加两条新测试：

```ts
  it('error_code 不在五分类枚举里时，原始值必须持久化进 checkpoint.raw_error_code', async () => {
    const res = await request(app).post('/api/acquisition/collect/report-videos')
      .set('x-agent-id', 'agent-1')
      .send({ task_id: TASK_ID, videos: [], reason: { error_code: 'ALL_SHARE_FAILED' } });
    expect(res.status).toBe(200);
    const updateCall = mockClientQuery.mock.calls.find((c) => String(c[0]).trim().startsWith('UPDATE zenithjoy.acquisition_collect_tasks'));
    expect(updateCall).toBeDefined();
    const params = (updateCall as any)[1];
    expect(params[2]).toBe('UNKNOWN');
    expect(params[3]).toBe(JSON.stringify({ raw_error_code: 'ALL_SHARE_FAILED' }));
  });

  it('error_code 已经是合法五分类值时，不写 checkpoint（保持改动前行为）', async () => {
    const res = await request(app).post('/api/acquisition/collect/report-videos')
      .set('x-agent-id', 'agent-1')
      .send({ task_id: TASK_ID, videos: [], reason: { error_code: 'NETWORK_ERROR' } });
    expect(res.status).toBe(200);
    const updateCall = mockClientQuery.mock.calls.find((c) => String(c[0]).trim().startsWith('UPDATE zenithjoy.acquisition_collect_tasks'));
    const params = (updateCall as any)[1];
    expect(params[2]).toBe('NETWORK_ERROR');
    expect(params[3]).toBeNull();
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && npx vitest run src/routes/acquisition.test.ts -t "raw_error_code"`
Expected: 两条新测试 FAIL——`params[3]` 现在是 `undefined`（UPDATE 语句参数数组目前只有 3 项），不是期望的 `JSON.stringify(...)` 或 `null`。

- [ ] **Step 3: 实现最小改动**

打开 `apps/api/src/routes/acquisition.ts`，定位这段代码（约 880-899 行）：

```ts
      const failCode = rawFailCode === 'ALL_RESOLVE_FAILED'
        ? 'PLATFORM_LIMITED'
        : normalizeCollectErrorCode(rawFailCode);
      if (failCode === 'UNKNOWN' && rawFailCode !== 'UNKNOWN') {
        console.warn(`[acquisition] collect/report-videos error_code 归一为 UNKNOWN，原始值：task=${taskId} raw=${rawFailCode}`);
      }
      const s = settleCollectTask({
        currentStatus: task.status === 'pending' ? 'running' : task.status,
        agentTerminal: searchEmpty
          ? { terminal: 'partial', partial_reason: 'stage1_empty' }
          : { terminal: 'failed', error_code: failCode },
        videoTotal: 0,
        videoDone: 0,
        leadCount: task.lead_count_raw,
      });
      await client.query(
        `UPDATE zenithjoy.acquisition_collect_tasks
            SET status = $2, error_code = $3, started_at = COALESCE(started_at, NOW()),
                ended_at = NOW(), updated_at = NOW()
          WHERE id = $1`,
        [taskId, s.status, s.error_code]
      );
```

改成：

```ts
      const failCode = rawFailCode === 'ALL_RESOLVE_FAILED'
        ? 'PLATFORM_LIMITED'
        : normalizeCollectErrorCode(rawFailCode);
      let rawErrorCheckpoint: string | null = null;
      if (failCode === 'UNKNOWN' && rawFailCode !== 'UNKNOWN') {
        console.warn(`[acquisition] collect/report-videos error_code 归一为 UNKNOWN，原始值：task=${taskId} raw=${rawFailCode}`);
        rawErrorCheckpoint = JSON.stringify({ raw_error_code: rawFailCode });
      }
      const s = settleCollectTask({
        currentStatus: task.status === 'pending' ? 'running' : task.status,
        agentTerminal: searchEmpty
          ? { terminal: 'partial', partial_reason: 'stage1_empty' }
          : { terminal: 'failed', error_code: failCode },
        videoTotal: 0,
        videoDone: 0,
        leadCount: task.lead_count_raw,
      });
      await client.query(
        `UPDATE zenithjoy.acquisition_collect_tasks
            SET status = $2, error_code = $3,
                checkpoint = CASE WHEN $4::jsonb IS NOT NULL
                             THEN COALESCE(checkpoint, '{}'::jsonb) || $4::jsonb
                             ELSE checkpoint END,
                started_at = COALESCE(started_at, NOW()),
                ended_at = NOW(), updated_at = NOW()
          WHERE id = $1`,
        [taskId, s.status, s.error_code, rawErrorCheckpoint]
      );
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/api && npx vitest run src/routes/acquisition.test.ts`
Expected: 全文件 PASS（含新增 2 条 + 原有全部测试，尤其确认第 953-963 行那条原有测试 `params[2]` 断言不受影响仍然 PASS）。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/acquisition.test.ts apps/api/src/routes/acquisition.ts
git commit -m "feat(acquisition): report-videos端点落原始错误码进checkpoint

normalizeCollectErrorCode降级为UNKNOWN时，此前只console.warn打印
原始值，随进程重启丢失。现在持久化进checkpoint.raw_error_code，
不改error_code列值域、不改客户端。"
```

---

### Task 2: `/collect/report` 端点落原始错误码

**Files:**
- Modify: `apps/api/src/routes/acquisition.ts:1183-1204`
- Test: `apps/api/src/routes/acquisition.test.ts`（追加到 `describe('POST /api/acquisition/collect/report — 终态守卫 + settle 结算 [BEHAVIOR]', ...)` 块内，紧跟在第 1178-1194 行"error_code 不在五分类枚举里时"那条测试后面）

- [ ] **Step 1: 写 failing test**

找到这条已有测试（约第 1178-1186 行）：

```ts
  it('error_code 不在五分类枚举里时，落库前归一为 UNKNOWN（防御未来 Android 版本传入新值）', async () => {
    mockClientQuery.mockImplementation(clientImpl(taskRow()));
    const res = await request(app).post('/api/acquisition/collect/report')
      .send({ task_id: TASK_ID, video_id: 'v1', commenters: [], terminal: 'failed', error_code: 'SOME_BRAND_NEW_CODE' });
    expect(res.status).toBe(200);
    const updateCall = mockClientQuery.mock.calls.find((c) => String(c[0]).trim().startsWith('UPDATE zenithjoy.acquisition_collect_tasks'));
    expect(updateCall).toBeDefined();
    expect((updateCall as any)[1][2]).toBe('UNKNOWN');
  });
```

紧跟在它后面追加两条新测试：

```ts
  it('error_code 不在五分类枚举里时，原始值必须持久化进 checkpoint.raw_error_code（不带客户端 checkpoint）', async () => {
    mockClientQuery.mockImplementation(clientImpl(taskRow()));
    const res = await request(app).post('/api/acquisition/collect/report')
      .send({ task_id: TASK_ID, video_id: 'v1', commenters: [], terminal: 'failed', error_code: 'ALL_SHARE_FAILED' });
    expect(res.status).toBe(200);
    const updateCall = mockClientQuery.mock.calls.find((c) => String(c[0]).trim().startsWith('UPDATE zenithjoy.acquisition_collect_tasks'));
    expect(updateCall).toBeDefined();
    const params = (updateCall as any)[1];
    expect(params[2]).toBe('UNKNOWN');
    expect(JSON.parse(params[5])).toEqual({ raw_error_code: 'ALL_SHARE_FAILED' });
  });

  it('error_code 降级时，若客户端已传 checkpoint，合并写入而非覆盖', async () => {
    mockClientQuery.mockImplementation(clientImpl(taskRow()));
    const res = await request(app).post('/api/acquisition/collect/report')
      .send({
        task_id: TASK_ID, video_id: 'v1', commenters: [], terminal: 'failed',
        error_code: 'ALL_SHARE_FAILED',
        checkpoint: { last_video_id: 'v9' },
      });
    expect(res.status).toBe(200);
    const updateCall = mockClientQuery.mock.calls.find((c) => String(c[0]).trim().startsWith('UPDATE zenithjoy.acquisition_collect_tasks'));
    const params = (updateCall as any)[1];
    expect(JSON.parse(params[5])).toEqual({ last_video_id: 'v9', raw_error_code: 'ALL_SHARE_FAILED' });
  });

  it('error_code 已经是合法五分类值时，不追加 raw_error_code（保持改动前行为）', async () => {
    mockClientQuery.mockImplementation(clientImpl(taskRow()));
    const res = await request(app).post('/api/acquisition/collect/report')
      .send({ task_id: TASK_ID, video_id: 'v1', commenters: [], terminal: 'failed', error_code: 'NETWORK_ERROR' });
    expect(res.status).toBe(200);
    const updateCall = mockClientQuery.mock.calls.find((c) => String(c[0]).trim().startsWith('UPDATE zenithjoy.acquisition_collect_tasks'));
    const params = (updateCall as any)[1];
    expect(params[2]).toBe('NETWORK_ERROR');
    expect(params[5]).toBeNull();
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && npx vitest run src/routes/acquisition.test.ts -t "raw_error_code"`
Expected: Task 1 那两条已经 PASS（改动已在上一步完成），Task 2 新增的三条 FAIL——`params[5]` 目前要么是 `null`（未受影响）要么是 `JSON.stringify({last_video_id:'v9'})`（没有 merge 逻辑），跟期望值不符。

- [ ] **Step 3: 实现最小改动**

定位这段代码（约 1183-1204 行）：

```ts
    const normalizedErrorCode = normalizeCollectErrorCode(errorCode);
    if (normalizedErrorCode === 'UNKNOWN' && errorCode !== 'UNKNOWN') {
      console.warn(`[acquisition] collect/report error_code 归一为 UNKNOWN，原始值：task=${taskId} raw=${errorCode}`);
    }
    const s = settleCollectTask({
      currentStatus: task.status === 'pending' ? 'running' : task.status,
      agentTerminal: terminal ? { terminal, error_code: normalizedErrorCode, partial_reason: partialReason } : null,
      videoTotal,
      videoDone,
      leadCount: leadCountAfter,
    });
    const newStatus = s.changed ? s.status : (task.status === 'pending' ? 'running' : task.status);
    const newErrorCode = s.changed ? s.error_code : task.error_code;
    const isTerminal = (TERMINAL_COLLECT_STATUSES as readonly string[]).includes(newStatus);

    await client.query(
      `UPDATE zenithjoy.acquisition_collect_tasks
          SET status         = $2,
              error_code     = $3,
              video_count    = $4,
              lead_count_raw = lead_count_raw + $5,
              checkpoint     = COALESCE($6::jsonb, checkpoint),
              started_at     = COALESCE(started_at, NOW()),
              ended_at       = CASE WHEN $7 THEN COALESCE(ended_at, NOW()) ELSE ended_at END,
              updated_at     = NOW()
        WHERE id = $1`,
      [taskId, newStatus, newErrorCode, videoTotal, batch.length,
       checkpoint ? JSON.stringify(checkpoint) : null, isTerminal]
    );
```

改成：

```ts
    const normalizedErrorCode = normalizeCollectErrorCode(errorCode);
    let checkpointToWrite: Record<string, unknown> | null =
      checkpoint && typeof checkpoint === 'object' ? checkpoint : null;
    if (normalizedErrorCode === 'UNKNOWN' && errorCode !== 'UNKNOWN') {
      console.warn(`[acquisition] collect/report error_code 归一为 UNKNOWN，原始值：task=${taskId} raw=${errorCode}`);
      checkpointToWrite = { ...(checkpointToWrite ?? {}), raw_error_code: errorCode };
    }
    const s = settleCollectTask({
      currentStatus: task.status === 'pending' ? 'running' : task.status,
      agentTerminal: terminal ? { terminal, error_code: normalizedErrorCode, partial_reason: partialReason } : null,
      videoTotal,
      videoDone,
      leadCount: leadCountAfter,
    });
    const newStatus = s.changed ? s.status : (task.status === 'pending' ? 'running' : task.status);
    const newErrorCode = s.changed ? s.error_code : task.error_code;
    const isTerminal = (TERMINAL_COLLECT_STATUSES as readonly string[]).includes(newStatus);

    await client.query(
      `UPDATE zenithjoy.acquisition_collect_tasks
          SET status         = $2,
              error_code     = $3,
              video_count    = $4,
              lead_count_raw = lead_count_raw + $5,
              checkpoint     = COALESCE($6::jsonb, checkpoint),
              started_at     = COALESCE(started_at, NOW()),
              ended_at       = CASE WHEN $7 THEN COALESCE(ended_at, NOW()) ELSE ended_at END,
              updated_at     = NOW()
        WHERE id = $1`,
      [taskId, newStatus, newErrorCode, videoTotal, batch.length,
       checkpointToWrite ? JSON.stringify(checkpointToWrite) : null, isTerminal]
    );
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/api && npx vitest run src/routes/acquisition.test.ts`
Expected: 全文件 PASS（含 Task 1 + Task 2 共 5 条新测试，以及全部既有测试不受影响）。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/acquisition.test.ts apps/api/src/routes/acquisition.ts
git commit -m "feat(acquisition): report端点落原始错误码进checkpoint，合并不覆盖客户端已传值

同Task1根因，此端点已有checkpoint参数(整体替换式)，新逻辑改为
spread合并追加raw_error_code，不丢客户端原本传入的其它checkpoint字段。"
```

---

### Task 3: 全量回归 + 收尾

**Files:** 无新增/修改，仅验证。

- [ ] **Step 1: 跑 acquisition 全量测试**

Run: `cd apps/api && npx vitest run src/routes/acquisition.test.ts`
Expected: 全部 PASS，测试数比 Task 2 开始前多 5 条。

- [ ] **Step 2: 跑 apps/api 全量测试确认无回归**

Run: `cd apps/api && npx vitest run`
Expected: 全部 PASS（Test Files/Tests 数量与改动前一致，仅多出本次新增的 5 条）。

- [ ] **Step 3: tsc 类型检查**

Run: `cd apps/api && npx tsc --noEmit`
Expected: 无输出（无类型错误）。

- [ ] **Step 4: eslint 检查改动文件**

Run: `cd apps/api && npx eslint src/routes/acquisition.ts src/routes/acquisition.test.ts`
Expected: 0 errors（warning 数不多于改动前）。
