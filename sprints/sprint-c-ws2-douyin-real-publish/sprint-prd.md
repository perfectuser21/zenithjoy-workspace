# Sprint PRD — WS2 Sprint 2.1a：修架构 + 抖音 video 真发 + Lead 自验

> **重要**：原 Sprint 2.1 在 Proposer 现状盘点后被推翻拆分。原 PRD 假设 Step 5 (AI 生成) 是 thin 加厚，实际盘点发现 Step 5 在 WS1 根本没实现 — 昨天 WS1 是用"本地文件夹存的视频"直接发布。因此原 Sprint 2.1 拆为：
> - **2.1a（本 PRD）**：修 publish_tasks 架构缺陷 + 抖音 video 真发 + 扫码 UI + Lead 自验。Step 5 保持本地文件夹现状不动。
> - **2.1b（后续 PRD）**：把 Step 5 从"本地文件夹"升级到"AI 生成"（接 Claude API）。这是 thin → thin 的横向替换不是加厚。

## OKR 对齐

- **对应 KR**：KR-1（"ZenithJoy 产品全线上线 — AI双线创作 + 小程序 + 网站 + Dashboard 可交付"）
- **当前进度**：77%
- **本次推进预期**：79%（+2pp，把 Path 1 从 not_started 推进到 skeleton — 真正 mvp 升级要等 Step 5 在 2.1b 接 AI 生成）

## 背景

WS1 sprint（2026-05-07）跑通 Path 1「客户首次成功路径」6 步 thin 骨架，但 Proposer 现状盘点后发现 3 个深层问题：

1. **publish_tasks 表无 type 字段，是架构缺陷**：表只有 `platform` 字段，`zenithjoy.publish_tasks` migration（`apps/api/db/migrations/20260507_115000_walking_skeleton_1.sql:52`）从设计上就无法承载"同平台多类型"。
2. **Agent 路由完全无视 type，硬编码只跑 image 脚本**：`services/agent/src/handlers/douyin-publish.ts:55` 的 `resolveDouyinScriptPath()` 硬编码返回 `publish-douyin-image.cjs` / `publish-douyin-image-dryrun.cjs`。lead 体感"视频发成图文"根因 = 任何抖音任务永远跑 image，video 脚本根本不存在。
3. **Lead 没在客户机自验**（`.agent-knowledge/` 下无 lead-acceptance 记录），导致 P0 bug 在用户面前才暴露。

按 walking-skeleton 铁律 7（lead 客户机自验）+ 加厚靠真实反馈：本 sprint（2.1a）聚焦「修 publish_tasks 架构 + 抖音 video 真发 + 扫码 UI + 建立 lead 自验机制」。Step 5 保持现状（昨天 WS1 实际是从本地文件夹选视频发布，不走 AI 生成），AI 生成 → Sprint 2.1b 单独处理。

---

## 1. Journey 上下文（v9 — 来自 5 问 Q1）

- **Journey 名称**：客户首次成功路径
- **Notion URL**：https://www.notion.so/358c40c2ba6381b2a6eacd288cf82f29
- **当前 Maturity**：not_started → skeleton（本 sprint 启动后）→ mvp 第一步
- **Journey Type**：user_facing
- **端到端步骤**（共 6 步）：
  - Step 1: 注册（含 free license 自动签发）
  - Step 2: 装客户端 + Agent 自动连中台
  - Step 3: 画像诊断（行业/受众/风格 3 字段）
  - Step 4: 扫码绑定平台（快手/**抖音**/...，Agent 弹登录窗）
  - Step 5: 准备内容 — **本 sprint 用本地文件夹视频**（Sprint 2.1b 升级到 AI 生成）
  - Step 6: 中台派任务 + 真发抖音 + 回执（**修架构 + 真发 + 路由按 type**）
- **E2E Test Path**：`.github/workflows/scripts/smoke/golden-path-1-smoke.sh`

## 2. Feature 清单（v9 — 来自 5 问 Q3）

