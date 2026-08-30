# Sprint PRD — 工作机控制塔可视化·第一刀：worker 活动协议 + 总览 + 实时详情

## OKR 对齐

- **对应 KR**：ZenithJoy 产品全线上线 — AI 双线创作 + 小程序 + 网站 + Dashboard 可交付
- **当前进度**：77%
- **本次推进预期**：+3%（Dashboard 可交付面新增"工作机控制塔"可视化）

## 背景

Dashboard = 控制塔；Windows 机 / 安卓机是平级 worker。前端只认一套"worker 活动协议"，执行器可换（现为 AI + skill 驱动小龙虾，未来换 Agent 代码）。本刀交付第一段可视链路：主理人能在 Dashboard 看到每台 worker 在做什么、做到第几步、画面长什么样、历史结果如何。

## Golden Path（核心场景）

主理人从 [登录 Dashboard] → 经过 [看总览 / 看实时详情 / 看执行过程 / 看结果与失败现场] → 到达 [对全部 worker 活动一目了然]。

具体：
1. 主理人登录 Dashboard → 侧栏"工作机" `/dashboard/workers` → 系统显示本租户全部 worker 卡片：类型（🖥️ Windows / 📱 安卓）、在线/离线（复用 `agents.last_seen > now-3min`）、当前状态（空闲 / 正在执行：<任务名> 第 x/y 步）、今日完成数
2. 主理人点某台 worker 卡片"实时" → 详情页：左实时画面（MJPEG，最新帧超 15 秒显示"画面不可用"），右"AI 正在做"步骤流（✅/▶️/⬜ + 每步缩略截图 + 时间），底部该 worker 最近 20 条任务历史
3. 后台执行器 `POST /api/workers/:agentId/tasks` 开始任务、逐条 `POST .../tasks/:id/steps` 上报 → 1 秒轮询内卡片变"正在执行：<任务名> 第 x/y 步"，详情页步骤逐条打勾、画面随 `POST .../frame` 同步变化
4. 执行器 `POST .../tasks/:id/complete` 上报完成 → 卡片回"空闲"、今日完成数 +1，历史新增一条（结果 / 完成截图 / 耗时）
5. 出错恢复：
   - 上报失败（`status=failed`）→ 历史条目显示失败步骤 + 现场三件套（前台包名 / 诊断行 / 截图）；缺三件套则 400，执行器无法造假成功
   - 执行器失联（租约过期，无上报）→ sweeper 每 60 秒扫 running 且 `lease_until < now` → 标 `outcome=failed, error_code=executor_lost` 进历史，**不自动重跑**
   - 画面流断 → 详情页"画面不可用"，任务状态不受影响
   - 跨租户访问他人 worker 的 activity/live/截图 → 404（不泄露存在性）

## 边界情况

- 同一 agent 已有 running 任务时再 `POST tasks` → 409
- `POST steps`/`complete` 时 executor_id 与租约持有者不符、或任务已非 running → 409（执行器收到 409 必须停手）
- `frame` 环形缓存 ≤10 帧；`GET live` 无新帧时不重复发旧帧
- 截图/帧超限（steps 截图 >200KB、frame >120KB）拒绝

## 范围限定

**在范围内**：worker 活动协议 8 类端点（tasks / steps / complete / frame / live / 总览 / activity / 截图取回）；租约 10min + sweeper 60s；新表 `worker_tasks` / `worker_task_steps`；截图落盘；`/dashboard/workers` 总览页 + 实时详情页；租户隔离；假执行器 E2E（`E2E_FAKE_EXECUTORS`）+ smoke 进 CI。

**不在范围内**：任务派发 / 上传表单 / 内容入口；安卓端与 Windows Agent 推流代码；运营处理"待人工核实"页；`publish_tasks` 任何改动；其他平台剧本；专用执行器 token 与截图对象存储（先用服务器盘）。

## 假设

- [ASSUMPTION: worker 卡片列表来源 = 现有 `agents` 表（含 win32/android 类型与 last_seen），本刀用 stub agents 兜底演示 ≥1 android + ≥1 win32]
- [ASSUMPTION: 帧/最新帧存储先用内存或服务器盘环形缓存，重启丢失可接受（本刀不做持久帧）]
- [ASSUMPTION: staging 真机验收由 AI 执行器人工驱动小龙虾，不进 CI 自动化]

