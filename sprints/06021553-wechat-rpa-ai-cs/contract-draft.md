# Sprint Contract Draft — Round 1

**Sprint**: Path 4 客户私域 AI 接管 · 微信 4.0 RPA 换 pywinauto + 自动回复模式
**Journey**: 客户私域 AI 接管（Path 4），`bfeed805-deed-46c3-8624-87f0028101d4`
**Journey Type**: user_facing
**Target Environment**: linux_server（CI 评分）+ Lead 真机自验（xian-rog，out-of-CI evidence）
**propose_round**: 1
**propose_branch**: cp-harness-propose-r1-25ad5930

**Path 推进声明**：把 Path 4 Step 5（私聊自动回复）从 ❌ 失效（wxauto4 在微信 4.0 读不到消息）推到 ✅（pywinauto 配方 2026-06-02 真机验证 + `mode:'auto'` 暴露 reply 字段贯通自动发送回路）。

---

## 全局事实（合同内一致性基准）

| 项 | 事实 | 来源 |
|---|---|---|
| 真机执行机 | xian-pc / xian-rog（Windows 10 + Python 3.12 + pywinauto） | PRD ASSUMPTION |
| CI 执行机 | Linux（GitHub Actions） — pywinauto import 必然失败 | PRD ASSUMPTION |
| dryrun 路径与 `_parse_item_name`/`scan_unread` 纯函数 | **零 pywinauto 依赖** — CI 直接 import 跑 | PRD ASSUMPTION |
| wxauto4 状态 | 2026-06-02 在微信 4.0 上确认失效；sprint 在范围内文件 0 残留；`qr_bind.py`（18 行）/`send_moment.py` 豁免（PRD §不在范围内） | PRD §背景 + §不在范围 |
| FAIL_PLACEHOLDER 字面值 | `'AI 生成失败（请人审决定是否重试）'` | `wechat-draft.ts:219` |
| 现 `find_weixin.py` 函数 | stub 名为 `find_main_window()`（line 10-11，raise NotImplementedError） — 合同要求改造为 `get_main_window()` | 代码实证 |
| rate_limiter 间隔限 | `MIN_INTERVAL_SECONDS = 1` — 频控单测必须 `time.sleep(1.1)` 隔离 | `rate_limiter.py:48` |
| rate_limiter 分钟上限 | `CHAT_PER_MINUTE = 2` | `rate_limiter.py:46` |
| listen_chat.py 中台默认 URL | `http://localhost:3000`（环境变量 `ZENITHJOY_API_BASE` 可覆盖） | `listen_chat.py:81` |

---

## Golden Path（6 步）

```
[运营机：微信 4.0 已登录 + 讲述人解锁过 + zenithjoy-agent 在线]
    ↓
Step 1  agent 以登录用户身份 spawn listen_chat.py（真模式）
    ↓
Step 2  客户私聊到达 → 会话 ListItem 出现 [N条] 未读标记
    ↓
Step 3  scan_unread() 解析 ListItem → 过滤系统账号 → 产出 {sender, content}
    ↓
Step 4  POST /api/wechat/draft-generate 带 mode:'auto' → 中台返回 reply 文本
    ↓
Step 5  reply_in_chat() 用 pywinauto 配方自动发送
    ↓
Step 6  客户收到"运营本人"回复（隐形 AI），飞书互动记录留 pending_review 草稿
```

---

### Step 1：agent spawn `listen_chat.py` 真模式

**来源**：`[FROM_PRD]` — PRD §Golden Path 第 1 步、§范围限定 listen_chat.py 改造项

**可观测行为**：
- 真模式入口 `run_real_listen` 不再依赖 wxauto4，改 import `find_weixin.get_main_window()` + 内部 pywinauto
- `--dryrun --inject-message` 在 Linux CI 上仍能跑通（顶层无 pywinauto import）
- 真模式 spawn 失败（pywinauto unavailable / 非 win32）必须 `emit_json({ok:False, reason:...})` 退出码 0，不抛栈

**验证命令**（CI Linux — 静态 + dryrun）：

