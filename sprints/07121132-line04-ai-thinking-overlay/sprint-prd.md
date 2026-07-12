# Sprint PRD：Line04 AI 思考浮窗（第一刀·动态流）

> Journey: 客户私域 AI 接管 (bfeed805) · Step 新增 · Maturity thin  
> Sprint Dir: sprints/07121132-line04-ai-thinking-overlay  
> Task ID: a1bf1ba5-bf7c-4a87-842d-0dbe004698fb

---

## 一句话目标

在客户 Windows 桌面贴靠微信窗口，显示 AI 客服实时工作动态流（含推理逻辑），让客户"看到 AI 在思考"。

---

## Golden Path（单线性，6 步）

1. line04 模块启动 → 软检测 pywebview+WebView2（HKLM+HKCU 双查） → 通过且微信主窗首次出现 → 浮窗贴靠右侧弹出，显示一次性欢迎卡
2. 有消息被 AI 回复 → 浮窗先显示灰态「发送中」→ DELIVERED 确认 → 原地翻绿「已送达」（含昵称+阶段色点 A1-A4+推理≤30字+相对时间）
3. 拖动/折叠 → 位置与折叠态持久化；折叠期新回复 → 徽标数字弹跳一次（无声音/闪烁/抢焦点）
4. 点开条目 → 展开回复原文（默认折叠只显推理）
5. 点关闭 → 浮窗退出不被拉回；托盘菜单「显示 AI 浮窗」可重开
6. 微信托盘化 → 浮窗跟随隐藏；微信恢复 → 浮窗跟随出现；默认态永不空白「AI 客服守护中 · 今日已回复 N 条 · 最近动作 xx:xx」

---

## Invariant 约束

1. **主链零影响**：pywebview/WebView2 缺失或浮窗任何崩溃，均不影响 AI 回复主链；软检测禁止进 manifest requiredChecks
2. **PII 双硬闸**：中台返回前截断+正则过滤（手机号/微信号/身份证→整句降级）；agent 写 events.jsonl 前二次执行同一过滤纯函数
3. **禁止抢焦点**：WS_EX_NOACTIVATE+WS_EX_TOOLWINDOW，无键鼠钩子；微信托盘化触发回复时 GetForegroundWindow 保持不变
4. **events.jsonl 唯一写者**：仅 listen_chat O_APPEND 追加；浮窗只读 tail；轮转 rename 时按 inode 变化重开句柄，event_id 幂等去重
5. **温和异常文案**：所有降级/错误态禁用「错误/中断/!」字样，一律灰色温和提示
6. **熔断保护**：60 分钟内 8 次存活<60s → 熔断静默，agent 重启后复位；WebView2 Evergreen 更新/渲染崩 → 独立错误码静默重建，不计入崩溃熔断，不锁版本
7. **reasoning 单一来源**：仅 LLM 合同 JSON `{reply,tags,reasoning≤30字}`；openrouter.ts reasoning_content 剥离纪律原封不动；缺省降级文案「已回复 {联系人}」
8. **禁止 C:\Users\Public 路径**：events.jsonl 和所有状态文件只写 _STATE_DIR

---

## 累积 FR

