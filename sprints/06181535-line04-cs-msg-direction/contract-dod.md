---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Line04「不回自己」读最后一条气泡方向，只回对方

**范围**: `listen_chat.py` 加 `_last_bubble_direction(mw)` 纯函数（读最底部气泡判左右对齐）+ 接进 Phase 2 回复决策（仅 incoming 才回，outgoing/None 跳过）+ 修 `decide_reply_wait` 的 `human_intervened` 占位（outgoing⇒True）+ mock 气泡 pytest + 打包副本同步。**不含**真机微信气泡 UIA 结构确认与位置阈值校准（另排）。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] `listen_chat.py` 顶层（零 pywinauto）定义 `_last_bubble_direction`
  Test: node -e "const c=require('fs').readFileSync('services/agent/wechat-rpa/listen_chat.py','utf8');if(!/def _last_bubble_direction\(/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 回归测试文件存在且覆盖 6 case
  Test: node -e "const c=require('fs').readFileSync('services/agent/wechat-rpa/tests/test_msg_direction.py','utf8');for(const k of ['incoming','outgoing','operator','last_bubble_wins','empty','midline'])if(!c.includes(k))process.exit(1)"

- [ ] [ARTIFACT] 打包副本 `build-modules/line04/wechat-rpa/listen_chat.py` 同步含新函数
  Test: node -e "const c=require('fs').readFileSync('services/agent/build-modules/line04/wechat-rpa/listen_chat.py','utf8');if(!/def _last_bubble_direction\(/.test(c))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令；autonomous → 独立 oracle 跑真实函数，防假绿）

- [ ] [BEHAVIOR] Golden Path Step 1/2 — 最底部左对齐气泡 → 返回 "incoming"（对方发来，应回）
  Test: manual:bash -c 'python3 sprints/06181535-line04-cs-msg-direction/oracle/direction_oracle.py incoming'
  期望: exit 0，stdout OK[incoming]

- [ ] [BEHAVIOR] Golden Path Step 1 — 多条气泡只认最底部那条（上 outgoing + 底 incoming → incoming）
  Test: manual:bash -c 'python3 sprints/06181535-line04-cs-msg-direction/oracle/direction_oracle.py last_wins'
  期望: exit 0，stdout OK[last_wins]

- [ ] [BEHAVIOR] Golden Path Step 3 — 最底部右对齐气泡 → 返回 "outgoing"（我方/AI，跳过不回自己）
  Test: manual:bash -c 'python3 sprints/06181535-line04-cs-msg-direction/oracle/direction_oracle.py outgoing'
  期望: exit 0，stdout OK[outgoing]

- [ ] [BEHAVIOR] Golden Path Step 3 边界 — 气泡压中线 → "outgoing"（倾向判我方更安全）
  Test: manual:bash -c 'python3 sprints/06181535-line04-cs-msg-direction/oracle/direction_oracle.py midline'
  期望: exit 0，stdout OK[midline]

- [ ] [BEHAVIOR] Golden Path Step 4 — 操作者最右对齐气泡 → "outgoing"（据此 human_intervened=True 跳过）
  Test: manual:bash -c 'python3 sprints/06181535-line04-cs-msg-direction/oracle/direction_oracle.py operator'
  期望: exit 0，stdout OK[operator]

- [ ] [BEHAVIOR] Golden Path Step 4 接线 — 硬编码 human_intervened=False 占位移除 且 主循环引用 _last_bubble_direction
  Test: manual:bash -c 'grep -q "_last_bubble_direction(" services/agent/wechat-rpa/listen_chat.py && ! grep -q "decide_reply_wait(human_intervened=False)" services/agent/wechat-rpa/listen_chat.py || { echo "FAIL: human_intervened 占位未接线/未移除"; exit 1; }; echo OK'
  期望: exit 0，stdout OK

- [ ] [BEHAVIOR] Golden Path Step 5 边界 — 聊天面板无气泡 → 返回 None（安全跳过，宁可漏回不可回错）
  Test: manual:bash -c 'python3 sprints/06181535-line04-cs-msg-direction/oracle/direction_oracle.py empty'
  期望: exit 0，stdout OK[empty]

- [ ] [BEHAVIOR] Golden Path Step 6 — 打包副本含新函数 且 与源码完全一致（CI L4 Gate 的 diff -r 死规则）
  Test: manual:bash -c 'grep -q "def _last_bubble_direction" services/agent/build-modules/line04/wechat-rpa/listen_chat.py || { echo "FAIL: 打包副本未同步新函数"; exit 1; }; diff -r services/agent/wechat-rpa/ services/agent/build-modules/line04/wechat-rpa/ --exclude="*.pyc" --exclude="__pycache__" || { echo "FAIL: build-modules 与源码分叉"; exit 1; }; echo OK'
  期望: exit 0，stdout OK

- [ ] [BEHAVIOR] 回归 — wechat-rpa 全量 pytest 全绿（test_msg_direction 6 case 转绿 + 既有测试不回退）
  Test: manual:bash -c 'python3 -m pip install --quiet pytest 2>/dev/null; cd services/agent/wechat-rpa && python3 -m pytest tests/ -q || { echo "FAIL: 全量 pytest 未全绿"; exit 1; }'
  期望: exit 0
