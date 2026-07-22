# Sprint PRD — GP-4 Overlay 画像卡重画（三痛点修复）

task_id: 757c6ab8-985c-415d-8e4f-9749bd0709fc
journey_id: 35ac40c2-ba63-81af-af97-e3bc8e3b0fb4
journey_type: user_facing
target_environment: windows_cloud
thickness: thin
sprint_dir: sprints/07201810-overlay-card-redesign-gp4
date: 2026-07-20

## Journey 定位

**客户私域 AI 接管**（Path 4）—— 接续刀。前序已交付 overlay 基础浮窗（PR#1239/#1245/#1256/07150800）。
本刀解决三个真机痛点：① 画像卡缺 cs_memory_longterm 三段论数据；② 浮窗无 thinking 状态激活；
③ 查看完整画像需跳转 CustomerProfilePage 但无入口按钮。

路径声明：本 PR 把 Path 4「AI 思考浮窗」从 thin-可用 推到 thin-数据完整（画像三段论 + thinking 事件 + 画像页入口）。

---

## Gate 前置门槛（实现前必须逐项通过）

**Gate A** overlay 重启后消费位置从 `_STATE_DIR/tail_pointer.txt` 恢复，不重放旧 event_id。

**Gate D** `thinking` type 加入后，grep 全部 3 处 `_write_event` 调用点（:4442/:5324/:5779），无多余字段污染。

**Gate E** HK-VPS + MMV 两台：`pg_indexes` 查 `cs_memory_longterm` 含 `idx_cs_memory_longterm_tenant_contact`。

**Gate G** xian-rog：`python -c "import webbrowser; webbrowser.open('http://localhost:5174/wechat/crm/test')"` 默认浏览器打开。

---

## Invariant 约束（继承前序 12 条，本刀新增 3 条）

前序 12 条完整继承（见 07121132 PRD）。本刀新增 3 条：

**Inv-13** tail_pointer.txt 只由 EventTailConsumer 读写，单行整数（字节 offset），损坏→归零不崩。
**Inv-14** `thinking` 写入点 = `post_draft_generate` 调用前（:5700 附近），不携带 contact 以外字段。
**Inv-15** `open_customer_page` 内部 `webbrowser.open(url)`，不内嵌 iframe，不在浮窗内渲染页面。

---

## 累积 FR

### FR-1：tail_pointer.txt 持久化（Gate A 前置）

**F1.1** `EventTailConsumer.__init__` 新增 `_pointer_path = state_dir/tail_pointer.txt`，启动时读取字节 offset 并 `f.seek(offset)`。
**F1.2** 每次 `get_events()` 调用后将当前 `f.tell()` 写回 `tail_pointer.txt`（覆写单行整数）。
**F1.3** 文件损坏/不存在 → offset 归零，不抛异常；写失败软失败（仅 log）。

### FR-2：cs_memory_longterm 三段论接入画像卡

**F2.1** 中台 `GET /api/wechat/customer-profile?wechat_id=<id>` 响应体扩展字段：
`portrait.need`、`portrait.budget`、`portrait.concern`（均来自 `cs_memory_longterm.summary` 解析或直接透出 summary）。
**F2.2** 同时返回最近 3 条消息（`recent_messages: [{ts, direction, text}]`），来自 `cs_memory_messages` 表。
**F2.3** overlay_window.py 中 `renderProfile` 函数补充三段论字段渲染：需求 / 预算 / 顾虑各一行。

### FR-3：thinking 事件激活浮窗 setThinking()

**F3.1** `listen_chat.py` 在 `post_draft_generate` 调用前插入 `_write_event("thinking", sender)`（约 :5700 `_gen_draft` 函数内部）。
**F3.2** `overlay_window.py:675` 已有 `setThinking()` 死代码被激活：`thinking` event 到达时调用，参数为 `ev.text || '思考中...'`（现状已满足，无需改动）。
**F3.3** `_write_event` 函数本体：`thinking` type 时 `reasoning` 字段设为 `None`，`text` 字段设为 `'思考中...'`（扩展签名向后兼容）。

### FR-4：画像页入口按钮

**F4.1** `overlay_window.py` HTML 模板新增「查看画像」按钮，点击调用 `window.pywebview.api.open_customer_page(wechat_id)`。
**F4.2** `OverlayApp` 新增 `open_customer_page(self, wechat_id: str)` 方法，内部 `webbrowser.open(f"{self._middleware_base_url}/wechat/crm/{wechat_id}")`。
**F4.3** `wechat_id` 来自当前 session_switch 事件缓存（`_current_wechat_id`），无 session 时按钮置灰。

### FR-5：CI 与 smoke 覆盖

**F5.1** pytest 新增 3 case：tail_pointer 重启幂等（Gate A）；thinking event 不含敏感字段（Gate D）；`open_customer_page` 调用 webbrowser（Gate G mock）。
**F5.2** `line04-ai-overlay-smoke.sh` 追加：thinking event 写入断言（grep events.jsonl 含 `"type":"thinking"`）。
**F5.3** vitest 新增 1 case：`/api/wechat/customer-profile` 响应含 `portrait.need/budget/concern` 和 `recent_messages[0..2]`。

---

## NFR

| 指标 | 阈值 | 超限动作 |
|------|------|--------|
| tail_pointer 写入延迟 | ≤50ms/次 | 软失败不阻塞 |
| thinking→浮窗显示延迟 P95 | ≤600ms | diag 日志 |
| customer-profile 接口响应 P95 | ≤500ms | 超限写 diag |
| 内存 RSS（继承） | >300MB → 自杀重启 | — |

---

## E2E 验收断言（9 条，L1×5 / L2×3 / L3×1）

**L1（单元/CI 可验）**
- L1-1：tail_pointer 重启后 get_events 不返回旧 event_id（pytest）
- L1-2：thinking event 写入 events.jsonl 不含 PII 字段（pytest grep）
- L1-3：_write_event 3 处调用点字段无污染（grep 静态断言）
- L1-4：`cs_memory_longterm (tenant_id,contact)` 联合索引在 HK-VPS 存在（psql 断言）
- L1-5：`open_customer_page` mock 调用 webbrowser.open 带正确 URL（pytest monkeypatch）

**L2（smoke/集成）**
- L2-1：`post_draft_generate` 调用前 events.jsonl 出现 `"type":"thinking"` 条目（smoke grep）
- L2-2：overlay 重启后 tail_pointer.txt 存在且为整数（smoke cat）
- L2-3：`/api/wechat/customer-profile` 响应含三段论字段及最近 3 条消息（curl JSON assert）

**L3（真机 xian-rog，手动）**
- L3-1：发送一条消息全链路——thinking 卡激活（蓝色动画）→ reply_sent 到达→「查看画像」按钮可点击→浏览器打开 CustomerProfilePage 含 need/budget/concern 三段论数据

---

## 不包含（范围外）

- overlay 内嵌 iframe 渲染 CustomerProfilePage
- 多客户并发 thinking 状态（仅展示最新一条）
- reasoning streaming（仍走 reply_sent 一次性写入）
- DB schema 变更（cs_memory_longterm 表结构已就绪，见 Gate E）
- cs_memory_longterm 的 need/budget/concern 结构化列（本刀透出 summary，结构化解析是加厚阶段）

---

journey_type: user_facing
target_environment: windows_cloud