| # | 功能描述 | 厚度 |
|---|---------|------|
| FR-1 | events.jsonl 事件管道：reply_sent/reply_skipped/heartbeat(60s)/agent_online；行 schema v:1+event_id(epoch_ms-run_id-seq)；5MB 轮转留一代；坏行跳过不崩 | thin |
| FR-2 | 中台 wechat-draft.ts：LLM 合同 JSON 扩展 reasoning≤30字；draft-generate 返回体向后兼容；PII 过滤前置 | thin |
| FR-3 | pywebview 浮窗独立进程：WS_EX_NOACTIVATE+WS_EX_TOOLWINDOW+Per-Monitor V2 DPI；500ms 循环合并贴靠+显隐+tail；四行判据表（CLOAKED=冻结） | thin |
| FR-4 | 动态流 UI：20 条上限(DOM 30 节点 FIFO)；发送中→已送达原地翻转；同联系人相邻聚合；skipped 灰条不进未读计数 | thin |
| FR-5 | 位置/折叠态持久化：overlay-state.json；损坏→弃用+备份；恢复时 rect_visible 越界重置；OFFSCREEN_REPLY 模式独立悬浮 | thin |
| FR-6 | 欢迎卡(first_run_done 持久化)+默认守护态(今日计数+最近动作)；计数回放跨两代 events | thin |
| FR-7 | 拉起守活：line04 node 侧 spawn（照抄 wechat-rpa.ts:19-27）；30s 重拉+熔断；overlay.pid 热更杀旧（mutex+PID+版本校验映像名） | thin |
| FR-8 | diag 上报：overlay-diag.json 覆盖写（独立于 events.jsonl）；字段含 rss_mb/cpu_pct/attach_state/render_lag_ms_p95/restart_count_60min/circuit_open 等 | thin |
| FR-9 | 内存/CPU 自愈：RSS>200MB→留 20 条+GC；>300MB→自杀重启；CPU 60s 均值>5%→轮询降频 1s | thin |
| FR-10 | listen_chat.py 3 处明文日志（4687/4691/4696）→ 统一脱敏函数+grep 型回归测试（顺带收敛） | thin |
| FR-11 | 软检测 preflight：spawn 前查 pywebview import + WebView2 注册表；缺失→不 spawn，写 overlay-diag.json，line04 心跳上报中台 | thin |

---

## NFR

| 项 | 指标 | 超限动作 |
|----|------|---------|
| 延迟 | events 落行→浮窗显示 P95 ≤1.2s；>2s 连续 3 次 → diag.render_lag | 记录 diag |
| 内存 | RSS 连续 2 心跳 >200MB → 留 20 条+强制 GC；>300MB → 自杀重启 | 自杀重启 |
| CPU | 60s 均值 >5% → 轮询降频 1s + diag 上报 | 降频 |
| 稳定性 | 60min 内 8 次存活<60s → 熔断；WebView2 Evergreen 崩 → 静默重建不计熔断 | 熔断 |
| 焦点 | 微信托盘化发回复期间 GetForegroundWindow 不变 | 断言 |

---

## 不包含（本刀边界）

- 当前会话跟随（点开哪个客户浮窗切换）——第二刀
- 完整客户画像卡片——第二刀
- 中台浮窗监控看板页——另立 sprint（本次只落 diag 数据）
- listen_chat 守活退避阶梯——超范围

---

## 验收标准

**CI 层（windows_cloud GHA windows-latest）**
- [ ] pywebview 建窗探针（2s 即退）；探针过→notepad 替身 hwnd 跑贴靠/显隐/NOACTIVATE；探针败→降级纯函数 pytest
- [ ] pytest：坏行容错/双线程并发写读 1 万行无丢无重/跨午夜计数/跨两代回放/event_id 幂等/PII 过滤器（含复述客户原话用例）/降级文案
- [ ] vitest：draft-generate 返回体三路断言（正常/兜底缺省/PII 命中降级）
- [ ] grep 型回归：listen_chat 明文 content 日志字样清零
- [ ] smoke：`.github/workflows/scripts/smoke/line04-ai-overlay-smoke.sh` 接入 CI

**真机层（xian-rog）**
- [ ] 真发消息 → events.jsonl 新增 reply_sent 行（含 reasoning，无客户原文）→ 浮窗截图含该动态 → 今日计数 +1
- [ ] 微信托盘化发送瞬态：浮窗冻结不闪烁；记事本置前触发回复 → GetForegroundWindow 不变
- [ ] 关闭浮窗 → 不被拉回；托盘菜单重开成功
- [ ] WebView2 preflight 双查真机通过

---

journey_type: user_facing  
target_environment: windows_cloud (CI) + xian-rog (真机验收)