```bash
# 1a. 顶层 import 无 pywinauto — AST col_offset=0 检查
python3 -c "
import ast
src = open('services/agent/wechat-rpa/listen_chat.py').read()
tree = ast.parse(src)
for n in ast.walk(tree):
    if isinstance(n, (ast.Import, ast.ImportFrom)) and n.col_offset == 0:
        names = [a.name for a in getattr(n, 'names', [])]
        if hasattr(n, 'module') and n.module:
            names.append(n.module)
        for name in names:
            assert 'pywinauto' not in (name or ''), f'FAIL: 顶层 import pywinauto'
print('PASS: 顶层无 pywinauto import')
"

# 1b. 真模式入口存在且无 wxauto4 引用
python3 -c "
src = open('services/agent/wechat-rpa/listen_chat.py').read()
assert 'def run_real_listen' in src, 'FAIL: 缺 run_real_listen'
assert 'wxauto4' not in src and 'WXAUTO4' not in src, 'FAIL: wxauto4 残留'
assert 'get_main_window' in src, 'FAIL: 缺 get_main_window 调用'
print('PASS: 真模式入口就位，wxauto4 0 残留')
"

# 1c. dryrun smoke 退出码 0 + JSON 字段正确
RESULT=$(WECHAT_DRAFT_API_DRYRUN=1 python3 services/agent/wechat-rpa/listen_chat.py \
  --dryrun --inject-message='{"sender":"test","wechat_id":"wx123","content":"你好"}' 2>/dev/null)
RC=$?
echo "$RESULT" | python3 -c "
import sys, json
out = json.loads(sys.stdin.read())
assert out.get('ok') is True, f'FAIL: ok 不为 true: {out}'
assert out.get('dryRun') is True, f'FAIL: dryRun 不为 true: {out}'
assert out.get('draft_generated') is True, f'FAIL: draft_generated 不为 true: {out}'
print('PASS: dryrun smoke')
"
[ "$RC" = "0" ] || { echo "FAIL: dryrun 退出码=$RC"; exit 1; }
```

**硬阈值**：
- 顶层 pywinauto import 数 = 0
- `wxauto4` 在 `listen_chat.py` 出现次数 = 0
- dryrun smoke 退出码 = 0，stdout JSON `ok:true, dryRun:true, draft_generated:true`

---

### Step 2：未读私聊出现在 ListItem

**来源**：`[FROM_PRD]` — PRD §Golden Path 第 2 步、§验收标准第 6 条（`element_info.name` 解析）

**可观测行为**：
- `find_weixin.get_main_window()` 用 `Desktop(backend='uia').windows()` 枚举 → 找 `class_name=='mmui::MainWindow'`
- 找到 `class_name=='mmui::LoginWindow'` → `RuntimeError('微信未登录，请先扫码登录')`
- 列表空/找不到 → `RuntimeError('请重做讲述人解锁')`
- 非 Windows → `RuntimeError('pywinauto 仅支持 Windows')`
- pywinauto 仅函数体内 import（顶层零依赖）

**验证命令**（CI Linux — 静态）：

```bash
python3 -c "
src = open('services/agent/wechat-rpa/find_weixin.py').read()
assert 'def get_main_window' in src, 'FAIL: 缺 get_main_window'
assert 'NotImplementedError' not in src, 'FAIL: 仍是 stub'
assert 'mmui::MainWindow' in src, 'FAIL: 缺 mmui::MainWindow 检测'
assert 'mmui::LoginWindow' in src, 'FAIL: 缺 LoginWindow 检测'
assert \"backend='uia'\" in src or 'backend=\"uia\"' in src or 'backend=uia' in src.lower(), 'FAIL: 缺 backend=uia'
print('PASS: find_weixin.get_main_window 实现就位')
"

# 顶层 pywinauto import = 0（dryrun 路径 CI 安全）
python3 -c "
import ast
src = open('services/agent/wechat-rpa/find_weixin.py').read()
tree = ast.parse(src)
for n in ast.walk(tree):
    if isinstance(n, (ast.Import, ast.ImportFrom)) and n.col_offset == 0:
        names = [a.name for a in getattr(n, 'names', [])]
        if hasattr(n, 'module') and n.module:
            names.append(n.module)
        for name in names:
            assert 'pywinauto' not in (name or ''), 'FAIL: 顶层 import pywinauto'
print('PASS: find_weixin.py 顶层无 pywinauto import')
"
```

