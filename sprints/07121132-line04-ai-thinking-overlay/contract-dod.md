# Contract DoD：Line04 AI 思考浮窗（第一刀·动态流）

> Sprint: 07121132-line04-ai-thinking-overlay  
> Task ID: a1bf1ba5-bf7c-4a87-842d-0dbe004698fb  
> 起草日期: 2026-07-12

---

## [BEHAVIOR] 条目（8 条 Invariant + 功能核心）

### [BEHAVIOR-INV-1] 主链零影响

**断言**：pywebview 未安装 或 WebView2 注册表查询失败 时，AI 回复主链（listen_chat → draft-generate → reply）**必须正常运行**，浮窗 preflight 失败不写入 manifest requiredChecks。

**触发条件**：`import pywebview` 抛 ImportError 或 HKLM+HKCU 双查均无 WebView2 键值

**预期结果**：
- `overlay-diag.json` 写入 `preflight_pass: false` + 失败原因
- listen_chat 继续运行，events.jsonl 继续写入 reply_sent
- 无任何异常冒泡到主链
- line04 心跳上报中台含 `overlay_preflight: false`

```bash
# manual:bash
# 模拟 pywebview 缺失场景（在测试环境）
python -c "
import sys
sys.modules['pywebview'] = None  # 强制 import 失败模拟
# preflight 应返回 False 且不崩溃
from services.overlay.preflight import check_preflight
result = check_preflight()
assert result['pass'] == False, f'Expected preflight fail, got {result}'
assert 'pywebview' in result['reason'].lower() or 'webview2' in result['reason'].lower()
print('PASS: preflight failure isolated from main chain')
"
```

---

### [BEHAVIOR-INV-2] PII 双硬闸

**断言**：手机号（11位数字）/ 微信号（wx开头+字母数字）/ 身份证（18位）经过**两次独立过滤**：一次在中台 `wechat-draft.ts` 返回前，一次在 agent 写 `events.jsonl` 前。任何一次过滤均必须将匹配整句降级为 `[已过滤]`，且 `events.jsonl` 不得出现原始 PII 字符串。

**触发条件**：LLM reasoning 或 reply 字段包含手机号/微信号/身份证

**预期结果**：
- `draft-generate` 返回的 `reply`/`reasoning` 中 PII 已被整句降级
- `events.jsonl` 写入行中不含原始手机号/微信号/身份证
- vitest 三路断言（正常/缺省/PII命中）全部通过

```bash
# manual:bash
cd /workspace
# 运行 PII 过滤器单元测试
python -m pytest sprints/07121132-line04-ai-thinking-overlay/tests/test_pii_filter.py -v
# 验证 events.jsonl 中无明文 PII（使用测试生成的样本文件）
python -m pytest sprints/07121132-line04-ai-thinking-overlay/tests/test_pii_no_leak.py -v
```

---

### [BEHAVIOR-INV-3] 禁止抢焦点

**断言**：浮窗窗口**始终**带 `WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW` 标志；微信托盘化期间触发 AI 回复时，`GetForegroundWindow()` 返回值在回复前后**不变**；浮窗无任何键盘/鼠标钩子。

**触发条件**：任意用户操作（拖动浮窗、折叠/展开、浮窗贴靠更新、托盘化回复）

**预期结果**：
- `GetForegroundWindow()` 调用前后句柄相同
- 浮窗窗口扩展样式包含 `WS_EX_NOACTIVATE (0x08000000)` + `WS_EX_TOOLWINDOW (0x00000080)`
- CI notepad 替身测试：置前 notepad → 触发浮窗贴靠更新 → notepad 仍为前台窗口

```bash
# manual:bash
# CI 环境：notepad 替身 NOACTIVATE 测试
python -m pytest sprints/07121132-line04-ai-thinking-overlay/tests/test_noactivate_hwnd.py -v -k "test_foreground_unchanged"
```

---

### [BEHAVIOR-INV-4] events.jsonl 唯一写者

**断言**：`events.jsonl` 仅由 `listen_chat.py` 以 `O_APPEND` 模式写入；浮窗进程只 tail 读取；5MB 轮转时浮窗按 inode 变化重开文件句柄；相同 `event_id` 的行只处理一次（幂等去重）。

**触发条件**：多线程并发写读 / 跨文件轮转 / 重复推送同一事件

**预期结果**：
- 1 万行并发写读测试：无丢行、无重复行
- 轮转后浮窗在 1s 内重新打开新文件句柄
- 重复 event_id 写入后，浮窗端计数不重复

```bash
# manual:bash
python -m pytest sprints/07121132-line04-ai-thinking-overlay/tests/test_events_jsonl.py -v \
  -k "test_concurrent_write_read or test_event_id_dedup or test_rotation_reopen"
```

---

### [BEHAVIOR-INV-5] 温和异常文案

