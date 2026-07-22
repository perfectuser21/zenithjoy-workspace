# 作战窗 Agent Panel（全局 AI 状态面板）设计方案

> 日期：2026-07-22（brainstorm 于 07-21 完成）
> 状态：设计定稿，未立刀
> 相关决策：2e47a08c（harness 第6问：常驻桌面UI场景矩阵）、c7022118（刀B安装框架，本 feature 的供给地基）
> 排序：刀B安装框架先行，作战窗刀1 紧随其后

## 0. 问题与动机

ZenithJoy 交付形态割裂：客户侧只有 ① 静默的托盘 agent、② line04 单场景 overlay 画像卡、③ 远端中台 dashboard（看结果不看过程）。后果：

- **运营者（主理人）**：看不出 AI 是卡住了还是在干活、卡在哪一步——line04 两个月的排障痛点全源于此
- **客户**：感知不到"AI 在替我干活"，AI 干活越安静，感知价值越低

解法：**一根事件脊柱 + 一个桌面壳 + 按受众分级的两个视图**。不是第四张皮，是收敛现有三张皮。参考业界模式（AG-UI 事件协议 / Omnara 汇报式 agent / 桌面伴生 widget），无现成产品可直接用，架构模式借鉴。

## 1. 总体架构

```
┌─────────── 客户 PC ───────────┐      ┌──── 中台 (hk-vps) ────┐
│ line04 wechat-rpa ─┐               │      │                        │
│ 发布/其他 handler ──┼→ 事件总线    │      │  events 表(按租户)      │
│ agent 核心任务流 ───┘  (agent 内)  │──→──│  聚合 API + SSE 推送    │
│         │                          │      │       │                │
│         ↓ 本地 SSE (localhost)     │      │       ↓                │
│ ┌────────────────────┐    │      │  dashboard「实时动态」页 │
│ │ WebView2 壳(浮条/面板)  │←──┼──←───│  (运营者远程巡检)        │
│ │ apps/agent-panel 网页   │    │      └────────────────────────┘
│ └────────────────────┘    │           ↑
└──────────────────────────┘      Android agent 事件也上报到这里
```

- 本机事件**直推**本地壳（断网可看本机状态），**同时**上报中台落库
- 跨设备（Android 挖客）事件走已有 agent→中台通道，中台按租户聚合，PC 壳订阅合并显示
- 面板是**旁观者**：事件打点 fire-and-forget，总线/壳/中台任一挂掉都绝不影响 handler 干活

## 2. 事件规范（6 种，步骤级粒度）

```jsonc
{
  "event": "step",              // task_started | step | waiting | stuck | done | failed
  "task_id": "...",
  "line": "line04",             // line02 / line04 / publish / ...
  "device": "xian-pc",          // 哪台设备在干（含 os_type，第一天就带，UI 泳道按设备分列）
  "title": "回复客户张三",       // 业务语言，客户可见
  "detail": "第2/5步：读取对话历史",
  "progress": [2, 5],
  "severity": "info",           // info | warn | error → 灯色
  "ts": "..."
}
```

**看门狗**：stuck 不靠 handler 自觉——事件总线对每个 task_started 起超时看门狗，超时无后续事件即总线自发 stuck 亮红灯（handler 卡死时它自己发不出"我卡了"）。

## 3. 壳：WebView2 三态窗口

- **技术选型**：无边框原生窗口 + Windows 系统自带 WebView2（Chromium 内核）渲染 `apps/agent-panel` 网页。视觉上限 = 网页上限，直接复用 Cecelia Warroom 设计语言（slate 深底/细边框/uppercase 小标签/等宽数字/状态灯点）。否决 Electron（200MB 第四张皮）与 pywebview 承载（业务模块承载产品壳 = 层次倒挂，且供给链脆弱史）。
- **收起态（默认）**：屏幕边缘细灯带（约4-6px，hover 热区略宽），每条业务线一个灯（绿=干活/蓝=空闲/黄=等待/红=stuck）。
- **展开态**：热键/托盘召唤，Warroom 风格面板：当前任务卡片、各线×各设备泳道、最近完成流水。
- **托盘**：保留，点击=召唤/隐藏；热键 Ctrl+Alt+Z（热键路线已真机验证 PR#1410/#1420）。
- **供给链**：WebView2 Runtime preflight 检测 + Evergreen Bootstrapper 兜底补装，失败上报红灯，禁静默降级——完全套用刀B安装框架纪律（decision c7022118）。