**硬阈值**：
- `get_main_window` 函数存在
- `NotImplementedError` 不存在
- `mmui::MainWindow` + `mmui::LoginWindow` 文字存在
- `backend='uia'` 文字存在
- 顶层 pywinauto import 数 = 0

---

### Step 3：`scan_unread` 解析 + 过滤系统账号

**来源**：`[FROM_PRD]` — PRD §Golden Path 第 3 步、§验收标准第 1 条（5 个 case）、§范围限定 `_parse_item_name` 项

**可观测行为**：
- 顶层纯函数 `_parse_item_name(name: str) -> Optional[Dict]`（零 pywinauto 依赖）
- 解析格式：`'发送者\n[N条] \n消息内容\n时间\n'`
- 检测 `[\d+条]` 未读标记 — 无则返回 None
- 过滤 `SYSTEM_ACCOUNT_PREFIXES = ("公众号","服务号","微信团队","微信支付","腾讯新闻")` 系统账号 — 命中返回 None
- 成功返回 `{"sender": sender, "content": content}`
- `scan_unread(mw)` 用 `mw.descendants(control_type='ListItem')` 遍历

**验证命令**（CI Linux — pytest）：

```bash
cd services/agent/wechat-rpa
python3 -m pytest tests/test_scan_unread.py -v 2>&1 | tee /tmp/scan_unread.log
grep -E "5 passed|5 passed" /tmp/scan_unread.log || { echo "FAIL: 非 5 绿"; cat /tmp/scan_unread.log; exit 1; }
echo "PASS: _parse_item_name 5/5 case 绿"

# 测试文件顶层无 pywinauto import（必须能在 CI Linux 跑）
grep -E "^import pywinauto|^from pywinauto" services/agent/wechat-rpa/tests/test_scan_unread.py | wc -l | grep -q "^0$" \
  || { echo "FAIL: 测试文件顶层 import pywinauto"; exit 1; }
```

**5 个 case（PRD 验收第 1 条 + 边界 case）**：

| # | 输入 `_parse_item_name(s)` | 期望返回 |
|---|---|---|
| G1 正常私信 | `'于瑾\n[1条] \n您好\n15:26\n'` | `{"sender":"于瑾","content":"您好"}` |
| G2 公众号过滤 | `'公众号\n[1条] \n广告\n11:09\n'` | `None` |
| G3 服务号过滤 | `'服务号\n[3条] \n活动推送\n09:00\n'` | `None` |
| G4 无未读不返回 | `'李华\n昨天下午好\n11:09\n'`（无 `[N条]`） | `None` |
| G5 多条未读数字 | `'张三\n[5条] \n在吗\n09:00\n'` | `{"sender":"张三","content":"在吗"}` |

**硬阈值**：5/5 pytest passed；测试文件顶层 pywinauto import = 0。

---

### Step 4：POST `mode:'auto'` → 中台返回 `reply` 文本

**来源**：`[FROM_PRD]` — PRD §背景（generateChatDraft 加 mode）、§范围限定 wechat-draft.ts 项、§验收标准第 4 条

**可观测行为**：
- `GenerateChatDraftParams` 加可选 `mode?: 'auto' | 'review'`（默认 `'review'`）
- `GenerateChatDraftSuccess` 加可选 `reply?: string`
- `mode === 'auto'` 且 `aiContent` 非空且 `aiContent !== FAIL_PLACEHOLDER` 时填 `reply = aiContent`
- 默认 `mode === 'review'`（或缺省）→ 返回值不含 `reply`（或 `reply === undefined`）
- 飞书写入、DB 写入、OpenRouter 调用逻辑**复用**现实现，`approval_status='pending_review'`、`approval_source=NULL` 不变
- AI 失败（OpenRouter 抛错或返空）→ `aiContent = FAIL_PLACEHOLDER` → `reply` 不赋值（listener 端跳过发送）

**验证命令**（CI Linux — vitest + 静态。事实基线：`apps/api/package.json "test": "vitest run"`）：

