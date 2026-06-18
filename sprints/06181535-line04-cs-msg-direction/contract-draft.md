# Sprint Contract Draft (Round 1)

**Sprint**: 06181535-line04-cs-msg-direction — Line04「不回自己」：读最后一条气泡方向，只回对方
**journey_type**: autonomous
**target_environment**: local_api（mock 气泡位置的 pytest + 独立 oracle，本地/CI 跑；真机微信气泡校准另排）

## Response Schema（推导来源: PRD 字面）

N/A — 任务无 HTTP 响应。本刀是 wechat-rpa worker 内部的回复决策逻辑（纯 Python 函数），
无新增 HTTP 端点、无 query parameter、无 JSON 响应体。验收 oracle = mock 气泡位置的纯函数断言。
（Reviewer 第 6 维 verification_oracle_completeness 对 HTTP schema 部分自动满分；本刀 oracle 完整性看下方气泡方向 6 case。）

## 契约 API（PRD 把「方向判定的具体阈值/字段」推导授权给 Proposer）

Generator 必须在 `services/agent/wechat-rpa/listen_chat.py` **顶层**（不在 `if sys.platform` 守卫内、
定义路径零 pywinauto import）实现：

```python
def _last_bubble_direction(mw: Any) -> Optional[str]:
    """读「聊天面板内最底部」一条消息气泡，按水平中心相对聊天面板中线判方向。"""
```

- 返回 `"incoming"`：气泡水平中心在中线**左侧** → 对方发来 → 应回
- 返回 `"outgoing"`：气泡水平中心在中线**右侧或压线** → 我方 / AI / 操作者 → 跳过（压线倾向判我方更安全）
- 返回 `None`：聊天面板内读不到任何气泡（空会话 / 读不到） → 安全跳过（宁可漏回不可回错）

**阈值推导（复用现有 `_chat_title_matches` 的 UIA 区域约定，listen_chat.py:687-717）**：
- `wr = mw.rectangle()`；`width = wr.right - wr.left`
- 聊天面板左界 `chat_left = wr.left + width // 4`（沿用 `_chat_title_matches` 排除左侧会话列表的边界）
- 聊天面板中线 `midline = (chat_left + wr.right) // 2`
- 「消息气泡」= `Text` 控件且 `r.left > chat_left`（在聊天面板内）且 `r.top >= wr.top + 150`（标题区下方，沿用标题区 150px 约定）且 name 非空
- 「最后一条」= 上述气泡里 `r.top` 最大（最底部）的那条
- 方向：气泡中心 `(r.left + r.right) // 2`；`>= midline → "outgoing"`，`< midline → "incoming"`
- 读 `Text` 控件 / `rectangle()` 抛异常 → 该控件跳过；窗口 `rectangle()` 抛异常 → 返回 `None`

**语义映射（主循环 Phase 2 接线）**：
| direction | 行为 | human_intervened 传给 decide_reply_wait |
|---|---|---|
| `"incoming"` | 进入生成+发送回复流程 | False |
| `"outgoing"` | **跳过本条 AI 回复**（不回自己/不回操作者）| **True**（操作者最右气泡=人工介入信号）|
| `None` | 跳过（安全）| False |

> 接线要点：现状 listen_chat.py:1539 硬编码 `decide_reply_wait(human_intervened=False)  # TODO`。
> 本刀把该占位接上 `_last_bubble_direction` —— outgoing ⇒ human_intervened=True 且 skip 该条回复。

## 已知约束（来自回归测试）

- [tests/test_reply_routing_isolation.py] → `_chat_title_matches(mw, sender)` 用窗口 rectangle + 右上区域 Text 判收件人身份（防串台）；本刀气泡方向读取**复用其 rectangle/descendants("Text") 写法**，区域约定保持一致（left > 窗口左+宽//4、top<顶+150 为标题区）
- [tests/test_scan_unread.py] → `_parse_item_name` 是顶层零-pywinauto 纯函数 CI 锚点；本刀 `_last_bubble_direction` 同样必须顶层零-pywinauto，纯 Fake 注入可测
- [tests/test_cs_reply_params.py] → `decide_reply_wait(human_intervened, ...)` 已落地（#791）：True→human_wait(~25s)、False→reply_delay(~2s)；本刀只**补 human_intervened 真实信号来源**，不改 decide_reply_wait 签名/语义

## Golden Path

客户私聊进来 → 扫到会话变化 → 开聊天读最底部气泡方向 → 仅「对方发来(左对齐)」进生成+发送，「我方/AI/操作者(右对齐)」跳过

---