| # | Feature 名称 | Journey Step | thickness from → to | 备注 |
|---|---|---|---|---|
| 1 | publish_tasks 加 type 字段 (DB migration) | Step 6 基础设施 | new → thin | 新 migration 加 `type TEXT NOT NULL DEFAULT 'image'` 字段，可选值 video/image/article，约束 + 索引 |
| 2 | 中台 createPublishTask 写 type | Step 6 | thin → medium | `apps/api/src/services/walking-skeleton.service.ts:223` 改写：API payload 接 type，写入 DB |
| 3 | Agent 路由按 type 选脚本（修硬编码 P0 bug） | Step 6 | 修 bug | 重写 `services/agent/src/handlers/douyin-publish.ts:55` `resolveDouyinScriptPath()`：按 type 拼接路径 + 找不到脚本时**显式报错**（绝不 fallback image） |
| 4 | `publish-douyin-video-dryrun.cjs` (CI 用) | Step 6 | new → thin | 真填字段、点到"等待发布按钮"页，不点最后按钮，避免污染公网 |
| 5 | `publish-douyin-video.cjs` 真发版 | Step 6 | new → thin | 真发视频到抖音公网，未登录时弹扫码窗等待 lead 手机扫码 |
| 6 | `publish-douyin-image.cjs` 增加扫码窗 | Step 6 | thin → thin+ | 现有真发版 image 脚本加"未登录弹扫码"逻辑（与 video 共享扫码模块） |
| 7 | 抖音首次扫码绑定 UI + 任务路由 | Step 4 扩展 | new → thin | Dashboard 加"绑定抖音"按钮 → 中台写 `qr_bind:douyin` 类任务 → Agent 弹抖音登录二维码 → lead 手机扫码 → cookie 落 Agent 本地（不入库不预置） |
| 8 | Step 6 中台派任务 + 回执 medium | Step 6 | thin → medium | 错误处理（脚本 nonzero exit 不静默）+ cookie 失效检测 + 4 环节日志（Dashboard/中台/Agent/脚本各打 type） |
| 9 | Lead 客户机自验机制 | （横切，所有 step）| new → thin | `.agent-knowledge/golden-path-1/lead-acceptance-sprint-2.1a.md` 模板 + **xian-pc** Windows 真机执行流程 + lead 手机扫码协作流程 + 后续 sprint 复用 |

**Step 5 (准备内容) 不在本 sprint 范围**：保持 WS1 现状（客户从本地文件夹选视频）。Sprint 2.1b 处理 AI 生成。

**加厚必填 `replaces_old_thin`**（按铁律 6 — 加厚先减肥再增肌，commit A 删旧 / commit B 写新）：

- Feature 3 修硬编码 bug：
  - **删除** `services/agent/src/handlers/douyin-publish.ts:55` 函数 `resolveDouyinScriptPath()` 整个函数硬编码 image 的 4 行
  - 替换为按 type 拼接路径 + 找不到脚本显式抛错的新版
- Feature 6 image 脚本加扫码：
  - **删除** `services/agent/publishers/douyin-publisher/publish-douyin-image.cjs` 内任何"假设已登录"直接发布的代码段
  - 替换为统一的"先检查登录状态，未登录弹码等扫码"前置流程
- Feature 8 Step 6 thin → medium 替换：
  - **删除** `services/agent/src/handlers/heartbeat-loop.ts` / `index.ts` 等 Agent 拉到任务后**静默吞错**的 catch 段（如有）
  - 替换为错误向中台回写 + 客户视角清晰错误信息

Feature 1/2/4/5/7/9 是新建（不需要删旧），不填 `replaces_old_thin`。

## 3. Feature 0：Journey 端到端验证（v9 — 来自 5 问 Q4，gating）

- **smoke 路径**：`.github/workflows/scripts/smoke/golden-path-1-smoke.sh`
- **验证范围**：从 Step 1 跑到 Step 6（全 6 步），Step 5 用本地视频文件占位
- **gating 规则**：Feature 0 FAIL = 整 sprint FAIL，不论其他 Feature 状态
- **Reviewer 必挑战项**（Proposer 起草合同时必须含）：
  - smoke 真的从 Step 1 跑到 Step 6？没中间 `exit 0` 假装通过？
  - smoke 在 Step 6 真创建 `publish_task {type:video}`，跑 video dryrun 脚本（不是 image）
  - DB migration 有真实测试：建表后 `\d publish_tasks` 含 type 字段，`INSERT WITHOUT type` 报 NOT NULL（或 default image）
  - Agent 路由按 type 真选对：mock 一个 `{platform:douyin, type:video}` 任务，断言 spawn 的脚本是 `publish-douyin-video*` 而不是 image
  - **找不到脚本时 Agent 显式报错并向中台回写 failed**，绝不 fallback image（这是修 bug 的核心）
  - 抖音 publisher（image / video）在未登录时真的弹扫码窗（不是静默失败 / 不是预置 cookie 跳过）
  - 4 环节日志真打 type：Dashboard 控件 onClick / 中台 createPublishTask / Agent heartbeat onTask / 脚本启动入参，每处都能 grep 到 `type=video`
  - Lead 自验 evidence 文件存在 + 含真发抖音视频公网 URL + 弹扫码窗截图（证明走真实新客户路径）

