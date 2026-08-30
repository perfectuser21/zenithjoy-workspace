# Sprint PRD — 工作机控制塔可视化·第一刀：worker 活动协议 + 总览 + 实时详情

## OKR 对齐

- **对应 KR**：ZenithJoy 产品全线上线 — AI双线创作 + 小程序 + 网站 + Dashboard 可交付
- **当前进度**：77%
- **本次推进预期**：+3%（Dashboard 新增"工作机控制塔"可视化闭环第一刀）

## 背景

Dashboard 是控制塔，Windows 机 / 安卓机是平级 worker。前端只认"worker 活动协议"，执行器可换（现 AI+skill 驱动小龙虾，未来 Agent 代码）。本刀让主理人在 Dashboard 看到每台 worker 在干什么、干到第几步、画面实时、历史可查。

## Golden Path（核心场景）

主理人登录 Dashboard → 侧栏"工作机" → 看总览 → 点单台看实时详情 → 执行器上报把画面/步骤/历史刷活。

具体：
1. 登录后进入 `/dashboard/workers`：系统显示本租户全部 worker 卡片——类型（🖥️ Windows / 📱 安卓）、在线/离线（复用 `agents.last_seen > now-3min`）、当前状态（空闲 / 正在执行：<任务名> 第 x/y 步）、今日完成数。
2. 点某台 worker "实时"：进入详情页——左侧实时画面（MJPEG，最新帧超 15 秒显示"画面不可用"），右侧步骤流（✅/▶️/⬜ + 每步缩略截图 + 时间），底部该 worker 最近 20 条任务历史。
3. 执行器 `POST /api/workers/:agentId/tasks` 开始任务 → 卡片 1 秒轮询内变"正在执行：<任务名> 第 1/N 步"；`POST /api/workers/tasks/:id/steps` 逐条上报，详情页步骤逐条打勾、缩略截图可打开；`POST /api/workers/:agentId/frame` 推帧，`GET /api/workers/:agentId/live` MJPEG 同步变化。
4. 执行器 `POST /api/workers/tasks/:id/complete` → 卡片回"空闲"、今日完成数 +1，历史新增一条（结果 / 完成截图 / 耗时）。
5. 出错恢复：
   - `steps status=failed`：必带现场三件套（前台包名 `foreground_pkg` + 诊断行 `diag_line` + 截图），缺一 400；历史条目显示失败步骤 + 三件套。
   - 执行器失联：租约 sweeper 每 60s 扫 `running 且 lease_until < now` → `outcome=failed, error_code=executor_lost`，进历史，不自动重跑。
   - 画面流断（>15s 无新帧）：详情页显示"画面不可用"，任务状态不受影响。
   - 跨租户访问他人 worker 的 activity/live/截图 → 404（不泄露存在性）。

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导；此处仅锚定协议端点与状态语义 -->
worker 活动协议端点（协议锚定，字段类型交 Proposer 从 api_registry 定稿）：
- `POST /api/workers/:agentId/tasks` `{title, steps: string[], executor_id}` → `{task_id, lease_until}`（租约 10min，DB 时钟）；同 agent 已有 running 任务 → 409
- `POST /api/workers/tasks/:id/steps` `{step_index, status: doing|done|failed, screenshot_jpeg_b64?≤200KB, foreground_pkg?, diag_line?, note?, executor_id}` → 追加步骤 + 续租 10min；failed 时三件套必填缺一 400；executor_id 非租约持有者 → 409；任务非 running → 409
- `POST /api/workers/tasks/:id/complete` `{outcome: completed|failed|needs_review, evidence?, error_code?, failed_step?}` → 终态；failed 时 failed_step/error_code 必填
- `POST /api/workers/:agentId/frame`（JPEG ≤120KB）→ 保存最新帧（环形 ≤10 帧）
- `GET /api/workers/:agentId/live`（登录+租户校验）→ `multipart/x-mixed-replace` MJPEG，无新帧不重发旧帧
- `GET /api/workers`（登录，本租户）→ 卡片数据（不含截图正文）
- `GET /api/workers/:agentId/activity` → 当前任务+步骤（含截图 ref）+ 历史 20 条
- `GET /api/workers/steps/screenshots/:ref`（登录+租户校验）→ 截图

## 边界情况

- 空状态：本租户无 worker → 总览空态提示，不报错。
- 并发：同 agent 第二个 `POST tasks` → 409；`steps` 的 executor_id 非租约持有者 → 409。
- 截图缺失/损坏：缩略图占位，不阻断步骤流渲染；画面无新帧：`live` 不重发旧帧，15s 判"画面不可用"。

## 范围限定

**在范围内**：worker 活动协议 8 端点 + 租约 sweeper + 新表 `worker_tasks`/`worker_task_steps` + 截图落盘；Dashboard 总览页 `/dashboard/workers` + 实时详情页；租户隔离（跨租户 404）；假执行器 E2E（`E2E_FAKE_EXECUTORS`）+ smoke 进 CI。
**不在范围内**：任务派发/上传表单/内容入口；安卓端与 Windows Agent 推流代码；运营"待人工核实"页；`publish_tasks` 任何改动；其他平台剧本；专用执行器 token 与截图对象存储（先服务器盘）。

