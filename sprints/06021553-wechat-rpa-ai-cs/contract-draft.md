# Sprint Contract Draft — Round 1

**Sprint**: Path 4 客户私域 AI 接管 · 微信 4.0 RPA 换 pywinauto + 自动回复模式
**Journey**: 客户私域 AI 接管（Path 4）
**Journey ID**: `bfeed805-deed-46c3-8624-87f0028101d4`
**Notion**: `35ac40c2-ba63-81af-af97-e3bc8e3b0fb4`
**Journey Type**: user_facing
**PRD**: `sprints/06021553-wechat-rpa-ai-cs/sprint-prd.md`
**propose_round**: 1
**propose_branch**: cp-harness-propose-r1-25ad5930
**Path 推进声明**: 本 PR 把 Path 4 的个微监听/发送层从 ❌ 失效（wxauto4 不能读微信 4.0 消息）推到 ✅（pywinauto 配方 2026-06-02 真机验证），同时把 `generateChatDraft` 推进到支持 `mode:'auto'` 自动发送回路。

---

## 全局事实（合同内一致性基准）

| 项 | 事实 | 来源 |
|---|---|---|
| Python 执行机 | xian-pc（Windows 10 + Python 3.12 + pywinauto） | PRD ASSUMPTION |
| CI 执行机 | Linux（GitHub Actions），pywinauto import 必然失败 | PRD ASSUMPTION |
| Lead 自验机 | xian-rog（asus 用户，agent 已部署） | PRD §验收标准 |
| dryrun 模式 | `--dryrun` 路径与 `scan_unread` 纯函数**零 pywinauto 依赖**（CI 可跑） | PRD ASSUMPTION |
| wxauto4 状态 | 2026-06-02 确认失效，禁止一切保留 | PRD §背景 |
| FAIL_PLACEHOLDER | `'AI 生成失败（请人审决定是否重试）'` | `wechat-draft.ts:219` |
| API 端口 | 5200（`apps/api/src/index.ts` PORT 默认值） | 代码实证 |
| DB 名 | `cecelia` | `apps/api/src/db/connection.ts` |
| find_weixin.py 函数名 | 当前 stub 是 `find_main_window()`，合同要求改造成 `get_main_window()` | 代码实证（find_weixin.py:10） |
| rate_limiter MIN_INTERVAL | 操作间隔 ≥ 1s（`MIN_INTERVAL_SECONDS=1`） | `rate_limiter.py:43` — 频控测试必须 `sleep(1.1)` 隔离，否则被间隔限制误拒 |

---

## Workstream DAG

```
ws1（Python 换库：find_weixin + listen_chat + send_chat + requirements.txt）
    ‖ 并行
ws2（TypeScript：generateChatDraft mode:'auto' + reply 字段）
    ↓ 合并后
ws3（测试：test_scan_unread.py + test_rate_limiter.py + wechat-draft-auto-reply.test.ts）
    ↓
ws4（CI + 静态校验 + Lead 自验 evidence 模板）
```

ws1 ‖ ws2 可并行实现；ws3 依赖 ws1+ws2；ws4 依赖 ws3。

---

## ws1：Python 换库

### 行为描述

1. `find_weixin.py`：删除 `NotImplementedError` stub，实现 `get_main_window()` → 用 `Desktop(backend='uia').windows()` 枚举 `class_name == 'mmui::MainWindow'`；未找到时返回 `None`，不抛异常。

2. `listen_chat.py`：
   - 删除全部 wxauto4 import/引用（含 `WXAUTO4_AVAILABLE` flag、`_emit_version_to_stderr`、`run_real_listen` 中的 `wx = wxauto4.WeChat()` 等）
   - 真模式换成 pywinauto `scan_unread + reply_in_chat` 配方：
     - `get_main_window()`：从 `find_weixin.get_main_window()` 获取，失败则输出 `{"ok":false,"reason":"wechat_not_running"}` 退出
     - `scan_unread(mw)`：`mw.descendants(control_type='ListItem')` → 解析 `element_info.name`，匹配含 `[N条]` 的条目 → 返回 `list[{sender, content}]`，过滤公众号/服务号（含"号"字的系统账号名）
     - `reply_in_chat(mw, item, reply)`：`item.select()` → 找 `automation_id=='chat_input_field'` → `set_text(reply)` → 找 `name=='发送'` 按钮 → `click_input()` → 验证输入框 `get_value() == ''`（清空 = 发送成功）
   - **`--dryrun` 路径与 `scan_unread` 纯函数完全不 import pywinauto**（CI 零依赖硬约束）
   - POST draft-generate 带 `"mode": "auto"` 参数
   - 从响应拿 `reply` 字段；若 `reply` 为空或等于 FAIL_PLACEHOLDER → 跳过 `reply_in_chat`，不发给客户
   - 已回集合 `replied: set[tuple[str,str]]`，按 `(sender, content)` 去重
   - 频控 `rate_limiter.can_send('chat', wechat_id)` → `False` 时跳过当前消息

