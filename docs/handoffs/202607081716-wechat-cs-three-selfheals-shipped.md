# Session Handoff：微信客服三遗留问题（A/B/C）已诊断闭环并合并，待人工 PROMOTE 后真机复验

- session 时间：2026-07-08 下午～傍晚
- journey_id: bfeed805-deed-46c3-8624-87f0028101d4（客户私域 AI 接管 / Line04）
- 前序 handoff：202607081455-wechat-cs-remaining-p0-p1.md（三个问题全部处理完毕）
- verdict: **三修已合并 PR #1182，line04 1.0.114；生产 promote 是人工卡点，未放行**

## 本 session 做了什么

1. **真机诊断闭环（rog 8 轮取证实验）**：三个问题根因全部实锤并当场验证修法——
   - A（99741ff9）：窗口宽 <~700px 微信进**单栏布局**，会话列表整个不在 UIA 树（sessions 读到聊天气泡）；SW_MAXIMIZE 实证 4→26；重启后默认非最大化
   - B（e78d98bc）：DPI 假设**推翻**（pywinauto import 即置 per-monitor aware）；欢迎回来屏控制性复现成功；实证有效点击 = AttachThreadInput 拉前台 + click_input（UIA Invoke / 后台 PostMessage 对 mmui 按钮均无效）
   - C（8e163d87）：`_find_left_nav_button_point` 的 `left_max=90` 判**屏幕绝对坐标**，窗口不贴左边缘必"导航按钮不全"
   - 诊断过程顺手救回生产两次（小窗口漏检测态、误留通讯录 tab），15:46 默忆 DELIVERED 复活
   - 全部细节已写进 skill `wechat-cs-troubleshooting`（§1.10 / §2.I/J/K / §3 截图 ground truth 铁律，PR skills#109/#110 已合并）
2. **修复落地（/dev TDD + 双层 review）**：PR **#1182** 合并，line04 **1.0.114**
   - 3 组回归测试先红后绿，全量 655 绿；click_input 例外白名单锁死在两个自愈函数（invariant decision ebf5cff7）
   - **job3 真机气泡可读性 gate 本 PR 实测转绿**（此前连红 6 次、#1173 被迫 admin merge 的那个闸，根因就是 C）
   - 版本 bump 踩全 7 处面：build-modules/modules manifest + walking-skeleton.service.ts + 其 2 个测试 + 4 个 smoke 硬编码（下次 bump 直接全仓 `grep -rn '1\.0\.11X'`）
3. **撞上 Brain 双派发 bug（已立案 issue e485b5e8，P1/brain）**：有头注册的 task 07b127e4 仍被无头 relay 抢跑，spawn 2 个容器、产出重复 PR #1179，其 watchdog 两次关闭 #1182；处置 = docker stop 两容器 + 关 #1179 + 重开 #1182。task 终态 completed_no_pr 无法回写 completed。

## 下一步（唯一待办）

1. **人工放行生产**：GitHub Actions → `promote-prod.yml` → Run workflow（sha 留空 = 用 staging 当前 sha，confirm 输入 `PROMOTE`）。这是设计死的人工卡点，AI 不代点。
2. promote 后 rog 会 OTA 到 1.0.114，复验三自愈：
   - 心跳出现 `window_state={zoomed:...}` 字段，且窗口被缩小后 ≤5 分钟自动最大化
   - 杀微信触发自愈重启 → 欢迎回来屏被自动点掉（日志 `[欢迎屏自愈] 已自动点『进入微信』`），不再 locked=True 挂死
   - `_reset_session_list_to_top` 不再报"导航按钮不全"
3. 复验通过后把 skill 台账 §1.10 的"待 OTA 复验"标注去掉。

## 仍未解决（原 §2.I 残留，独立立案）
- sender 名字识别错（'苏小x' vs '苏'）与待发回复无过期/无上限——不在本次三修范围。

## 产物指针
- PR #1182（zenithjoy-workspace，已合并）/ skills#109 #110（台账，已合并）
- Issues：99741ff9 / e78d98bc / 8e163d87（修复已合并待复验）；新立 e485b5e8（Brain 双派发）
- 设计/计划/Learning 均在 repo：docs/superpowers/{specs,plans}/2026-07-08-*、docs/learnings/cp-07081556-*