### Step 1: 开聊天后，读聊天面板最底部一条气泡，判定方向
**来源**: `[FROM_PRD]` — PRD「Golden Path 具体」第 1 条：「开聊天，读聊天区最后一条消息气泡」

**可观测行为**: `_last_bubble_direction(mw)` 对「最底部左对齐气泡」返回 `"incoming"`，对「最底部右对齐气泡」返回 `"outgoing"`，读不到气泡返回 `None`。只看最底部那条，不被上方历史气泡干扰。

**验证命令**:
```bash
# 左对齐最底部气泡 → incoming
python3 sprints/06181535-line04-cs-msg-direction/oracle/direction_oracle.py incoming
# 期望：exit 0，stdout OK[incoming]
# 多条气泡只认最底部（上 outgoing + 底 incoming → incoming）
python3 sprints/06181535-line04-cs-msg-direction/oracle/direction_oracle.py last_wins
# 期望：exit 0，stdout OK[last_wins]
```
**硬阈值**: 两命令均 exit 0；函数未实现时 oracle 报 `FAIL[...]: _last_bubble_direction 未实现` 并 exit 1

---

### Step 2: 左对齐(对方发来) → 进入生成+发送回复流程
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 条：「左对齐 = 对方发来 → 进入生成+发送回复流程」

**可观测行为**: 方向 `"incoming"` ⇒ 主循环不跳过该 sender，进入 Phase 1 草稿生成 + Phase 2 发送。

**验证命令**:
```bash
python3 sprints/06181535-line04-cs-msg-direction/oracle/direction_oracle.py incoming
# 期望：exit 0（incoming → 应回）
```
**硬阈值**: exit 0；返回值字面 == `"incoming"`

---

### Step 3: 右对齐(我方/AI) → 跳过，不回自己
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 条：「右对齐 = 自己/AI/操作者发出 → 跳过，不回」

**可观测行为**: 方向 `"outgoing"` ⇒ 主循环跳过该条 AI 回复（根治内容变化触发时回自己的弱智 bug）。

**验证命令**:
```bash
python3 sprints/06181535-line04-cs-msg-direction/oracle/direction_oracle.py outgoing
# 期望：exit 0（outgoing → 跳过）
# 压中线边界 → 倾向判我方(outgoing)，更安全
python3 sprints/06181535-line04-cs-msg-direction/oracle/direction_oracle.py midline
# 期望：exit 0（压线 → outgoing）
```
**硬阈值**: 两命令均 exit 0；返回值字面 == `"outgoing"`

---

### Step 4: 操作者刚手动回过(最右对齐气泡) → 人工介入信号，跳过本条 AI 回复
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 条 + 范围「修 decide_reply_wait 的 human_intervened 占位」

**可观测行为**: 最底部气泡 `"outgoing"`（操作者手动消息几何上=右对齐，无法与 AI 自发区分，统一保守处理）⇒ 上游置 `human_intervened=True` 传给 `decide_reply_wait` 且跳过本条 AI 回复（人工优先）。listen_chat.py 不再硬编码 `decide_reply_wait(human_intervened=False)` 占位。

**验证命令**:
```bash
# 操作者右对齐最底部气泡 → outgoing（据此置 human_intervened=True 并跳过）
python3 sprints/06181535-line04-cs-msg-direction/oracle/direction_oracle.py operator
# 期望：exit 0
# 接线：硬编码占位已移除 且 主循环引用 _last_bubble_direction
grep -q "_last_bubble_direction(" services/agent/wechat-rpa/listen_chat.py \
  && ! grep -q "decide_reply_wait(human_intervened=False)" services/agent/wechat-rpa/listen_chat.py \
  || { echo "FAIL: human_intervened 占位未接线/未移除"; exit 1; }
# 期望：exit 0
```
**硬阈值**: operator oracle exit 0；接线检查 exit 0（占位移除 + 函数被引用）

---

### Step 5（边界）: 聊天区为空/读不到气泡 → 安全跳过
**来源**: `[FROM_PRD]` — PRD「边界情况」：「聊天区为空 / 读不到任何气泡 → 安全跳过（不回，宁可漏回不可回错）」

**可观测行为**: 聊天面板无气泡 ⇒ `_last_bubble_direction(mw)` 返回 `None` ⇒ 跳过，不回。

**验证命令**:
```bash
python3 sprints/06181535-line04-cs-msg-direction/oracle/direction_oracle.py empty
# 期望：exit 0（None → 安全跳过）
```
**硬阈值**: exit 0；返回值字面 == Python `None`

---