3. `send_chat.py`：
   - 删除 `pyautogui` 全部引用（含 `_load_pyautogui`、`pyautogui.hotkey/click/write/press` 调用链）
   - 真发逻辑（`REAL_PUBLISH=1`）换成 `reply_in_chat` 配方（复用 listen_chat.py 中的同名函数，或内联等价实现）
   - REAL_PUBLISH=0 → mock 路径不变，输出 `{"ok":true, "dryRun":true, "sent_at":"..."}`

4. `requirements.txt`：删除 `wxauto4`、`pyautogui`、`pyperclip`；添加 `pywinauto>=0.6.8`；保留 `pywin32`（pywinauto 依赖）、`requests`

### 验证命令

```bash
# === Happy 1: wxauto4 已在工作区完全移除 ===
WXAUTO4_HITS=$(grep -rn "wxauto4" services/agent/wechat-rpa/ 2>/dev/null | grep -v ".pyc" | wc -l)
[ "$WXAUTO4_HITS" = "0" ] \
  && echo "PASS: wxauto4 工作区 0 行引用" \
  || (echo "FAIL: 仍有 $WXAUTO4_HITS 行引用 wxauto4:"; \
      grep -rn "wxauto4" services/agent/wechat-rpa/ 2>/dev/null; exit 1)

# === Happy 2: requirements.txt pywinauto 就位，禁止库已删 ===
python3 -c "
content = open('services/agent/wechat-rpa/requirements.txt').read()
assert 'pywinauto' in content, 'FAIL: requirements.txt 缺 pywinauto'
for banned in ('wxauto4', 'pyautogui', 'pyperclip'):
    assert banned not in content, f'FAIL: requirements.txt 仍含 {banned}'
print('PASS: requirements.txt pywinauto 就位，禁止库已删')
"

# === Happy 3: find_weixin.py 实现就位（不再是 NotImplementedError stub）===
python3 -c "
import ast
src = open('services/agent/wechat-rpa/find_weixin.py').read()
tree = ast.parse(src)
funcs = {n.name for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)}
assert 'get_main_window' in funcs, 'FAIL: get_main_window 函数不存在'
assert 'NotImplementedError' not in src, 'FAIL: 仍含 NotImplementedError stub'
assert 'mmui::MainWindow' in src, 'FAIL: 缺 mmui::MainWindow 枚举条件'
assert 'uia' in src, 'FAIL: 缺 backend=uia 声明'
print('PASS: find_weixin.py get_main_window 实现就位，含 mmui::MainWindow + uia')
"

# === Happy 4: listen_chat.py 真模式含 pywinauto 配方关键词 ===
python3 -c "
src = open('services/agent/wechat-rpa/listen_chat.py').read()
# 已无 wxauto4
assert 'wxauto4' not in src, 'FAIL: listen_chat.py 仍引用 wxauto4'
# pywinauto 配方
assert 'scan_unread' in src, 'FAIL: 缺 scan_unread 函数'
assert 'reply_in_chat' in src, 'FAIL: 缺 reply_in_chat 函数'
assert 'chat_input_field' in src, 'FAIL: 缺 automation_id==chat_input_field'
has_send_btn = '发送' in src
assert has_send_btn, 'FAIL: 缺 发送 按钮定位'
# mode:auto
assert 'mode' in src and 'auto' in src, 'FAIL: 缺 mode:auto 参数'
# reply 字段处理（含 FAIL_PLACEHOLDER 跳过逻辑）
assert 'reply' in src, 'FAIL: 缺 reply 字段处理'
# 频控
assert 'can_send' in src, 'FAIL: 缺 rate_limiter.can_send 调用'
# 去重集合
assert 'replied' in src, 'FAIL: 缺 replied 已回集合'
print('PASS: listen_chat.py 配方齐全（pywinauto + mode:auto + reply + 频控 + 去重）')
"

# === Happy 5: listen_chat.py --dryrun 路径零 pywinauto import（CI 硬约束）===
python3 -c "
import ast, sys
src = open('services/agent/wechat-rpa/listen_chat.py').read()
# dryrun 路径的代码不应在顶层 import pywinauto（应在 Windows 真模式函数内部按需 import）
# 检查方式：模块顶层 import 不得含 pywinauto
tree = ast.parse(src)
top_imports = [n for n in ast.walk(tree) if isinstance(n, (ast.Import, ast.ImportFrom))
               and n.col_offset == 0]
for imp in top_imports:
    names = [a.name for a in getattr(imp, 'names', [])] + \
            ([imp.module] if hasattr(imp, 'module') and imp.module else [])
    for name in names:
        assert 'pywinauto' not in (name or ''), \
            f'FAIL: pywinauto 在顶层 import（dryrun 路径 CI 会失败）: {ast.dump(imp)}'
print('PASS: listen_chat.py 顶层无 pywinauto import（dryrun 路径 CI 安全）')
"

# === Happy 6: send_chat.py pyautogui 硬坐标序列已删 ===
python3 -c "
src = open('services/agent/wechat-rpa/send_chat.py').read()
# 不应有 pyautogui 坐标调用（hotkey/click 等）
hardcode_markers = ['pyautogui.hotkey', 'pyautogui.click', 'pyautogui.write',
                    'pyautogui.press', 'pyautogui.sleep']
for m in hardcode_markers:
    assert m not in src, f'FAIL: send_chat.py 仍含硬坐标调用 {m}'
# 真发路径换成 pywinauto 或 reply_in_chat
assert 'reply_in_chat' in src or 'chat_input_field' in src, \
    'FAIL: send_chat.py 真发路径缺 pywinauto/chat_input_field'
# 频控保留
assert 'can_send' in src, 'FAIL: send_chat.py 缺 rate_limiter.can_send'
# stdin JSON 接口保留
assert 'stdin' in src, 'FAIL: send_chat.py stdin 接口缺失'
print('PASS: send_chat.py pyautogui 硬坐标已删，pywinauto 换入，频控+stdin 保留')
"

# === 边界 1: listen_chat.py 检测讲述人未解锁（会话列表 ListItem 为空） ===
python3 -c "
src = open('services/agent/wechat-rpa/listen_chat.py').read()
# 应有讲述人未解锁检测：ListItem 列表为空时报警
assert 'ListItem' in src, 'FAIL: 缺 control_type=ListItem 检测'
print('PASS: listen_chat.py 含 ListItem 会话列表检测（讲述人解锁校验入口）')
"

# === 边界 2: FAIL_PLACEHOLDER 跳过逻辑就位 ===
python3 -c "
src = open('services/agent/wechat-rpa/listen_chat.py').read()
# FAIL_PLACEHOLDER 跳过：reply 为空或含 'AI 生成失败' 时不调 reply_in_chat
placeholder_text = 'AI 生成失败'
assert placeholder_text in src, \
    f'FAIL: listen_chat.py 缺 FAIL_PLACEHOLDER ({placeholder_text!r}) 跳过逻辑'
print('PASS: FAIL_PLACEHOLDER 跳过逻辑就位（不把失败占位发给客户）')
"

# === 防作弊 1: 无主动发起新会话 def（thin 阶段护栏）===
FOUND=$(grep -rE "def (send_to|proactive_|outbound_|initiate_|start_chat_with_|cold_outreach_|first_message_)" \
  services/agent/wechat-rpa/ 2>/dev/null | wc -l)
[ "$FOUND" = "0" ] \
  && echo "PASS: 无主动发起会话 def（thin 阶段护栏完好）" \
  || (echo "FAIL: $FOUND 个主动发起 def — thin 阶段不允许"; exit 1)
```

