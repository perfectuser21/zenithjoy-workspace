# 作品→发布任务派发接缝 + 统一发布包协议（line01 刀1）

> Brain task `7caeca00` · golden_path `c5c0e259` · 分支 `cp-09082250-publish-dispatch`
> PrepPRD：`sprints/09082250-content-publish-dispatch/prep-prd.md`
> 设计审查：Research Subagent APPROVE（2026-09-08，3 条小修正已并入）

## 问题

小程序/快捷指令上传的作品（`contents`：title/body/type/platforms + 关联 materials）与发布链（`publish_tasks`）是两本账，没有任何接缝。安卓真机通道（AI+skill 驱动，5 平台已验证）发布时标题文案是 AI 现编的，不是用户写的内容。

## 方案

### 1. POST /api/contents/:id/publish（新路由文件 `routes/contents-publish.ts`）

- 鉴权：X-Upload-Token → validateLicense → tenant（照抄 materials.ts authenticate 模式）
- 按 id+tenant 查 contents，查不到 → 404 NOT_FOUND
- `platforms = body.platforms ?? contents.platforms`；必须非空且都在白名单
  `['douyin','xiaohongshu','kuaishou','toutiao','weibo','bilibili','shipinhao','zhihu','wechat']`，否则 400 INVALID_PLATFORMS
- `contents.type` 必须 ∈ {'video','image','article'}（publish_tasks.type 有 CHECK，防 500 暴露）否则 400
- contents.status 已是 'queued' → 409 ALREADY_QUEUED（幂等防连点）
- `findActiveAgentByTenantId(tenantId)`（10 分钟心跳窗）无 → 409 NO_AGENT（NoAgentError 语义，先例 works.ts:48）
- 事务（pool.connect）：
  - 每平台 INSERT `publish_tasks(agent_id, platform, type=contents.type, status='queued', task_type='content_publish', tenant_id, payload=发布包)`
  - UPDATE `contents.status='queued'`
- 发布包 payload（**不存签名 URL**，2h 会过期，领取时现签）：
  ```json
  {"content_id":"…","title":"…","body":"…","content_type":"image|video|article",
   "platform":"douyin","materials":[{"id":"…","storage_key":"…","file_name":"…","mime_type":"…"}]}
  ```
- 响应：`{success:true, data:{content_id, tasks:[{id, platform}]}}`

### 2. GET /api/publish-tasks（执行器发现作业单）

- 同鉴权；固定过滤本租户 + `task_type='content_publish'`；可选 `?status=queued`
- 返回任务列表（id/platform/type/status/created_at，不含发布包大字段）

### 3. GET /api/publish-tasks/:id/package（执行器领作业单）

- 同鉴权；按 id 查，跨租户或非 content_publish → 404
- 对 payload.materials 逐个 `storage.getSignedUrl(storage_key)`（MaterialStorage 现成方法，默认 TTL 3600s，material-storage.ts:34）
- 返回：`{content_id, title, body, content_type, platform, media:[{url, file_name, mime_type}]}`

### 4. getQueuedTasks 排除（walking-skeleton.service.ts:419）

WHERE 加 `AND (task_type IS DISTINCT FROM 'content_publish')`——旧 Windows/安卓 agent 心跳唯一调用点（walking-skeleton.ts:152）不再误领新任务；`IS DISTINCT FROM` 保留 task_type=NULL 老任务与 acquisition_cancel/burner 流。

## 消费方（本刀不改，协议对齐）

执行器 = AI+skill 驱动安卓真机（android-publish skill 家族）：领单流程 = GET 列表 → GET package → 下载 media → 按平台 skill 序列真机发布 → 回执走既有 ack 通道。未来 agent-android 固化后走同一协议。

## 测试策略（四档）

- **integration（主力）**：vitest + supertest，mock pg（照抄 materials.test.ts 模式：vi.mock db/connection + walking-skeleton.service），事务段 mock `pool.connect()` 返回假 client（BEGIN/COMMIT/ROLLBACK/release）。覆盖：拆任务数=platforms 数、payload 字段齐、白名单 400、空 platforms 400、ALREADY_QUEUED 409、NO_AGENT 409、跨租户 404、package 签名 URL 拼装、列表过滤 task_type。
- **unit**：白名单/type 校验纯函数。
- **E2E/smoke**：`.github/workflows/scripts/smoke/content-publish-dispatch-smoke.sh`（注册租户→传素材→publish→list→package 全链路断言），进 CI（PR 标题 [CONFIG]）。
- **staging 真验（合并后）**：ZJ-E-ALEX5211 传素材 → publish → package，断言 title/body/media[0].url 可下载。

## 不做

- 不改 agent 端代码（安卓/Windows）；不做 Notion 编排台（刀2）；不做定时发布；不做每平台文案变体（刀3 AI 代笔时一并）；不动 works/work_id 老发布路径。

## 关键事实依据（审查确认）

- publish_tasks：status 9 值枚举含 'queued'（20260511 migration）；task_type TEXT 无 CHECK；platform TEXT 无 CHECK；type 有 CHECK IN ('video','image','article')；tenant_id/payload 列已存在
- contents.status TEXT 无 CHECK；contents.type 上游只产 'video'|'image'（inferContentType，混传直接报错）
- /api/publish-tasks 路径与现有 /api/publish、/api/works/:id/publish-logs 无遮挡
