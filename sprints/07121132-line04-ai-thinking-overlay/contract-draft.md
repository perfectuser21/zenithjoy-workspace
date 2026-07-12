# Contract Draft — Line04 AI 思考浮窗（贴靠微信·回复动态流+推理展示）

sprint_dir: sprints/07121132-line04-ai-thinking-overlay
task_id: a1bf1ba5-bf7c-4a87-842d-0dbe004698fb
journey_id: bfeed805-deed-46c3-8624-87f0028101d4
round: 1
date: 2026-07-12
status: PROPOSED

---

## 一、范围声明

本 Sprint 推进 Path 4（客户私域 AI 接管）新增 Ability「AI 思考浮窗」从 ⬜ 到 thin ✅。

### 交付边界（本次 IN）

| 编号 | 模块 | 交付物 |
|------|------|--------|
| D1 | 事件管道 | `_STATE_DIR/events.jsonl` 写入（listen_chat 唯一写者），4 类事件：reply_sent / reply_skipped / heartbeat / agent_online |
| D2 | 中台合同 | `wechat-draft.ts` LLM JSON 扩展 `{reply, tags, reasoning≤30字}`，向后兼容 |
| D3 | PII 双硬闸 | 中台侧 reasoning 截断+正则过滤；auto_reply.py 写 events 前二次同一纯函数 |
| D4 | 浮窗进程 | `services/line04/overlay/` — Python pywebview+WebView2，line04 node 侧 spawn，守活+熔断+热更杀旧 |
| D5 | 窗口行为 | WS_EX_NOACTIVATE+TOOLWINDOW，四行判据显隐，位置持久化 overlay-state.json |
| D6 | UI 动态流 | 20 条上限/DOM 30 节点，发送中→已送达原地翻转，欢迎卡，默认态/降级态 |
| D7 | listen_chat 明文日志收敛 | 4687/4691/4696 三处 content[:20] 改调脱敏函数 |
| D8 | diag 上报 | overlay-diag.json（12 字段），line04 心跳随 diag 上报中台 |

### 不在本次范围（OUT）

- 当前会话跟随（第二刀）
- 完整客户画像卡片（第二刀）
- 中台浮窗监控看板页（另立 sprint）
- listen_chat 守活退避阶梯补充（超范围）

---

## 二、Invariant 确认（全部继承，不推翻）

| # | Invariant | 验证点 |
|---|-----------|--------|
| I1 | events.jsonl 唯一写者 = listen_chat（O_APPEND） | grep 型测试：浮窗代码中无 open(events.jsonl, 'w'/'a') |
| I2 | reply_sent 挂点 = :4787 DELIVERED | 代码 diff 断言挂点行号 |
| I3 | reasoning 单一来源 = LLM 合同 JSON 字段，≤30字 | vitest 断言长度 + openrouter.ts:126-132 不改动 |
| I4 | customer_stage 复用 tags.stage（A1-A4） | vitest stage 取值域断言 |
| I5 | PII 双硬闸：中台截断+正则 / auto_reply.py 二次过滤 | pytest PII 用例覆盖"复述客户原话"场景 |
| I6 | 浮窗软检测禁止进 manifest requiredChecks | manifest 文件 grep 断言 |
| I7 | 崩溃熔断 60min/8次/存活<60s | pytest 计时模拟 |
| I8 | 用户关闭 = 退出码 0 + user_closed=true，守活不重拉 | pytest 退出码断言 |
| I9 | events.jsonl 路径在 _STATE_DIR，严禁 C:\Users\Public | pytest 路径构造断言 |
| I10 | event_id 幂等去重按整串精确匹配 | pytest 幂等测试 |
| I11 | 浮窗只观察微信窗口，绝不干预 | 代码审查：无 SendMessage/PostMessage 到微信 hwnd |
| I12 | 异常态一律温和文案+变灰，禁"错误/中断/!"字样 | grep 型测试：UI 文案扫描 |