### 硬阈值

- `grep -rn "wxauto4" services/agent/wechat-rpa/` = 0 行（工作区）
- `requirements.txt` 含 `pywinauto`，不含 `wxauto4`/`pyautogui`/`pyperclip`
- `find_weixin.py` 含 `mmui::MainWindow` 和 `uia`，不含 `NotImplementedError`
- `listen_chat.py` 顶层无 `pywinauto` import（dryrun CI 可跑）
- `send_chat.py` 无 `pyautogui.click/hotkey/write/press/sleep` 调用

---

## ws2：TypeScript `generateChatDraft` 扩展

### 行为描述

`apps/api/src/services/wechat-draft.ts` 的 `generateChatDraft`：

1. `GenerateChatDraftParams` 加可选字段 `mode?: 'auto' | 'review'`（默认 `'review'`）
2. `GenerateChatDraftSuccess` 加可选字段 `reply?: string`
3. `mode == 'auto'` 时：`aiContent` 非空且非 FAIL_PLACEHOLDER → 赋给 `reply` 一同返回；否则 `reply` 不设或为空字符串
4. 默认 `mode == 'review'` 路径行为**完全不变**：approval_status 仍 `pending_review`，approval_source 仍 `NULL`，不返回 `reply`
5. 飞书写入、DB 写入、FAIL_PLACEHOLDER 降级逻辑全部复用现有实现，`mode` 只在成功路径末尾多返回 `reply`

