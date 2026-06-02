---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Sprint 06021553-wechat-rpa-ai-cs

**范围**：Path 4 Step 5（私聊自动回复）— `listen_chat.py` / `send_chat.py` / `find_weixin.py` 换 pywinauto；`generateChatDraft` 加 `mode:'auto'` 暴露 `reply`
**大小**：M
**target_environment**：linux_server（CI 评分）+ Lead 真机自验（xian-rog，out-of-CI evidence）

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `find_weixin.py` 实现 `get_main_window()` 用 `Desktop(backend='uia').windows()` 找 `mmui::MainWindow`
  Test: manual:bash -c 'src=$(cat services/agent/wechat-rpa/find_weixin.py); echo "$src" | grep -q "def get_main_window" && echo "$src" | grep -q "mmui::MainWindow" && echo "$src" | grep -q "mmui::LoginWindow" && echo "$src" | grep -E "backend.{0,3}uia" >/dev/null && ! echo "$src" | grep -q "NotImplementedError" && echo OK'
  期望：OK

- [ ] [ARTIFACT] `listen_chat.py` 含 pywinauto 配方关键字（`scan_unread`、`_parse_item_name`、`reply_in_chat`、`chat_input_field`、`发送`、`click_input`、`mode`、`auto`、`replied`、`can_send`、FAIL_PLACEHOLDER 跳过）
  Test: manual:bash -c 'src=$(cat services/agent/wechat-rpa/listen_chat.py); for kw in "def scan_unread" "_parse_item_name" "def reply_in_chat" "chat_input_field" "发送" "click_input" "replied" "can_send"; do echo "$src" | grep -q "$kw" || { echo "FAIL: 缺 $kw"; exit 1; }; done; echo "$src" | grep -E "mode.{0,5}auto" >/dev/null || { echo "FAIL: 缺 mode:auto"; exit 1; }; echo "$src" | grep -qE "AI 生成失败|FAIL_PLACEHOLDER" || { echo "FAIL: 缺 FAIL_PLACEHOLDER 跳过"; exit 1; }; ! echo "$src" | grep -q "wxauto4" || { echo "FAIL: wxauto4 残留"; exit 1; }; echo OK'
  期望：OK

- [ ] [ARTIFACT] `send_chat.py` 删除全部 `pyautogui.click/write/hotkey/press/sleep` 调用，真发路径换 pywinauto 配方，保留频控 + stdin
  Test: manual:bash -c 'src=$(cat services/agent/wechat-rpa/send_chat.py); for m in "pyautogui.click" "pyautogui.write" "pyautogui.hotkey" "pyautogui.press" "pyautogui.sleep"; do ! echo "$src" | grep -q "$m" || { echo "FAIL: $m 残留"; exit 1; }; done; echo "$src" | grep -qE "chat_input_field|reply_in_chat" || { echo "FAIL: 真发路径无 pywinauto 配方"; exit 1; }; echo "$src" | grep -q "can_send" || { echo "FAIL: 频控丢失"; exit 1; }; echo "$src" | grep -q "stdin" || { echo "FAIL: stdin 接口丢失"; exit 1; }; echo OK'
  期望：OK

- [ ] [ARTIFACT] `requirements.txt` 含 `pywinauto`，不含 `wxauto4` / `pyautogui` / `pyperclip`
  Test: manual:bash -c 'c=$(cat services/agent/wechat-rpa/requirements.txt); echo "$c" | grep -q "pywinauto" || { echo "FAIL: 缺 pywinauto"; exit 1; }; for b in wxauto4 pyautogui pyperclip; do ! echo "$c" | grep -q "$b" || { echo "FAIL: $b 残留"; exit 1; }; done; echo OK'
  期望：OK

- [ ] [ARTIFACT] `wechat-draft.ts` `GenerateChatDraftParams.mode?: 'auto' | 'review'` + `GenerateChatDraftSuccess.reply?: string` 字段扩展
  Test: manual:bash -c 'src=$(cat apps/api/src/services/wechat-draft.ts); node -e "const s=process.argv[1]; if(!/GenerateChatDraftParams[\\s\\S]{0,300}mode\\??\\s*:/.test(s))process.exit(1); if(!/GenerateChatDraftSuccess[\\s\\S]{0,300}reply\\??\\s*:\\s*string/.test(s))process.exit(2)" "$src" && echo OK'
  期望：OK

