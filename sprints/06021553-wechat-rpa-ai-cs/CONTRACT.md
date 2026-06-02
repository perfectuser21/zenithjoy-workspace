# Sprint Contract — Path 4 微信 RPA 换 pywinauto + 自动回复模式

sprint_dir: sprints/06021553-wechat-rpa-ai-cs  
propose_branch: cp-harness-propose-r1-25ad5930  
journey_id: bfeed805-deed-46c3-8624-87f0028101d4  
path: 4（客户私域 AI 接管）  
date: 2026-06-02

---

## 本 Sprint 推进声明

**把 Path 4 Step 1（绑个微 + listen）和 Step 5（自动回复）从 ❌ 推到 🟡（CI 绿 + 真机待验）**。

- 消灭已确认失效的 wxauto4；换入 2026-06-02 xian-pc 真机验证的 pywinauto 配方
- `generateChatDraft` 加 `mode:'auto'`，暴露 `reply` 字段，打通 listen → draft → 自动发送完整链路

---

## 合同断言（Contract Assertions）

> 每条断言为可机器验证的"完成条件"，Evaluator 按此逐条打分。

### A. 无 wxauto4 任何残留

```
grep -r "wxauto4" services/ apps/ --include="*.py" --include="*.ts" | wc -l
```
**预期输出：`0`**

### B. requirements.txt：pywinauto 在，wxauto4 不在

```
grep "pywinauto" services/agent/wechat-rpa/requirements.txt  # 必须命中
grep "wxauto4"   services/agent/wechat-rpa/requirements.txt  # 必须返回非零退出码（无匹配）
```

### C. find_weixin.py 实现非 stub

```python
# 必须满足所有 3 条：
# C1. 不再出现 NotImplementedError
grep -n "NotImplementedError" services/agent/wechat-rpa/find_weixin.py | wc -l  # == 0

# C2. 使用 Desktop(backend='uia')
grep "backend.*uia" services/agent/wechat-rpa/find_weixin.py  # 必须命中

# C3. 检查 class_name == 'mmui::MainWindow'
grep "mmui::MainWindow" services/agent/wechat-rpa/find_weixin.py  # 必须命中
```

### D. listen_chat.py 核心配方断言

```
# D1. 无 wxauto4 import
grep "wxauto4" services/agent/wechat-rpa/listen_chat.py | wc -l  # == 0

# D2. scan_unread 使用 control_type='ListItem' + element_info.name 解析
grep "control_type.*ListItem\|ListItem.*control_type" services/agent/wechat-rpa/listen_chat.py  # 命中

# D3. reply_in_chat 使用 automation_id='chat_input_field'
grep "chat_input_field" services/agent/wechat-rpa/listen_chat.py  # 命中

# D4. 发送用 name=='发送' click_input()
grep "发送.*click_input\|click_input.*发送" services/agent/wechat-rpa/listen_chat.py  # 命中

# D5. POST draft-generate 带 mode:'auto'
grep "mode.*auto\|'mode'.*'auto'" services/agent/wechat-rpa/listen_chat.py  # 命中

# D6. 取 reply 字段并检测 FAIL_PLACEHOLDER 后跳过
grep "reply" services/agent/wechat-rpa/listen_chat.py  # 命中
grep "FAIL_PLACEHOLDER" services/agent/wechat-rpa/listen_chat.py  # 命中
```

### E. send_chat.py 核心配方断言

```
# E1. 无 pyautogui 真发路径（无硬坐标序列）
grep "pyautogui.click\|pyautogui.write\|pyautogui.hotkey\|pyautogui.press" services/agent/wechat-rpa/send_chat.py | wc -l  # == 0

# E2. 真发路径改用 pywinauto reply_in_chat
grep "chat_input_field\|automation_id" services/agent/wechat-rpa/send_chat.py  # 命中
```

### F. dryrun CLI 回归（CI 必须绿）

```bash
cd services/agent/wechat-rpa
WECHAT_DRAFT_API_DRYRUN=1 python listen_chat.py \
  --dryrun \
  --inject-message='{"sender":"test","wechat_id":"wx123","content":"你好"}'
```
**断言：**
- 退出码 `== 0`
- stdout 含 `"dryRun":true`
- stdout 含 `"draft_generated":true`

### G. _parse_item_name 单元测试（不 import pywinauto）

文件：`services/agent/wechat-rpa/tests/test_scan_unread.py`

> 直接测 `_parse_item_name` 顶层纯函数（返回 `dict` 或 `None`，零 pywinauto 依赖，Linux CI 可直接 `from listen_chat import _parse_item_name` import）。