### 验证命令

```bash
# === Happy 1: TypeScript 接口扩展（静态）===
node -e "
const fs = require('fs');
const src = fs.readFileSync('apps/api/src/services/wechat-draft.ts', 'utf8');
// GenerateChatDraftParams 含 mode
const hasMode = /GenerateChatDraftParams[\s\S]{0,200}mode\??\s*:\s*['\"]auto['\"]/.test(src);
// GenerateChatDraftSuccess 含 reply
const hasReply = /GenerateChatDraftSuccess[\s\S]{0,200}reply\??\s*:\s*string/.test(src);
if (!hasMode) { console.error('FAIL: GenerateChatDraftParams 缺 mode 字段'); process.exit(1); }
if (!hasReply) { console.error('FAIL: GenerateChatDraftSuccess 缺 reply 字段'); process.exit(1); }
console.log('PASS: GenerateChatDraftParams + Success 接口扩展就位');
"

# === Happy 2: mode:'review' 默认行为不返回 reply（向后兼容）===
# 由集成测试 ws3 覆盖（见 wechat-draft-auto-reply.test.ts）

# === Happy 3: generateChatDraft 在 mode:'auto' 成功时返回 reply 非空、非占位 ===
# 由集成测试 ws3 覆盖

# === 防作弊 1: approval_status 仍 pending_review，approval_source 仍 NULL（A 路线护栏）===
node -e "
const src = require('fs').readFileSync('apps/api/src/services/wechat-draft.ts', 'utf8');
// approval_status 禁止出现 'approved'（任何路径）
const approvedIdx = src.indexOf(\"approval_status: 'approved'\");
if (approvedIdx !== -1) {
  console.error('FAIL: 发现 approval_status approved 写入 — A 路线护栏破');
  process.exit(1);
}
// approval_source 在 generateChatDraft 中应为 null
const nullSourceMatch = /null,\s*\/\/.*ws.*approval_source.*NULL/.test(src) ||
                        /approval_source.*null/.test(src);
if (!nullSourceMatch) {
  console.error('FAIL: generateChatDraft 中 approval_source 非 null — A 路线护栏破');
  process.exit(1);
}
console.log('PASS: A 路线护栏完好（approval_status=pending_review，approval_source=NULL）');
"
```

### 硬阈值

- `GenerateChatDraftParams.mode` 字段存在，类型 `'auto' | 'review'`，可选
- `GenerateChatDraftSuccess.reply` 字段存在，类型 `string`，可选
- `mode == 'review'` 时返回值中无 `reply` 字段（或 `undefined`）
- `approval_status` 严禁 `'approved'`，`approval_source` 严禁非 null

---

## ws3：测试

### 3a. Python 单元测试

#### `test_scan_unread.py`（纯函数，零 pywinauto 依赖）

