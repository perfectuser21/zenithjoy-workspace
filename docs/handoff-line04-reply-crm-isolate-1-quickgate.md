# Hand-off 1（做法一·快）：CRM 扫好友默认 OFF，回复机回到 #811 纯粹态

> 目标：让 Line 04 微信客服**回复机**（如 xian-rog）的回复循环回到 #811「窗口可见+不抢焦点」的纯粹稳定态：
> **只读未读→回复**，绝不被 CRM 扫好友的滚动/开群操作连累。改动小、当晚可上 rog 验证连续回复。
> 这是 `/dev` 路径 A（回归 bug）。**先读 skill `wechat-cs-troubleshooting`** 再动手。

---

## 0. 背景（为什么要这一刀）— 真机铁证

xian-rog 0629 真机日志坐实「回一次就不理」有**两个**真凶，第一刀 PR #965（1.0.76，已合并）只治了第一个：

1. **（#965 已治）心跳假塌缩误重启**：主循环心跳块裸读 `len(mw.descendants())` 处于**隐藏态**恒报塌缩假象（sessions=0/tree≤2），#950 据此误重启正在工作的微信。#965 加了「可读守卫」：scan_unread 在可见态读到健康树（grep `last_readable_scan_at` / `_LAST_VISIBLE_TREE_SIZE`）就绝不重启。

2. **（本刀要治）CRM 扫好友主动破坏微信 UIA**：日志铁证（19:01:53 scan 真送达 DELIVERED 后）——
   ```
   19:01:55 scan_recent_contacts(CRM扫好友) → _scroll_session_list_wheel 连刷几十次 + 开屏外会话(31989,32000)
   19:01:56 UIA 屏幕阅读器标志已失效   ← CRM 扫描操作把 SPI 标志弄丢
   19:01:59 UIA树塌缩→已重启微信        ← 标志丢→树【真】塌→重启→死区
   ```
   且 listener 一启动 / 用户一登录，CRM 扫好友**开机必跑一次**（`not friend_scan_done_once`）→ 滚遍整个会话列表 + 挨个开会话/群（用户观察到「反复跑进学习指导群」就是这个）→ 抢占 listener + 破坏 UIA。

**结论**：CRM 扫好友（#901/#903 加的滚动 + 逐个开会话）和回复路径**共用同一个微信窗口**，不能同时动；它在回复主循环里乱滚乱开会话 → 把核心回复搞退化。**#811（PR #811 / git 74654efd「B 方案」）没有 CRM 扫好友，所以超级稳定**。

---

## 1. 改什么（精确位置）

文件（**两份都要改，保持 md5 一致**；有 CI `line04-ship-version-sync-smoke.sh` 三面一致 gate）：
- `services/agent/wechat-rpa/listen_chat.py`
- `services/agent/build-modules/line04/wechat-rpa/listen_chat.py`

### 1.1 CRM 扫好友触发条件加开关（主循环里，约 2838 行）

现状（开机必跑 + 周期跑 + 中台强制）：
```python
if _cs_wid and (
    _force_scan
    or not friend_scan_done_once
    or now - last_friend_scan >= FRIEND_SCAN_INTERVAL
):
    _contacts = scan_recent_contacts(mw, limit=100)
    ...
```

改成：**默认只在中台显式「立即扫好友」(`_force_scan`) 时跑**；自动跑（开机一次 + 周期）整体收进一个默认 OFF 的开关：
```python
# CRM 扫好友与回复路径共用微信窗口、不能并行；扫好友的滚动/开会话会丢 SPI 标志→树塌→
# 误重启回复机（rog 0629 铁证）。回复机默认只在中台显式「立即扫好友」时跑，绝不开机自动滚全列表。
# 想让某台机周期自动扫 → 显式置 ENABLE_AUTO_FRIEND_SCAN=1（config 机器级覆盖）。
_auto_scan_ok = _ENABLE_AUTO_FRIEND_SCAN and (
    not friend_scan_done_once or now - last_friend_scan >= FRIEND_SCAN_INTERVAL
)
if _cs_wid and (_force_scan or _auto_scan_ok):
    _contacts = scan_recent_contacts(mw, limit=100)
    ...
```