| 测试用例 | 输入（`_parse_item_name` 入参字符串） | 预期返回值 |
|---|---|---|
| G1 正常私信 | `'于瑾\n[1条] \n您好\n15:26\n'` | `{"sender":"于瑾","content":"您好"}` |
| G2 公众号过滤 | `'公众号\n[1条] \n广告\n11:09\n'` | `None` |
| G3 服务号过滤 | `'服务号\n[3条] \n活动推送\n09:00\n'` | `None` |
| G4 无未读不返回 | `'李华\n昨天下午好\n11:09\n'`（无 [N条]） | `None` |
| G5 多条未读数字 | `'张三\n[5条] \n在吗\n09:00\n'` | `{"sender":"张三","content":"在吗"}` |

```bash
cd services/agent/wechat-rpa
python -m pytest tests/test_scan_unread.py -v
```
**预期：5 tests PASSED，0 FAILED，无 import pywinauto**

### H. 频控单元测试

文件：`services/agent/wechat-rpa/tests/test_rate_limiter.py`

```bash
cd services/agent/wechat-rpa
python -m pytest tests/test_rate_limiter.py -v
```
**断言：**
- `reset(wechat_id)` 清零计数器后：前 2 次 `can_send('chat', id)` 返回 `(True, None)`
- 每次调用之间必须 `time.sleep(1.1)` 隔离（`MIN_INTERVAL_SECONDS=1`，否则间隔限制会导致误判）
- 第 3 次（超过 `CHAT_PER_MINUTE=2`）返回 `(False, <ISO next_allowed_at>)`

### I. TypeScript 接口扩展断言

```
# I1. GenerateChatDraftParams 含 mode 可选字段
grep "mode.*auto.*review\|mode\?:.*'auto'" apps/api/src/services/wechat-draft.ts  # 命中

# I2. GenerateChatDraftSuccess 含 reply 可选字段
grep "reply\?:.*string" apps/api/src/services/wechat-draft.ts  # 命中

# I3. mode=='review' 时不暴露 reply（默认行为不变）
# 通过 integration test I4 验证
```

### J. auto-reply Integration Test（TypeScript）

文件：`apps/api/src/services/__tests__/wechat-draft-auto-reply.test.ts`

```bash
cd apps/api
npx jest wechat-draft-auto-reply --testPathPattern='__tests__'
```
**断言：**
- J1: mock 飞书返回 1 条互动记录 + mock openrouter 返回 `'你好，我是 AI 回复'`→ `generateChatDraft({sender, wechat_id, content, mode:'auto'})` 返回 `{ok:true, reply:'你好，我是 AI 回复'}`
- J2: `reply` 不为空、不为 `'AI 生成失败（请人审决定是否重试）'`
- J3: `mode:'review'`（或缺省）时，同样输入，返回值**不含** `reply` 字段（或 `reply === undefined`）
- J4: mock openrouter 抛 Error 时，`mode:'auto'` 路径返回 `reply` 为 `undefined`（listener 检测为 falsy 自行跳过，不把 FAIL_PLACEHOLDER 发给客户）

### K. 飞书互动记录存档（真机验证后补）

文件：`.agent-knowledge/path-4/lead-acceptance-wechat-rpa-pywinauto.md`

需包含：
- 真机自验时间（2026-06-02 xian-pc）
- 截图描述（客户发"你好"→ 微信 4.0 窗口回复截图）
- 飞书互动记录表截图（pending_review 条目）
- 结论：全链路 Golden Path 6 步通过

> **注**：K 不阻塞 CI 绿；Evaluator 在 Lead 完成真机自验后单独评分。

---

## 文件变更清单（Generator 必须严格对照）

### 改造（替换核心实现）

| 文件 | 改动摘要 |
|---|---|
| `services/agent/wechat-rpa/find_weixin.py` | 删 `NotImplementedError` stub；实现 `get_main_window()` 用 `Desktop(backend='uia').windows()` 枚举 `class_name=='mmui::MainWindow'`；检测 LoginWindow 报警；pywinauto import 守卫（Windows 限定） |
| `services/agent/wechat-rpa/listen_chat.py` | 删全部 wxauto4 依赖；真模式换 pywinauto：`scan_unread()` + `reply_in_chat()`；POST draft-generate 带 `mode:'auto'`；从 response 取 `reply`，检测 FAIL_PLACEHOLDER 后发送；pywinauto import 守卫（dryrun 路径零依赖） |
| `services/agent/wechat-rpa/send_chat.py` | 删 pyautogui 硬坐标序列（`pyautogui.click`/`.write`/`.hotkey`/`.press`）；真发路径换 pywinauto `reply_in_chat` 配方；保留频控 + stdin JSON 接口 |
| `services/agent/wechat-rpa/requirements.txt` | 删 `wxauto4>=39.0.0`；删 `pyautogui>=0.9.54`；加 `pywinauto>=0.6.8; sys_platform == "win32"` |
| `apps/api/src/services/wechat-draft.ts` | `GenerateChatDraftParams` 加 `mode?: 'auto' \| 'review'`（默认 `'review'`）；`GenerateChatDraftSuccess` 加 `reply?: string`；`mode=='auto'` 时在成功路径末尾赋 `reply = aiContent`（若 aiContent 为 FAIL_PLACEHOLDER 则 reply 不赋值或赋 undefined）；默认审核台行为不变 |

