# Contract Draft：Line04 AI 思考浮窗（第一刀·动态流）

> Sprint: 07121132-line04-ai-thinking-overlay  
> Task ID: a1bf1ba5-bf7c-4a87-842d-0dbe004698fb  
> Journey: 客户私域 AI 接管 (bfeed805) · Step 新增 · Maturity thin  
> 起草日期: 2026-07-12

---

## 范围声明

本合同覆盖 PRD 中 FR-1 ～ FR-11 及 8 条 Invariant 约束的可验证技术断言。  
**不包含**：当前会话跟随、完整客户画像卡片、中台浮窗监控看板页、listen_chat 守活退避阶梯。

---

## 功能合同

### FC-1：events.jsonl 事件管道（对应 FR-1）

- `listen_chat.py` 以 `O_APPEND` 模式追加写 `events.jsonl`；浮窗进程**只读**（tail 模式）
- 每行格式：`{"v":1,"event_id":"<epoch_ms>-<run_id>-<seq>","type":"reply_sent|reply_skipped|heartbeat|agent_online",...}`
- 文件超过 5MB → rename 轮转，保留一代旧文件；轮转后按 inode 变化重开文件句柄
- 坏行（JSON 解析失败）→ 跳过，不崩溃，写 `overlay-diag.json` 计数
- `event_id` 幂等去重：相同 `event_id` 的行只处理一次

### FC-2：中台 LLM 合同 JSON 扩展（对应 FR-2）

- `wechat-draft.ts` 的 `draft-generate` 接口返回体扩展字段 `reasoning`（≤30字）
- LLM 合同 JSON 结构：`{reply: string, tags: string[], reasoning: string}`
- `reasoning` 缺失时降级文案：`"已回复 {联系人}"`
- `openrouter.ts` 中 `reasoning_content` 剥离纪律不变
- PII 过滤在 **中台返回前** 执行（手机号/微信号/身份证 → 整句降级）
- `draft-generate` 返回体**向后兼容**，`reasoning` 为可选字段

### FC-3：pywebview 浮窗独立进程（对应 FR-3）

- 浮窗以独立子进程运行，由 line04 node 侧 spawn（参照 `wechat-rpa.ts:19-27`）
- 窗口标志：`WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW`；支持 Per-Monitor V2 DPI
- 500ms 循环：合并贴靠位置 + 显隐同步 + tail 读取
- 微信窗口 CLOAKED 状态（托盘化）→ 浮窗冻结（隐藏，不跟随）
- 四行判据表：`VISIBLE`=显示贴靠、`CLOAKED`=冻结隐藏、`NOT_FOUND`=守护态、`OFFSCREEN_REPLY`=独立悬浮

### FC-4：动态流 UI（对应 FR-4）

- 动态条目上限 20 条，DOM 保持 ≤30 节点（FIFO 淘汰最旧）
- `reply_sent` 事件流程：灰态「发送中」→ DELIVERED 确认 → 原地翻绿「已送达」
- 已送达卡片显示：昵称 + 阶段色点（A1-A4）+ reasoning ≤30字 + 相对时间
- 同联系人相邻消息聚合显示
- `reply_skipped` 显示灰条，**不计入未读数**

### FC-5：位置/折叠态持久化（对应 FR-5）

- 状态文件：`_STATE_DIR/overlay-state.json`（禁止写 `C:\Users\Public`）
- 文件损坏 → 弃用 + 备份（重命名为 `.bak`），以默认值重建
- 恢复时 `rect_visible` 越界检测 → 重置到屏幕可见区域
- 折叠态持久化；折叠期有新 `reply_sent` → 徽标数字弹跳一次（无声音/闪烁/焦点抢占）
- `OFFSCREEN_REPLY` 模式：微信不可见时回复 → 浮窗独立悬浮显示

### FC-6：欢迎卡与守护态（对应 FR-6）

- 首次启动：`first_run_done` 标志写 `overlay-state.json`；显示欢迎卡；后续不再显示
- 默认守护态文案：`「AI 客服守护中 · 今日已回复 N 条 · 最近动作 xx:xx」`
- 今日计数：回放当前代 + 前一代 `events.jsonl` 中当日 `reply_sent` 条目
- 微信不存在时（`NOT_FOUND`）始终显示守护态，不空白

### FC-7：拉起守活（对应 FR-7）

- line04 node 侧 spawn 浮窗子进程
- 30s 心跳检测，进程消失 → 30s 内重拉
- 熔断：60min 内 8 次存活 < 60s → 熔断静默，停止重拉
- Agent 重启后熔断计数复位
- `overlay.pid` 热更：写 PID 时先检查旧 PID 进程（mutex + 映像名校验），存在则杀旧再写新

