# Notion 发布编排台双向同步（line01 刀2）

> Brain task `5163f159` · golden_path `c5c0e259` · 分支 `cp-09091100-notion-orchestrator`
> PrepPRD：`sprints/09091103-notion-orchestrator/prep-prd.md`
> 设计审查：Research Subagent APPROVE（2026-09-09，4 条修正已并入）

## 问题

作品（contents）的标题/文案目前只能在上传时给或调 API 改，主理人没有顺手的写作台。拍板方案：Notion 当主理人私人编排台入口（客户不感知），唯一真相仍在中台 DB，发布引擎只认 DB。

## 组件

### 1. 派发核心抽 service（先减肥再增肌，两段式 commit）

`apps/api/src/services/content-publish-dispatch.ts`：把 `routes/publish-dispatch.ts` POST handler 的 L112-L210 段（查作品→platforms 校验→type/status 拦截→找 agent→拉素材→事务 CAS+逐平台 INSERT→COMMIT）抽成：

```ts
dispatchContentPublish({ contentId, tenantId, platformsOverride? })
  → { contentId, tasks: [{id, platform}] }
```

类型化错误（先例 walking-skeleton.service.ts:644 NoAgentError）：
- `NoAgentError`（复用现有类）→ route 409 / worker 行'派发失败'+人话原因
- `AlreadyQueuedError`（新增，收敛事务外礼貌拦截+事务内 CAS rowCount=0 两处）→ route 409 / **worker 视为幂等成功，行置'排队中'**
- `DispatchValidationError(code,msg)`（收敛 INVALID_PLATFORMS/INVALID_CONTENT_TYPE/NO_MATERIALS 三类 400）→ route 400 / worker 行'派发失败'
- 查不到作品 → route 404 / worker 锚失效红日志跳过

route 保留：authenticate、UUID 检查、限流、HTTP 翻译。**事务外礼貌拦截与事务内 CAS 两层都随核心搬进 service。**

### 2. Notion 轻客户端

`apps/api/src/services/notion-client.ts`：从 notion-crm.ts 抽共享（API base/version/token 读取 + `notionRequest(method, path, body)` 统一封装），notion-crm.ts 改为 import（复用即引用）。`databases/{id}/query` 分页自写（page_size=100 + has_more/next_cursor while 循环，仓库无先例）。
**日志纪律：catch 里绝不打整个 AxiosError（config.headers 含 Bearer token）——只打 message/status/response.data。**

### 3. 同步 worker

`apps/api/src/services/notion-orchestrator.ts`，骨架照 worker-lease-sweeper（setInterval 60s + .catch 不逃逸 + t.unref + stopXxx），外加：
- **running 互斥**：上一轮未完跳过本轮（Notion 慢时防 tick 重叠）
- **启动自检**：缺 `NOTION_INTEGRATION_TOKEN` 或 `NOTION_PUBLISH_ORCH_DB_ID` 或 `NOTION_ORCH_TENANT_ID` → `console.error('[notion-orch] 未配置(<缺哪个>)，跳过启动')` return（fail-loud 不 crash）
- 挂载：index.ts:82 旁 `if (!process.env.VITEST) startNotionOrchestrator()`

每轮三个方向（串行）：

**A. 推行（作品→Notion）**：`SELECT id,title,body,type,platforms FROM contents WHERE tenant_id=$ORCH_TENANT AND notion_page_id IS NULL AND status='draft' ORDER BY created_at LIMIT 20` → 逐个查素材文件名+签一个预览 URL → 建 Notion 页（标题/文案预填、平台预勾、形态、状态=草稿、素材=文件名列表、预览=URL、content_id）→ `UPDATE contents SET notion_page_id=$pageId`。

**B. 拉发（Notion→派发）**：query 库 filter 状态='发' → 每行取 content_id property，UUID 校验失败或查不到（含 tenant 不符）→ 红日志+行状态'派发失败'+原因'锚失效' → 否则：平台多选经 `PUBLISH_PLATFORMS` 白名单过滤（**不信 Notion 手加 option**，过滤后为空=派发失败）→ `UPDATE contents SET title,body,platforms`（从行读回）→ `dispatchContentPublish` → 成功或 AlreadyQueued → 行状态'排队中'；NoAgent/Validation → 行状态'派发失败'+原因。

**C. 回执（任务终态→Notion）**：`SELECT c.* FROM contents c WHERE tenant_id=$T AND status='queued' AND notion_page_id IS NOT NULL` → 查其 content_publish 任务（payload->>'content_id' 匹配）→ **全部终态**（done/failed 类）才动作：回执列写每平台结果（**截断 1900 字符**）、行状态='已发'（全成）/'部分失败'（有败）、**`UPDATE contents SET status='published'|'failed'`——必须挪出 queued**，否则每 60s 重写回执且作品永锁（审查抓出的状态机缺口）。

### 4. migration

`apps/api/db/migrations/2026MMDD_HHMMSS_contents_notion_page_id.sql`，照 20260905_103000_materials_uploader.sql 模板：`ALTER TABLE zenithjoy.contents ADD COLUMN IF NOT EXISTS notion_page_id TEXT` + 部分索引 `(tenant_id) WHERE notion_page_id IS NULL` + COMMENT。全 DDL 幂等、不包 BEGIN/COMMIT（run-migration.ts 外层有事务；CI glob runner 全量重放）。

### 5. 一次性建库脚本

`apps/api/scripts/create-notion-orchestrator-db.mjs`（手跑一次）：在 AI Hub 根页 `ae1c40c2-ba63-82ef-a798-8177341c5305` 下建「发布编排台」database，预置全部 select/multi_select options（状态 6 值：草稿/发/排队中/已发/部分失败/派发失败；平台 9 值白名单），输出 DB id 供填 env。

### 6. env（staging `/opt/zenithjoy/staging-api/.env`，部署时追加）

`NOTION_INTEGRATION_TOKEN`（1Password Notion 条目）、`NOTION_PUBLISH_ORCH_DB_ID`（建库后回填）、`NOTION_ORCH_TENANT_ID=b0058fb7-645d-4d2b-ab25-8d9d4a764b29`（v1 仅主理人租户）。

## 状态机（Notion 行）

草稿 →(主理人)→ 发 →(worker 派发成功/幂等)→ 排队中 →(全任务终态)→ 已发 | 部分失败
　　　　　　　　　└(NoAgent/校验/锚失效)→ 派发失败 →(主理人改回'发')→ 重试

## 测试策略（四档）

- **integration（主力）**：vitest，mock pg + mock notion-client（vi.mock）。覆盖：推行字段映射与去重（notion_page_id 非空不重推）、拉发白名单过滤/锚失效跳过/AlreadyQueued 幂等置排队中/NoAgent 置派发失败、回执全终态才写+contents 挪出 queued+截断、启动自检缺 env 跳过、running 互斥。
- **unit**：dispatchContentPublish 抽取后刀1既有 16 测试全部保绿（抽取属置换，承诺零变化）。
- **smoke [CONFIG]**：CI 无 Notion secret——smoke 验证"env 缺失时 API 启动正常、/api/health 200、日志含 [notion-orch] 跳过启动"（启动自检的 proven-to-fire 面）。
- **staging 真验（合并后，我执行）**：PrepPRD 四条验收（传素材→行出现；填写→发→拆任务；伪造终态→回执；无 agent→派发失败可重试）。

## 不做

客户版界面；AI 文案；定时发布；多租户库；预览 URL 长期有效（1h 签名，过期属已知限制）；Notion webhook（v1 轮询够用）。