**断言**：所有降级/错误/异常态的 UI 显示文案**禁止**包含「错误」「中断」「!」三个字符（中英文叹号均禁止）；一律使用灰色温和提示。

**触发条件**：PII 过滤降级 / preflight 失败 / 浮窗渲染崩溃 / events.jsonl 坏行 / 熔断静默

**预期结果**：
- grep 全部浮窗 HTML/JS/Python 源码，不含前台展示用「错误」「中断」「!」字样
- 降级文案示例合规：「AI 客服暂时休息中」（而非「AI 客服出错了！」）

```bash
# manual:bash
# 检查浮窗相关源码中不含禁用文案
! grep -rn --include="*.py" --include="*.js" --include="*.html" \
  -E '(错误|中断|！|[!]{1})' \
  apps/agent-android/ services/overlay/ \
  | grep -v "^Binary" | grep -v "test_" | grep -v "#" \
  && echo "PASS: no forbidden error text found"
```

---

### [BEHAVIOR-INV-6] 熔断保护

**断言**：60 分钟滚动窗口内，浮窗进程存活时长 < 60s 的重启次数达到 8 次 → **熔断静默**，停止自动重拉；agent（line04 node）重启后熔断计数**复位**；WebView2 Evergreen 更新/渲染崩溃使用独立错误码静默重建，**不计入**崩溃熔断。

**触发条件**：浮窗进程频繁崩溃 / agent 重启 / WebView2 自动更新

**预期结果**：
- 第 8 次存活<60s 后，守活计时器停止（不再 spawn）
- `overlay-diag.json` 含 `circuit_open: true`
- agent 重启后 `restart_count_60min` 归零，可再次 spawn

```bash
# manual:bash
python -m pytest sprints/07121132-line04-ai-thinking-overlay/tests/test_circuit_breaker.py -v \
  -k "test_circuit_opens_at_8 or test_circuit_resets_on_agent_restart or test_webview2_crash_not_counted"
```

---

### [BEHAVIOR-INV-7] reasoning 单一来源

**断言**：浮窗 UI 中显示的 `reasoning` **仅来源**于 LLM 合同 JSON 的 `reasoning` 字段（≤30字）；`openrouter.ts` 的 `reasoning_content` 剥离纪律不变；`reasoning` 字段缺失时降级文案固定为 `「已回复 {联系人}」`，不使用其他来源替代。

**触发条件**：LLM 返回含 reasoning / LLM 返回不含 reasoning / openrouter reasoning_content 泄漏

**预期结果**：
- vitest：`draft-generate` 正常路径 → reasoning 长度 ≤30字
- vitest：reasoning 缺失 → 降级文案 `已回复 {联系人}`，不为空、不为其他
- vitest：openrouter reasoning_content 存在时，**不**出现在 reply/reasoning 返回字段

```bash
# manual:bash
cd /workspace
npx vitest run sprints/07121132-line04-ai-thinking-overlay/tests/test_draft_generate.vitest.ts \
  --reporter=verbose
```

---

### [BEHAVIOR-INV-8] 禁止 C:\Users\Public 路径

**断言**：`events.jsonl`、`overlay-state.json`、`overlay-diag.json`、`overlay.pid` 等所有状态文件**仅写入 `_STATE_DIR` 环境变量指定路径**；代码中不得出现硬编码 `C:\Users\Public` 路径字符串。

**触发条件**：浮窗进程启动、事件写入、状态持久化、诊断上报

**预期结果**：
- grep 全部相关源码，不含 `C:\\Users\\Public` 或 `C:/Users/Public` 字符串
- 集成测试：_STATE_DIR 设为临时目录 → 所有文件写入该目录

```bash
# manual:bash
# 检查硬编码 Public 路径
! grep -rn --include="*.py" --include="*.ts" --include="*.js" \
  -i "C:\\\\Users\\\\Public\|C:/Users/Public\|users.public" \
  apps/ services/ \
  && echo "PASS: no hardcoded C:\\Users\\Public path found"

# 验证 _STATE_DIR 路由（集成测试）
python -m pytest sprints/07121132-line04-ai-thinking-overlay/tests/test_state_dir_routing.py -v
```

---

### [BEHAVIOR-FUNC-1] 动态流发送中→已送达翻转

**断言**：`reply_sent` 事件到达浮窗后，对应卡片先显示灰态「发送中」；收到 `DELIVERED` 确认后，**原地**翻转为绿态「已送达」，不新增卡片、不重排列表。

**触发条件**：listen_chat 写入 reply_sent 事件 → DELIVERED 确认到达

**预期结果**：
- DOM 中同一节点的 class 从 `status-pending` 变为 `status-delivered`
- 昵称、阶段色点（A1-A4）、reasoning、相对时间均显示正确
- 今日计数 +1

```bash
# manual:bash
python -m pytest sprints/07121132-line04-ai-thinking-overlay/tests/test_overlay_ui.py -v \
  -k "test_pending_to_delivered_in_place"
```