## 4. Lead 客户机自验（v9 — 来自 5 问 Q5，铁律 7）

- **worker_machine**：`xian-pc`（西安 Windows PC，Tailscale 已通：100.97.242.124，User: xuxia，ssh key 认证；xian-rog 当前 SSH 不可达本 sprint 不用）
- **协作模式**：lead 在 Mac mini 上 `ssh xian-pc` 远程操作 + lead 拿手机抖音 App 配合现场扫码
- **checklist**（≥5 步，按真实新客户视角顺序，**严禁预置 cookie 跳过扫码**）：
  1. `ssh xian-pc`（验证可达性）
  2. 在 xian-pc 浏览器打开 ZenithJoy Dashboard，**用全新邮箱注册**（注册后自动签发 free license + tenant，Step 1 thin 不动）
  3. 在 xian-pc 下载并安装客户端 + Agent，Agent 自动连接中台 heartbeat（Step 2 thin 不动）
  4. 填画像 3 字段（Step 3 thin 不动）
  5. 在 Dashboard 触发"绑定抖音"→ Agent 在 xian-pc 弹出抖音登录二维码窗口（Step 4 扩展，Feature 7 新增）
  6. **lead 拿手机抖音 App 扫码登录** → cookie 落 Agent 本地工作目录（不入库、不预置）
  7. 在 Dashboard **指定本地视频文件路径** + 标题/标签 + **指定 type=video** → 触发"发布"
  8. 中台 createPublishTask 写入 `{platform:douyin, type:video, payload:{video_path, title, tags}}` → Agent 拉任务 → **路由到 `publish-douyin-video.cjs`**（Feature 3 修 bug） → 用本地 cookie 真发到抖音公网（Feature 5）
  9. 在 lead 手机抖音 App 验证视频真出现 + 抓抖音公网视频 URL
  10. 把每步 cmd stdout + 弹扫码窗截图 + 抖音公网视频 URL 截图归档
  11. **额外验收**：在 xian-pc 上 `psql ... -c "SELECT type FROM zenithjoy.publish_tasks WHERE id=..."` 确认 DB 真存了 type=video（不是 NULL 不是 image），grep agent log 含 "type=video → spawn publish-douyin-video.cjs"
- **evidence_path**：`.agent-knowledge/golden-path-1/lead-acceptance-sprint-2.1a.md`
- **完成判据**：
  - evidence 文件存在
  - 含 cmd stdout 摘录（每步关键命令的输出）
  - 含抖音公网视频 URL（lead 在手机抖音 App 看得见的真实视频，截图）
  - 含弹扫码窗截图（证明走的是真实"新客户首次扫码"路径，没有偷懒预置 cookie）
  - lead 在 xian-pc 真跑过全链路（ssh stdout + 手机扫码协作）
  - **未自验或证据为空 = sprint 不能 deliver 给用户测真账号，整 sprint FAIL**
  - **若 evidence 含预置 cookie 跳过扫码的痕迹 = 不算合格 lead 自验，整 sprint FAIL**（这是真实客户场景的核心特征）

## 5. Golden Path（核心场景）

**入口**：客户在 xian-pc Windows 机器上，从 0 开始，**没有任何 ZenithJoy 账号、没装任何东西、抖音也没登录过**。

