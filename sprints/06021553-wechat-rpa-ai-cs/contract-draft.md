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
| Lead 自验机 | xian-rog（所有 Sprint 验证装这里） | PRD §验收标准 |
| dryrun 模式 | `--dryrun` 路径与 `_parse_item_name`/`scan_unread` 纯函数**零 pywinauto 依赖**（CI 可跑） | PRD ASSUMPTION |
| wxauto4 状态 | 2026-06-02 确认失效，禁止一切保留 | PRD §背景 |
| FAIL_PLACEHOLDER | `'AI 生成失败（请人审决定是否重试）'` | `wechat-draft.ts:219` |
| find_weixin.py 函数名 | 当前 stub 是 `find_main_window()`，合同要求改造成 `get_main_window()` | 代码实证（find_weixin.py:10） |
| rate_limiter MIN_INTERVAL | 操作间隔 ≥ 1s（`MIN_INTERVAL_SECONDS=1`） | `rate_limiter.py:43` — 频控测试必须 sleep(1.1) 隔离 |
| API 端口 | 5200（`apps/api/src/index.ts` PORT 默认值） | 代码实证 |

---

## Workstream DAG

```
ws1（Python 换库：find_weixin + listen_chat + send_chat + requirements.txt）
    ‖ 并行
ws2（TypeScript：generateChatDraft mode:'auto' + reply 字段）
    ↓ 合并后
ws3（测试：test_scan_unread.py + test_rate_limiter.py + wechat-draft-auto-reply.test.ts）
    ↓
ws4（CI 静态防作弊 + Lead 自验 evidence 模板）
```

ws1 ‖ ws2 可并行实现；ws3 依赖 ws1+ws2；ws4 依赖 ws3。

---

## ws1：Python 换库

### 行为描述

**`find_weixin.py`**：删除 `find_main_window()` stub，实现 `get_main_window()`：

- `Desktop(backend='uia').windows()` 枚举所有顶层窗口
- 找到 `element_info.class_name == 'mmui::MainWindow'` → 返回该 wrapper
- 找到 `element_info.class_name == 'mmui::LoginWindow'` → 抛 `RuntimeError('微信未登录，请先扫码登录')`
- 列表为空/找不到 → 抛 `RuntimeError('找不到微信主窗口，请确认讲述人（Narrator）已解锁 UI 自动化')`
- 非 Windows (`sys.platform != 'win32'`) → 抛 `RuntimeError('pywinauto 仅支持 Windows')`
- pywinauto 仅在函数内部 `import`（不在模块顶层），确保 Linux CI import find_weixin 不崩

**`listen_chat.py`**：

1. 删除全部 wxauto4 残留（`import wxauto4`、`WXAUTO4_AVAILABLE`、`WXAUTO4_VERSION`、`WXAUTO4_IMPORT_ERR`、`_emit_version_to_stderr`、模块级 `_emit_version_to_stderr()` 调用，以及 `run_real_listen` 中所有 wxauto4 引用）
2. 新增顶层纯函数 `_parse_item_name(name: str) -> Optional[Dict[str, str]]`（必须在模块顶层，零 pywinauto 依赖，Linux CI 可直接 import 测试）：
   - 解析 `element_info.name` 格式：`'发送者\n[N条] \n消息内容\n时间\n'`
   - 用 `re.search(r'\[\d+条\]', ...)` 检测未读标记，无则返回 `None`
   - `SYSTEM_ACCOUNT_PREFIXES = ("公众号", "服务号", "微信团队", "微信支付", "腾讯新闻")` 系统账号过滤，命中则返回 `None`
   - 成功返回 `{"sender": sender, "content": content}`
3. 新增 `scan_unread(mw) -> list`：`mw.descendants(control_type='ListItem')` 遍历 → 调 `_parse_item_name(item.element_info.name)` → 非 None 时收集，附带原 item 对象
4. 新增 `reply_in_chat(mw, item, reply_text: str) -> bool`：
   - `item.select()` 打开会话
   - 找 `automation_id == 'chat_input_field'` → `set_text(reply_text)`
   - 找 `name == '发送'` 按钮 → `click_input()`
   - 验证 `edit.get_value() == ''`（清空 = 发送成功），成功返回 `True`，失败返回 `False`
   - `click_input()` 抛 `PermissionError` → 向上传播，stderr 提示需登录用户身份运行