```bash
# 4a. 接口扩展静态断言
node -e "
const src = require('fs').readFileSync('apps/api/src/services/wechat-draft.ts','utf8');
if (!/GenerateChatDraftParams[\s\S]{0,300}mode\??\s*:/.test(src))
  { console.error('FAIL: Params 缺 mode'); process.exit(1); }
if (!/GenerateChatDraftSuccess[\s\S]{0,300}reply\??\s*:\s*string/.test(src))
  { console.error('FAIL: Success 缺 reply?: string'); process.exit(1); }
console.log('PASS: 接口扩展就位');
"

# 4b. A 路线护栏未破（防 generator 偷偷把 approval_status 改 approved）
node -e "
const src = require('fs').readFileSync('apps/api/src/services/wechat-draft.ts','utf8');
if (src.includes(\"approval_status: 'approved'\"))
  { console.error('FAIL: approval_status approved'); process.exit(1); }
console.log('PASS: A 路线护栏完好');
"

# 4c. integration test（J1-J4） — apps/api 用 vitest（package.json: "test":"vitest run"）
cd apps/api
npx vitest run src/services/__tests__/wechat-draft-auto-reply.test.ts 2>&1 | tee /tmp/auto.log
grep -E "[1-9][0-9]* passed" /tmp/auto.log || { echo "FAIL"; cat /tmp/auto.log; exit 1; }
echo "PASS: wechat-draft-auto-reply 4/4 case 绿"
```

**4 个 vitest case**（mock 飞书 + mock openrouter，不调真实网络）：

| # | mock 设置 | 期望 |
|---|---|---|
| J1 `mode:'auto'` 成功 | 飞书 customers 返回 1 条 + openrouter 返回 `'好的，已收到'` | `{ok:true, reply:'好的，已收到'}` |
| J2 `mode:'review'`（默认） | 同 J1 输入 | `{ok:true, status:'pending_review'}` 且 `reply === undefined` |
| J3 `mode:'auto'` AI 失败 | openrouter 抛 Error | `{ok:true}` 且 `reply === undefined`（listener 端检测后跳过） |
| J4 sender 不在名单 | customers 返回空数组 | `{ok:false, reason:'not_in_whitelist'}` |

**硬阈值**：
- `GenerateChatDraftParams.mode?: 'auto' | 'review'` 存在
- `GenerateChatDraftSuccess.reply?: string` 存在
- 4 个 vitest case 全过
- `approval_status: 'approved'` 字面量在文件中不存在

---

### Step 5：`reply_in_chat` 用 pywinauto 自动发送

**来源**：`[FROM_PRD]` — PRD §Golden Path 第 5 步、§验收标准第 6 条（`automation_id=='chat_input_field'` set_text + `name=='发送'` click_input）

**可观测行为**：
- `reply_in_chat(mw, item, reply_text)` 实现：
  1. `item.select()` 打开会话
  2. 找 `automation_id == 'chat_input_field'` 控件 → `set_text(reply_text)`
  3. 找 `name == '发送'` 按钮 → `click_input()`
  4. 验证输入框 `get_value() == ''`（清空 = 发送成功）
- `send_chat.py` 真发路径**删除全部** `pyautogui.click/write/hotkey/press/sleep` 调用，换 pywinauto 配方
- `send_chat.py` 保留频控（`rate_limiter.can_send('chat', wechat_id)`）+ stdin JSON 接口
- listener 主循环：reply 为空或 `== FAIL_PLACEHOLDER` 时跳过发送（不发占位文案给客户）
- `rate_limiter.can_send` 返回 False 时跳过当前消息，记 `next_allowed_at`
- 同一 `(sender, content)` 不重复处理（`replied` set 去重）

**验证命令**（CI Linux — 静态）：

