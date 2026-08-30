# PrepPRD：安卓端多平台自动发布 — 工作机控制塔可视化 · 第一刀（worker 活动协议 + 总览 + 实时详情）

## 本次对话涵盖的所有事项（防信息丢失）
- [x] 本 PrepPRD 包含：worker 活动协议（中台 API）+ 控制塔总览页 `/dashboard/workers` + worker 实时详情页（画面 + 步骤流 + 历史）+ AI 执行器按协议上报 + 租户隔离 + CI E2E（假执行器）+ staging 真机验收
- [ ] 另立 Sprint（本次不做）：任务派发到指定 worker（取代"当前机器"隐式绑定）；上传/内容入口；安卓 Agent 自推画面（MediaProjection）；Windows Agent 自截屏推流；运营处理"待人工核实"页；安卓端发布代码化（等 AI 执行跑稳后按同一协议换执行器）
- [ ] 待讨论：视频号/知乎绑手机号；B 站风控冷却后重投

## 背景与概念（主理人 2026-08-30 拍板）
- 老概念：Windows 机 = "干活的那台机"，Dashboard 有全局"当前机器"选择器，任务隐式绑定；看不到任何 worker 在干什么。
- 新概念：**Dashboard = 控制塔**（任何地方打开），**Windows 机 / 安卓机 = 平级的 worker**；每台 worker 可见：在线、正在执行什么、第几步、实时画面、历史。
- 核心设计：**前端只认一个"worker 活动协议"**，谁在背后执行不关心——现在是 AI+skill 执行器（Claude 会话经 ADB 驱动小龙虾），未来是 Windows Agent / 安卓 Agent 代码执行器；代码化 = 换执行器实现同一协议，前端一行不改。协议里每步的耗时/成败即"哪些步骤该代码化"的数据源。

## Journey 当前状态（journey 24987ee5 安卓端多平台自动发布，line01）
- 🔄 抖音/小红书/快手/头条/微博 视频发布（安卓真机）— building（手驱剧本 skill 已真机验证）
- ⬜ 微信视频号/知乎 — planned（卡绑手机号）
- ➕ 本次新增 Feature：worker 活动协议 + 控制塔可视化（kind=feature，thin）

## 本次要做的
主理人在 Mac 打开 Dashboard 就能看到名下所有 worker（Windows + 安卓）各自在干什么，点开任意一台看实时画面和 AI 的每一步；执行器通过统一协议上报。

## Golden Path（用户操作流程，单线性）
1. 主理人在 Mac 登录 Dashboard → 侧栏"工作机" `/dashboard/workers` → 系统显示本租户全部 worker 卡片：类型（🖥️ Windows / 📱 安卓）、在线/离线（复用 agents.last_seen > now-3min）、当前状态（空闲 / 正在执行：<任务名> 第 x/y 步）、今日完成数 → 状态：总览可见
2. 主理人点小龙虾卡片"实时" → 系统显示详情页：左实时画面（MJPEG，最新帧超 15 秒显示"画面不可用"），右"AI 正在做"步骤列表（✅/▶️/⬜ + 每步缩略截图 + 时间），底部该 worker 最近 20 条任务历史 → 状态：详情可见
3. 后台执行器开始一个任务（AI 驱动小龙虾发布抖音）→ 系统 1 秒轮询内把卡片变"正在执行：发布视频到抖音 第 1/10 步"，详情页步骤逐条打勾、画面同步变化 → 状态：执行中可见
4. 执行器上报完成 → 系统把卡片回"空闲"、今日完成数 +1，历史新增一条（结果 / 完成截图 / 耗时）→ 状态：结果可查
5. 出错恢复：
   - 执行器上报失败 → 历史条目显示失败步骤 + 现场三件套（前台包名 / 诊断行 / 截图）；主理人知道在哪一步、看到当时画面
   - 执行器失联（租约过期，10 分钟无上报）→ 该任务显示"执行中断"进历史，不自动重跑；主理人可重新触发（本刀不做触发入口，由执行器侧重跑）
   - 画面流断 → 详情页显示"画面不可用"，任务状态不受影响
   - 跨租户访问他人 worker 的 activity/live → 404（不泄露存在性）

## 客户视角
打开"工作机"页，一眼看到每台机器在忙什么；点开就是它的屏幕和 AI 的每一步；失败时能看到卡在哪一步、当时画面。

## 完成后用户能
1. 在任何设备打开 Dashboard 看到全部 worker 的实时状态（不再需要坐在 Windows 机前）
2. 给客户演示"AI 在操作手机"：画面 + 步骤打勾同屏
3. 从任务历史里看出每步耗时与失败分布，为后续代码化提供依据

## 涉及的 Ability / Feature
- worker 活动协议 + 控制塔可视化（新增 Feature，thin，挂 journey 24987ee5）