5. 真模式主循环（`run_real_listen`）：
   - 调 `get_main_window()` 失败 → `emit_json({ok:False, reason:'wechat_not_running', detail:...})` → return 0
   - `replied: set[tuple[str, str]]` — `(sender, content)` 去重集合
   - 每 2 秒 `scan_unread(mw)` → 对每条 item：
     a. `(sender, content) in replied` → skip
     b. `rate_limiter.can_send('chat', sender)` 返回 False → skip，记 next_allowed_at
     c. POST draft-generate 带 `"mode": "auto"` 参数
     d. `result.get('reply')` 为空或 `== FAIL_PLACEHOLDER` → skip（不发占位文案）
     e. `reply_in_chat(mw, item.item_obj, result['reply'])` 成功 → `replied.add((sender, content))`
   - `KeyboardInterrupt` → `emit_json({ok:True, info:'listen loop exited'})` → return 0
6. `--dryrun` / `--inject-message` 路径：保持当前行为结构，POST 调用带 `mode:'auto'`
7. **顶层零 pywinauto**：pywinauto 仅在 `run_real_listen` / `scan_unread` / `reply_in_chat` 内部 import，dryrun 路径 CI 安全

**`send_chat.py`**：

1. 删除 `_load_pyautogui` 函数及全部 `pyautogui.*` 调用（`hotkey`、`click`、`write`、`press`、`sleep`）
2. `REAL_PUBLISH=1` 真发路径换成 pywinauto `reply_in_chat` 配方：从 `find_weixin` 取 `get_main_window()`，遍历找到 target，调 `reply_in_chat`
3. `REAL_PUBLISH=0` mock 路径不变，输出 `{"ok":true, "dryRun":true, "sent_at":"..."}`
4. 频控 `rate_limiter.can_send('chat', wechat_id)` 保留
5. stdin JSON 接口保留

**`requirements.txt`**：

- 删除：`wxauto4>=39.0.0`、`pyautogui>=0.9.54`、`pyperclip>=1.8.2`
- 新增：`pywinauto>=0.6.8; sys_platform == "win32"`
- 保留：`pywin32>=306; sys_platform == "win32"`、`requests>=2.31.0`

### 验证命令

