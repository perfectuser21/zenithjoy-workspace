# 设计：采集失败原始错误码留证（修订版——纯服务端）

## 背景（含实现阶段的关键修正）

2026-07-27 排查 Path2 安卓智能获客验收 5 号机（华为 BKK-AL10）"采集任务失败"时，最初以为原始错误码在**客户端**分类后就被丢弃了。深入读代码后发现真相更细：`AgentService.kt` 里 `reporter?.reportVideos(...)` 有两个调用点，行为不一样：

- **主路径**（`DouyinCollectService.onVideoCardResult` 回调，约 227 行）：`errorCode = if (error.isNotEmpty()) error else null` —— **直接把原始错误码发给服务端，没有做任何客户端分类**。5 号机大概率走的是这条路径。
- **兜底路径**（`finishWithError` 场景，约 862 行）：`errorCode = CollectFailureClassifier.classify(errorCode)` —— 客户端先分类再发送，原始值确实没离开手机。

服务端 `apps/api/src/routes/acquisition.ts` 收到 `error_code` 后统一过 `normalizeCollectErrorCode()`——一个白名单校验：不在 `VALID_COLLECT_ERROR_CODES` 里的值一律强制改成 `UNKNOWN`，并且**已经**用 `console.warn` 打印过原始值（例如第 883/1185 行：`raw=${rawFailCode}`）。也就是说：**5 号机这类场景，原始信号其实已经到达过服务器，只是被打印到了控制台日志（今天已经随容器重建丢失），从没写进数据库。**

这个发现把修复范围大幅简化：**主路径的信息丢失完全是服务端的事，不需要改一行 Android 代码就能补上**——只要在已有的 `console.warn` 分支旁边，把同一个值写进 `acquisition_collect_tasks.checkpoint` 就行。

## 目标

服务端在把 `error_code` 归一为 `UNKNOWN` 时，把归一前的原始值持久化进 `checkpoint.raw_error_code`，不再只打日志。

## 不做的事

- **不改动任何 Android/Kotlin 代码**——本次范围内不需要，且能立即对已安装的任意版本 APK 生效
- 不新建表、不新建字段（复用已有的 `checkpoint JSONB` 列）
- 不改变 `error_code` 列的值域/分类策略、`normalizeCollectErrorCode()` 的判定逻辑
- 不处理"兜底路径"（约 862 行，客户端已先分类）造成的信息丢失——那条路径的原始值确实从未过网络，属于另一个范围更大的问题（决策 e38c097b 涉及的分类策略），本次不动

## 设计

`apps/api/src/routes/acquisition.ts` 里现有两处 `normalizeCollectErrorCode` 降级判断，行为模式相同（`if (normalized === 'UNKNOWN' && raw !== 'UNKNOWN') console.warn(...)`），分别对应两个独立的 UPDATE 语句，按各自现有的 jsonb 写法就地补写：

### 位置 1：`POST /collect/report-videos`（Stage1，空清单分支，约 874-899 行）

现状：
```ts
const failCode = rawFailCode === 'ALL_RESOLVE_FAILED'
  ? 'PLATFORM_LIMITED'
  : normalizeCollectErrorCode(rawFailCode);
if (failCode === 'UNKNOWN' && rawFailCode !== 'UNKNOWN') {
  console.warn(`[acquisition] collect/report-videos error_code 归一为 UNKNOWN，原始值：task=${taskId} raw=${rawFailCode}`);
}
const s = settleCollectTask({ /* ... */ });
await client.query(
  `UPDATE zenithjoy.acquisition_collect_tasks
      SET status = $2, error_code = $3, started_at = COALESCE(started_at, NOW()),
          ended_at = NOW(), updated_at = NOW()
    WHERE id = $1`,
  [taskId, s.status, s.error_code]
);
```

改为：
```ts
const failCode = rawFailCode === 'ALL_RESOLVE_FAILED'
  ? 'PLATFORM_LIMITED'
  : normalizeCollectErrorCode(rawFailCode);
let rawErrorCheckpoint: string | null = null;
if (failCode === 'UNKNOWN' && rawFailCode !== 'UNKNOWN') {
  console.warn(`[acquisition] collect/report-videos error_code 归一为 UNKNOWN，原始值：task=${taskId} raw=${rawFailCode}`);
  rawErrorCheckpoint = JSON.stringify({ raw_error_code: rawFailCode });
}
const s = settleCollectTask({ /* ... */ });
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

### 位置 2：`POST /collect/report`（Stage2，约 1181-1204 行）

这条路径的 UPDATE 已经在写 `checkpoint`（`checkpoint = COALESCE($6::jsonb, checkpoint)`，来自客户端主动传的 `checkpoint` 参数，整体替换式，不是 merge）。补法：normalize 降级发生时，把 `raw_error_code` **合并**进客户端已传的 `checkpoint`（如果有），而不是覆盖：

现状：
```ts
const normalizedErrorCode = normalizeCollectErrorCode(errorCode);
if (normalizedErrorCode === 'UNKNOWN' && errorCode !== 'UNKNOWN') {
  console.warn(`[acquisition] collect/report error_code 归一为 UNKNOWN，原始值：task=${taskId} raw=${errorCode}`);
}
/* ... */
[taskId, newStatus, newErrorCode, videoTotal, batch.length,
 checkpoint ? JSON.stringify(checkpoint) : null, isTerminal]
```

改为：
```ts
const normalizedErrorCode = normalizeCollectErrorCode(errorCode);
let checkpointToWrite: Record<string, unknown> | null = checkpoint ?? null;
if (normalizedErrorCode === 'UNKNOWN' && errorCode !== 'UNKNOWN') {
  console.warn(`[acquisition] collect/report error_code 归一为 UNKNOWN，原始值：task=${taskId} raw=${errorCode}`);
  checkpointToWrite = { ...(checkpoint ?? {}), raw_error_code: errorCode };
}
/* ... */
[taskId, newStatus, newErrorCode, videoTotal, batch.length,
 checkpointToWrite ? JSON.stringify(checkpointToWrite) : null, isTerminal]
```

## 边界情况

- `rawFailCode`/`errorCode` 本来就是合法值（不触发降级）：`rawErrorCheckpoint`/新增字段均为 `null`/不变，行为与改动前完全一致
- 位置 2 客户端本来就传了 `checkpoint` 且触发了降级：新逻辑用 spread 合并，保留客户端原有 key，只追加/覆盖 `raw_error_code`
- 位置 1 目前没有客户端传入的 `checkpoint`（该端点协议里没有这个字段），所以只需要处理"从空到有一个值"，不需要考虑合并已有 `checkpoint` 内容（`COALESCE(checkpoint,'{}'::jsonb) || ...` 已经处理了"该行 checkpoint 本来是 NULL"的情况）

## 测试策略

- **TS 单测**（新建或加进 acquisition 相关测试文件，mock `pool`/`client.query`）：
  1. 位置 1：`reason.error_code` 传一个不在白名单里的值（如 `"ALL_SHARE_FAILED"`）→ 断言 UPDATE 调用的 jsonb 参数包含 `{"raw_error_code":"ALL_SHARE_FAILED"}`
  2. 位置 1：`reason.error_code` 传合法值（如 `"NETWORK_ERROR"`）→ 断言 UPDATE 调用时该 jsonb 参数为 `null`（不触发写入）
  3. 位置 2：`errorCode` 传不在白名单里的值、且请求体带了别的 `checkpoint` 字段 → 断言最终写入的 checkpoint 同时保留原有字段和新增的 `raw_error_code`
- 无需 E2E / 无需 Android 侧任何测试（本次不改 Kotlin 代码）