**关键步骤**：
1. 客户访问 ZenithJoy Dashboard，注册邮箱+密码 → 自动签发 free license + free tenant（Step 1，沿用 thin，本 sprint 不改）
2. 客户下载 ZenithJoy 客户端 + Agent，安装 → Agent 自动连接中台 heartbeat（Step 2，沿用 thin）
3. 客户填画像表单 3 字段：行业 / 受众 / 风格（Step 3，沿用 thin）
4. 客户在 Dashboard 触发「绑定抖音」→ **Agent 弹出抖音登录二维码窗口** → 客户用手机抖音 App 扫码 → cookie 落 Agent 本地（Step 4 扩展，Feature 7 新增；快手扫码沿用 thin）
5. 客户在 Dashboard **指定本地视频文件路径** + **指定 type=video** + 标题/标签等元数据（Step 5 沿用 WS1 现状，本 sprint 不动）
6. 中台 createPublishTask 写入 `{platform:douyin, type:video, payload:{video_path, title, tags}}`（Feature 1/2 新建 type 字段），Agent 拉任务 → 路由层读 type=video → spawn `publish-douyin-video.cjs`（Feature 3/5）→ 用本地 cookie 真发视频到抖音公网（Feature 8 medium 错误处理）
7. Agent 抓抖音返回的视频 URL，回填 publish_task.result → 中台 dashboard 显示「发布成功 + 视频 URL」

**出口**：客户在自己的手机抖音 App 看见刚发的视频（公网可见），在 ZenithJoy Dashboard 看见 ✅ 状态 + 抖音 URL。

**反 Golden Path**（本 sprint 必须明确不允许）：
- ❌ 不允许：在 xian-pc 上预置抖音 cookie，跳过 Step 4 扫码 — 这不是真实新客户场景
- ❌ 不允许：Step 6 中台下发 type=video 但 Agent 路由到 image 脚本（昨天的 P0 bug 根因）
- ❌ 不允许：找不到 video 脚本时悄悄 fallback image（必须显式报错）
- ❌ 不允许：发布失败但 Dashboard 显示成功

## 边界情况

- **抖音风控**：账号被风控 / cookie 失效 → 客户视角看到清晰错误"抖音登录失效，请重新扫码"。不允许静默失败
- **Agent 路由 type=article 没脚本**：抖音暂无 article 真发脚本 → Agent 显式向中台回写 failed + reason="该平台暂不支持 article 类型"，**严禁悄悄 fallback 到 image**（这是昨天 P0 bug 的根因）
- **video 文件路径不存在 / 不可读**：Agent 拉任务后立即检查文件 → 显式 failed + reason="视频文件不存在: <path>"
- **真发到一半失败**（如视频上传成功但发布按钮失败）→ Agent 必须返回 partial 状态 + 草稿 URL，不允许"看起来成了"
- **网络分区**：xian-pc 跟中台失联 → Agent 本地缓存任务，恢复连接后续传

## 范围限定

**在范围内**：
- publish_tasks 表加 type 字段（DB migration + 索引 + 约束）
- 中台 createPublishTask 接 type 参数 + 写入
- Agent 路由按 type 选脚本（修硬编码 image bug，找不到脚本显式报错）
- 抖音 video dryrun + 真发脚本（新建）
- 抖音 image 脚本统一加扫码窗逻辑
- 抖音首次扫码绑定 UI（Dashboard 按钮 + Agent 弹码 + cookie 落本地）
- Step 6 中台派任务 + Agent + 回执 thin → medium（4 环节 type 日志 + cookie 失效检测 + 错误回写）
- smoke 升级：测 type=video 路由路径
- Lead 自验机制建立（模板 + xian-pc 真机执行流程 + lead 手机扫码协作流程 + 证据归档）

**不在范围内**（明确排除，本 sprint 不做）：
- **Step 5 AI 生成内容（→ Sprint 2.1b 单独处理，包括 Claude API 集成 + prompt 工程 + 错误处理）**
- 其他 7 平台（快手 / 小红书 / 视频号 / 公众号 / 头条 / 知乎 / 微博）的真发 — 保持 thin / 占位
- 抖音 article 类型真发 — 不做（type 字段允许 article 但暂无脚本，Agent 路由报错"暂不支持"）
- xian-rog 接入（Tailscale / 凭据入库 → 下个 sprint 单独处理）
- 注册 UI 优化（→ Sprint 2.2）
- 画像 UI medium / 客户端安装 medium / 快手扫码绑定 medium（→ Sprint 2.3）
- super-admin / 运营后台
- 性能压测、监控告警、回滚预案（→ thick/mature 阶段）
- 多账号、cookie 持久化、跨机迁移（→ thick 阶段）— 本 sprint 每次跑都重新扫码即可