### 新增（测试文件）

| 文件 | 内容 |
|---|---|
| `services/agent/wechat-rpa/tests/__init__.py` | 空（如目录不存在则新建） |
| `services/agent/wechat-rpa/tests/test_scan_unread.py` | 5 个单测（G1-G5），纯函数，零 pywinauto import |
| `services/agent/wechat-rpa/tests/test_rate_limiter.py` | 频控上限单测：chat 分钟级 ≤2 拒第 3 次 |
| `apps/api/src/services/__tests__/wechat-draft-auto-reply.test.ts` | 4 个 Jest 测试（J1-J4），mock 飞书 + mock openrouter |

### 不动

- `services/agent/wechat-rpa/rate_limiter.py`
- `services/agent/wechat-rpa/qr_bind.py`
- `services/agent/wechat-rpa/send_moment.py`
- `services/agent/src/handlers/wechat-rpa.ts`
- `apps/api/src/routes/wechat-draft-router.ts`
- `apps/api/src/llm/openrouter.ts`

---

## 关键实现细节（Generator 参考规格）

### find_weixin.py — `get_main_window()`

```python
from __future__ import annotations
import sys

def get_main_window():
    """
    返回 pywinauto Application 的主窗口 wrapper。
    找到 mmui::MainWindow → 返回该 wrapper。
    找到 mmui::LoginWindow → raise RuntimeError('微信未登录，请先扫码登录')。
    讲述人未解锁/UI 自动化被屏蔽（窗口列表为空）→ raise RuntimeError('讲述人未解锁...')。
    非 Windows → raise RuntimeError('pywinauto 仅支持 Windows')。
    """
    if sys.platform != "win32":
        raise RuntimeError("pywinauto 仅支持 Windows")
    from pywinauto import Desktop  # 仅运行时 import
    wins = Desktop(backend="uia").windows()
    for w in wins:
        try:
            cn = w.element_info.class_name
        except Exception:
            continue
        if cn == "mmui::MainWindow":
            return w
        if cn == "mmui::LoginWindow":
            raise RuntimeError("微信未登录，请先扫码登录")
    raise RuntimeError("找不到微信主窗口，请确认讲述人（Narrator）已解锁 UI 自动化")
```

### listen_chat.py — `scan_unread()` 纯函数规格

`scan_unread` 必须能在 **不 import pywinauto** 的环境下被导入和测试：

```python
import re
from typing import List, Dict

# 系统账号过滤关键字（精确前缀匹配）
SYSTEM_ACCOUNT_PREFIXES = ("公众号", "服务号", "微信团队", "微信支付", "腾讯新闻")

def _parse_item_name(name: str) -> Dict[str, str] | None:
    """
    解析单个 ListItem 的 element_info.name。
    格式（pywinauto 真机采样）：
      '于瑾\n[1条] \n您好\n15:26\n'
      '张三\n[5条] \n在吗\n09:00\n'
    返回 {sender, content} 或 None（不符合格式/系统账号）。
    """
    parts = [p for p in name.split("\n") if p.strip()]
    if len(parts) < 3:
        return None
    sender = parts[0].strip()
    unread_mark = parts[1].strip()
    content = parts[2].strip()
    # 必须含 [N条] 格式
    if not re.search(r'\[\d+条\]', unread_mark):
        return None
    # 过滤系统账号
    for prefix in SYSTEM_ACCOUNT_PREFIXES:
        if sender.startswith(prefix):
            return None
    return {"sender": sender, "content": content}

def scan_unread(mw) -> List[Dict[str, str]]:
    """
    扫描会话列表找未读私聊。
    mw: pywinauto 主窗口 wrapper（真机）。
    返回 [{sender, content}, ...] 列表（去重 sender）。
    """
    results = []
    seen = set()
    try:
        items = mw.descendants(control_type="ListItem")
    except Exception:
        return []
    for item in items:
        try:
            parsed = _parse_item_name(item.element_info.name)
        except Exception:
            continue
        if parsed and parsed["sender"] not in seen:
            seen.add(parsed["sender"])
            results.append(parsed)
    return results
```