## 预期受影响文件

- `apps/api/src/routes/workers.ts`: 新增 worker 活动协议全部端点（新文件）
- `apps/api/src/app.ts`: 挂载 workers 路由
- `apps/api/db/migrations/*_worker_tasks.sql`: 新表 `zenithjoy.worker_tasks` + `zenithjoy.worker_task_steps`
- `apps/api/src/services/*`: 租约 sweeper（60s）+ 截图落盘/取回
- `apps/dashboard/src/pages/WorkersPage.tsx` + worker 详情页: 总览卡片 + MJPEG/步骤流/历史
- `apps/dashboard/src/config/navigation.config.ts`: 侧栏加"工作机"入口
- `.github/workflows/scripts/smoke/worker-activity-smoke.sh`: smoke 进 CI

## NFR 约束

<!-- 来源: PrepPRD 显式值优先；decisions 表 category=nfr 空 -->
- 租约/时钟：任务租约 10 分钟（DB 时钟）；sweeper 每 60 秒扫一次
- 帧新鲜度：详情页最新帧超 15 秒 → 显示"画面不可用"；卡片轮询 1 秒内反映最新步/状态
- 体积上限：step 截图 ≤200KB；frame JPEG ≤120KB；帧环形缓存 ≤10 帧
- 存储/清理：截图落 `uploads/worker-shots/<tenant>/<task>/<step>.jpg`，30 天清理
- 可观测：任务失败必须留现场三件套（前台包名 / 诊断行 / 截图），缺一不得判成功

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step/feature 源空，area 源筛出域相关两条 -->
- [失败现场三件套] worker 步骤 `status=failed` 必带 前台包名 + 诊断行 + 截图，缺一 400；不得凭空判成功（来源: area / CI `lint-rpa-failure-scene`，CLAUDE.md invariant `93ed0761`）
- [租户隔离] worker 的 activity/live/截图 按租户隔离，跨租户访问一律 404，不泄露存在性（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 journey 已完成 ability 的 golden_path；journeys/:id/golden-paths 返回空 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=windows_cloud 产出（GitHub Actions windows-latest + `E2E_FAKE_EXECUTORS` 假执行器），写进 `.github/workflows/scripts/smoke/worker-activity-smoke.sh` 与 contract-draft.md 的 `## E2E 验收` 区块。

```bash
# 占位：proposer 将填入 windows_cloud 假执行器脚本（起 api + E2E_FAKE_EXECUTORS，curl 协议端点 + Playwright 验页面）
# 期望验收点（自然语言）：
# 1. 登录后 /dashboard/workers 列出 ≥1 台 android + ≥1 台 win32 卡片，含 🖥️/📱 与在线状态
# 2. 假执行器 POST tasks + 3 条 steps(done) → 1 秒内卡片"正在执行 … 第 3/5 步"，详情页 3 条 ✅ 缩略截图可打开
# 3. 假执行器 POST frame ×5(不同内容) → GET live 10 秒内 ≥2 帧且相邻帧 hash 不同；停推 15 秒后详情页"画面不可用"
# 4. steps failed 缺三件套 → 400；带三件套 → 历史显示失败步骤 + 前台包名 + 诊断行 + 截图
# 5. 另一租户会话访问该 worker 的 activity/live/截图 → 404
# 6. 短租约过期 → 任务变 failed/executor_lost，不新增任务；同 worker 第二个 POST tasks → 409
# 7. smoke 脚本进 CI，CI 全绿
```

## journey_type: user_facing
## journey_type_reason: 交付面含 apps/dashboard 的 /dashboard/workers 总览页与实时详情页，是主理人直接使用的 UI。
## target_environment: windows_cloud
## target_environment_reason: payload 显式指定 E2E 用假执行器在 GitHub Actions windows-latest 干净 VM 跑（真机小龙虾验收由 AI 执行器人工驱动，不进 CI）。
## journey_id: 24987ee5-53a0-4c37-946f-1b749954cac7
## step_id: none（PrepPRD 未锚定；gp_anchor=line01/customer_first_success keep-green）