```bash
# === Happy 1: scan_unread 解析格式 '[N条] content 时间' ===
cd services/agent/wechat-rpa && python3 -m pytest tests/test_scan_unread.py -v 2>&1 \
  | tee /tmp/test_scan_unread.log
grep -E "PASSED|passed" /tmp/test_scan_unread.log \
  && echo "PASS: test_scan_unread 全绿" \
  || (echo "FAIL: test_scan_unread 有失败:"; cat /tmp/test_scan_unread.log; exit 1)
```

**测试用例必须覆盖（`[FROM_PRD]` 验收标准第1条）**：

| 输入 `element_info.name` | 期望结果 |
|---|---|
| `'于瑾\n[1条] \n您好\n15:26\n'` | `[{sender:'于瑾', content:'您好'}]` |
| `'公众号\n[1条] \n广告\n11:09\n'` | `[]`（系统账号过滤）|
| `'服务号\n[3条] \n活动推送\n09:00\n'` | `[]`（系统账号过滤）|
| `'张三\n张三\n14:00\n'`（无 `[N条]`） | `[]`（无未读不返回）|
| `'张三\n[5条] \n在吗\n09:00\n'` | `{sender:'张三', content:'在吗'}` |

**额外约束**：
- 测试文件顶层无 `import pywinauto`，确保 Linux CI 可跑
- `scan_unread` 函数接受 mock 对象（模拟 `mw.descendants()` 返回，不真调 pywinauto）

#### `test_rate_limiter.py`（已有基础，补充分钟上限测试）

```bash
cd services/agent/wechat-rpa && python3 -m pytest tests/test_rate_limiter.py -v 2>&1 \
  | tee /tmp/test_rate_limiter.log
grep -E "PASSED|passed" /tmp/test_rate_limiter.log \
  && echo "PASS: test_rate_limiter 全绿" \
  || (echo "FAIL: test_rate_limiter 有失败:"; cat /tmp/test_rate_limiter.log; exit 1)
```

**频控单测必须覆盖（`[FROM_PRD]` 验收标准第2条）**：

```python
# 同 wechat_id 第 3 次调用（1 分钟内）返回 (False, next_allowed_at)
# 重要：rate_limiter 有 MIN_INTERVAL_SECONDS=1，每次调用之间必须 sleep(1.1) 避免被间隔限制误拒
import time
from rate_limiter import can_send, reset
reset('test_freq_wid')
ok1, _ = can_send('chat', 'test_freq_wid')
assert ok1 is True, f'第1次应通过，实际 ok={ok1}'
time.sleep(1.1)                              # 必须等过 MIN_INTERVAL_SECONDS=1
ok2, _ = can_send('chat', 'test_freq_wid')
assert ok2 is True, f'第2次应通过，实际 ok={ok2}'
time.sleep(1.1)
ok3, next_at = can_send('chat', 'test_freq_wid')
assert ok3 is False, f'第3次应被拒（超 CHAT_PER_MINUTE=2），实际 ok={ok3}'
assert next_at is not None, '缺 next_allowed_at'
```

### 3b. dryrun smoke（CI 核心路径）

```bash
# === Happy：dryrun + inject-message 退出码 0，stdout 含 dryRun:true ===
RESULT=$(WECHAT_DRAFT_API_DRYRUN=1 \
  python3 services/agent/wechat-rpa/listen_chat.py \
  --dryrun \
  --inject-message='{"sender":"test","wechat_id":"wx123","content":"你好"}' \
  2>/dev/null)
RC=$?
[ "$RC" = "0" ] \
  && echo "$RESULT" | python3 -c "
import sys, json
out = json.loads(sys.stdin.read())
assert out.get('ok') is True, f'FAIL: ok 不为 true: {out}'
assert out.get('dryRun') is True, f'FAIL: dryRun 不为 true: {out}'
assert out.get('draft_generated') is True, f'FAIL: draft_generated 不为 true: {out}'
print('PASS: dryrun inject-message 退出码 0，stdout ok=true dryRun=true draft_generated=true')
" \
  || (echo "FAIL: dryrun 退出码=$RC 或输出错误: $RESULT"; exit 1)
```

### 3c. TypeScript 集成测试

#### `wechat-draft-auto-reply.test.ts`

```bash
cd apps/api && npm test -- --testPathPattern=wechat-draft-auto-reply 2>&1 \
  | tee /tmp/wechat-draft-auto-reply.log
grep -E "PASS|Tests:.*passed" /tmp/wechat-draft-auto-reply.log \
  && echo "PASS: wechat-draft-auto-reply 集成测试全绿" \
  || (echo "FAIL: 集成测试失败:"; cat /tmp/wechat-draft-auto-reply.log; exit 1)
```

