# Contract Draft — Line04 AI 思考浮窗 第二刀

sprint_dir: sprints/07121132-line04-ai-thinking-overlay
task_id: 8f93f2a1-fdc2-4d41-b97d-6a5ff984697c
journey_id: 35ac40c2-ba63-81af-af97-e3bc8e3b0fb4
round: 2
date: 2026-07-12
status: PROPOSED

---

## 一、范围声明

### 交付边界（本次 IN）

| # | 交付物 | 文件路径 | FR |
|---|-------|---------|-----|
| 1 | overlay_window.py — 无边框置顶窗 + HTML 动态流 UI（欢迎卡/默认态/动态条目/折叠徽标/降级态） | `services/agent/wechat-rpa/overlay/overlay_window.py` | FR-1 |
| 2 | 贴靠+显隐循环（500ms 单循环，四行判据表，overlay-state.json 持久化/损坏弃用不崩） | 同上，`PositionLoop` 类 | FR-2 |
| 3 | events tail 消费（.1 跨代回放/event_id 幂等去重/坏行跳过/heartbeat 180s 降级） | 同上，`EventTailConsumer` 类 | FR-3 |
| 4 | 中台 wechat-draft.ts reasoning 真实现（LLM JSON 合同扩展 `{reply,tags,reasoning}` + PII 硬闸接线 + 替换 mock 存根） | `apps/api/src/services/wechat-draft.ts` | FR-4 |
| 5 | node 侧接线（line04 handler spawn/preflight/watchdog/mutex 热更杀旧/用户关闭不重拉） | `services/agent/modules/line04/handlers/overlay.ts`（新增） | FR-5 |
| 6 | CI pywebview 建窗探针（2s 建窗退出）+ notepad 替身 hwnd 贴靠/NOACTIVATE 断言 + 探针败纯函数 pytest 兜底 | GHA step 新增至现有 CI workflow | FR-6 |

### 不在本次范围（OUT）

- **第一刀已交付地基（禁重做）**：
  - `services/agent/wechat-rpa/overlay/pii_filter.py`（PII 过滤纯函数）
  - `services/agent/wechat-rpa/overlay/preflight.py`（软检测）
  - `services/agent/wechat-rpa/overlay/watchdog.py`（熔断守活）
  - `sprints/07121132-line04-ai-thinking-overlay/tests/` 全套骨架（只追加，不重写已有 test）
  - `.github/workflows/scripts/smoke/line04-ai-overlay-smoke.sh`（只补充，不删旧项）
  - events.jsonl 管道钩子（listen_chat O_APPEND 写者，listen_chat.py 不动）
- 当前会话跟随（点开哪个客户浮窗切哪个）——第三刀
- 完整客户画像卡片——第三刀
- 中台浮窗监控看板页——另立 sprint
- listen_chat 守活退避阶梯补充——超范围

---

## 二、Test Contract 表

| BEHAVIOR ID | 描述 | 测试文件 | it() 名称子串 |
|-------------|------|---------|--------------|
| BEHAVIOR-1 | pywebview 无边框置顶窗 2s 内建窗，WS_EX_NOACTIVATE 不抢焦 | `tests/test_overlay_window.py` | `无边框置顶窗 2s 内建窗` |
| BEHAVIOR-2a | 贴靠判据表 — 微信 IsIconic → 浮窗隐藏 | `tests/test_overlay_window.py` | `IsIconic 时浮窗隐藏` |
| BEHAVIOR-2b | 贴靠判据表 — DWMWA_CLOAKED≠0 → 位置冻结不更新 | `tests/test_overlay_window.py` | `CLOAKED 态位置不更新` |
| BEHAVIOR-2c | overlay-state.json 损坏 → 弃用默认值，不进崩溃循环 | `tests/test_overlay_window.py` | `state.json 损坏时弃用默认值` |
| BEHAVIOR-3a | tail 消费 heartbeat >180s（3 周期）→ 渲染降级文案「AI 客服休息中」 | `tests/test_overlay_window.py` | `heartbeat 超 180s 降级文案` |
| BEHAVIOR-3b | tail 消费 inode 变化 → 重开句柄，先读 .1 再读当前，两代合并今日计数 | `tests/test_overlay_window.py` | `inode 变化重开句柄` |
| BEHAVIOR-3c | tail 消费坏行/半行跳过不崩；event_id 整串精确匹配幂等去重 | `tests/test_overlay_window.py` | `坏行跳过 幂等去重` |
| BEHAVIOR-4 | generateChatDraft 真实 LLM 调用返回 `{reply, tags, reasoning}`，reasoning≤30字，PII 命中降级，兜底缺省正确 | `tests/wechat-draft-reasoning.test.ts` | `LLM 返回 reasoning → 响应体含 reasoning` |
| BEHAVIOR-5a | overlay handler spawn 前 preflight 软检测：失败不 spawn，写 overlay-diag.json | `tests/overlay-handler.test.ts` | `preflight 失败不 spawn` |
| BEHAVIOR-5b | mutex 热更杀旧；用户关闭（exit_code=0 + user_closed=true）→ 守活不重拉 | `tests/overlay-handler.test.ts` | `用户关闭不重拉` |
| BEHAVIOR-6a | CI pywebview 建窗探针 `--probe` 模式 2s 退出，exit_code=0 | `tests/test_overlay_window.py` | `probe 模式 2s 内退出 exit_code 0` |
| BEHAVIOR-6b | notepad 替身 hwnd 运行贴靠循环，GetForegroundWindow 不变（NOACTIVATE 有效） | `tests/test_overlay_window.py` | `notepad hwnd GetForegroundWindow 不变` |