```bash
# 5a. listen_chat.py 含核心配方关键字
python3 -c "
src = open('services/agent/wechat-rpa/listen_chat.py').read()
assert 'def reply_in_chat' in src, 'FAIL: 缺 reply_in_chat'
assert 'chat_input_field' in src, 'FAIL: 缺 chat_input_field'
assert '发送' in src, 'FAIL: 缺 发送 按钮'
assert 'click_input' in src, 'FAIL: 缺 click_input'
assert 'def scan_unread' in src, 'FAIL: 缺 scan_unread'
assert '_parse_item_name' in src, 'FAIL: 缺 _parse_item_name 纯函数'
assert 'ListItem' in src, 'FAIL: 缺 ListItem 枚举'
assert 'auto' in src and ('mode' in src), 'FAIL: 缺 mode:auto POST 字段'
assert 'replied' in src, 'FAIL: 缺 replied 去重 set'
assert 'can_send' in src, 'FAIL: 缺 rate_limiter.can_send'
assert ('AI 生成失败' in src) or ('FAIL_PLACEHOLDER' in src), 'FAIL: 缺 FAIL_PLACEHOLDER 跳过'
print('PASS: listen_chat.py 核心配方完整')
"

# 5b. send_chat.py pyautogui 硬坐标已删，pywinauto 换入
python3 -c "
src = open('services/agent/wechat-rpa/send_chat.py').read()
for m in ['pyautogui.click','pyautogui.write','pyautogui.hotkey','pyautogui.press','pyautogui.sleep']:
    assert m not in src, f'FAIL: {m} 残留'
assert 'chat_input_field' in src or 'reply_in_chat' in src, 'FAIL: 真发路径未换 pywinauto 配方'
assert 'can_send' in src, 'FAIL: 频控丢失'
assert 'stdin' in src, 'FAIL: stdin 接口丢失'
print('PASS: send_chat.py pyautogui 已删，pywinauto 换入，频控+stdin 保留')
"

# 5c. 频控分钟上限单测（含 sleep(1.1) 隔离）
cd services/agent/wechat-rpa
python3 -m pytest tests/test_rate_limiter.py -v 2>&1 | tee /tmp/rate.log
grep -E "passed" /tmp/rate.log || { echo "FAIL"; cat /tmp/rate.log; exit 1; }
echo "PASS: 频控分钟上限单测绿"

# 5d. 防作弊：无主动发起会话 def（thin 阶段护栏 — 只被动回，不主动发起）
FOUND=$(grep -rE "def (send_to|proactive_|outbound_|initiate_|start_chat_with_|cold_outreach_|first_message_)" \
  services/agent/wechat-rpa/ 2>/dev/null | wc -l)
[ "$FOUND" = "0" ] && echo "PASS: thin 护栏完好" || { echo "FAIL: $FOUND 主动发起 def"; exit 1; }
```

**频控测试关键约束**：`rate_limiter.MIN_INTERVAL_SECONDS = 1` → 每次 `can_send` 之间**必须** `time.sleep(1.1)`，否则间隔限会先于分钟上限触发，导致误判。

```python
import time
from rate_limiter import can_send, reset
def test_chat_per_minute_limit():
    reset('test_wid')
    ok1, _ = can_send('chat', 'test_wid'); assert ok1 is True
    time.sleep(1.1)
    ok2, _ = can_send('chat', 'test_wid'); assert ok2 is True
    time.sleep(1.1)
    ok3, nxt = can_send('chat', 'test_wid')
    assert ok3 is False; assert nxt is not None
```

**硬阈值**：
- `listen_chat.py` 含 `reply_in_chat` / `chat_input_field` / `发送` / `click_input` / `scan_unread` / `_parse_item_name` / `mode` / `auto` / `replied` / `can_send` / `FAIL_PLACEHOLDER`（任一缺失 FAIL）
- `send_chat.py` 含 `chat_input_field` 或 `reply_in_chat`，不含 `pyautogui.*` 5 个方法
- 频控分钟上限 case 过
- 无任何主动发起会话 def

---

### Step 6：客户收到回复 + 飞书留 pending_review 草稿存档

**来源**：`[FROM_PRD]` — PRD §Golden Path 第 6 步、§验收标准末项（真机自验）

**可观测行为**（out-of-CI — Lead 真机自验）：
- 客户在微信窗口看到运营回复
- 飞书"互动记录"表新增一条 `pending_review` 记录，`approval_source = NULL`
- 截图 + record_id 存档于 `.agent-knowledge/path-4/lead-acceptance-wechat-rpa-pywinauto.md`

**验证命令**（CI Linux — Evidence 模板存在性 + 章节齐全）：