---

## 三、功能合同

### FC-1：事件管道

**写入合同**
- listen_chat.py 在 :4787 DELIVERED 点追加 `reply_sent` 行（O_APPEND，不截断）
- `reply_skipped` 与 `_skip_logged` 同点同去重，rate_limited/sender_cooldown 高频瞬态不写
- `heartbeat` 60s 周期；`agent_online` 进程启动时写

**行 schema 合同**
```json
{
  "v": 1,
  "event_id": "{epoch_ms}-{run_id 6位随机hex}-{seq进程内递增}",
  "date": "YYYY-MM-DD",
  "type": "reply_sent|reply_skipped|heartbeat|agent_online",
  "contact": "string",
  "stage": "A1|A2|A3|A4|null",
  "reasoning": "≤30字客户可读文案",
  "ts": 1234567890
}
```

**读取合同**
- 浮窗 tail 轮询 500ms，空闲退避 2s
- 坏行/半行跳过，不崩溃
- 文件轮转：5MB 改名 .1，今日计数回放跨两代（先 .1 后当前）
- inode 变化重开句柄，event_id 幂等重放

### FC-2：中台合同扩展

**LLM 返回体**（`apps/api/src/services/wechat-draft.ts`）
```json
{"reply": "...", "tags": {"stage": "A1", ...}, "reasoning": "≤30字客户可读文案"}
```
- `reasoning` 字段新增，向后兼容（缺失时 agent 渲染降级文案「已回复 {联系人}」）
- :548 正则兜底路径 reasoning → 缺省空字符串，agent 侧渲染降级

**PII 中台侧过滤**
- 手机号/微信号/身份证命中 → 整句替换为降级文案
- 截断后正则过滤，返回前执行

### FC-3：PII 双硬闸

- auto_reply.py 写 events 前执行与中台相同的 PII 过滤纯函数（同一实现，不二次封装）
- 纯函数签名：`def filter_pii(text: str) -> str`，无副作用
- 单测必须含"LLM 复述客户原话"用例

### FC-4：浮窗进程

**spawn 合同**（line04 node 侧）
- 参照 wechat-rpa.ts:19-27 env 注入 `ZJ_STATE_DIR` + 模块版本
- spawn 前软检测：pywebview import + WebView2 注册表（HKLM+HKCU EdgeUpdate Clients pv 任一非空）
- 软检测失败 → 不 spawn，写 `_STATE_DIR/overlay-diag.json`（覆盖写）

**守活合同**
- 固定 30s 重拉
- 60min 内 8 次存活<60s → 熔断静默，agent 重启复位
- WebView2 Evergreen 更新崩 → 独立错误码静默重建，不计入熔断

**热更合同**
- 命名 mutex `Global\zenithjoy-line04-overlay`
- overlay.pid 存 PID+版本，校验映像名再 taskkill

**关闭合同**
- 用户关闭 → 退出码 0 + overlay-state.json `user_closed=true`
- 守活不重拉；托盘菜单「显示 AI 浮窗」重开

### FC-5：窗口行为

**样式**：WS_EX_NOACTIVATE + WS_EX_TOOLWINDOW，无键鼠钩子，Per-Monitor V2 DPI

**显隐判据表**（500ms 单循环合并贴靠+显隐+tail）

| 微信窗口状态 | 浮窗行为 |
|------------|--------|
| 不存在 ∨ IsIconic | 隐藏 |
| 存在 ∧ ¬IsIconic ∧ ¬IsWindowVisible | 隐藏（托盘静置） |
| 存在 ∧ IsWindowVisible ∧ DWMWA_CLOAKED≠0 | 冻结（不更新位置，发送瞬态防闪烁） |
| 其余 | 显示跟随 |

**位置持久化**：overlay-state.json，损坏→弃用默认值+备份；恢复时 rect_visible 校验越界重置

### FC-6：UI 动态流

