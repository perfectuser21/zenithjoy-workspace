# Bug PrepPRD：CRM 扫好友破坏回复机 — 删开机必跑/周期自动，只留中台按钮触发（做法二 PR1）

> 来源 handoff：docs/handoff-line04-reply-crm-isolate-2-twoabilities.md §3 PR1
> 整体工程 = 把"客服回复(A)"与"好友CRM采集(B)"拆两独立 Ability + 窗口锁。本 PR1 = 删自动扫好友破坏源（= 做法一稳定效果）。
> 起点 line04 1.0.76 → PR1 后 1.0.77。

## 症状
回复机"回一次就不理"：scan_recent_contacts 开机必跑(`not friend_scan_done_once`)+周期自动(`FRIEND_SCAN_INTERVAL`)
→ `_scroll_session_list_wheel` 刷屏 + 开屏外会话(~32000) → 丢 SPI 屏幕阅读器标志 → UIA 树真塌 →
#950 据塌缩误重启正在工作的微信 → 多分钟死区。#811 无 CRM 扫好友故超级稳定。

## 根因
CRM 扫好友(Ability B)与回复路径(Ability A)**共用同一个微信窗口/UIA/焦点，不能真并行**；
B 自动跑(开机+周期)就在回复主循环里乱滚乱开会话 → 破坏 A 的可读态（rog 0629 真机日志铁证：
19:01:55 scan→_scroll 刷屏 → 19:01:56 UIA 标志失效 → 19:01:59 树塌→重启）。

## 关联上下文
- Journey：Line 04 客户私域 AI 接管（bfeed805-deed-46c3-8624-87f0028101d4）
- Ability A（回复）：1e4ee48d 微信客服 窗口可见+不抢焦点+真送达验证（working/thin）
- Ability B（采集）：88336307 微信好友扫描→飞书同步→客户标记名单（planned/thin）
- 前序：#965(1.0.76 可读守卫，治第一半) / #950(误重启) / #811 git 74654efd(稳定基线)

## 修法
1. 抽 `run_friend_scan(mw, middleware_url, cs_wid) -> dict`：把 2866-2881 采集执行体（scan_recent_contacts
   + enrich_contacts_with_details + post_friend_scan）抽成纯采集 job，不掺回复。
2. 触发判定抽纯函数 `_should_run_friend_scan(force, done_once, now, last, interval) -> bool`，
   **实现只 `return bool(force)`**，删掉 `not done_once`(开机必跑)+周期 INTERVAL 自动路径，**不留开关**。
3. 两份文件同步改、保持 md5 一致：
   - services/agent/wechat-rpa/listen_chat.py
   - services/agent/build-modules/line04/wechat-rpa/listen_chat.py
4. **不删** scan_recent_contacts / _scroll_session_list_wheel / _force_scan（中台按钮要用）。
5. bump 1.0.76→1.0.77（9 面，见 handoff §3）。

## Regression Test 计划（proven-to-fire 守卫）
两份 tests/ 加 test_friend_scan_trigger.py，钉死纯函数 `_should_run_friend_scan`：
- force=False + done_once=False + 周期到 → False（不跑）★ 把旧自动逻辑加回则此条红
- force=True → True（保留中台显式触发）
仿 #965 的 `_should_restart_for_collapsed_tree` 纯函数测试风格。

## 验收标准
- [ ] failing test 先 commit（commit-1）
- [ ] 修复代码让 test 变绿（commit-2，含 run_friend_scan 抽函数 + 两份同步）
- [ ] bump 9 面 + `line04-ship-version-sync-smoke.sh` 三面一致（commit-3）
- [ ] proven-to-fire：亲眼看守卫报红过一次（把 done_once 自动逻辑临时加回 → 红）
- [ ] CI 全绿，PR auto-merge
- [ ] 【停 checkpoint】部署 staging(注入 WECHAT_CS_MODEL=gpt-5.4-mini)+rog OTA 1.0.77 →
      用户莫易连发3条 → 连续3条 DELIVERED + zj-listener.log 无 _scroll 刷屏/无 launch_weixin 重启
