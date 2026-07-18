# Handoff：Line04 回复态屏内可见不变量——结构性根因修复（真机验证过才合并）

- task_id: unknown（交互式 /dev 承接，`.dev-mode` task_id=local，跳过 Brain tasks 表回写）
- verdict: PASS
- PR: https://github.com/perfectuser21/zenithjoy-workspace/pull/1387（已合并，merge commit 5d075a5f8dd2b34dae81ab73d9c4f3cf7f753deb）

## 用户对本次工作方式的两条硬性纠正（后续所有真机 bug 修复必须遵守）

1. **不许让用户当测试员**：修完必须自己在真机上验证生效（复现故障 → 打补丁 → 同场景转绿），验证过才合并。"改完写个 mock 单测就合并、指望用户去发现有没有生效"被明确否定。
2. **连续多个补丁没打中就必须停下质疑架构**：本次是同一话题第 6 个 PR，前五个（#1374/#1379/#1381/#1383 + 一次被测试推翻的 navigate_away 假设）都是分支级补丁，全都没打中真实路径。用户原话"深度挖一下这个问题到底是啥问题，这解决不了后面都是问题"。

## 结构性根因（前五个补丁均未打中的同一问题）

主循环每轮真实序列：**扫描先跑** `_ensure_tray_visible()`（扫描态）把托盘/最小化窗口弹出、挪屏外、常驻隐身（`_CLOAK_OWNED`）；随后**同一轮**里 `reply_in_chat` 再调 `for_reply=True` 的 ensure——此刻窗口已处于"可见但在屏外"状态 → 落入"可见"分支（对回复态是空操作）→ 回复全程发生在屏外，用户看不见。**#1383 修的托盘分支在真实路径上根本执行不到**（回复时窗口从不处于托盘态）。

第二症状"24 秒切不到会话"：回复中途窗口被上一轮收窗竞态收回最小化（本体停在幽灵坐标 -32000），item 坐标缓存旧值 → `ScreenToClient` 算出 `client=(3xxxx,3xxxx)` 幽灵点击坐标。**真机日志 (30153,32228) 与真机复现 (32352,32168) 数学吻合**（= 旧 item 坐标 − (-32000)）。`_open_chat` 的幽灵检查只在循环开头查一次，重试中不复查 → 三次 PostMessage 全点虚空。

## 修法（不变量式收口）

1. `_ensure_onscreen_for_reply(hwnd)`：`OFFSCREEN_REPLY=False` 时发送前窗口必须屏内可见——最小化/幽灵/屏外/隐藏所有进入状态统一收口，`reply_in_chat` 单点调用（`_ensure_tray_visible` 之后），不再依赖各分支副作用。
2. `_refresh_ghost_item(mw, item, sender, main_hwnd)`：窗口幽灵恢复 + item 陈旧坐标重扫，`_open_chat` **每次重试前**都调。
3. 版本 1.0.138 → 1.0.139（9 处引用同步）。

## 验证记录（本次的核心交付方式）

- **真机复现机制**（改代码前）：rog 上摆出"窗口中途最小化 + 陈旧 item"状态组合，算出幽灵点击坐标 (32352,32168)，与真实故障日志签名吻合——机制证实后才动手。
- **真机验证修复**（合并前）：修复文件直接部署 rog，三场景 ALL_PASS——A 最小化幽灵态→还原屏内(90,90)；B 扫描态屏外(-2600)（真实回复路径状态）→挪回屏内(100,100)；C 完整复刻 12:49 故障→`_open_chat` 一次成功且窗口自动还原。
- TDD：9 用例先 commit（全红）→ 实现转绿；相关回归 72 用例过。
- **CI 抓到一个我引入的真 bug**：老测试用裸 MagicMock 当 mw/item，`abs(MagicMock)>20000` 恒 truthy → 每次重试狂造 Mock 子对象 + Mock 句柄被送进 self-hosted 真机的**真** Windows API → `Windows fatal exception: stack overflow`。修法：句柄必须 `isinstance(int)` 才碰 WinAPI、rect 坐标 `int()` 强转失败视为非幽灵（生产路径全真 int，行为不变）。**教训：给会在 self-hosted 真机跑的代码写新函数时，必须假设老测试会拿 Mock 对象灌进来，数值判断和 WinAPI 调用都要防**。

## 一次被测试推翻的假设（记录以防重犯）

最初怀疑 `_navigate_away`（回复后跳文件传输助手）缺 settle 等待导致后续切换失败。真机 A/B 测试（加/不加 0.3s sleep 各 3 轮）两组全部 0.21s 瞬间成功——假设不成立，已撤回临时补丁未提交。教训：孤立单次操作测试复现不了"扫描态与回复态交错"类故障，必须摆出完整状态组合。

## 没做 / 遗留

- **本地 macOS 全量 pytest 噪音扩大到 14 个失败**（`_ensure_tray_visible` 家族，定向跑全绿、真 Windows CI 全绿）：跨文件状态污染，随测试文件增多而变多，#1372 交接单首次记录时是 6 个。值得单独起一个 sprint 找到污染源根治，否则本地全量跑的信号会越来越不可用。
- **xian-rog 多方共享缺互斥锁**仍未解决（本 session 累计踩 3 次以上）。
- 用户尚未在修复后的真实使用中做过最终确认（rog 上现跑的已是修复代码，OTA 1.0.139 合并后按心跳自升级；行为预期：用户在看时直接读直接回，不在看时扫描隐形、回复那一刻窗口出现）。

## 数据源

- PR：https://github.com/perfectuser21/zenithjoy-workspace/pull/1387（merge 5d075a5f）
- 涉及：`services/agent/wechat-rpa/listen_chat.py` + 镜像、`tests/test_reply_onscreen_invariant.py` + 镜像、9 处版本号
- 前置 handoff：`202607181225-line04-tray-reply-visible-fix.md`（#1383）及其引用链

## 决策引用

- decision 284f56ac：回复态窗口状态由扫描态副作用决定，五个分支补丁均未打中真实路径——立屏内可见不变量（本次修法依据）
- decision 9c933d60（#1383）/ b5041511（#1381）/ 7e77a7e3（#1379）/ 433b117c（#1374）：同话题前四个分支级修复

## 产物

- PR: https://github.com/perfectuser21/zenithjoy-workspace/pull/1387
- merge commit: 5d075a5f8dd2b34dae81ab73d9c4f3cf7f753deb