```bash
# === 断言 A：wxauto4 工作区 0 行 ===
WXAUTO4_HITS=$(grep -rn "wxauto4" services/ apps/ --include="*.py" --include="*.ts" \
  2>/dev/null | grep -v ".pyc" | wc -l)
[ "$WXAUTO4_HITS" = "0" ] \
  && echo "PASS: wxauto4 工作区 0 行" \
  || (echo "FAIL: $WXAUTO4_HITS 行 wxauto4 引用"; \
      grep -rn "wxauto4" services/ apps/ --include="*.py" --include="*.ts"; exit 1)

# === 断言 B：requirements.txt pywinauto 就位，禁止库已删 ===
python3 -c "
content = open('services/agent/wechat-rpa/requirements.txt').read()
assert 'pywinauto' in content, 'FAIL: requirements.txt 缺 pywinauto'
for banned in ('wxauto4', 'pyautogui', 'pyperclip'):
    assert banned not in content, f'FAIL: requirements.txt 仍含 {banned}'
print('PASS: requirements.txt pywinauto 就位，禁止库已删')
"

# === 断言 C：find_weixin.py 实现非 stub ===
python3 -c "
src = open('services/agent/wechat-rpa/find_weixin.py').read()
assert 'def get_main_window' in src, 'FAIL: get_main_window 函数不存在'
assert 'NotImplementedError' not in src, 'FAIL: 仍含 NotImplementedError stub'
assert 'uia' in src, 'FAIL: 缺 backend=uia'
assert 'mmui::MainWindow' in src, 'FAIL: 缺 mmui::MainWindow'
print('PASS: find_weixin.py get_main_window 实现就位（含 uia + mmui::MainWindow，无 stub）')
"

# === 断言 D：listen_chat.py 核心配方 ===
python3 -c "
src = open('services/agent/wechat-rpa/listen_chat.py').read()
assert 'wxauto4' not in src and 'WXAUTO4' not in src, 'FAIL: wxauto4 残留'
assert 'scan_unread' in src, 'FAIL: 缺 scan_unread'
assert '_parse_item_name' in src, 'FAIL: 缺 _parse_item_name 纯函数'
assert 'ListItem' in src, 'FAIL: 缺 ListItem 枚举'
assert 'chat_input_field' in src, 'FAIL: 缺 chat_input_field'
assert '发送' in src, 'FAIL: 缺 发送 按钮'
assert 'click_input' in src, 'FAIL: 缺 click_input'
assert 'auto' in src, 'FAIL: 缺 mode:auto'
assert 'reply' in src, 'FAIL: 缺 reply 字段'
assert 'AI 生成失败' in src or 'FAIL_PLACEHOLDER' in src, 'FAIL: 缺 FAIL_PLACEHOLDER 跳过'
assert 'can_send' in src, 'FAIL: 缺 rate_limiter.can_send'
assert 'replied' in src, 'FAIL: 缺 replied 去重集合'
print('PASS: listen_chat.py 配方完整')
"

# === 断言 D10：listen_chat.py 顶层无 pywinauto import（CI 安全）===
python3 -c "
import ast
src = open('services/agent/wechat-rpa/listen_chat.py').read()
tree = ast.parse(src)
top_imports = [n for n in ast.walk(tree)
               if isinstance(n, (ast.Import, ast.ImportFrom)) and n.col_offset == 0]
for imp in top_imports:
    names = [a.name for a in getattr(imp, 'names', [])] + \
            ([imp.module] if hasattr(imp, 'module') and imp.module else [])
    for name in names:
        assert 'pywinauto' not in (name or ''), \
            f'FAIL: pywinauto 在顶层 import（dryrun CI 会失败）'
print('PASS: listen_chat.py 顶层无 pywinauto import')
"

# === 断言 E：send_chat.py pyautogui 硬坐标已删 ===
python3 -c "
src = open('services/agent/wechat-rpa/send_chat.py').read()
for m in ['pyautogui.hotkey','pyautogui.click','pyautogui.write','pyautogui.press','pyautogui.sleep']:
    assert m not in src, f'FAIL: send_chat.py 仍含 {m}'
assert 'reply_in_chat' in src or 'chat_input_field' in src, \
    'FAIL: send_chat.py 真发路径缺 pywinauto 配方'
assert 'can_send' in src, 'FAIL: send_chat.py 缺频控'
assert 'stdin' in src, 'FAIL: send_chat.py stdin 接口缺失'
print('PASS: send_chat.py pyautogui 硬坐标已删，pywinauto 换入，频控+stdin 保留')
"

# === 防作弊：无主动发起新会话 def（thin 护栏）===
FOUND=$(grep -rE "def (send_to|proactive_|outbound_|initiate_|start_chat_with_|cold_outreach_|first_message_)" \
  services/agent/wechat-rpa/ 2>/dev/null | wc -l)
[ "$FOUND" = "0" ] \
  && echo "PASS: 无主动发起会话 def（thin 护栏完好）" \
  || (echo "FAIL: $FOUND 个主动发起 def"; exit 1)
```

### 硬阈值

- `grep -r "wxauto4" services/ apps/` = 0 行
- `requirements.txt` 含 `pywinauto`，不含 `wxauto4`/`pyautogui`/`pyperclip`
- `find_weixin.py` 含 `get_main_window`、`mmui::MainWindow`、`uia`，不含 `NotImplementedError`
- `listen_chat.py` 顶层无 `pywinauto` import（AST col_offset==0 检查）
- `send_chat.py` 无 `pyautogui.click/hotkey/write/press/sleep` 调用