**测试文件导入方式（零 pywinauto 依赖）：**
```python
# tests/test_scan_unread.py — 直接测 _parse_item_name 纯函数
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from listen_chat import _parse_item_name  # 不触发 pywinauto import
```

> `_parse_item_name` 必须在模块顶层定义，不套在任何 `if sys.platform` 守卫内，使得 Linux CI 也能 import。

### listen_chat.py — `reply_in_chat()` 规格

```python
def reply_in_chat(mw, item, reply_text: str) -> bool:
    """
    打开会话并发送回复。
    1. item.select()             — 点击会话 ListItem 打开
    2. 找 automation_id='chat_input_field' 的控件 → set_text(reply_text)
    3. 找 name='发送' 的按钮 → click_input()
    4. 验证 input field get_value() == ''（清空 = 发送成功）
    返回 True = 发送成功；False = 失败（输入框未清空）。
    抛 PermissionError = 非登录用户身份（stderr 提示）。
    """
```

### listen_chat.py — 真模式主循环规格

```python
def run_real_listen(args) -> int:
    # 1. get_main_window() 失败 → emit_json({ok:False, reason:...}) return 0
    # 2. replied: set[tuple[str,str]] — (sender, content) 去重
    # 3. 每 2 秒 scan_unread(mw)
    # 4. 对每个 {sender, content}：
    #    a. 若 (sender, content) in replied → skip
    #    b. rate_limiter.can_send('chat', sender) → False → skip
    #    c. POST draft-generate 带 mode='auto'
    #    d. result.get('reply') 为空或 == FAIL_PLACEHOLDER → skip（不发）
    #    e. reply_in_chat(mw, item, result['reply'])
    #       成功 → replied.add((sender, content))
    # 5. KeyboardInterrupt → emit_json({ok:True, info:'exited'}) return 0
```

### send_chat.py — 真发路径换 pywinauto

删除所有 `pyautogui.*` 调用，改为：

```python
def _send_via_pywinauto(target: str, wechat_id: str, message: str) -> Dict[str, Any]:
    """真发：复用 find_weixin.get_main_window() + reply_in_chat 配方。"""
    try:
        from find_weixin import get_main_window  # 仅 Windows 运行时
    except ImportError as e:
        return {"ok": False, "reason": "pywinauto_not_available", "error": str(e)}
    # ... get_main_window → scan 找 target → reply_in_chat
```

### wechat-draft.ts — mode 扩展规格

```typescript
export interface GenerateChatDraftParams {
  sender: string;
  wechat_id: string;
  content: string;
  mode?: 'auto' | 'review';  // 默认 'review'
}

export interface GenerateChatDraftSuccess {
  ok: true;
  status: 'pending_review';
  task_id: string;
  draft_id: string;
  reply?: string;  // 仅 mode=='auto' 且 aiContent 非 FAIL_PLACEHOLDER 时填充
}
```

`generateChatDraft` 成功路径末尾（返回前）加：

```typescript
const result: GenerateChatDraftSuccess = {
  ok: true,
  status: 'pending_review',
  task_id: taskId,
  draft_id: draftId,
};
if (params.mode === 'auto' && aiContent && aiContent !== FAIL_PLACEHOLDER) {
  result.reply = aiContent;
}
return result;
```

**关键约束**：`FAIL_PLACEHOLDER` 常量值不变（`'AI 生成失败（请人审决定是否重试）'`），`approval_source` 仍 NULL，`approval_status` 仍 `'pending_review'`。

---

## Commit 顺序（TDD 强制）

```
commit-1: test(wechat-rpa): scan_unread 单测 + rate_limiter 频控单测 + wechat-draft-auto-reply integration test（均 RED）
commit-2: feat(wechat-rpa): pywinauto 换装（find_weixin + listen_chat + send_chat + requirements.txt）+ wechat-draft mode:auto（让所有测试 GREEN）
```

CI `lint-tdd-commit-order` 检查：test 文件必须在 src 改动之前出现在 commit 历史。

---

## 验收评分权重

| 断言 | 权重 | 阻断 CI |
|---|---|---|
| A（无 wxauto4 残留） | 必须 | 是 |
| B（requirements.txt） | 必须 | 是 |
| C（find_weixin 非 stub） | 高 | 否 |
| D（listen_chat 配方） | 高 | 否 |
| E（send_chat 配方） | 高 | 否 |
| F（dryrun CLI 绿） | 必须 | 是 |
| G（_parse_item_name 单测 5 绿 G1-G5，含公众号/服务号/无未读过滤） | 必须 | 是 |
| H（频控单测绿） | 高 | 是 |
| I（TS 接口扩展） | 高 | 否 |
| J（integration test 4 绿） | 必须 | 是 |
| K（真机存档） | 中 | 否（Lead 后补） |