## 4. 场景×显示策略矩阵（harness 第6问，decision 2e47a08c）

| 场景 | 显示行为与共存约束 |
|---|---|
| **微信 RPA 进行中** | 壳窗口 `WS_EX_NOACTIVATE` 永不夺焦（继承 B 方案 PR#811/812 验证结论）；收起态浮条 `WS_EX_TRANSPARENT` 鼠标穿透——即使叠在最大化微信上，RPA 坐标点击永不误点面板，展开靠热键/托盘；展开态检测 desktop-lease-broker 租约（#1403 现成机制），RPA 操作中面板自动贴对侧屏幕边缘且保持穿透只读；绝不 cloak/挪微信窗口（E_ACCESSDENIED 教训） |
| **活在安卓手机上** | PC 面板独立泳道显示（"📱 挖客中 第3/5步"），数据走中台聚合（刀2）；刀1 阶段该泳道显示"未接入"占位，不隐藏；手机屏幕上不做任何显示，感知入口统一在 PC + dashboard |
| **客户前台全屏**（视频/PPT/游戏） | 前台全屏检测 → 浮条自动隐藏，退出恢复；stuck 红灯例外：不弹窗不闪烁，仅托盘图标变红 |
| **锁屏/无人值守** | 壳低功耗静默，事件照常落盘+上报；解锁后面板回放离开期间流水；运营者远程从 dashboard 看（刀2） |
| **多设备泳道** | 事件 schema 第一天带 device/os_type，泳道按设备分列（decision 8dbe91ee 教训：字段有但 UI 不接线=白做） |
| **刀C 画像卡归宿** | "贴着微信的客户情报小卡"保留独立小窗形态，但改由面板壳统一渲染（同一 WebView2 宿主第二窗口），pywebview 供给链退役——全局面板管全局状态，画像卡管贴身情报，一个宿主两个窗一条供给链 |

## 5. UI 与部署形态

- `apps/agent-panel/`：React + Tailwind，一套组件两处挂载——本地壳加载本地构建产物；中台 dashboard 挂"实时动态"页供运营者远程巡检
- 两级视图：客户视图（业务语言、脱敏，刀3）/ 运维视图（技术细节）
- 壳进程独立于 agent 核心；agent 心跳加 `panel ok:true/false`（复用刀A overlay 进心跳模式），壳挂了中台可见

## 6. 刀法切分与 Golden Path 锚定

| 刀 | 内容 | 锚定 Path | 交付判据（回流 smoke） |
|---|---|---|---|
| **刀1** | 事件规范+agent事件总线+看门狗+line04打点+WebView2浮条/面板（本机闭环；中台仅加 events 表+写入端点） | **Path 4**（保持 GP-4 全绿 + 新增面板可见性 Step：壳进程活+SSE连通+任务事件到达；掐死 handler→看门狗 stuck 红灯，变异测试 proven-to-fire） | `golden-path-4-smoke.sh` |
| **刀2** | 中台聚合 SSE+dashboard 实时动态页+Android 打点 | **Path 2**（Step 8 挖客闭环可见性；顺带根治"Stage1 中途静默放弃不报告"） | `golden-path-2-smoke.sh` |
| **刀3** | 客户视图脱敏分级+刀C画像卡视图合流 | **Path 4** + Path 1（Step 2 装客户端体验） | GP-4 / GP-1 |

**Harness 6 问预填（刀1）**：Q1=Path 4（Notion 35ac40c2...b0fb4，not_started）；Q2=2 角色（agent 为主，中台仅薄写入端）；Q3=agent-panel（新，thin）+ line04 打点薄层；Q4=GP-4 全绿+新增面板 Step，FAIL=sprint FAIL；Q5=刀1 仅 Windows，但 schema/泳道第一天多设备；Q6=见第 4 节矩阵。

**第一刀纪律**：thin——只接 line04 一条线、6 种事件、一条浮条一个面板。思考级流式展示（"AI 在想什么"）、客户视图脱敏、多线接入全部属于加厚，须证据驱动。