### FC-8：诊断上报（对应 FR-8）

- `_STATE_DIR/overlay-diag.json` 覆盖写（与 events.jsonl 完全独立）
- 字段包含：`rss_mb / cpu_pct / attach_state / render_lag_ms_p95 / restart_count_60min / circuit_open`
- line04 心跳上报中台（含 preflight 检测结果）

### FC-9：内存/CPU 自愈（对应 FR-9）

- RSS 连续 2 心跳 > 200MB → 保留最新 20 条动态 + 触发 GC
- RSS > 300MB → 自杀重启（写 diag 后退出，守活机制重拉）
- CPU 60s 均值 > 5% → 轮询间隔降频至 1s + diag 上报

### FC-10：listen_chat 脱敏（对应 FR-10）

- `listen_chat.py` 第 4687/4691/4696 行明文 `content` 日志 → 统一替换为脱敏函数调用
- 脱敏函数同 PII 过滤器（手机号/微信号/身份证 → `[REDACTED]`）
- grep 型回归：CI 断言 `listen_chat.py` 中不存在明文 `content` 日志字样

### FC-11：软检测 preflight（对应 FR-11）

- spawn 前检测：`import pywebview` 可导入 + WebView2 注册表（HKLM + HKCU 双查）
- 任一检测失败 → **不 spawn** 浮窗进程；写 `overlay-diag.json` 记录原因
- line04 心跳上报中台 preflight 状态
- preflight 失败不影响 AI 回复主链（listen_chat + draft-generate 正常运行）

---

## E2E 验收

### CI 层（windows_cloud，GitHub Actions windows-latest）

| 测试 | 文件 | 通过条件 |
|------|------|---------|
| pywebview 建窗探针 | `tests/test_overlay_probe.py` | 2s 内建窗退出，返回码 0 |
| notepad 替身 NOACTIVATE | `tests/test_noactivate_hwnd.py` | GetForegroundWindow 在贴靠/显隐操作前后不变 |
| 探针败→降级 pytest | `tests/test_pii_filter.py` | PII 过滤纯函数通过所有用例 |
| 坏行容错 | `tests/test_events_jsonl.py::test_bad_line_skip` | 坏行跳过，无异常 |
| 并发写读 1 万行 | `tests/test_events_jsonl.py::test_concurrent_write_read` | 无丢行、无重复 |
| 跨午夜计数 | `tests/test_events_jsonl.py::test_cross_midnight_count` | 计数正确区分日期 |
| 跨两代回放 | `tests/test_events_jsonl.py::test_two_gen_replay` | 两代文件累计计数正确 |
| event_id 幂等 | `tests/test_events_jsonl.py::test_event_id_dedup` | 重复 event_id 只处理一次 |
| PII 过滤器全用例 | `tests/test_pii_filter.py` | 含「复述客户原话」用例通过 |
| draft-generate 三路 | `tests/test_draft_generate.vitest.ts` | 正常/兜底缺省/PII 命中降级三路全通 |
| listen_chat 明文清零 | `tests/test_listen_chat_grep.sh` | grep 计数为 0 |
| smoke 接入 CI | `.github/workflows/scripts/smoke/line04-ai-overlay-smoke.sh` | smoke 脚本通过，接入 CI |

### 真机层（xian-rog）

| 场景 | 验收断言 |
|------|---------|
| 真发消息端到端 | `events.jsonl` 新增 `reply_sent` 行，含 `reasoning` 字段，**不含客户原文**；浮窗截图显示该动态；今日计数 +1 |
| 托盘化焦点 | 微信托盘化发送瞬态：浮窗冻结不闪烁；记事本置前触发回复 → `GetForegroundWindow` 不变 |
| 关闭不被拉回 | 关闭浮窗后 30s 内不重启；托盘菜单「显示 AI 浮窗」重开成功 |
| preflight 真机双查 | HKLM + HKCU WebView2 检测通过，overlay-diag.json 含 `preflight_pass: true` |

---

## 边界与风险

| 风险 | 缓解 |
|------|------|
| WebView2 Evergreen 自动更新导致崩溃 | 独立错误码静默重建，不计入熔断计数，不锁版本 |
| 浮窗进程崩溃影响主链 | FC-11 preflight 隔离；主链 pytest 断言浮窗不存在时回复正常 |
| PII 泄漏 | 双硬闸：中台过滤 + agent 写文件前二次过滤；grep 回归保障 |
| events.jsonl 竞态 | 仅 listen_chat 写（O_APPEND），浮窗只读；并发测试 1 万行验证 |
