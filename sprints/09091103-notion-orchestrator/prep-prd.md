# PrepPRD：Notion 发布编排台双向同步（line01 刀2）

> Brain task `5163f159-9c69-4203-ac2c-5df8f8759f08` · golden_path `c5c0e259` · 分支 `cp-09091100-notion-orchestrator`
> 主理人拍板链：2026-09-08"Notion 当私人编排台方向可以，你开始吧"→ 刀序既定，本刀为刀2

## 本次要做的（用户语言）

主理人手机传完素材，Notion 里自动长出一行（标题/文案空着等填、平台可勾、能看到素材文件名和预览链接）；在 Notion 里写好文案、把状态改成"发"，系统自动派发（走刀1 的发布任务链）；每个平台的成功/失败回执写回那一行。

## Golden Path（单线性）

1. 主理人用快捷指令/小程序传素材（ZJ-E-ALEX5211）→ 系统建作品（刀1 已有）→ **≤60 秒内 Notion「发布编排台」库自动出现一行**：标题/文案预填上传时给的值（没给则空）、平台多选预勾上传时的 platforms、状态=草稿、素材列=文件名、预览列=临时链接
2. 主理人在 Notion 改标题、写文案、调平台勾选 → （系统不动，等状态）
3. 主理人把状态改成「发」→ ≤60 秒内系统把该行的标题/文案/平台**写回作品**并派发（每平台一条任务）→ 行状态自动变「排队中」
4. 执行器发完后 → 该行回执列出现每平台结果（douyin ✅ / weibo ❌原因），全部终态后状态变「已发」（有失败则「部分失败」）

**出错恢复**：派发失败（如无活跃 agent）→ 状态变「派发失败」+ 回执列写人话原因 → 主理人处理后把状态改回「发」即重试。Notion API 挂了 → 中台日志红 + 下轮轮询自愈，绝不丢作品数据（真相在 DB，Notion 只是视图）。

## 涉及的 Ability / Feature

- line01 · 编排台同步器（新增，thin）：`apps/api/src/services/notion-orchestrator.ts` 轮询 worker（60s，index.ts VITEST 门控启动，先例 worker-lease-sweeper）
- 刀1 派发逻辑抽 service：`publish-dispatch.ts` 的核心拆到 `services/content-publish-dispatch.ts`，route 与 worker 共用（复用即引用，不复制）

## 技术要点

- **一次性建库**（实现中脚本化）：Notion「发布编排台」database 建在 AI Hub 根页 `ae1c40c2-ba63-82ef-a798-8177341c5305` 下，字段：标题(title)/文案(rich_text)/平台(multi_select 9 平台白名单)/形态(select)/状态(select: 草稿|发|排队中|已发|部分失败|派发失败)/素材(rich_text)/预览(url)/回执(rich_text)/content_id(rich_text，系统锚，用户勿动)
- **migration**：`contents` 加 `notion_page_id TEXT`（推送去重锚）
- **推送方向**：`SELECT contents WHERE tenant_id=$ORCH_TENANT AND notion_page_id IS NULL AND status='draft'` → 建行 → 回写 notion_page_id
- **拉取方向**：query 库中 状态='发' 的行 → 按 content_id 找作品（校验 tenant）→ UPDATE title/body/platforms → 调共用 dispatch service → 状态='排队中'；NoAgentError → 状态='派发失败'+原因
- **回执方向**：contents.status='queued' 且有 notion_page_id → 查 publish_tasks 终态 → 全终态则写回执+状态
- **env（staging `/opt/zenithjoy/staging-api/.env`）**：`NOTION_INTEGRATION_TOKEN`（1Password Notion 条目）、`NOTION_PUBLISH_ORCH_DB_ID`（建库后回填）、`NOTION_ORCH_TENANT_ID=b0058fb7-645d-4d2b-ab25-8d9d4a764b29`（v1 只同步主理人私人租户——客户不进 Notion，这是拍板过的"Notion 只是你的私人入口"）
- Notion 调用复用 notion-crm.ts 的 API 常量与鉴权模式；限速：单轮串行，3rps 内

## 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| Notion 行↔作品锚定 | 行标题匹配 / content_id property | content_id property（系统写，页面提示勿动） | 标题会被用户改，唯 id 稳 | ⚠️ 错行派发错内容——中危，锚丢失时跳过该行并红日志，绝不猜 |
| 「发」触发识别 | 状态 select='发' / checkbox | select='发' | 状态机单字段可回退可重试 | 误触发=多派一次，但刀1 CAS 幂等兜底（ALREADY_QUEUED） |
| 终态判定 | 任一任务 done / 全部任务终态 | 全部终态才写「已发/部分失败」 | 部分完成时写终态会误导 | 低危：晚报不误报 |

## 前置工作（已逐项确认）

- [x] Notion 凭据：1Password「Notion」条目（CCAPI2026），真调 /users/me 200 验证
- [x] 父页面：AI Hub 根页 `ae1c40c2-ba63-82ef-a798-8177341c5305`（从 AI Journey 库 parent 反查）
- [x] staging env 注入点：hk-vps `/opt/zenithjoy/staging-api/.env`（deploy workflow --env-file 引用，redeploy 不丢）
- [x] 后台 worker 先例：index.ts:82 VITEST 门控
- [x] 刀1 协议已合并（PR#1791），staging 已验
- [x] 测试租户：主理人 ZJ-E-ALEX5211 / b0058fb7（staging 已有活跃 agent 种子）

## 守卫（接缝清单）

- 逻辑接缝（同步状态机/字段映射/锚定）→ vitest mock Notion+pg（CI）
- 环境接缝（Notion API + env）→ **启动自检**：缺 NOTION_INTEGRATION_TOKEN 或 DB_ID → 红日志 `[notion-orch] 未配置，跳过启动`（fail-loud 不 crash，不静默）；CI smoke 验证"env 缺失时 API 正常启动、worker 不炸"
- proven-to-fire：实现中故意删 env 跑一次看红日志

## 不包含

- 客户版编辑界面（小程序页，后刀）；AI 文案代笔（刀3 一并）；定时发布；多租户 Notion 库；素材预览的长期有效 URL（v1 用 1h 签名链接，过期点开重签属已知限制记 not_done）

## 验收标准（Final E2E，staging 真验）

- [ ] 传素材 → ≤60s Notion 出现新行，字段齐
- [ ] Notion 填文案改状态「发」→ ≤60s contents 更新 + publish_tasks 按勾选平台生成 + 行状态「排队中」
- [ ] 手动把任务置 done/failed → 行回执出现每平台结果 + 状态终态
- [ ] 无 agent 时改「发」→ 行状态「派发失败」+ 原因；改回「发」可重试
- [ ] CI 全绿（vitest + smoke [CONFIG]）