---

### [BEHAVIOR-FUNC-2] 折叠态徽标弹跳

**断言**：浮窗折叠状态下，新 `reply_sent` 事件到达 → 徽标数字 +1，**弹跳动画触发一次**；弹跳期间**无声音、无闪烁、无焦点抢占**（GetForegroundWindow 不变）。

```bash
# manual:bash
python -m pytest sprints/07121132-line04-ai-thinking-overlay/tests/test_overlay_ui.py -v \
  -k "test_badge_bounce_no_focus"
```

---

### [BEHAVIOR-FUNC-3] 关闭不被拉回

**断言**：用户点击浮窗关闭按钮 → 浮窗退出，**30s 内守活机制不重拉**；托盘菜单「显示 AI 浮窗」点击后浮窗重新出现。

```bash
# manual:bash
python -m pytest sprints/07121132-line04-ai-thinking-overlay/tests/test_overlay_lifecycle.py -v \
  -k "test_close_not_revived or test_tray_reopen"
```

---

### [BEHAVIOR-FUNC-4] 守护态默认文案非空

**断言**：微信不可见（NOT_FOUND 状态）时，浮窗显示守护态文案 `「AI 客服守护中 · 今日已回复 N 条 · 最近动作 xx:xx」`，**不空白**；N 从跨两代 events.jsonl 回放计算。

```bash
# manual:bash
python -m pytest sprints/07121132-line04-ai-thinking-overlay/tests/test_events_jsonl.py -v \
  -k "test_two_gen_replay or test_guardian_mode_not_blank"
```

---

## smoke 接入验收

```bash
# manual:bash（CI 入口）
bash .github/workflows/scripts/smoke/line04-ai-overlay-smoke.sh
echo "Exit code: $?"
# 期望退出码 0
```

---

## 全量验收命令（汇总）

```bash
# manual:bash
set -e

echo "=== 1. PII 过滤器 ==="
python -m pytest sprints/07121132-line04-ai-thinking-overlay/tests/test_pii_filter.py -v

echo "=== 2. events.jsonl 管道 ==="
python -m pytest sprints/07121132-line04-ai-thinking-overlay/tests/test_events_jsonl.py -v

echo "=== 3. 熔断保护 ==="
python -m pytest sprints/07121132-line04-ai-thinking-overlay/tests/test_circuit_breaker.py -v

echo "=== 4. 浮窗 UI 行为 ==="
python -m pytest sprints/07121132-line04-ai-thinking-overlay/tests/test_overlay_ui.py -v

echo "=== 5. 浮窗生命周期 ==="
python -m pytest sprints/07121132-line04-ai-thinking-overlay/tests/test_overlay_lifecycle.py -v

echo "=== 6. 状态目录路由 ==="
python -m pytest sprints/07121132-line04-ai-thinking-overlay/tests/test_state_dir_routing.py -v

echo "=== 7. preflight 隔离 ==="
python -m pytest sprints/07121132-line04-ai-thinking-overlay/tests/test_preflight.py -v

echo "=== 8. draft-generate vitest ==="
npx vitest run sprints/07121132-line04-ai-thinking-overlay/tests/test_draft_generate.vitest.ts --reporter=verbose

echo "=== 9. listen_chat 明文日志清零 ==="
bash sprints/07121132-line04-ai-thinking-overlay/tests/test_listen_chat_grep.sh

echo "=== 10. 禁止 Public 路径 ==="
! grep -rn --include="*.py" --include="*.ts" --include="*.js" \
  -i "C:\\\\Users\\\\Public\|C:/Users/Public" apps/ services/ \
  && echo "PASS: no hardcoded C:\\Users\\Public"

echo "=== 11. smoke ==="
bash .github/workflows/scripts/smoke/line04-ai-overlay-smoke.sh

echo "=== ALL PASS ==="
```

---

## DoD 铁律覆盖情况

| # | Invariant | 覆盖 [BEHAVIOR] 条目 | 状态 |
|---|-----------|---------------------|------|
| 1 | 主链零影响 | BEHAVIOR-INV-1 | ✅ |
| 2 | PII 双硬闸 | BEHAVIOR-INV-2 | ✅ |
| 3 | 禁止抢焦点 | BEHAVIOR-INV-3 | ✅ |
| 4 | events.jsonl 唯一写者 | BEHAVIOR-INV-4 | ✅ |
| 5 | 温和异常文案 | BEHAVIOR-INV-5 | ✅ |
| 6 | 熔断保护 | BEHAVIOR-INV-6 | ✅ |
| 7 | reasoning 单一来源 | BEHAVIOR-INV-7 | ✅ |
| 8 | 禁止 C:\Users\Public | BEHAVIOR-INV-8 | ✅ |

**铁律覆盖：8/8**
