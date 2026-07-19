# Handoff：热键自检判据修复 + SendInput 结构体修正（PR #1420）

- task_id: unknown（交互式 /dev 路径 A，未走 headed --task-id 流程）
- journey: Path 4 客户私域 AI 接管（Line04 微信客服）
- verdict: PASS

## done
- 修复 PR #1410 引入的两个真机 bug（都是测试/判据缺陷，不是路线问题），已合并进 main（commit 0c9dfd66，版本 1.0.147）：
  1. `check_hotkey_summon` 判据从"IsWindowVisible 翻转"改为检测 (前台是否变微信 / 可见 / 最小化) 三元组任一变化。真机铁证：微信响应 Ctrl+Alt+W 是"被拉到前台"(fg→微信 hwnd 461008) 而非隐藏，onboarding 时微信本可见、置顶不改可见性→旧判据在热键好用的机器上必现误报 failed。
  2. `_send_hotkey_ctrl_alt_w` 从已废弃 keybd_event 换成修正后 SendInput。INPUT 结构体 union 须含 MOUSEINPUT 最大成员且字段用定宽类型（c_uint32 等，非 c_ulong——后者 mac/linux 是 8 字节使跨平台 sizeof 错）→ x64 sizeof=40。旧版少 MOUSEINPUT→32→SendInput 返回 0+err87 一个键都发不出（这是排查中一度误判"热键路线不通"的根因）。
- 两个守卫均已变异测试：缺 MOUSEINPUT→sizeof32≠40 报红；判据回退可见性→前台变化回归测试报红。
- 复现判据回流 line04-hotkey-summon-smoke.sh（Step 4，CI 层等价断言 + 真机段 TODO）。
- build-modules rsync 同步 + 三面版本 1.0.147 一致。
- 真机验证（feedback_realmachine_fix_validate_yourself）：新代码复制到 rog 临时目录跑实际 check_hotkey_summon，修复前 failed → 新代码同场景 ok。

## 重大认知更正（写给下一个大脑）
- **热键召唤（Ctrl+Alt+W）这条路线本身完全可行，不需要 Interception 内核驱动，不需要改 agent 启动方式。** 排查早期一度误判"软件模拟按键无法触发全局热键、要装驱动"——那全是诊断脚本自身的 64 位 INPUT 结构体 bug（SendInput 返回 0 键没发出）+ 判据太弱（微信响应是置顶、用可见性看不出）两个测试缺陷造成的假象。真机已证明 SendInput（修正后）和 keybd_event 都能触发微信 Ctrl+Alt+W 把它拉到前台。
- 相关作废决策见 Brain decision 6218ce98（更正 368e2483 的错误结论）。

## not_done / next_steps
1. OTA 交付 1.0.147 到 rog 后，真实绑号 onboarding 走一遍 preflight 确认 hotkey_summon 报 ok（可选后续，行为已用实际函数真机验证过）。
2. **键位冲突是唯一残留的真实产品问题**：rog 上 Ctrl+Alt+W 恰好没被抢，但全局热键先到先得，不同客户机开机自启软件不同，Ctrl+Alt+W 可能被别的软件抢注→微信注册失败→快捷键在那台机器上死掉。改进方向（未做，待拍板）：选更冷门不易撞的组合键，或让 onboarding 检测到"热键无响应"时引导客户换键。修复后的 check_hotkey_summon 已能如实检测这种冲突（三元组全不变→failed，detail 提示"可能被别的软件抢注，换一个不冲突的组合键"）。
3. handoff 0719 发现2（音频提示音叫醒 + 降级轮询）仍未落地，是更大的改动，另立。

## data_sources
- Brain decisions: 6218ce98（热键路线可行性更正）、35e95ee6（本次 bug 修法）、368e2483（已作废的错误结论）
- services/agent/wechat-rpa/preflight.py::check_hotkey_summon
- services/agent/wechat-rpa/listen_chat.py::INPUT / _make_kb_input / _send_hotkey_ctrl_alt_w
- .github/workflows/scripts/smoke/line04-hotkey-summon-smoke.sh（Step 4 回流判据）
- memory: feedback_realmachine_fix_validate_yourself / feedback_no_live_core_swap_for_testing / windows-agent-diagnostics

## artifacts
- PR: https://github.com/perfectuser21/zenithjoy-workspace/pull/1420
- merge commit: 0c9dfd66
- branch: cp-0719214523-line04-hotkey-selfcheck-fix（已合并，worktree 已清理）