---

## ws2：TypeScript `generateChatDraft` 扩展

### 行为描述

`apps/api/src/services/wechat-draft.ts`：

1. `GenerateChatDraftParams` 加可选字段 `mode?: 'auto' | 'review'`（默认 `'review'`）
2. `GenerateChatDraftSuccess` 加可选字段 `reply?: string`
3. `mode == 'auto'` 且 `aiContent` 非空且 `aiContent !== FAIL_PLACEHOLDER` → 赋 `reply = aiContent` 返回
4. 默认 `mode == 'review'`（或不传）路径**完全不变**：approval_status 仍 `pending_review`，approval_source 仍 `NULL`，返回值无 `reply`
5. 飞书写入、DB 写入、FAIL_PLACEHOLDER 降级逻辑全部复用现有实现，`mode` 只在成功路径末尾多暴露 `reply`
6. `FAIL_PLACEHOLDER` 常量值不变：`'AI 生成失败（请人审决定是否重试）'`

### 验证命令

```bash
# === 断言 I1：GenerateChatDraftParams 含 mode 字段 ===
node -e "
const src = require('fs').readFileSync('apps/api/src/services/wechat-draft.ts', 'utf8');
const hasMode = /GenerateChatDraftParams[\s\S]{0,300}mode\??\s*:/.test(src);
if (!hasMode) { console.error('FAIL: GenerateChatDraftParams 缺 mode 字段'); process.exit(1); }
console.log('PASS: GenerateChatDraftParams 含 mode 字段');
"

# === 断言 I2：GenerateChatDraftSuccess 含 reply 字段 ===
node -e "
const src = require('fs').readFileSync('apps/api/src/services/wechat-draft.ts', 'utf8');
const hasReply = /GenerateChatDraftSuccess[\s\S]{0,300}reply\??\s*:\s*string/.test(src);
if (!hasReply) { console.error('FAIL: GenerateChatDraftSuccess 缺 reply?: string'); process.exit(1); }
console.log('PASS: GenerateChatDraftSuccess 含 reply?: string');
"

# === 断言 I3：A 路线护栏完好 ===
node -e "
const src = require('fs').readFileSync('apps/api/src/services/wechat-draft.ts', 'utf8');
if (src.includes(\"approval_status: 'approved'\")) {
  console.error('FAIL: approval_status approved — A 路线护栏破'); process.exit(1);
}
if (!src.includes('approval_source') || !src.includes('null,')) {
  console.error('FAIL: approval_source null 缺失'); process.exit(1);
}
console.log('PASS: A 路线护栏完好（pending_review，approval_source=null）');
"
```

### 硬阈值

- `GenerateChatDraftParams.mode` 字段存在，类型 `'auto' | 'review'`，可选
- `GenerateChatDraftSuccess.reply` 字段存在，类型 `string`，可选
- `mode == 'review'` 时返回值无 `reply`（或 `undefined`）
- `approval_status` 严禁 `'approved'`，`approval_source` 严禁非 null

---

## ws3：测试

### 3a. `test_scan_unread.py`（`_parse_item_name` 纯函数，零 pywinauto 依赖）

**关键设计**：测试直接 import `_parse_item_name`（顶层纯函数），不需要 mock pywinauto，Linux CI 可跑。

```bash
cd services/agent/wechat-rpa
python3 -m pytest tests/test_scan_unread.py -v 2>&1 | tee /tmp/test_scan_unread.log
grep -E "5 passed|PASSED" /tmp/test_scan_unread.log \
  && echo "PASS: test_scan_unread 5/5 全绿" \
  || (echo "FAIL: 有用例失败:"; cat /tmp/test_scan_unread.log; exit 1)
```

**必须覆盖的 5 个 case（`[FROM_PRD]` 验收标准第 1 条）**：