## 假设

- [ASSUMPTION: worker 卡片的类型/在线复用现有 `agents` 表（`os_type`/`last_seen`/`tenant_id`），本刀不新建 agent 注册流程]
- [ASSUMPTION: 租户上下文复用现有 tenant-context 中间件（如 `agent-machines.ts` 的鉴权模式），不引入新鉴权机制]
- [ASSUMPTION: staging 真机验收（AI 执行器驱动小龙虾发抖音）为人工验收项，不进 windows_cloud 自动 E2E]

## 预期受影响文件

- `apps/api/src/routes/workers.ts`：新增 worker 活动协议路由（新文件）
- `apps/api/src/app.ts`：挂载 `/api/workers` 路由（注意顺序，参照 `/api/agent/*` 精确前缀先注册约定）
- `apps/api/db/migrations/*`：新增 `zenithjoy.worker_tasks` + `zenithjoy.worker_task_steps` 迁移
- `apps/api/src/services/*`：租约 sweeper（60s）+ 截图落盘（`uploads/worker-shots/<tenant>/<task>/<step>.jpg`，30 天清理）
- `apps/dashboard/src/pages/WorkersPage.tsx` + worker 详情页：总览卡片 + 左画面/右步骤流/底部历史
- `apps/dashboard/src/config/navigation.config.tsx`：侧栏"工作机"入口 `/dashboard/workers`
- `.github/workflows/scripts/smoke/worker-activity-smoke.sh`：假执行器 smoke，进 CI

## NFR 约束

<!-- 来源: PrepPRD 显式值（主源）；decisions category=nfr 副源本次为空 -->
- 租约/续租：10 分钟（DB 时钟）；sweeper 扫描周期：60 秒
- 截图大小：steps `screenshot_jpeg_b64` ≤200KB；frame JPEG ≤120KB；帧环形缓存 ≤10 帧
- 画面时效：`live` 最新帧超 15 秒判"画面不可用"；无新帧不重发旧帧
- 轮询时效：总览卡片状态变更 1 秒轮询内可见
- 截图留存：落服务器盘 `uploads/worker-shots/<tenant>/<task>/<step>.jpg`，30 天清理
- 可观测：执行器失联/失败必须落库（`error_code`）；日志脱敏，不落敏感凭据

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级 + CLAUDE.md 93ed0761 -->
- [租户隔离] worker activity/live/截图 按租户隔离；跨租户访问一律 404，不泄露存在性（来源: area）
- [端点鉴权] 所有 worker 端点须登录鉴权；tenant_id 取自 session，绝不信客户端 query（来源: area）
- [失败现场] step `status=failed` 必带前台包名 + 诊断行 + 截图三件套，缺一 400（来源: CLAUDE.md 93ed0761 / lint-rpa-failure-scene）
- [多设备UI区分] worker 卡片必须按 os_type 区分 🖥️ Windows / 📱 安卓，设计与审查阶段强制检查（来源: area）
- [表名认领] 新建 worker_tasks/worker_task_steps 前须 grep 全部写入方；本刀不动 publish_tasks（来源: area）
- [测试多租户] E2E 默认多租户，跨租户 404 必测（来源: area）
- [日志脱敏/凭据安全] 截图与日志不得泄露凭据，敏感信息脱敏（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

（本 line 暂无历史：journey 24987ee5 尚无已投影的 done/working ability）

## E2E 验收

> Planner 初稿此区块留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=windows_cloud 产出 `.github/workflows/scripts/smoke/worker-activity-smoke.sh`（假执行器 `E2E_FAKE_EXECUTORS`）。

```bash
# 占位：proposer 将按 target_environment=windows_cloud 填入真实脚本（假执行器 E2E_FAKE_EXECUTORS）
# 期望验收点（自然语言）：
# 1. 登录后 GET /api/workers 列出 ≥1 android + ≥1 win32 worker 卡片，含 🖥️/📱 与在线状态
# 2. POST tasks + 3 条 steps(done) → 1 秒轮询内卡片"正在执行 … 第 3/5 步"，activity 3 条 ✅ 且缩略截图可打开
# 3. POST frame ×5（不同内容）→ GET live 10 秒内输出 ≥2 帧且相邻帧 hash 不同；停推 15 秒后判"画面不可用"
# 4. steps failed 缺三件套 → 400；带三件套 → 历史显示失败步骤 + 前台包名 + 诊断行 + 截图
# 5. 另一租户会话访问该 worker activity/live/截图 → 404
# 6. 短租约过期 → 任务变 failed/executor_lost，不新增任务
# 7. 同 worker 第二个 POST tasks → 409
```

## journey_type: user_facing
## journey_type_reason: 核心交付是 apps/dashboard 的控制塔总览页与实时详情页（用户直接操作的 Web UI）
## target_environment: windows_cloud
## target_environment_reason: thin_prd 明确 E2E 用假执行器在 windows_cloud（GitHub Actions windows-latest）跑；含 android 关键词，windows_cloud 干净 VM 规避 theater_mismatch 误触
## journey_id: 24987ee5-53a0-4c37-946f-1b749954cac7
## step_id: none（PrepPRD 未锚定 Step code）
