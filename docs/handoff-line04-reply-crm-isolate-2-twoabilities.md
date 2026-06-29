# Hand-off 2（做法二·彻底）：客服回复 与 好友CRM采集 拆成两个独立 Ability + 窗口锁协调

> 目标：把 Line 04 微信客服里**纠缠在同一循环**的两件事，正式拆成**两个独立 Ability**，
> 在代码与 Notion/Brain 台账上都各自独立，运行时靠**一把微信窗口锁**时分复用、**回复优先**，永不打架。
> **可直接做本刀，跳过 Hand-off 1**（做法二 ⊃ 做法一）：下面 PR 1 删掉「开机必跑/周期自动」后，回复主循环
> 就已回到 #811 纯粹态 = 做法一的稳定效果。**只要把"稳定性 checkpoint"放在 PR 1 之后**即可（见 §3 PR1 末尾）。
> 这是 `/dev` 路径 C（大功能 / 架构重构），走 harness 或多 PR 分步；**先读 skill `wechat-cs-troubleshooting`**。
> 起点版本：line04 已在 **1.0.76**（PR #965 可读守卫已合并上线；staging 已 1.0.76 + gpt-5.4-mini，rog 已 OTA）。

---

## 0. 为什么要拆（物理约束 = 设计的核心）

两件事是**两个客户价值**（= 两个 Ability，CLAUDE.md ability 模型）：
- **Ability A：微信客服自动回复** — 读未读→AI 草稿(中台 `draft-generate`, gpt-5.4-mini)→UIA 送达+读回验证。客户价值 = 消息有人实时回。**实时、面客户、高优先**。
- **Ability B：微信好友 CRM 采集** — 滚全会话列表→逐个开会话→抓微信号/加友时间→回传中台 `friend-scan ingest` 建客户库。客户价值 = 后台看到全部客户。**批处理、可低频、可延后**。

**物理约束（设计必须围绕它）**：两个 Ability **共用同一个微信窗口 / 同一个 UIA / 同一个焦点**，**不能真并行**——B 在滚列表/开群/丢 SPI 标志时，A 没法安静读消息（rog 0629 铁证：B 跑→标志丢→树塌→回复机被误重启）。所以**不是两个能并行的进程，而是两个必须排队、A 优先的 Ability**。

> 纠正常见误解：「两个独立 ability」在**能力/代码**层成立，但在**运行**层它们抢同一个微信窗口 →
> 必须时分复用 + 锁协调，**绝不能同时操作微信**。

---

## 1. 目标架构

```
listen_chat 进程（回复机常驻）
 ├── Ability A 回复循环（默认、常驻、纯粹 #811 态）：ensure_visible→scan_unread→reply。绝不滚、绝不开群。
 └── Ability B 采集任务（按需、低频、受锁保护）：
       触发 = 中台显式下发「扫好友」task（不再开机自动、不再周期自动滚）
       执行前：① 抢「微信窗口锁」(同进程内一个 flag/threading.Lock，回复循环让出)
              ② _activate_uia 重置 SPI 标志
       执行：scan_recent_contacts（滚动+逐个开会话+抓资料）
       执行后：③ 强制重建可读态（必要时 _restart_wechat_for_uia 或重置标志）+ 释放锁 + 回复循环恢复
       期间：回复循环 pause（不读不回，或只缓存不动微信），采集完立即 resume
```

要点：
- **A 是默认态**，B 是**插入式、显式触发、跑完即让位**。
- **一把锁**：同进程内，A 与 B 互斥拿微信窗口（`threading.Lock` 或主循环状态机）。**回复优先**：B 想跑必须等 A 当前这轮 reply 结束、且没有 pending 未读时才插入（或限定 B 单次时长上限，超时让回 A）。
- B 跑完**必须把微信恢复到 A 能读的可见态**（标志重置 / 列表回顶 / 必要时重启重建树），否则 A 接手时读不到。

---

## 2. Brain / Notion 台账（两条 Ability）

Line 04 = Journey「客户私域 AI 接管」。在 `journey_features`（kind=ability）登记/确认两条：
- `微信客服自动回复`（group: 「私域客服」）— 现状 working/medium。
- `微信好友CRM采集`（group: 「私域客服」）— 现状 thin（从回复里拆出）。

用 `node ~/.claude/skills/dev/scripts/add-feature.js --name ... --journey-id <Line04 notion id> --thickness thin --area ZenithJoy`（自带语义查重）；脚本不可用回退 Brain API `POST /api/brain/journey_features`（带 `kind:"ability"`）。
Golden Path 各写各的（每个 Ability 一条，scope=该 ability，**不要把两条排成一条**）。

---

## 3. 分步实现（建议 3 个 PR）