| # | 输入（`_parse_item_name` 入参） | 期望结果 |
|---|---|---|
| G1 正常私信 | `'于瑾\n[1条] \n您好\n15:26\n'` | `{"sender":"于瑾","content":"您好"}` |
| G2 公众号过滤 | `'公众号\n[1条] \n广告\n11:09\n'` | `None` |
| G3 服务号过滤 | `'服务号\n[3条] \n活动推送\n09:00\n'` | `None` |
| G4 无未读不返回 | `'李华\n昨天下午好\n11:09\n'`（无 `[N条]`） | `None` |
| G5 多条未读数字 | `'张三\n[5条] \n在吗\n09:00\n'` | `{"sender":"张三","content":"在吗"}` |

**额外约束**：

```bash
# 测试文件顶层无 pywinauto import（Linux CI 安全）
grep -n "^import pywinauto\|^from pywinauto" \
  services/agent/wechat-rpa/tests/test_scan_unread.py | wc -l
# 必须 = 0
```

### 3b. `test_rate_limiter.py`（频控分钟上限，含 sleep 隔离）

> **关键约束**：`rate_limiter.py` 有 `MIN_INTERVAL_SECONDS = 1`（`rate_limiter.py:43`），测试在每次 `can_send` 之间**必须** `time.sleep(1.1)`，否则第二次调用会被间隔限制拒绝，导致误判。

```bash
cd services/agent/wechat-rpa
python3 -m pytest tests/test_rate_limiter.py -v 2>&1 | tee /tmp/test_rate_limiter.log
grep -E "passed|PASSED" /tmp/test_rate_limiter.log \
  && echo "PASS: test_rate_limiter 全绿" \
  || (echo "FAIL: 有用例失败:"; cat /tmp/test_rate_limiter.log; exit 1)
```

**分钟上限 case 必须用此模式**（`[FROM_PRD]` 验收标准第 2 条）：

```python
import time
from rate_limiter import can_send, reset

def test_chat_per_minute_limit():
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

### 3c. dryrun smoke（CI 核心路径）

```bash
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
assert out.get('dryRun') is True, f'FAIL: dryRun 不为 true（JSON 布尔）: {out}'
assert out.get('draft_generated') is True, f'FAIL: draft_generated 不为 true: {out}'
print('PASS: dryrun inject-message 退出码 0，ok=true dryRun=true draft_generated=true')
" \
  || (echo "FAIL: dryrun 退出码=$RC 或输出错误: $RESULT"; exit 1)
```

### 3d. TypeScript 集成测试（`wechat-draft-auto-reply.test.ts`）

```bash
cd apps/api
npx jest wechat-draft-auto-reply --testPathPattern='__tests__' 2>&1 \
  | tee /tmp/wechat-draft-auto-reply.log
grep -E "Tests:.*passed|PASS" /tmp/wechat-draft-auto-reply.log \
  && echo "PASS: wechat-draft-auto-reply 集成测试全绿" \
  || (echo "FAIL:"; cat /tmp/wechat-draft-auto-reply.log; exit 1)
```

**必须覆盖 4 个 case（mock 飞书 + mock openrouter，不调真实网络）**：

| # | mock 设置 | 期望结果 |
|---|---|---|
| J1 `mode:'auto'` 成功 | 飞书返回 1 条互动记录 + openrouter 返回 `'好的，已收到'` | `{ok:true, reply:'好的，已收到'}` reply 非空、非 FAIL_PLACEHOLDER |
| J2 `mode:'review'`（默认）成功 | 同上 | `{ok:true, status:'pending_review'}` reply 为 `undefined` |
| J3 `mode:'auto'` AI 失败 | openrouter 抛异常 | `{ok:true}` reply 为 `undefined`（listener 侧检测后跳过发送） |
| J4 sender 不在名单 | 飞书"客户档案"返回空 | `{ok:false, reason:'not_in_whitelist'}` |

**mock 规范（CI 关键约束）**：

- `axios.post` mock：`/auth/v3/tenant_access_token/internal` → token；`/bitable/v1/.../records/search` → items；`/bitable/v1/.../records` CREATE → record_id
- `callOpenRouter` mock：J1 → `{content:'好的，已收到'}`；J3 → `throw new Error('timeout')`
- `pool.query` mock：INSERT 不真执行
- **不调真实网络**（CI 无 FEISHU/OPENROUTER 凭据）

### 硬阈值

- `test_scan_unread.py` 5 个 case 全过（G1-G5，含公众号/服务号/无未读过滤）
- `test_rate_limiter.py` 分钟上限 case 过（含 `time.sleep(1.1)` 隔离）
- dryrun smoke 退出码 0 + `dryRun:true`（JSON 布尔）+ `draft_generated:true`
- `wechat-draft-auto-reply.test.ts` 4 个 case 全过（J1-J4）
- 所有 Python 测试文件顶层无 `import pywinauto`

---

## ws4：CI 静态防作弊 + Lead 自验 evidence

### 4a. 测试文件顶层无 pywinauto import（断言 K）

```bash
PYWIA_IN_TESTS=$(grep -rn "^import pywinauto\|^from pywinauto" \
  services/agent/wechat-rpa/tests/ 2>/dev/null | wc -l)