## Worker 活动协议（中台新增，internal-token 鉴权）
- `POST /api/workers/:agentId/tasks` 开始任务 `{title, steps: string[], executor_id}` → `{task_id, lease_until}`（租约 10 分钟，DB 时钟）；同 agent 已有 running 任务 → 409
- `POST /api/workers/tasks/:id/steps` `{step_index, status: doing|done|failed, screenshot_jpeg_b64?≤200KB, foreground_pkg?, diag_line?, note?, executor_id}` → 追加步骤并续租 10 分钟；`status=failed` 时 `foreground_pkg + diag_line + screenshot` 三者必填，缺一 400（满足 lint-rpa-failure-scene）；executor_id 与租约持有者不符 → 409；任务已非 running → 409（执行器收到 409 必须停手）
- `POST /api/workers/tasks/:id/complete` `{outcome: completed|failed|needs_review, evidence?: {screenshot_jpeg_b64?, summary?}, error_code?, failed_step?}` → 终态；failed 时 failed_step/error_code 必填
- `POST /api/workers/:agentId/frame` 推画面帧（JPEG ≤120KB）→ 中台保存最新帧（内存/文件，环形 ≤10 帧）
- `GET /api/workers/:agentId/live`（登录 + 租户校验）→ `multipart/x-mixed-replace` MJPEG，无新帧时不重复发旧帧
- `GET /api/workers`（登录，本租户）→ 卡片数据（不含截图正文）；`GET /api/workers/:agentId/activity` → 当前任务 + 步骤（含截图 ref）+ 历史 20 条
- `GET /api/workers/steps/screenshots/:ref`（登录 + 租户校验）→ 截图
- 租约 sweeper 每 60 秒：running 且 lease_until < now → outcome=failed, error_code=executor_lost，不自动重跑
- 存储：新表 `zenithjoy.worker_tasks`（id, tenant_id, agent_id, title, executor_id, status running|completed|failed|needs_review, steps_total, current_step, started_at, finished_at, failed_step, error_code, lease_until, evidence jsonb）+ `zenithjoy.worker_task_steps`（task_id, step_index, title, status, screenshot_ref, foreground_pkg, diag_line, note, created_at）；截图落 `uploads/worker-shots/<tenant>/<task>/<step>.jpg`，30 天清理；**不动 publish_tasks**

## AI 执行器接入（不写安卓端代码）
- 执行器 = Claude 会话 + `android-*-publish` skill，按上述协议上报（替换今天演示用的 steps.json 文件方式）
- 画面 = rog 侧推帧器（今天的 PowerShell MJPEG 服务改为每帧 `POST /frame`，仅在有 running 任务或有人观看时推）

## 判定点登记表
| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| worker 在线 | 90s / 2min / 3min | 复用 agents.last_seen > now-3min（agent-machines.ts 现有规则） | 单一来源，不新增阈值 | 卡片状态滞后 ≤3 分钟 |
| 执行器存活 | 独立心跳 / 事件续租 | 上报即续租 10 分钟，判断只用 DB now() | 与事件解耦、无本地时钟漂移 | 误判失联 → 任务标 executor_lost，不重跑（无重复发布风险） |
| 画面可用 | 帧率阈值 / 帧龄 | 最新帧年龄 > 15 秒判不可用 | 现有推流 1-2 fps 基线 | 仅 UI 提示，不影响任务 |
| 同一 worker 单任务 | 无约束 / DB 约束 | 部分唯一索引 (agent_id) WHERE status='running' | 防双执行器同时操作 | 第二个任务 409 |

## 前置工作（已逐项确认，无 TBD）
### 账号与登录
- [x] Dashboard 登录：飞书登录；E2E 走 `E2E_SUPER_ADMIN_EMAIL/E2E_SUPER_ADMIN_PASSWORD`（GHA Secrets 已存在）
### API 与凭据
- [x] 执行器 internal token：`ZENITHJOY_INTERNAL_TOKEN`（internal-auth.ts 现有机制）
### E2E 测试账号
- [x] 同上 super admin；跨租户用例用第二个 stub 租户
### 测试 Fixture
- [x] 假执行器（`E2E_FAKE_EXECUTORS` 机制已存在）产出步骤与 JPEG 帧（ffmpeg 合成渐变图或 1x1 JPEG）
- [x] staging 真机：小龙虾 agent 行 `55f42f1e`（租户 `455a8ca9`）在线；rog ADB + MJPEG 通道在线
### 基础设施
- [x] target_environment=windows_cloud（ZenithJoy UI E2E 死规则）；staging 部署走现有流程

## 验收标准（Final E2E，windows_cloud + 假执行器）
- [ ] 登录后 `/dashboard/workers` 列出 ≥1 台 android + ≥1 台 win32 worker 卡片（stub agents），含 🖥️/📱 与在线状态
- [ ] 假执行器 `POST tasks` + 3 条 `steps(done)` → 1 秒轮询内卡片显示"正在执行 … 第 3/5 步"，详情页 3 条 ✅ 且缩略截图可打开
- [ ] 假执行器 `POST frame` ×5（不同内容）→ `GET live` 10 秒内输出 ≥2 帧且相邻帧 hash 不同；停止推帧 15 秒后详情页显示"画面不可用"
- [ ] `steps failed` 缺三件套 → 400；带三件套 → 历史条目显示失败步骤 + 前台包名 + 诊断行 + 截图
- [ ] 另一租户会话访问该 worker 的 `activity`/`live`/截图 → 404
- [ ] 租约过期（测试用短租约）→ 任务变 failed/executor_lost，不新增任务
- [ ] 同 worker 第二个 `POST tasks` → 409
- [ ] 主理人 staging 真机验收：AI 执行器驱动小龙虾发布一条抖音（私密）全程在页面可见（画面动 + 步骤打勾 + 历史入账）
- [ ] smoke 脚本 `.github/workflows/scripts/smoke/worker-activity-smoke.sh` 进 CI，CI 全绿

## 不包含
- 任务派发/上传表单/内容入口；安卓端与 Windows Agent 推流代码；运营处理"待人工核实"页；publish_tasks 改动；其他平台剧本；专用执行器 token 与截图对象存储（先服务器盘）

## 关联
- 决策 9f297223（安卓四平台立项）；journey 24987ee5；父任务 e4fd8c69；skill 手册：android-publish / android-douyin-publish 等（worktree 待提交）