## 假设（Proposer 现状盘点已确认）

- ✅ [CONFIRMED 1]：xian-pc 通过 Tailscale 可达，已在 ~/.ssh/config（User: xuxia，IP 100.97.242.124），ssh key 认证可用
- ✅ [CONFIRMED 2]：lead 拿手机抖音 App 配合扫码（用户已确认愿意配合）
- ✅ [CONFIRMED 3]：Agent 选脚本代码在 `services/agent/src/handlers/douyin-publish.ts:55` 函数 `resolveDouyinScriptPath()`，硬编码返回 image 脚本（无 type 路由）
- ✅ [CONFIRMED 4]：Step 5 (AI 生成) 在 WS1 不存在，昨天 WS1 是用本地文件夹视频直接发布。本 sprint 不做 Step 5（→ Sprint 2.1b）
- ✅ [CONFIRMED 5]：现有脚本仅 `services/agent/publishers/douyin-publisher/publish-douyin-image{,-dryrun}.cjs` 2 个，video / article 都不存在
- [ASSUMPTION 6]：抖音平台对自动化发布的策略允许（不会立即风控）— 如果 lead 自验时被风控，evidence 标准从"真视频公网可见"降级为"真发布请求 + 抖音返回的处理中状态"，不算 sprint FAIL
- [ASSUMPTION 7]：xian-pc 上"可能已有抖音相关脚本"（用户提及）— Proposer 在写 contract 时 ssh 到 xian-pc 盘点常见目录，可复用就复用（如有则减少 sprint 工作量）
- [ASSUMPTION 8]：现有 `publish-douyin-image.cjs` 真发版能发图文成功（用户提及"昨天发了图文"）— 如果实际跑发现 image 真发也有 bug，sprint 范围扩大；contract 验证时 Generator 必须真跑过 image 真发脚本到出抖音 URL

## 预期受影响文件

**新建**：
- `apps/api/db/migrations/20260508_xxxxxx_publish_tasks_add_type.sql`：加 type 字段
- `services/agent/publishers/douyin-publisher/publish-douyin-video.cjs`：真发视频
- `services/agent/publishers/douyin-publisher/publish-douyin-video-dryrun.cjs`：CI 用
- `services/agent/publishers/douyin-publisher/lib/qr-login.cjs`（或类似）：扫码登录共享模块
- `apps/dashboard/src/...`（待 Proposer 定位）：抖音绑定按钮 + type 选择 UI
- `.agent-knowledge/golden-path-1/lead-acceptance-template.md`：自验模板
- `.agent-knowledge/golden-path-1/lead-acceptance-sprint-2.1a.md`：本 sprint evidence

**修改**：
- `services/agent/src/handlers/douyin-publish.ts:55`：`resolveDouyinScriptPath()` 重写，按 type 路由 + 找不到脚本显式抛错
- `services/agent/publishers/douyin-publisher/publish-douyin-image.cjs`：加扫码窗逻辑
- `apps/api/src/services/walking-skeleton.service.ts:223`：`createPublishTask()` 接 type 参数 + 写入 DB
- `services/agent/src/handlers/heartbeat-loop.ts` 或 `index.ts`：拉任务时读 type + 路由 + 错误回写
- `.github/workflows/scripts/smoke/golden-path-1-smoke.sh`：Step 6 用 type=video，验证 dryrun 跑了 video 脚本

**测试新建**（Sprint 2.1a 的 TDD Red 阶段）：
- `apps/api/tests/publish-task-type.test.ts`：DB migration + createPublishTask type 字段测试
- `services/agent/tests/douyin-route.test.ts`：路由按 type 选脚本 + 找不到脚本抛错测试
- `services/agent/tests/qr-login.test.ts`：未登录弹码逻辑测试（mock browser）

## journey_type: user_facing
## journey_type_reason: 涉及 Dashboard 客户操作 + 客户端安装 + 抖音真账号真发，端到端从客户视角贯穿，是 ZenithJoy 终端客户用的 path