- [ ] [ARTIFACT] 测试文件 `tests/test_scan_unread.py` / `tests/test_rate_limiter.py` / `__tests__/wechat-draft-auto-reply.test.ts` 存在；Python 测试顶层无 `pywinauto` import
  Test: manual:bash -c 'test -f services/agent/wechat-rpa/tests/test_scan_unread.py && test -f services/agent/wechat-rpa/tests/test_rate_limiter.py && test -f apps/api/src/services/__tests__/wechat-draft-auto-reply.test.ts || { echo "FAIL: 测试文件缺失"; exit 1; }; HITS=$(grep -E "^import pywinauto|^from pywinauto" services/agent/wechat-rpa/tests/*.py 2>/dev/null | wc -l); [ "$HITS" = "0" ] || { echo "FAIL: 测试顶层 pywinauto import"; exit 1; }; echo OK'
  期望：OK

- [ ] [ARTIFACT] Lead 真机自验 evidence 模板 `.agent-knowledge/path-4/lead-acceptance-wechat-rpa-pywinauto.md` ≥20 行 + 6 章节骨架（测试设备 / 前置条件 / 测试步骤 / 截图 / 飞书互动记录 / 结论）
  Test: manual:bash -c 'F=.agent-knowledge/path-4/lead-acceptance-wechat-rpa-pywinauto.md; test -f "$F" || { echo "FAIL: 缺失"; exit 1; }; [ "$(wc -l < $F)" -ge 20 ] || { echo "FAIL: <20 行"; exit 1; }; for h in "## 测试设备" "## 前置条件" "## 测试步骤" "## 截图" "## 飞书互动记录" "## 结论"; do grep -F "$h" "$F" >/dev/null || { echo "FAIL: 缺章节 $h"; exit 1; }; done; echo OK'
  期望：OK

---

## BEHAVIOR 条目

### B1：全库 `wxauto4` 0 残留（PRD §不在范围 + §背景失效库强制）

- [ ] [BEHAVIOR] 全库（`services/` + `apps/`）无 wxauto4 引用
  Test: manual:bash -c 'HITS=$(grep -rn "wxauto4" services/ apps/ --include="*.py" --include="*.ts" 2>/dev/null | wc -l); [ "$HITS" = "0" ] || { echo "FAIL: $HITS 行 wxauto4 残留"; grep -rn "wxauto4" services/ apps/ --include="*.py" --include="*.ts"; exit 1; }; echo OK'
  期望：OK

### B2：listen_chat dryrun 退出码 0 + JSON 字段正确（CI 关键路径，PRD §验收第 3 条）

- [ ] [BEHAVIOR] `listen_chat.py --dryrun --inject-message` 退出码 0，stdout JSON `ok:true, dryRun:true, draft_generated:true`
  Test: manual:bash -c 'RESULT=$(WECHAT_DRAFT_API_DRYRUN=1 python3 services/agent/wechat-rpa/listen_chat.py --dryrun --inject-message="{\"sender\":\"test\",\"wechat_id\":\"wx123\",\"content\":\"你好\"}" 2>/dev/null); RC=$?; [ "$RC" = "0" ] || { echo "FAIL: 退出码=$RC"; exit 1; }; echo "$RESULT" | python3 -c "import sys,json; o=json.loads(sys.stdin.read()); assert o[\"ok\"] is True; assert o[\"dryRun\"] is True; assert o[\"draft_generated\"] is True" || { echo "FAIL: JSON 字段不符"; echo "$RESULT"; exit 1; }; echo OK'
  期望：OK

### B3：`_parse_item_name` 5 case pytest 全过（PRD §验收第 1 条）

- [ ] [BEHAVIOR] `tests/test_scan_unread.py` 5/5 pytest passed（G1-G5：正常私信 / 公众号过滤 / 服务号过滤 / 无未读不返回 / 多条未读）
  Test: manual:bash -c 'cd services/agent/wechat-rpa && python3 -m pytest tests/test_scan_unread.py -v 2>&1 | tee /tmp/scan.log | grep -E "5 passed" || { echo "FAIL: 非 5 passed"; cat /tmp/scan.log; exit 1; }; echo OK'
  期望：OK

### B4：rate_limiter 分钟上限拒第 3 次（PRD §验收第 2 条）

- [ ] [BEHAVIOR] `tests/test_rate_limiter.py` 分钟上限 case 过（前 2 次 True，第 3 次 False+next_at，含 `time.sleep(1.1)` 隔离）
  Test: manual:bash -c 'cd services/agent/wechat-rpa && python3 -m pytest tests/test_rate_limiter.py -v 2>&1 | tee /tmp/rate.log | grep -E "passed" || { echo "FAIL"; cat /tmp/rate.log; exit 1; }; echo OK'
  期望：OK

### B5：`generateChatDraft mode:'auto'` 暴露 reply（PRD §验收第 4 条）