[ "$PYWIA_IN_TESTS" = "0" ] \
  && echo "PASS: 测试文件顶层无 pywinauto import（Linux CI 安全）" \
  || (echo "FAIL: 含顶层 pywinauto import:"; \
      grep -rn "^import pywinauto\|^from pywinauto" services/agent/wechat-rpa/tests/; exit 1)
```

### 4b. Lead 自验 evidence 模板（断言 M）

文件：`.agent-knowledge/path-4/lead-acceptance-wechat-rpa-pywinauto.md`

```bash
test -f .agent-knowledge/path-4/lead-acceptance-wechat-rpa-pywinauto.md \
  && [ "$(wc -l < .agent-knowledge/path-4/lead-acceptance-wechat-rpa-pywinauto.md)" -ge "20" ] \
  && echo "PASS: Lead 自验 evidence 模板存在且 ≥20 行" \
  || (echo "FAIL: evidence 模板缺失或 <20 行"; exit 1)
```

**模板必须包含 6 个章节**（Generator 建骨架，Lead 填充）：

- `## 测试设备` — xian-rog (Windows 10, Python 3.12, 微信 4.0, pywinauto)
- `## 前置条件` — 讲述人解锁步骤确认
- `## 测试步骤` — 6 步 Golden Path 操作记录
- `## 截图 / 录屏` — 客户发"你好" + listener 读到 + DeepSeek 生成 + 发出截图
- `## 飞书互动记录` — pending_review 记录截图/record_id
- `## 结论` — PASS/FAIL + 日期 2026-06-02

> **注**：M 不阻塞 CI 绿；Evaluator 在 Lead 完成真机自验后单独评分。

---

## 文件变更清单

### 改造（替换核心实现）

| 文件 | 改动摘要 |
|---|---|
| `services/agent/wechat-rpa/find_weixin.py` | 删 stub，实现 `get_main_window()`：uia 枚举 mmui::MainWindow，RuntimeError 报警 |
| `services/agent/wechat-rpa/listen_chat.py` | 删全部 wxauto4，换 pywinauto 配方（`_parse_item_name` + `scan_unread` + `reply_in_chat`）；POST 带 mode:'auto'；取 reply；FAIL_PLACEHOLDER 跳过；频控；去重 |
| `services/agent/wechat-rpa/send_chat.py` | 删 pyautogui 硬坐标，换 `reply_in_chat` 配方；保留频控+stdin |
| `services/agent/wechat-rpa/requirements.txt` | 删 wxauto4/pyautogui/pyperclip，加 pywinauto；保留 pywin32/requests |
| `apps/api/src/services/wechat-draft.ts` | `GenerateChatDraftParams` 加 `mode?`；`GenerateChatDraftSuccess` 加 `reply?`；mode=='auto' 暴露 aiContent |

### 新增（测试文件）