---

## 三、E2E 验收

### CI 层（windows_cloud，GHA windows-latest）

1. **pywebview 建窗探针**：`python overlay_window.py --probe`，2s 建窗即退，exit_code=0；超时（>5s）→ step 失败，整体 CI 红
2. **探针过 → notepad 替身**：spawn `notepad.exe` 取 hwnd，调 `PositionLoop.attach_to_hwnd(notepad_hwnd)` 跑 500ms，断言 `GetForegroundWindow() != notepad_hwnd`（不抢焦点）
3. **探针败 → 纯函数 pytest 兜底**：不依赖 WebView2，仅跑 `PositionLoop` 四行判据表逻辑 + `EventTailConsumer` 消费逻辑（全绿才不阻 PR）
4. **贴靠循环 pytest（4 case）**：IsIconic 隐藏 / 非 Visible 隐藏 / CLOAKED 冻结 / 正常跟随——各一 case，500ms 循环不阻塞主线程
5. **tail 消费端 pytest（4 case）**：heartbeat >180s 降级文案 / inode 变化重开句柄 / 坏行跳过不崩 / event_id 幂等去重
6. **overlay_window 纯函数 pytest（5 case）**：欢迎卡 first_run_done 幂等 / DOM 30 节点 FIFO / 同联系人聚合 / 发送中→已送达翻转 / skipped 灰条不进计数
7. **中台 vitest（替换 mock 存根，3 主路径）**：正常 reasoning 调用 / PII 命中降级 / 兜底缺省「已回复 {联系人}」
8. **smoke 补充**：`line04-ai-overlay-smoke.sh` 追加第二刀验收项（overlay_window.py 文件存在 + overlay.ts handler 可 require + reasoning 字段通过 API 回显）
9. **grep 回归**：`listen_chat content[:20]` 清零断言仍通过，确认第一刀不被破坏
10. **无 it.todo 断言**：`npx vitest run --reporter=verbose 2>&1 | grep -c "todo\|skip" = 0`；BEHAVIOR-5 所有 it() 必须为真实可执行断言，不许留 `it.todo`

### 真机层（xian-rog，手动验收）

1. 真发一条消息 → `_STATE_DIR/events.jsonl` 新增 `reply_sent`（含 reasoning 字段，无 PII 内容）→ 浮窗截图含该联系人动态条目 → 今日计数 +1
2. 微信最小化（IsIconic）→ 浮窗自动隐藏；发送瞬态（CLOAKED）→ 浮窗位置冻结，无闪烁
3. 记事本置前触发回复 → `GetForegroundWindow()` 仍指向记事本（浮窗不抢焦）
4. 关闭浮窗（exit_code=0）→ 重启 agent 前不被拉回；重启 agent 后浮窗正常拉起，位置从 overlay-state.json 恢复
5. `WebView2` preflight 双查真机通过（pywebview + WebView2 均检测 OK），`overlay-diag.json` 12 字段完整（含 `attach_state`/`circuit_open`/`wechat_hwnd_found` 等）
6. 热更验收：部署新版本 → mutex `Global\zenithjoy-line04-overlay` 杀旧进程 → 新浮窗拉起，折叠/位置状态从 overlay-state.json 恢复