- 最多 20 条（DOM 30 节点硬顶 FIFO）；同联系人相邻动态聚合卡片
- 两态：发送中（灰）→ 已送达（绿），原地翻转，不新增条目
- skipped 类：低饱和灰条，不进未读计数
- 欢迎卡（first_run_done 持久化）：「AI 客服已就位，正在守护你的微信会话」
- 默认态（永不空白）：「AI 客服守护中 · 今日已回复 N · 最近动作 xx:xx」
- 降级态（heartbeat >180s）：「AI 客服休息中，稍后自动恢复」（灰色）
- 条目：联系人昵称 + 阶段色点(A1-A4) + reasoning(≤30字) + 相对时间；点开展开回复原文
- 折叠态：新回复 → 徽标数字弹跳一次（无声音、无闪烁、不抢焦点）

### FC-7：明文日志收敛

- listen_chat.py 4687/4691/4696 三处 `content[:20]` → 调统一脱敏函数
- grep 回归：`content\[:20\]` 字样在 listen_chat.py 中清零

### FC-8：diag 上报

overlay-diag.json 字段（12 项）：
`agent_id, ts, overlay_pid, rss_mb, cpu_pct, attach_state, wechat_hwnd_found, render_lag_ms_p95, events_tail_offset, restart_count_60min, circuit_open, last_error`

---

## 四、NFR 合同

| 指标 | 阈值 | 超限动作 |
|------|------|--------|
| 内存 RSS | 连续 2 心跳 >200MB | 只留 20 条 + 强制 GC |
| 内存 RSS | >300MB | 自杀重启 |
| CPU 60s 均值 | >5% | 轮询降频 1s + diag 上报 |
| events 落行→浮窗显示延迟 P95 | ≤1.2s（>2s 连续 3 次 → diag.render_lag） | — |
| 崩溃熔断 | 60min 内 8 次存活<60s | 熔断静默，agent 重启复位 |
| 浮窗不获焦 | GetForegroundWindow 不变 | — |

---

## E2E 验收

### CI 层（windows_cloud，GHA windows-latest）

#### 5.1 smoke 脚本（line04-ai-overlay-smoke.sh）

验收命令（`manual:bash`）：
```bash
bash .github/workflows/scripts/smoke/line04-ai-overlay-smoke.sh
```

smoke 脚本验收内容：
1. `pytest services/line04/tests/test_events_pipeline.py -v` — events 管道全套（坏行/并发/轮转/幂等/PII/降级文案）通过
2. `vitest run apps/api/src/services/__tests__/wechat-draft.test.ts` — draft-generate {reply,tags,reasoning} 三路断言通过
3. `grep -nP 'content\[:20\]' services/line04/listen_chat.py` 输出为空（明文日志清零）
4. overlay-diag.json schema 字段完整性校验（jq 断言 12 字段存在）
5. 浮窗进程 pywebview 探针：2s 建窗退出码为 0

#### 5.2 pytest events 层（`services/line04/tests/test_events_pipeline.py`）

- 坏行容错：含非 JSON 行时 tail 继续读后续有效行，不崩
- 并发写读：双线程并发写 10000 行，读侧无丢失无重复
- 跨午夜计数：跨 date 字段统计今日计数正确
- 跨两代回放：.1 轮转后新建文件，浮窗两代合并读取，event_id 去重
- event_id 幂等：相同 event_id 重放不计数
- PII 过滤（含"复述客户原话"用例）：reasoning 含手机号/微信号 → 被替换
- 降级文案：reasoning 缺失 → agent 渲染「已回复 {联系人}」

#### 5.3 vitest 中台层（`apps/api/src/services/__tests__/wechat-draft.test.ts`）

三路断言：
- 正常路径：LLM 返回 `{reply, tags, reasoning}` → 响应体含 reasoning，长度 ≤30 字
- 兜底缺省：:548 正则兜底路径 reasoning 缺省 → 返回降级文案
- PII 命中降级：reasoning 含手机号 → 替换为降级文案

