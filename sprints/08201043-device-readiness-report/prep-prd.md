# PrepPRD：设备就绪度上报第一刀（链路打通，不含 Dashboard 渲染）

task-id: c2d965cd-7aa1-41a3-97ac-8aca1f6fb31f
GP-Anchor: line02/keyword_acquisition keep-green
决策: bb90e20a（归位）/ 3a826c45（判定点 fail-open）/ f57bab74 / 44cb3e8e

## 客户/客服视角
客服打开中台就能看到「这台客户手机准备好了没有，没好是卡在哪一项」，
而不是等客户打电话说"你们软件不好使"。

## 归位（决策 bb90e20a）
不是新路。半A（客户装机自己看得懂）归 line01/customer_first_success·step2 加厚，
PR #1674 已是该格第一刀；半B（客服看得见）归 line10/customer_management 的
诊断页一族，新挂片 d341af04「客户安卓设备就绪度诊断」。

## 复用已有机制，不重新发明
心跳里已有 `module_status`（per-Line preflight）→ `agents.module_status` jsonb →
`GET /api/agent/module-health` 出矩阵。**就绪度语义不同**（设备级权限 vs per-Line 模块），
不塞进同一个字段混语义，但**沿用同款形态**：上报 → 归一 → 落库 → 矩阵读出。

## 本刀范围
1. 迁移：`agents` 加 `readiness` jsonb + `readiness_at` timestamptz
2. 设备端：把已有判据（无障碍三服务真 Bound / 变体包冲突 / 截图授权 / 录音权限）
   汇成 readiness 随心跳上报；**必须周期性复检**（见下方 P0-1）
3. 服务端：heartbeat 接收 + 归一 + 落库；**合入服务端自己知道的 license_machines 绑定**
   （见 P0-2）；GET 端点可查
4. 不含 Dashboard 渲染（第二刀，且 ZenithJoy UI E2E 必须走 windows_cloud）

## 三镜头对抗揪出的 P0（已纳入本刀）
- **P0-1 就绪不是一次性状态，是会掉的**：force-stop 后系统整体关无障碍（0717 实证）、
  `adb install -r` 静默撤销无障碍（0803 实证）。只在 initAgent 查一次 = 又造一个假绿。
  → 必须周期性复检。
- **P0-2 license 绑定必须算进就绪度**：小白此刻每 26 秒被中台拒一次
  （`license 配额已满(1/1)`），`license_machines` 绑不上。设备端不知道自己被拒了，
  只有服务端知道 → 总判定必须由服务端合成。
- **P0-3 拿不到 readiness 时怎么办**：主理人 2026-08-20 拍板 **照派（fail-open）**，
  只有设备明确上报「未就绪」才拦。→ 三态：`ready` / `not_ready` / `unknown`，
  只有 `not_ready` 才是"别派给它"，`unknown` 一律当能干。

## 判定点登记表
| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ 中台拿不到 readiness 时该设备算不算可用 | ①fail-open 照派 ②fail-closed 不派 ③按 agent 版本号分档 | ①fail-open（决策 3a826c45） | 主理人拍板：新字段上线初期新旧版本共存，fail-closed 会把一堆正常设备全停掉；现状本就是全部照派 | fail-open 误判→任务石沉大海（现状同款）；fail-closed 误判→整个机队被判死且无逃生口，更重 |
| 设备端「某项权限是否就绪」 | ①Secure Settings 字符串 ②getEnabledAccessibilityServiceList 真 Bound + 本进程包名 | ② | 决策 44cb3e8e / 铁律 2dc450f7「判据必须用不会撒谎的那个」 | 上报假绿 → 中台以为就绪、任务照派、静默失败（正是要根治的问题） |

## 验收标准
- [ ] commit-1 失败测试先提交
- [ ] commit-2 实现让测试变绿
- [ ] proven-to-fire 变异测试
- [ ] CI 全绿