| 文件 | 内容 |
|---|---|
| `services/agent/wechat-rpa/tests/__init__.py` | 空文件（目录不存在则建） |
| `services/agent/wechat-rpa/tests/test_scan_unread.py` | 5 case（G1-G5），测 `_parse_item_name` 纯函数，零 pywinauto |
| `services/agent/wechat-rpa/tests/test_rate_limiter.py` | 分钟上限 case，含 `time.sleep(1.1)` 隔离 |
| `apps/api/src/services/__tests__/wechat-draft-auto-reply.test.ts` | 4 case（J1-J4），mock 飞书+openrouter |
| `.agent-knowledge/path-4/lead-acceptance-wechat-rpa-pywinauto.md` | Lead 自验 evidence 模板（≥20 行，6 章节） |

### 不动

- `services/agent/wechat-rpa/rate_limiter.py`
- `services/agent/wechat-rpa/qr_bind.py`、`send_moment.py`
- `services/agent/src/handlers/wechat-rpa.ts`
- `apps/api/src/routes/wechat-draft-router.ts`
- `apps/api/src/llm/openrouter.ts`

---

## Commit 顺序（TDD 强制）

```
commit-1: test(wechat-rpa): scan_unread 5 case 单测（RED）+ rate_limiter 分钟上限测（RED，含 sleep(1.1) 隔离）+ wechat-draft-auto-reply 4 case integration（RED）+ Lead evidence 模板骨架
commit-2: feat(wechat-rpa): pywinauto 换装（find_weixin.get_main_window + listen_chat 配方 + send_chat 配方 + requirements.txt）+ wechat-draft mode:auto（让所有测试 GREEN）
```

CI `lint-tdd-commit-order` 检查：test 文件必须在 src 改动之前出现在 commit 历史。

---

## 最终验收汇总（合同 DoD）

| # | 验收项 | 环境 | 通过标准 |
|---|---|---|---|
| 1 | wxauto4 工作区 0 行 | CI Linux | `grep -r wxauto4 services/ apps/` = 0 |
| 2 | requirements.txt pywinauto 就位，禁止库已删 | CI Linux | python3 断言通过 |
| 3 | `test_scan_unread.py` 5/5 case 绿（G1-G5） | CI Linux | pytest PASSED |
| 4 | `test_rate_limiter.py` 分钟上限 case 绿（sleep 隔离） | CI Linux | pytest PASSED |
| 5 | dryrun smoke 退出 0 + `dryRun:true` + `draft_generated:true` | CI Linux | 退出码+JSON 断言 |
| 6 | `wechat-draft-auto-reply.test.ts` 4/4 case 绿 | CI Linux | npm test PASS |
| 7 | `find_weixin.py` 含 `get_main_window` + `mmui::MainWindow` + `uia`，无 stub | CI Linux | python3 断言 |
| 8 | `listen_chat.py` 含 `_parse_item_name`+`chat_input_field`+`mode:auto`，顶层无 pywinauto | CI Linux | python3+AST 断言 |
| 9 | `send_chat.py` 无 `pyautogui.*` 调用，有 pywinauto 配方 | CI Linux | python3 断言 |
| 10 | A 路线护栏：`approval_status ≠ 'approved'`、`approval_source = null` | CI Linux | node 断言 |
| 11 | 测试文件顶层无 `pywinauto` import | CI Linux | grep = 0 |
| 12 | Lead evidence 模板存在（≥20 行，6 章节） | PR 合并前 | bash 断言 |
| 13 | 真机自验截图 + 飞书互动记录（xian-rog，2026-06-02） | out-of-CI | evidence 填充 |

---

## 不在本合同范围内

- ❌ wxauto4 任何保留形式（DoD #1 强制）
- ❌ 讲述人自动解锁（人工前置操作）
- ❌ 主动发起新会话（thin 护栏）
- ❌ 群聊/朋友圈/图片/语音处理
- ❌ 多号矩阵
- ❌ 真机微信 E2E 进 CI
- ❌ send_moment.py / qr_bind.py 改造
- ❌ wechat-rpa.ts NodeJS handler 逻辑变动
- ❌ 新增 DB 表或字段