### 1.2 config.py 加 `ENABLE_AUTO_FRIEND_SCAN`（默认 False）

`services/agent/wechat-rpa/config.py` + `services/agent/build-modules/line04/wechat-rpa/config.py`：
- 仿现有机器级覆盖写法（`config.py` 已支持从 `machine.config.json` / 环境变量读覆盖，见 PR #785 `集中行为参数到 config.py，支持机器级覆盖`）。
- `ENABLE_AUTO_FRIEND_SCAN = False`（默认）；可被机器级覆盖成 True。
- listen_chat.py 顶部 import：`from config import ENABLE_AUTO_FRIEND_SCAN as _ENABLE_AUTO_FRIEND_SCAN`（带 fallback 默认 False，仿现有 `OFFSCREEN_REPLY` 等 import 的 try/except）。

> ⚠️ 不要删 `scan_recent_contacts` / `_scroll_session_list_wheel` / `_force_scan`（中台按钮要用）。只是把「开机自动 + 周期自动」关掉。

---

## 2. TDD（先 failing test）

`services/agent/{wechat-rpa,build-modules/line04/wechat-rpa}/tests/`（**两份**）加纯函数/逻辑回归测试，钉死：
- `ENABLE_AUTO_FRIEND_SCAN=False`（默认）+ `_force_scan=False` + 即便 `not friend_scan_done_once` → **不跑** scan_recent_contacts。
- `_force_scan=True`（中台按钮）→ 仍跑（保留显式触发）。
- `ENABLE_AUTO_FRIEND_SCAN=True` + 周期到 → 跑（保留可选自动）。

可把触发判定抽成纯函数 `_should_run_friend_scan(force, enable_auto, done_once, now, last, interval)` 便于 CI 单测（仿 #965 的 `_should_restart_for_collapsed_tree` 风格）。**先 commit failing test，再 commit 实现**（CI `lint-tdd-commit-order` 拦顺序）。

---

## 3. 版本 bump（9 面，1.0.76→1.0.77）

`grep -rln "1\.0\.76"` 改全（与 #965 同一组 9 面）：
- `services/agent/modules/line04/manifest.json`
- `services/agent/build-modules/line04/manifest.json`
- `apps/api/src/services/walking-skeleton.service.ts`（HEARTBEAT_MODULES required_version）
- `apps/api/src/services/walking-skeleton.service.test.ts`（2 处）
- `apps/api/tests/routes/heartbeat-modules.test.ts`
- `.github/workflows/scripts/smoke/{offscreen-version-gate,preflight-delivery-selfcheck,wechat-cs-visible-delivery,heartbeat-module-health}-smoke.sh`

本地必过：`bash .github/workflows/scripts/smoke/line04-ship-version-sync-smoke.sh`（三面一致）。

---

## 4. worktree / 提交 / PR

- 主 checkout 是共享的，**必开独立 worktree**（cp-* 8 位时间戳分支 + 软链 node_modules + `.dev-mode.<branch>`/`.dev-lock.<branch>` 含 owner_session）。放 `~/worktrees/zenithjoy/` 下防 churn。
- commit 顺序：commit1 failing test → commit2 实现（config+listen_chat 两份）→ commit3 版本 bump。
- PR 描述声明：「本 PR 把 Path 4 Step3 从 🔴(CRM扫好友破坏回复) 推到 ✅(回复机纯粹态)」。
- PR 建完 auto-merge，走 `engine-pr-watchdog` 直到合并。

---

## 5. 部署 + rog 真机验证