```bash
EVIDENCE=.agent-knowledge/path-4/lead-acceptance-wechat-rpa-pywinauto.md
test -f "$EVIDENCE" || { echo "FAIL: evidence 文件缺失"; exit 1; }
[ "$(wc -l < $EVIDENCE)" -ge 20 ] || { echo "FAIL: <20 行"; exit 1; }
for h in "## 测试设备" "## 前置条件" "## 测试步骤" "## 截图" "## 飞书互动记录" "## 结论"; do
  grep -F "$h" "$EVIDENCE" >/dev/null || { echo "FAIL: 缺章节 $h"; exit 1; }
done
echo "PASS: Lead evidence 模板 ≥20 行 + 6 章节齐全"
```

**硬阈值**：模板存在 + ≥20 行 + 含 6 个 ## 章节（Lead 后填截图/record_id；评分按 Evaluator 后续单评，不阻塞 CI 绿）。

---

### 防造假断言（[AI_ADDED] — 防 generator 偷漏）

**来源**：`[AI_ADDED]` — 防止 generator 通过保留 wxauto4 / 不删 pyautogui / 把 approval_status 自批 approved 等方式绕过 PRD 意图。

**断言 X1：sprint 在范围内文件 wxauto4 0 残留（豁免 PRD 不在范围内 + CI-excluded 历史合同目录）**

> **范围说明 + 事实基线**：
> - PRD §不在范围内 明确把 `qr_bind.py` / `send_moment.py` 排除出本 sprint。事实基线：当前 `qr_bind.py` 含 18 行 wxauto4 引用（PRD 视为单独子 sprint 处理）。
> - `apps/api/tests/ws[1-6]/**` 是历史合同 RED 文件，已在 `apps/api/vitest.config.ts:11 exclude` 中屏蔽于 CI vitest 集外（事实基线已读：`exclude: ['node_modules/**', 'tests/integration/**', 'tests/ws1/**'...'tests/ws6/**']`），其 wxauto4 字符串引用属时间冻结的旧合同遗物，本 sprint 不要求清理。
> - 本断言用 `--exclude` + `--exclude-dir` 形式排除以上豁免，保证 sprint 在范围内文件 0 残留 + 兜底捕获 generator 把 wxauto4 偷偷塞到别处的情况。

```bash
HITS=$(grep -rn "wxauto4" services/ apps/ \
  --include="*.py" --include="*.ts" \
  --exclude="qr_bind.py" --exclude="send_moment.py" \
  --exclude-dir="ws1" --exclude-dir="ws2" --exclude-dir="ws3" \
  --exclude-dir="ws4" --exclude-dir="ws5" --exclude-dir="ws6" 2>/dev/null | wc -l)
[ "$HITS" = "0" ] && echo "PASS: wxauto4 在 sprint 范围内文件 0 残留" \
  || { echo "FAIL: $HITS 行 wxauto4 残留（豁免范围外）"; \
       grep -rn "wxauto4" services/ apps/ --include="*.py" --include="*.ts" \
         --exclude="qr_bind.py" --exclude="send_moment.py" \
         --exclude-dir="ws1" --exclude-dir="ws2" --exclude-dir="ws3" \
         --exclude-dir="ws4" --exclude-dir="ws5" --exclude-dir="ws6"; exit 1; }
```

**断言 X2：requirements.txt 库切换到位**

```bash
python3 -c "
content = open('services/agent/wechat-rpa/requirements.txt').read()
assert 'pywinauto' in content, 'FAIL: 缺 pywinauto'
for banned in ('wxauto4', 'pyautogui', 'pyperclip'):
    assert banned not in content, f'FAIL: 仍含 {banned}'
print('PASS: requirements.txt 切换到位')
"
```

**理由**：PRD §不在范围内"❌ wxauto4 任何形式保留（禁止）"是合同硬底；X1/X2 用 grep + 内容断言保证 generator 不能"换个名字保留"。

---

## E2E 验收（最终 final-e2e）

**journey_type**: user_facing
**target_environment**: linux_server（CI 侧 — 唯一可机器验证层）

> 真正的"客户收到 AI 回复"E2E 必须在 Windows 微信 4.0 真机跑（GHA Linux runner 无微信桌面客户端）。CI 侧仅做"代码就位 + dryrun + 单测 + integration"验证；端到端真机 E2E 由 Lead 在 xian-rog 完成并存档到 `.agent-knowledge/path-4/lead-acceptance-wechat-rpa-pywinauto.md`。