**PR 1：抽出 B 的执行体 + 中台按需触发**
- `scan_recent_contacts` + `_scroll_session_list_wheel` + `enrich_contacts_with_details` 抽成清晰的「采集 job」函数 `run_friend_scan(mw) -> result`（纯采集，不掺回复）。
- 触发完全改成中台 task 驱动：复用现有 `fetch_friend_scan_pending` / `force_scan_requested_at`（运营 Dashboard「立即扫好友」按钮）。**删掉「开机必跑 `not friend_scan_done_once`」+「周期 `FRIEND_SCAN_INTERVAL` 自动」**（直接移除自动路径，不留开关——这一步同时实现了 Hand-off 1 的稳定效果）。
- TDD：触发判定纯函数测试（只认中台 task，不再自动）。
- ⛳ **稳定性 checkpoint（PR1 合并后必做，等价于「做法一验证」）**：bump 版本 + 部署 staging（本机绕 GHA-SSH-timeout，注入 `WECHAT_CS_MODEL=gpt-5.4-mini`）+ rog OTA → **用莫易连发 3 条 → 确认连续 3 条 DELIVERED + `C:\Users\Public\zj-listener.log` 无 `_scroll_session_list_wheel` 刷屏、无 `launch_weixin=True` 重启**。过了这关再做 PR 2/3；没过说明回复路径还有别的破坏源，先查清再继续。

**PR 2：窗口锁 + 回复优先调度**
- 主循环引入状态机/锁：A 回复是默认态；收到采集 task 时，等当前 reply 轮结束 + 无 pending 未读 → 置 `mode=scanning` → 跑 `run_friend_scan` → 跑完 `_activate_uia` 重建可读态 + 回顶 → 置回 `mode=replying`。
- 采集单次**硬超时**（如 ≤120s），超时中断让回 A，防长扫饿死回复。
- TDD：调度状态机纯函数测试（pending 未读时不让 B 插入 / B 超时让回 A / B 跑完恢复可读态调用了重置）。

**PR 3：Notion 同步 + 守卫**
- 两条 ability 回写 thickness；Golden Path 各登记。
- 守卫（环境接缝）：回复循环里**断言不出现滚动/开群**（A 纯粹态）；采集 job 里断言**有锁保护 + 跑完重置标志**。proven-to-fire：故意让 B 不释放锁 / 不重置 → 看守卫报红。

---

## 4. 版本 / 部署 / 验证

- 每 PR bump line04 版本（9 面，见 Hand-off 1 §3）+ `line04-ship-version-sync-smoke.sh` 三面一致。
- 部署 staging（本机绕 GHA SSH timeout）+ 注入 `WECHAT_CS_MODEL=gpt-5.4-mini`（plist 重生会冲掉，每次部署后补；治本应进 `deploy-lib.sh` `staging_overrides`，见 skill §2.E）。
- rog 真机验收：
  - A：莫易连发 3 条 → 连续 DELIVERED，日志无滚动刷屏、无误重启。
  - B：中台点「立即扫好友」→ 回复短暂 pause → 采集完成 ingested>0 → 回复恢复、继续连续 DELIVERED。
  - 两者**绝不同时动微信**（日志时间线上 A/B 不交叠）。

---

## 5. 已知坑 / 复用（详见 skill `wechat-cs-troubleshooting`）

- 心跳 `sessions_seen` 隐藏态裸读恒偏 0，**别当读不到会话**（以 zj-listener.log DELIVERED 为准）。#965 的可读守卫已用可见态读。
- CRM 扫好友的 `_scroll_session_list_wheel` 在 rog autologon session **无输入桌面权**（`SetCursorPos 失败`）→ 滚不动 + 屏外会话坐标 ~32000 切不到。B 重做时要么换不依赖输入桌面权的滚动法，要么接受「只采集屏内 + 中台按需多轮」。
- 微信 SPI 屏幕阅读器标志**只在微信启动时置位才建完整 a11y 树**；运行中丢标志→树塌→只能重启重建（memory `line04_wechat_uia_tree_collapse_rootcause_0629`）。B 跑完务必恢复可读态。
- 真机诊断走 session-1 schtasks 通道；日志 GBK 读法见 Hand-off 1 §6。
- 稳定基线参照：PR #811 / git 74654efd「B 方案——窗口可见+不抢焦点+真送达读回」。

---

## 6. 验收标准（Final）

- [ ] 两条 ability 在 Brain `journey_features`（kind=ability）+ Notion 各自独立登记，各有 Golden Path。
- [ ] 回复循环纯粹（无滚动/开群）；采集只由中台 task 触发、受窗口锁保护、跑完恢复可读态。
- [ ] rog 真机：A 连续 DELIVERED 稳定；B 按需触发不打断 A（时间线不交叠）。
- [ ] 各 PR TDD + CI 全绿 + proven-to-fire 守卫；决策记 Brain。
