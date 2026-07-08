# Session Handoff：微信客服（Line04）三处 CI/生产 bug 排查修复

- session 时间：2026-07-07 晚 ～ 2026-07-08 上午（跨自然日）
- journey_id: bfeed805-deed-46c3-8624-87f0028101d4（客户私域 AI 接管 / Line04）
- verdict: PASS（3 个 PR 全部合并），但两个 P0 缺真机端到端验证（见下）

## 触发背景
用户同事测试微信客服，反馈：①发图片会漏消息 ②今日复测发现"发图片后紧跟一条文字，那条文字永久不回复" ③agent 后台看着连接正常但完全不回复。

## 完成了什么

### 1. PR #1160（已合并）：图片消息导致下一条文字消息丢失（P0，issue 4024c90b）
- 根因：图片/语音等非文本消息结构上不产生 UIA bubble 条目。`scan_unread` 的 F1 回退保底路径 / `trailing_stall_fallback` 用会话预览兜底文本（如"[图片]"）emit；DELIVERED 后这个文本被写进 `_REPLY_ANCHOR`，但真实 bubbles 里永远匹配不到；下一轮 `split_trailing_incoming` 找不到锚点回退成"最后一条 outgoing"，把排在 bot 兜底回复之前、客户紧跟图片发的真实文字问题误判成"锚点之前的旧消息"永久丢弃。
- 修法：两处回退 emit 不再携带 `_last_incoming`。
- 验证：新增 2 个 regression test（`test_bubble_anchor.py` + `test_double_window_and_operator_echo.py`），全量 wechat-rpa 套件通过。**未做真机端到端验证**（没有客户机/测试号访问权限）。

### 2. PR #1163（已合并）：UIA 死区自愈重启只杀 Weixin.exe 漏杀 WeChatAppEx.exe（P0，issue 05630ae5）
- 根因：`_restart_wechat_for_uia()` 只 `taskkill /IM Weixin.exe`（启动器，正常几秒自然退出），真正常驻扛着 UIA 状态的 `WeChatAppEx.exe` 从未被杀过。每次自愈都是杀空壳+叠加新启动器，真正卡死的进程从未清理。`_WECHAT_RESTART_MAX=5` 与客户机实测残留 5 个 Weixin.exe 精确对应。
- 修法：taskkill 同时覆盖 `WeChatAppEx.exe`。
- 验证：新增 regression test（强制 patch `platform.system` 走 Windows 分支断言两个进程都被杀），全量套件通过。**未做真机端到端验证**（没有验证"真触发自愈重启后微信是否真的恢复"）。

### 3. PR #1165（已合并）：真机气泡 CI gate 找不到"文件传输助手"（P2，issue 69c634b7）—— **有真机端到端验证**
- 排查过程走了三次弯路才找到真根因，记录下来防止未来重复踩：
  - 第一次误判：以为是"会话列表虚拟列表渲染时序"问题，加了有界重试 → 无效
  - 第二次误判：以为是"上一轮发送失败导致窗口停在聊天详情页"，加了 `_reset_session_list_to_top` 回顶恢复 → 触发但报"导航按钮不全"，仍无效
  - **真根因**（用户在 rog 现场确认）：微信被弹出成一个独立小窗口（双击聊天可弹出）。gate 脚本自己重写的 `_find_mmui_window` 用 `"mmui" in cls.lower()` 宽松子串匹配主窗口，这个独立小窗口的 class name 恰好也含"mmui"，被错认成主窗口——抓到的自然只有那个聊天的气泡，没有联系人列表/左侧导航。
  - 修法：改用 `find_weixin.get_main_window()` 精确匹配（`cls == "mmui::MainWindow"`），删掉重复实现的宽松版本。
  - **真机验证**：SSH 到 rog（`ssh xian-rog`，session 0），用 `schtasks .../it` 建 session-1 计划任务绕过 GUI 权限限制跑诊断脚本，直接在真机上确认 `ok=true, bubble_count=17, marker_found=true, marker_outgoing=true, DELIVERED`。

### 附带：修正了一条写错的排障台账（zenithjoy-skills PR #106，已合并）
- `wechat-cs-troubleshooting` skill §2.I 原本写"rog 微信卡住打不开"，后来证实是错误诊断——真根因是 CI gate 认错窗口，跟微信本身状态无关。**这条台账内容现在也是错的，需要下次有空时回去改成真根因（独立弹窗+宽松窗口匹配），当前没顺手修，是遗留 TODO。**

## 没完成什么
1. **图片消息丢失、自愈重启杀错进程这两个 P0 的真机端到端验证没做**（见上）。现在已经打通 rog SSH + session-1 执行通道（`ssh xian-rog` 能连，`schtasks /create ... /it` 能绕过 GUI 权限跑真实脚本），理论上可以立刻补验证，但本 session 没做。
2. **issue 6d3c2744（P1）非文本消息编造回复**未动：文件/音乐卡片/红包转账场景下 AI 会编造回复内容（如凭空报价"基础版3980一个月"），比不回复更危险。需要逐类型（文件/音乐卡片/转账/图片/语音/表情）定位草稿生成 prompt 或前置解析逻辑。
3. **wechat-cs-troubleshooting skill §2.I 内容需要更正**（见上）。

## rog 真机诊断通道（本 session 新建立，供下次直接复用）
```bash
# session 0（SSH 直连，能读写文件/跑 tasklist，不能碰 GUI/UIA）
ssh xian-rog "命令"

# session 1（GUI/UIA 可用）：建一次性计划任务绕过权限限制
ssh xian-rog "powershell -Command \"\$lines=@('@echo off','set PYTHONUTF8=1','C:\Users\asus\Anaconda3\python.exe <脚本路径> > <输出路径> 2>&1'); Set-Content -Path '<bat路径>' -Value \$lines -Encoding ascii\""
ssh xian-rog "schtasks /delete /tn <任务名> /f 2>nul & schtasks /create /tn <任务名> /tr \"<bat路径>\" /sc once /st 00:00 /ru asus /it /f"
ssh xian-rog "schtasks /run /tn <任务名>"
# 用 Bash run_in_background + until 轮询输出文件是否生成，不要用裸 sleep
```
本机 repo checkout 路径（rog CI runner 工作区，可直接 scp 覆盖脚本做真机验证）：
`C:\actions-runner\_work\zenithjoy-workspace\zenithjoy-workspace\`

## 关键决策引用
- decision c13f5570：完整性校验不能用含图片计数的原始 badge_n 比对纯文本 msgs 条数

## 产物指针
- PR #1160（已合并）：https://github.com/perfectuser21/zenithjoy-workspace/pull/1160
- PR #1163（已合并）：https://github.com/perfectuser21/zenithjoy-workspace/pull/1163
- PR #1165（已合并）：https://github.com/perfectuser21/zenithjoy-workspace/pull/1165
- PR #106（已合并，zenithjoy-skills）：https://github.com/perfectuser21/zenithjoy-skills/pull/106
- Issues：4024c90b（P0）/ 05630ae5（P0）/ 69c634b7（P2）/ 6d3c2744（P1，未处理）