**CI 侧 final-e2e 脚本（Linux runner 上执行）**：

```bash
#!/bin/bash
set -e

# 1. wxauto4 在 sprint 范围内文件 0 残留（豁免 qr_bind.py / send_moment.py — PRD §不在范围；
#    豁免 tests/ws[1-6]/** — vitest.config.ts:11 已 exclude 出 CI 集，历史合同 RED 遗物）
HITS=$(grep -rn "wxauto4" services/ apps/ --include="*.py" --include="*.ts" \
  --exclude="qr_bind.py" --exclude="send_moment.py" \
  --exclude-dir="ws1" --exclude-dir="ws2" --exclude-dir="ws3" \
  --exclude-dir="ws4" --exclude-dir="ws5" --exclude-dir="ws6" 2>/dev/null | wc -l)
[ "$HITS" = "0" ] || { echo "FAIL: wxauto4 残留 $HITS 行（豁免范围外）"; exit 1; }

# 2. requirements.txt pywinauto 就位
python3 -c "
c = open('services/agent/wechat-rpa/requirements.txt').read()
assert 'pywinauto' in c and 'wxauto4' not in c and 'pyautogui' not in c
"

# 3. find_weixin / listen_chat / send_chat 静态断言（来自 Step 2/Step 5）
python3 -c "
import ast
for f in ['find_weixin.py','listen_chat.py']:
    src = open(f'services/agent/wechat-rpa/{f}').read()
    tree = ast.parse(src)
    for n in ast.walk(tree):
        if isinstance(n,(ast.Import,ast.ImportFrom)) and n.col_offset==0:
            names = [a.name for a in getattr(n,'names',[])]
            if hasattr(n,'module') and n.module: names.append(n.module)
            for name in names:
                assert 'pywinauto' not in (name or ''), f'FAIL: {f} 顶层 pywinauto'
print('OK')
"

# 4. dryrun smoke
RESULT=$(WECHAT_DRAFT_API_DRYRUN=1 python3 services/agent/wechat-rpa/listen_chat.py \
  --dryrun --inject-message='{"sender":"test","wechat_id":"wx123","content":"你好"}' 2>/dev/null)
echo "$RESULT" | python3 -c "
import sys, json
o = json.loads(sys.stdin.read())
assert o['ok'] is True and o['dryRun'] is True and o['draft_generated'] is True
"

# 5. pytest 双单测
cd services/agent/wechat-rpa
python3 -m pytest tests/test_scan_unread.py tests/test_rate_limiter.py -v
cd ../../..

# 6. vitest auto-reply integration
cd apps/api
npx vitest run src/services/__tests__/wechat-draft-auto-reply.test.ts
cd ../..

# 7. Lead evidence 模板就位
test -f .agent-knowledge/path-4/lead-acceptance-wechat-rpa-pywinauto.md

echo "✅ CI 侧 final-e2e 全过（真机 E2E 由 Lead 在 xian-rog 完成存档）"
```

**通过标准**：脚本 exit 0；真机 E2E 截图由 Lead 在 evidence 文件填充。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据（实现前） |
|---|---|---|---|
| `_parse_item_name` 解析 + 系统账号过滤 | `services/agent/wechat-rpa/tests/test_scan_unread.py` | G1-G5（5 case） | ImportError 或 NameError（函数不存在） |
| 频控分钟上限（含 sleep 1.1s 隔离） | `services/agent/wechat-rpa/tests/test_rate_limiter.py` | 前 2 次绿 / 第 3 次拒 + next_at | （函数已存在，但本 sprint 补单测覆盖） |
| `generateChatDraft mode:'auto'` 暴露 reply | `apps/api/src/services/__tests__/wechat-draft-auto-reply.test.ts`（vitest） | J1-J4（4 case） | TS 编译错（`mode` / `reply` 字段不存在）或 J1 reply 为 undefined |

---

## 文件变更清单

### 改造（替换核心实现）