1. **COS 模块包**：merge 自动构建上传 `line04-wechat-cs-v1.0.77.tar.gz`（校验 `curl -sI https://zenithjoy-static-1333590468.cos.accelerate.myqcloud.com/install-pack/modules/line04-wechat-cs-v1.0.77.tar.gz` → 200 + `md5` 比对 origin/main listen_chat 一致）。
2. **staging 部署到 1.0.77**（GHA `deploy-us-vps` 会 SSH i/o timeout → 本机绕）：
   - 本机就是美国 Mac（staging :5201 / zenithjoy_test）。
   - `cd /Users/administrator/perfect21/zenithjoy && git reset --hard origin/main && npm ci --workspace=apps/api --ignore-scripts`
   - `source .github/workflows/scripts/deploy-lib.sh` + 设 ZJ_* 环境（见 deploy-us-vps.yml）→ `staging_deploy_slot <sha>` → `staging_verify <sha>`。
   - ⚠️ **部署会重生 plist 把 `WECHAT_CS_MODEL` 冲掉**！部署后必须：`PlistBuddy -c "Add :EnvironmentVariables:WECHAT_CS_MODEL string gpt-5.4-mini"` ~/Library/LaunchAgents/com.zenithjoy.api.staging.plist + `launchctl unload/load`。（deepseek-v3.2 toapis 渠道死，必须 gpt-5.4-mini；见 skill §1.3/§2.E）。
3. **rog OTA**：rog agent 连 staging（`staging-autopilot.zenjoymedia.media`），下次心跳自动 OTA 到 1.0.77（查 `C:\Users\asus\AppData\Roaming\ZenithJoy\modules\` 出现 `line04-wechat-cs-1.0.77` + 运行进程命令行带该版本目录）。
4. **真机验收**：用户用**莫易**（测试号，wechat_id `cs-425b144f`，白名单已含「默忆」）连发 3 条 → 看 **连续 3 条 DELIVERED**，且 `C:\Users\Public\zj-listener.log` **不再出现 `_scroll_session_list_wheel` 刷屏 + 不再 `launch_weixin=True` 重启**。

---

## 6. 诊断复用法（见 skill `wechat-cs-troubleshooting` §3，关键摘要）

- **SSH=session0 够不到 session1 GUI/UIA**。session-1 内执行用 `schtasks /create /tn X /tr <bat> /sc once /st 23:59 /ru asus /it /f` + `/run`（`.bat` 包装避开引号地狱；`PsExec -i 1` 起不来）。
- **运营看监听健康（无需进 session1）**：`GET http://127.0.0.1:5201/api/wechat/listener-heartbeat` 返回每 agent 的 `diag{main_window_found,login_present,screen_locked,sessions_seen,unread_count,replied_count,last_error}`。⚠️ `sessions_seen` 是**隐藏态裸读**，恒偏 0，**别拿它判读不到会话**——以 `zj-listener.log` 的 DELIVERED 为准。
- **listener 真相日志**：`C:\Users\Public\zj-listener.log`（GBK！`Get-Content -Encoding Default` + ASCII 清洗 `-replace '[^\x00-\x7F]','.'` 再传，避免多字节截断）。判「回得了」= 出现 `reply_in_chat: ...DELIVERED`。
- rog 关键 id：license `ZJ-F-X8NSB6EM` / agentId `43d3eb71-2dbb-49d7-a270-7425e4941eb7` / machineId `425b144f077a667bb42666821220e06d` / wechat_id `cs-425b144f` / 中台 `staging-autopilot.zenjoymedia.media`。
- staging 库 `zenithjoy_test`（本机美国 Mac :5201），表在 **`zenithjoy` schema**。

---

## 7. 验收标准（Final）

- [ ] failing test 先 commit，实现后变绿；CI 全绿（含 ship-version-sync gate）。
- [ ] PR 合并 + 1.0.77 上 COS + staging 报 1.0.77 + rog OTA 到 1.0.77。
- [ ] rog 真机：莫易连发 3 条 → 连续 3 条 DELIVERED；日志无 CRM 滚动刷屏、无误重启。
- [ ] 决策已记 Brain（category=bug-fix）。