---

## 四、Golden Path 对照

本刀推进 **Path 4 「客户私域 AI 接管」**，将「AI 思考浮窗」从 **thin-骨架**（第一刀地基：地基文件 + events 管道 + PII 双硬闸）推至 **thin-可用**（窗口本体 + 贴靠循环 + 真实 reasoning + 中台接线 + CI 全绿）。

| Path 4 Step | 本刀覆盖 |
|-------------|--------|
| Step 3：名单内客户私聊 → DeepSeek reasoning → 写回复 | **直接推进**：FR-4 reasoning 真实现，`generateChatDraft` 返回 `{reply,tags,reasoning}` |
| 浮窗可用性：操作员实时视觉反馈 | **新增**：FR-1 窗口本体 + FR-2 贴靠循环 + FR-3 tail 消费 |
| 运维稳定性：watchdog + preflight + mutex 热更 | **新增**：FR-5 node 侧接线 |
| CI 可验证性 | **新增**：FR-6 pywebview 探针 + notepad 替身 |

Path 1 无影响（本刀不改 golden-path-1-smoke.sh 任何 step，listen_chat.py 不动）。

---

## 五、Invariant 覆盖核查

| # | Invariant | 本刀涉及 | 覆盖方式 |
|---|-----------|---------|---------|
| I1 | events.jsonl 唯一写者 = listen_chat（浮窗只读） | 是 | FR-3 `EventTailConsumer` 全程 `open(path, 'r')`，无写入；pytest 断言无 write 系统调用 |
| I2 | reply_sent 挂点 = listen_chat.py:4787 DELIVERED，禁挂 `_commit_reply_success` | 否 | 第一刀已覆盖，本刀不改 listen_chat.py |
| I3 | reasoning 单一来源 = LLM 合同 JSON `reasoning` 字段（≤30字） | 是 | FR-4 `generateChatDraft` 截断 `reasoning.slice(0,30)`；vitest 断言 `length <= 30` |
| I4 | customer_stage 复用既有 tags.stage（A1-A4），禁另造 | 是 | FR-4 LLM prompt system 约束 stage 枚举；vitest 断言 `validStages.has(stage)` |
| I5 | PII 双硬闸：中台截断（第一闸）+ agent 写 events 前（第二闸） | 是 | FR-4 中台 reasoning PII 过滤接线（第一闸）；FR-3 渲染前调 pii_filter.py（第二闸复用第一刀） |
| I6 | 浮窗软检测禁止进 manifest requiredChecks | 是 | FR-5 spawn 前调 preflight.py，失败仅不 spawn + 写 diag，不向上抛异常阻主链 |
| I7 | 崩溃熔断（60min 8 次 <60s → 静默） | 是 | FR-5 接 watchdog.py `circuit_open` 属性；handler 检查 circuit_open=true → 不重拉 |
| I8 | 用户关闭 = exit_code 0 + user_closed=true，守活不重拉 | 是 | FR-5 overlay.ts 读 exit_code + stdout 含 `user_closed=true` 分支；BEHAVIOR-5b 断言 |
| I9 | events.jsonl 路径在 _STATE_DIR 下，严禁 C:\Users\Public | 是 | FR-3 从 `ZJ_STATE_DIR` env 构造路径；pytest 断言路径 `not in ('C:\\Users\\Public',)` |
| I10 | event_id 幂等去重按整串精确匹配（epoch_ms 仅展示排序用） | 是 | FR-3 `seen_event_ids: set` 精确 `in` 匹配；BEHAVIOR-3c pytest 覆盖重放场景 |
| I11 | 浮窗只观察微信窗口，绝不干预（防两进程拉扯） | 是 | FR-1/FR-2 overlay_window.py 无 UIA SendMessage/SetForeground/PostMessage；代码 grep 断言 |
| I12 | 异常态一律温和文案+变灰，禁「错误/中断/!」字样 | 是 | FR-1 HTML 降级态文案白名单；pytest grep overlay_window.py 无禁用字样 |