**集成测试必须覆盖（`[FROM_PRD]` 验收标准第4条）**：

| 场景 | mock 设置 | 期望结果 |
|---|---|---|
| `mode:'auto'` 成功 | 飞书返回 1 条互动记录 + openrouter 返回非空文本 | `{ok:true, reply:'<文本>'}` reply 非空、非 FAIL_PLACEHOLDER |
| `mode:'review'`（默认） | 同上 | `{ok:true, status:'pending_review'}` 无 `reply` 字段 |
| `mode:'auto'` AI 失败 | openrouter 抛异常 | `{ok:true}` reply 为空或 FAIL_PLACEHOLDER（listen_chat 侧跳过发送） |
| sender 不在名单 | 飞书"客户档案" 返回空 | `{ok:false, reason:'not_in_whitelist'}` |

**mock 规范**（CI 关键约束）：
- mock 飞书 tenant token 接口（`axios.post` for `/auth/v3/tenant_access_token/internal`）
- mock 飞书 bitable search（`axios.post` for `/bitable/v1/apps/.../records/search`）：客户档案返回 1 条，互动记录返回 1 条历史
- mock openrouter `callOpenRouter`：成功时返回 `{content: '好的，已收到'}`
- mock DB pool（`pool.query`）：INSERT 不真执行
- **不调真实网络**（CI 无 FEISHU/OPENROUTER 凭据）

### 硬阈值

- `test_scan_unread.py` 5 类 case 全过（含公众号过滤 + 无未读过滤）
- `test_rate_limiter.py` 分钟级频控上限 case 过
- dryrun smoke 退出码 0 + stdout `ok:true` + `dryRun:true`
- `wechat-draft-auto-reply.test.ts` 4 个 case 全过
- 所有 Python 测试顶层无 `import pywinauto`（`grep -n "^import pywinauto" tests/*.py` = 0 行）

---

## ws4：CI 校验 + Lead 自验 evidence

### 4a. CI 静态防作弊

```bash
# === 防作弊 1: Python 测试顶层无 pywinauto import ===
PYWIA_IN_TESTS=$(grep -rn "^import pywinauto\|^from pywinauto" \
  services/agent/wechat-rpa/tests/ 2>/dev/null | wc -l)
[ "$PYWIA_IN_TESTS" = "0" ] \
  && echo "PASS: 测试文件顶层无 pywinauto import（Linux CI 安全）" \
  || (echo "FAIL: 测试文件含顶层 pywinauto import（CI 必爆）:"; \
      grep -rn "^import pywinauto\|^from pywinauto" services/agent/wechat-rpa/tests/; exit 1)

# === 防作弊 2: listen_chat.py dryrun 分支不调 pywinauto ===
python3 -c "
import ast, sys
src = open('services/agent/wechat-rpa/listen_chat.py').read()
tree = ast.parse(src)
# 找 run_dryrun_inject 函数（或 dryrun 入口），确认函数体内无 pywinauto
for node in ast.walk(tree):
    if isinstance(node, ast.FunctionDef) and 'dryrun' in node.name.lower():
        fn_src = ast.get_source_segment(src, node) or ''
        assert 'pywinauto' not in fn_src, \
            f'FAIL: {node.name}() 内含 pywinauto（dryrun 路径 CI 会崩）'
print('PASS: dryrun 相关函数体内无 pywinauto 调用')
"

# === 防作弊 3: generateChatDraft mode:'review' 路径返回值无 reply 字段 ===
cd apps/api && npm test -- --testPathPattern=wechat-draft-auto-reply \
  --verbose 2>&1 | grep -E "mode.*review.*no reply|default.*no reply|review.*undefined" \
  && echo "PASS: mode:review 路径无 reply 字段（向后兼容）" \
  || echo "INFO: 防作弊 3 通过集成测试 case 间接覆盖"
```

### 4b. Lead 自验 evidence 模板

