# Handoff：0819 line02 四台机队攻坚 + 设备就绪度归位

verdict: PARTIAL ｜ GP-Anchor: line02/keyword_acquisition keep-green
决策: 6d0a4be7(归位) / 2dc450f7(五条断言, invariant)

## 一、已交付（8 个 PR 全部合并）

| PR | 内容 |
|---|---|
| #1655 | 真机 smoke 取 agent_id 的 logcat 窄化，200 秒→6 秒（100 倍），此前烧掉 12 分钟预算的 10 分 26 秒 |
| #1658 | **Stage2 抓评论恒 0** —— 私信发不出的真源头。handleVideoUrlOpened 是纯事件回调、`?: return` 静默丢弃、零重试，改为与 startCollect 同款两层等待 |
| #1659 | 交接单 |
| #1660 | 私信链等输入框：档位 WIDGET(4s)→PAGE(6s)、findFirstEditText 加 1500 上限、昂贵兜底移出轮询 |
| #1661 | **agent 身份按 machine_id 唯一化** —— hostname 存的是机型名，同机型两台手机坍缩成一行 |
| #1662 | 采集轮询 5 个静默丢弃点全部留痕 + when(stage) 补 else |
| #1663 | **ColorOS 静默拦截 startActivity** → 无障碍手势点击桌面图标兜底 |
| #1664 | **五条就绪断言落进真机 smoke**（含修掉 smoke 自己那行会撒谎的判据）|

真机产出：采集 10 个任务、线索 30 条（23 条带真实抖音号）、**私信真实送达 4 条**。
小黄(安卓16) 10 条线索、小粉 7 条、四号机 5 条。

## 二、四台机队现状

| 机器 | 系统 | 版本 | 状态 |
|---|---|---|---|
| 小粉 荣耀ANY-AN00 | 安卓13 | 2.1.26 | ✅ 可用 |
| 四号机 荣耀MAA-AN00 | — | 2.1.26 | ✅ 可用（CI 用的就是它，192.168.1.96 挂 rog）|
| 小黄 荣耀MAA-AN00 | **安卓16** | 2.1.27 | ✅ 可用，产出最好 |
| 小白 realme RMX3478 | 安卓14 | 2.1.28 | ⚠️ 见第四节 |

两台同为 MAA-AN00 现已拿到不同 machine_id（6cf761db / e86800e3），PR #1661 生效。

## 三、今天确认的两个全局根因（不止影响小白）

**① 队列僵尸**：`publish_tasks` 里 `qr_bind/douyin_burner` 积压 27 条 queued，最早 07-21（近一个月），
一直往 agent 推、占死处理位。已清（注意该表 status 约束不含 cancelled，只能用 failed）。
另 `acquisition_collect_tasks` 也清过 13 条僵尸（最早卡 8 小时）。

**② agents 表 id/agent_id 交叉污染**：小白两行（两租户各一行，本身合法）的 id 与 agent_id 互相存了
对方的值。而 `pending-collect-tasks` 反查是 `WHERE agent_id=$1 OR id::text=$1 LIMIT 1`（无排序）——
两行都命中，返回哪行看运气：命中错行则 tenant 不匹配、返回 total=0。**这就是"时好时坏"的真凶**，
任何有多租户身份的设备都可能中招。已用临时值三步解环修正（agent_id 是 NOT NULL + UNIQUE）。

## 四、小白剩余卡点（精确到函数）

已打通五层：无障碍 Bound 0→3 ／ 手势兜底装机 ／ 队列清空 ／ 交叉污染修正 ／ 服务端派单 total 0→1。

**卡在 `AgentService.initAgent()` 中途**，判据：

- 小黄启动成功会打 `AgentService: agent started — agentId=… machineId=…`，**小白完全没有这行**
- 按 pid 抓全量 logcat：只有 WebSocket 活动，**零** `pending-collect-tasks` HTTP 请求
- 无任何 E/W 级异常（不是崩溃，是 suspend 挂起不返回，协程挂起不留堆栈）

执行顺序夹逼出的区间：
```
heartbeatLoop?.start()        // :442 附近 —— 小白走到了（心跳正常）
MediaProjection 检查 / ScreenCaptureService / audioCaptureService / judgmentService 构造
collectPollLoop?.start()      // :517 —— 小白没走到
"agent started" 日志          // 小白没打
```
最可疑：MediaProjection 那段（小白界面长期显示「⚠️ 截图未授权」，这几个服务构造正好围绕它）。

**下一刀**：给这段每个服务构造加一行进度日志 → 出包 → 装小白 → 一次即可看出挂在哪。纯观测性，风险极低。

## 五、欠账

1. **journey_features 未写成**（本次最大欠账）：`POST /api/brain/journey_features` 需 internal token，
   `~/.credentials/zenithjoy-internal-token` 无效、Brain 容器 env 无 INTERNAL_TOKEN。
   `strategic-decisions` 端点不需 token，是可用通路（两条 decision 已写入）。
   **待补**：挂到 journey_id=ec4eb591-e064-4886-a7b6-4452cdf333d2（工厂·F3 夜间体检）下已有挂片
   「真机验证车道三层防假绿守卫」(53b8b3a9) 的加厚。
2. `a11y-bound-selfcheck.test.sh`（要求 agent 自检改用 getEnabledAccessibilityServiceList
   而非 Secure Settings 字符串）仍是草稿 PASS=0 FAIL=4，未提交，落账后才有归属。
3. nightly 巡检未实现（五条断言目前只在 line02 真机 smoke 里，未挂进 nightly-android-fleet-pc4）。

## 六、给下一个大脑的关键提醒

- **`settings get secure enabled_accessibility_services` 会撒谎**：ColorOS 不认 adb 写入，
  读得回=假成功。唯一可信判据是 `dumpsys accessibility` 的 Bound services。这条骗了一整天。
- **`pending-collect-tasks` 有副作用**：拉取时会把任务标 running。手动调它做诊断 = 替设备把任务拉走，
  会污染现场（本次踩过）。
- **agent 自检显示「无障碍 ✅ 已开启」不可信**：`collectServiceEnabled()` 只读 Secure Settings 字符串。
- 装机：荣耀安卓16 必须先勾「已了解…风险」复选框才出现「继续安装」，按 button1 会点成「了解更多」；
  绝不卸载 prod 包（配置全丢、重装默认连生产地址）；m4 上脚本内中文必乱码，解法是 XML 拉回本机解析、只传坐标。