| 文件 | 改动摘要 |
|---|---|
| `services/agent/wechat-rpa/find_weixin.py` | 删 `find_main_window` stub + `NotImplementedError`；实现 `get_main_window()` 用 `Desktop(backend='uia').windows()` 找 `mmui::MainWindow`；检测 `mmui::LoginWindow` 报警；pywinauto 仅函数体内 import |
| `services/agent/wechat-rpa/listen_chat.py` | 删全部 wxauto4 引用（`import wxauto4` / `WXAUTO4_*` / `_emit_version_to_stderr`）；真模式换 pywinauto：顶层 `_parse_item_name` 纯函数 + 函数体内 `scan_unread` + `reply_in_chat`；POST 带 `mode:'auto'`；取 `reply`，FAIL_PLACEHOLDER 跳过；`replied` set 去重；`can_send` 频控 |
| `services/agent/wechat-rpa/send_chat.py` | 删全部 `pyautogui.click/write/hotkey/press/sleep` 调用；真发路径换 pywinauto `reply_in_chat` 配方；保留频控 + stdin JSON 接口 |
| `services/agent/wechat-rpa/requirements.txt` | 删 `wxauto4>=39.0.0` / `pyautogui>=0.9.54` / `pyperclip>=1.8.2`；加 `pywinauto>=0.6.8; sys_platform == "win32"`；保留 `pywin32` / `requests` |
| `apps/api/src/services/wechat-draft.ts` | `GenerateChatDraftParams` 加 `mode?: 'auto' \| 'review'`（默认 review）；`GenerateChatDraftSuccess` 加 `reply?: string`；成功路径末尾 `mode==='auto' && aiContent!==FAIL_PLACEHOLDER` 时填 reply；默认行为不变 |

### 新增

| 文件 | 内容 |
|---|---|
| `services/agent/wechat-rpa/tests/__init__.py` | 空文件（目录不存在则建） |
| `services/agent/wechat-rpa/tests/test_scan_unread.py` | 5 case（G1-G5）`_parse_item_name` 纯函数测，零 pywinauto import |
| `services/agent/wechat-rpa/tests/test_rate_limiter.py` | 分钟上限 case，含 `time.sleep(1.1)` 隔离 |
| `apps/api/src/services/__tests__/wechat-draft-auto-reply.test.ts` | 4 个 vitest case（J1-J4），mock 飞书 + mock openrouter |
| `.agent-knowledge/path-4/lead-acceptance-wechat-rpa-pywinauto.md` | Lead 真机自验 evidence 模板（≥20 行 + 6 章节骨架） |

### 不动

- `services/agent/wechat-rpa/rate_limiter.py`
- `services/agent/wechat-rpa/qr_bind.py`、`send_moment.py`
- `services/agent/src/handlers/wechat-rpa.ts`
- `apps/api/src/routes/wechat-draft-router.ts`
- `apps/api/src/llm/openrouter.ts`

---

## Commit 顺序（TDD 强制）

```
commit-1: test(wechat-rpa): scan_unread 5 case + rate_limiter 分钟上限（含 sleep 1.1s 隔离）+ wechat-draft-auto-reply 4 case integration（均 RED）+ Lead evidence 模板骨架
commit-2: feat(wechat-rpa): pywinauto 换装（find_weixin.get_main_window + listen_chat 配方 + send_chat 配方 + requirements.txt）+ wechat-draft mode:'auto'（让所有测试 GREEN）
```

CI `lint-tdd-commit-order` 检查 test 文件必须先于 src 出现在 commit 历史。

---

## 不在本合同范围内

- ❌ wxauto4 任何保留形式（X1/X2 强制 0 残留）
- ❌ 讲述人自动解锁（人工前置操作，超出代码职责）
- ❌ 主动发起新会话（thin 护栏 — 防作弊断言 5d）
- ❌ 群聊 / 朋友圈 / 图片 / 语音 / 文件消息处理
- ❌ 多号矩阵、滚动读历史消息
- ❌ 真机微信 E2E 进 CI（Linux 无微信桌面客户端）
- ❌ `send_moment.py` / `qr_bind.py` 改造
- ❌ `services/agent/src/handlers/wechat-rpa.ts` NodeJS spawn 层逻辑变动
- ❌ 新增 DB 表或字段