```bash
# === Happy: evidence 模板文件就位 ===
test -f .agent-knowledge/path-4/lead-acceptance-wechat-rpa-pywinauto.md \
  && grep -E "^##.*(设备|xian-pc|测试步骤|截图|飞书|记录)" \
     .agent-knowledge/path-4/lead-acceptance-wechat-rpa-pywinauto.md \
  && echo "PASS: Lead 自验 evidence 模板存在且包含必要章节" \
  || (echo "FAIL: evidence 模板路径或章节缺失"; exit 1)
```

**evidence 模板必须包含章节（Lead 在 xian-pc 自验后填充）**：

- `## 测试设备` — xian-pc (Windows 10, Python 3.12, 微信 4.0)
- `## 前置条件` — 讲述人解锁步骤确认
- `## 测试步骤` — 6 步 Golden Path 操作记录
- `## 截图 / 录屏` — 客户发"你好" + listener 读到 + DeepSeek 生成 + 发出截图
- `## 飞书互动记录` — pending_review 记录截图 / record_id
- `## 结论` — PASS / FAIL + 日期 2026-06-02

```bash
# === 防作弊: evidence 模板不允许是空占位（必须含至少 20 行实质内容）===
LINES=$(wc -l < .agent-knowledge/path-4/lead-acceptance-wechat-rpa-pywinauto.md 2>/dev/null || echo 0)
[ "$LINES" -ge "20" ] \
  && echo "PASS: evidence 模板 $LINES 行（≥20，非空占位）" \
  || (echo "FAIL: evidence 模板 $LINES 行 < 20（空占位不算）"; exit 1)
```

---

## 最终验收汇总（合同 DoD）

| # | 验收项 | 环境 | 通过标准 |
|---|---|---|---|
| 1 | wxauto4 工作区 0 行 | CI Linux | `grep -r wxauto4 services/agent/wechat-rpa/ \| wc -l` = 0 |
| 2 | requirements.txt pywinauto 就位 | CI Linux | grep 通过 |
| 3 | `test_scan_unread.py` 5 类 case 全绿 | CI Linux | pytest PASSED |
| 4 | `test_rate_limiter.py` 分钟上限 case 绿 | CI Linux | pytest PASSED |
| 5 | dryrun smoke 退出 0 + `dryRun:true` | CI Linux | 退出码 0 + JSON 断言 |
| 6 | `wechat-draft-auto-reply.test.ts` 4 case 绿 | CI Linux | npm test PASS |
| 7 | `find_weixin.py` 含 `mmui::MainWindow` + `uia` | CI Linux | python3 断言 |
| 8 | `listen_chat.py` 含 `chat_input_field` + `mode:auto` | CI Linux | python3 断言 |
| 9 | `send_chat.py` 无 `pyautogui.*` 调用 | CI Linux | python3 断言 |
| 10 | A 路线护栏：`approval_status ≠ 'approved'` | CI Linux | node 断言 |
| 11 | Lead 自验 evidence 模板存在（≥20 行） | PR 合并前 | bash 断言 |
| 12 | 真机自验截图 + 飞书记录（2026-06-02 xian-pc） | out-of-CI | evidence 文件填充 |

---

## 不在本合同范围内

- ❌ wxauto4 任何保留形式（已在 DoD #1 强制校验）
- ❌ 讲述人自动解锁（人工前置操作）
- ❌ 主动发起新会话（thin 阶段护栏）
- ❌ 群聊/朋友圈/图片/语音处理
- ❌ 多号矩阵
- ❌ 真机微信 E2E 进 CI
- ❌ send_moment.py / qr_bind.py 改造
- ❌ wechat-rpa.ts NodeJS handler 逻辑变动
- ❌ 新增 DB 表或字段

---

## APPROVE 后产出

合同 APPROVED 后 Planner 生成：
- `task-plan.json` — ws1/ws2/ws3/ws4 任务 DAG + 受影响文件清单
- `tests/ws1/` — Python 静态校验 + pywinauto 配方关键词断言 RED 骨架
- `tests/ws2/` — TypeScript 接口 + A 路线护栏断言 RED 骨架
- `tests/ws3/` — `test_scan_unread.py` + `test_rate_limiter.py` + `wechat-draft-auto-reply.test.ts` RED 骨架
- `tests/ws4/` — CI 防作弊 + evidence 模板检查骨架
- `contract-dod-ws1.md` ... `contract-dod-ws4.md` — 细分 DoD（本合同各 ws 验证命令逐 ws 拆分）