- [ ] [BEHAVIOR] `wechat-draft-auto-reply.test.ts` 4/4 vitest case 全过（J1 mode:auto 返 reply / J2 review 不含 reply / J3 AI 失败 reply 为 undefined / J4 名单外 not_in_whitelist）
  Test: manual:bash -c 'cd apps/api && npx vitest run src/services/__tests__/wechat-draft-auto-reply.test.ts 2>&1 | tee /tmp/auto.log | grep -E "[1-9][0-9]* passed" || { echo "FAIL"; cat /tmp/auto.log; exit 1; }; echo OK'
  期望：OK

### B6：A 路线护栏未破 — `approval_status` 严禁 `'approved'`

- [ ] [BEHAVIOR] `wechat-draft.ts` 内 `approval_status: 'approved'` 字面量不存在；保留 `pending_review` + `approval_source = null`
  Test: manual:bash -c 'src=$(cat apps/api/src/services/wechat-draft.ts); ! echo "$src" | grep -q "approval_status: '"'"'approved'"'"'" || { echo "FAIL: approval_status approved 出现 — A 路线护栏破"; exit 1; }; echo "$src" | grep -q "pending_review" || { echo "FAIL: pending_review 缺失"; exit 1; }; echo OK'
  期望：OK

### B7：thin 护栏 — 无主动发起会话 def

- [ ] [BEHAVIOR] `services/agent/wechat-rpa/` 下不存在 `send_to_/proactive_/outbound_/initiate_/start_chat_with_/cold_outreach_/first_message_` 任一前缀的函数定义
  Test: manual:bash -c 'FOUND=$(grep -rE "def (send_to|proactive_|outbound_|initiate_|start_chat_with_|cold_outreach_|first_message_)" services/agent/wechat-rpa/ 2>/dev/null | wc -l); [ "$FOUND" = "0" ] || { echo "FAIL: $FOUND 个主动发起 def"; exit 1; }; echo OK'
  期望：OK

### B8：CI Linux 安全 — `listen_chat.py` / `find_weixin.py` / 测试文件顶层零 `pywinauto` import

- [ ] [BEHAVIOR] AST col_offset=0 校验：`listen_chat.py` / `find_weixin.py` 顶层 import 无 `pywinauto`；测试文件顶层 grep 无 `pywinauto`
  Test: manual:bash -c 'python3 -c "
import ast
for f in [\"services/agent/wechat-rpa/listen_chat.py\", \"services/agent/wechat-rpa/find_weixin.py\"]:
    src = open(f).read()
    tree = ast.parse(src)
    for n in ast.walk(tree):
        if isinstance(n,(ast.Import, ast.ImportFrom)) and n.col_offset == 0:
            names = [a.name for a in getattr(n,\"names\",[])]
            if hasattr(n,\"module\") and n.module: names.append(n.module)
            for name in names:
                assert \"pywinauto\" not in (name or \"\"), f\"FAIL: {f} 顶层 pywinauto\"
" && HITS=$(grep -E "^import pywinauto|^from pywinauto" services/agent/wechat-rpa/tests/*.py 2>/dev/null | wc -l) && [ "$HITS" = "0" ] && echo OK || { echo "FAIL"; exit 1; }'
  期望：OK

---

## BEHAVIOR:E2E 条目（user_facing 真机 — out-of-CI，Lead 在 xian-rog 完成存档）

- [ ] [BEHAVIOR:E2E] Lead 在 xian-rog 真机走完 Golden Path 6 步并存档
  Screenshots:
    - lead-01-wechat-incoming.png  期望：客户私聊"你好"出现在微信 4.0 会话列表 ListItem，`[1条]` 未读标记可见
    - lead-02-listener-stdout.png  期望：listen_chat.py 真模式 stdout 含 `draft_generated`，sender=客户名
    - lead-03-wechat-sent.png      期望：reply_in_chat 发送后，运营微信 4.0 窗口对该客户消息框显示"运营本人"发出的 AI 回复文本
    - lead-04-feishu-record.png    期望：飞书"互动记录"表新增一条 `状态=pending_review`、`approval_source=空` 的记录，含 sender / 客户原话 / AI 草稿三列
  路径格式：写入 `.agent-knowledge/path-4/lead-acceptance-wechat-rpa-pywinauto.md` 内嵌引用
  期望：Lead 填截图 + feishu record_id 后 evidence 文件含 6 章节齐全；Evaluator 在 Lead 完成后单独评分，不阻塞 CI 绿

---

## 评分权重

| 条目 | 权重 | 阻断 CI |
|---|---|---|
| ARTIFACT 7 条 + B1-B5 | 必须 | 是 |
| B6（A 路线护栏） | 必须 | 是 |
| B7（thin 护栏） | 高 | 是 |
| B8（CI Linux 安全） | 必须 | 是 |
| BEHAVIOR:E2E（真机存档） | 中 | 否（Lead 后补，单独评） |