### Step 6（交付一致性）: 打包副本同步 + CI 全绿
**来源**: `[AI_ADDED]` — 理由：build-modules/line04/wechat-rpa 是 line04 模块打包产物，CI `ci-l4-runtime.yml` 用 `diff -r` 强校验与源码一致；源码改了不同步 build 副本会让 L4 Gate 红。此为本 repo 既有死规则，纳入合同防 Generator 漏同步。

**可观测行为**: `services/agent/build-modules/line04/wechat-rpa/listen_chat.py` 含同样的 `_last_bubble_direction`，且 `diff -r` 源码 vs 打包副本无差异；CI `wechat-cs-e2e.yml` 的 `pytest tests/ -q` 全绿。

**验证命令**:
```bash
# 打包副本已同步新函数
grep -q "def _last_bubble_direction" services/agent/build-modules/line04/wechat-rpa/listen_chat.py \
  || { echo "FAIL: build-modules 副本未同步"; exit 1; }
# 源码 vs 打包副本完全一致（CI L4 Gate 的 diff -r 规则）
diff -r services/agent/wechat-rpa/ services/agent/build-modules/line04/wechat-rpa/ \
  --exclude="*.pyc" --exclude="__pycache__" \
  || { echo "FAIL: build-modules 与源码分叉，运行 rsync -av services/agent/wechat-rpa/ services/agent/build-modules/line04/wechat-rpa/"; exit 1; }
```
**硬阈值**: 两命令均 exit 0

---

## E2E 验收（最终 final-e2e 跑 — target_environment = local_api）

> 本刀验收 = mock 气泡位置的 pytest 单测 + 独立 oracle，在本地/CI（ubuntu）跑 pytest。
> 真机微信气泡 UIA 结构确认与位置阈值校准**不在本刀范围**（PRD 明确，另排 windows_wechat/xian-pc dump UIA）。

```bash
#!/bin/bash
set -e
cd "$(git rev-parse --show-toplevel)"

# 1. 安装 pytest（CI ubuntu 环境）
python3 -m pip install --quiet pytest 2>/dev/null || python -m pip install --quiet pytest

# 2. 跑 mock 气泡方向回归测试（Generator 的 tests/test_msg_direction.py，6 case 全绿）
( cd services/agent/wechat-rpa && python3 -m pytest tests/test_msg_direction.py -q ) \
  || { echo "FAIL: test_msg_direction pytest 未全绿"; exit 1; }

# 3. 跑独立 oracle 6 case（不依赖 Generator 测试文件，防假绿）
for c in incoming outgoing operator last_wins empty midline; do
  python3 sprints/06181535-line04-cs-msg-direction/oracle/direction_oracle.py "$c" \
    || { echo "FAIL: oracle case=$c"; exit 1; }
done

# 4. 接线 + 打包同步 + 整目录 pytest（CI wechat-cs-e2e 跑的全量）
grep -q "_last_bubble_direction(" services/agent/wechat-rpa/listen_chat.py \
  && ! grep -q "decide_reply_wait(human_intervened=False)" services/agent/wechat-rpa/listen_chat.py \
  || { echo "FAIL: human_intervened 占位未接线"; exit 1; }
diff -r services/agent/wechat-rpa/ services/agent/build-modules/line04/wechat-rpa/ \
  --exclude="*.pyc" --exclude="__pycache__" || { echo "FAIL: build-modules 未同步"; exit 1; }
( cd services/agent/wechat-rpa && python3 -m pytest tests/ -q ) \
  || { echo "FAIL: wechat-rpa 全量 pytest 未全绿（回归）"; exit 1; }

echo "✅ Line04 不回自己 — 气泡方向 Golden Path 验证通过"
```

**通过标准**: 脚本 exit 0（pytest 全绿 + 6 oracle case + 接线 + 打包同步）

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 气泡方向判定 | `services/agent/wechat-rpa/tests/test_msg_direction.py` | incoming/outgoing/operator/last-wins/empty/midline 6 case | import 时 `_last_bubble_direction` 不存在 → ImportError → 6 case 全报错 |
| 独立 oracle（防假绿）| `sprints/06181535-line04-cs-msg-direction/oracle/direction_oracle.py` | 同 6 case，独立于 Generator 测试文件 | 函数未实现 → 全 case exit 1 |

## GAN 来源标注表

| FROM_PRD 来源步骤 | AI_ADDED 步骤 + 理由 |
|---|---|
| Step 1（读最后气泡）/ Step 2（左→回）/ Step 3（右→跳过）/ Step 4（操作者→人工介入）/ Step 5（空→安全跳过） | Step 6（打包同步+CI）：build-modules diff -r 是 repo 既有死规则，纳入防漏同步 |