#### 5.4 grep 回归

```bash
! grep -nP 'content\[:20\]' services/line04/listen_chat.py
```
输出必须为空（清零断言）

#### 5.5 浮窗软检测单测

- pywebview 不可用时：软检测返回 `{ok: false, reason: 'pywebview_missing'}`，写 overlay-diag.json
- WebView2 注册表缺失时：软检测返回 `{ok: false, reason: 'webview2_missing'}`
- 两项均存在：软检测通过，返回 `{ok: true}`

### 真机层（xian-rog，手动验收，`manual:bash`）

```bash
# 1. 触发一条真实回复，验证 events.jsonl 新增 reply_sent 行
tail -f "$ZJ_STATE_DIR/events.jsonl" | grep --line-buffered '"type":"reply_sent"'

# 2. 浮窗截图存档
python services/line04/overlay/screenshot.py --output /tmp/overlay-snapshot.png

# 3. 验证 reasoning 无客户原文（PII 过滤已生效）
python -c "
import json, sys
lines = open('$ZJ_STATE_DIR/events.jsonl').readlines()
for l in reversed(lines[-10:]):
    row = json.loads(l)
    if row.get('type') == 'reply_sent':
        r = row.get('reasoning', '')
        assert len(r) <= 30, f'reasoning 超 30 字: {r}'
        print('OK reasoning:', r)
        break
"

# 4. 验证浮窗关闭后守活不重拉
python services/line04/overlay/main.py --close-and-check
cat "$ZJ_STATE_DIR/overlay-state.json" | python -c "import json,sys; d=json.load(sys.stdin); assert d['user_closed']==True"

# 5. GetForegroundWindow 不变（记事本置前触发回复）
python services/line04/tests/manual/test_noactivate.py
```

---

## 六、产物清单

| 路径 | 类型 | 说明 |
|------|------|------|
| `.github/workflows/scripts/smoke/line04-ai-overlay-smoke.sh` | smoke | CI 接入，≥5 行实质内容 |
| `services/line04/overlay/__init__.py` | impl | 浮窗进程入口 |
| `services/line04/overlay/main.py` | impl | 主循环（tail+窗口贴靠+UI） |
| `services/line04/overlay/tail_reader.py` | impl | events.jsonl tail 读取 |
| `services/line04/overlay/window_manager.py` | impl | 显隐判据+DPI+NoActivate |
| `services/line04/overlay/pii_filter.py` | impl | PII 过滤纯函数（与中台同逻辑） |
| `services/line04/overlay/preflight.py` | impl | pywebview/WebView2 软检测 |
| `services/line04/tests/test_events_pipeline.py` | test | pytest events 管道 7 用例 |
| `services/line04/tests/manual/test_noactivate.py` | manual | GetForegroundWindow 不变验证 |
| `apps/api/src/services/__tests__/wechat-draft.test.ts` | test | vitest 三路断言 |
| `sprints/07121132-line04-ai-thinking-overlay/contract-draft.md` | contract | 本文件 |
| `sprints/07121132-line04-ai-thinking-overlay/contract-dod.md` | dod | DoD 行为条目 |

---

## 七、风险与依赖

| 风险 | 等级 | 缓解 |
|------|------|------|
| WebView2 在 windows_cloud runner 未预装 | 中 | 软检测降级：GUI 层降级纯函数 pytest，smoke 仍可全绿 |
| pywebview 在 Windows CI 环境安装失败 | 中 | 走 build-install-pack.sh WHEEL_PKGS 通道，离线安装 |
| listen_chat.py :4787 行号因上游 PR 漂移 | 低 | reply_sent 挂点用函数名+上下文锁定，CI 加 grep 断言 |
| events.jsonl 并发写乱序（非 O_APPEND） | 低 | pytest 并发测试覆盖，O_APPEND 原子性由 OS 保证 |
